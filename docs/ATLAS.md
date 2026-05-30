# Kairo Atlas — usage guide

> **Status:** shipped in v1.5.0. Kairo Atlas is a local, read-only, interactive
> 2D/3D architecture map rendered over the deterministic signals Kairo already
> extracts from a repository. The design decisions and trade-offs live in
> [ADR-0019](adr/0019-kairo-atlas.md).

Atlas is a view in the existing inspect surface — `kairo inspect → /atlas` — not
a new backend. It turns the architecture signals Kairo computes (module graph,
salience, risk, checkpoint/session activity) into a navigable picture so you can
**see** a codebase instead of reading raw JSON, Mermaid source, or long markdown
reports.

---

## 1. What Kairo Atlas is

A picture of your repository's architecture, drawn from Kairo's own
deterministic intelligence:

- each **node** is a module / directory in the collapsed dependency graph,
- each **edge** is an import/dependency relationship,
- **size** encodes salience (graph centrality), **colour** encodes the module
  group, a **ring** flags risk, and overlays mark what an AI session touched.

It is a **projection** (ADR-0011): read-only, local-first, deterministic. The
backend `.kairo/` state remains the single source of truth — Atlas never writes.

## 2. Why humans need Atlas instead of raw JSON/Mermaid

Kairo already records precise signals — but as `.kairo/*.jsonl`, Mermaid text,
and markdown reports. A person cannot answer "what are the important modules,
how is this connected, what's risky, what did the AI change?" by scanning those.
Atlas answers them visually in seconds:

| Question                        | Atlas affordance                                               |
| ------------------------------- | -------------------------------------------------------------- |
| What are the important modules? | Largest nodes (salience = degree centrality).                  |
| How is the repo connected?      | Edges + click-to-focus neighbour highlighting.                 |
| Which areas are risky?          | Amber/red risk rings.                                          |
| What did the AI work on?        | Changed-by-AI tick + `changed`/`session`/`checkpoint` filters. |
| Where should I look next?       | Search, filters, and the node detail panel.                    |

## 3. How to open Atlas

```bash
# 1. Install (globally, so the CLI is on PATH)
npm install -g kairo-mcp

# 2. Wire Kairo into your project
cd your-project
kairo init

# 3. Make sure a graph exists. Atlas projects the cached module graph, which
#    is produced when Kairo scans the repo. If you have run a Kairo session
#    in this project (via Claude Code / your MCP host), the scan already
#    happened. If not, open your MCP host and start one, or force a scan:
#      - in your agent: call kairo_repo_scan (force: true)

# 4. Launch the local inspector
kairo inspect

# 5. Open the printed URL and go to /atlas
#      http://127.0.0.1:4173/atlas
```

`kairo inspect` binds to `127.0.0.1` only. The page and its assets are served
from that loopback origin; nothing is fetched from the network.

## 4. What the Atlas page shows

- **Controls bar** — overview line (`repo · graph kind · N nodes / M edges`), a
  **2D / 3D** view toggle, a **Top-N** selector (25 / 50 / 100 / all), and a
  **Reset view** button.
- **Search + filters row** — a search box (`/` to focus) and filter chips.
- **Truncation banner** — appears when the graph was capped, e.g.
  _"Showing top 50 of 1,240 nodes by salience. Increase the limit in controls."_
- **Canvas** — the interactive 2D or 3D map.
- **Legend** (bottom-right) — what size, colour, rings, and ticks mean.
- **Node detail panel** (left, on click) — metrics + relationships.

## 5. What nodes mean

A node is a **module / directory** in the collapsed dependency graph (the graph
engine collapses files to a readable directory granularity — ADR-0005).

| Visual     | Meaning                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| **Size**   | Salience = graph degree centrality (fan-in + fan-out, edge-weighted), normalised to [0,1]. Bigger = more central. |
| **Colour** | Group: source (blue), test (green), docs (purple), example (cyan), generated (grey), other (amber).               |
| **Ring**   | Risk recorded for files under this node — amber = medium, red = high.                                             |
| **Tick**   | A small dark dot = a file under this node was **changed by an AI session**.                                       |
| **Flags**  | The node detail panel lists `changed` / `checkpoint` / `session` involvement explicitly.                          |

## 6. What edges mean

An edge is a **dependency / import relationship** between two modules
(directory-collapsed, internal relative imports only). Edge **weight** is the
number of underlying file-level edges it represents.

- **Outgoing** edges = "this module **depends on** that module".
- **Incoming** edges = "this module is **depended on by** that module".
- Selecting a node highlights it and its **neighbours** (both directions) and
  dims everything else, so you can see a module's blast radius at a glance.

