# Atlas Capsule — Field Report (v1.6.0 validation)

**Mission:** not "does Atlas Capsule exist?" but **"would I actually use this
instead of re-explaining the project?"** This report runs the shipped v1.6.0
capsule engine against multiple real repositories, measures it (character / file
/ list counts — **no fabricated token numbers**), and answers honestly.

**Method.** For each repo a real `RepoIntelligence` scan was produced and the
capsule rendered in tiny / standard / deep at the `generic`/`claude` targets. The
external repos were **never mutated** — scans were written to a throwaway temp
store and deleted. Kairo was measured twice: once **warm** (its genuine `.kairo/`
with a real checkpoint) and once **cold** (fresh store, no history) to isolate
the effect of prior Kairo usage.

**Headline result.** The capsule is **genuinely useful warm** and **weak cold**.
The single most important variable is whether the repo has prior Kairo state (a
checkpoint). With a checkpoint, the read-first plan and continuation are real.
Without one — the dominant first-contact case — `readFirst` is **empty** and the
continuation sections are blank, leaving only the architecture summary (which is
itself good).

---

## Measurement summary (standard mode unless noted)

| Project          | State | Lang     | std chars | read-first | safe-to-skip | task? | checkpoint? |
| ---------------- | ----- | -------- | --------- | ---------- | ------------ | ----- | ----------- |
| Kairo            | warm  | TS       | 3,638     | **6**      | 4            | ✅    | ✅          |
| Kairo            | cold  | TS       | 2,577     | **0**      | 4            | ❌    | ❌          |
| OCI-SentinelMesh | cold  | Python   | 2,622     | **0**      | 5            | ❌    | ❌          |
| Vayu             | cold  | C# /.NET | 2,241     | **0**      | 5            | ❌    | ❌          |
| 8bit-alu-verilog | cold  | Verilog  | 1,971     | **0**      | 3            | ❌    | ❌          |

All capsules stayed within budget; none truncated. tiny ranged 271–630 chars,
deep 2,082–4,646 (deep never approached its 20k cap on these repos — available
state simply did not fill it).

Warm vs cold on the **same** repo (Kairo, standard): read-first **6 → 0**, task
**present → null**, chars 3,638 → 2,577. That delta _is_ the feature.

---

## Per-run evaluation

### 1. Kairo — warm (TypeScript, real `.kairo/`, checkpoint present)

- **Mode/Target:** standard / claude · **Char count:** 3,638
- **Read-first (6):** `src/inspect/atlas/atlasAssets.ts`,
  `src/inspect/atlas/atlasHtml.ts`, `tests/atlasDetailPanel.test.ts`,
  `tests/atlasSearchFilters.test.ts`, then central modules `inspect`,
  `inspect/atlas`.
- **Safe-to-skip (4):** `node_modules/`, `dist/`, `.kairo/`, `docs/`.

**Evaluation (the 10 questions):**

1. Explains the project? **Yes** — identity, branch, version, language,
   frameworks, file mix, module-graph size are all correct and compact.
2. Current task correct? **Partly** — it shows the _last checkpoint's_ task
   ("Atlas v1.5.0 — search/filters…"), which is the last thing done, not
   necessarily what's next.
3. Completed items accurate? **No data** — "Nothing explicitly marked complete"
   (the v1.5.0 session-end checkpoint recorded none).
4. Remaining tasks accurate? **No data** — "No remaining work recorded."
5. Recommended files useful? **Yes, with a caveat** — they're the genuinely
   changed files plus the two most central touched modules. But all four files
   are "LOW risk, modified, touches 1" — the ranking is **flat** (no
   tie-break), so order is arbitrary among them.
6. Safe-to-skip reasonable? **Mostly** — `node_modules/dist/.kairo` are right;
   `docs/` is defensible for a code task but Kairo is doc-heavy.
7. Would a new agent know where to start? **Yes** — the read-first list plus
   "Relevant Atlas nodes" and memory recall give a real entry point.
8. Reduce bootstrap friction? **Yes** — it replaces the broad orientation scan.
9. Missing? Completed/remaining work (so "Exact next actions" degrades to a
   generic "run the test suite"); a one-line "what this project is."
10. Unnecessary? The `Fingerprint:` line; `dist/*` listed as entry points.

**Strengths:** architecture summary, memory recall (scored, semantic), atlas
nodes with salience, commands, agent instructions. Read-first ranking works when
risk/touch differ.
**Weaknesses:** empty completed/remaining → weak "next actions"; flat ranking
when all changed files share risk/touches; read-first reflects the _last_
session, not pending intent; fingerprint noise; build artifacts as entry points.

### 2. Kairo — cold (same repo, no history)

- standard / generic · **2,577 chars** · read-first **0** · skip **4**
- Identical architecture summary and atlas nodes, but **no task, no checkpoint,
  no changed files, empty read-first**. Demonstrates the warm→cold cliff on a
  controlled repo.

### 3. OCI-SentinelMesh — cold (Python monorepo: apps/packages/tests, FastAPI)

- standard / generic · **2,622 chars** · read-first **0** · skip **5**
- **Architecture: strong.** Correctly detects _Primary language: Python_,
  _Frameworks: Python, FastAPI, pytest, Docker, Docker Compose, Kubernetes/Helm,
  GitHub Actions_, the monorepo top-level dirs, and CI. This alone orients an
  agent meaningfully.
- **Weaknesses:** read-first empty; **Entry points "(none detected)"** (the
  detector is Node-centric — it misses `__main__.py` / `app.py` / FastAPI
  apps); skip-list recommends skipping `docs/` and `examples/` and lists
  `node_modules/` + `dist/` which **do not exist** in a Python repo; Atlas nodes
  exist but salience is mostly 0 (no Python import edges resolved).

