# Project Reference

Developer reference for Nexus Orchestrator. Start here before touching code.

---

## Overview

Nexus is a self-hosted LLM orchestration layer. A lightweight router model classifies each incoming prompt by intent and dispatches it to the most appropriate local or cloud model. The server is a single Express process that serves both the REST/SSE API and the compiled React SPA.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20, TypeScript 5.8, tsx (no compile step in dev) |
| Server | Express 4 |
| Frontend | React 19, Vite 6, Tailwind CSS 4 |
| Database | SQLite via better-sqlite3 (WAL mode) |
| Logging | Pino — JSON in production, pretty in dev |
| Validation | Zod |
| Auth | scrypt password hashing, httpOnly session cookies |
| Encryption | AES-256-GCM (provider keys at rest) |
| Rate limiting | express-rate-limit |
| Testing | Vitest |

---

## Repository Layout

```
nexus-orchestrator/
├── server.ts           # Express server — all API routes + SSE chat proxy
├── db.ts               # SQLite schema, migrations, all CRUD functions
├── validation.ts       # Zod schemas + validate() middleware
├── crypto.ts           # AES-256-GCM encrypt/decrypt, scrypt helpers
├── logger.ts           # Pino instance
├── src/
│   ├── App.tsx         # Root component — auth gate, tab routing
│   ├── types.ts        # Shared TypeScript interfaces
│   ├── constants.tsx   # DEFAULT_CONFIG, category icons
│   ├── main.tsx        # React entry point
│   ├── index.css       # Global styles
│   ├── components/
│   │   ├── chat/       # ChatTab, ChatInput, ChatMessage, RoutingStatus
│   │   ├── models/     # ModelsTab, ProviderConfig, RouterConfig,
│   │   │               # CategoryMappings, DiscoveredModels
│   │   ├── sidebar/    # ProjectRow
│   │   ├── system/     # SystemTab, UserManagement
│   │   ├── ErrorBoundary.tsx
│   │   ├── Header.tsx
│   │   ├── LoginModal.tsx
│   │   ├── RoutingAnalysis.tsx
│   │   └── Sidebar.tsx
│   └── hooks/
│       ├── useAuth.ts              # Login/logout, session state
│       ├── useChat.ts              # Chat send, SSE stream parsing, message state
│       ├── useConfig.ts            # Load/save provider config
│       ├── useConnection.ts        # Health check, auth status polling
│       ├── useConversations.ts     # Conversation + project CRUD, pagination
│       ├── usePersistentTab.ts     # Active tab persisted to localStorage
│       └── usePersistentToggle.ts  # Section collapse state persisted to localStorage
├── tests/
│   └── validation.test.ts
├── docs/
│   └── Nexus_UNRAID_GUIDE.md
├── Dockerfile
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## Database Schema

File: `nexus.db` at `$CONFIG_DIR` (default `/app/data`)

```sql
schema_version  (version INTEGER)
config          (id=1, data TEXT)          -- legacy single-user config; unused post v1.1.0
users           (id UUID, username, password_hash, role, created_at)
user_configs    (user_id FK, data TEXT)    -- AES-256-GCM encrypted JSON per user
admin_settings  (id=1, data TEXT)          -- registration toggle
conversations   (id UUID, title, updated_at, user_id FK, project_id FK)
messages        (id UUID, conversation_id FK, role, content, category, decision,
                 attachments, timestamp, usage, sort_order)
projects        (id UUID, name, collapsed, created_at, user_id FK)
```

All IDs are `crypto.randomUUID()`. WAL mode and `PRAGMA foreign_keys = ON` are set on every connection.

---

## Authentication

- **Credentials:** scrypt-hashed passwords in `users` table.
- **Sessions:** random 32-byte hex tokens stored in an in-memory `Map<token, {userId, expiresAt}>`. TTL is 7 days.
- **Transport:** `nexus_session` httpOnly cookie. `x-admin-key` header accepted as a fallback for API clients — verified via `crypto.timingSafeEqual` against the `ADMIN_API_KEY` env var directly (not the stored password hash). Changing the admin login password does not affect API clients.
- **Admin bootstrap:** On first startup, the admin user is created from `ADMIN_API_KEY`. Existing single-user data migrates automatically.
- **Multi-user:** All queries are scoped by `req.userId`. `req.userRole` available for admin-only endpoints.

---

## Request Flow

```
Browser → POST /api/chat
  ↓
