import type { StorageAdapter } from '../../../storage/storageAdapter.js';
import type { RepoIntelligence } from '../../repo/types.js';
import type { Checkpoint, SessionState } from '../../../types/domain.js';
import type {
  EmbeddedChunk,
  MemoryChunk,
  RetrievalQuery,
  RetrievalResult,
  VectorIndex,
} from '../types.js';
import { createHash } from 'node:crypto';
import type { EmbeddingProvider } from '../providers/types.js';
import { resolveProviderFromEnv, deterministicProvider } from '../providers/registry.js';
import { chunkRepoIntelligence, chunkSessionMemory, chunkDocs } from '../chunking/memoryChunker.js';
import { retrieve, type RankContext } from '../retrieval/hybridRetriever.js';
import { architectureDigest } from '../compression/architectureDigest.js';
import { computeMemoryFingerprint } from './memoryFingerprint.js';
import { logger } from '../../../utils/logger.js';

export interface IndexInputs {
  intel: RepoIntelligence;
  sessions: SessionState[];
  checkpoint: Checkpoint | undefined;
  projectRoot: string;
  /** sessionId → coordination namespace (v0.7.0); defaults to shared workspace. */
  namespaceOf?: (sessionId: string) => string;
}

export interface IndexResult {
  fingerprint: string;
  embedderId: string;
  memoryFingerprint: string;
  chunks: number;
  reused: boolean;
  /** True if a configured remote provider failed and deterministic was used. */
  fellBack: boolean;
  /** v0.9.3: per-chunk incremental indexing counters. */
  embedded: number;
  reusedVectors: number;
}

/**
 * Facade over chunking + embedding provider + storage + retrieval (ADR-0006).
 *
 * The index is keyed by repo fingerprint + embedder id: a match means NO re-embedding.
 * A configured remote provider that errors degrades to the deterministic provider —
 * an embedding outage must never break a session, and the index is stamped with the
 * provider ACTUALLY used so a remote-labelled index never holds fallback vectors.
 */
export class MemoryEngine {
  private readonly primary: EmbeddingProvider;
  private readonly fallback: EmbeddingProvider;

  constructor(
    private readonly adapter: StorageAdapter,
    provider?: EmbeddingProvider,
  ) {
    this.fallback = deterministicProvider();
    let resolved: EmbeddingProvider;
    try {
      resolved = provider ?? resolveProviderFromEnv();
    } catch (e) {
      logger.warn(
        `Embedding provider misconfigured; using deterministic. ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      resolved = this.fallback;
    }
    this.primary = resolved;
  }

  async buildChunks(inputs: IndexInputs): Promise<MemoryChunk[]> {
    return [
      ...chunkRepoIntelligence(inputs.intel),
      ...chunkSessionMemory(
        inputs.sessions,
        inputs.checkpoint,
        inputs.namespaceOf ?? (() => 'workspace'),
      ),
      ...(await chunkDocs(inputs.projectRoot)),
    ];
  }

  /** Embed via the primary provider; on remote failure fall back to deterministic. */
  private async embedAll(
    texts: string[],
  ): Promise<{ vectors: number[][]; provider: EmbeddingProvider; fellBack: boolean }> {
    try {
      const vectors = await this.primary.embedBatch(texts);
      return { vectors, provider: this.primary, fellBack: false };
    } catch (e) {
      if (!this.primary.remote) throw e; // deterministic failing is a real bug
      logger.warn(
        `Embedding provider ${this.primary.id} failed; falling back to deterministic. ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      const vectors = await this.fallback.embedBatch(texts);
      return { vectors, provider: this.fallback, fellBack: true };
    }
  }

  async index(inputs: IndexInputs, force = false): Promise<IndexResult> {
    // Build chunks first (cheap, offline, deterministic). Only the embed step is
    // skipped on a true match — so session/decision/checkpoint changes cannot make
    // cross-worker memory stale (v0.7.1).
    const chunks = await this.buildChunks(inputs);
    const memoryFingerprint = computeMemoryFingerprint(chunks);
    const existing = await this.adapter.loadVectorIndex();
    if (
      !force &&
      existing &&
      existing.schema === 3 &&
      existing.fingerprint === inputs.intel.fingerprint &&
      existing.embedderId === this.primary.id &&
      existing.memoryFingerprint === memoryFingerprint
    ) {
      return {
        fingerprint: existing.fingerprint,
        embedderId: existing.embedderId,
        memoryFingerprint: existing.memoryFingerprint,
        chunks: existing.chunks.length,
        reused: true,
        fellBack: false,
        embedded: 0,
        reusedVectors: existing.chunks.length,
      };
    }

    // ── v0.9.3 incremental indexing ──────────────────────────────────────
    // Build a lookup of existing vectors keyed by text-hash. Reuse vectors
    // for any chunk whose text matches an existing chunk; only embed the
    // ones that don't. Deterministic chunk ordering is preserved.
    const reusable =
      existing &&
      existing.schema === 3 &&
      existing.embedderId === this.primary.id &&
      existing.fingerprint === inputs.intel.fingerprint
        ? indexByTextHash(existing.chunks)
        : new Map<string, number[]>();

    const toEmbed: { i: number; text: string }[] = [];
    const reusedVectors: (number[] | undefined)[] = Array.from({ length: chunks.length });
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]!;
      const hash = textHash(c.text);
      const v = reusable.get(hash);
      if (v) reusedVectors[i] = v;
      else toEmbed.push({ i, text: c.text });
    }

