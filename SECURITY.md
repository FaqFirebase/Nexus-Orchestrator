# Security Policy

## Supported Versions

Only the latest release receives security fixes. No backports are made to older versions.

| Version | Supported |
|---------|-----------|
| Latest  | ✅ Yes    |
| Older   | ❌ No     |

---

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Use [GitHub private security advisories](https://github.com/FaqFirebase/Nexus-Orchestrator/security/advisories/new) to report issues privately. This keeps the details off public record until a fix is available.

Include in your report:
- Nexus Orchestrator version
- Steps to reproduce
- What an attacker could achieve

This is a single-maintainer project. Expect an acknowledgement within a few days. Fix timeline depends on severity — critical issues are prioritised.

---

## Scope

**In scope:**
- Authentication or session bypass
- Privilege escalation (user → admin)
- SSRF beyond the current blocklist
- XSS in the chat UI or any rendered output
- SQL injection via API inputs
- Disclosure of stored API keys, passwords, or user data

**Out of scope:**
- Vulnerabilities in Ollama or other upstream providers — report those to their maintainers
- Issues that require physical access to the host machine
- Misconfiguration by the operator (e.g. exposing the instance publicly without HTTPS or a reverse proxy)
- Resource exhaustion or DoS on self-hosted hardware
