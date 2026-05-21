# Plugin API

> **Manifest contract only.** Kairo does NOT load or execute plugin code
> in-process. See [ADR-0015](adr/0015-api-stability-and-plugins.md).

## Model

A plugin is an external program — typically another MCP server — that
extends what an AI agent can do alongside Kairo. The MCP host (Claude
Desktop, Cursor, IDE) loads the plugin via its own MCP config; Kairo
provides:

1. A **manifest format** plugins use to declare themselves.
2. A **loader** (`kairo_plugins_list`, `KairoClient.plugins()`) that reads,
   validates, and surfaces installed manifests.
3. A **capability vocabulary** plugins use to describe what they touch.

This is intentionally weaker than dynamic JavaScript loading. The decision
is reversible — a future ADR can add an opt-in in-process loader — but
v0.9.4 deliberately ships only the metadata side.

## Manifest

`apiVersion: 'kairo.plugin/1'`

```jsonc
{
  "apiVersion": "kairo.plugin/1",
  "name": "team-analytics",
  "version": "0.2.0",
  "description": "Custom analytics dashboards for our team.",
  "capabilities": ["read-events", "render-reports"],
  "kairoCompatibility": "^0.9 || ^1",
  "mcpServer": {
    "command": "node",
    "args": ["/opt/team-analytics/server.js"],
    "env": { "TEAM_ID": "kairo" },
  },
  "homepage": "https://github.com/example/team-analytics",
  "author": "team-analytics maintainers",
}
```

### Field reference

| Field                 | Required | Description                                                                                                     |
| --------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `apiVersion`          | yes      | Must be `kairo.plugin/1`.                                                                                       |
| `name`                | yes      | Unique slug — keep it short.                                                                                    |
| `version`             | yes      | Semver.                                                                                                         |
| `description`         | yes      | One-line summary.                                                                                               |
| `capabilities`        | yes      | Subset of the vocabulary below. **Declarative**, not enforced at runtime — a hint for users and hosts.          |
| `kairoCompatibility`  | yes      | Semver range. `^0.9`, `^1`, disjunction with `\|\|`, `*`.                                                       |
| `mcpServer`           | no       | If present, the MCP host should launch this server. Kairo only records the spec; it does NOT start the process. |
| `homepage` / `author` | no       | Metadata. Never executed.                                                                                       |

### Capability vocabulary

| Capability          | Meaning                                                      |
| ------------------- | ------------------------------------------------------------ |
| `read-events`       | Plugin reads `.kairo/events.jsonl` or equivalent projection. |
| `read-checkpoints`  | Reads `.kairo/checkpoints/*.json`.                           |
| `read-telemetry`    | Reads `.kairo/telemetry.jsonl`.                              |
| `render-reports`    | Writes a markdown report under `.kairo/reports/` (advisory). |
| `extend-inspect`    | Adds routes/views to a hosted inspector (advisory).          |
| `embedder-provider` | Provides an HTTP-compatible embedding endpoint.              |

Capabilities are coarse buckets — UI hints for users deciding whether to
install a plugin. They are not access control; the OS-level filesystem
permissions still govern what a plugin process can actually do.

## Discovery

Manifests live under either path; both are scanned and merged:

- `.kairo/plugins/*.json` — one file per plugin (preferred).
- `.kairo/plugins.json` — single file containing an array of manifests.

Each manifest is zod-validated. Invalid manifests appear in the loader
output with a `warning` field; the rest still load.

## Compatibility check

The loader matches `kairoCompatibility` against the running build:

```
^0.9         → matches 0.9.0 … 0.9.x   (minor pinned for 0.x)
^1           → matches 1.0.0 … 1.x.y   (major pinned for 1.x+)
>=0.9 <1     → conjunction (all sub-ranges must match)
^0.9 || ^1   → disjunction
*            → matches anything
1.2.3        → exact
```

Plugins whose `kairoCompatibility` does not match are still surfaced in
the listing — with a `warning` and `compatible: false` — so the operator
can see what would have loaded.

## Reading plugins programmatically

```ts
import { KairoClient } from 'kairo-mcp/sdk';
const k = new KairoClient();
for (const p of await k.plugins()) {
  if (!p.compatible) console.warn(p.manifestPath, p.warning);
  else console.log(p.manifest.name, p.manifest.capabilities);
}
```

Or via MCP:

```jsonc
{ "name": "kairo_plugins_list" }
```

## What this contract does NOT do (yet)

- **No in-process JS loading.** v0.9.4 deliberately omits this. Future
  versions may add it behind an opt-in flag with explicit security review.
- **No sandboxing.** Plugins are separate OS processes governed by the
  host's MCP config — they run with the same permissions the host
  grants them, no more, no less.
- **No live capability enforcement.** Capability strings are _declarations_
  — the host and the user, not Kairo, decide whether a plugin is
  trustworthy enough to install.

These exclusions are intentional. The plugin contract starts narrow so it
can grow without breaking promises later.
