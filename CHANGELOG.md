# Changelog

All notable changes to Kairo are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-05-18

### Added

- Production MCP server over stdio using the official `@modelcontextprotocol/sdk`,
  strict TypeScript, ESM, modular architecture.
- **Event-sourced storage engine**: append-only `events.jsonl` log, derived JSON
  snapshots, and human-readable markdown mirrors. Crash-safe and replayable.
- **`StorageAdapter` seam** with a local-first file adapter; redaction enforced at the
  adapter boundary so no engine can bypass it.
- **Security redactor**: detectors for AWS, GitHub, Google/Firebase, Slack, Stripe,
  Razorpay, JWT, PEM private keys, credentialed connection strings, and secret-shaped
  `KEY=VALUE` assignments; redaction audit logging without leaking values.
- **Session manager**: durable ledger of task, changed files, decisions, commands,
  errors, retries, heartbeats.
- **Checkpoint engine**: durable, resumable, sanitized checkpoints with manual,
  pressure-triggered, and session-end reasons.
- **Continuation-prompt engine**: generates a precise next-agent brief (architecture
  state, completed/remaining work, files to inspect, risks, blockers).
- **Cooperative session-pressure model**: risk-of-context-loss score from observed
  signals with `CONTINUE` / `CHECKPOINT_SOON` / `CHECKPOINT_NOW` directives.
- MCP tools: `kairo_session_start`, `kairo_session_status`, `kairo_record`,
  `kairo_heartbeat`, `kairo_checkpoint`, `kairo_continuation`, `kairo_session_end`.
- MCP resources `kairo://session/current` and `kairo://checkpoint/latest`, and the
  `kairo_continuity` cooperation prompt.
- Project documentation, ADRs, CI (lint/typecheck/test/build) and release workflows.

[Unreleased]: https://github.com/sandy001-kki/Kairo/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/sandy001-kki/Kairo/releases/tag/v0.1.0
