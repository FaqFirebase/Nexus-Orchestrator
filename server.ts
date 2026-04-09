import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import log from "./logger.js";
import {
  initDb, readConfig, writeConfig, readUserConfig, writeUserConfig,
  listConversations, listConversationsPaginated, getConversation, createConv, updateConv, deleteConv,
  listProjects, createProject, updateProject, deleteProject, assignConversation,
  bootstrapAdmin, createUser, getUserByUsername, getUserById, listUsers, updateUserPassword, deleteUser, getUserCount,
  getAdminSettings, updateAdminSettings,
  close as closeDb
} from "./db.js";
import { hashPassword, verifyPassword } from "./crypto.js";
import {
  validate, loginSchema, registerSchema, changePasswordSchema, adminCreateUserSchema, adminResetPasswordSchema,
  configSchema, routerSchema, chatSchema,
  createConversationSchema, updateConversationSchema,
  createProjectSchema, updateProjectSchema, assignConversationSchema
} from "./validation.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "";
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || (() => {
  if (ADMIN_API_KEY) {
    log.warn('ENCRYPTION_SECRET not set — deriving from ADMIN_API_KEY. Set a separate ENCRYPTION_SECRET for better security.');
  }
  return ADMIN_API_KEY;
})();

// Cookie helpers
function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map(c => {
      const [key, ...rest] = c.trim().split('=');
      return [key, rest.join('=')];
    })
  );
}

// Session management — maps session tokens to user IDs
const sessions = new Map<string, { userId: string; expiresAt: number }>();
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

function createSession(userId: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId, expiresAt: Date.now() + SESSION_MAX_AGE });
  return token;
}

function getSession(token: string): { userId: string } | null {
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return { userId: session.userId };
}

function deleteSession(token: string): void {
  sessions.delete(token);
}

function deleteUserSessions(userId: string): void {
  for (const [token, session] of sessions.entries()) {
    if (session.userId === userId) sessions.delete(token);
  }
}

const DEFAULT_LOCAL_URL = "http://localhost:11434";

// Default configuration
const DEFAULT_CONFIG = {
  localProviders: [{
    name: 'Local',
    url: process.env.LOCAL_URL || DEFAULT_LOCAL_URL,
    key: process.env.LOCAL_KEY || "",
  }],
  cloudUrl: process.env.CLOUD_URL || process.env.CLOUD_API_URL || "",
  cloudKey: process.env.CLOUD_KEY || process.env.CLOUD_API_KEY || process.env.GEMINI_API_KEY || "",
  router: {
    provider: 'openai' as 'openai',
    model: process.env.ROUTER_MODEL || '',
    url: process.env.ROUTER_URL || '',
    key: process.env.ROUTER_KEY || ''
  },
  categories: {
    CODING: { models: [], provider: 'local' },
    REASONING: { models: [], provider: 'local' },
    CREATIVE: { models: [], provider: 'local' },
    VISION: { models: [], provider: 'local' },
    GENERAL: { models: [], provider: 'local' },
    DOCUMENT: { models: [], provider: 'local' },
    FAST: { models: [], provider: 'local' },
    SECURITY: { models: [], provider: 'local' },
  }
};

// Tracks which base URLs are confirmed Ollama instances (detected via /api/tags during health check)
const ollamaUrls = new Set<string>();

/** Returns the first configured local provider's URL and key. */
function getFirstLocalProvider(config: any): { url: string; key: string } {
  if (config.localProviders?.length > 0) {
    const p = config.localProviders[0];
    return { url: (p.url || DEFAULT_LOCAL_URL).replace(/\/$/, ""), key: p.key || '' };
  }
  return { url: (config.localUrl || DEFAULT_LOCAL_URL).replace(/\/$/, ""), key: config.localKey || '' };
}

/** Finds the key for a given provider URL. Returns empty string if not found. */
function getProviderKey(config: any, providerUrl: string): string {
  const normalized = providerUrl.replace(/\/$/, "");
  const found = (config.localProviders || []).find((p: any) =>
    (p.url || '').replace(/\/$/, "") === normalized
  );
  return found?.key || '';
}

// Router result cache — keyed by userId + prompt hash, stores routing decisions with TTL
const ROUTER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const ROUTER_CACHE_MAX = 100;
const routerCache = new Map<string, { decision: any; timestamp: number }>();

function getRouterCacheKey(userId: string, prompt: string): string {
  return userId + ':' + crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

function getCachedRoute(userId: string, prompt: string): any | null {
  const key = getRouterCacheKey(userId, prompt);
  const entry = routerCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ROUTER_CACHE_TTL) {
    routerCache.delete(key);
    return null;
  }
  return entry.decision;
}

function setCachedRoute(userId: string, prompt: string, decision: any): void {
  const key = getRouterCacheKey(userId, prompt);
  // Evict oldest if at capacity
  if (routerCache.size >= ROUTER_CACHE_MAX && !routerCache.has(key)) {
    const oldest = routerCache.keys().next().value;
    if (oldest) routerCache.delete(oldest);
  }
  routerCache.set(key, { decision, timestamp: Date.now() });
}

// SSRF protection: validate URLs before storing or fetching
const BLOCKED_HOSTS = [
  '169.254.169.254',       // AWS/GCP/Azure metadata
  'metadata.google.internal',
  'metadata.internal',
];

function validateUrl(url: string): { valid: boolean; reason?: string } {
  if (!url || url.trim() === '') return { valid: true }; // empty is ok
  try {
    const parsed = new URL(url);
    // Only allow http/https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, reason: `Invalid URL scheme "${parsed.protocol}" — only http and https are allowed` };
    }
    // Block cloud metadata endpoints
    if (BLOCKED_HOSTS.includes(parsed.hostname)) {
      return { valid: false, reason: `Blocked host "${parsed.hostname}"` };
    }
    // Block loopback to self
    const selfPort = process.env.PORT || '3000';
    const selfHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
    if (selfHosts.includes(parsed.hostname) && (parsed.port === selfPort || (!parsed.port && selfPort === '80'))) {
      return { valid: false, reason: 'URL points back to Nexus Orchestrator itself' };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: 'Malformed URL' };
  }
}

// Helper to mask API keys
function maskKey(key: string | undefined): string {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
}

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Extend Express Request to include userId and userRole
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: 'admin' | 'user';
    }
  }
}

