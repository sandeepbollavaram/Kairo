# ADR 0001 — Event-sourced storage with derived snapshots

- Status: Accepted
- Date: 2026-05-18

## Context

Kairo persists AI engineering memory that must survive crashes, model switches, and
session exhaustion, and must support future features explicitly requested in the vision:
failure replay, self-healing checkpoints, engineering timeline, and architecture
evolution tracking.

Options considered:

1. **Loose mutable JSON state files.** Simple, but mutation in place is not crash-safe
   (a torn write loses state), is not auditable, and cannot reconstruct history.
2. **SQLite.** Durable and queryable, but opaque to humans/agents inspecting memory,
   and heavier for a local-first v0.1.
3. **Event sourcing**: append-only log as source of truth, with derived snapshots and
   markdown mirrors for fast/human reads.

## Decision

Adopt **event sourcing**. `events.jsonl` is append-only and authoritative. Session
snapshots, checkpoints, and markdown are projections rebuildable by replay.

## Consequences

- Crash safety: appends are atomic at the line level; a partial last line is detectable
  and discardable without losing prior history.
- Replay/audit come for free, enabling roadmap features (failure replay, self-healing,
  timeline) without new persistence machinery.
- A `StorageAdapter` interface hides the backend; SQLite or a vector store can be added
  later without touching engines.
- Cost: snapshots must be kept consistent with the log. Mitigated by always appending
  the event first, then deriving the snapshot from the in-memory reduced state.
