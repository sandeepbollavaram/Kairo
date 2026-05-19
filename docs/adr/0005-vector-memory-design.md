# ADR-0005: Vector memory is architecture-aware hybrid recall, not naive RAG

- Status: Accepted
- Date: 2026-05-19
- Related: ADR-0001 (event-sourced/local-first), ADR-0002 (cooperative),
  ADR-0004 (salience subsystem)

## Context

v0.6.0 adds semantic memory so an agent can recall architectural context instead of
rescanning. The naive implementation — chunk every file, embed with a hosted model,
retrieve by cosine — is explicitly rejected by the project brief and conflicts with
Kairo's load-bearing principles.

Three hard constraints:

1. **Local-first, no secrets** (ADR-0001). A hosted embedding API adds a network
   dependency, key handling, and a remote data path for source code.
2. **Determinism / byte-stability.** The salience subsystem (ADR-0004) and the cached
   intelligence are deterministic precisely so memory does not churn. A hosted model
   is versioned and non-deterministic; embedding drift silently corrupts long-term
   memory — the exact failure the v0.5.x gate existed to prevent.
3. **Correct > flashy.** Embedding quality is not Kairo's differentiator; the agent
   already has a strong LLM. Kairo's value is _which_ context to surface.

## Decision

### Embedder: pluggable provider, deterministic local default

`Embedder` is an interface. The default `DeterministicEmbedder` is a pure,
fixed-dimension hashed feature vector over code/identifier/path/metadata tokens,
L2-normalised. It is **lexical/structural similarity, not deep semantic similarity**,
and is documented and surfaced as such — we do not oversell it. Hosted/semantic
providers (OpenAI, local GGUF, etc.) are future adapters behind the same interface;
none is hardwired. The embedder id is stored with the index so a provider change
invalidates it.

### Retrieval: explainable hybrid fusion, not cosine-only

Ranking fuses, with per-factor explanations:

`similarity · salience · graphCentrality · sessionRecency · runtimeLayer ·
dependencyProximity · checkpointOverlap`

Because salience and graph/runtime factors carry real weight, a central `auth`
module outranks a lexically similar but peripheral `examples/` file even with a
weak embedder. This is the property that makes it _architecture-aware_, and it
degrades gracefully: with a poor embedder, structure still dominates correctly.

### Chunks are architecture-aware objects, not file slices

We do not blindly chunk/embed files. Chunks are built from artifacts Kairo already
derives deterministically — repo intelligence, the salience-ranked module graph,
ADRs/docs, checkpoints, decisions, operational facts — across five memory classes
(structural / semantic / session / decision / operational). Each chunk carries its
salience, graph neighbourhood, and layer, so retrieval reasons over architecture.

### Storage: interface, local JSON default

`VectorStore` is an interface; the default `JsonVectorStore` persists through the
existing redaction boundary, keyed by the repo fingerprint + embedder id. A
fingerprint match means **no re-embedding** — the same anti-rescan property as
cached intelligence. SQLite/LanceDB/Qdrant/pgvector are future adapters.

## Consequences

- No network, no secrets, byte-stable memory by default; semantic providers opt-in.
- The success condition (less rescanning, better continuity) is met structurally:
  fingerprint-keyed index avoids recompute, and continuation briefs auto-carry
  retrieved architecture so the next agent starts with context, not a blank repo.
- Honest limitation, stated everywhere: default similarity is lexical/structural.
  Where that is weaker than a hosted model, hybrid structure compensates; where it
  still fails, the dogfood says so.
- Future (multi-agent/shared cognition, evolution timelines, PR-review memory) are
  additional chunk kinds + stores behind the same interfaces — no redesign.
