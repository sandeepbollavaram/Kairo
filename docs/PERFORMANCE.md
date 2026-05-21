# Performance, incremental indexing & compaction

> Scale, performance, and storage efficiency. See
> [ADR-0014](adr/0014-scale-and-performance.md).

v0.9.3 adds the apparatus to **measure** Kairo and the two storage moves the
measurements most obviously demand: **per-chunk incremental indexing** and
**explainable memory compaction**. No new cognition features — this slice is
pure infrastructure.

## Benchmark harness

Run the deterministic suite over the current project:

```jsonc
{ "name": "kairo_benchmark", "arguments": { "iterations": 5 } }
```

Output goes to `.kairo/reports/PERFORMANCE.md` and the MCP response carries a
1-line summary. Standard scenarios:

| Scenario                                     | Measures                               |
| -------------------------------------------- | -------------------------------------- |
| `repo.cold-scan`                             | First full scan (force=true)           |
| `repo.warm-scan`                             | Cached intelligence read               |
| `graph.generate`                             | Reading the rendered graph mirrors     |
| `inspect.projection`                         | `InspectProjection.overview()` cost    |
| `brief.tiny` / `brief.normal` / `brief.deep` | Continuation brief generation per mode |
| `snapshot.export`                            | Full `.kairo/` → single JSON           |

Each scenario reports `min / median / p95 / max` over N iterations plus
scenario-specific counters. Wall-clock timings depend on the host — the
harness is for **relative** comparison and regression detection, not absolute
benchmarking.

## Per-chunk incremental indexing

Before v0.9.3: when the `memoryFingerprint` (hash of the full chunk set)
changed, **every** chunk was re-embedded. That was wasteful — most chunks
are byte-identical between two checkpoints.

After v0.9.3: the rebuild path looks up each new chunk by
`sha256(chunk.text)` against the existing index. If the hash matches and the
embedder id matches, the existing vector is **reused**; only chunks whose
text actually changed get embedded.

The new `IndexResult` counters expose this:

```ts
{
  chunks: 24,         // total chunks in the new index
  embedded: 3,        // newly embedded
  reusedVectors: 21,  // cached vectors reused per-chunk
  reused: false,      // top-level memoryFingerprint match (false = rebuild ran)
  fellBack: false,
}
```

Preserved invariants:

- **Output ordering is deterministic** — the chunker still emits chunks in a
  fixed order; cache lookup does not reorder.
- **Embedder id integrity** — the `embedderId` stamped on the index is still
  the provider actually used. A configured remote provider that fails still
  falls back to deterministic for _new_ chunks; reused vectors are untouched.
- **`memoryFingerprint`** still means "the set of chunk texts" — unchanged
  across this optimisation.

Dogfood on Kairo itself: mutating one checkpoint task forces a rebuild but
**3 of 4 chunks** are reused (75%). Larger projects with many sessions and
decisions will see substantially higher reuse rates.

## Memory compaction (explainable, dry-run-first)

Long-lived event logs eventually become the storage hotspot. Compaction
archives — never deletes — events from ended sessions older than
`olderThanDays`:

```jsonc
{ "name": "kairo_compact_memory", "arguments": { "dryRun": true } }
```

Defaults to **dry-run**. The report at `.kairo/reports/COMPACTION.md` lists
every session and the per-session decision (`archived` or `retained`) with a
reason. To apply:

```jsonc
{ "name": "kairo_compact_memory", "arguments": { "dryRun": false, "olderThanDays": 90 } }
```

### Rules (conservative on purpose)

1. **Session must be ended.** A session without `session.ended` is never
   archived.
2. **Older than the cutoff.** Default 90 days; configurable per call.
3. **Lineage protection.** Events whose `sessionId` is referenced by any
   surviving checkpoint are **never** archived.
4. **Move, never delete.** Archived events go to
   `.kairo/archive/events-{ts}.jsonl`; the manifest at
   `.kairo/archive/MANIFEST.md` records what was moved, when, and how many
   events.
5. **Atomic apply.** The archive is written first; then `events.jsonl` is
   rewritten temp-then-rename. A crash mid-compaction leaves the original
   log intact.
6. **No automatic compaction.** The operator runs `kairo_compact_memory`
   when they choose to.

### Replay-safety check

After a non-dry-run, every existing checkpoint must still load identically
and the `events.jsonl` projection through the session reducer must still
reproduce the same `SessionState` for every retained session. The test
suite exercises this directly.

## `kairo_index_status`

Compact, single-line status for the vector index:

```
Index: 24 chunks, embedder kairo-deterministic-hash-v1, dim 256.
       repo=ab12cd34ef56… memory=78fe09da42…
```

Useful as a quick sanity check before/after compaction or after switching
embedder providers.

## Honest scope (consolidated)

- Benchmarks measure **relative** behaviour, not absolutes. Don't compare
  numbers across hosts.
- Incremental indexing reduces **embed work**, not chunk-build work. The
  chunker still runs in full (it's already deterministic + offline).
- Compaction reduces **bytes on disk**. It does not change cold-scan or
  replay times meaningfully until the log is large, and it deliberately
  keeps an archive — Kairo never silently deletes recovery data.
- First-iteration compaction is **conservative**: false negatives ("did not
  archive an event that could safely have been archived") are preferred
  over false positives ("archived something replay needs").