    let fellBack = false;
    let provider = this.primary;
    const finalVectors: number[][] = Array.from({ length: chunks.length }, () => []);
    if (toEmbed.length === 0) {
      provider = this.primary;
    } else {
      const r = await this.embedAll(toEmbed.map((t) => t.text));
      provider = r.provider;
      fellBack = r.fellBack;
      for (let k = 0; k < toEmbed.length; k++) {
        finalVectors[toEmbed[k]!.i] = r.vectors[k]!;
      }
    }
    for (let i = 0; i < chunks.length; i++) {
      if (reusedVectors[i]) finalVectors[i] = reusedVectors[i]!;
    }

    const embedded: EmbeddedChunk[] = chunks.map((c, i) => ({ ...c, vector: finalVectors[i]! }));
    const idx: VectorIndex = {
      schema: 3,
      fingerprint: inputs.intel.fingerprint,
      memoryFingerprint,
      embedderId: provider.id, // the provider ACTUALLY used
      dim: provider.dim,
      builtAt: new Date(0).toISOString(), // deterministic; freshness via fingerprints
      chunks: embedded,
    };
    await this.adapter.saveVectorIndex(idx);
    const embeddedCount = toEmbed.length;
    const reusedCount = chunks.length - embeddedCount;
    logger.info('Vector memory indexed', {
      chunks: embedded.length,
      embedder: provider.id,
      embedded: embeddedCount,
      reused: reusedCount,
      fellBack,
    });
    return {
      fingerprint: idx.fingerprint,
      embedderId: idx.embedderId,
      memoryFingerprint: idx.memoryFingerprint,
      chunks: embedded.length,
      reused: false,
      fellBack,
      embedded: embeddedCount,
      reusedVectors: reusedCount,
    };
  }

  /** Load only an index whose embedder matches the active primary provider. */
  private async loadValid(): Promise<VectorIndex | undefined> {
    const idx = await this.adapter.loadVectorIndex();
    if (!idx || idx.schema !== 3) return undefined;
    if (idx.embedderId !== this.primary.id && idx.embedderId !== this.fallback.id) {
      return undefined;
    }
    return idx;
  }

  async search(query: RetrievalQuery, ctx: RankContext = {}): Promise<RetrievalResult[]> {
    const idx = await this.loadValid();
    if (!idx) return [];
    // Query must be embedded with the SAME provider that built the index.
    const useFallback = idx.embedderId === this.fallback.id && this.primary.id !== idx.embedderId;
    let qVec: number[];
    try {
      qVec = (await (useFallback ? this.fallback : this.primary).embed(query.text)) ?? [];
    } catch {
      if (this.primary.remote) qVec = await this.fallback.embed(query.text);
      else throw new Error('deterministic query embedding failed');
    }
    return retrieve(query, idx.chunks, qVec, ctx);
  }

  async compress(): Promise<string | undefined> {
    const idx = await this.loadValid();
    return idx ? architectureDigest(idx.chunks) : undefined;
  }

  async stats(): Promise<
    | {
        chunks: number;
        embedderId: string;
        fingerprint: string;
        memoryFingerprint: string;
        dim: number;
      }
    | undefined
  > {
    const idx = await this.loadValid();
    return idx
      ? {
          chunks: idx.chunks.length,
          embedderId: idx.embedderId,
          fingerprint: idx.fingerprint,
          memoryFingerprint: idx.memoryFingerprint,
          dim: idx.dim,
        }
      : undefined;
  }
}

function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function indexByTextHash(chunks: EmbeddedChunk[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const c of chunks) {
    if (!m.has(textHash(c.text))) m.set(textHash(c.text), c.vector);
  }
  return m;
}
