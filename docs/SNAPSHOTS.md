# Snapshots & failure injection

> Portable `.kairo/` archives + deterministic fault simulation. See
> [ADR-0013](adr/0013-snapshots-and-failure-injection.md).

v0.9.2 ships two operational-maturity primitives:

1. A single-file snapshot format for the full `.kairo/` state.
2. An in-process fault-injection adapter for testing error paths.

## Snapshot format

A snapshot is **one JSON document** with a manifest plus the full contents
of every persisted artefact:

```jsonc
{
  "manifest": {
    "snapshotSchema": 1,
    "kairoVersion": "0.9.2",
    "createdAt": "2026-05-21T…",
    "sourceProjectRoot": "/abs/path",
    "counts": { "events": …, "telemetry": …, "sessions": …, "checkpoints": …, … },
    "schemas": { "event": 1, "telemetry": 1, "audit": 1, "session": 1, "checkpoint": 1, … },
    "contentSha256": "…"
  },
  "events":         [ … ],
  "telemetry":      [ … ],
  "audit":          [ … ],
  "sessions":       [ … ],
  "checkpoints":    [ … ],
  "continuations":  [ { "name": "…", "markdown": "…" } ],
  "graphs":         [ { "kind": "…", "markdown": "…" } ],
  "intelligence":   { "latest": …, "byFingerprint": { … } },
  "vectorIndex":    …
}
```

`contentSha256` is computed over a **canonical** JSON serialisation of the
content payload (keys sorted at every level). Two exports of the same
`.kairo/` produce snapshots whose `contentSha256` matches — independent of
file timestamps.

## Export

MCP:

```jsonc
{
  "name": "kairo_snapshot_export",
  "arguments": { "path": "/abs/snap.json" }, // optional
}
```

Default destination is `.kairo/snapshots/snapshot-{ts}.json`. The response
is a single line:

```
Snapshot: 18432 bytes → /…/snapshot-….json. events=24 telemetry=6 sessions=1 checkpoints=2 sha256=ab12cd34ef56…
```

The full manifest is structured in the response payload for programmatic
consumers.

## Import

MCP:

```jsonc
{
  "name": "kairo_snapshot_import",
  "arguments": {
    "path": "/abs/snap.json",
    "projectRoot": "/abs/target",
    "force": false, // default
    "redact": true, // default
  },
}
```

- Refuses to overwrite a non-empty `.kairo/` unless `force: true`.
- Writes through the redacting adapter — a snapshot from another machine
  cannot bypass the redaction boundary.
- Records pass through the v0.9.1 migration registry on the way in, so
  older snapshots upgrade transparently.
- Quarantine entries inside a snapshot are **not** imported (they belong
  to the source operator to inspect).

Round-trip guarantee: `export → import → re-export` yields the same
`contentSha256` for a clean source with no secrets.

## Failure injection

`src/storage/faultAdapter.ts` provides a deterministic, in-process fault
simulator for storage operations:

```ts
import { FaultInjector, FaultInjectingAdapter } from 'kairo-mcp/dist/storage/faultAdapter.js';

const fi = new FaultInjector()
  .failOn('appendEvent', { afterN: 3, error: new Error('EIO') })
  .failOn('readEvents', { repeating: true });

const adapter = new FaultInjectingAdapter(realAdapter, fi);
```

Rule fields:

| field       | meaning                                                      |
| ----------- | ------------------------------------------------------------ |
| `afterN`    | Trigger on the Nth call (1-indexed). Default 1.              |
| `repeating` | Trigger every call after `afterN`. Default false (one-shot). |
| `error`     | The `Error` to throw. Defaults to a generic message.         |

Honest scope:

- Faults are **simulations**, not real disk failures. They prove the
  handler code is correct (e.g. that the caller releases a lease when
  `appendEvent` throws); they cannot prove the OS layer is correct.
- `FaultInjectingAdapter` is **test-only by convention**. The constructor
  logs a warning when `NODE_ENV !== "test"` and the harness has not set
  `VITEST=true`. Do not wrap a production adapter at runtime.

## What snapshots are NOT

- Not encrypted. Plain JSON. If your `.kairo/` contains secrets that
  redaction did not catch, the snapshot does too.
- Not delta / incremental. Every export is a full dump.
- Not signed. `contentSha256` proves integrity, not authenticity. Sign
  the file externally (gpg, sigstore) if you need that.
- Not streaming. The whole snapshot is loaded into memory on both ends.
  Large `.kairo/` directories produce large files; gzip externally.
