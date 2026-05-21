# ADR-0016: `kairo` CLI surface & UX contract

- Status: Accepted
- Date: 2026-05-21

## Context

Through v1.0.1 Kairo shipped two binaries: `kairo-mcp` (the MCP server)
and `kairo-inspect` (the local web inspector). Everything else lived
behind MCP tools an agent had to call. That made Kairo opaque to humans:

- No way to peek at `.kairo/` from the terminal.
- No `init` to wire up a new project.
- No `doctor` to diagnose a failed install.
- No way to script automation around Kairo state in CI.

A first downstream install (Flexdee + Claude Code) immediately hit the
gap: install succeeded, MCP failed to connect, the user had no
self-service diagnosis. v1.1.0 adds a single `kairo` binary as the
developer-facing surface.

## Decision

### 1. One binary, subcommand dispatch

`kairo` follows the `git` / `docker` / `kubectl` / `terraform` model:
one top-level binary, many subcommands. Each subcommand does one thing
well and respects the same global flags.

### 2. Global flags (every command honours them)

| Flag                   | Effect                                                                 |
| ---------------------- | ---------------------------------------------------------------------- |
| `--json`               | Machine-readable output. No prose, no colour, deterministic key order. |
| `--quiet`, `-q`        | Suppress non-essential output. Errors still print.                     |
| `--verbose`, `-v`      | Extra detail. Off by default — Kairo's default is terse.               |
| `--no-color`           | Disable ANSI. Auto-disabled when stdout is not a TTY.                  |
| `--project`, `-C PATH` | Override project root. Default: cwd or `KAIRO_PROJECT_ROOT`.           |
| `--help`, `-h`         | Per-command help with examples.                                        |
| `--version`, `-V`      | Print `kairo` version.                                                 |

### 3. Commands (v1.1.0 surface)

Read commands (all use `KairoClient` under the hood):

| Command                            | Purpose                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `status`                           | One-screen overview: counts, latest session, latest checkpoint, quarantine count. |
| `brief [--tiny\|--normal\|--deep]` | Print the latest continuation brief in a mode. Default: normal.                   |
| `continue`                         | Alias for `brief --normal`.                                                       |
| `sessions [<id>]`                  | List sessions, or show one in detail.                                             |
| `checkpoints [<id>]`               | List checkpoints, or show one + lineage.                                          |
| `graph [<kind>]`                   | List graphs, or print one (Mermaid source).                                       |
| `search <query>`                   | Semantic memory search. Compact by default.                                       |
| `stability [<id>]`                 | Stability registry lookup.                                                        |
| `plugins`                          | List plugin manifests under `.kairo/plugins/`.                                    |
| `doctor`                           | Health-check the project's Kairo install.                                         |
| `version`                          | Print `kairo` and `SERVER_VERSION`.                                               |

Write / process commands:

| Command                                    | Purpose                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `init`                                     | Wire Kairo into the current project: write `.mcp.json`, append `.gitignore`. Idempotent. |
| `inspect`                                  | Launch the local web inspector on `127.0.0.1:4173`.                                      |
| `serve`                                    | Run the MCP server on stdio (same as `kairo-mcp`).                                       |
| `snapshot export [<path>]`                 | Export `.kairo/` to a single JSON file.                                                  |
| `snapshot import <path> [--force]`         | Import a snapshot into the current project.                                              |
| `compact [--dry-run] [--days N]`           | Archive stale events. `--dry-run` is the default.                                        |
| `benchmark [--iterations N] [--only NAME]` | Run the deterministic benchmark suite.                                                   |

The agent-driven continuity ops (`session_start`, `record`, `checkpoint`,
`session_end`, `heartbeat`, `assess`, `lease`) stay behind MCP. The CLI
does not provide write paths into the session ledger — that boundary is
deliberate. Mixing CLI and agent writes would muddy the cooperative
contract (ADR-0002).

### 4. Output rules

**Default mode** (human terminal):

- No emojis.
- Colour only as a quiet accent: `cyan` for headers, `green` for OK,
  `yellow` for warnings, `red` for errors, `dim` for metadata. Nothing
  else. Auto-disabled on non-TTY.
- Tables align columns. Numbers right-justified.
- Every command's default output fits in a terminal screen unless the
  user asked for more (`--verbose`, listing all items).

**`--json` mode**:

- Single JSON document to stdout. No leading whitespace, no banner.
- Keys sorted alphabetically at every level (deterministic).
- Exit codes still meaningful (0 = ok, non-zero = error).
- Error JSON: `{ "error": { "code": "<STABLE_CODE>", "message": "<human>" } }`.

**`--quiet`**:

- Suppress headers, examples, hints. Emit only the load-bearing data
  (the path, the count, the result). Useful for shell pipes.

### 5. Exit codes

| Code | Meaning                                                                               |
| ---- | ------------------------------------------------------------------------------------- |
| 0    | Success.                                                                              |
| 1    | Generic failure (uncaught error).                                                     |
| 2    | Misuse: bad flags, missing required arg.                                              |
| 3    | `.kairo/` not present where one was required (e.g. `status` outside a Kairo project). |
| 4    | Validation error (snapshot rejection, plugin manifest invalid).                       |
| 5    | Doctor diagnosed a fixable problem.                                                   |

These are stable from v1.1.0 onward. Adding a new code is back-compat;
changing an existing meaning is a major-version change.

### 6. Stability tier (v1.1.0)

The `kairo` CLI **commands** are added to the stability registry as
**experimental** in v1.1.0. The `--json` output schema is experimental
until at least v1.2.0; before then we may add fields (always back-compat)
or rename a key (with one minor version of notice). The command **names**
themselves are stable from v1.1.0 — renaming a top-level subcommand
requires a deprecation cycle.

### 7. First-run experience

`kairo init` in a fresh project:

1. Detects `package.json` (or warns).
2. Detects the MCP host on `PATH` (`claude` for Claude Code, others may
   follow). Reports which it found.
3. Writes `.mcp.json` (idempotent — merges if it exists).
4. Appends `.kairo/` to `.gitignore` (idempotent — skips if present).
5. Prints a 5-line next-steps summary.

`kairo doctor` runs the same detection plus checks that `dist/index.js`
is present (the issue that caught the first downstream install) and that
`SERVER_VERSION` matches the installed package.

### 8. Shell completion

`kairo completion bash|zsh|pwsh` prints a completion script. Generated
from the subcommand registry — no separate file to keep in sync.

### 9. What this ADR does NOT do

- No new MCP tools.
- No new persisted artefacts.
- No new cognition.
- No CLI write-path into the session ledger (agents own that via MCP).
- No interactive prompts. Every command runs to completion without
  asking the user a question (so CI works).
- No remote/network code paths added.

## Consequences

- Developers can self-diagnose, snapshot, and inspect without spawning
  an agent.
- CI can shell out to `kairo doctor` / `kairo status --json` /
  `kairo stability --json` for gating.
- The MCP / SDK / inspect surfaces are unchanged. The CLI is a new
  consumer of the same projections.

## Honest scope

- `--json` shape is experimental for two minors before it locks.
- The CLI does not implement an MCP client; it reads `.kairo/`
  directly. Don't expect it to drive the server.
- Shell completion is deterministic but minimal: it completes
  subcommand names, not values that require IO.
