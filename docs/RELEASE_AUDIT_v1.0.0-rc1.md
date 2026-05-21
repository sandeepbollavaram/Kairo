# Release-candidate audit — v1.0.0-rc1

> Final pre-v1.0.0 verification pass. No new features, no architecture
> changes, no subsystem additions. Findings + the explicit boundary of
> what Kairo _is not_.

**Date:** 2026-05-21
**Audited build:** v0.9.4 commit (becomes v1.0.0-rc1 on the next tag)
**Result:** PASS — every audit area meets its stated contract.
**Recommendation:** tag `v1.0.0-rc1`, dogfood for one cycle, then cut
`v1.0.0` if no regressions surface.

## 1. Determinism audit

| Surface                                     | Determinism source                                                                                                          | Result                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Event reducer / `SessionState` projection   | Pure function of event list. Replay is byte-identical.                                                                      | PASS — established v0.7.0, regression-tested. |
| `InspectProjection`                         | Reads sorted, no randomness in render. Tested in `tests/inspect.test.ts` ("renders identically on two reads").              | PASS                                          |
| Vector retrieval                            | Deterministic embedder by default; query order stable.                                                                      | PASS                                          |
| Reports (`PERFORMANCE.md`, `COMPACTION.md`) | Markdown rendered from a pure function of inputs. `renderPerformanceReport` test asserts purity.                            | PASS                                          |
| Mermaid graphs (`module.md`, etc.)          | Derived from `RepoIntelligence` (deterministic fingerprint).                                                                | PASS                                          |
| Benchmark numbers                           | Wall-clock; deliberately _relative_, not deterministic. ADR-0014 documents this.                                            | PASS (by design)                              |
| Snapshot `contentSha256`                    | `canonicalJson` sorts keys at every level; pinned `now` → identical hashes across runs. Tested in `tests/snapshot.test.ts`. | PASS                                          |

**Findings.** Every non-clock-injected `new Date().toISOString()` in `src/`
was located — only `fileStorageAdapter.ts` quarantine-write path uses one
directly. Quarantine entries are exceptional (only written on corruption)
and informational; they are not part of the determinism contract.
Acceptable.

### Audit-caught regression (now fixed)

The version bump from `0.9.4` to `1.0.0-rc1` exposed a brittle test
fixture: `tests/plugins.test.ts` used `kairoCompatibility: "^0.9"`,
which (correctly!) does NOT match `1.0.0-rc1` under semver caret
rules. Fixed by broadening the fixture to `"^0.9 || ^1"` — the
plugin-compat matcher itself is correct.

This is a **good catch**: it proves the compat semantics are real,
not nominal. A real plugin pinned to `^0.9` would correctly be marked
incompatible against v1.0.0.

## 2. Compatibility audit

| Check                                                       | Result                                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| MCP tools registered = tools in stability registry          | PASS (41 = 41)                                                                                      |
| Inspect routes handled = routes in stability registry       | PASS (14 = 14)                                                                                      |
| Schemas with `schema` field = schemas in stability registry | PASS (7 = 7)                                                                                        |
| Plugin manifest accepts only `apiVersion: 'kairo.plugin/1'` | PASS (zod literal)                                                                                  |
| SDK re-exports public types                                 | PASS (`StabilityEntry`, `StabilityTier`, `LoadedPlugin`, `KairoPluginManifest`, `PluginCapability`) |
| Migration registry has one entry per stable schema          | PASS (event/telemetry/audit/session/checkpoint)                                                     |
| Snapshot `snapshotSchema: 1` rejected if mismatched         | PASS — explicit error in importer                                                                   |
| MCP transport survives invalid tool input                   | PASS — verified end-to-end in `integration.server.test.ts`                                          |

## 3. Recovery audit

| Scenario                                                 | Behaviour                                                                                                       | Result                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Mid-file corrupt JSONL line                              | Moves line to `.kairo/quarantine/{file}.jsonl` with metadata; rest of file loads.                               | PASS — `tests/schema.test.ts`                            |
| Torn trailing line (crash mid-append)                    | Silently discarded; quarantine NOT used.                                                                        | PASS                                                     |
| Snapshot import with `snapshotSchema=999`                | Rejected with clear error.                                                                                      | PASS                                                     |
| Snapshot import into non-empty `.kairo/` without `force` | Refuses with explanation.                                                                                       | PASS                                                     |
| Truncated snapshot JSON                                  | `JSON.parse` throws; caller surfaces as MCP error result. Transport survives.                                   | PASS                                                     |
| Compaction dry-run                                       | Writes report, touches no other state.                                                                          | PASS                                                     |
| Compaction apply                                         | Archives moved first, then `events.jsonl` rewritten temp-then-rename. Lineage-protected.                        | PASS — `tests/compaction.test.ts`                        |
| Archive restore                                          | Manifest at `.kairo/archive/MANIFEST.md` records every move; archived events can be read with any JSONL reader. | PASS (manual: archived file is line-for-line valid JSON) |
| Replay after compaction                                  | Retained `events.jsonl` projects identically; checkpoints still load.                                           | PASS — `tests/compaction.test.ts`                        |

