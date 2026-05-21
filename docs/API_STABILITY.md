# API stability

> Every Kairo integration surface has an explicit tier (ADR-0015). v1.0.0's
> stability promise is mechanical: anything `stable` here stays callable
> with the same shape on every v1.x release.

## Tiers

| Tier               | Promise                                       | Allowed changes                                                                                         |
| ------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **`stable`**       | Part of the v1.0.0 contract.                  | Additive only (new optional args, new tools). Removals / renames require a one-minor deprecation cycle. |
| **`experimental`** | Useful but not yet promised.                  | May change in minor versions; called out in CHANGELOG.                                                  |
| **`internal`**     | Implementation detail.                        | Anytime, no notice.                                                                                     |
| **`deprecated`**   | Replaced; still works for at least one minor. | Removed in the next minor; CHANGELOG flags the replacement.                                             |

Anything missing from the registry is treated as `internal` by default —
surfaces opt into the contract explicitly via
[`src/contracts/stability.ts`](../src/contracts/stability.ts).

## Surfaces and v0.9.4 baseline

### MCP tools

**Stable** (33 tools): every continuity-loop, intelligence, risk, GitHub,
graph, memory, coordination, telemetry, analytics, query, brief, and
snapshot tool — see the registry file for the exact list and the version
in which each became stable.

**Experimental** (6 tools): `kairo_benchmark`, `kairo_perf_report`,
`kairo_compact_memory`, `kairo_index_status`, `kairo_plugins_list`,
`kairo_stability_of`. These may grow new arguments or refine outputs in
v0.9.x; v1.0.0 will lift the stable ones into the promise.

### MCP prompt + resources (all stable, since v0.1.0)

- Prompt: `kairo_continuity`
- Resource: `kairo://session/current`
- Resource: `kairo://checkpoint/latest`

### Inspect HTTP routes (all stable, since v0.9.0)

`/`, `/sessions`, `/sessions/:id`, `/checkpoints`, `/checkpoints/:id`,
`/continuations/:name`, `/timeline`, `/graphs`, `/graphs/:kind`, `/memory`,
`/coordination`, `/risk`, `/events`, `/retrieval/:id`. HTML _content_ may
evolve for clarity; route paths may not.

### Schemas (stable, ADR-0012)

`KairoEvent`, `TelemetryEvent`, `AuditEntry`, `SessionState`, `Checkpoint`,
`RepoIntelligence`, `VectorIndex`. Patch versions never bump them; minor
versions only bump with a same-release migration.

### Snapshot format (stable)

`snapshotSchema: 1` — manifest shape and `contentSha256` rule.

## Deprecation policy

When a `stable` surface is deprecated:

1. **One minor version's notice** in the CHANGELOG with the replacement.
2. MCP tool descriptions get a leading `DEPRECATED (use X):`; inspect
   routes still return the same content but log a single audit entry per
   process life.
3. The registry moves it to `deprecated`.
4. Removal happens in the **next minor version**, never inside a patch.

Migration tooling — when needed — ships in the same release as the
change, never before.

## Programmatic access

- **SDK:** `new KairoClient().stabilityOf('kairo_session_start')` →
  `{ tier: 'stable', surface: 'mcp-tool', since: '0.1.0', ... }`.
- **MCP tool:** `kairo_stability_of` with `{ id: 'kairo_brief' }` or
  with no argument to dump the full registry.

The registry is the single source of truth. CI for downstream consumers
should assert any surfaces they depend on are still `stable`.

## Honest scope

- Stability tiers are a **contract**, not enforcement. A tool can still
  panic at runtime; the tier governs _what changes are allowed_, not
  _what runtime invariants hold_.
- Experimental surfaces are still useful — they just don't carry a
  cross-minor promise yet.
- Internal surfaces have no contract. Don't depend on them.