// Middleware to protect endpoints — resolves session to userId
const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!ADMIN_API_KEY) {
    return res.status(403).json({
      error: "ADMIN_API_KEY is not configured in the environment. All API access is disabled for security until a key is set."
    });
  }

  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies['nexus_session'];

  if (sessionToken) {
    const session = getSession(sessionToken);
    if (session) {
      const user = getUserById(session.userId);
      if (user) {
        req.userId = user.id;
        req.userRole = user.role;
        return next();
      }
    }
  }

  // Fallback: x-admin-key header for API clients — look up admin user
  const headerKey = req.headers['x-admin-key'] as string;
  if (headerKey) {
    const adminUser = getUserByUsername('admin');
    if (adminUser && verifyPassword(headerKey, adminUser.passwordHash)) {
      req.userId = adminUser.id;
      req.userRole = adminUser.role;
      return next();
    }
  }

  res.status(401).json({ error: "Unauthorized: Valid session required" });
};

// Admin-only middleware — must be used after authMiddleware
const adminMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.userRole !== 'admin') {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
};

// Helper to get the user's config, falling back to defaults.
// Migration (string models → CategoryModel, localUrl → localProviders) is applied in db.ts readUserConfig.
function getUserConfig(userId: string): any {
  const stored = readUserConfig(userId, ENCRYPTION_SECRET);
  if (stored) return stored;
  // Return a deep clone of the default so callers can mutate freely
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

// Config and conversations init/migration handled by db.ts initDb()

// Pipes an upstream SSE ReadableStream reader to an Express response
async function streamSseToResponse(reader: ReadableStreamDefaultReader<Uint8Array>, res: any) {
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let dataStr = line.startsWith('data: ') ? line.slice(6) : line;
      if (dataStr.trim() === '[DONE]') continue;
      try {
        const json = JSON.parse(dataStr);
        const openaiContent = json.choices?.[0]?.delta?.content;
        const ollamaContent = json.message?.content;
        let usage = null;
        if (json.usage) {
          usage = { prompt_tokens: json.usage.prompt_tokens, completion_tokens: json.usage.completion_tokens, total_tokens: json.usage.total_tokens };
        } else if (json.prompt_eval_count !== undefined || json.eval_count !== undefined) {
          usage = { prompt_tokens: json.prompt_eval_count || 0, completion_tokens: json.eval_count || 0, total_tokens: (json.prompt_eval_count || 0) + (json.eval_count || 0) };
        }
        const content = openaiContent || ollamaContent;
        if (content || usage) res.write(JSON.stringify({ message: { content }, usage }) + '\n');
      } catch { /* skip invalid JSON */ }
    }
  }
}

interface SearchSource {
  title: string;
  url: string;
  snippet: string;
}

interface SearchResult {
  text: string;
  sources: SearchSource[];
}

// SearXNG web search helper — used by tool-calling path in handleChat
async function runSearxngSearch(searxngUrl: string, query: string): Promise<SearchResult> {
  try {
    const url = new URL('/search', searxngUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { text: `Search failed: HTTP ${res.status}`, sources: [] };
    const data = await res.json() as any;
    const raw = (data.results || []).slice(0, 5) as any[];
    const sources: SearchSource[] = raw.map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.content || r.snippet || '',
    }));
    const text = sources.length
      ? sources.map(s => `Title: ${s.title}\nURL: ${s.url}\nSnippet: ${s.snippet}`).join('\n\n')
      : 'No results found.';
    return { text, sources };
  } catch (err: any) {
    return { text: `Search error: ${err.message}`, sources: [] };
  }
}

// Per-user FIFO queue for chat requests — prevents concurrent streams from one user
// piling up and keeps the server stable under multiple simultaneous users.
const MAX_QUEUE_DEPTH = 5;

class UserChatQueue {
  private active = false;
  private pending: Array<() => Promise<void>> = [];

  get depth() { return this.pending.length + (this.active ? 1 : 0); }

  enqueue(fn: () => Promise<void>): Promise<void> {
    if (this.pending.length >= MAX_QUEUE_DEPTH) {
      return Promise.reject(new Error('Too many pending requests — try again shortly'));
    }
    return new Promise<void>((resolve, reject) => {
      this.pending.push(() => fn().then(resolve, reject));
      this.tick();
    });
  }

  private tick() {
    if (this.active || this.pending.length === 0) return;
    this.active = true;
    const fn = this.pending.shift()!;
    fn().finally(() => {
      this.active = false;
      this.tick();
    });
  }
}

