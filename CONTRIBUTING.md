# Contributing to Kairo

Thank you for your interest in Kairo.

## Current contribution policy

Kairo is public for **visibility and transparency**, but it is in an early, fast-moving
architectural phase. To keep the design coherent:

- **External pull requests are not currently accepted** and will be closed without review.
- **Maintainership is restricted to the project owner.**
- **Issues and suggestions are very welcome** — bug reports, design critique, use-case
  feedback, and feature ideas all genuinely help shape the roadmap.

This policy will be revisited and relaxed once the core architecture (through ~v0.5.0)
stabilizes. The intent is not to discourage interest — it is to protect architectural
integrity while the foundations are being laid.

## How to help right now

- Open an issue describing your use case, a bug, or an architectural concern.
- Be specific and technical. Critique of the design is more valuable than agreement.
- If you have built something with Kairo, tell us what broke and what you wished existed.

## If you are the maintainer

- Small, logical, single-purpose commits.
- `npm run typecheck && npm run lint && npm test` must pass before every commit.
- New engines go behind the storage/adapter and tool-registration seams — never bypass
  the redaction boundary.
- Every persisted payload passes through `redactor.sanitize` with no exceptions.
- Update `CHANGELOG.md` under `[Unreleased]` in the same change.
- Architectural decisions get an ADR in `docs/adr/`.
