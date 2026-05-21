# ADR-0014: Scale, performance, and storage efficiency

- Status: Accepted
- Date: 2026-05-21

## Context

v0.9.1 and v0.9.2 closed the durability and portability gaps. The remaining
infrastructure gap is **scale**: can Kairo handle a year of engineering
memory, a 50k-file repository, or a 200-MB event log without losing the
determinism, token-efficiency, or replay safety guarantees that earlier ADRs
locked in?

We don't know today, because the system has no way to measure itself. Every
performance claim in the docs is a guess. v0.9.3 builds the apparatus to
turn those guesses into numbers, and ships the two storage-efficiency moves
that the apparatus most obviously requires: **incremental indexing** and
**memory compaction**.

This is explicitly **not** random optimisation. Each change must (a) be
measurable, (b) preserve determinism and replay-safety, and (c) leave the
honest scope visible.

## Decision

### 1. Deterministic benchmark harness (`src/perf/`)

A pure, in-process benchmark runner with these scenarios:

| Scenario                   | Measures                                  | Why                |
| -------------------------- | ----------------------------------------- | ------------------ |
| `repo.cold-scan`           | First full scan of a project root         | Anti-rescan claim  |
| `repo.warm-scan`           | Cached intelligence read                  | Confirms the cache |
| `graph.generate`           | Module / service / arch / pipeline graphs | Inspector + brief  |
| `vector.index.cold`        | Full embed + index build                  | Memory subsystem   |
| `vector.index.warm`        | No-op when memoryFingerprint matches      | Anti-rebuild claim |
| `vector.index.incremental` | Re-embed only changed chunks              | v0.9.3             |
| `snapshot.export`          | Full `.kairo/` → single JSON              | v0.9.2             |
| `snapshot.import`          | Snapshot → empty target                   | v0.9.2             |
| `inspect.projection`       | `InspectProjection.overview()` cost       | v0.9.0             |
| `brief.generate`           | Continuation brief in each mode           | v0.8.2             |

Each scenario reports `min / median / p95 / max` over N iterations, plus
cache `hit/miss` counters. The runner emits both a structured result object
(programmatic) and a human-readable `.kairo/reports/PERFORMANCE.md`.

**Honest scope:** wall-clock timings depend on the host. The harness is for
_relative_ comparison ("warm scan is 50× faster than cold") and regression
detection, not absolute benchmarking.

### 2. Per-chunk incremental vector indexing

Today's behaviour: when the `memoryFingerprint` (hash of the full chunk set)
changes, every chunk is re-embedded. That is wasteful — most chunks are
unchanged between two checkpoints.

v0.9.3 changes the rebuild path: build the new chunk set, then for each new
chunk look up the existing index by `(embedderId, sha256(text))`. If the
hash matches, **reuse the existing vector**; only chunks whose `text`
changed get embedded.

Preserved invariants:

- Output ordering is deterministic (same as today — chunks are emitted by
  the chunker in a fixed order, not by the cache lookup).
- The `embedderId` stamped on the index is still the provider actually used.
- A configured remote provider that errors still falls back to deterministic
  for the **new** chunks; reused vectors are untouched.
- `memoryFingerprint` continues to mean "the set of chunk texts" — it is
  unchanged across the optimisation.

The result includes new counters: `embedded` (newly embedded), `reused`
(vector cache hits), `total`. These flow into `kairo_index_status`.

### 3. Memory compaction (dry-run-first)

A long-lived event log eventually becomes the storage hotspot. v0.9.3 adds
**explicit, explainable, opt-in compaction**:

`src/core/compaction/` exposes `planCompaction(adapter, opts)` and
`applyCompaction(adapter, plan)`:

```ts
interface CompactionPlan {
  candidateEvents: number; // events the plan WOULD archive
  retainedEvents: number; // events that MUST stay (replay-safety)
  candidateSessions: string[]; // session IDs whose tail is fully ended
  archivePath: string; // .kairo/archive/events-{ts}.jsonl
  reasons: CompactionReason[]; // per-decision explanation
}
```

Rules — **conservative on purpose**:

1. Only events whose `sessionId` belongs to a session with status `ended`
   are candidates.
2. Only sessions whose ended-at is older than `olderThanDays` (default 90)
   are candidates.
3. Events referenced by any checkpoint's lineage chain are **never**
   archived. Lineage walks recursively; if any descendant survives, the
   ancestor stays.
4. Archived events are **moved**, not deleted: they go to
   `.kairo/archive/events-{ts}.jsonl`, and a manifest at
   `.kairo/archive/MANIFEST.md` records what was moved, when, and why.
5. `dryRun: true` (default) writes the report but touches nothing.
6. Applying compaction also rewrites `events.jsonl` atomically
   (temp-then-rename) so a crash mid-compaction leaves the original log
   intact.

Replay-safety check: after a non-dry-run, every existing checkpoint must
still load identically and the `events.jsonl` projection through the
session reducer must reproduce the same `SessionState` for every retained
session.

Honest scope: compaction reduces _bytes on disk_. It does not change cold
scan or replay times by a meaningful amount until the log is large, and it
deliberately keeps an archive — Kairo never silently deletes recovery data.

### 4. Four new MCP tools

- `kairo_benchmark` — args `{ scenarios?: string[]; iterations?: number }`.
  Runs the suite, writes the report, returns a compact summary.
- `kairo_perf_report` — returns the path + summary of the latest report.
- `kairo_compact_memory` — args `{ dryRun?: boolean; olderThanDays?: number }`.
  Default `dryRun: true`.
- `kairo_index_status` — returns vector-index stats including incremental
  hit/miss counters.

All four respect the v0.8.2 compact-by-default contract: response is a
single-line summary, full reports written to `.kairo/reports/`.

## Consequences

- Performance claims become testable. Regression tests can assert that
  warm scans are faster than cold, that incremental indexing reuses some
  N% of vectors, etc.
- Storage growth has a brake. A team that has been using Kairo for a year
  can compact the first eleven months into the archive without losing the
  ability to inspect what happened or restore.
- v0.9.3 does **not** introduce new cognition features. It is pure
  infrastructure work — the kind of work that lets v1.0.0 be a stable
  production release rather than a rebrand.

## Honest scope (consolidated)

- Benchmarks measure relative behaviour, not absolutes.
- Incremental indexing reduces embed work, not chunk-build work; the
  chunker still runs in full (it's already deterministic and offline).
- Compaction is **conservative by default**. The first iteration prefers
  false negatives ("did not archive an event that could safely have been
  archived") over false positives ("archived something replay needs").
- No automatic compaction. The operator runs `kairo_compact_memory` when
  they choose to.