### 4. Vayu — cold (C# / .NET, docs-heavy: 23 .md, xaml)

- standard / generic · **2,241 chars** · read-first **0** · skip **5**
- Correctly detects _Primary language: C#_ and the CI workflows.
- **Weaknesses (sharp here):** read-first empty; **`atlasNodes` empty** (no C#
  import graph); skip-list says skip `docs/` — but for Vayu, **docs are 23 of
  ~57 files and likely the primary content**, so "skip docs" is actively
  misleading; `node_modules/`/`dist/` listed though absent; no .NET frameworks
  detected beyond GitHub Actions.

### 5. 8bit-alu-verilog — cold (non-Node: Verilog)

- standard / generic · **1,971 chars** · read-first **0** · skip **3**
- Honest fallback: it does not pretend to understand Verilog. But **Primary
  language is reported as "Markdown"** (the `.md`/`.yml` count outweighs 2 `.v`
  files), which is wrong for the project's intent; entry points none; atlas
  nodes empty. The capsule degrades to "here is a tiny repo with a CI workflow."
  Usable as a pointer, not as a continuation package.

---

## The honest verdict

> **Would I use this instead of re-explaining the project?**

- **Warm repo (Kairo, with a checkpoint): yes.** The capsule gives identity,
  the changed-file read-first plan, central modules, scored memory recall, and
  commands in ~3.6 KB. I would paste it rather than re-explain — and then add
  the _one_ thing it lacks: the current goal/remaining work.
- **Cold repo (no Kairo history): not yet.** The architecture summary is worth
  pasting, but with **empty read-first and empty continuation** it is an
  _orientation blurb_, not a handoff. For a brand-new repo I would still
  re-explain what I'm doing, because the capsule cannot know.

So Atlas Capsule **delivers on its warm-path promise** and is honest about not
guaranteeing zero rereads. The gap between "useful" and "flagship" is almost
entirely in the **cold path** and in **continuation richness**, not in the
plumbing (which is solid: deterministic, redacted, repo-relative, budgeted).

---

## Top 10 improvements (ranked by impact)

1. **Give cold repos a real "read-first" plan.** Today read-first is derived
   _only_ from checkpoint changed files, so a repo with no history gets an empty
   list — the worst failure. Fall back to **entry points + highest-centrality
   Atlas nodes + key manifests (README, package/pyproject, main module)** when
   there are no changed files. This single change fixes every cold run above.

2. **Fix the safe-to-skip list to reflect the actual repo.** Stop hardcoding
   `node_modules/` and `dist/` as always-present (they're absent in Python/C#/
   Verilog repos), and **never recommend skipping `docs/` on a docs-dominant
   repo** (Vayu is mostly docs). Drive the skip list from observed top-level
   dirs + language, not a fixed list.

3. **Carry the current goal / remaining work, not just the last task.** Even
   warm, the continuation core was empty ("nothing completed / no remaining
   work"), so "Exact next actions" collapsed to a generic line. Pull pending
   work + blockers from the latest session ledger (not only the checkpoint), and
   prefer the _active_ session's intent over the last checkpoint's task.

4. **Make cross-language entry-point detection real.** "(none detected)" for
   Python and C# is a miss. Detect `__main__.py`, `app.py`/`main.py`, FastAPI/
   Flask/Django app objects, `Program.cs`/`*.csproj`, Go `main`, etc. Entry
   points are the natural read-first seed for cold repos.

5. **Improve read-first ranking when risk/touches are flat.** When every changed
   file is "low risk, touches 1," break ties by **graph centrality, file kind
   (source > test), and recency**, so order is meaningful instead of arbitrary.

6. **Add a one-line project synopsis.** None of the capsules say _what the
   project is_ in a sentence. Derive it from the README's first heading/sentence
   (redacted) so the next agent gets instant context.

7. **Fix primary-language inference for small/mixed repos.** Verilog repo was
   labelled "Markdown" because doc/config files outnumbered `.v`. Weight by
   source-language signal (manifests, CI, file roles), not raw file count.

8. **Drop low-signal noise from the architecture summary.** The `Fingerprint:`
   line and listing `dist/*` build artifacts as "entry points" add nothing for
   an agent — prefer `src/` entry points and hide internal hashes.

9. **Make cold capsules state their own limitation prominently.** When there's
   no checkpoint, lead with one honest line ("No prior Kairo session — this is a
   first-contact orientation, not a continuation") so the reader calibrates
   trust. (The deep-mode note already hints this; surface it in all modes — a
   minor follow-on to the v1.6.0 no-checkpoint line.)

10. **Surface Atlas edges for non-import languages (or say "graph unavailable").**
    Python/C#/Verilog produced 0-salience or empty Atlas nodes because the graph
    is import-based. Either extend edge extraction or, when the graph is empty,
    omit the section and substitute "directory map" so the capsule doesn't show
    a list of zero-salience nodes.

---

## Notes for maintainers

- **Scope:** this is validation only. No features, tools, routes, or
  architecture were added. The findings above are recommendations for a future
  release, not changes made here.
- **Reproduce:** `kairo capsule --mode <m> --target <t> --json` reports `chars`,
  `readFirst`, `skipInitially`, `truncated`. Cold-repo measurement used a
  throwaway storage root so external repos were never written to.
- **Excluded:** Flexdee was intentionally left untouched per instruction; a
  Python monorepo (OCI-SentinelMesh), a C#/.NET repo (Vayu), and a Verilog repo
  (8bit-alu-verilog) cover the non-Node spread instead.
