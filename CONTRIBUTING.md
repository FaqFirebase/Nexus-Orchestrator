# Contributing to Nexus Orchestrator

Thanks for your interest in contributing. This document covers how to get set up, what to work on, and how to submit changes.

---

## Getting Started

```bash
git clone https://github.com/FaqFirebase/Nexus-Orchestrator.git
cd nexus-orchestrator
npm install
cp .env.example .env   # fill in ADMIN_API_KEY and LOCAL_URL at minimum
npm run dev            # starts server + Vite HMR on :3000
```

You'll need:
- Node.js 20+
- An Ollama instance (or any OpenAI-compatible endpoint) for testing routing

---

## Project Structure

```
server.ts          # Express backend — API, auth, routing, SSE proxy
db.ts              # SQLite (better-sqlite3) — all database operations
crypto.ts          # AES-256-GCM encryption helpers
validation.ts      # Zod schemas for all API endpoints
logger.ts          # Pino logger setup
src/               # React frontend (Vite + Tailwind CSS v4)
  components/      # UI components grouped by feature
  hooks/           # Custom React hooks
  constants.tsx    # Category definitions, default config
tests/             # Vitest — validation schema tests
docs/              # User-facing guides
```

---

## Before You Submit

- **Run the tests:** `npm test` — all must pass
- **Type-check:** `npm run lint` — no TypeScript errors
- **Test the UI:** start `npm run dev` and exercise the feature you changed
- **No hardcoded cloud defaults** — provider URLs, models, and API keys must always start empty
- **No dead code** — remove anything unused
- **Follow existing patterns** — naming, error handling, logging, and validation style should match the surrounding code

---

## Commits

Format: `<type>(<scope>): <subject>`

| Type | When to use |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `chore` | Build, deps, config |
| `refactor` | Code change with no behaviour change |
| `test` | Adding or fixing tests |
| `perf` | Performance improvement |

Subject: imperative, ≤50 characters, no trailing period.

---

## Pull Requests

- One feature or fix per PR
- Include a short description of what changed and why
- Reference any related issue with `Fixes #N` or `Related to #N`
- PRs that add dependencies must justify the addition — keep the production bundle lean

---

## What to Work On

Check the [open issues](https://github.com/FaqFirebase/Nexus-Orchestrator/issues) for bugs and feature requests. The [ROADMAP.md](ROADMAP.md) lists planned work.

If you want to add something not already tracked, open an issue first to discuss it before writing code.

---

## Design Principles

- **Privacy first** — no data leaves the user's network unless they explicitly configure a cloud provider
- **No hardcoded cloud defaults** — all URLs, models, and keys start empty
- **Self-hosted friendly** — Unraid, Docker, local Ollama are first-class targets
- **Minimal production footprint** — frontend packages belong in devDependencies; the server runtime stays small
