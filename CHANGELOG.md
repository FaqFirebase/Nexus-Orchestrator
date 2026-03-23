# Changelog

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