const chatQueues = new Map<string, UserChatQueue>();
function getChatQueue(userId: string): UserChatQueue {
  if (!chatQueues.has(userId)) chatQueues.set(userId, new UserChatQueue());
  return chatQueues.get(userId)!;
}

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);

  app.use(express.json({ limit: '50mb' }));

  // CORS — only allow same-origin requests
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const host = req.headers.host;
    // Allow requests with no origin (same-origin, curl, etc.) or matching origin
    if (!origin || origin === `http://${host}` || origin === `https://${host}`) {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const initialConfig = await initDb(ENCRYPTION_SECRET, DEFAULT_CONFIG);

  // Bootstrap admin user from ADMIN_API_KEY if no users exist
  if (ADMIN_API_KEY) {
    bootstrapAdmin(ADMIN_API_KEY, ENCRYPTION_SECRET, DEFAULT_CONFIG);
  }

  // Clean shutdown
  process.on('SIGTERM', () => { closeDb(); process.exit(0); });
  process.on('SIGINT', () => { closeDb(); process.exit(0); });

  // ─── Auth Endpoints ───

  app.get("/api/auth/status", (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const sessionToken = cookies['nexus_session'];
    let isAuthenticated = false;
    let user = null;

    if (sessionToken) {
      const session = getSession(sessionToken);
      if (session) {
        const dbUser = getUserById(session.userId);
        if (dbUser) {
          isAuthenticated = true;
          user = { id: dbUser.id, username: dbUser.username, role: dbUser.role };
        }
      }
    }

    const settings = getAdminSettings();
    res.json({
      authRequired: !!ADMIN_API_KEY,
      isAuthenticated,
      user,
      registrationEnabled: settings.registrationEnabled || false,
    });
  });

  app.post("/api/auth/login", authLimiter, validate(loginSchema), (req, res) => {
    const { username, password } = req.body;

    const user = getUserByUsername(username);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = createSession(user.id);
    res.cookie('nexus_session', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      path: '/',
      maxAge: SESSION_MAX_AGE,
    });
    res.json({ success: true, user: { id: user.id, username: user.username, role: user.role } });
  });

  app.post("/api/auth/register", authLimiter, validate(registerSchema), (req, res) => {
    const settings = getAdminSettings();
    if (!settings.registrationEnabled) {
      return res.status(403).json({ error: "Registration is disabled. Contact an admin." });
    }

    const { username, password } = req.body;

    // Check if username already exists
    const existing = getUserByUsername(username);
    if (existing) {
      return res.status(409).json({ error: "Username already taken" });
    }

    const passwordHash = hashPassword(password);
    const user = createUser(username, passwordHash, 'user');

    // Copy admin's config as the new user's default
    const adminUser = getUserByUsername('admin');
    if (adminUser) {
      const adminConfig = readUserConfig(adminUser.id, ENCRYPTION_SECRET);
      if (adminConfig) {
        writeUserConfig(user.id, adminConfig, ENCRYPTION_SECRET);
      } else {
        writeUserConfig(user.id, DEFAULT_CONFIG, ENCRYPTION_SECRET);
      }
    } else {
      writeUserConfig(user.id, DEFAULT_CONFIG, ENCRYPTION_SECRET);
    }

    // Auto-login after registration
    const token = createSession(user.id);
    res.cookie('nexus_session', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      path: '/',
      maxAge: SESSION_MAX_AGE,
    });
    res.json({ success: true, user: { id: user.id, username: user.username, role: user.role } });
  });

  app.post("/api/auth/logout", (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const sessionToken = cookies['nexus_session'];
    if (sessionToken) deleteSession(sessionToken);
    res.clearCookie('nexus_session', { path: '/' });
    res.json({ success: true });
  });

  app.put("/api/auth/password", authMiddleware, validate(changePasswordSchema), (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const user = getUserById(req.userId!);
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    const newHash = hashPassword(newPassword);
    updateUserPassword(user.id, newHash);
    // Invalidate all sessions for this user
    deleteUserSessions(user.id);
    // Create a new session for the current request
    const token = createSession(user.id);
    res.cookie('nexus_session', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      path: '/',
      maxAge: SESSION_MAX_AGE,
    });
    res.json({ success: true });
  });

  // ─── Admin Endpoints ───

  app.get("/api/admin/users", authMiddleware, adminMiddleware, (_req, res) => {
    res.json(listUsers());
  });

  app.post("/api/admin/users", authMiddleware, adminMiddleware, validate(adminCreateUserSchema), (req, res) => {
    const { username, password, role } = req.body;

    const existing = getUserByUsername(username);
    if (existing) {
      return res.status(409).json({ error: "Username already taken" });
    }

    const passwordHash = hashPassword(password);
    const user = createUser(username, passwordHash, role);

    // Copy admin's config as new user's default
    const adminConfig = readUserConfig(req.userId!, ENCRYPTION_SECRET);
    if (adminConfig) {
      writeUserConfig(user.id, adminConfig, ENCRYPTION_SECRET);
    } else {
      writeUserConfig(user.id, DEFAULT_CONFIG, ENCRYPTION_SECRET);
    }

    res.json(user);
  });

  app.delete("/api/admin/users/:id", authMiddleware, adminMiddleware, (req, res) => {
    const targetId = req.params.id;
    if (targetId === req.userId) {
      return res.status(400).json({ error: "Cannot delete your own account" });
    }
    const target = getUserById(targetId);
    if (!target) {
      return res.status(404).json({ error: "User not found" });
    }
    deleteUserSessions(targetId);
    deleteUser(targetId);
    res.json({ success: true });
  });

  app.put("/api/admin/users/:id/reset", authMiddleware, adminMiddleware, validate(adminResetPasswordSchema), (req, res) => {
    const targetId = req.params.id;
    const target = getUserById(targetId);
    if (!target) {
      return res.status(404).json({ error: "User not found" });
    }
    const { password } = req.body;
    const newHash = hashPassword(password);
    updateUserPassword(targetId, newHash);
    deleteUserSessions(targetId);
    res.json({ success: true });
  });

  app.get("/api/admin/settings", authMiddleware, adminMiddleware, (_req, res) => {
    res.json(getAdminSettings());
  });

  app.put("/api/admin/settings", authMiddleware, adminMiddleware, (req, res) => {
    const current = getAdminSettings();
    const updated = { ...current, ...req.body };
    updateAdminSettings(updated);
    res.json(updated);
  });

  // ─── Config Endpoints (per-user) ───

  app.get("/api/config", authMiddleware, async (req, res) => {
    try {
      const config = getUserConfig(req.userId!);

      // Mask sensitive keys before sending to client
      const maskedConfig = {
        ...config,
        localKey: config.localKey ? maskKey(config.localKey) : "",
        cloudKey: config.cloudKey ? maskKey(config.cloudKey) : "",
        router: {
          ...config.router,
          key: config.router?.key ? maskKey(config.router.key) : ""
        },
        localProviders: (config.localProviders || []).map((p: any) => ({
          ...p,
          key: p.key ? maskKey(p.key) : "",
        })),
      };

      res.json(maskedConfig);
    } catch (error: any) {
      log.error({ err: error }, 'Config read error');
      res.status(500).json({ error: "Failed to read config: " + error.message });
    }
  });

  app.post("/api/config", authMiddleware, validate(configSchema), async (req, res) => {
    try {
      const newConfig = req.body;

      // Validate all URLs before saving
      const urlsToCheck = [
        { name: 'localUrl', value: newConfig.localUrl },
        { name: 'cloudUrl', value: newConfig.cloudUrl },
        { name: 'router.url', value: newConfig.router?.url },
        { name: 'searxng.url', value: newConfig.searxng?.url },
      ];
      for (const { name, value } of urlsToCheck) {
        if (value) {
          const check = validateUrl(value);
          if (!check.valid) {
            return res.status(400).json({ error: `Invalid ${name}: ${check.reason}` });
          }
        }
      }
      if (newConfig.localProviders) {
        for (let i = 0; i < newConfig.localProviders.length; i++) {
          const provUrl = newConfig.localProviders[i].url;
          if (provUrl) {
            const check = validateUrl(provUrl);
            if (!check.valid) {
              return res.status(400).json({ error: `Invalid localProviders[${i}].url: ${check.reason}` });
            }
          }
        }
      }

      log.info({ userId: req.userId }, 'Saving user configuration');

      // Read current config to preserve masked keys
      const currentConfig = getUserConfig(req.userId!);

      // If the incoming key is masked, use the current key
      if (newConfig.localKey && typeof newConfig.localKey === 'string' && (newConfig.localKey.includes("...") || newConfig.localKey === "****")) {
        newConfig.localKey = currentConfig.localKey || "";
      }
      if (newConfig.cloudKey && typeof newConfig.cloudKey === 'string' && (newConfig.cloudKey.includes("...") || newConfig.cloudKey === "****")) {
        newConfig.cloudKey = currentConfig.cloudKey || "";
      }
      if (newConfig.router && newConfig.router.key && typeof newConfig.router.key === 'string' && (newConfig.router.key.includes("...") || newConfig.router.key === "****")) {
        newConfig.router.key = currentConfig.router?.key || "";
      }
      // Restore masked keys in localProviders
      if (newConfig.localProviders) {
        for (let i = 0; i < newConfig.localProviders.length; i++) {
          const incomingKey = newConfig.localProviders[i].key;
          if (incomingKey && (incomingKey.includes("...") || incomingKey === "****")) {
            newConfig.localProviders[i].key = currentConfig.localProviders?.[i]?.key || '';
          }
        }
      }

      writeUserConfig(req.userId!, newConfig, ENCRYPTION_SECRET);

      res.json({ status: "ok" });
    } catch (error: any) {
      log.error({ err: error }, 'Config save error');
      res.status(500).json({ error: `Failed to save config: ${error.message}` });
    }
  });

  /**
   * Returns ordered probe candidates for a provider base URL.
   *
   * Cases:
   *   {base}/v1        → try {base}/v1/models only (OpenAI-compat with explicit /v1, e.g. llama-swap)
   *   {base}/api       → try {base}/api/models, then {base}/api/tags (Open WebUI style)
   *   {base}           → try {base}/v1/models, {base}/api/models, {base}/api/tags
   *
   * isOllama=true probes use the native Ollama /api/tags response format (models[]).
   * isOllama=false probes use the OpenAI format (data[]).
   */
  function buildProbeUrls(baseUrl: string): Array<{ url: string; isOllama: boolean }> {
    const base = baseUrl.replace(/\/$/, "");
    if (base.endsWith('/v1')) {
      return [{ url: `${base}/models`, isOllama: false }];
    }
    if (base.endsWith('/api')) {
      return [
        { url: `${base}/models`, isOllama: false },
        { url: `${base}/tags`, isOllama: true },
      ];
    }
    return [
      { url: `${base}/v1/models`, isOllama: false },
      { url: `${base}/api/models`, isOllama: false },
      { url: `${base}/api/tags`, isOllama: true },
    ];
  }

  // Probes a single provider URL and returns its status
  async function checkProvider(providerUrl: string, providerKey: string, providerName: string): Promise<{
    name: string; url: string; online: boolean; isOllama: boolean; message?: string;
  }> {
    let url = providerUrl;
    if (!url.startsWith('http')) url = `http://${url}`;
    url = url.replace(/\/$/, "");

    const selfPort = PORT.toString();
    if (url.includes(`localhost:${selfPort}`) || url.includes(`0.0.0.0:${selfPort}`) || url.includes(`127.0.0.1:${selfPort}`)) {
      return {
        name: providerName, url, online: false, isOllama: false,
        message: `⚠️ Provider URL points to Nexus Orchestrator itself (port ${selfPort}). Use your LLM endpoint instead.`,
      };
    }

    const headers: any = { 'User-Agent': 'NexusOrchestrator/1.0', 'Accept': 'application/json' };
    if (providerKey) headers['Authorization'] = `Bearer ${providerKey}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      log.debug({ url, name: providerName }, 'Checking provider health');

      const probes = buildProbeUrls(url);
      let response: Response | null = null;
      let isOllama = false;
      let lastStatus: number | undefined;

      for (const probe of probes) {
        response = await fetch(probe.url, { signal: controller.signal, headers }).catch(() => null);
        if (response?.ok) {
          isOllama = probe.isOllama;
          break;
        }
        lastStatus = response?.status;
        response = null;
      }

      clearTimeout(timeoutId);

      // Update Ollama detection cache
      const baseKey = url.replace(/\/$/, "");
      if (isOllama) ollamaUrls.add(baseKey); else ollamaUrls.delete(baseKey);

      if (response?.ok) {
        return { name: providerName, url, online: true, isOllama };
      }

      let tip = "";
      if (lastStatus === 405) {
        tip = " If using Open WebUI, ensure the URL ends with '/api'.";
      }
      return {
        name: providerName, url, online: false, isOllama: false,
        message: lastStatus
          ? `Provider returned ${lastStatus}.${tip}`
          : 'Network error or timeout.',
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      const isLocalhost = url.includes('localhost') || url.includes('127.0.0.1');
      let message = `Could not reach provider: ${error.message}`;
      if (isLocalhost) {
        message += " ⚠️ 'localhost' inside Docker refers to the container. Use your host's LAN IP instead.";
      }
      return { name: providerName, url, online: false, isOllama: false, message };
    }
  }

  // Health check (uses requesting user's config — checks all configured providers)
  app.get("/api/health", authMiddleware, async (req, res) => {
    try {
      const config = getUserConfig(req.userId!);
      const providers: Array<{ name: string; url: string; key: string }> = config.localProviders?.length > 0
        ? config.localProviders
        : [{ name: 'Local', url: config.localUrl || DEFAULT_LOCAL_URL, key: config.localKey || '' }];

      const results = await Promise.all(
        providers.map((p: any) => checkProvider(p.url || DEFAULT_LOCAL_URL, p.key || '', p.name || 'Local'))
      );

      const anyOnline = results.some(r => r.online);
      res.json({
        status: anyOnline ? 'connected' : 'disconnected',
        local: results[0]?.url,
        isOllama: results[0]?.isOllama,
        providers: results,
      });
    } catch (error: any) {
      log.error({ err: error }, 'Health check error');
      res.json({ status: 'disconnected', message: error.message });
    }
  });

  /** Fetches models from a single provider URL and returns them with providerUrl/providerName attached. */
  async function discoverModelsFromProvider(
    providerUrl: string, providerKey: string, providerName: string
  ): Promise<any[]> {
    let url = providerUrl;
    if (!url.startsWith('http')) url = `http://${url}`;
    url = url.replace(/\/$/, "");

    const headers: any = { 'User-Agent': 'NexusOrchestrator/1.0', 'Accept': 'application/json' };
    if (providerKey) headers['Authorization'] = `Bearer ${providerKey}`;

    const tag = { providerUrl: url, providerName };

    for (const probe of buildProbeUrls(url)) {
      const res = await fetch(probe.url, { headers }).catch(() => null);
      if (!res?.ok) continue;

      const contentType = res.headers.get("content-type");
      if (!contentType?.includes("application/json")) continue;

      const data = await res.json();

      if (probe.isOllama) {
        // Ollama native /api/tags format
        const models = (data.models || []).map((m: any) => {
          const details = m.details || {};
          const id = m.name || '';
          if (!details.parameter_size) {
            const paramMatch = id.match(/(\d+b)/i);
            if (paramMatch) details.parameter_size = paramMatch[1].toUpperCase();
          }
          if (!details.quantization_level) {
            const quantMatch = id.match(/(q\d[^\s:]*|fp\d+)/i);
            if (quantMatch) details.quantization_level = quantMatch[1].toUpperCase();
          }
          return { name: m.name, size: m.size, details, ...tag };
        });
        if (models.length > 0) return models;
      } else {
        // OpenAI /v1/models or /api/models format
        // name = m.id (the API routing key sent in requests)
        // displayName = m.name if present (human-readable label, e.g. from llama-swap)
        const models = (data.data || []).map((m: any) => {
          const id = (m.id || '').trim();
          const displayName: string | undefined = m.name && m.name !== id ? m.name : undefined;
          const details: any = { family: m.owned_by || 'openai' };
          const searchStr = displayName || id;
          const paramMatch = searchStr.match(/(\d+b)/i);
          if (paramMatch) details.parameter_size = paramMatch[1].toUpperCase();
          const quantMatch = id.match(/(q\d[^\s:]*|fp\d+)/i);
          if (quantMatch) details.quantization_level = quantMatch[1].toUpperCase();
          return { name: id, displayName, size: 0, details, ...tag };
        });
        if (models.length > 0) return models;
      }
    }

    return [];
  }

  // Get available models — aggregates from all configured local providers
  app.get("/api/models", authMiddleware, async (req, res) => {
    try {
      const config = getUserConfig(req.userId!);
      const providers: Array<{ name: string; url: string; key: string }> = config.localProviders?.length > 0
        ? config.localProviders
        : [{ name: 'Local', url: config.localUrl || DEFAULT_LOCAL_URL, key: config.localKey || '' }];

      const results = await Promise.allSettled(
        providers.map((p: any) =>
          discoverModelsFromProvider(p.url || DEFAULT_LOCAL_URL, p.key || '', p.name || 'Local')
        )
      );

      const allModels: any[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          allModels.push(...result.value);
        }
      }

      if (allModels.length === 0 && providers.length > 0) {
        // All providers failed — surface the error rather than empty array
        res.status(502).json({ error: 'No models found. Verify your provider URLs and connectivity.' });
        return;
      }

      res.json(allModels);
    } catch (error: any) {
      log.error({ err: error }, 'Model fetch error');
      res.status(500).json({ error: `Connection failed: ${error.message}` });
    }
  });

  // Router Proxy Endpoint (uses requesting user's config)
  app.post("/api/router", authMiddleware, apiLimiter, validate(routerSchema), async (req, res) => {
    const { prompt } = req.body;
    try {
      const config = getUserConfig(req.userId!);

      // Check cache if enabled
      if (config.routerCacheEnabled) {
        const cached = getCachedRoute(req.userId!, prompt);
        if (cached) {
          log.info({ category: cached.category, model: cached.model }, 'Router cache hit');
          return res.json({ ...cached, cached: true });
        }
      }
      const { router } = config;

      // Determine URL and Key for routing
      let url = router.url;
      let key = router.key;

      // Fallback logic: if no custom router URL, always use first local provider
      if (!url) {
        const first = getFirstLocalProvider(config);
        url = first.url;
        key = router.key || first.key;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

      try {
        let fullUrl = url.replace(/\/$/, "");
        // If the user provided a full path, don't append /v1/chat/completions
        if (!fullUrl.endsWith('/chat/completions')) {
          if (!fullUrl.endsWith('/v1')) {
            fullUrl += '/v1';
          }
          fullUrl += '/chat/completions';
        }

        log.info({ url: fullUrl, model: router.model }, 'Router routing request');

        const response = await fetch(fullUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': key ? `Bearer ${key}` : ''
          },
          body: JSON.stringify({
            model: router.model,
            messages: [
              { role: 'system', content: 'You are a routing orchestrator. You must respond with valid JSON ONLY. Structure: {"category": "...", "model": "...", "provider": "...", "reasoning": "...", "confidence": 0.0-1.0}' },
              { role: 'user', content: prompt }
            ],
          }),
          signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const errText = await response.text();
          const statusInfo = `${response.status} ${response.statusText}`;

          let errorMessage = `Router provider error (${statusInfo}): ${errText || 'No error body'}`;

          if (response.status === 404) {
            errorMessage = `Router Model Not Found (404). Ensure the model ID "${router.model}" is correct and available at ${fullUrl}.`;
          } else if (response.status === 400) {
            errorMessage = `Router Invalid Request (400). The model ID "${router.model}" might be incorrect. For OpenRouter, use formats like "google/gemini-flash-1.5". Details: ${errText}`;
          } else if (response.status === 401 || response.status === 403) {
            errorMessage = `Router Authentication Error (${response.status}). Check your API Key for the router.`;
          } else if (response.status === 429) {
            errorMessage = `Router Quota Exceeded (429). Your OpenAI/Provider quota has been reached. Consider switching to your local "nexus.model-router" to avoid costs and limits.`;
          }

          throw new Error(errorMessage);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;
        const usage = data.usage;

        try {
          // Attempt to parse the content as JSON
          // Sometimes models wrap JSON in markdown blocks
          const jsonStr = content.replace(/```json\n?|```/g, '').trim();
          const parsed = JSON.parse(jsonStr);

          // Add router metadata to the response
          parsed.routerModel = router.model;
          if (usage) {
            parsed.usage = {
              prompt_tokens: usage.prompt_tokens,
              completion_tokens: usage.completion_tokens,
              total_tokens: usage.total_tokens
            };
          }

          if (config.routerCacheEnabled) {
            setCachedRoute(req.userId!, prompt, parsed);
          }
          res.json(parsed);
        } catch (parseErr) {
          log.error({ content }, 'Router returned invalid JSON');
          throw new Error("Router model returned invalid JSON format. Ensure the model is capable of JSON output.");
        }
      } catch (fetchErr: any) {
        if (fetchErr.name === 'AbortError') {
          throw new Error("Router request timed out after 30 seconds.");
        }
        throw fetchErr;
      }
    } catch (error: any) {
      log.error({ err: error }, 'Router error');
      res.status(500).json({ error: error.message });
    }
  });

  // Main Chat Routing Endpoint (uses requesting user's config)
  app.post("/api/chat", authMiddleware, apiLimiter, validate(chatSchema), async (req, res) => {
    const { messages, decision } = req.body;
    const queue = getChatQueue(req.userId!);

    let cancelled = false;
    req.on('close', () => { cancelled = true; });

    try {
      await queue.enqueue(async () => {
        if (cancelled) return;
        try {
          await handleChat(req, res, messages, decision);
        } catch (error: any) {
          log.error({ err: error }, 'Chat routing error');
          if (!res.headersSent) {
            res.status(500).json({ error: error.message, tip: "Ensure your provider is running and accessible." });
          }
        }
      });
    } catch (err: any) {
      log.warn({ userId: req.userId, depth: queue.depth }, 'Chat queue full');
      res.status(503).json({ error: err.message });
    }
  });

  async function handleChat(req: any, res: any, messages: any, decision: any) {
    try {
      const config = getUserConfig(req.userId!);

      // Determine base provider URL and key for the primary model
      let baseUrl: string;
      let apiKey: string;

      if (decision.provider === 'cloud' || decision.provider === 'gemini') {
        baseUrl = config.cloudUrl || config.router.url;
        apiKey = config.cloudKey || config.router.key;
      } else if (decision.providerUrl) {
        baseUrl = decision.providerUrl;
        apiKey = getProviderKey(config, decision.providerUrl);
      } else {
        const first = getFirstLocalProvider(config);
        baseUrl = first.url;
        apiKey = first.key;
      }

      log.info({ model: decision.model, category: decision.category, provider: baseUrl }, 'Routing chat request');

      // Per-attempt timeout: how long a single fetch may wait (covers slow model loads/swaps).
      // Providers like llama-swap can take several minutes to unload one model and load another.
      // Override with CHAT_TIMEOUT_MS env var (milliseconds).
      const attemptTimeoutMs = parseInt(process.env.CHAT_TIMEOUT_MS || '', 10) || 300000; // 5 min default

      const controller = new AbortController();
      // Overall timeout covers all model attempts — 4× the per-attempt value
      const timeoutId = setTimeout(() => controller.abort(), attemptTimeoutMs * 4);

      // Headers will be mutated per model attempt to set the correct Authorization
      const headers: any = {
        "Content-Type": "application/json",
        "User-Agent": "NexusOrchestrator/1.0",
        "Accept": "application/json"
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      let fullUrl = baseUrl.replace(/\/$/, "");

      const getEndpoints = (base: string) => {
        const endpoints = [];
        const cleanBase = base.replace(/\/$/, "");

        // If user provided a full endpoint, use it as-is
        if (cleanBase.endsWith('/chat/completions') || cleanBase.endsWith('/completions') || cleanBase.endsWith('/generate') || cleanBase.endsWith('/api/chat')) {
          endpoints.push(cleanBase);
          return endpoints;
        }

        // Confirmed Ollama instance — use native /api/chat exclusively for proper abort support
        if (ollamaUrls.has(cleanBase)) {
          endpoints.push(`${cleanBase}/api/chat`);
          return endpoints;
        }

        // Gemini special case
        if (cleanBase.includes('generativelanguage.googleapis.com')) {
          endpoints.push(`${cleanBase}/chat/completions`);
          return endpoints;
        }

        // Standard OpenAI path
        if (cleanBase.includes('/v1')) {
          endpoints.push(`${cleanBase}/chat/completions`);
          endpoints.push(`${cleanBase}/chat/completions/`);
        } else {
          endpoints.push(`${cleanBase}/v1/chat/completions`);
          endpoints.push(`${cleanBase}/v1/chat/completions/`);
          if (!cleanBase.endsWith('/api')) {
            endpoints.push(`${cleanBase}/api/v1/chat/completions`);
            endpoints.push(`${cleanBase}/api/chat/completions`);
          }
          endpoints.push(`${cleanBase}/api/chat`);
          endpoints.push(`${cleanBase}/chat/completions`);
          endpoints.push(`${cleanBase}/chat/completions/`);
        }
        return endpoints;
      };

      const hasAttachments = messages.some((m: any) => m.attachments && m.attachments.length > 0);

      // Build ordered list of { model, baseUrl, apiKey } to try — each fallback may come from a different provider
      const buildModelsToTry = (): Array<{ model: string; baseUrl: string; apiKey: string }> => {
        const result: Array<{ model: string; baseUrl: string; apiKey: string }> = [];
        if (decision.model) result.push({ model: decision.model, baseUrl, apiKey });
        (decision.fallbackModels || []).forEach((m: string, i: number) => {
          if (!m) return;
          const fbUrl = decision.fallbackProviderUrls?.[i] || baseUrl;
          const fbKey = decision.provider === 'cloud' || decision.provider === 'gemini'
            ? apiKey
            : getProviderKey(config, fbUrl) || apiKey;
          result.push({ model: m, baseUrl: fbUrl, apiKey: fbKey });
        });
        return result;
      };
      const modelsToTry = buildModelsToTry();

      // Web search tool calling — enabled when searxng is configured and not FAST category
      const searxngUrl = config.searxng?.url || '';
      const searchEnabled = !!(
        (req.body.webSearchEnabled || config.searxng?.alwaysOn) &&
        searxngUrl &&
        decision.category !== 'FAST'
      );

      const webSearchTool = {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the web for current information, news, or facts using SearXNG.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'The search query' }
            },
            required: ['query']
          }
        }
      };

      let response: any = null;
      let lastError: any = null;

      for (let modelIdx = 0; modelIdx < modelsToTry.length; modelIdx++) {
        const { model: currentModel, baseUrl: modelBaseUrl, apiKey: modelApiKey } = modelsToTry[modelIdx];
        const candidateUrls = getEndpoints(modelBaseUrl);
        const loadingRetries = new Map<string, number>();

        // Update Authorization for this model's provider
        if (modelApiKey) {
          headers['Authorization'] = `Bearer ${modelApiKey}`;
        } else {
          delete headers['Authorization'];
        }

        if (modelIdx > 0) {
          log.info({ failedModel: modelsToTry[modelIdx - 1].model, nextModel: currentModel, attempt: modelIdx + 1, total: modelsToTry.length }, 'Falling back to next model in pool');
        }

        let urlIndex = 0;
        while (urlIndex < candidateUrls.length) {
          const url = candidateUrls[urlIndex];
          log.debug({ url, model: currentModel }, 'Attempting route');
          try {
            const attemptController = new AbortController();
            const attemptTimeout = setTimeout(() => attemptController.abort(), attemptTimeoutMs);

            const attempt = await fetch(url, {
              method: "POST",
              headers,
              body: JSON.stringify({
                model: currentModel,
                messages: messages.map((m: any) => {
                  let content = m.content || "";
                  const msg: any = { role: m.role, content };

                  // Handle image attachments for vision models
                  if (m.attachments && m.attachments.length > 0) {
                    const images = m.attachments
                      .filter((a: any) => a.type.startsWith('image/'))
                      .map((a: any) => {
                        // Extract base64 part from data URL
                        if (a.content && a.content.includes(',')) {
                          return a.content.split(',')[1];
                        }
                        return a.content;
                      });

                    if (images.length > 0) {
                      const isOllamaNative = url.endsWith('/api/chat');
                      if (isOllamaNative) {
                        // Ollama native /api/chat: string content + images array
                        msg.images = images;
                        msg.content = m.content || "Analyze this image";
                      } else if (m.role === 'user') {
                        // OpenAI-compat /v1/chat/completions: content as array of parts
                        msg.content = [
                          { type: 'text', text: m.content || "Analyze this image" },
                          ...images.map((img: string) => ({
                            type: 'image_url',
                            image_url: { url: `data:image/jpeg;base64,${img}` }
                          }))
                        ];
                      }
                    }
                  }
                  return msg;
                }),
                stream: !searchEnabled,
                ...(searchEnabled ? { tools: [webSearchTool], tool_choice: 'auto' } : { stream_options: { include_usage: true } })
              }),
              signal: attemptController.signal,
            });

            clearTimeout(attemptTimeout);

            if (attempt.ok) {
              log.info({ url, model: currentModel }, 'Successfully routed');
              response = attempt;
              fullUrl = url;
              break;
            }

            // Read error body for logging (this consumes the stream — do NOT use attempt.body after this)
            const errText = await attempt.text().catch(() => "");
            log.warn({ url, model: currentModel, status: attempt.status, body: errText.slice(0, 100) }, 'Route attempt failed');

            // Always track the most informative error (prefer non-404/405/abort errors)
            const isLastErrorWeak = !lastError || lastError.status === 404 || lastError.status === 405 || !lastError.status;
            if (isLastErrorWeak) {
              lastError = { status: attempt.status, text: errText };
            }

            if (attempt.status === 405 || attempt.status === 404) {
              urlIndex++;
              continue;
            }

            // If model is still loading, wait and retry the same URL.
            // Providers like llama-swap can take 1–3 min to swap models; use progressive waits.
            if (attempt.status === 500 && (errText.includes("loading model") || errText.includes("model loading"))) {
              const retries = (loadingRetries.get(url) || 0) + 1;
              loadingRetries.set(url, retries);
              if (retries <= 5) {
                const waitMs = retries * 30000; // 30s, 60s, 90s, 120s, 150s
                log.info({ url, retry: retries, waitMs }, 'Model loading — waiting before retry');
                await new Promise(resolve => setTimeout(resolve, waitMs));
                continue; // retry same URL — don't increment urlIndex
              }
            }

            // For other errors (401, 500, etc.), stop trying this model — move to next fallback
            break;
          } catch (err: any) {
            if (err.name === 'AbortError') {
              log.warn({ url, model: currentModel }, 'Route timed out or was aborted');
            } else {
              log.error({ url, model: currentModel, err }, 'Fetch failed');
            }
            if (!lastError || !lastError.status || err.name !== 'AbortError') {
              lastError = err;
            }
            urlIndex++;
            continue;
          }
        }

        if (response) break; // Success — stop trying more models
      }

      clearTimeout(timeoutId);

      if (!response) {
        let tip = "";
        const status = lastError?.status;
        const isAbort = !status && (lastError?.name === 'AbortError' || lastError?.message?.includes('aborted'));
        const isVision = decision.category === 'VISION';
        if (status === 405) {
          tip = " \n\n💡 TIP: 'Method Not Allowed' (405) means the URL path is incorrect. Ensure your Provider URL is correct (e.g., add '/api' for Open WebUI).";
        } else if (status === 404) {
          tip = " \n\n💡 TIP: 'Not Found' (404) means the endpoint doesn't exist. Double check your Provider URL.";
        } else if (status === 500) {
          const bodyText = lastError?.text || "";
          if (bodyText.includes("loading model") || bodyText.includes("model loading")) {
            tip = " \n\n💡 TIP: The model is still loading. Wait a moment and try again.";
          } else {
            tip = " \n\n💡 TIP: Provider returned a server error (500). Check your provider logs.";
          }
        } else if (isAbort) {
          tip = isVision
            ? " \n\n💡 TIP: Vision/large models can take time to load. Wait a moment and try again — Ollama may still be loading the model into memory."
            : " \n\n💡 TIP: Request timed out. Please verify your local provider is active and the model is loaded.";
        }
        const modelsTriedStr = modelsToTry.length > 1 ? ` Tried models: ${modelsToTry.map(m => m.model).join(', ')}.` : '';
        throw new Error(`Failed to connect to any provider endpoint.${modelsTriedStr} Last error (${status || 'Fetch Failed'}): ${lastError?.text || lastError?.message || 'Unknown error'}${tip}`);
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      if (searchEnabled) {
        // --- Tool-calling path ---
        // First response is non-streaming; check for tool_calls before streaming final reply.
        const firstJson = await response.json() as any;
        const isOllamaNative = fullUrl.endsWith('/api/chat');

        const toolCalls = firstJson.choices?.[0]?.message?.tool_calls
          || firstJson.message?.tool_calls;

        if (toolCalls?.length && toolCalls[0].function?.name === 'web_search') {
          const rawArgs = toolCalls[0].function.arguments;
          const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
          const query: string = args.query || '';
          log.info({ query, userId: req.userId }, 'web_search tool call — querying SearXNG');

          // Notify the client that a search is in progress
          res.write(JSON.stringify({ searching: true, query }) + '\n');

          const { text: searchResults, sources } = await runSearxngSearch(searxngUrl, query);

          // Send structured sources to client for display
          if (sources.length > 0) {
            res.write(JSON.stringify({ sources }) + '\n');
          }

          // Build messages for the follow-up streaming request
          const assistantToolMsg = isOllamaNative
            ? { role: 'assistant', content: '', tool_calls: toolCalls }
            : { role: 'assistant', content: null, tool_calls: toolCalls };

          const toolResultMsg = isOllamaNative
            ? { role: 'tool', content: searchResults }
            : { role: 'tool', tool_call_id: toolCalls[0].id || 'search_0', content: searchResults };

          // Re-build messages with tool exchange appended
          const followUpMessages = [...messages.map((m: any) => {
            const isOllamaNativeUrl = fullUrl.endsWith('/api/chat');
            let content = m.content || '';
            const msg: any = { role: m.role, content };
            if (m.attachments?.length > 0) {
              const images = m.attachments.filter((a: any) => a.type.startsWith('image/')).map((a: any) =>
                a.content?.includes(',') ? a.content.split(',')[1] : a.content
              );
              if (images.length > 0) {
                if (isOllamaNativeUrl) {
                  msg.images = images;
                } else if (m.role === 'user') {
                  msg.content = [
                    { type: 'text', text: m.content || '' },
                    ...images.map((img: string) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img}` } }))
                  ];
                }
              }
            }
            return msg;
          }), assistantToolMsg, toolResultMsg];

          // Make the follow-up streaming request
          const followUpController = new AbortController();
          const followUpTimeout = setTimeout(() => followUpController.abort(), 90000);
          const followUpRes = await fetch(fullUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: decision.model,
              messages: followUpMessages,
              stream: true,
              stream_options: { include_usage: true }
            }),
            signal: followUpController.signal,
          });
          clearTimeout(followUpTimeout);

          if (!followUpRes.ok || !followUpRes.body) {
            throw new Error(`Search follow-up request failed: ${followUpRes.status}`);
          }

          const reader = followUpRes.body.getReader();
          req.on('close', () => { reader.cancel().catch(() => {}); });
          await streamSseToResponse(reader, res);
        } else {
          // Model responded without using the tool — write content directly as SSE
          const content = firstJson.choices?.[0]?.message?.content || firstJson.message?.content || '';
          if (content) res.write(JSON.stringify({ message: { content } }) + '\n');
        }
      } else {
        // --- Normal streaming path ---
        if (response.body) {
          const reader = response.body.getReader();

          // Propagate client disconnect to the upstream provider (stops Ollama generation)
          req.on('close', () => {
            reader.cancel().catch(() => {});
          });

          await streamSseToResponse(reader, res);
        }
      }
      res.end();

    } catch (error: any) {
      log.error({ err: error }, 'Chat routing error');
      if (!res.headersSent) {
        res.status(500).json({
          error: error.message,
          tip: "Ensure your provider is running and accessible."
        });
      }
    }
  }

  // Full export — all conversations with all messages (for backup/export, user-scoped)
  app.get("/api/conversations/export", authMiddleware, (req, res) => {
    try {
      res.json(listConversations(req.userId!));
    } catch (error: any) {
      log.error({ err: error }, 'Error exporting conversations');
      res.status(500).json({ error: "Failed to export conversations" });
    }
  });

  // Conversations Endpoints (user-scoped)
  app.get("/api/conversations", authMiddleware, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;

      // If no pagination params, return legacy full list for backwards compat
      if (!req.query.limit && !req.query.offset) {
        return res.json(listConversations(req.userId!));
      }

      const result = listConversationsPaginated(limit, offset, req.userId!);
      res.json(result);
    } catch (error: any) {
      log.error({ err: error }, 'Error fetching conversations');
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  // Single conversation with full messages
  app.get("/api/conversations/:id", authMiddleware, async (req, res) => {
    try {
      const conv = getConversation(req.params.id, req.userId!);
      if (!conv) return res.status(404).json({ error: "Conversation not found" });
      res.json(conv);
    } catch (error: any) {
      log.error({ err: error }, 'Error fetching conversation');
      res.status(500).json({ error: "Failed to fetch conversation" });
    }
  });

  app.post("/api/conversations", authMiddleware, validate(createConversationSchema), async (req, res) => {
    try {
      const { title, messages } = req.body;
      const newConversation = createConv(title || "New Conversation", messages || [], req.userId!);
      res.json(newConversation);
    } catch (error: any) {
      log.error({ err: error }, 'Error creating conversation');
      res.status(500).json({ error: "Failed to create conversation" });
    }
  });

  app.put("/api/conversations/:id", authMiddleware, validate(updateConversationSchema), async (req, res) => {
    try {
      const { id } = req.params;
      const { title, messages } = req.body;
      const updated = updateConv(id, req.userId!, { title, messages });
      if (!updated) return res.status(404).json({ error: "Conversation not found" });
      res.json(updated);
    } catch (error: any) {
      log.error({ err: error }, 'Error updating conversation');
      res.status(500).json({ error: "Failed to update conversation" });
    }
  });

  app.delete("/api/conversations/:id", authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      deleteConv(id, req.userId!);
      res.json({ success: true });
    } catch (error: any) {
      log.error({ err: error }, 'Error deleting conversation');
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  });

  // ─── Projects (user-scoped) ───

  app.get("/api/projects", authMiddleware, (req, res) => {
    try {
      res.json(listProjects(req.userId!));
    } catch (error: any) {
      log.error({ err: error }, 'Error listing projects');
      res.status(500).json({ error: "Failed to list projects" });
    }
  });

  app.post("/api/projects", authMiddleware, validate(createProjectSchema), (req, res) => {
    try {
      const { name } = req.body;
      res.json(createProject(name, req.userId!));
    } catch (error: any) {
      log.error({ err: error }, 'Error creating project');
      res.status(500).json({ error: "Failed to create project" });
    }
  });

  app.put("/api/projects/:id", authMiddleware, validate(updateProjectSchema), (req, res) => {
    try {
      const result = updateProject(req.params.id, req.userId!, req.body);
      if (!result) return res.status(404).json({ error: "Project not found" });
      res.json(result);
    } catch (error: any) {
      log.error({ err: error }, 'Error updating project');
      res.status(500).json({ error: "Failed to update project" });
    }
  });

  app.delete("/api/projects/:id", authMiddleware, (req, res) => {
    try {
      const deleteChats = req.query.deleteChats === 'true';
      deleteProject(req.params.id, req.userId!, deleteChats);
      res.json({ success: true });
    } catch (error: any) {
      log.error({ err: error }, 'Error deleting project');
      res.status(500).json({ error: "Failed to delete project" });
    }
  });

  app.patch("/api/conversations/:id/project", authMiddleware, validate(assignConversationSchema), (req, res) => {
    try {
      const { projectId } = req.body;
      const ok = assignConversation(req.params.id, projectId, req.userId!);
      if (!ok) return res.status(403).json({ error: "Project not found or access denied" });
      res.json({ success: true });
    } catch (error: any) {
      log.error({ err: error }, 'Error assigning conversation to project');
      res.status(500).json({ error: "Failed to assign conversation" });
    }
  });

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    log.info({ port: PORT }, 'Nexus Orchestrator active');
  });
}

startServer();
