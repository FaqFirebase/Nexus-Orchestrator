import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import log from "./logger.js";
import { initDb, readConfig, writeConfig, listConversations, listConversationsPaginated, getConversation, createConv, updateConv, deleteConv, listProjects, createProject, updateProject, deleteProject, assignConversation, close as closeDb } from "./db.js";
import { validate, loginSchema, configSchema, routerSchema, chatSchema, createConversationSchema, updateConversationSchema, createProjectSchema, updateProjectSchema, assignConversationSchema } from "./validation.js";

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

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Default configuration
const DEFAULT_CONFIG = {
  localUrl: process.env.LOCAL_URL || "http://localhost:11434",
  localKey: process.env.LOCAL_KEY || "",
  cloudUrl: process.env.CLOUD_URL || process.env.CLOUD_API_URL || "",
  cloudKey: process.env.CLOUD_KEY || process.env.CLOUD_API_KEY || process.env.GEMINI_API_KEY || "",
  router: {
    provider: 'openai' as 'openai',
    model: process.env.ROUTER_MODEL || '',
    url: process.env.ROUTER_URL || '',
    key: process.env.ROUTER_KEY || ''
  },
  categories: {
    CODING: {
      models: [],
      provider: 'local'
    },
    REASONING: {
      models: [],
      provider: 'local'
    },
    CREATIVE: {
      models: [],
      provider: 'local'
    },
    VISION: {
      models: [],
      provider: 'local'
    },
    GENERAL: {
      models: [],
      provider: 'local'
    },
    DOCUMENT: {
      models: [],
      provider: 'local'
    },
    FAST: {
      models: [],
      provider: 'local'
    },
    SECURITY: {
      models: [],
      provider: 'local'
    }
  }
};

let LOCAL_URL = DEFAULT_CONFIG.localUrl;
let LOCAL_KEY = DEFAULT_CONFIG.localKey;
let CLOUD_URL = DEFAULT_CONFIG.cloudUrl;
let CLOUD_KEY = DEFAULT_CONFIG.cloudKey;

// Tracks which base URLs are confirmed Ollama instances (detected via /api/tags during health check)
const ollamaUrls = new Set<string>();

// Router result cache — keyed by prompt hash, stores routing decisions with TTL
const ROUTER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const ROUTER_CACHE_MAX = 100;
const routerCache = new Map<string, { decision: any; timestamp: number }>();

function getRouterCacheKey(prompt: string): string {
  return crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

function getCachedRoute(prompt: string): any | null {
  const key = getRouterCacheKey(prompt);
  const entry = routerCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ROUTER_CACHE_TTL) {
    routerCache.delete(key);
    return null;
  }
  return entry.decision;
}

function setCachedRoute(prompt: string, decision: any): void {
  const key = getRouterCacheKey(prompt);
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

function updateGlobalVars(config: any) {
  if (config.localUrl) {
    LOCAL_URL = config.localUrl;
    if (!LOCAL_URL.startsWith('http')) LOCAL_URL = `http://${LOCAL_URL}`;
    LOCAL_URL = LOCAL_URL.replace(/\/$/, "");
  }
  if (config.localKey !== undefined) LOCAL_KEY = config.localKey;
  if (config.cloudUrl) {
    CLOUD_URL = config.cloudUrl;
    CLOUD_URL = CLOUD_URL.replace(/\/$/, "");
  }
  if (config.cloudKey !== undefined) CLOUD_KEY = config.cloudKey;
  
  log.info({ localUrl: LOCAL_URL, cloudUrl: CLOUD_URL }, 'Configuration updated');
}

// Helper to mask API keys
function maskKey(key: string | undefined): string {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
}

// Encryption functions moved to crypto.ts, storage moved to db.ts

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

// Middleware to protect admin endpoints
const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!ADMIN_API_KEY) {
    return res.status(403).json({
      error: "ADMIN_API_KEY is not configured in the environment. All API access is disabled for security until a key is set."
    });
  }

  // Check httpOnly cookie first, then fall back to header (for API clients)
  const cookies = parseCookies(req.headers.cookie);
  const providedKey = cookies['nexus_session'] || (req.headers['x-admin-key'] as string);

  if (providedKey && safeEqual(providedKey, ADMIN_API_KEY)) {
    return next();
  }

  res.status(401).json({ error: "Unauthorized: Admin API Key required" });
};

