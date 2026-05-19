/**
 * Vector / semantic memory model (v0.6.0). See ADR-0005 and docs/VECTOR_MEMORY.md.
 * This is architecture-aware hybrid recall, NOT naive RAG.
 */

/** The five memory classes from the brief. */
export type MemoryKind = 'structural' | 'semantic' | 'session' | 'decision' | 'operational';

/**
 * An architecture-aware semantic object — not a raw file slice. `text` is what gets
 * embedded; the rest drives hybrid ranking and explanations.
 */
export interface MemoryChunk {
  id: string;
  kind: MemoryKind;
  /** Repo-relative path or logical locator (e.g. a module-graph group). */
  locator: string;
  /** Enriched embeddable text (summary + structural context, not raw dump). */
  text: string;
  /** Salience [0,1+] from the salience subsystem (ADR-0004). */
  salience: number;
  /** Graph degree of the owning module group, if any. */
  graphDegree: number;
  /** True if reachable from a runtime entry point. */
  runtimeReachable: boolean;
  /** Module-graph neighbours (group labels) for dependency-proximity ranking. */
  neighbors: string[];
  /** ISO timestamp for session/decision recency; omitted for static structure. */
  ts?: string;
  /**
   * Coordination namespace (v0.7.0). `workspace` (or omitted) = shared knowledge
   * visible to all workers; a worker id = private session memory, isolated unless
   * the searching worker matches. Deterministic filter, not a ranking change.
   */
  namespace?: string;
}

export interface EmbeddedChunk extends MemoryChunk {
  vector: number[];
}

/** Pluggable embedder. Default impl is deterministic + local (ADR-0005). */
export interface Embedder {
  /** Stable id incl. version; stored with the index to detect provider changes. */
  readonly id: string;
  readonly dim: number;
  /** Pure for the deterministic default: same input → same vector, always. */
  embed(text: string): number[];
}

export interface VectorIndex {
  schema: 2;
  /** Repo fingerprint this index was built for (anti-recompute key). */
  fingerprint: string;
  embedderId: string;
  dim: number;
  builtAt: string;
  chunks: EmbeddedChunk[];
}

export interface VectorStore {
  save(index: VectorIndex): Promise<void>;
  load(): Promise<VectorIndex | undefined>;
}

export interface RankFactor {
  name: string;
  /** Normalised [0,1] contribution before weighting. */
  raw: number;
  weight: number;
  weighted: number;
  note?: string;
}

export interface RetrievalResult {
  chunk: MemoryChunk;
  score: number;
  similarity: number;
  factors: RankFactor[];
  /** Human-readable "why this ranked here". */
  why: string;
}

export interface RetrievalQuery {
  text: string;
  limit?: number;
  /** Optional bias toward a memory class. */
  kind?: MemoryKind;
}
