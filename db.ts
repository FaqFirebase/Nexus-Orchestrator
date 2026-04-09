import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { encrypt, decrypt, readEncryptedJson, hashPassword } from './crypto.js';
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

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_configs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS admin_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL DEFAULT '{}'
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

  // Add user_id column to conversations if missing (schema v3 migration — multi-user)
  try {
    db.exec('ALTER TABLE conversations ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE');
    log.info('Added user_id column to conversations');
  } catch { /* column already exists */ }

  // Add user_id column to projects if missing (schema v3 migration — multi-user)
  try {
    db.exec('ALTER TABLE projects ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE');
    log.info('Added user_id column to projects');
  } catch { /* column already exists */ }

  // Insert schema version if not present
  const versionRow = db.prepare('SELECT version FROM schema_version').get() as any;
  if (!versionRow) {
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(1);
  }

  // Migrate from JSON files if they exist
  await migrateFromJson(encryptionSecret, defaultConfig);

  // Ensure config exists (legacy global config for migration purposes)
  const configRow = db.prepare('SELECT data FROM config WHERE id = 1').get() as any;
  if (!configRow) {
    log.info('Initializing default config');
    writeConfig(defaultConfig, encryptionSecret);
  }

  // Ensure admin settings row exists
  const adminSettingsRow = db.prepare('SELECT id FROM admin_settings WHERE id = 1').get();
  if (!adminSettingsRow) {
    db.prepare('INSERT INTO admin_settings (id, data) VALUES (1, ?)').run(JSON.stringify({ registrationEnabled: false }));
  }

  return readConfig(encryptionSecret);
}

// --- Admin bootstrap ---

export function bootstrapAdmin(adminApiKey: string, encryptionSecret: string, defaultConfig: any): string {
  const existingUsers = db.prepare('SELECT COUNT(*) as count FROM users').get() as any;
  if (existingUsers.count > 0) {
    // Already have users — return existing admin ID
    const admin = db.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').get('admin') as any;
    return admin?.id || '';
  }

  log.info('No users found — bootstrapping admin account from ADMIN_API_KEY');
  const adminId = crypto.randomUUID();
  const passwordHash = hashPassword(adminApiKey);
  const createdAt = new Date().toISOString();

  db.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(adminId, 'admin', passwordHash, 'admin', createdAt);

  // Copy global config to admin's user config
  const globalConfig = readConfig(encryptionSecret);
  if (globalConfig) {
    writeUserConfig(adminId, globalConfig, encryptionSecret);
  } else {
    writeUserConfig(adminId, defaultConfig, encryptionSecret);
  }

  // Assign all existing conversations and projects to admin
  db.prepare('UPDATE conversations SET user_id = ? WHERE user_id IS NULL').run(adminId);
  db.prepare('UPDATE projects SET user_id = ? WHERE user_id IS NULL').run(adminId);

  log.info({ userId: adminId }, 'Admin account created (username: admin)');
  return adminId;
}

// --- Users ---

export function createUser(username: string, passwordHash: string, role: 'admin' | 'user' = 'user'): any {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, username, passwordHash, role, createdAt);
  return { id, username, role, createdAt };
}

export function getUserByUsername(username: string): any | null {
  const row = db.prepare('SELECT id, username, password_hash, role, created_at FROM users WHERE username = ? COLLATE NOCASE').get(username) as any;
  if (!row) return null;
  return { id: row.id, username: row.username, passwordHash: row.password_hash, role: row.role, createdAt: row.created_at };
}

export function getUserById(id: string): any | null {
  const row = db.prepare('SELECT id, username, password_hash, role, created_at FROM users WHERE id = ?').get(id) as any;
  if (!row) return null;
  return { id: row.id, username: row.username, passwordHash: row.password_hash, role: row.role, createdAt: row.created_at };
}

export function listUsers(): any[] {
  return (db.prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at ASC').all() as any[]).map(r => ({
    id: r.id, username: r.username, role: r.role, createdAt: r.created_at,
  }));
}

export function updateUserPassword(id: string, newPasswordHash: string): boolean {
  const result = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newPasswordHash, id);
  return result.changes > 0;
}

export function deleteUser(id: string): boolean {
  // Cascades: user_configs, conversations (→ messages), projects all deleted via ON DELETE CASCADE
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return result.changes > 0;
}

export function getUserCount(): number {
  return (db.prepare('SELECT COUNT(*) as count FROM users').get() as any).count;
}

