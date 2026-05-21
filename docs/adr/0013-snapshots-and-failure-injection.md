# ADR-0013: Snapshot format & failure-injection contract

- Status: Accepted
- Date: 2026-05-21

## Context

v0.9.1 made schema versioning explicit and quarantined corruption. v0.9.2
closes the next two stabilization gaps:

1. **Snapshot / import / export.** A `.kairo/` directory is the source of
   truth for engineering memory over months of work. Moving it between
   machines, archiving it before a migration, sharing it with a colleague
   for triage, or restoring after a deletion — none of these work today
   without copying the whole directory verbatim and hoping paths and file
   permissions line up.
2. **Failure-injection testing.** Storage operations have many edge cases
   (mid-write rename failure, append EIO, ENOSPC, corrupted line, missing
   quarantine sink). Some are exercised by happy-path tests; most are not.
   The system needs a deterministic way to assert behaviour under fault.

This ADR commits to a portable snapshot format and an in-process fault
injection seam — both as part of the local-first, deterministic, replay-safe
contract.

## Decision

### 1. Snapshot is a single JSON document

A snapshot is **one self-describing JSON file** with a top-level manifest
plus the full contents of every persisted artefact. Choice of single file:

- Atomic by construction. No partial snapshots, no path-permission tangles.
- Trivially diffable, hashable, and signable.
- Easy to inspect with `jq`, easy to ship over email/Slack, easy to attach
  to a bug report.
- Compresses well externally (`gzip snapshot.json`); we don't bundle
  compression to keep the format obvious.

Cost: a very large `.kairo/` (gigabytes of events) produces a large file.
That is acceptable for v0.9.2 — durable archives are a primary use case,
and the format remains streamable in future versions if we hit a real
performance ceiling.

#### Schema

```jsonc
{
  "manifest": {
    "snapshotSchema": 1,
    "kairoVersion": "0.9.2",
    "createdAt": "2026-05-21T…",
    "sourceProjectRoot": "/abs/path/to/repo",
    "counts": {
      "events": 1234, "telemetry": 567, "audit": 12,
      "sessions": 8, "checkpoints": 12, "continuations": 12,
      "graphs": 4, "intelligence": 1, "vectorIndex": 1
    },
    "schemas": { "event": 1, "telemetry": 1, "audit": 1, "session": 1, "checkpoint": 1 },
    "contentSha256": "…"
  },
  "events":   [...],   // full event log, in order
  "telemetry":[...],
  "audit":    [...],
  "sessions": [...],
  "checkpoints":[...],
  "continuations":[{"name":"…","markdown":"…"}],
  "graphs":     [{"kind":"…","markdown":"…"}],
  "intelligence": { "latest": {…}, "byFingerprint": {…} },
  "vectorIndex":  {…} | null
}
```

`contentSha256` is computed over the canonical JSON of everything _except_
the manifest itself, so a snapshot is verifiable: two exports of the same
`.kairo/` produce snapshots whose `contentSha256` matches even if file
timestamps differ.

### 2. Import is opt-in destructive

`importSnapshot(target, snapshot, { force })`:

- If `target/.kairo/` exists and is non-empty, the import **refuses**
  unless `force: true` is passed.
- The import writes through the normal redaction + validation seam — a
  snapshot from a colleague cannot bypass redaction or skip migrations.
- Records inside the snapshot still flow through the v0.9.1 migration
  registry, so older snapshots upgrade transparently.
- Quarantine entries inside a snapshot are _not_ imported automatically;
  they're for the source operator to inspect before exporting.

### 3. Two new MCP tools

- `kairo_snapshot_export` — args `{ path?: string }`, default
  `.kairo/snapshots/snapshot-{ts}.json`. Returns the absolute path,
  `contentSha256`, and a compact counts summary.
- `kairo_snapshot_import` — args `{ path: string, force?: boolean }`.
  Returns the counts of records ingested and any validation warnings.

Both are file-IO MCP tools — they do not reach the network and they touch
only the local project root. Default response is the compact summary
(v0.8.2 token-discipline contract); the full manifest is in the file.

### 4. Failure-injection adapter

`src/storage/faultAdapter.ts` exposes a `FaultInjector` and a
`FaultInjectingAdapter` that wraps any `StorageAdapter`. Tests configure
deterministic rules:

```ts
const fi = new FaultInjector();
fi.failOn('appendEvent', { afterN: 3, error: new Error('EIO') });
fi.corrupt('readEvents', { lineNumber: 5, replaceWith: '{"id":' });
const adapter = new FaultInjectingAdapter(realAdapter, fi);
```

Honest scope:

- Faults are **in-process simulations**, not real disk failures. They
  prove the _handler_ code is correct (e.g. the quarantine path activates
  when a corrupt line appears); they cannot prove the OS layer is correct.
- A fault adapter must never wrap a production adapter at runtime — it is
  test-only by convention; the constructor logs a warning if `NODE_ENV !==
'test'`.

### 5. Backward compatibility

- `snapshotSchema` follows the same policy as ADR-0012: patch versions
  never bump it; minor versions add a migration in the same release.
- Snapshots from v0.9.2 must remain readable by every subsequent v0.9.x
  and v0.10.x with a documented migration.

## Consequences

- Operators can archive, share, and restore Kairo memory without
  filesystem gymnastics. The single-file format is the contract.
- Failure-injection tests catch regressions in error paths that would
  otherwise stay invisible until production storage flakes.
- The export path becomes a natural place to surface what _is_ and what
  _isn't_ in a Kairo snapshot — the `manifest.counts` block makes the
  contents auditable at a glance.