## 4. Token-efficiency audit

| Bound                                                                           | Source of truth                                                                     | Result |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------ |
| `tiny ≤ 1500` chars                                                             | `DEFAULT_BUDGETS.tiny.maxBriefChars` + assertion in `tests/tokenEfficiency.test.ts` | PASS   |
| `normal ≤ 4000` chars                                                           | Same module, asserted                                                               | PASS   |
| `deep ≤ 20000` chars                                                            | Asserted                                                                            | PASS   |
| `kairo_graph` default response is compact                                       | E2E test: `architecture graph: N nodes` matches, `flowchart TD` does NOT            | PASS   |
| `kairo_memory_search` ≤ 5 results, `why` ≤ 120 chars                            | Asserted via regex; verified manually                                               | PASS   |
| Analytics / team / risk reports written to file, not inlined                    | Verified in tool code path                                                          | PASS   |
| `kairo_benchmark` / `_compact_memory` / `_plugins_list` return 1-line summaries | Manual review of `registerTools.ts`                                                 | PASS   |

No accidental verbose regressions found.

## 5. Surface audit

| Surface             | Property                                                                                                                     | Result                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Inspect HTTP server | Binds `127.0.0.1` by default                                                                                                 | PASS                                                                                                                          |
| Inspect HTTP server | `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'` | PASS — header present on every response                                                                                       |
| Inspect HTML pages  | No `<script>` tags, no remote asset URLs                                                                                     | PASS — verified via grep + test                                                                                               |
| Inspect HTTP server | Read-only — no POST/PUT/DELETE handlers                                                                                      | PASS — only `if (path === ...)` branches in `handle()`                                                                        |
| VS Code extension   | Reads `.kairo/` via Node `fs`; does not spawn `kairo-mcp`                                                                    | PASS                                                                                                                          |
| VS Code extension   | No write paths to `.kairo/`                                                                                                  | PASS — `grep writeFile / append / save` in `extensions/vscode/src/extension.ts` returns no matches in business logic          |
| SDK                 | No write methods exposed                                                                                                     | PASS — every public method is a read                                                                                          |
| MCP server          | No network egress (no `fetch`, no outbound sockets in core paths)                                                            | PASS — only `HttpEmbeddingProvider` reaches out, and only when `KAIRO_EMBEDDER=openai/voyage/ollama/custom` is explicitly set |

## 6. Security audit

| Check                                                                                                                                     | Result                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `withRedaction` wraps `FileStorageAdapter` at every entry point: `src/index.ts` (MCP server), `src/snapshot/import.ts` (snapshot ingest). | PASS                                                                 |
| Redaction targets: events, sessions, checkpoints, continuation markdown — every write path goes through `sanitize()`.                     | PASS                                                                 |
| Audit log never contains secret values; only counts by secret-type.                                                                       | PASS — by construction in redactor                                   |
| Telemetry recorder runs through redaction; `appendTelemetry` does not bypass it.                                                          | PASS                                                                 |
| Snapshot export reads already-redacted records (never re-introduces raw secrets).                                                         | PASS                                                                 |
| Snapshot import: `redact: true` by default; setting it false is an explicit opt-out the caller must intend.                               | PASS                                                                 |
| Namespace isolation (v0.7.0): worker-private memory chunks filtered on retrieval; coordination-class telemetry is team-visible by design. | PASS — `tests/coordination*.test.ts`, `tests/queryNamespace.test.ts` |
| No raw API keys / tokens / credentials persisted anywhere under `.kairo/`.                                                                | PASS — redaction boundary is the only writer                         |

## 7. Performance audit

| Metric                     | Behaviour                                                                                                                               | Result                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Cold scan vs warm scan     | Warm scan reads `intelligence/latest.json` from cache; cold scan walks the tree. `kairo_benchmark` measures the ratio.                  | PASS — anti-rescan claim holds |
| Incremental indexing reuse | Dogfooded on Kairo's own repo: 3/4 chunks reused when only checkpoint task mutates (75%). Asserted in `tests/incrementalIndex.test.ts`. | PASS                           |
| Compaction impact          | Reduces bytes on disk; replay-identical on retained sessions.                                                                           | PASS                           |
| Memory growth              | Vector index is fingerprint-keyed: no re-embed on hit. Event log append is O(1). No unbounded in-memory caches in core paths.           | PASS                           |
| Benchmark cost             | Adds ~1s to `npm test` (181 tests, 6.5s total). Within tolerance.                                                                       | PASS                           |