Auth middleware (session cookie → userId)
  ↓
Per-user FIFO queue (UserChatQueue, max 5 pending, 503 on overflow)
  ↓
handleChat()
  ├── Attachment MIME check → force VISION or DOCUMENT category (bypasses router)
  ├── POST /api/router (LLM JSON response → { category, model, reasoning })
  ├── If webSearchEnabled and category ≠ FAST:
  │     Non-streaming first call to detect tool_calls
  │     If tool_calls present → runSearxngSearch() → emit { searching, query } SSE event
  │     Streaming follow-up call with tool result
  └── Else: streaming call directly → pipe SSE to response via streamSseToResponse()
```

**Model fallback:** If the primary model fails all retries, the server tries each model in `fallbackModels` (the rest of the category pool, sent by the client). Each attempt retries up to 3× on Ollama 500 "model loading" errors.

---

## Router

The router is a small model that receives a structured prompt and returns JSON:

```json
{ "category": "CODING", "model": "qwen2.5-coder:7b", "reasoning": "..." }
```

- JSON markdown fences are stripped automatically.
- Router URL defaults to Local Provider URL when blank.
- Router result caching: optional in-memory LRU (100 entries, 5-min TTL), keyed by `userId + SHA-256(prompt)`.

---

## Web Search (SearXNG Tool Calling)

When `searxng.url` is configured and search is enabled for the request:

1. A non-streaming first call is made with the `web_search` tool definition injected.
2. If the model returns `tool_calls`, `runSearxngSearch()` fetches `$SEARXNG_URL/search?format=json&q=<query>` and returns `{ text, sources }` — formatted text for the LLM tool result and a structured array for the client.
3. A `{ searching: true, query }` SSE event is emitted (renders the "Searching the Web..." indicator).
4. A `{ sources: [{title, url, snippet}] }` SSE event is emitted so the client can show a Sources accordion below the response.
5. A streaming follow-up call is made with the tool result appended; the response is piped to the client.

FAST category always skips the search tool. SSRF protection applies to the SearXNG URL.

---

## SSE Protocol

All chat responses stream as `text/event-stream`. Each event is a JSON object on a `data:` line:

| Field | Meaning |
|---|---|
| `type: 'routing'` | Router decision — category, model, reasoning |
| `searching: true, query` | Web search fired — renders searching indicator |
| `sources: [{title, url, snippet}]` | SearXNG results — stored on message, shown as collapsible Sources accordion |
| `content` | Token chunk |
| `usage` | Final token counts (prompt/completion/total) |
| `done: true` | Stream complete |
| `error` | Error string |

---

## API Endpoints

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/login` | Username + password → session cookie |
| POST | `/api/auth/logout` | Clear session |
| GET | `/api/auth/status` | Check session validity |
| PUT | `/api/auth/password` | Change own password |

### Config
| Method | Path | Description |
|---|---|---|
| GET | `/api/config` | Load user config |
| POST | `/api/config` | Save user config (validates + encrypts) |

### Models
| Method | Path | Description |
|---|---|---|
| GET | `/api/models` | Proxy to local provider `/v1/models` |
| POST | `/api/router` | Run intent classification |
| POST | `/api/chat` | Queued SSE chat stream |

### Conversations
| Method | Path | Description |
|---|---|---|
| GET | `/api/conversations` | Paginated list (`?limit&offset`) |
| POST | `/api/conversations` | Create |
| GET | `/api/conversations/:id` | Full conversation with messages |
| PUT | `/api/conversations/:id` | Rename |
| DELETE | `/api/conversations/:id` | Delete |
| PATCH | `/api/conversations/:id/project` | Assign to project (ownership-checked) |
| GET | `/api/conversations/export` | Full export (all conversations + messages) |

### Projects
| Method | Path | Description |
|---|---|---|
| GET | `/api/projects` | List user's projects |
| POST | `/api/projects` | Create project |
| PUT | `/api/projects/:id` | Rename / toggle collapsed |
| DELETE | `/api/projects/:id` | Delete (`?deleteChats=true\|false`) |

