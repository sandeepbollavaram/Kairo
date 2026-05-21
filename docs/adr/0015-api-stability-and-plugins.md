# ADR-0015: API stability, plugin model & deprecation policy

- Status: Accepted
- Date: 2026-05-21

## Context

By v0.9.3 Kairo has 32 MCP tools, an inspect HTTP surface, a VS Code
extension, a snapshot format, a benchmark harness, a vector index, and a
schema/migration registry. v1.0.0 will be a stability promise — everything
in scope of that promise needs an explicit tier, a documented evolution
policy, and an integration boundary that third parties can build on
without reading the source.

v0.9.4 commits to those boundaries. It is **not** a feature release: no new
cognition system, no new persisted artefact, no embedder change. It is the
slice that lets v1.0.0 be a real stability promise rather than a rebrand.

## Decision

### 1. Four stability tiers

Every Kairo integration surface carries an explicit tier:

| Tier               | Promise                                                    | When it may change                                               |
| ------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| **`stable`**       | Part of the v1.0.0 stability contract.                     | Major versions only; with a one-minor-version deprecation cycle. |
| **`experimental`** | Useful but not yet promised. May change in minor releases. | Minor or patch; called out in CHANGELOG.                         |
| **`internal`**     | Implementation detail. Not for external consumers.         | Anytime.                                                         |
| **`deprecated`**   | Replaced; still works for at least one minor.              | Removed in a later minor; CHANGELOG flags the replacement.       |

Tiers are declared by name in `src/contracts/stability.ts`. Every MCP tool,
inspect route, snapshot field, telemetry kind, and schema constant has an
entry. Anything missing from the registry is treated as `internal` by
default — surfaces opt into the contract explicitly.

### 2. v1.0.0 stability scope (what becomes `stable`)

**MCP tools.** All 32 currently-shipping tools, with their argument names
and types as documented at v0.9.4. Adding a new optional argument is
back-compat; renaming or removing an argument requires deprecation.

**Inspect HTTP routes.** Paths under `/`, `/sessions`, `/checkpoints`,
`/timeline`, `/graphs`, `/memory`, `/coordination`, `/risk`, `/events`,
`/retrieval/`, `/continuations/`. HTML content may change for clarity;
route paths may not.

**Snapshot format** (`snapshotSchema: 1`). Manifest shape and content
hashing rules are stable. New optional manifest fields are back-compat.

**Schema constants** under ADR-0012. Patch versions never bump them;
minor versions bump only with a same-release migration.

**Continuation brief modes** (`tiny` / `normal` / `deep`) and their
character budgets at the v0.8.2 levels.

**`SERVER_VERSION`** semver shape and the MCP server `name: 'kairo'`.

**Token-discipline contract** (ADR-0010): tool responses default to compact;
reports go to `.kairo/reports/`.

### 3. Plugin model (no in-process code execution)

Kairo's plugin contract is a **manifest contract**, not a code-loading
contract. Plugins do not run inside the Kairo MCP server. They are
external processes — typically other MCP servers — that Kairo _declares_,
_describes_, and lists. The host (Claude Desktop, Cursor, the IDE, etc.)
loads them via its own MCP config; Kairo provides the metadata and the
capability surface.

```ts
interface KairoPluginManifest {
  apiVersion: 'kairo.plugin/1';
  name: string; // e.g. "my-team-analytics"
  version: string;
  description: string;
  /** Coarse buckets — UI hints, not enforcement. */
  capabilities: PluginCapability[];
  /** Semver range of Kairo this plugin targets. */
  kairoCompatibility: string;
  /** Optional pointer to an external MCP server config. */
  mcpServer?: { command: string; args?: string[]; env?: Record<string, string> };
  /** Author-declared metadata; never executed. */
  homepage?: string;
  author?: string;
}

type PluginCapability =
  | 'read-events'
  | 'read-checkpoints'
  | 'read-telemetry'
  | 'render-reports'
  | 'extend-inspect'
  | 'embedder-provider';
```

`src/plugins/loader.ts` reads `.kairo/plugins/*.json` manifests (or a
single `.kairo/plugins.json` array), validates them with zod, and
exposes them through `kairo_plugins_list`. Nothing is loaded into the
Node process. The MCP host wires up actual execution.

Capabilities are **declarations**, not permissions enforced at runtime —
they are the hint by which users decide whether to install a plugin. The
honest scope is documented next to the field.

Future versions may add an opt-in in-process plugin loader for trusted
local extensions. v0.9.4 deliberately does not — the manifest contract is
the minimum needed to make integrations real without taking on the
security and stability surface of dynamic code loading.

### 4. SDK

`src/sdk/` exposes a small, dependency-light **local** client:

```ts
import { KairoClient } from 'kairo-mcp/sdk';
const k = new KairoClient({ projectRoot: '/abs/repo' });
await k.overview(); // InspectOverview
await k.sessions(); // SessionListEntry[]
await k.checkpoint(id); // Checkpoint
await k.latestBrief(); // markdown
await k.readReport('PERFORMANCE.md');
await k.validateSnapshot(path);
await k.stabilityOf('kairo_session_start');
```

The SDK reads `.kairo/` directly via the same projections the inspect
surface uses. No spawning of `kairo-mcp`, no MCP transport, no network.
Suitable for build scripts, CI checks, and editor extensions that want
the same data the web inspector renders.

### 5. MCP compatibility tests

A new test suite asserts the MCP protocol-level invariants:

- Tool / prompt / resource discovery returns the documented surface.
- Compact responses don't regress (token-discipline contract).
- Invalid tool input produces a stable error shape.
- The stdio lifecycle (connect → list → call → close) is clean — no
  dangling handles, no zombie processes.
- Backward-compatible tool schemas: a v0.9.x-shaped call still works on
  every subsequent patch version.

### 6. Deprecation policy (post-v1.0)

When a `stable` surface is deprecated:

1. **One minor version**'s notice in the CHANGELOG, with the replacement.
2. The MCP tool description gets a leading `DEPRECATED (use X):`; inspect
   routes return the same content but log a single audit entry per process
   life.
3. The stability registry moves it to `deprecated`.
4. The removal happens in the **next minor version**, never inside a patch.

Migration tooling — when needed — is shipped in the same release as the
change, never before.

## Consequences

- Every integration consumer can answer "is this safe to depend on?" by
  reading `docs/API_STABILITY.md`.
- v1.0.0's stability promise is mechanical: anything marked `stable` in
  v0.9.4 stays callable, with the same shape, on every v1.x release.
- The plugin contract is honest about what it does (declare external MCP
  servers) and what it doesn't (run arbitrary code in-process).
- The SDK gives non-MCP consumers (CI scripts, editor extensions) a
  first-class API without exposing them to the MCP wire protocol.

## Honest scope

- Stability tiers are a **contract**, not enforcement. A tool can still
  panic at runtime; the tier only governs _what changes are allowed_ in
  the next release, not _what runtime invariants hold_.
- The plugin model is metadata-only. It is intentionally weaker than
  "load my JavaScript". That decision is reversible — a future ADR can
  add an in-process loader behind an opt-in flag.
- The SDK is **local-first**. It does not implement an MCP client; that
  belongs to the MCP host. SDK and MCP are parallel ways to read Kairo,
  not alternatives.
