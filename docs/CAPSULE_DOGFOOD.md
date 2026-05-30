# Atlas Capsule — Dogfood Report (v1.6.0)

This report records measuring Atlas Capsule on **Kairo itself**, continuing the
Atlas/Capsule work from the latest checkpoint. It is deliberately honest: where
exact token counts are unavailable, character counts are used as a deterministic,
tokeniser-agnostic proxy. **No token numbers are fabricated.**

## Baseline problem (observed, before Capsule)

When a new Claude Code session started — or a long Atlas continuation prompt was
pasted — Claude still re-scanned large parts of the repository to re-orient,
even though Kairo already had repo memory, checkpoints, briefs, Atlas, graphs,
and telemetry. In our working sessions this rescanning consumed roughly **~40%
of the available context** before any new work began.

Root cause: Kairo provided _continuity artifacts_, but it did not yet hand the
next agent a single **trusted bootstrap package** stating what is known, what
changed, what to read first, and what is safe to skip initially. Without that,
the agent defaulted to rescanning.

> Honest framing: this 40% figure is an observed working estimate of context
> spent on rescanning, not a benchmarked token measurement. Capsule sizes below
> are exact character counts.

## What Capsule changes

Atlas Capsule produces a portable, token-budgeted continuation package from
**existing** Kairo state (latest checkpoint, Atlas projection, repo
intelligence, changed files, git branch/version, optional memory recall). It is
a projection only — it never becomes a second state store and never mutates
`.kairo/`.

It does **not** prevent all rescanning. It **reduces unnecessary** rescanning by
giving the next agent a compact, trusted starting point and an exact
file-reading plan. Agents may still reread files when verifying safety.

## Capsule size by mode (measured on this repo)

Generated against Kairo's own `.kairo/` at the v1.5.0 checkpoint
(`01KSTBJZD99FN9RM6B2EYRK130`, task: _"Kairo Atlas v1.5.0 — search/filters +
node detail panel"_), target `claude`, memory recall disabled for a stable
measurement:

| Mode     | Characters | Budget | Truncated |
| -------- | ---------- | ------ | --------- |
| tiny     | 630        | 1,500  | no        |
| standard | 3,417      | 4,000  | no        |
| deep     | 3,948      | 20,000 | no        |

Observations:

- **tiny** is genuinely tiny (~630 chars) — suitable for an urgent handoff.
- **standard** stays comfortably under its 4,000-char budget while carrying the
  full structured package.
- **deep** is bounded; on this repo the available state does not fill the 20k
  budget, so deep ≈ standard + extra context here. On a richer session it grows
  toward the cap and truncates with a visible marker rather than overflowing.

For comparison, a naive "re-read the relevant source to re-orient" pass over
just the changed Atlas files plus their neighbours is many tens of kilobytes of
source. The standard capsule replaces the _orientation_ portion of that with
~3.4 KB of structured guidance.

## Files recommended to read first (standard, this repo)

Risk/touch-ranked changed files, then central touched Atlas modules:

- `src/inspect/atlas/atlasAssets.ts` — low risk, modified
- `src/inspect/atlas/atlasHtml.ts` — low risk, modified
- `tests/atlasDetailPanel.test.ts` — low risk, modified
- `tests/atlasSearchFilters.test.ts` — low risk, modified
- `inspect` — central module (salience 0.13)
- `inspect/atlas` — central module (salience 0.07)

This is the exact set an agent would otherwise have to _discover_ by scanning.

## Files safe to skip initially (standard, this repo)

Each carries the honest caveat _"safe to skip initially unless you detect a
mismatch"_:

- `node_modules/` — third-party deps
- `dist/` — generated build output
- `.kairo/` — Kairo's own state, not app code
- `docs/` — docs (orient from the capsule first)

The skip list never includes an area the session actively changed.

## What was improved

- The next agent receives the **checkpoint, task, changed files, read-first
  plan, and skip list** without opening a single source file.
- The reading plan is **risk-ranked**, so the highest-risk changed file is read
  first.
- A **standard capsule (~3.4 KB)** replaces the broad re-orientation scan that
  previously dominated session startup.
- The package is **deterministic and replay-safe**: the same `.kairo/` produces
  a byte-identical capsule, so handoffs are reproducible.
- It is **safe to paste into another agent**: secrets are redacted and only
  repo-relative paths appear (no absolute local paths).

## Would the capsule have avoided the broad startup scan?

Qualitatively, yes for the _orientation_ phase: the capsule answers "where am I,
what changed, what do I open first, what can I ignore" directly. The agent can
begin at `src/inspect/atlas/*` instead of walking `src/` to find the active
area. It does **not** remove validation reads — an agent verifying a high-risk
change will still open that file, which is correct.

## What is still not guaranteed

- Capsule does **not** stop an agent from rescanning if it chooses to.
- It does **not** guarantee zero re-reads; agents may reread to verify safety.
- It is **not** a replacement for validation — it is a trusted starting point.
- Character counts are a proxy for tokens; exact token cost depends on the
  model's tokeniser.
- The "~40% context" baseline is an observed working estimate, not a benchmark.

## How to reproduce

```sh
kairo capsule --mode tiny     --target claude --json   # see chars
kairo capsule --mode standard --target claude --json
kairo capsule --mode deep     --target claude --json
```

Each `--json` response includes `chars`, `maxChars`, `truncated`, `readFirst`,
and `skipInitially`.
