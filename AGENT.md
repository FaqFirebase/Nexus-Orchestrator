## Purpose

Defines mandatory rules for AI agents to produce complete, production-ready code aligned with the codebase.

---

## Instruction Priority

System → Developer → User → AGENTS.md → Tools

---

## Core Constraints (Non-Negotiable)

- No partial implementations or placeholders
- No duplication or dead code
- No magic numbers → use constants
- No generic error handling
- No inconsistent naming or APIs
- No mixed concerns
- No over-engineering or callback hell
- No resource leaks

---

## Required Workflow

### 1. Read First

- Identify relevant files, utilities, patterns, naming
- If not done → do not proceed

### 2. Plan Minimal Change

- Modify existing code when possible
- Reuse utilities/constants
- Keep changes minimal and atomic

### 3. Implement Fully

- Production-ready code only
- No TODOs, pseudo-code, or placeholders

### 4. Add Tests

- Test every function
- Cover edge cases and failures

### 5. Validate Consistency

- Match naming and patterns
- Ensure API consistency
- Remove unused/duplicate logic

### 6. Resource Safety

- Close connections/files
- Clear timers
- Remove listeners

### 7. Deliver

- Complete working solution only
- No deferred work or next steps

---

## Standards

### Naming

- Follow existing conventions
- Use clear, reusable names

### Constants

- Replace literals with named constants

#### ❌ BAD

```js
if (status === 200)
```

#### ✅ GOOD

```js
const STATUS_OK = 200
if (status === STATUS_OK)
```

