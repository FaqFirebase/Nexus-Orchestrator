# Changelog
Version numbers are based off of Dock Hub releases.

### v1.1.4
- **Web search sources display** — After a web search completes, a collapsible **Sources** toggle appears below the assistant response showing the SearXNG results used to answer the question. Each source lists the title (as a link), URL, and snippet. Click "Sources (N)" to expand or collapse.

### v1.1.3
- **SearXNG web search via tool calling** — LLMs can now search the web using a self-hosted SearXNG instance. Configure the SearXNG URL in the Models tab under Web Search. Two modes: Always On (search tool included in every request) or per-chat toggle (globe icon in the chat input bar). The LLM decides when to call the tool — the server handles the full agentic loop and streams the final response. FAST category always skips search. Ollama and any OpenAI-compatible provider with tool-calling support is compatible.

### v1.1.2
- **Request queuing** — Each user now has a per-user FIFO queue for chat requests. Concurrent requests are processed in order rather than racing. Maximum of 5 pending requests per user; a 6th returns a 503. Requests cancelled by the client while waiting in queue are skipped automatically.

### v1.1.1
- **Session isolation fix** — Signing out now fully clears all in-memory state (conversations, messages, projects, config) before invalidating the session. The login modal can no longer be dismissed when authentication is required, and the main UI is hidden while logged out.

### v1.1.0
- **Multi-user support** — Nexus now supports multiple users with per-user isolation. Each user gets their own provider config, category mappings, conversations, and projects — completely independent from other users.
  - **Username/password authentication** — Replaced single API key login with username + password. The first admin account is auto-created from `ADMIN_API_KEY` on startup (username: `admin`, password: your existing key). Existing data is migrated to the admin user seamlessly.
  - **User registration** — Admins can toggle public registration from the System tab. New users inherit the admin's config as a starting point and can customize everything independently.
  - **Admin user management** — System tab shows a User Management panel (admin only) to create users, reset passwords, delete accounts, and toggle public registration.
  - **Per-user config** — Each user has their own provider URLs, API keys, router model, and category-to-model mappings. One user can run local-only Ollama while another uses OpenAI — no interference.
  - **Session-based auth** — Secure random session tokens stored in httpOnly cookies replace the old raw API key cookie. Sessions are invalidated on password change.
  - **User menu** — Header shows logged-in username with a dropdown for Change Password and Sign Out.
  - **Change password** — All users can change their own password from the header menu.
  - **Data isolation** — Conversations, projects, and config are scoped by user ID. No cross-user data access.
  - **Router cache scoped** — Router result cache is now keyed by user + prompt, preventing cache cross-contamination.
  - **Backward compatible** — Existing single-user installs upgrade automatically. The admin user inherits all existing conversations, projects, and config.

### v1.0.9
- **Bug fixes** — Three correctness fixes with no user-facing config changes required:
  - **Streaming chunk buffer** — SSE stream parsing on both server and client now carries a leftover buffer across `read()` calls. Previously a JSON object split across two network reads would be silently discarded, dropping tokens and usage data mid-response.
  - **Router cache not persisting** — `routerCacheEnabled` was missing from the Zod config schema, so the validation middleware stripped it before `writeConfig()` ran. The toggle appeared to save but reverted on every reload. Now persists correctly.
  - **Conversations export incomplete** — System tab export now hits a dedicated `GET /api/conversations/export` endpoint that reads all conversations with full messages from SQLite. Previously it serialised the paginated in-memory sidebar list, which contained metadata only and missed most message history.

### v1.0.8
- **Projects** — Organize conversations into named project folders in the sidebar. Click a project to collapse/expand it, double-click to rename, right-click any conversation to move it to a project or remove it. Deleting a project lets you choose to keep the chats (they move to unassigned) or delete them all. Projects and assignments persist across restarts.
- **Error Boundaries** — Each tab (Chat, Models, System) is now wrapped in an error boundary. A crash in one tab shows a fallback card with a "Try again" button instead of blanking the entire UI.

### v1.0.7
- **Dockerfile fix** — Root-level TypeScript files now copied with `*.ts` glob instead of individual filenames. Prevents missing module errors when new backend files are added.
- **Documentation** — Added Configuration Guide to README covering Local Provider, Cloud Provider, Intent Router, Discovered Models, and Category Mappings with usage instructions and a category reference table.
- **Ignore files** — Added `conversations.json` and `*.migrated` to both `.gitignore` and `.dockerignore`.
- **Chat timeout** — Per-attempt timeout increased from 15s to 60s for all categories. Prevents cold model load failures on first request to a large model.

