# Kairo Atlas — product specification

> **Status:** specification (v1.5.0 target). This document defines what Atlas
> is, what it is not, and the contract every implementation PR must hold to.
> The architecture decision and its trade-offs live in
> [ADR-0019](adr/0019-kairo-atlas.md).

Kairo Atlas is a **local, read-only, interactive architecture map** rendered
over the deterministic signals Kairo already extracts from a repository. It is
a new view in the existing inspect surface (`kairo inspect → /atlas`), not a
new backend.

## The problem it solves

Kairo already produces precise architecture signals: a collapsed module
dependency graph, salience scores, risk assessments, checkpoint lineage,
session activity, and memory relevance. Today those signals reach a human as
raw `.kairo/*.jsonl`, Mermaid source, or long markdown reports. None of those
let a person _see_ a codebase at a glance.

Atlas turns the signals Kairo already computes into a navigable picture: nodes
for modules, edges for dependencies, size for salience, colour for risk, and
overlays for what the AI actually touched.

## What Atlas is

- A **projection**, exactly like the rest of the inspect surface (ADR-0011).
  The backend remains the single source of truth. Atlas reads `.kairo/` and
  the repo-intelligence module graph; it never writes.
- **Local-first and offline.** Served by the existing loopback inspect server.
  No CDN, no remote scripts, styles, fonts, or analytics. No network egress
  beyond the loopback socket the user already started.
- **Deterministic.** Given the same `.kairo/` contents, the Atlas graph
  payload is byte-identical: stable node ordering, stable edge ordering,
  salience-ranked, repo-relative paths only.
- **Two production views.** A readable **2D** map (the default) and an
  explorable **3D** map. Neither is "experimental"; the default is 2D because
  it is the more readable starting point on large graphs.

## What Atlas is NOT

- **Not a new intelligence engine.** It adds no new analysis. Every number it
  shows already exists in a Kairo artifact.
- **Not a source of truth.** Nothing the UI does is persisted. Filters,
  camera, and selection live only in the browser tab for that session.
- **Not cloud / SaaS.** No accounts, no hosted backend, no upload.
- **Not "Kairo understands your codebase."** Atlas _visualizes deterministic
  architecture signals extracted from the repository_ — static import edges
  collapsed to directory granularity, plus the salience/risk/activity signals
  Kairo records. It does not claim semantic comprehension.
- **Not a framework SPA.** No React/Vue/Svelte, no bundler runtime shipped to
  the browser, no npm UI dependency. See the renderer decision below.

## Data sources (existing artifacts only)

| Signal                                          | Source                                                                 | Used for                           |
| ----------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------- |
| Module graph (nodes + edges, collapsed, capped) | `RepoIntelligence.moduleGraph` (`src/core/graph/types.ts` `RepoGraph`) | Node + edge topology               |
| Salience scores                                 | salience engine (`src/core/salience/`)                                 | Node size, top-N ranking           |
| Risk level                                      | risk projection (`InspectProjection.risk()`)                           | Node colour / risk overlay         |
| Checkpoints + lineage                           | `.kairo/checkpoints/`, `checkpointLineage()`                           | "checkpoint touched this" overlay  |
| Sessions + changed files                        | `.kairo/sessions/`, session ledger                                     | "AI worked here" / changed overlay |
| Memory relevance                                | vector index projection (`memoryIndex()`)                              | "memory hits" in node detail       |
| Graph freshness / scan info                     | repo intelligence `generatedAt` + fingerprint                          | Overview freshness line            |

Atlas composes these through a single **Atlas projection layer** that depends
only on the existing projection/query/graph functions — no duplicated business
logic.

## Graph payload contract

The projection produces one deterministic payload:

```jsonc
{
  "schemaVersion": 1,
  "repoName": "kairo", // basename of project root, never an absolute path
  "generatedAt": "…", // from repo intelligence (not wall clock)
  "graphKind": "module", // module | service | architecture | pipeline
  "availableModes": ["module", "service", "architecture", "pipeline"],
  "fresh": true, // intelligence fingerprint matches current scan
  "totals": { "nodes": 1240, "edges": 3380 },
  "truncated": true,
  "truncation": {
    // honest, human-readable
    "shown": 50,
    "total": 1240,
    "by": "salience",
    "message": "Showing top 50 of 1,240 nodes by salience. Increase the limit in controls.",
  },
  "nodes": [
    {
      "id": "src/core", // stable, repo-relative; never absolute
      "label": "core",
      "group": "source", // source | docs | test | example | generated | other
      "salience": 0.87, // [0,1], rounded deterministically
      "fanIn": 12,
      "fanOut": 4,
      "centrality": 0.61,
      "risk": "medium", // low | medium | high | undefined
      "flags": { "changed": true, "checkpoint": true, "session": true },
    },
  ],
  "edges": [{ "from": "src/server", "to": "src/core", "weight": 9 }],
}
```

Rules:

- **Repo-relative paths only.** The project root's absolute path never appears
  in any field. `repoName` is the basename only.
- **Caps by default.** Nodes capped to a salience-ranked top-N (default 50),
  edges capped to those incident on shown nodes plus a global edge cap.
  Truncation is always reported honestly.
- **Deterministic ordering.** Nodes sorted by `(−salience, id)`, edges by
  `(from, to)`. No `Date.now()` / `Math.random()` in the payload.
