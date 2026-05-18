# Security Policy

## Reporting a vulnerability

Do **not** open a public issue for security vulnerabilities. Report privately via
GitHub's "Report a vulnerability" (Security Advisories) on the repository, or contact
the maintainer directly. You will receive an acknowledgement within a reasonable window.

## Threat model

Kairo persists session memory derived from an AI agent's work. That memory can
inadvertently contain secrets (env values, tokens, keys, DB URLs). The central security
guarantee of Kairo is:

> **No agent-supplied content is written to disk without passing through the redaction
> boundary first.**

### Controls in v0.1.0

- **Redaction boundary.** Every event payload and every checkpoint is passed through
  `src/security/redactor.ts` _before_ it is serialized to storage. This is enforced at
  the storage adapter seam, not left to individual call sites.
- **Detectors.** AWS keys, GitHub tokens (`ghp_/gho_/ghs_/github_pat_`), Google/Firebase
  API keys (`AIza…`), Slack tokens, Stripe (`sk_live_/rk_live_`), Razorpay
  (`rzp_live_/rzp_test_`), JWTs, PEM private-key blocks, connection strings with inline
  credentials, and `KEY=VALUE` assignments for secret-shaped names.
- **Audit logging.** When redaction fires, Kairo records _that_ it happened and the
  _types/count_ of secrets removed — never the secret value.
- **No network.** v0.1.0 makes no outbound network calls. Memory is local-first under
  `.kairo/`.
- **`.kairo/` is git-ignored** by default and `.env*`/`*.pem`/`*.key` are never tracked.

### Known limitations (documented honestly)

- Redaction is pattern-based and best-effort. Novel secret formats may slip through.
  Treat `.kairo/` as sensitive and do not commit it without review.
- Kairo cannot observe the agent's context window; the session-pressure model is a
  heuristic proxy, not a guarantee (see README).

## Supported versions

Pre-1.0: only the latest minor receives fixes.
