import type { StorageAdapter } from '../../../storage/storageAdapter.js';
import type { RepoIntelligence } from '../../repo/types.js';
import type { Checkpoint, SessionState } from '../../../types/domain.js';
import type {
  EmbeddedChunk,
  Embedder,
  MemoryChunk,
  RetrievalQuery,
  RetrievalResult,
  VectorIndex,
} from '../types.js';
import { getEmbedder } from '../embedding/deterministicEmbedder.js';
import { chunkRepoIntelligence, chunkSessionMemory, chunkDocs } from '../chunking/memoryChunker.js';
import { retrieve, type RankContext } from '../retrieval/hybridRetriever.js';
import { architectureDigest } from '../compression/architectureDigest.js';
import { logger } from '../../../utils/logger.js';

export interface IndexInputs {
  intel: RepoIntelligence;
  sessions: SessionState[];
  checkpoint: Checkpoint | undefined;
  projectRoot: string;
}

export interface IndexResult {
  fingerprint: string;
  embedderId: string;
  chunks: number;
  reused: boolean;
}

/**
 * Facade over chunking + embedding + storage + retrieval. The index is keyed by the
 * repo fingerprint + embedder id: a match means NO re-embedding (same anti-rescan
 * property as cached intelligence). All persistence goes through the redaction
 * boundary via the adapter.
 */
export class MemoryEngine {
  private readonly embedder: Embedder;

  constructor(
    private readonly adapter: StorageAdapter,
    embedder?: Embedder,
  ) {
    this.embedder = embedder ?? getEmbedder();
  }

  async buildChunks(inputs: IndexInputs): Promise<MemoryChunk[]> {
    return [
      ...chunkRepoIntelligence(inputs.intel),
      ...chunkSessionMemory(inputs.sessions, inputs.checkpoint),
      ...(await chunkDocs(inputs.projectRoot)),
    ];
  }

  /** Build or reuse the index. Deterministic; reused when fingerprint+embedder match. */
  async index(inputs: IndexInputs, force = false): Promise<IndexResult> {
    const existing = await this.adapter.loadVectorIndex();
    if (
      !force &&
      existing &&
      existing.fingerprint === inputs.intel.fingerprint &&
      existing.embedderId === this.embedder.id
    ) {
      return {
        fingerprint: existing.fingerprint,
        embedderId: existing.embedderId,
        chunks: existing.chunks.length,
        reused: true,
      };
    }
    const chunks = await this.buildChunks(inputs);
    const embedded: EmbeddedChunk[] = chunks.map((c) => ({
      ...c,
      vector: this.embedder.embed(c.text),
    }));
    const idx: VectorIndex = {
      schema: 2,
      fingerprint: inputs.intel.fingerprint,
      embedderId: this.embedder.id,
      dim: this.embedder.dim,
      builtAt: new Date(0).toISOString(), // deterministic; freshness tracked by fingerprint
      chunks: embedded,
    };
    await this.adapter.saveVectorIndex(idx);
    logger.info('Vector memory indexed', {
      chunks: embedded.length,
      embedder: this.embedder.id,
    });
    return {
      fingerprint: idx.fingerprint,
      embedderId: idx.embedderId,
      chunks: embedded.length,
      reused: false,
    };
  }

  private async loadValid(): Promise<VectorIndex | undefined> {
    const idx = await this.adapter.loadVectorIndex();
    if (!idx || idx.schema !== 2 || idx.embedderId !== this.embedder.id) return undefined;
    return idx;
  }

  async search(query: RetrievalQuery, ctx: RankContext = {}): Promise<RetrievalResult[]> {
    const idx = await this.loadValid();
    if (!idx) return [];
    return retrieve(query, idx.chunks, this.embedder, ctx);
  }

  async compress(): Promise<string | undefined> {
    const idx = await this.loadValid();
    if (!idx) return undefined;
    return architectureDigest(idx.chunks);
  }

  async stats(): Promise<{ chunks: number; embedderId: string; fingerprint: string } | undefined> {
    const idx = await this.loadValid();
    return idx
      ? { chunks: idx.chunks.length, embedderId: idx.embedderId, fingerprint: idx.fingerprint }
      : undefined;
  }
}