## 7. How to use 2D mode (default)

- **Pan** — drag the background.
- **Zoom** — scroll (zooms toward the cursor).
- **Select** — click a node → it + neighbours highlight, rest dims, the detail
  panel opens.
- **Top-N** — the selector caps how many nodes (by salience) are shown; the
  truncation banner tells you when capping is active.
- **Reset view** — re-fits the whole graph and clears selection/search/filters.

2D opens by default because it is the more readable starting point on large
graphs.

## 8. How to use 3D mode

Click **3D** in the controls bar. Same payload, a hand-written perspective
projection (no third-party 3D library):

- **Rotate** — drag.
- **Zoom** — scroll (moves the camera in/out).
- **Pan** — Shift+drag.
- **Select** — click a node (depth-aware hit testing) → same highlight + detail
  panel as 2D.
- **Reset view** — recenters the camera.
- **Top-N** — same salience cap as 2D.

3D is a first-class, supported view — deliberately restrained in visual flourish
(no library, fully deterministic), readable rather than a graphics demo.

## 9. Search and filters

**Search** (`/` focuses the box, `Esc` clears):

- Matches by **path or module** name (case-insensitive substring).
- Matched nodes get a bright halo; their neighbours stay lit; the rest dims.
- A results list shows matches; click one to select + (in 2D) centre on it.

**Filter chips** — two kinds:

- **Hide** toggles: `hide docs`, `hide tests`, `hide examples`,
  `hide generated` — each removes that group (combined as AND).
- **Focus** toggles: `source only`, `changed`, `risk`, `high salience`,
  `checkpoint`, `session`. When any focus toggle is active, a node is shown if
  it matches **at least one** (OR); when none is active, all pass. "High
  salience" uses a deterministic threshold.

Filtering hides nodes and their incident edges in both views and in hit-testing;
the layout stays stable (no relayout), so toggling is non-jarring. **Reset view**
clears search and all filters.

## 10. Node detail panel

Click a node (or a search result) to open the panel. Everything is derived
client-side from the already-delivered graph payload:

- **Header** — module label + repo-relative id.
- **Badges** — group, risk (if any), and `changed` / `checkpoint` / `session`
  involvement.
- **Metrics** — salience, centrality, fan-in, fan-out.
- **Relationships** — _Depends on_ (outgoing) and _Depended on by_ (incoming),
  each a clickable list of neighbour modules (with `×weight` when > 1).

Clicking a neighbour in the panel focuses and centres it, so you can **walk the
dependency graph** module by module.

## 11. Security model

- **Local-first, read-only.** Served by the loopback inspect server
  (`127.0.0.1`). Atlas never writes `.kairo/`.
- **No network, no remote assets.** No CDN, no remote scripts/styles/fonts, no
  analytics, no images fetched from the internet. The only request the page
  makes is a same-origin `fetch('/atlas/graph.json')`.
- **Scoped CSP.** Only `/atlas*` responses carry the renderer-enabling policy:

  ```
  default-src 'none'; script-src 'self'; style-src 'self';
  img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none';
  ```

  No `unsafe-inline`, no `unsafe-eval`, no remote origins. The rest of the
  inspect surface keeps its stricter JS-free CSP.

