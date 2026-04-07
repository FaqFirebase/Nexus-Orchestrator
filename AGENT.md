# AGENTS.md

## 0. Purpose

This file defines **mandatory rules, workflows, and standards** for all AI agents operating in this repository.

Agents must produce **complete, correct, production-ready code** that aligns with the existing codebase.

No shortcuts. No assumptions. No partial work.

---

## 1. Instruction Priority

Follow instructions in this order:

1. System
2. Developer
3. User
4. This file (`AGENTS.md`)
5. Tools

If instructions conflict, follow the higher-priority source.

---

## 2. Non-Negotiable Rules

The following are **absolute constraints**:

- NO partial implementations
- NO placeholders or deferred work
- NO simplifications when full implementation is possible
- NO code duplication
- NO dead code
- NO magic numbers or strings
- NO generic error handling
- NO inconsistent naming
- NO inconsistent APIs
- NO mixed concerns
- NO over-engineering
- NO callback hell
- NO resource leaks

Violating any of these = incorrect output

---

## 3. Required Workflow

Agents MUST follow this sequence:

### 3.1 Read Before Writing

Before making changes:

- Identify all relevant files
- Identify reusable functions and utilities
- Identify naming conventions
- Identify architectural patterns

If this is not done → DO NOT proceed

---

### 3.2 Plan Minimal Change

- Prefer modifying existing code over adding new code
- Reuse existing utilities/constants
- Keep changes minimal and atomic

---

### 3.3 Implement Fully

- Write complete production-ready code
- No pseudo-code
- No TODOs
- No placeholders

---

### 3.4 Add Tests

For every function:

- Add real, meaningful tests
- Cover edge cases and failure paths
- Ensure tests aid debugging

---

### 3.5 Validate Consistency

Ensure:

- Naming matches existing patterns
- APIs are consistent (params + return shapes)
- No duplicate logic introduced
- No unused code remains

---

### 3.6 Resource Safety

Ensure:

- Database connections are closed
- File handles are closed
- Timers are cleared
- Event listeners are removed

---

### 3.7 Deliver Final Result

- Provide complete working solution
- Do not defer work
- Do not suggest “next steps”

---

## 4. Code Standards

### 4.1 Naming

- Follow existing naming conventions exactly
- Use clear, descriptive, reusable names
- Do not introduce new naming patterns

---

### 4.2 Constants

- Replace all literals with named constants
- Do NOT hardcode values such as status codes, endpoints, or configuration values

#### ❌ BAD

```js
if (status === 200)
```

#### ✅ GOOD

```js
const STATUS_OK = 200

if (status === STATUS_OK)
```