// --- Admin Settings ---

export function getAdminSettings(): any {
  const row = db.prepare('SELECT data FROM admin_settings WHERE id = 1').get() as any;
  if (!row) return { registrationEnabled: false };
  return JSON.parse(row.data);
}

export function updateAdminSettings(settings: any): void {
  db.prepare('INSERT OR REPLACE INTO admin_settings (id, data) VALUES (1, ?)').run(JSON.stringify(settings));
}

// Fallback URL used only during migration when no URL is stored at all
const FALLBACK_LOCAL_URL = "http://localhost:11434";

/**
 * Migrates a stored config to the current schema format.
 * Runs on every read so existing data is transparently upgraded:
 *  - Single localUrl/localKey → localProviders array
 *  - Category models stored as strings → CategoryModel objects
 */
function migrateConfig(config: any): any {
  if (!config) return config;

  // Migrate single localUrl/localKey to localProviders array
  if (!config.localProviders || !Array.isArray(config.localProviders) || config.localProviders.length === 0) {
    config.localProviders = [{
      name: 'Local',
      url: config.localUrl || FALLBACK_LOCAL_URL,
      key: config.localKey || '',
    }];
  }

  // Migrate string category models to CategoryModel objects
  if (config.categories) {
    const firstProviderUrl = config.localProviders[0]?.url || FALLBACK_LOCAL_URL;
    for (const cat of Object.values(config.categories) as any[]) {
      if (cat && Array.isArray(cat.models)) {
        cat.models = cat.models.map((m: any) => {
          if (typeof m === 'string') {
            return { name: m, providerUrl: firstProviderUrl };
          }
          return m;
        });
      }
    }
  }

  return config;
}

function decryptProviderKeys(config: any, encryptionSecret: string): void {
  if (config.localProviders) {
    for (const p of config.localProviders) {
      if (p.key) p.key = decrypt(p.key, encryptionSecret);
    }
  }
}

function encryptProviderKeys(clone: any, encryptionSecret: string): void {
  if (clone.localProviders) {
    for (const p of clone.localProviders) {
      if (p.key) p.key = encrypt(p.key, encryptionSecret);
    }
  }
}

// --- User Config ---

export function readUserConfig(userId: string, encryptionSecret: string): any | null {
  const row = db.prepare('SELECT data FROM user_configs WHERE user_id = ?').get(userId) as any;
  if (!row) return null;
  const config = JSON.parse(row.data);
  if (config.localKey) config.localKey = decrypt(config.localKey, encryptionSecret);
  if (config.cloudKey) config.cloudKey = decrypt(config.cloudKey, encryptionSecret);
  if (config.router?.key) config.router.key = decrypt(config.router.key, encryptionSecret);
  decryptProviderKeys(config, encryptionSecret);
  return migrateConfig(config);
}

export function writeUserConfig(userId: string, config: any, encryptionSecret: string): void {
  const clone = JSON.parse(JSON.stringify(config));
  if (clone.localKey) clone.localKey = encrypt(clone.localKey, encryptionSecret);
  if (clone.cloudKey) clone.cloudKey = encrypt(clone.cloudKey, encryptionSecret);
  if (clone.router?.key) clone.router.key = encrypt(clone.router.key, encryptionSecret);
  encryptProviderKeys(clone, encryptionSecret);
  const json = JSON.stringify(clone);
  db.prepare('INSERT OR REPLACE INTO user_configs (user_id, data) VALUES (?, ?)').run(userId, json);
}

// --- Config (legacy global — used for migration and bootstrap) ---

export function readConfig(encryptionSecret: string): any {
  const row = db.prepare('SELECT data FROM config WHERE id = 1').get() as any;
  if (!row) return null;
  const config = JSON.parse(row.data);
  if (config.localKey) config.localKey = decrypt(config.localKey, encryptionSecret);
  if (config.cloudKey) config.cloudKey = decrypt(config.cloudKey, encryptionSecret);
  if (config.router?.key) config.router.key = decrypt(config.router.key, encryptionSecret);
  decryptProviderKeys(config, encryptionSecret);
  return migrateConfig(config);
}

export function writeConfig(config: any, encryptionSecret: string): void {
  const clone = JSON.parse(JSON.stringify(config));
  if (clone.localKey) clone.localKey = encrypt(clone.localKey, encryptionSecret);
  if (clone.cloudKey) clone.cloudKey = encrypt(clone.cloudKey, encryptionSecret);
  if (clone.router?.key) clone.router.key = encrypt(clone.router.key, encryptionSecret);
  encryptProviderKeys(clone, encryptionSecret);
  const json = JSON.stringify(clone);
  db.prepare('INSERT OR REPLACE INTO config (id, data) VALUES (1, ?)').run(json);
}