- **No secret-bearing fields.** The payload carries structural metadata only;
  paths are repo-relative (the project's absolute path never appears).
- **Backend remains the source of truth.** Atlas is a projection; nothing the UI
  does is persisted.

## 12. Honest limitations

- **Static import extraction.** The graph is built from statically-extracted
  internal imports (JS/TS + Python, relative edges only — ADR-0005). Dynamic
  imports and external packages are excluded by design.
- **Directory-collapsed.** Nodes are directory-granularity groups, not
  individual files — a deliberate readability choice.
- **Capped for readability.** Large graphs are truncated to the top-N most
  salient nodes by default; the truncation banner says so. Raise the limit via
  the Top-N control (mind that very large graphs become hairballs).
- **Salience and centrality are deterministic signals, not perfect semantic
  truth.** Atlas visualizes Kairo's signals; it does not claim to understand
  every codebase. A repo with few internal relative imports (e.g. a flat Python
  script collection) yields a sparse graph — that is honest, not a bug.
- **Structural, not live.** Atlas reflects the last scan, not a live file
  watcher. Re-scan to refresh.

## 13. Troubleshooting

| Symptom                                           | Cause / fix                                                                                                                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/atlas` shows "No repository intelligence yet"   | No cached scan. Run a Kairo session in your MCP host, or have your agent call `kairo_repo_scan` (force: true), then refresh.                                    |
| One node labelled `(root)`, no edges              | The cached scan is of a near-empty or import-light tree. Re-scan after the repo has real code; some languages/layouts yield few internal relative-import edges. |
| Graph looks stale                                 | Atlas reflects the **last** scan. Force a re-scan, then refresh `/atlas`.                                                                                       |
| MCP not connected (`/mcp` shows `kairo · failed`) | Run `kairo doctor`; if `.mcp.json` is stale (e.g. moved machines or non-Node project), run `kairo init --force`.                                                |
| `kairo: command not found`                        | Install globally: `npm install -g kairo-mcp`, or use `npx -p kairo-mcp kairo …`.                                                                                |
| Dropdown / inputs hard to read                    | Fixed in v1.5.0 (theme-aware colours). Update: `npm install -g kairo-mcp@latest`.                                                                               |

Run `kairo doctor` for a one-shot health check; run `kairo status` to confirm a
graph and session/checkpoint data exist.

## 14. Screenshots

These were captured against the Kairo repository itself and are committed under
[images/](images/) (local files only — no remote/CDN images).

### 2D overview

![Atlas 2D overview of the Kairo module graph, 33 nodes and 147 edges, nodes
sized by salience and coloured by group](images/atlas-2d-overview.png)

The default view: the whole module graph fit to the canvas. The large green node
is `tests`; blue nodes are source modules. Size encodes salience, colour the
group.

### 2D node focus

![Atlas 2D with core/session selected and its dependency edges highlighted, the
rest of the graph dimmed](images/atlas-2d-node-focus.png)

Clicking `core/session` highlights it and its neighbours (`core/checkpoint`,
`core/continuation`, `core/brief`) and dims everything else — a module's blast
radius at a glance.

### 2D truncated (Top-N)

![Atlas 2D with Top set to 25 and the truncation banner reading "Showing top 25
of 33 nodes by salience"](images/atlas-2d-truncated.png)

Capping to the 25 most-salient nodes surfaces the honest truncation banner. Raise
the cap with the Top-N control.

### 3D view

![Atlas 3D perspective projection of the same graph with core/salience,
core/repo and core/vector spread in depth](images/atlas-3d.png)

The same payload rendered as a hand-written perspective projection (no third-party
3D library). Drag to rotate, scroll to zoom, Shift+drag to pan, Reset view to
recenter.

### Search and filters

![Atlas 3D with the "/co" search dropdown listing core/compaction,
core/continuation and core/coordination, the filter chip row, and matched nodes
ringed in orange](images/atlas-3d-search-filters.png)

Typing `/co` lists matching modules and rings them; the chip row focuses by
source/changed/risk/salience/checkpoint/session or hides
docs/tests/examples/generated.

> To capture your own: launch `kairo inspect`, open `/atlas`, and screenshot the
> views above. The node detail panel (click any node) is not yet pictured here.

---

## Reference: data sources (existing artifacts only)

Atlas composes existing Kairo artifacts through a single projection layer
(`src/inspect/atlas/`) — no new analysis engine:

| Signal                           | Source                                    | Used for                               |
| -------------------------------- | ----------------------------------------- | -------------------------------------- |
| Module graph (collapsed, capped) | `RepoIntelligence.moduleGraph`            | Node + edge topology                   |
| Salience / centrality            | derived from graph degree (deterministic) | Node size, top-N ranking               |
| Risk level                       | checkpoint/session changed-file risk      | Node colour ring                       |
| Checkpoint / session activity    | `.kairo/checkpoints/`, `.kairo/sessions/` | `changed`/`checkpoint`/`session` flags |
| Freshness / scan info            | repo intelligence `generatedAt` + schema  | Overview line                          |

## Reference: graph payload contract

`/atlas/graph.json?kind=&top=` returns a deterministic payload: schema-versioned;
nodes sorted `(−salience, id)`, edges `(from, to)`; repo-relative ids only;
salience-ranked top-N cap (default 50) + hard edge cap; an explicit honest
`truncation` block when capped. No wall-clock time, no randomness, no absolute
paths. The shape is documented in `src/inspect/atlas/atlasTypes.ts`.

## Reference: routes

| Route                              | Returns                     |
| ---------------------------------- | --------------------------- |
| `GET /atlas`                       | HTML shell (2D default)     |
| `GET /atlas/graph.json?kind=&top=` | deterministic graph payload |
| `GET /atlas/app.js`                | same-origin renderer        |
| `GET /atlas/app.css`               | same-origin stylesheet      |

## Success condition

A human can understand a repository's architecture **faster** through Atlas than
through raw JSON, Mermaid, or markdown reports — and can answer: what are the
important modules, how is the repo connected, what's risky, what changed, what
did the AI work on, where should I look next?
