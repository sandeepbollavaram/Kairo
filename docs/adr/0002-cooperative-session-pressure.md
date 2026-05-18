# ADR 0002 — Cooperative session-pressure model

- Status: Accepted
- Date: 2026-05-18

## Context

A central requested feature is "detect when the agent is near its context/session limit
and force a safe checkpoint near 90%." Technical reality: an MCP server runs in a
separate process and has **no API and no visibility** into the agent's token usage,
context window, or reasoning chain. It only observes calls made to its own tools.

Building the feature as specified would require fabricating a signal that does not exist.

## Decision

Implement a **cooperative heuristic** instead of a false guarantee:

- The agent is told, via the `kairo_continuity` MCP prompt and explicit tool
  descriptions, to emit cheap signals it _does_ have: turns elapsed, repeated re-reads,
  retries, subjective "context pressure," via `kairo_heartbeat` and `kairo_record`.
- Kairo computes a bounded **risk-of-context-loss score** `[0,1]` from observed signals:
  tool-call volume, cumulative tracked diff size, retry/error loops, repeated re-reads of
  the same file (a strong proxy for context loss), and elapsed time.
- The score maps to a directive band: `CONTINUE` (< 0.6), `CHECKPOINT_SOON`
  (0.6–0.8), `CHECKPOINT_NOW` (≥ 0.8), attached to every tool response.
- Kairo cannot force a stop. It makes safe continuation the cheapest next action and
  makes context loss expensive.

## Consequences

- Honest and shippable; no fabricated telemetry.
- Quality depends on agent cooperation. We maximize it by (a) shipping the cooperation
  contract as a first-class MCP prompt and (b) making `session_start` immediately
  valuable (returns the continuation brief) so agents have incentive to participate.
- Signal weights live in one module (`src/pressure/pressureModel.ts`) and are tunable
  without touching other layers.
- If a future agent runtime exposes real budget telemetry, it slots in as one more
  signal with the highest weight — no architectural change.
