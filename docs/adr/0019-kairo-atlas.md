# ADR-0019: Kairo Atlas — interactive architecture map

- Status: Accepted
- Date: 2026-05-23

## Context

By v1.4.x Kairo extracts rich, deterministic architecture signals: a collapsed
module dependency graph (ADR-0005), salience scores (ADR-0004), risk
assessments, checkpoint lineage, session activity, and memory relevance. The
inspect surface (ADR-0011) exposes all of it — but as tables, Mermaid source,
and JSON. A human cannot _see_ a codebase from those.

Kairo Atlas adds an interactive 2D/3D architecture map as a new view in the
inspect surface. The full product spec is [ATLAS.md](../ATLAS.md). This ADR
records the decisions that change an existing contract or carry real
trade-offs.

## Decision

### 1. Atlas is a projection, not a new engine

Atlas adds **zero** new analysis. It composes existing artifacts
(`RepoIntelligence.moduleGraph`, the salience engine, the risk/memory/coordination
projections, checkpoint lineage, the session ledger) through a single Atlas
projection layer under `src/inspect/atlas/`. This keeps Atlas consistent with
ADR-0011: surfaces are read-only projections; the backend is the source of
truth. No `.kairo/` mutation, ever.

### 2. The inspect surface gains same-origin JavaScript — the one real change

ADR-0011 established that the web inspector ships **no JavaScript** — pure HTML
with inline styles, CSP `default-src 'none'; style-src 'unsafe-inline'`. That
was correct for static tables. An interactive 2D/3D graph cannot be static
HTML.

Atlas therefore **relaxes the no-JS stance to: same-origin bundled JavaScript
only**, served from the inspect server at `/atlas/app.js`. The relaxation is
deliberately the minimum needed:

- **`script-src 'self'`** — no inline scripts, no `unsafe-inline`, no
  `unsafe-eval`, no remote origins.
- The renderer is plain ES authored in this repo and served same-origin. There
  is no CDN, no npm UI runtime shipped to the browser, no remote fetch beyond
  the loopback origin.
- Atlas CSP in full:

  ```
  default-src 'none';
  script-src 'self';
  style-src 'self';
  img-src 'self' data:;
  connect-src 'self';
  base-uri 'none';
  form-action 'none';
  ```

The rest of the inspect surface keeps its stricter, JS-free CSP. Only `/atlas*`
responses carry the relaxed policy. This is scoped, auditable, and reversible.

### 3. No third-party graph/3D library — self-authored renderer

The obvious way to build a 3D graph is three.js + 3d-force-graph. We reject it:

- Those are remote/bundled dependencies that would either pull from a CDN
  (forbidden) or vendor hundreds of KB of third-party code into the package
  (dependency surface, supply-chain surface, token/size cost).
- They bring non-determinism (animation timers, random layout seeds) that
  fights Kairo's determinism contract.

Instead Atlas ships a **small, self-authored renderer**: HTML5 Canvas for 2D,
and a minimal hand-written 3D projection (canvas or WebGL with no library) for
3D. It has **no browser runtime dependency**. This is more work than importing
a library, but it is the only choice consistent with no-remote-assets,
deterministic, auditable, and token-disciplined.

Consequence: Atlas 3D is intentionally modest in visual flourish. It is
readable and explorable, not a graphics demo. The spec forbids "pretty but
useless".

### 4. 2D is the default; 3D is a first-class toggle

Large dependency graphs become unreadable hairballs in 3D on first contact. A
production tool gives a readable default and advanced exploration. So Atlas
opens in 2D, top-50-by-salience, with a clear switch to 3D. Neither view is
labelled "experimental" — both are supported.

### 5. Deterministic, capped, honest payload

The graph payload is byte-identical for identical `.kairo/` contents: nodes
sorted by `(−salience, id)`, edges by `(from, to)`, repo-relative paths only,
salience-ranked top-N caps by default, and an explicit honest truncation
block (_"Showing top 50 of 1,240 nodes by salience."_). No wall-clock time, no
randomness, no absolute paths in the payload.

## Consequences

- The inspect surface now has two CSP profiles: the JS-free default and the
  `script-src 'self'` Atlas profile. Tests assert both, and assert that no
  remote origin ever appears.
- Atlas can render real large repos without becoming a hairball, because the
  payload is salience-capped before it leaves the server.
- A new surface area (browser JS) exists. It is same-origin, no-eval,
  read-only, and carries no secret-bearing fields — but it is genuinely more
  attack surface than static HTML, which is why the CSP is strict and tested.
- Building our own renderer is more maintenance than a library, accepted in
  exchange for zero remote/runtime dependencies and full determinism.

## Honest scope

- Atlas visualizes **deterministic architecture signals extracted from the
  repository** (static import edges collapsed to directory granularity, plus
  Kairo's salience/risk/activity signals). It does **not** claim semantic
  comprehension of the code.
- The module graph's existing limits (static JS/TS + Python imports, internal
  edges only, directory-collapsed, capped — ADR-0005) are Atlas's limits too.
  Atlas surfaces those limits via the truncation/freshness lines; it does not
  hide them.
- 3D is real and supported, but deliberately restrained in visual fidelity
  because of the no-library constraint. Readability beats spectacle.
- Atlas is historical/structural inspection, like the rest of the surface — it
  reflects the last scan, not a live file watcher.
