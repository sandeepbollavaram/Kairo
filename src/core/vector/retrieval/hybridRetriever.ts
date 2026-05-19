import type {
  EmbeddedChunk,
  Embedder,
  RankFactor,
  RetrievalQuery,
  RetrievalResult,
} from '../types.js';
import type { Checkpoint } from '../../../types/domain.js';
import { cosine } from '../embedding/deterministicEmbedder.js';

/**
 * Hybrid, explainable retrieval (ADR-0005). Cosine similarity is ONE factor; salience,
 * graph centrality, runtime layer, dependency proximity, recency and checkpoint
 * overlap make it architecture-aware so a central module beats a lexically similar
 * but peripheral example. Deterministic: pure over its inputs, tie-break by id.
 */
export interface RankWeights {
  similarity: number;
  salience: number;
  graphCentrality: number;
  sessionRecency: number;
  runtimeLayer: number;
  dependencyProximity: number;
  checkpointOverlap: number;
}

export const DEFAULT_RANK_WEIGHTS: RankWeights = {
  similarity: 1.0,
  salience: 0.9,
  graphCentrality: 0.7,
  sessionRecency: 0.4,
  runtimeLayer: 0.5,
  dependencyProximity: 0.5,
  checkpointOverlap: 0.6,
};

export interface RankContext {
  checkpoint?: Checkpoint | undefined;
  /** Reference "now" epoch for recency; defaults to max chunk ts. */
  nowMs?: number;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number(n.toFixed(6))));
}

function queryTerms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );
}

export function retrieve(
  query: RetrievalQuery,
  chunks: EmbeddedChunk[],
  embedder: Embedder,
  ctx: RankContext = {},
  weights: RankWeights = DEFAULT_RANK_WEIGHTS,
): RetrievalResult[] {
  if (chunks.length === 0) return [];
  const qVec = embedder.embed(query.text);
  const qTerms = queryTerms(query.text);

  const maxSal = Math.max(1e-9, ...chunks.map((c) => c.salience));
  const maxDeg = Math.max(1e-9, ...chunks.map((c) => c.graphDegree));
  const tsList = chunks.map((c) => (c.ts ? Date.parse(c.ts) : NaN)).filter((n) => !Number.isNaN(n));
  const newest = ctx.nowMs ?? (tsList.length ? Math.max(...tsList) : 0);
  const oldest = tsList.length ? Math.min(...tsList) : 0;
  const span = Math.max(1, newest - oldest);

  const cpTokens = ctx.checkpoint
    ? queryTerms(
        [ctx.checkpoint.task, ...ctx.checkpoint.remainingWork, ...ctx.checkpoint.blockers].join(
          ' ',
        ),
      )
    : new Set<string>();

  const results = chunks.map((c): RetrievalResult => {
    const similarity = clamp01(Math.max(0, cosine(qVec, c.vector)));

    const salience = clamp01(c.salience / maxSal);
    const graphCentrality = clamp01(c.graphDegree / maxDeg);
    const sessionRecency = c.ts ? clamp01((Date.parse(c.ts) - oldest) / span) : 0;
    const runtimeLayer = c.runtimeReachable ? 1 : c.kind === 'structural' ? 0.5 : 0.2;

    const hay = `${c.locator} ${c.neighbors.join(' ')} ${c.text}`.toLowerCase();
    let depHits = 0;
    for (const t of qTerms) if (hay.includes(t)) depHits++;
    const dependencyProximity = qTerms.size ? clamp01(depHits / qTerms.size) : 0;

    let cpHits = 0;
    const chunkTokens = queryTerms(`${c.locator} ${c.text}`);
    for (const t of cpTokens) if (chunkTokens.has(t)) cpHits++;
    const checkpointOverlap = cpTokens.size ? clamp01(cpHits / cpTokens.size) : 0;

    const kindBoost = query.kind && c.kind === query.kind ? 1.1 : 1;

    const raw: Record<keyof RankWeights, number> = {
      similarity,
      salience,
      graphCentrality,
      sessionRecency,
      runtimeLayer,
      dependencyProximity,
      checkpointOverlap,
    };
    const factors: RankFactor[] = (Object.keys(weights) as Array<keyof RankWeights>)
      .map((name) => {
        const w = weights[name];
        const weighted = Number((raw[name] * w).toFixed(6));
        return { name, raw: Number(raw[name].toFixed(4)), weight: w, weighted };
      })
      .filter((f) => f.raw !== 0);

    const score = Number((factors.reduce((s, f) => s + f.weighted, 0) * kindBoost).toFixed(6));
    const why = factors
      .slice()
      .sort((a, b) => b.weighted - a.weighted)
      .slice(0, 3)
      .map((f) => `${f.name} ${f.raw}`)
      .join(', ');

    return { chunk: c, score, similarity, factors, why };
  });

  results.sort((a, b) => b.score - a.score || (a.chunk.id < b.chunk.id ? -1 : 1));
  return results.slice(0, query.limit ?? 8);
}
