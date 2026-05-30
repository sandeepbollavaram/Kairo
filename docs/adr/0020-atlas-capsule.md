# ADR-0020: Atlas Capsule — portable AI handoff package

- Status: Accepted
- Date: 2026-05-30

## Context

By v1.5.x Kairo has rich continuity machinery: an event-sourced ledger, repo
intelligence, checkpoints, continuation briefs (ADR-0010), semantic memory
(ADR-0005/0006), the module/Atlas graph (ADR-0019), and telemetry/risk. Yet a
practical gap remained: when a **new agent session** starts — or a long prompt is
pasted — Claude (or Codex / Cursor) still tends to **re-scan large parts of the
repository** to re-orient, consuming a large fraction of available context before
any new work begins.

Kairo provided continuity _artifacts_, but not a single **trusted bootstrap
package** that an arbitrary AI agent can consume to continue work: what is known,
what changed, what to read first, what is safe to skip initially, what risks
matter, and exactly where to continue.

Atlas Capsule fills that gap. The product spec is [CAPSULE.md](../CAPSULE.md);
measured results are in [CAPSULE_DOGFOOD.md](../CAPSULE_DOGFOOD.md). This ADR
records the decisions that carry real trade-offs.

## Decision

### 1. Capsule is a projection, not a second state store

The capsule composes **existing** Kairo state — latest checkpoint, Atlas graph,
repo intelligence, changed files, git branch/version, and optional memory recall
— through `src/core/capsule/` (`capsuleProjection.ts` → `capsuleRenderer.ts`). It
adds no analysis engine, no schema, and **never mutates `.kairo/`**. This keeps
it consistent with ADR-0011: the backend is the source of truth; the capsule
(like the UI) is a projection only. A capsule is therefore reproducible: given
identical `.kairo/` contents and git snapshot, it is byte-identical.

### 2. Honest framing is a hard contract, not a doc note

The capsule **reduces unnecessary rescanning**; it does not stop all rescanning,
prevent all context waste, or guarantee no rereads. This wording is enforced in
the rendered output (every capsule states "reduces unnecessary rescanning … not
a guarantee") and asserted by tests. The "safe to skip initially" list is always
phrased _"unless you detect a mismatch,"_ and an area the session actively
changed is never listed as skippable.

### 3. Budgets are character counts (a tokeniser-agnostic proxy)

Like briefs (ADR-0010), capsule budgets are measured in characters, not tokens —
deterministic and tokeniser-independent. Three bounded modes: `tiny` (~1,500),
`standard` (~4,000, default), `deep` (~20,000). Exceeding the budget appends a
visible truncation marker rather than overflowing. We do not fabricate token
numbers; the dogfood report uses exact character counts.

### 4. Targets change framing, never facts

`claude` / `codex` / `cursor` / `generic` differ only in the header and
continuation hints (`capsuleTargets.ts`). The underlying projection is identical,
so a fact never depends on the target.

### 5. AGENTS.md export is opt-in and never clobbers silently

For the Codex convention, `--agents-md` writes `AGENTS.md` at the project root —
the **only** capsule operation that writes a file. It refuses to overwrite an
existing `AGENTS.md` unless `--force` is passed, and includes a generated header.

### 6. The dashboard Capsules view is read-only

The inspect `/capsules` route renders a generated preview (mode/target via
query-string links, consistent with the JS-free inspector and its
`default-src 'none'` CSP). It **never writes** — no AGENTS.md, no files.
Interactive create/copy/download is intentionally deferred to the CLI and MCP
tool, and the view says so.

### 7. Stability tiers

`kairo_capsule_create` (MCP tool), `capsule` (CLI command), and `/capsules`
(inspect route) are registered **experimental** since 1.6.0. No existing stable
contract changes.

## Security

Capsules pass through Kairo's redaction boundary (ADR baseline) **plus** a final
redaction pass in the renderer, and emit only repo-relative paths — absolute
local paths are dropped. A capsule is therefore safe to paste into another AI
agent. Tests assert redaction of secret-shaped values and the absence of
absolute-path leakage.

## Consequences

- A new agent can bootstrap from a compact, trusted package instead of scanning
  the tree, reducing the rescanning that dominated session startup.
- The capsule is reproducible and replay-safe, so handoffs are deterministic.
- We accept that the capsule does not _prevent_ rereads — validation reads are
  correct and expected; the capsule only removes the broad _orientation_ scan.
