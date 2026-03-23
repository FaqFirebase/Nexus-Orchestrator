# Nexus Orchestrator

**A self-hosted orchestration layer that intelligently routes each request to the best local or cloud model.**

---

## Overview

Nexus is more than a chat interface — it's an **orchestration layer** for your local and cloud LLMs. A lightweight router model analyzes each prompt's intent and dispatches it to the most capable model for the job: local Ollama for privacy-sensitive or everyday tasks, cloud APIs (Gemini, OpenAI-compatible) for heavier reasoning or specialized work.

### Key Features

- **Intelligent Intent Routing** — A small router model classifies each prompt (CODING, REASONING, CREATIVE, VISION, DOCUMENT, GENERAL) and selects the right model automatically.
- **Hybrid Orchestration** — Mix local and cloud models per category. Switch seamlessly without changing your workflow.
- **Vision & Document Support** — Upload images and documents directly in the chat. Vision models receive them in the correct format automatically.
- **Privacy First** — Point the router at a local Ollama model and your prompts never leave your network.
- **Structured Logging** — JSON logs in production (pino), pretty-printed in dev. Control verbosity with `LOG_LEVEL`.
- **Unraid Ready** — Includes a community template for one-click Unraid deployment.

---

## Origin

Nexus started as a vibe coding session — no grand plan, just a frustration with constantly switching between chat interfaces depending on which model I wanted to use that day. The idea was simple: what if something just *decided* for me?

What began as a single-file prototype grew into something I actually use. Along the way it picked up proper component architecture, structured logging, vision support, Docker packaging. Most of the core ideas came from just running it, hitting its rough edges, and fixing them.

It's still evolving.

---

## Quick Start

### Docker (Recommended)

```bash
docker run -d \
  --name nexus-orchestrator \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -e ADMIN_API_KEY=your_secure_admin_key \
  -e LOCAL_URL=http://host.docker.internal:11434 \
  -e ROUTER_MODEL="REPLACE_YOUR_MODEL_NAME" \
  pikkonmg/nexus-orchestrator
```

Then open `http://localhost:3000` and log in with your `ADMIN_API_KEY`.

### Docker Compose

```yaml
services:
  nexus:
    image: pikkonmg/nexus-orchestrator
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      - ADMIN_API_KEY=your_secure_admin_key
      - LOCAL_URL=http://host.docker.internal:11434
      - ROUTER_MODEL="REPLACE_YOUR_MODEL_NAME"
      # Optional: add cloud provider for hybrid routing
      # - CLOUD_URL=https://your-cloud-provider.com/v1
      # - CLOUD_API_KEY=your_api_key
    restart: unless-stopped
```

### Unraid

1. Copy `template_unraid.xml` to your flash drive: `/boot/config/plugins/dockerMan/templates-user/`
2. Add the container from your Unraid Docker tab.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_API_KEY` | *(required)* | Password for the web UI and API |
| `ENCRYPTION_SECRET` | *(derived from ADMIN_API_KEY)* | Separate secret for encrypting data at rest. Recommended for production |
| `LOCAL_URL` | `http://localhost:11434` | Your Ollama or local provider base URL |
| `LOCAL_KEY` | *(empty)* | API key for local provider (if required) |
| `CLOUD_URL` | *(empty)* | OpenAI-compatible base URL for cloud provider |
| `CLOUD_API_KEY` | *(empty)* | API key for cloud provider (also accepts `CLOUD_KEY`) |
| `ROUTER_MODEL` | *(empty)* | Model used for intent classification (e.g. `gemma3:4b`, `gemini-2.0-flash-lite`) |
| `ROUTER_URL` | *(empty)* | Custom URL for the intent router. Defaults to `LOCAL_URL` if blank |
| `ROUTER_KEY` | *(empty)* | Custom API key for the router endpoint |
| `CONFIG_DIR` | `/app/data` | Where config and conversations are stored |
| `LOG_LEVEL` | `info` | Pino log level: `trace`, `debug`, `info`, `warn`, `error` |
| `PORT` | `3000` | Server port |

---

## Privacy Configuration

Nexus has no hardcoded cloud defaults — all provider URLs and models start empty. For **100% local operation**:

1. Set `LOCAL_URL` to your Ollama instance
2. Set `ROUTER_MODEL` to a small local model (e.g. `gemma3:4b`, `qwen2.5:3b`)
3. Assign local models to each category in the UI → **Models** tab

Your prompts will never leave your network.

---

## Remote Access

If Nexus runs in the cloud but your Ollama is local, expose it via a tunnel:

```bash
# Cloudflare
cloudflared tunnel --url http://localhost:11434

# Ngrok
ngrok http 11434
```

Then set `LOCAL_URL` to the tunnel address.

---

## Building from Source

```bash
git clone https://github.com/FaqFirebase/Nexus-Orchestrator.git
cd nexus-orchestrator
npm install
cp .env.example .env   # fill in your keys
npm run dev            # starts server + Vite HMR on :3000
```

To build the Docker image:

```bash
docker build -t nexus-orchestrator:latest .
```

---

## Roadmap

- ✅ CORS configuration — Same-origin enforcement
- ✅ Cookie-based auth — httpOnly session cookies, timing-safe key comparison
- ✅ SSRF protection — URL validation on config save, blocks non-http(s) schemes and cloud metadata endpoints
- ✅ LaTeX rendering — KaTeX support for math notation output from reasoning models
- [ ] Input validation — Zod schemas for all API endpoints
- [ ] Tests — Vitest for backend endpoint and routing logic testing
- [ ] Rate limiting — Prevent unlimited authenticated requests
- ✅ SQLite migration — Replaced JSON file storage with SQLite + WAL mode (v1.0.3)
- [ ] Model fallback — Auto-fallback to next model in category pool when selected model is unavailable
- [ ] Conversation pagination — API pagination + lazy-loading UI instead of loading all conversations at once
- [ ] Router result caching — Cache recent routing decisions for identical prompts
- [ ] Multi-user support — JWT auth + user isolation instead of single shared admin key
- [ ] Error boundaries — React error boundaries to prevent full UI crashes
- [ ] Conversation cleanup — Archival or TTL for old conversations
- [ ] Request queuing — Job queue for multiple concurrent long-running streams
- ✅ Stop generation — Cancel button aborts in-flight SSE stream, resets loading state (v1.0.1)
  > **Known limitation:** The UI stops immediately, but Ollama will continue generating in the background until the current response completes. This is a Docker networking constraint — TCP disconnect does not propagate to the Ollama llama runner. Cloud providers (OpenAI, Gemini, etc.) are unaffected.Looking for a fix
- [ ] Ollama backend abort — Investigate stopping Ollama generation server-side when client disconnects (current TCP disconnect does not propagate through Docker networking)
- [ ] Chat input UX — Improve textarea for large inputs: expand height, add scrollbar, show visible line count or character info
- [ ] FAST category — Built-in category for quick, lightweight responses using small/fast models (gemma3:4b, gemini-3.1-flash-lite, gpt-4.1-mini)
- ✅ Category Mappings cloud filter — Cloud provider warning when unconfigured, X button repositioned out of the dropdown's way, hover tooltip added (v1.0.2)

---

## Changelog

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
