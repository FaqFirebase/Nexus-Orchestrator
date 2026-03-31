# Roadmap

## Planned

### High Priority
- [ ] **Multiple local providers** — Configure Ollama, llama-swap, llama.cpp, etc. simultaneously. Model discovery aggregates across all providers. Routing targets the correct endpoint per model. Config shape: `localProviders: [{ url, key, name }]` replaces single `localUrl`/`localKey`. Backward compatible — existing `localUrl` migrates to `localProviders[0]`.

### Medium Priority
- [ ] **SearXNG web search via tool calling** — Expose a `web_search` tool to the LLM using the OpenAI-compatible `tools` / `tool_calls` API. The LLM decides when to search. Server handles the agentic loop server-side and streams the final response. Config: SearXNG URL in user config. Two modes: always-on global toggle, or per-chat toggle button in the chat input bar. FAST category skips tool injection.
- [ ] **Ollama backend abort** — Investigate stopping Ollama generation server-side when client disconnects. TCP disconnect does not propagate through Docker networking to the llama runner. UI stop works; backend keeps generating.

### Nice to Have
- ✅ **Request queuing** — Per-user FIFO queue for chat requests (v1.1.2)

---

## Completed

### v1.1.2
- ✅ **Request queuing** — Per-user FIFO queue for chat requests. Concurrent requests process in order rather than racing. Max 5 pending per user; excess returns 503. Client disconnects while queued are skipped automatically.

### v1.1.1
- ✅ **Session isolation fix** — Signing out fully clears all in-memory state (conversations, messages, projects, config). Login modal cannot be dismissed when authentication is required. Main UI hidden while logged out. Session expiry (401) triggers the same full state wipe as manual logout.

### v1.1.0
- ✅ **Multi-user support** — Per-user accounts with isolated config, conversations, and projects. Username/password login, session-based auth (httpOnly cookies), admin user management, optional public registration, per-user provider config, change password, user menu in header. Existing single-user installs migrate automatically.

### v1.0.9
- ✅ **Streaming chunk buffer** — SSE stream parsing carries a leftover buffer across reads. Fixes silent token/usage loss when JSON objects split across TCP reads.
- ✅ **Router cache persistence fix** — `routerCacheEnabled` was stripped by Zod validation before saving. Toggle now persists correctly across reloads.
- ✅ **Conversations export fix** — Export hits a dedicated endpoint reading all conversations with full messages from SQLite instead of the paginated in-memory list.

### v1.0.8
- ✅ **Error boundaries** — Each tab (Chat, Models, System) wrapped in a React error boundary. A crash in one tab shows a fallback card instead of blanking the entire UI.
- ✅ **Projects** — Organize conversations into named project folders. Collapse/expand, inline rename, right-click to assign conversations, delete with option to keep or remove chats.

### v1.0.7
- ✅ **Dockerfile fix** — Root-level TypeScript files copied with `*.ts` glob. Prevents missing module errors when new backend files are added.
- ✅ **Configuration guide** — Full configuration guide added to README covering all providers, router, and category mappings.
- ✅ **Chat timeout** — Per-attempt timeout raised from 15s to 60s for all categories. Fixes cold model load failures on first request to large models.

### v1.0.6
- ✅ **Conversation pagination** — Paginated API with lazy-loading sidebar. "Load More" button, messages fetched on demand.
- ✅ **Router result caching** — In-memory LRU cache (max 100 entries, 5-minute TTL), off by default, toggle in System tab.
- ✅ **FAST category** — Built-in category for trivial one-liner responses using small/fast models.
- ✅ **SECURITY category** — Dedicated category for security analysis, vulnerability assessment, threat modeling, CTF, and pentesting.

### v1.0.5
- ✅ **Input validation** — Zod schemas for all API endpoints.
- ✅ **Tests** — Vitest suite covering all validation schemas.
- ✅ **Rate limiting** — Login brute-force protection + API request throttling.

### v1.0.4
- ✅ **Model fallback** — Auto-fallback to next model in category pool when selected model is unavailable.
- ✅ **Chat input UX** — Auto-growing textarea, character/line count display.

### v1.0.3
- ✅ **SQLite migration** — Replaced JSON file storage with SQLite + WAL mode.
- ✅ **PORT env var** — Server port configurable via environment variable.

### v1.0.2
- ✅ **Category Mappings cloud filter** — Cloud provider warning when unconfigured, improved X button placement, hover tooltip.
- ✅ **Scrollbar fix** — Scrollbar sits at window edge; scroll works from anywhere on the page.
- ✅ **Sidebar navigation** — Clicking a conversation navigates back to Chat tab automatically.

### v1.0.1
- ✅ **Stop generation** — Cancel button aborts in-flight SSE stream, keeps partial response, resets loading state.
- ✅ **Ollama auto-detection** — Health check detects Ollama and uses native `/api/chat` endpoint automatically.

### v1.0.0
- ✅ **SSRF protection** — URL validation on config save, blocks non-http(s) schemes and cloud metadata endpoints.
- ✅ **CORS configuration** — Same-origin enforcement middleware.
- ✅ **Cookie-based auth** — httpOnly session cookies, timing-safe key comparison.
- ✅ **LaTeX rendering** — KaTeX support for math notation output from reasoning models.
- ✅ **Vision & document support** — Image and document attachments routed to correct model format automatically.
- ✅ **Structured logging** — Pino with JSON in production, pretty-printed in dev.
- ✅ **Component refactor** — Split monolithic App.tsx into modular component architecture.
