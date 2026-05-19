import { createHash } from 'node:crypto';
import type { Embedder } from '../types.js';

/**
 * Deterministic, local, zero-dependency embedder (ADR-0005).
 *
 * HONEST SCOPE: this is **lexical/structural** similarity — a hashed bag of
 * code/identifier/path tokens with sub-token splitting and bigrams, L2-normalised.
 * It is NOT deep semantic similarity. It is the default because it is pure
 * (byte-identical across runs/machines — required to seed stable memory), needs no
 * network or secrets, and Kairo's hybrid ranking (salience/graph/runtime) carries
 * the architecture awareness. Semantic providers are pluggable behind `Embedder`.
 */
const DIM = 256;

function tokenize(text: string): string[] {
  const out: string[] = [];
  // Split on non-alphanumerics; also split camelCase / snake / kebab into parts.
  for (const rawTok of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!rawTok) continue;
    out.push(rawTok);
    for (const part of rawTok.split(/(?<=[a-z])(?=[0-9])|_/)) {
      if (part && part !== rawTok) out.push(part);
    }
  }
  // Adjacent bigrams add a little word-order signal without losing determinism.
  const bigrams: string[] = [];
  for (let i = 1; i < out.length; i++) bigrams.push(`${out[i - 1]}~${out[i]}`);
  return [...out, ...bigrams];
}

/** Stable signed bucket from a token (sha1 → bucket + sign). */
function hashToken(token: string): { bucket: number; sign: number } {
  const h = createHash('sha1').update(token).digest();
  const bucket = ((h[0]! << 16) | (h[1]! << 8) | h[2]!) % DIM;
  const sign = (h[3]! & 1) === 0 ? 1 : -1;
  return { bucket, sign };
}

export class DeterministicEmbedder implements Embedder {
  readonly id = 'kairo-deterministic-hash-v1';
  readonly dim = DIM;

  embed(text: string): number[] {
    const vec = new Array<number>(DIM).fill(0);
    const tokens = tokenize(text);
    if (tokens.length === 0) return vec;
    // Sublinear term weighting damps very repetitive text.
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [tok, count] of tf) {
      const { bucket, sign } = hashToken(tok);
      vec[bucket]! += sign * (1 + Math.log(count));
    }
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm === 0) return vec;
    for (let i = 0; i < DIM; i++) vec[i] = Number((vec[i]! / norm).toFixed(8));
    return vec;
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  // Vectors are pre-normalised, so dot == cosine. Clamp for float safety.
  return Math.max(-1, Math.min(1, Number(dot.toFixed(8))));
}

/** Provider registry — keeps the door open without hardwiring a provider. */
const REGISTRY = new Map<string, () => Embedder>([
  ['kairo-deterministic-hash-v1', () => new DeterministicEmbedder()],
]);

export function getEmbedder(id?: string): Embedder {
  const factory = id ? REGISTRY.get(id) : undefined;
  return factory ? factory() : new DeterministicEmbedder();
}

export function registerEmbedder(id: string, factory: () => Embedder): void {
  REGISTRY.set(id, factory);
}
