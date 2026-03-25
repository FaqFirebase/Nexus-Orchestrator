import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs/promises';
import { encrypt, decrypt, readEncryptedJson } from './crypto.js';
import log from './logger.js';

const CONFIG_DIR = process.env.CONFIG_DIR || path.join(process.cwd(), 'data');
const DB_PATH = path.join(CONFIG_DIR, 'nexus.db');

let db: Database.Database;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New Conversation',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  category TEXT,
  decision TEXT,
  attachments TEXT,
  timestamp TEXT NOT NULL,
  usage TEXT,
  sort_order INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, sort_order);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  collapsed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
`;

// --- Init ---

export async function initDb(encryptionSecret: string, defaultConfig: any): Promise<any> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);

  // Add project_id column to conversations if missing (schema v2 migration)
  try {
    db.exec('ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL');
    log.info('Added project_id column to conversations');
  } catch { /* column already exists — ignore */ }

  // Insert schema version if not present
  const versionRow = db.prepare('SELECT version FROM schema_version').get() as any;
  if (!versionRow) {
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(1);
  }

  // Migrate from JSON files if they exist
  await migrateFromJson(encryptionSecret, defaultConfig);

  // Ensure config exists
  const configRow = db.prepare('SELECT data FROM config WHERE id = 1').get() as any;
  if (!configRow) {
    log.info('Initializing default config');
    writeConfig(defaultConfig, encryptionSecret);
  }

  return readConfig(encryptionSecret);
}

// --- Config ---

export function readConfig(encryptionSecret: string): any {
  const row = db.prepare('SELECT data FROM config WHERE id = 1').get() as any;
  if (!row) return null;
  const config = JSON.parse(row.data);
  // Decrypt sensitive fields
  if (config.localKey) config.localKey = decrypt(config.localKey, encryptionSecret);
  if (config.cloudKey) config.cloudKey = decrypt(config.cloudKey, encryptionSecret);
  if (config.router?.key) config.router.key = decrypt(config.router.key, encryptionSecret);
  return config;
}

export function writeConfig(config: any, encryptionSecret: string): void {
  const clone = JSON.parse(JSON.stringify(config));
  // Encrypt sensitive fields
  if (clone.localKey) clone.localKey = encrypt(clone.localKey, encryptionSecret);
  if (clone.cloudKey) clone.cloudKey = encrypt(clone.cloudKey, encryptionSecret);
  if (clone.router?.key) clone.router.key = encrypt(clone.router.key, encryptionSecret);
  const json = JSON.stringify(clone);
  db.prepare('INSERT OR REPLACE INTO config (id, data) VALUES (1, ?)').run(json);
}

// --- Conversations ---

export function listConversations(): any[] {
  const convRows = db.prepare('SELECT id, title, updated_at FROM conversations ORDER BY updated_at DESC').all() as any[];
  return convRows.map(conv => {
    const messages = db.prepare(
      'SELECT id, role, content, category, decision, attachments, timestamp, usage FROM messages WHERE conversation_id = ? ORDER BY sort_order'
    ).all(conv.id) as any[];
    return {
      id: conv.id,
      title: conv.title,
      updatedAt: conv.updated_at,
      messages: messages.map(parseMessageRow)
    };
  });
}

// Paginated listing — returns metadata only (no messages)
export function listConversationsPaginated(limit: number, offset: number, projectId?: string | null): { conversations: any[]; total: number } {
  let whereClause = '';
  const params: any[] = [];
  if (projectId === null) {
    whereClause = 'WHERE project_id IS NULL';
  } else if (projectId !== undefined) {
    whereClause = 'WHERE project_id = ?';
    params.push(projectId);
  }
  const totalRow = db.prepare(`SELECT COUNT(*) as count FROM conversations ${whereClause}`).get(...params) as any;
  const total = totalRow.count;
  const convRows = db.prepare(`SELECT id, title, updated_at, project_id FROM conversations ${whereClause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as any[];
  const conversations = convRows.map(conv => ({
    id: conv.id,
    title: conv.title,
    updatedAt: conv.updated_at,
    projectId: conv.project_id ?? null,
    messageCount: (db.prepare('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?').get(conv.id) as any).count,
  }));
  return { conversations, total };
}

