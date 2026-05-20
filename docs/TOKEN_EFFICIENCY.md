# Token Efficiency

> A **core architecture principle** alongside event-sourced truth, redaction-as-
> boundary, cooperative-not-omniscient, local-first, and seams-over-implementations.
> See [ADR-0010](adr/0010-token-efficiency.md).

Kairo exists to reduce repeated repo rescans. The opposite failure mode is just as
bad: a memory layer that bloats every prompt with verbose briefs, full Mermaid
diagrams, and long reports is its own way of losing context. v0.8.2 makes
compactness the default.

## Brief modes

| Mode                   | maxBriefChars | maxRecallItems | maxChunkChars | includeGraphs | Use when                                           |
| ---------------------- | ------------: | -------------: | ------------: | :-----------: | -------------------------------------------------- |
| `tiny`                 |          1500 |              0 |             0 |     false     | Pre-empt rescans on cheap startup; minimal context |
| `normal` (**default**) |          4000 |              3 |           200 |     false     | Resumes / checkpoints                              |
| `deep`                 |         20000 |              8 |           600 |     false     | Explicit historical review                         |

`tiny` includes only: task, stop point, top-5 changed files, next 3 actions,
critical warnings (unresolved errors + medium/high risk factors). Other modes keep
the existing section structure — the change is **size**, not **structure**, so
existing assertions still pass.

## Budget knobs

```ts
interface BriefBudget {
  mode: 'tiny' | 'normal' | 'deep';
  maxBriefChars: number;
  maxRecallItems: number;
  maxChunkChars: number;
  maxWarnings: number;
  includeGraphs: boolean; // default false
}
```

Honest scope: budgets are **character counts**, not real tokens — chars are a
deterministic, tokeniser-agnostic local proxy. Truncation is _preservation-aware_:
critical sections are front-loaded so tail clipping retains the most important
content.

## Compact-by-default MCP responses

- **`kairo_graph`** returns a short summary (`module graph: 17 nodes / 48 edges.
Mirror: .kairo/graphs/module.md`) by default. Pass `includeFull: true` to inline
  the full Mermaid.
- **`kairo_memory_search`** caps at 5 results by default and trims each `why`
  preview to 120 chars.
- **`kairo_analytics_summary`** / `_team_activity` / `_risk_report` write their
  reports to `.kairo/reports/*.md` and return a 1–2 line summary — the full report
  is in the file, never inlined.

## `kairo_brief` tool

```jsonc
{
  "name": "kairo_brief",
  "arguments": { "mode": "tiny", "maxChars": 1500 },
}
```

Returns the continuation brief for the latest checkpoint in the requested mode and
char budget. Optional `sessionId` targets a specific session's latest checkpoint.

## Success condition (v0.8.2 dogfood)

Same checkpoint, three modes, on the Kairo repo:

- `tiny` = **632 chars** (15% of deep)
- `normal` = **2946 chars** (71% of deep)
- `deep` = **4146 chars**
- Explicit `maxChars: 1000` override → exactly **1000 chars** with truncation
  marker.

Verified end-to-end: `tiny` contains Task; `normal` keeps the "Engineering risk at
checkpoint" section; `deep` shows every file row; `normal` caps the file table to
top 10 with an "_and N more_" row.

## Honest limitations

- Chars are not tokens. A long Unicode string might tokenise differently across
  models; budgets are an upper bound, not a tight one.
- Truncation cannot magically preserve every cross-reference — `deep` mode remains
  available when full fidelity matters.
- This principle covers responses sent **into prompts**. Persisted `.kairo/`
  artefacts (events, checkpoints, telemetry) are not truncated — those are the
  source of truth.
