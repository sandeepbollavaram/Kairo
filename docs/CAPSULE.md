# Atlas Capsule

> **Kairo Atlas helps humans understand the codebase. Atlas Capsule helps AI
> agents continue the work.**

Atlas Capsule (v1.6.0, ADR-0020) is a portable, token-budgeted **AI handoff
package**. When one agent hits its context limit or times out, you generate a
capsule and paste/export it into the next agent — Claude Code, Codex, Cursor,
Gemini, or any generic AI coding agent — so it continues with **significantly
less unnecessary rescanning**.

## Why it exists

Even with repo memory, checkpoints, briefs, Atlas, graphs, and telemetry, a
fresh agent session still tends to **re-scan large parts of the repository** to
re-orient. That wastes context before any new work starts.

Kairo already produced _continuity artifacts_. What was missing was a single,
trusted **bootstrap package** that tells the next agent:

- what is already known
- what changed and what is complete
- what remains
- **what to read first**
- **what is safe to skip initially**
- what risks matter
- exactly where to continue

Atlas Capsule is that package.

## What it does — and does not — claim

Honest framing matters here:

- ✅ Kairo gives agents a **compact continuation package**.
- ✅ Kairo **reduces unnecessary rescanning**.
- ✅ The capsule is a **trusted starting point**.
- ⚠️ Agents **may still reread files** when verifying safety.
- ❌ Kairo does **not** stop all rescanning, prevent all context waste, or
  guarantee no rereads.

The capsule is a projection of existing Kairo state. It is **never** a second
state store and **never** mutates `.kairo/`. The backend remains the source of
truth; the capsule (like the UI) is a projection only.

## Modes (char budgets)

Budgets are character counts — a deterministic, tokeniser-agnostic proxy for
tokens. Capsules are **bounded**; if a capsule exceeds its budget it is
truncated with a visible `— capsule truncated to fit budget —` marker.

| Mode       | Budget        | Use                                   |
| ---------- | ------------- | ------------------------------------- |
| `tiny`     | ~1,500 chars  | Urgent handoff. Very compact.         |
| `standard` | ~4,000 chars  | **Default.** Best balance.            |
| `deep`     | ~20,000 chars | Complex tasks. More context, bounded. |

## Targets

| Target    | Optimised for                                 |
| --------- | --------------------------------------------- |
| `claude`  | Claude Code (mentions Kairo MCP tools).       |
| `codex`   | Codex (supports optional `AGENTS.md` export). |
| `cursor`  | Cursor (paste-to-seed framing).               |
| `generic` | Plain markdown for any AI agent. **Default.** |

The target changes only the _framing_ (header, continuation hints) — never the
underlying facts.

## What a capsule contains

Project identity · branch · version · latest session · latest checkpoint ·
current task · completed work · remaining work · changed files · **files to read
first** · **files safe to skip initially** · architecture summary · relevant
Atlas nodes · relevant memory recall · known risks · commands to run · exact
next actions · do-not-touch areas · verification status · agent-specific
instructions.

The **safe to skip initially** list is what directly fights unnecessary
rescanning — and it is always phrased _"safe to skip initially unless you detect
a mismatch."_ An area the session actively changed is never listed as skippable.

## How to use it

### CLI

```sh
kairo capsule                                   # standard / generic → stdout
kairo capsule --mode tiny                        # urgent handoff
kairo capsule --target codex --mode standard     # Codex handoff
kairo capsule --target claude --output capsule.md # write to a file
kairo capsule --mode deep --json                 # structured output
```

Flags: `--mode tiny|standard|deep`, `--target claude|codex|cursor|generic`,
`--output <file>` / `-o`, `--max-chars <n>`, `--agents-md`, `--force`, `--json`.

With `--output`, the capsule is written to the file and a short summary is
printed instead of the full body. Deep capsules are only printed to stdout when
explicitly requested.

### MCP tool

`kairo_capsule_create` — inputs: `mode`, `target`, `maxChars`,
`includeAgentsMd`, `force`. Output: a compact summary plus structured JSON
(`mode`, `target`, `chars`, `truncated`, `maxChars`, `readFirst`,
`skipInitially`, and an `agentsMd` result when requested). Token-efficient by
default; deep mode is opt-in.

### Inspect dashboard

`kairo inspect` → **Capsules** tab (`/capsules`). A **read-only** generated
preview: pick mode/target, see the char count, truncation status, files to read
first, and safe-to-skip list. This view never writes a file — create/export
happens via the CLI or MCP tool.

## Claude → Codex handoff example

When Claude Code is about to run out of context:

1. In Claude (with Kairo MCP), call `kairo_capsule_create` with
   `target: "codex", mode: "standard"`, **or** run:

   ```sh
   kairo capsule --target codex --mode standard --output handoff.md
   ```

2. Open Codex and paste the capsule (or commit `AGENTS.md`, below). Codex starts
   from the read-first plan instead of rescanning the tree.

## AGENTS.md export (Codex)

For the Codex convention, persist the capsule as `AGENTS.md` at the project
root:

```sh
kairo capsule --target codex --agents-md          # refuses if AGENTS.md exists
kairo capsule --target codex --agents-md --force  # overwrite
```

The export includes a generated header, the capsule body, continuation
instructions, the read-first plan, the safe-to-skip list, and do-not-touch
warnings. It will **not** overwrite an existing `AGENTS.md` unless `--force` is
passed.

## Security

A capsule is safe to paste into another AI agent:

- Secrets (API keys, tokens, passwords, private keys, `.env` values) are removed
  by Kairo's redaction boundary plus a final redaction pass in the renderer.
- Only **repo-relative** paths appear — absolute local paths are dropped.
- The capsule never includes raw logs, full JSON, or full graphs.

## Determinism

Given identical `.kairo/` contents (and the same git snapshot), a capsule is
**byte-identical** across runs. This makes handoffs reproducible and
replay-safe.

## Limitations

See [CAPSULE_DOGFOOD.md](CAPSULE_DOGFOOD.md) for measured sizes and an honest
list of what is and is not guaranteed.