export function getConversation(id: string): any | null {
  const conv = db.prepare('SELECT id, title, updated_at, project_id FROM conversations WHERE id = ?').get(id) as any;
  if (!conv) return null;
  const messages = db.prepare(
    'SELECT id, role, content, category, decision, attachments, timestamp, usage FROM messages WHERE conversation_id = ? ORDER BY sort_order'
  ).all(id) as any[];
  return {
    id: conv.id,
    title: conv.title,
    updatedAt: conv.updated_at,
    projectId: conv.project_id ?? null,
    messages: messages.map(parseMessageRow)
  };
}

// Transactional functions — lazily create transactions after db is initialized
function getCreateConversation() {
  return db.transaction((title: string, messages: any[], projectId?: string | null) => {
    const id = Date.now().toString();
    const updatedAt = new Date().toISOString();
    db.prepare('INSERT INTO conversations (id, title, updated_at, project_id) VALUES (?, ?, ?, ?)').run(id, title || 'New Conversation', updatedAt, projectId ?? null);
    insertMessages(id, messages);
    return { id, title: title || 'New Conversation', messages, updatedAt, projectId: projectId ?? null };
  });
}

function getUpdateConversation() {
  return db.transaction((id: string, updates: { title?: string; messages?: any[] }) => {
    const conv = db.prepare('SELECT id FROM conversations WHERE id = ?').get(id) as any;
    if (!conv) return null;
    const updatedAt = new Date().toISOString();
    if (updates.title !== undefined) {
      db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(updates.title, updatedAt, id);
    } else {
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(updatedAt, id);
    }
    if (updates.messages !== undefined) {
      db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id);
      insertMessages(id, updates.messages);
    }
    return getConversation(id);
  });
}

function getDeleteConversation() {
  return db.transaction((id: string) => {
    const result = db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    return result.changes > 0;
  });
}

// Public wrappers that lazily create transactions
export function createConv(title: string, messages: any[], projectId?: string | null): any {
  return getCreateConversation()(title, messages, projectId);
}

export function updateConv(id: string, updates: { title?: string; messages?: any[] }): any | null {
  return getUpdateConversation()(id, updates);
}

export function deleteConv(id: string): boolean {
  return getDeleteConversation()(id);
}

// --- Projects ---

export function listProjects(): any[] {
  return (db.prepare('SELECT id, name, collapsed, created_at FROM projects ORDER BY created_at ASC').all() as any[]).map(r => ({
    id: r.id,
    name: r.name,
    collapsed: r.collapsed === 1,
    createdAt: r.created_at,
  }));
}

export function createProject(name: string): any {
  const id = Date.now().toString();
  const createdAt = new Date().toISOString();
  db.prepare('INSERT INTO projects (id, name, collapsed, created_at) VALUES (?, ?, 0, ?)').run(id, name, createdAt);
  return { id, name, collapsed: false, createdAt };
}

export function updateProject(id: string, updates: { name?: string; collapsed?: boolean }): any | null {
  const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(id) as any;
  if (!existing) return null;
  if (updates.name !== undefined) db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(updates.name, id);
  if (updates.collapsed !== undefined) db.prepare('UPDATE projects SET collapsed = ? WHERE id = ?').run(updates.collapsed ? 1 : 0, id);
  const row = db.prepare('SELECT id, name, collapsed, created_at FROM projects WHERE id = ?').get(id) as any;
  return { id: row.id, name: row.name, collapsed: row.collapsed === 1, createdAt: row.created_at };
}

export function deleteProject(id: string, deleteChats: boolean): void {
  if (deleteChats) {
    // Delete all conversations in this project (messages cascade)
    db.prepare('DELETE FROM conversations WHERE project_id = ?').run(id);
  } else {
    // Unassign conversations from project
    db.prepare('UPDATE conversations SET project_id = NULL WHERE project_id = ?').run(id);
  }
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

export function assignConversation(convId: string, projectId: string | null): void {
  db.prepare('UPDATE conversations SET project_id = ? WHERE id = ?').run(projectId, convId);
}

// --- Helpers ---

function insertMessages(conversationId: string, messages: any[]) {
  const stmt = db.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, category, decision, attachments, timestamp, usage, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    stmt.run(
      m.id || `${conversationId}-${i}`,
      conversationId,
      m.role,
      m.content,
      m.category || null,
      m.decision ? JSON.stringify(m.decision) : null,
      m.attachments?.length ? JSON.stringify(m.attachments) : null,
      m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString(),
      m.usage ? JSON.stringify(m.usage) : null,
      i
    );
  }
}

