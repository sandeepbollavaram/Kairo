# ADR-0007: Coordinated cognition over a shared event-sourced ledger

- Status: Accepted
- Date: 2026-05-19
- Related: ADR-0001 (event-sourced/local-first), ADR-0002 (cooperative),
  ADR-0005/0006 (memory)

## Context

v0.7.0 lets multiple AI workers share coherent engineering continuity. The hype
reading — autonomous agents, a network coordination service, consensus — is
explicitly rejected: it would break offline-safe, add a distributed-systems failure
surface, and is not what "coordinated cognition" needs.

## Decision

Coordination is **the existing append-only event log used as a shared ledger**, plus
deterministic, file-based leases. No network service, no consensus protocol.

1. **One shared ledger.** Workers append coordination events
   (`worker.registered`, `lease.acquired/renewed/released`) to the same
   `.kairo/events.jsonl`. Multi-machine = sync `.kairo/` (git/rsync); the log is the
   conflict-tolerant substrate. `CoordinationManager` is a pure projection of the log
   (same pattern as the session reducer) — deterministic and crash-safe.

2. **Cooperative leases, not locks.** A lease advertises intent over a scope
   (task / path / module) with a TTL. Acquisition is conflict-checked against active
   leases; on overlap Kairo **advises** (it never preempts another process —
   ADR-0002). Conflict resolution is deterministic: by log order the **earlier**
   holder wins; a later overlapping acquire is projected as `superseded`. Expiry is
   deterministic against the clock.

3. **Checkpoint ownership + distributed checkpoint graph.** Checkpoints carry an
   owning worker and a parent link, forming a DAG across workers/sessions — the
   engineering timeline, rendered deterministically as Mermaid.

4. **Memory namespaces + retrieval isolation.** Shared knowledge (structural /
   semantic / operational / decision) lives in the `workspace` namespace and is
   visible to all workers. A worker's session memory is namespaced to that worker and
   is **not** returned to another worker unless explicitly shared. The filter is a
   deterministic, explainable step — not an embedding effect.

5. **Explainable throughout.** Every lease decision returns a reason and the
   conflicting holder; coordination status enumerates workers, leases, and ownership.

## Consequences

- Offline-safe, deterministic, crash-safe multi-worker coordination on a single host
  or a shared/synced volume.
- Honest limitation (stated, not hidden): this is **cooperative file-based
  coordination, not partition-tolerant consensus**. Concurrent appenders rely on
  `O_APPEND` line atomicity; correctness comes from deterministic log-order
  projection (earliest lease wins), not locking. Two workers that ignore a denied
  lease can still both proceed — Kairo advises, the agents cooperate. Suitable for
  same-host / shared-volume teams; not a substitute for a distributed scheduler.
- Retrieval stays hybrid and never embedding-only; namespace isolation is an
  additional deterministic filter, not a ranking change.
- Foundational for future shared-team cognition / evolution timelines as more
  projections over the same ledger — no redesign.