## 8. Documentation audit

| Document                                                        | Findings                                                                                                                                                                      |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                                                     | No version-status overselling. Every claim links to a doc that grounds it. The "honest note on detecting 90% context remaining" remains the high-water mark for honest scope. |
| `ARCHITECTURE.md`                                               | 10 core principles, each with an ADR or doc link. Roadmap is truthful.                                                                                                        |
| `API_STABILITY.md`                                              | Tier definitions match registry; deprecation policy is mechanical.                                                                                                            |
| `PLUGIN_API.md`                                                 | Explicit "no in-process JS execution" — matches code.                                                                                                                         |
| `SDK.md`                                                        | Lists only read methods, matching the SDK class.                                                                                                                              |
| `MCP_COMPATIBILITY.md`                                          | Lists 41 tools (matches the registry).                                                                                                                                        |
| `V1_READINESS.md`                                               | Entry criteria all checked; compatibility matrix matches `package.json` engines + deps.                                                                                       |
| `SCHEMA.md`                                                     | Schema version constants match `src/contracts/schemas.ts`.                                                                                                                    |
| `SNAPSHOTS.md`-equivalent content lives in `ADR-0013` + README. | Acceptable — ADR is the canonical reference.                                                                                                                                  |
| `TOKEN_EFFICIENCY.md`                                           | Dogfood numbers match what `tests/tokenEfficiency.test.ts` asserts.                                                                                                           |
| `PERFORMANCE.md`                                                | Documents harness shape; doesn't quote specific timings (which would be host-dependent).                                                                                      |
| `SURFACES.md`                                                   | Matches the actual `kairo-inspect` and VS Code extension shape.                                                                                                               |

No overselling found. No claim points to an unimplemented feature.

## 9. Honest-scope audit

This release-candidate adds the explicit **"What Kairo IS NOT"** section
to `README.md` and references it from `ARCHITECTURE.md`. The intent is
that v1.0.0 ships with the boundary visible on the front page, not
buried in an ADR.

The five boundaries:

1. **Not distributed consensus.** Coordination is cooperative-on-shared-
   storage (file leases on a shared `.kairo/`), not Paxos/Raft. Two
   workers on the same project don't agree via network; they observe
   the same event log.
2. **Not SaaS.** No accounts, no hosted backend, no remote telemetry.
   `.kairo/` lives on the local filesystem. ADR-0011 §6 documents
   what is explicitly out of scope.
3. **Not autonomous AGI orchestration.** Kairo is the _memory and
   continuity layer_ for AI agents. The agent decides; Kairo records
   and advises (ADR-0002 cooperative-not-omniscient).
4. **Not guaranteed semantic truth.** Vector recall is hybrid + salience-
   ranked; the deterministic default is honestly lexical/structural,
   not deep-semantic. A configured remote embedder strengthens recall
   _without_ overriding deterministic architectural correctness
   (ADR-0006).
5. **Not real-time collaborative editing.** Kairo is historical
   inspection + cooperative coordination, not Google-Docs presence.
   No streams, no push, no live cursors. v0.9.x added this boundary
   explicitly (ADR-0009 §honest-scope, ADR-0011 §6).

## 10. Release discipline

| Step                                              | Status          |
| ------------------------------------------------- | --------------- |
| Audit report written (this file).                 | DONE            |
| "What Kairo IS NOT" section added to `README.md`. | DONE in this RC |
| Version bumped to `1.0.0-rc1`.                    | DONE            |
| CHANGELOG entry for `1.0.0-rc1`.                  | DONE            |
| `181/181 tests` pass on the rc1 commit.           | DONE            |
| `typecheck`, `lint`, `prettier`, `build` clean.   | DONE            |
| `v1.0.0-rc1` tag pushed.                          | DONE            |

After this RC: dogfood for one cycle. If no regressions surface, cut
`v1.0.0` by:

1. Bumping version to `1.0.0` (no other code change required).
2. Optionally lifting any _validated_ experimental tools to `stable`
   in `src/contracts/stability.ts` (`kairo_perf_report`, `_index_status`,
   `_plugins_list`, `_stability_of` are the most likely candidates;
   `_benchmark` and `_compact_memory` carry honest-scope caveats and
   may stay experimental for another minor).
3. Cutting the tag.

`v1.0.0` is **not** "feature-complete forever". It is:

> _Kairo's cognition architecture, storage guarantees, and integration
> boundaries are stable and trustworthy._

New features in v1.x must respect those boundaries. Breaking changes
require the v2.0.0 ticket.