function parseMessageRow(row: any): any {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    category: row.category || undefined,
    decision: row.decision ? JSON.parse(row.decision) : undefined,
    attachments: row.attachments ? JSON.parse(row.attachments) : undefined,
    timestamp: row.timestamp,
    usage: row.usage ? JSON.parse(row.usage) : undefined,
  };
}

// --- Migration from JSON files ---

async function migrateFromJson(encryptionSecret: string, defaultConfig: any) {
  const configPath = path.join(CONFIG_DIR, 'config.json');
  const conversationsPath = path.join(CONFIG_DIR, 'conversations.json');

  // Migrate config
  try {
    let existingConfig = await readEncryptedJson(configPath, encryptionSecret);

    if (!existingConfig) {
      // Try old location in project root
      const oldPath = path.join(process.cwd(), 'config.json');
      try {
        const content = await fs.readFile(oldPath, 'utf-8');
        existingConfig = JSON.parse(content);
        log.info('Found config.json in project root for migration');
      } catch {
        // No old file either
      }
    }

    if (existingConfig && Object.keys(existingConfig).length > 0) {
      // Apply same merge/migration logic as old ensureConfig
      const mergedConfig: any = {
        ...defaultConfig,
        ...existingConfig,
        router: { ...defaultConfig.router, ...(existingConfig.router || {}) },
        categories: { ...defaultConfig.categories, ...(existingConfig.categories || {}) }
      };

      if (mergedConfig.router.provider === 'gemini') {
        mergedConfig.router.provider = 'openai';
      }
      for (const cat of Object.keys(mergedConfig.categories)) {
        if (mergedConfig.categories[cat].provider === 'gemini') {
          mergedConfig.categories[cat].provider = 'cloud';
        }
      }

      writeConfig(mergedConfig, encryptionSecret);
      await fs.rename(configPath, configPath + '.migrated');
      log.info('Migrated config.json to SQLite');

      // Clean up backup files
      for (const suffix of ['.bak', '.tmp']) {
        try { await fs.unlink(configPath + suffix); } catch { /* ignore */ }
      }
    }
  } catch (e: any) {
    if (e.message?.includes('Corrupt or unreadable')) {
      log.fatal({ path: configPath }, 'Config file is corrupt. Restore from config.json.bak or delete config.json to reset.');
      process.exit(1);
    }
    // ENOENT or other — no config to migrate, that's fine
  }

  // Migrate conversations
  try {
    const conversations = await readEncryptedJson(conversationsPath, encryptionSecret);

    if (conversations && Array.isArray(conversations) && conversations.length > 0) {
      const insertAll = db.transaction(() => {
        for (const conv of conversations) {
          db.prepare('INSERT OR IGNORE INTO conversations (id, title, updated_at) VALUES (?, ?, ?)').run(
            conv.id, conv.title || 'New Conversation', conv.updatedAt || new Date().toISOString()
          );
          if (conv.messages?.length) {
            insertMessages(conv.id, conv.messages);
          }
        }
      });
      insertAll();
      await fs.rename(conversationsPath, conversationsPath + '.migrated');
      log.info({ count: conversations.length }, 'Migrated conversations to SQLite');

      for (const suffix of ['.bak', '.tmp']) {
        try { await fs.unlink(conversationsPath + suffix); } catch { /* ignore */ }
      }
    }
  } catch (e: any) {
    if (e.message?.includes('Corrupt or unreadable')) {
      log.fatal({ path: conversationsPath }, 'Conversations file is corrupt. Restore from .bak or delete to reset.');
      process.exit(1);
    }
    // No conversations to migrate
  }
}

// --- Shutdown ---

export function close() {
  db?.close();
}
