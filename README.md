# Nexus Orchestrator

**A self-hosted orchestration layer that intelligently routes each request to the best local or cloud model.**

---

## Overview

Nexus is more than a chat interface — it's an **orchestration layer** for your local and cloud LLMs. A lightweight router model analyzes each prompt's intent and dispatches it to the most capable model for the job: local Ollama for privacy-sensitive or everyday tasks, cloud APIs (Gemini, OpenAI-compatible) for heavier reasoning or specialized work.

### Key Features

- **Intelligent Intent Routing** — A small router model classifies each prompt (CODING, REASONING, CREATIVE, VISION, DOCUMENT, GENERAL, FAST, SECURITY) and selects the right model automatically.
- **Hybrid Orchestration** — Mix local and cloud models per category. Switch seamlessly without changing your workflow.
- **Multi-User Support** — Multiple users with per-user provider config, category mappings, conversations, and projects. Admin manages users from the System tab.
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

Then open `http://localhost:3000` and log in with username `admin` and your `ADMIN_API_KEY` as the password.

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
| `ADMIN_API_KEY` | *(required)* | Password for the admin account (username: `admin`). On first run, an admin user is auto-created with this password |
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

## Configuration Guide

### Local Model / API Provider

This is your local LLM backend — usually Ollama running on your home server or PC.

- **Provider URL** — The address Nexus uses to reach your local models. For Ollama this is typically `http://192.168.1.x:11434`. Don't use `localhost` — inside Docker that refers to the container itself, not your machine.
- **API Key** — Leave blank for Ollama. Only needed if your local provider requires authentication (e.g. Open WebUI with auth enabled).

Nexus auto-detects Ollama and switches to its native `/api/chat` endpoint automatically.

---

### Cloud Model / API Provider

An optional OpenAI-compatible cloud API for heavier tasks or models you don't run locally.

- **Provider URL** — The base URL of your cloud provider (e.g. `https://api.openai.com/v1`, `https://openrouter.ai/api/v1`).
- **API Key** — Your API key for that provider.

If you leave this blank, the CLOUD provider option in Category Mappings will show a warning and fall back to local.

---

### Intent Router (Orchestrator)

The router is a small model that reads each prompt and decides which category and model should handle it. It runs before every chat message.

- **Model** — The model used for routing. A small fast model works well here — you don't need a large model, just one that can return clean JSON. Good options: `gemma3:4b`, `qwen2.5:3b`, `gpt-4.1-mini`.
- **Router URL** — Leave blank to use your Local Provider. Set a custom URL if you want to use a different endpoint just for routing (e.g. a paid cloud router while keeping chat local).
- **Router Key** — API key for the router endpoint if required.

The router model must be capable of returning valid JSON. If it wraps its response in markdown code blocks that's fine — Nexus strips them automatically.

---

### Discovered Models

This section shows all models Nexus finds at your Local Provider URL. Nexus queries your provider on the Models tab and lists everything available. Click any model to add it to a category pool.

If your models aren't showing up, check that your Local Provider URL is correct and the connection shows as **Online** in the header.

---

### Category Mappings

Categories are how Nexus decides which model handles which type of request. Each category has a **model pool** and a **provider** (Local or Cloud).

| Category | When it's used |
|----------|---------------|
| GENERAL | Everyday questions, conversation, simple lookups |
| CODING | Code writing, debugging, explaining code |
| REASONING | Math, analysis, multi-step logic, comparisons |
| CREATIVE | Stories, poems, brainstorming, marketing copy |
| VISION | When an image is attached to the message |
| DOCUMENT | When a document (PDF, text file) is attached |
| FAST | Simple one-liner responses where speed matters |
| SECURITY | Security analysis, CTF, pentesting, vulnerability research |

**How to set up a category:**
1. Go to the **Models** tab
2. Find the category you want to configure
3. Set the provider to **Local** or **Cloud**
4. Click models from the Discovered Models list to add them to the pool, or type a custom model name
5. The first model in the pool is used by default. If it fails, Nexus automatically tries the next one.

You can add custom categories using the input at the bottom of the Models tab.

---

## System Settings

### Router Result Caching

By default, every prompt makes a fresh call to the router model for intent classification. If you're using a **paid cloud router** (OpenAI, OpenRouter, etc.), you can enable caching to avoid redundant API calls.

**How to enable:**
1. Go to the **System** tab
2. Toggle **Router Result Caching** on

When enabled, identical routing prompts reuse the cached decision for 5 minutes. After that the cache expires and the router model is called again. The cache is in-memory only and clears on server restart.

**When to use it:** Paid cloud routers where each call costs money.
**When to skip it:** Local routers (Ollama) where the call is fast and free.

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

### Planned

- [ ] **Multiple local providers** — Configure Ollama, llama-swap, llama.cpp, etc. simultaneously; model discovery aggregates across all providers; routing targets the correct endpoint per model
- [ ] **SearXNG web search via tool calling** — LLM-driven web search using the `tools` / `tool_calls` API. Always-on global toggle or per-chat enable button. Server handles the agentic loop transparently.
- [ ] **Ollama backend abort** — Investigate stopping Ollama generation server-side when client disconnects (current TCP disconnect does not propagate through Docker networking)
- [ ] **Request queuing** — Job queue for multiple concurrent long-running streams

See [ROADMAP.md](ROADMAP.md) for the full history of completed features.

---

## Changelog

**v1.1.3** — SearXNG web search via tool calling. LLMs can search the web through a self-hosted SearXNG instance. Always-on toggle or per-chat globe button. The LLM decides when to search.

**v1.1.2** — Request queuing. Each user now has a per-user FIFO queue for chat requests. Concurrent requests process in order; up to 5 can be pending per user.

**v1.1.1** — Session isolation fix. Logout and session expiry fully clear all in-memory state. Login modal non-dismissible when auth is required.

See [CHANGELOG.md](CHANGELOG.md) for the full release history.
