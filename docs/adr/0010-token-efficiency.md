# ADR-0010: Token efficiency is a core architecture principle

- Status: Accepted
- Date: 2026-05-20

## Context

Kairo exists to reduce repeated repo rescans by handing the next agent a precise
brief. The failure mode that creeps in over time is the _opposite_ of the original
sin: the brief, the reports, and tool responses grow until they bloat every prompt
they touch. A "memory layer" that fills the context window is just a different way
of losing context.

## Decision

Token efficiency is now a **core architecture principle** alongside
"cooperative-not-omniscient", "event-sourced truth", "redaction is a boundary",
"local-first", and "seams over implementations":

> **Token efficiency.** Use the fewest useful tokens while preserving engineering
> continuity. Default to compact; require explicit opt-in for verbose. Reports go
> to files; prompts get pointers. Briefs have modes.

Concretely:

1. **Continuation briefs have modes** — `tiny` / `normal` / `deep`. Default at
   checkpoint/brief generation is **`normal`**, optimised. `tiny` includes only
   task, branch, changed files, stop point, next 3 actions, critical warnings.
   `deep` is opt-in.
2. **Budgets are character-based** (deterministic, tokeniser-agnostic):
   `maxBriefChars`, `maxRecallItems`, `maxChunkChars`, `maxWarnings`,
   `includeGraphs` (default false). Honest scope: chars are a local proxy for
   tokens; exact token cost depends on the model's tokeniser.
3. **Semantic recall returns top-k small chunks**, not long summaries — each item
   trimmed to `maxChunkChars`.
4. **Reports go to files**. Analytics/team/risk reports are persisted under
   `.kairo/reports/`; MCP responses are 1–2 line summaries with the file path,
   never the full report inline.
5. **Graphs are not inlined by default**. `kairo_graph` returns a short summary +
   mirror path; pass `includeFull: true` to inline the Mermaid.
6. **`kairo_brief` tool** for explicit on-demand brief generation in a chosen
   mode/budget.

## Consequences

- Every consumer (memory recall, reports, graphs, briefs) shares one mental model:
  small by default, opt-in for verbose, configurable budgets.
- Existing "Engineering risk at checkpoint" / recall sections still appear in
  `normal` (so existing assertions hold) — the change is **size**, not structure.
- Honest limitation: budgets are character counts, not real tokens; truncation is
  preservation-aware (top-priority sections first) but is still a heuristic.
- Verbose remains available (`deep` mode, `includeFull: true`) — Kairo never loses
  information; it just stops pasting it into every prompt by default.
