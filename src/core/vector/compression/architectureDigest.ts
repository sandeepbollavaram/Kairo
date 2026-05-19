import type { MemoryChunk } from '../types.js';

/**
 * Deterministic architecture compression (ADR-0005): turn the full memory set into a
 * compact, salience-ordered digest an agent can read instead of rescanning the repo.
 * Heuristic and bounded — stated honestly. Not an LLM summary; a structured extract.
 */
export interface DigestOptions {
  maxStructural?: number;
  maxDecisions?: number;
}

export function architectureDigest(chunks: MemoryChunk[], opts: DigestOptions = {}): string {
  const byKind = (k: MemoryChunk['kind']): MemoryChunk[] =>
    chunks
      .filter((c) => c.kind === k)
      .sort((a, b) => b.salience - a.salience || (a.id < b.id ? -1 : 1));

  const overview = chunks.find((c) => c.id === 'struct:overview');
  const structural = byKind('structural')
    .filter((c) => c.id !== 'struct:overview')
    .slice(0, opts.maxStructural ?? 12);
  const decisions = byKind('decision').slice(0, opts.maxDecisions ?? 8);
  const operational = byKind('operational').slice(0, 3);

  const lines: string[] = ['# Compressed Architectural Memory', ''];
  if (overview) lines.push(`> ${overview.text}`, '');

  if (structural.length) {
    lines.push('## Salient modules');
    for (const c of structural) {
      lines.push(
        `- **${c.locator}** (salience ${c.salience.toFixed(2)}, deg ${c.graphDegree})` +
          `${c.neighbors.length ? ` ↔ ${c.neighbors.slice(0, 6).join(', ')}` : ''}`,
      );
    }
    lines.push('');
  }
  if (decisions.length) {
    lines.push('## Key decisions');
    for (const c of decisions) lines.push(`- ${c.text}`);
    lines.push('');
  }
  if (operational.length) {
    lines.push('## Operational');
    for (const c of operational) lines.push(`- ${c.text}`);
    lines.push('');
  }
  lines.push(
    '_Deterministic salience-ordered extract (heuristic). Use kairo_memory_search for targeted recall._',
  );
  return lines.join('\n');
}