// Config and conversations init/migration handled by db.ts initDb()

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
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const initialConfig = await initDb(ENCRYPTION_SECRET, DEFAULT_CONFIG);
  updateGlobalVars(initialConfig);

  // Clean shutdown
  process.on('SIGTERM', () => { closeDb(); process.exit(0); });
  process.on('SIGINT', () => { closeDb(); process.exit(0); });

  // Auth status — only reveals if auth is required, not implementation details
  app.get("/api/auth/status", (req, res) => {
    // Check if already authenticated via cookie
    const cookies = parseCookies(req.headers.cookie);
    const sessionKey = cookies['nexus_session'];
    const isAuthenticated = !!(sessionKey && ADMIN_API_KEY && safeEqual(sessionKey, ADMIN_API_KEY));

    res.json({
      authRequired: !!ADMIN_API_KEY,
      isAuthenticated,
    });
  });

  // Login — validate key, set httpOnly cookie
  app.post("/api/auth/login", authLimiter, validate(loginSchema), (req, res) => {
    const { key } = req.body;
    if (!key || !ADMIN_API_KEY) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    if (!safeEqual(key, ADMIN_API_KEY)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    res.cookie('nexus_session', key, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    res.json({ success: true });
  });

  // Logout — clear session cookie
  app.post("/api/auth/logout", (req, res) => {
    res.clearCookie('nexus_session', { path: '/' });
    res.json({ success: true });
  });

  // Config endpoints
  app.get("/api/config", authMiddleware, async (req, res) => {
    try {
      const config = readConfig(ENCRYPTION_SECRET) || DEFAULT_CONFIG;

      // Mask sensitive keys before sending to client
      const maskedConfig = {
        ...config,
        localKey: config.localKey ? maskKey(config.localKey) : "",
        cloudKey: config.cloudKey ? maskKey(config.cloudKey) : "",
        router: {
          ...config.router,
          key: config.router?.key ? maskKey(config.router.key) : ""
        }
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
      ];
      for (const { name, value } of urlsToCheck) {
        if (value) {
          const check = validateUrl(value);
          if (!check.valid) {
            return res.status(400).json({ error: `Invalid ${name}: ${check.reason}` });
          }
        }
      }

      log.info('Saving configuration');

      // Read current config to preserve masked keys
      const currentConfig = readConfig(ENCRYPTION_SECRET) || {};

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

      writeConfig(newConfig, ENCRYPTION_SECRET);

      try {
        updateGlobalVars(newConfig);
      } catch (varError: any) {
        log.warn({ err: varError }, 'Configuration saved but failed to update global variables');
      }

      res.json({ status: "ok" });
    } catch (error: any) {
      log.error({ err: error }, 'Config save error');
      res.status(500).json({ error: `Failed to save config: ${error.message}` });
    }
  });

  // Health check
  app.get("/api/health", authMiddleware, async (req, res) => {
    try {
      // Prevent self-reference loops
      const selfPort = PORT.toString();
      if (LOCAL_URL.includes(`localhost:${selfPort}`) || LOCAL_URL.includes(`0.0.0.0:${selfPort}`) || LOCAL_URL.includes(`127.0.0.1:${selfPort}`)) {
        return res.json({
          status: "disconnected",
          local: LOCAL_URL,
          message: `⚠️ Provider URL is pointing to the Nexus Orchestrator itself (port ${selfPort}). Please update the Provider URL in the Models tab to your actual local LLM endpoint.`
        });
      }

      log.debug({ url: LOCAL_URL }, 'Checking health');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      
      const headers: any = {
        'User-Agent': 'NexusOrchestrator/1.0',
        'Accept': 'application/json'
      };
      if (LOCAL_KEY) {
        headers['Authorization'] = `Bearer ${LOCAL_KEY}`;
      }

      // Helper to construct clean API URLs
      const getApiUrl = (baseUrl: string, endpoint: string) => {
        let url = baseUrl.replace(/\/$/, "");
        if (url.endsWith('/api')) {
          return `${url}/${endpoint}`;
        }
        return `${url}/api/${endpoint}`;
      };

      // Try OpenAI/Open WebUI models endpoint first
      let response = await fetch(getApiUrl(LOCAL_URL, 'models'), { 
        signal: controller.signal,
        headers
      }).catch(err => {
        if (err.name !== 'AbortError') {
          log.debug({ url: LOCAL_URL, err: err.message }, 'Could not reach models endpoint');
        }
        return null;
      });

      // If that fails or 404s/405s, try Ollama's native tags endpoint
      let isOllama = false;
      if (!response || response.status === 404 || response.status === 405) {
        response = await fetch(getApiUrl(LOCAL_URL, 'tags'), {
          signal: controller.signal,
          headers
        }).catch(err => {
          if (err.name !== 'AbortError') {
            log.debug({ url: LOCAL_URL, err: err.message }, 'Could not reach tags endpoint');
          }
          return null;
        });
        if (response && response.ok) isOllama = true;
      }

      clearTimeout(timeoutId);

      // Cache Ollama detection so chat endpoint can use native /api/chat
      const baseKey = LOCAL_URL.replace(/\/$/, "");
      if (isOllama) {
        ollamaUrls.add(baseKey);
      } else {
        ollamaUrls.delete(baseKey);
      }

      if (response && response.ok) {
        res.json({ status: "connected", local: LOCAL_URL, isOllama });
      } else if (response) {
        const text = await response.text().catch(() => "No body");
        log.warn({ status: response.status, statusText: response.statusText, body: text }, 'Local provider health check failed');
        
        let tip = "";
        if (response.status === 405) {
          tip = " \n\n💡 TIP: 'Method Not Allowed' (405) often means the URL path is incorrect. If using Open WebUI, ensure your URL ends with '/api'.";
        }

        res.json({ 
          status: "error", 
          local: LOCAL_URL, 
          message: `Provider returned ${response.status}: ${response.statusText}.${tip}` 
        });
      } else {
        throw new Error("Network error or timeout. Ensure the URL is correct and the service is running.");
      }
    } catch (error: any) {
      log.error({ url: LOCAL_URL, err: error }, 'Health check error');
      const isLocalhost = LOCAL_URL.includes('localhost') || LOCAL_URL.includes('127.0.0.1');
      const isLocalIp = LOCAL_URL.includes('192.168.') || LOCAL_URL.includes('10.') || LOCAL_URL.includes('172.');
      
      let message = `Could not reach provider: ${error.message}`;
      if (isLocalhost) {
        message += " \n\n⚠️ CRITICAL: 'localhost' refers to the Nexus Orchestrator container itself. You must use your host's IP address (e.g., 192.168.1.x) or 'host.docker.internal' if configured.";
      } else if (isLocalIp) {
        message += " \n\n⚠️ TIP: If this app is hosted in the cloud, it cannot reach your home network directly. Use a tunnel (Ngrok/Cloudflare).";
      }
      
      res.json({ 
        status: "disconnected", 
        local: LOCAL_URL, 
        message
      });
    }
  });

  // Get available models
  app.get("/api/models", authMiddleware, async (req, res) => {
    try {
      const headers: any = { 
        'User-Agent': 'NexusOrchestrator/1.0',
        'Accept': 'application/json'
      };
      if (LOCAL_KEY) {
        headers['Authorization'] = `Bearer ${LOCAL_KEY}`;
      }

      const getApiUrl = (baseUrl: string, endpoint: string) => {
        let url = baseUrl.replace(/\/$/, "");
        if (url.endsWith('/api')) {
          return `${url}/${endpoint}`;
        }
        return `${url}/api/${endpoint}`;
      };

      // Try OpenAI/Open WebUI format first
      let response = await fetch(getApiUrl(LOCAL_URL, 'models'), { headers });
      
      if (response.ok) {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const data = await response.json();
          const models = data.data?.map((m: any) => {
            const id = m.id || '';
            const details: any = { family: m.owned_by || 'openai' };
            
            // Extract parameter size (e.g., 7b, 13b)
            const paramMatch = id.match(/(\d+b)/i);
            if (paramMatch) details.parameter_size = paramMatch[1].toUpperCase();
            
            // Extract quantization (e.g., q4, q4_k_m, fp16)
            const quantMatch = id.match(/(q\d[^\s:]*|fp\d+)/i);
            if (quantMatch) details.quantization_level = quantMatch[1].toUpperCase();

            return {
              name: id,
              size: 0,
              details
            };
          }) || [];
          return res.json(models);
        }
      }

      // Fallback to Ollama native tags
      response = await fetch(getApiUrl(LOCAL_URL, 'tags'), { headers });
      if (response.ok) {
        const data = await response.json();
        const models = data.models?.map((m: any) => {
          const details = m.details || {};
          
          // If details are missing, try to extract from name (common if proxying)
          if (!details.parameter_size || !details.quantization_level) {
            const id = m.name || '';
            const paramMatch = id.match(/(\d+b)/i);
            if (paramMatch && !details.parameter_size) details.parameter_size = paramMatch[1].toUpperCase();
            
            const quantMatch = id.match(/(q\d[^\s:]*|fp\d+)/i);
            if (quantMatch && !details.quantization_level) details.quantization_level = quantMatch[1].toUpperCase();
          }

          return {
            name: m.name,
            size: m.size,
            details
          };
        }) || [];
        return res.json(models);
      }

      res.status(response.status || 500).json({ error: `Provider returned ${response.status || 500}: ${response.statusText || 'Internal Server Error'}` });
    } catch (error: any) {
      log.error({ err: error }, 'Model fetch error');
      res.status(500).json({ error: `Connection failed: ${error.message}` });
    }
  });

  // Router Proxy Endpoint
  app.post("/api/router", authMiddleware, apiLimiter, validate(routerSchema), async (req, res) => {
    const { prompt } = req.body;
    try {
      const config = readConfig(ENCRYPTION_SECRET) || DEFAULT_CONFIG;

      // Check cache if enabled
      if (config.routerCacheEnabled) {
        const cached = getCachedRoute(prompt);
        if (cached) {
          log.info({ category: cached.category, model: cached.model }, 'Router cache hit');
          return res.json({ ...cached, cached: true });
        }
      }
      const { router } = config;

      // Determine URL and Key for routing
      let url = router.url;
      let key = router.key;

      // Fallback logic: if no custom router URL, always use local provider
      if (!url) {
        url = config.localUrl || LOCAL_URL;
        key = router.key || config.localKey || LOCAL_KEY;
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
            // Removed response_format: { type: 'json_object' } to increase compatibility with local providers.
            // Our parsing logic now handles markdown blocks automatically.
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
            setCachedRoute(prompt, parsed);
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

  // Main Chat Routing Endpoint
  app.post("/api/chat", authMiddleware, apiLimiter, validate(chatSchema), async (req, res) => {
    const { messages, decision } = req.body;

    try {
      const config = readConfig(ENCRYPTION_SECRET) || DEFAULT_CONFIG;

      // Determine provider URL and Key based on decision
      let baseUrl = config.localUrl || LOCAL_URL;
      let apiKey = config.localKey || LOCAL_KEY;
      
      if (decision.provider === 'cloud' || decision.provider === 'gemini') {
        // Use cloud settings, fallback to router settings if available
        baseUrl = config.cloudUrl || CLOUD_URL || config.router.url;
        apiKey = config.cloudKey || CLOUD_KEY || config.router.key;
      }

      log.info({ model: decision.model, category: decision.category, provider: baseUrl }, 'Routing chat request');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);
      
      const headers: any = { 
        "Content-Type": "application/json",
        "User-Agent": "NexusOrchestrator/1.0",
        "Accept": "application/json"
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      // Ensure URL ends correctly for OpenAI chat completions
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
      const attemptTimeoutMs = 60000;

      // Build ordered list of models to try: primary model first, then fallbacks
      const modelsToTry = [decision.model, ...(decision.fallbackModels || [])].filter(Boolean);

      let response: any = null;
      let lastError: any = null;

      for (let modelIdx = 0; modelIdx < modelsToTry.length; modelIdx++) {
        const currentModel = modelsToTry[modelIdx];
        const candidateUrls = getEndpoints(baseUrl);
        const loadingRetries = new Map<string, number>();

        if (modelIdx > 0) {
          log.info({ failedModel: modelsToTry[modelIdx - 1], nextModel: currentModel, attempt: modelIdx + 1, total: modelsToTry.length }, 'Falling back to next model in pool');
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
                stream: true,
                stream_options: { include_usage: true }
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

            // If model is still loading, wait and retry the same URL (up to 3 times)
            if (attempt.status === 500 && (errText.includes("loading model") || errText.includes("model loading"))) {
              const retries = (loadingRetries.get(url) || 0) + 1;
              loadingRetries.set(url, retries);
              if (retries <= 3) {
                const waitMs = retries * 5000; // 5s, 10s, 15s
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
        const modelsTriedStr = modelsToTry.length > 1 ? ` Tried models: ${modelsToTry.join(', ')}.` : '';
        throw new Error(`Failed to connect to any provider endpoint.${modelsTriedStr} Last error (${status || 'Fetch Failed'}): ${lastError?.text || lastError?.message || 'Unknown error'}${tip}`);
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        // Propagate client disconnect to the upstream provider (stops Ollama generation)
        req.on('close', () => {
          reader.cancel().catch(() => {});
        });

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (!line.trim()) continue;
            
            let dataStr = line;
            if (line.startsWith('data: ')) {
              dataStr = line.slice(6);
            }
            
            if (dataStr.trim() === '[DONE]') continue;
            
            try {
              const json = JSON.parse(dataStr);
              // Handle OpenAI format
              const openaiContent = json.choices?.[0]?.delta?.content;
              // Handle Ollama native format
              const ollamaContent = json.message?.content;
              
              // Handle usage info
              let usage = null;
              if (json.usage) {
                // OpenAI format
                usage = {
                  prompt_tokens: json.usage.prompt_tokens,
                  completion_tokens: json.usage.completion_tokens,
                  total_tokens: json.usage.total_tokens
                };
              } else if (json.prompt_eval_count !== undefined || json.eval_count !== undefined) {
                // Ollama format
                usage = {
                  prompt_tokens: json.prompt_eval_count || 0,
                  completion_tokens: json.eval_count || 0,
                  total_tokens: (json.prompt_eval_count || 0) + (json.eval_count || 0)
                };
              }
              
              const content = openaiContent || ollamaContent;
              if (content || usage) {
                res.write(JSON.stringify({ message: { content }, usage }) + '\n');
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
      res.end();

    } catch (error: any) {
      log.error({ err: error }, 'Chat routing error');
      res.status(500).json({
        error: error.message,
        tip: "Ensure your provider is running and accessible."
      });
    }
  });

  // Conversations Endpoints
  app.get("/api/conversations", authMiddleware, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;

      // If no pagination params, return legacy full list for backwards compat
      if (!req.query.limit && !req.query.offset) {
        return res.json(listConversations());
      }

      const result = listConversationsPaginated(limit, offset);
      res.json(result);
    } catch (error: any) {
      log.error({ err: error }, 'Error fetching conversations');
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  // Single conversation with full messages
  app.get("/api/conversations/:id", authMiddleware, async (req, res) => {
    try {
      const conv = getConversation(req.params.id);
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
      const newConversation = createConv(title || "New Conversation", messages || []);
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
      const updated = updateConv(id, { title, messages });
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
      deleteConv(id);
      res.json({ success: true });
    } catch (error: any) {
      log.error({ err: error }, 'Error deleting conversation');
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  });

  // --- Projects ---

  app.get("/api/projects", authMiddleware, (_req, res) => {
    try {
      res.json(listProjects());
    } catch (error: any) {
      log.error({ err: error }, 'Error listing projects');
      res.status(500).json({ error: "Failed to list projects" });
    }
  });

  app.post("/api/projects", authMiddleware, validate(createProjectSchema), (req, res) => {
    try {
      const { name } = req.body;
      res.json(createProject(name));
    } catch (error: any) {
      log.error({ err: error }, 'Error creating project');
      res.status(500).json({ error: "Failed to create project" });
    }
  });

  app.put("/api/projects/:id", authMiddleware, validate(updateProjectSchema), (req, res) => {
    try {
      const result = updateProject(req.params.id, req.body);
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
      deleteProject(req.params.id, deleteChats);
      res.json({ success: true });
    } catch (error: any) {
      log.error({ err: error }, 'Error deleting project');
      res.status(500).json({ error: "Failed to delete project" });
    }
  });

  app.patch("/api/conversations/:id/project", authMiddleware, validate(assignConversationSchema), (req, res) => {
    try {
      const { projectId } = req.body;
      assignConversation(req.params.id, projectId);
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
