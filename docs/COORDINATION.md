# Kairo Coordinated Cognition

> Multiple AI workers sharing **coherent engineering continuity** safely.
> Coordination infrastructure — not autonomous-agent hype. See
> [ADR-0007](adr/0007-coordinated-cognition.md).

## What this is (and is not)

- **Is:** a shared append-only event-sourced ledger + deterministic, cooperative
  file-based leases + memory namespaces + a distributed checkpoint graph.
- **Is not:** a network coordination service, a scheduler, consensus, or agents
  doing autonomous work. Kairo _advises_; the agents cooperate.

Multi-machine = sync `.kairo/` (git/rsync). The event log is the conflict-tolerant
substrate; every coordination view is a pure, deterministic projection of it.

## Primitives

### Workers & namespaces

`kairo_session_start` takes optional `worker` and `namespace`. Default namespace =
the worker id (per-worker isolation). Shared knowledge (structural / semantic /
operational / decision-from-ADRs) lives in the `workspace` namespace and is visible
to every worker. A worker's **session/decision memory is private** to its namespace
and is filtered out of other workers' retrieval — a deterministic step before
ranking, not an embedding effect. Pass `namespace: "workspace"` to share a worker's
session memory with the team.

### Cooperative leases (`kairo_lease`)

Advertise intent over a scope before working on it:

- `scopeKind`: `task` (exact string) | `path` | `module` (ancestor/descendant
  overlap, e.g. holding `src/core` blocks `src/core/session`).
- `acquire` → `GRANTED` or `DENIED` **with the conflicting holder and a reason**.
- `renew` extends the TTL; `release` frees it; leases also **expire** by TTL.
- Conflict resolution is deterministic by **log order**: the earliest overlapping
  lease wins; a later overlapping acquire is projected as `superseded`.
- Cooperative (ADR-0002): a denial is advisory. Kairo never preempts another
  process — two workers that ignore a denial can still both proceed; correctness
  comes from them honouring the advice.

### Distributed checkpoint graph (`kairo_timeline`)

Every checkpoint records its owning worker and a link to the prior checkpoint,
forming a DAG across all workers/sessions. `kairo_timeline` renders it as a
deterministic Mermaid graph — the coherent engineering timeline.

### Coordination status (`kairo_coordination_status`)

Enumerates active workers, held leases, scopes, owners and expiries — explainable
conflict prevention at a glance.

## Determinism & safety

- All state is a pure left-fold of the shared log. `Array.sort` is stable and we
  order by timestamp **only**, so equal-timestamp events keep append (causal) order
  — re-projection is byte-identical.
- Lease expiry is evaluated against an explicit clock; `state(asOf)` is reproducible.
- Denials are written to the non-secret audit log for traceability.

## Honest limitations

- **Cooperative file-based coordination, not partition-tolerant consensus.**
  Concurrent appenders rely on `O_APPEND` line atomicity; correctness comes from
  deterministic log-order projection (earliest lease wins), not locking. Suitable
  for same-host / shared-volume teams; not a distributed scheduler.
- Two workers that **ignore** a denied lease can still both act — Kairo advises,
  it does not enforce. The `superseded` projection makes the collision visible
  after the fact for audit.
- Namespace isolation is a visibility filter, not a security boundary: anything in
  the shared `.kairo/` is readable by anyone with filesystem access (as before;
  redaction still applies to all writes).

## Future (same ledger, more projections)

Shared-team cognition dashboards, architecture-evolution timelines, engineering
journals, PR-review memory — additional projections/event kinds, no redesign.