### Admin
| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/users` | List all users |
| POST | `/api/admin/users` | Create user |
| PUT | `/api/admin/users/:id` | Update user (role, password reset) |
| DELETE | `/api/admin/users/:id` | Delete user |
| GET | `/api/admin/settings` | Registration toggle state |
| PUT | `/api/admin/settings` | Toggle public registration |

### System
| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Provider health check |

---

## Development

```bash
npm install
cp .env.example .env   # set ADMIN_API_KEY, LOCAL_URL, ROUTER_MODEL
npm run dev            # tsx server.ts + Vite HMR on :3000
npm test               # Vitest (validation schemas)
npm run lint           # tsc --noEmit
```

The dev server runs Express on port 3000. Vite proxies API calls to Express and serves the SPA with HMR. In production the compiled `dist/` is served as static files from the same Express process.

---

## Docker Build

```bash
docker build -t nexus-orchestrator:latest .
```

The Dockerfile uses a two-stage build:

1. **Builder** — installs all deps, runs `vite build`, compiles frontend to `dist/`, then prunes dev dependencies
2. **Production** — copies `dist/`, `*.ts` backend files, and already-pruned `node_modules`, runs with `tsx`

Data volume: `/app/data` — mount a host path here for persistence.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ADMIN_API_KEY` | required | Admin password; auto-creates admin user on first run |
| `ENCRYPTION_SECRET` | derived from ADMIN_API_KEY | AES-256-GCM key for config encryption at rest |
| `LOCAL_URL` | `http://localhost:11434` | Local provider base URL |
| `LOCAL_KEY` | — | Local provider API key |
| `CLOUD_URL` | — | Cloud provider base URL |
| `CLOUD_API_KEY` | — | Cloud provider API key |
| `ROUTER_MODEL` | — | Model for intent classification |
| `ROUTER_URL` | — | Router endpoint (defaults to LOCAL_URL) |
| `ROUTER_KEY` | — | Router API key |
| `CONFIG_DIR` | `/app/data` | Database and config directory |
| `PORT` | `3000` | Server port |
| `LOG_LEVEL` | `info` | Pino log level |
| `CHAT_TIMEOUT_MS` | `300000` | Per-attempt chat timeout in ms. Overall timeout = 4× this value. |

---

## Built-in Categories

| Category | Router trigger |
|---|---|
| GENERAL | Everyday questions, conversation |
| CODING | Code writing, debugging, review |
| REASONING | Math, analysis, multi-step logic |
| CREATIVE | Stories, poems, brainstorming |
| VISION | Image attachment present |
| DOCUMENT | Document attachment present |
| FAST | Pure micro-interactions only — greetings, single-word acknowledgements, trivial arithmetic. Any knowledge retrieval routes to GENERAL. |
| SECURITY | Security analysis, CTF, pentesting |

Custom categories can be added from the Models tab.

---

## Design Constraints

- **No hardcoded cloud defaults.** All provider URLs and models start empty.
- **Router URL blank = use Local Provider.** No model-name-based cloud detection.
- **Privacy first.** A fully local setup (local router + local models) never sends data outside the user's network.
- **Provider-agnostic.** Cloud provider is any OpenAI-compatible endpoint — not tied to any vendor.
- **Ollama auto-detection.** Health check detects Ollama via `/api/tags` and uses the native `/api/chat` endpoint for confirmed Ollama instances.



## API Model

Nexus operates as an orchestration layer over OpenAI-compatible APIs.

- Cloud providers MUST implement OpenAI-compatible endpoints
- Local providers may use native APIs (e.g. Ollama, llama.cpp)
- Nexus normalizes requests and responses across providers

Nexus is responsible for:

- request transformation
- response normalization
- streaming consistency (SSE)

## Router Constraints

- Router output MUST be valid JSON
- Router decisions MUST map to configured categories
- Router must not introduce new categories dynamically
- Router failures must trigger fallback behavior

Router is a classifier, not a generator.

## Multi-User Constraints

- All queries MUST be scoped by userId
- Provider configs are user-specific
- Category mappings may differ per user
- No global assumptions about providers or models

## Streaming Contract

All chat responses MUST follow the SSE protocol.

Do not:

- convert streaming to blocking responses
- change event structure without updating client
- emit non-JSON events

SSE is a core system behavior.

## Ollama Behavior

When Ollama is detected:

- Use `/api/chat`
- Do NOT use OpenAI `/v1` endpoints
- Do NOT wrap Ollama calls as OpenAI unless explicitly required

## Orchestration Rule

All model access MUST go through Nexus.

Forbidden:

- Direct calls to Ollama from UI or unrelated modules
- Direct calls to cloud APIs outside provider layer
- Hardcoded model routing in components

Routing logic must remain centralized.
