# ADR-0003: The GitHub engine is advisory — Kairo never mutates the repository

- Status: Accepted
- Date: 2026-05-19
- Supersedes: none

## Context

v0.4.0 adds a "GitHub engine": semantic commit messages, changelog fragments, and
release/version planning, all derived from Kairo's session ledger. The obvious
temptation is to let Kairo run `git commit`, `git tag`, and `git push` autonomously
("disciplined senior engineer that commits for you").

Kairo's two existing principles bear directly on this:

1. **Cooperative, not omniscient** (ADR-0002). Kairo is a separate process advising an
   agent; it does not own the workspace.
2. **Redaction is a boundary** (ADR-0001). Kairo is trusted _because_ its blast radius
   is bounded to `.kairo/`.

A commit/push is **outward-facing and hard to reverse**: it rewrites shared history,
can leak secrets the agent staged, and can trigger CI/CD and releases. An autonomous
mutation driven by heuristic session state is exactly the failure mode Kairo exists to
prevent in _agents_ — it must not commit it itself.

## Decision

The GitHub engine is **strictly advisory**. It may only:

- **Read** git state (`git status`, branch, tags, log) via read-only commands.
- **Generate text**: a proposed Conventional-Commits message, a changelog fragment, a
  release plan (suggested semver bump, tag, notes).

It will **never** execute `git add`, `git commit`, `git tag`, `git push`, or any
command that mutates the repository or its remotes. Kairo proposes; the human or the
calling agent disposes, using their own tools and judgement.

## Consequences

- Kairo's trust/safety story stays intact: its only writes remain inside `.kairo/`.
- The generated artifacts are deterministic and testable as pure functions.
- The unique value is not "automation" but **memory-informed proposals**: commit
  messages and release notes that reflect the _decisions and risk_ Kairo recorded
  during the session, not just the diff.
- If a future version ever performs mutation, it must be opt-in, sandboxed, and
  preceded by a new ADR superseding this one. It is out of scope here by design.
