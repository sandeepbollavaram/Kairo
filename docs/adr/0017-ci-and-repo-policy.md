# ADR-0017: CI workflow & repository operational policy

- Status: Accepted
- Date: 2026-05-21

## Context

Through v1.1.0 Kairo had no CI. Every release was verified locally; every
green badge was a snapshot of the maintainer's machine. For a project that
promises stability, this is the gap that turns "well-architected repo" into
"maintained production-grade infrastructure". v1.1.1 closes it.

The constraint is the same as every previous slice: **no flaky network
tests, no cloud CI dependencies, deterministic everywhere.** If a check
fails on one OS, it must fail the same way every time.

## Decision

### 1. Two workflows (and only two)

- **`ci`** — runs on every push and PR. Cross-platform matrix gate +
  install-smoke. Fast-fail per job, fail-fast off across the matrix so
  a Windows-only flake doesn't mask a real macOS regression.
- **`nightly-replay`** — runs once daily and on manual dispatch. Re-runs
  the full suite to catch latent flakes; verifies the snapshot round-trip
  remains byte-identical over time.

No "lint-only" job, no "docs-only" job. The whole gate runs together —
splitting it into seven jobs adds CI minutes without finding new bugs.

### 2. Matrix (limited on purpose)

| OS               | Node   | Why                                                |
| ---------------- | ------ | -------------------------------------------------- |
| `ubuntu-latest`  | 20, 22 | Linux is the default consumer environment.         |
| `macos-latest`   | 20, 22 | Most developer laptops.                            |
| `windows-latest` | 20, 22 | The dev machine for this repo + Claude Code users. |

That is 6 combinations. We do not test pre-LTS, post-current, or arbitrary
distros. Adding a row requires an ADR amendment.

### 3. Job shape (each cell of the matrix)

```yaml
- npm ci # deterministic install from lockfile
- npm run typecheck # tsc -p tsconfig.json --noEmit
- npm run lint # eslint .
- npm run format:check # prettier --check
- npm test # vitest run (193 tests)
- npm run build # tsc -p tsconfig.build.json
```

Order matters. Typecheck before tests catches errors faster. Format check
before tests prevents a churn loop. Build last verifies the package
publishable form.

### 4. Install-smoke job

After the matrix gate passes on every OS, a single job runs `npm pack`,
installs the resulting tarball into a fresh `npm init` project, and
verifies:

- `dist/index.js` ships (the v1.0.1 regression that prompted the
  `prepare` script).
- `dist/cli/cli.js` ships and runs.
- `kairo --version` exits 0 with a semver string.
- `kairo doctor --json` returns valid JSON.

This catches packaging regressions that the in-repo tests don't see.

### 5. Nightly replay

Re-runs `npm test` once a day. Also runs a determinism check: export a
snapshot, re-export, assert `contentSha256` matches byte-for-byte.

The nightly job is **not** a blocker for releases. It exists to catch
clock-leak / FS-ordering / Node-version-update bugs that the per-PR gate
might mask.

### 6. Fast-fail discipline

`fail-fast: false` at the matrix level (so we see all failing rows).
`set -e` semantics in every shell step (default for GitHub Actions
run-scripts). No retry loops. A flaky test is a bug, not a CI tweak.

### 7. PR + issue templates

A PR template that asks four questions:

1. What's the smallest user-visible change?
2. Did you add a stability registry entry?
3. Did you bump any schema (ADR-0012 migration?).
4. Does it preserve determinism / replay-safety?

Issue templates:

- Bug report (with version, OS, reproduction, expected vs actual).
- Feature request (with use case, alternatives considered).
- Stability / contract question (separate so it goes to the right
  bucket).

### 8. CODEOWNERS

A single CODEOWNERS file pointing the entire repo to `@sandeepbollavaram`.
Easy to extend later; signals that v1.x is maintained.

### 9. SECURITY.md

A short, honest policy: how to report a vulnerability, what's in scope
(redaction boundary, snapshot import path), what's out of scope (the
agent's tool-call privileges — those are the host's concern).

### 10. Discoverability

Repo metadata that this ADR documents but does not enforce in code:

- **Topics:** `mcp`, `ai-agents`, `claude-code`, `developer-tools`,
  `typescript`, `local-first`, `cli`, `memory`.
- **Description:** _Persistent engineering memory and session-continuity
  for AI coding agents. Local-first, deterministic, replay-safe._
- **Discussions enabled** — unlocks the "Galaxy Brain" achievement,
  more importantly gives users a place to ask questions without filing
  bugs.

## Consequences

- A green CI badge means something — same gate ran on three OSes and
  two Node versions.
- Install regressions (like the v1.0.0 → v1.0.1 fix) become a CI failure
  before they reach a downstream consumer.
- The repository starts looking like maintained infrastructure to
  drive-by visitors, which is a real adoption lever.

## Honest scope

- CI catches **deterministic regressions**, not "the agent acted weird"
  bugs — those require dogfooding (see DOGFOOD_v1.0.0-rc1.md).
- The matrix is small. We'd rather have green-on-six-cells than
  yellow-on-twenty.
- Nightly replay can still go red the morning after a Node minor bump.
  That's the point: it's how we'd know.
