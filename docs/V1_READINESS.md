# v1.0.0 readiness

> Status: **on track for v1.0.0** after v0.9.4. Every item on the original
> v0.9.x phase plan is shipped, tested, and documented.

This document is the audit trail. If anything below regresses, v1.0.0
should not ship until it is restored.

## v0.9.x phase recap

| Slice      | What it shipped                                                       | ADR                                                     |
| ---------- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| **v0.9.0** | Developer surfaces (web inspector + VS Code) — read-only projections. | [ADR-0011](adr/0011-developer-surfaces.md)              |
| **v0.9.1** | Schema versioning, formal contracts, corruption quarantine.           | [ADR-0012](adr/0012-schema-versioning.md)               |
| **v0.9.2** | Snapshot / import / export + failure-injection contract.              | [ADR-0013](adr/0013-snapshots-and-failure-injection.md) |
| **v0.9.3** | Scale: benchmark harness, per-chunk incremental indexing, compaction. | [ADR-0014](adr/0014-scale-and-performance.md)           |
| **v0.9.4** | Stability tiers, plugin manifest contract, SDK, MCP compat tests.     | [ADR-0015](adr/0015-api-stability-and-plugins.md)       |

## Core principles locked in for v1.0.0

From [ARCHITECTURE.md](ARCHITECTURE.md) §2 (in order added):

1. Cooperative, not omniscient.
2. Event-sourced truth.
3. Redaction is a boundary.
4. Local-first.
5. Seams over implementations.
6. Token efficiency (ADR-0010).
7. Surfaces are projections (ADR-0011).
8. Schemas are versioned; migrations are pure (ADR-0012).
9. Scale is measured, not assumed (ADR-0014).

## Compatibility matrix

| Dimension              | Supported                                                                                                               | Notes                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Node**               | `>=20` (per `package.json` engines)                                                                                     | Node 20 LTS minimum; tested on 20.x and 22.x. Node 24 is documented in the repo as the dev environment.               |
| **MCP SDK**            | `@modelcontextprotocol/sdk` `^1.12`                                                                                     | Pinned in `package.json`.                                                                                             |
| **Transports**         | stdio (production), in-process (tests).                                                                                 | HTTP/SSE not yet shipped; the seam is in place via `createServer()` returning a transport-agnostic `McpServer`.       |
| **Embedder providers** | `deterministic` (default, offline), `openai`, `voyage`, `ollama`, `custom` (any HTTP endpoint).                         | Set via `KAIRO_EMBEDDER`. Remote provider failure falls back to deterministic.                                        |
| **OS**                 | macOS, Linux, Windows.                                                                                                  | CI exercises macOS + Linux; the dev environment in this repo is Windows 11.                                           |
| **Filesystem**         | Local. POSIX permissions on Unix; standard NTFS on Windows.                                                             | `.kairo/` lives next to the project. No network FS assumptions baked in, but performance on networked FS is untested. |
| **Optional surfaces**  | VS Code 1.85+ (separate extension package); browser for the inspector (any modern browser; no JS required by the page). | Cursor speaks MCP — no Cursor-specific extension.                                                                     |

## v1.0.0 stability promise

Everything tagged `stable` in
[`src/contracts/stability.ts`](../src/contracts/stability.ts) at v0.9.4
becomes part of the v1.0.0 contract. See
[API_STABILITY.md](API_STABILITY.md) for the policy.

The headline guarantees:

- **33 stable MCP tools** with their argument names and types as
  documented at v0.9.4.
- **14 stable inspect routes** under the documented paths.
- **6 stable schema constants** (events, telemetry, audit, sessions,
  checkpoints, intelligence, vector index — all under ADR-0012).
- **Stable snapshot format** (`snapshotSchema: 1`).
- **Stable token-discipline contract** (ADR-0010): compact by default,
  reports to files.
- **Stable continuation-brief modes** (`tiny` / `normal` / `deep`) with
  their v0.8.2 budgets.

## v1.0.0 entry criteria

The following must all be true at v1.0.0:

- [x] Every documented surface has a stability tier.
- [x] Every schema has a centralised version constant and a migration
      registry.
- [x] Snapshot export/import is round-trip-deterministic.
- [x] Benchmark harness exists and is run on dogfood.
- [x] Incremental indexing is verified (≥1 reused chunk in a real
      mutation scenario).
- [x] Compaction is dry-run-by-default and lineage-protected.
- [x] SDK exists, is read-only, and has tests.
- [x] Plugin manifest contract exists; no in-process JS execution.
- [x] MCP compat tests assert tool surface + transport survival on bad
      input.
- [x] `181/181 tests` passing on the v0.9.4 commit.
- [x] `lint`, `typecheck`, `prettier`, `build` clean.

What is **not** required for v1.0.0 (deliberately out of scope):

- HTTP/SSE transport. The seam is in place; the implementation can land
  in a v1.x minor without breaking compat.
- In-process plugin code execution. The manifest contract is the v1.0
  promise; in-process loaders may come later behind an opt-in flag.
- A SaaS / hosted version. Out of scope by design (ADR-0011 §6).
- Real-time observability / push. Out of scope; v0.9.x is historical
  inspection only.

## Honest open questions for v1.x

These are intentionally **not** v1.0.0 blockers, but the team should
return to them in v1.x:

- **Networked filesystems.** Behaviour on NFS / SMB shares is
  untested. Likely-fine for read paths; the append-only event log and
  `writeAtomic` rename may behave differently. Document if you hit
  edge cases.
- **Very large event logs** (>1 GB). Compaction exists; performance of
  cold reads on logs that large is not benchmarked. The harness can
  measure it once a real-world fixture is available.
- **HTTP/SSE transport.** Demand-driven.
- **Embedder cost** for very large repos with a remote provider.
  v0.9.3's per-chunk incremental indexing helps a lot; production
  cost reporting would help more.

## How to verify readiness locally

```bash
git checkout v0.9.4
npm install
npm run typecheck
npm run lint
npm run format:check
npm test         # expect 181 passing
npm run build
```

If all green, you have a v0.9.4 build that is mechanically v1.0.0-ready.
The v1.0.0 release itself is a marketing decision plus a version bump and
moving every `experimental` tier entry that has been validated to
`stable`.