- **No secret values.** The payload carries structural metadata only. The
  redaction boundary already prevents secrets in `.kairo/`; Atlas adds no new
  field that could carry one.

## Routes

Added to the inspect server (`src/inspect/server.ts`):

| Route                                   | Returns                                                           |
| --------------------------------------- | ----------------------------------------------------------------- |
| `/atlas`                                | Atlas HTML shell (overview + view container). 2D default.         |
| `/atlas/graph.json?kind=&top=&filters=` | The deterministic graph payload (JSON).                           |
| `/atlas/app.js`                         | Local bundled renderer script (same-origin, `script-src 'self'`). |
| `/atlas/app.css`                        | Local stylesheet (same-origin).                                   |

`kairo inspect` continues to launch the loopback server; Atlas is reachable at
`http://127.0.0.1:<port>/atlas`.

## Views

### 2D map (default)

Pan, zoom, click-to-select, node detail panel, search, filters, edge-visibility
control, salience-based node sizing, readable force/grid layout with a
deterministic seed. Optimised to stay readable: default top-50 nodes, labels on
the largest nodes, edges dimmed until a node is selected.

### 3D map (production, opt-in via a view toggle)

Rotate, zoom, pan, click-to-select, the same node detail panel, density
controls, salience-based sizing, readable labels, reset-camera, and a top-N
control. Rendered with the same self-authored renderer — no three.js, no CDN.
3D is a first-class view, but 2D is the default because it is more readable on
first contact with a large graph.

## Features (acceptance checklist)

1. **Overview** — repo name, graph kind, node/edge counts, truncation status,
   salience summary, freshness, last-scan info, available modes.
2. **2D view** — pan / zoom / click / detail panel / search / filters / edge
   visibility / salience sizing / readable layout.
3. **3D view** — rotate / zoom / pan / click / detail panel / density / salience
   sizing / labels / reset camera / top-N.
4. **Search** — path + module search, `/` shortcut, matched + neighbor
   highlight, result list.
5. **Filters** — hide docs / tests / examples / generated; show only source;
   high-salience; high-risk; changed; checkpoint-related; session-related;
   top 25 / 50 / 100 / all-if-safe.
6. **Node detail panel** — path, type, salience, fan-in, fan-out, centrality,
   risk, memory hits, related checkpoints, related sessions, last-touched
   session, related MCP tools (if available), neighbors, incoming + outgoing
   edges.
7. **Legend** — node size, node colour, edge meaning, risk + salience overlays,
   truncation warning, filter meaning.
8. **Density controls** — top-N selector, edge density presets, label
   visibility toggle, directory group/collapse where the graph supports it.
9. **Export** — export the current graph payload as JSON. SVG/PNG only if it
   can be done with same-origin, no-eval, no-remote-dependency code.

## Security contract

Atlas tightens, then minimally relaxes, the inspect CSP — and the relaxation is
the one architectural change that needs an ADR ([ADR-0019](adr/0019-kairo-atlas.md)):

- Today the inspector serves **no JavaScript** (`script-src` absent). Atlas
  needs interactivity, so it serves **local bundled JS from the same origin**.
- Atlas responses use:

  ```
  default-src 'none';
  script-src 'self';
  style-src 'self';
  img-src 'self' data:;
  connect-src 'self';
  base-uri 'none';
  form-action 'none';
  ```

- **No** `unsafe-inline` for scripts, **no** `unsafe-eval`, **no** remote
  origins. The renderer is plain ES served from `/atlas/app.js`. If any inline
  style proves unavoidable it will be justified inline and kept minimal;
  preference is a same-origin `/atlas/app.css`.
- No CDN, no remote fonts, no analytics, no `fetch` to anything but the
  loopback origin (`connect-src 'self'` for the `graph.json` fetch).
- The payload leaks no absolute paths, env vars, secrets, tokens, keys, or
  `.env` contents.

## Performance contract

- Default render is **top-50 nodes by salience**, never the full graph.
- Edges capped to those incident on shown nodes plus a hard global cap.
- Truncation always surfaced: _"Showing top 50 of 1,240 nodes by salience."_
- Deterministic layout seed so the same payload lays out the same way.
- Payload stays compact; node detail can be derived client-side from the
  already-delivered payload (no per-node round trips required for v1).

## Success condition

A human can understand a repository's architecture **faster** through Atlas
than through raw JSON, Mermaid, or markdown reports — and can answer: _what are
the important modules, how is the repo connected, what's risky, what changed,
what did the AI work on, where should I look next?_

## PR plan

Atlas ships across reviewed PRs (PR-only workflow), each green on CI before
merge:

1. **docs** — this specification + ADR-0019 _(this PR)_.
2. **feat** — Atlas projection payload (`atlasProjection`, `atlasTypes`) + tests.
3. **feat** — Atlas inspect routes (`/atlas`, `/atlas/graph.json`, asset routes) + CSP.
4. **feat** — 2D graph view (renderer + overview shell).
5. **feat** — 3D graph view.
6. **feat** — search + filters.
7. **feat** — node detail panel.
8. **test** — projection determinism, caps, truncation, CSP, no-leak, fallbacks.
9. **docs** — usage guide + README section + screenshots.

Closely related PRs may be combined, but never into one unreviewable mega-PR.
v1.5.0 is tagged only after all Atlas PRs are merged and CI is green on main.