### v1.0.6
- **Conversation pagination** — Sidebar now loads conversations in pages of 50 with a "Load More" button. Messages are fetched on demand when you select a conversation, instead of loading everything upfront. New `GET /api/conversations?limit=50&offset=0` returns metadata only; `GET /api/conversations/:id` returns full messages.
- **Router result caching** — Identical routing prompts return cached results for 5 minutes (in-memory LRU, max 100 entries). **Off by default** — enable via the toggle in the System tab. Useful for saving API calls when using a paid cloud router.
- **FAST category** — New built-in category for trivial/quick responses. Assign your smallest, fastest model (e.g., gemma3:4b) for greetings, yes/no answers, and simple lookups.
- **SECURITY category** — New built-in category for security analysis, vulnerability assessment, threat modeling, CTF challenges, penetration testing guidance, and cybersecurity topics.

### v1.0.5
- **Input validation** — All API endpoints now validate request bodies with Zod schemas. Malformed requests get a clear 400 error before hitting any business logic.
- **Rate limiting** — Login endpoint limited to 20 attempts per 15 minutes. Chat, router, and API endpoints limited to 60 requests per minute. Returns standard `Retry-After` headers.
- **Test infrastructure** — Vitest with 18 tests covering all validation schemas. Run with `npm test`.

### v1.0.4
- **Model fallback** — If a model in a category pool fails (unavailable, error, timeout), the server automatically tries the next model in the pool before giving up. Logs each fallback attempt. Error messages now list all models tried.
- **Chat input UX** — Textarea auto-grows as you type (up to 192px) and shrinks when text is deleted. Shows character count and line count below the input. Smooth height transitions.

### v1.0.3
- **SQLite migration** — Replaced JSON file storage with SQLite (`better-sqlite3`). Conversations and config are now stored in `data/nexus.db` with WAL mode. Eliminates read-modify-write race conditions, supports atomic transactions, and enables future pagination. Existing JSON files are auto-migrated on first startup and renamed to `.migrated`.
- **PORT env var** — Server now reads `process.env.PORT` instead of hardcoding 3000. SSRF self-loop detection also uses the dynamic port.

### v1.0.2
- **Category Mappings UX** — When a category provider is set to Cloud, the local model picker is replaced with a "Cloud not configured" warning (if no Cloud API URL is set) or a "Cloud Provider Active" hint (if configured). X button moved outside the card corner to avoid overlapping the provider dropdown; removing a category now shows a confirmation dialog.
- **Scrollbar fix** — Models and System tabs now scroll full-width; scrollbar sits at the window edge instead of overlapping content. Scrolling works from anywhere on the page.
- **Sidebar navigation** — Clicking a conversation or "New Orchestration" in the sidebar now automatically switches back to the Chat tab.

### v1.0.1
- **Stop generation** — Red stop button replaces the send button while a response is generating. Aborts the the SSE stream cleanly, keeps any partial response in chat, resets loading state.

### v1.0.0 — Initial Release
- Intelligent intent routing — classifies prompts into CODING, REASONING, CREATIVE, VISION, DOCUMENT, GENERAL and dispatches to the right model
- Hybrid local + cloud orchestration — per-category Local/Cloud provider toggle
- MIME-based attachment routing — images force VISION, documents force DOCUMENT before the router runs
- Vision and document support — upload images and documents directly in chat
- Router model visibility — each response shows which model handled routing in the header and Routing Analysis section
- Router configurable via env vars (`ROUTER_MODEL`, `ROUTER_URL`, `ROUTER_KEY`) at container creation
- Chat rename — double-click or pencil icon; conversations auto-name from first message
- Model loading retry — auto-retries up to 3x with backoff when Ollama is loading a model
- Cookie-based auth — httpOnly session cookies, timing-safe key comparison
- CORS middleware — same-origin enforcement
- SSRF protection — validates provider URLs on save, blocks non-http(s) schemes and cloud metadata endpoints
- KaTeX LaTeX rendering — math notation from reasoning models renders properly
- Structured logging — Pino with JSON in production, pretty-printed in dev
- AES-256-GCM encryption for stored conversations and config
- Docker + Unraid community template support
- No hardcoded cloud defaults — all provider URLs and models start empty
