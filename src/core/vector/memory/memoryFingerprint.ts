import { createHash } from 'node:crypto';
import type { MemoryChunk } from '../types.js';

/**
 * Deterministic fingerprint of the built chunk set (v0.7.1). It is part of the index
 * cache key alongside the repo fingerprint + embedder id: a stable repo fingerprint
 * no longer lets cross-worker session/decision/checkpoint memory go stale, because
 * any change to a chunk's content, namespace, recency or graph context changes this.
 *
 * Pure and order-independent (chunks sorted by id) → identical events always yield an
 * identical fingerprint, so repeated refresh is idempotent and replay is byte-stable.
 */
export function computeMemoryFingerprint(chunks: MemoryChunk[]): string {
  const h = createHash('sha256');
  h.update('kairo-mem-fp:v1\n');
  const sorted = [...chunks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const c of sorted) {
    // JSON tuple = unambiguous field delimiting (no separator-collision risk).
    h.update(
      JSON.stringify([
        c.id,
        c.kind,
        c.locator,
        c.namespace ?? '',
        c.ts ?? '',
        Number(c.salience.toFixed(6)),
        c.graphDegree,
        c.runtimeReachable,
        c.neighbors,
        c.text,
      ]),
    );
    h.update('\n');
  }
  return h.digest('hex');
}