// --- Conversations (user-scoped) ---

export function listConversations(userId: string): any[] {
  const convRows = db.prepare('SELECT id, title, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as any[];
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
export function listConversationsPaginated(limit: number, offset: number, userId: string, projectId?: string | null): { conversations: any[]; total: number } {
  let whereClause = 'WHERE user_id = ?';
  const params: any[] = [userId];
  if (projectId === null) {
    whereClause += ' AND project_id IS NULL';
  } else if (projectId !== undefined) {
    whereClause += ' AND project_id = ?';
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

export function getConversation(id: string, userId: string): any | null {
  const conv = db.prepare('SELECT id, title, updated_at, project_id FROM conversations WHERE id = ? AND user_id = ?').get(id, userId) as any;
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
  return db.transaction((title: string, messages: any[], userId: string, projectId?: string | null) => {
    const id = crypto.randomUUID();
    const updatedAt = new Date().toISOString();
    db.prepare('INSERT INTO conversations (id, title, updated_at, project_id, user_id) VALUES (?, ?, ?, ?, ?)').run(id, title || 'New Conversation', updatedAt, projectId ?? null, userId);
    insertMessages(id, messages);
    return { id, title: title || 'New Conversation', messages, updatedAt, projectId: projectId ?? null };
  });
}

function getUpdateConversation() {
  return db.transaction((id: string, userId: string, updates: { title?: string; messages?: any[] }) => {
    const conv = db.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').get(id, userId) as any;
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
    return getConversation(id, userId);
  });
}

function getDeleteConversation() {
  return db.transaction((id: string, userId: string) => {
    const result = db.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').run(id, userId);
    return result.changes > 0;
  });
}

// Public wrappers that lazily create transactions
export function createConv(title: string, messages: any[], userId: string, projectId?: string | null): any {
  return getCreateConversation()(title, messages, userId, projectId);
}

export function updateConv(id: string, userId: string, updates: { title?: string; messages?: any[] }): any | null {
  return getUpdateConversation()(id, userId, updates);
}

export function deleteConv(id: string, userId: string): boolean {
  return getDeleteConversation()(id, userId);
}

// --- Projects (user-scoped) ---

export function listProjects(userId: string): any[] {
  return (db.prepare('SELECT id, name, collapsed, created_at FROM projects WHERE user_id = ? ORDER BY created_at ASC').all(userId) as any[]).map(r => ({
    id: r.id,
    name: r.name,
    collapsed: r.collapsed === 1,
    createdAt: r.created_at,
  }));
}

export function createProject(name: string, userId: string): any {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare('INSERT INTO projects (id, name, collapsed, created_at, user_id) VALUES (?, ?, 0, ?, ?)').run(id, name, createdAt, userId);
  return { id, name, collapsed: false, createdAt };
}

export function updateProject(id: string, userId: string, updates: { name?: string; collapsed?: boolean }): any | null {
  const existing = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(id, userId) as any;
  if (!existing) return null;
  if (updates.name !== undefined) db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(updates.name, id);
  if (updates.collapsed !== undefined) db.prepare('UPDATE projects SET collapsed = ? WHERE id = ?').run(updates.collapsed ? 1 : 0, id);
  const row = db.prepare('SELECT id, name, collapsed, created_at FROM projects WHERE id = ?').get(id) as any;
  return { id: row.id, name: row.name, collapsed: row.collapsed === 1, createdAt: row.created_at };
}

export function deleteProject(id: string, userId: string, deleteChats: boolean): void {
  const existing = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(id, userId) as any;
  if (!existing) return;
  if (deleteChats) {
    db.prepare('DELETE FROM conversations WHERE project_id = ? AND user_id = ?').run(id, userId);
  } else {
    db.prepare('UPDATE conversations SET project_id = NULL WHERE project_id = ? AND user_id = ?').run(id, userId);
  }
  db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(id, userId);
}

export function assignConversation(convId: string, projectId: string | null, userId: string): boolean {
  if (projectId !== null) {
    const project = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId);
    if (!project) return false;
  }
  db.prepare('UPDATE conversations SET project_id = ? WHERE id = ? AND user_id = ?').run(projectId, convId, userId);
  return true;
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
