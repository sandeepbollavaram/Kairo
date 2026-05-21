import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStorageAdapter } from '../src/storage/fileStorageAdapter.js';
import { withRedaction } from '../src/storage/redactingAdapter.js';
import { MemoryEngine } from '../src/core/vector/memory/memoryEngine.js';
import { RepoScanner } from '../src/core/repo/repoScanner.js';
import type { Checkpoint, SessionState } from '../src/types/domain.js';
import { systemClock } from '../src/utils/time.js';

/**
 * v0.9.3 — per-chunk incremental indexing (ADR-0014). Asserts:
 *   1. First build embeds every chunk; reusedVectors=0.
 *   2. Repeating the build with identical inputs hits the top-level
 *      memoryFingerprint cache → reused=true, embedded=0.
 *   3. Mutating only the checkpoint task re-embeds the changed chunks
 *      but reuses the rest via the per-chunk text-hash cache.
 *   4. embedded + reusedVectors === total chunks (invariant).
 */
function minCheckpoint(id: string, task: string): Checkpoint {
  return {
    schema: 1,
    id,
    sessionId: 's1',
    agent: 'claude',
    createdAt: '2026-05-21T00:00:00.000Z',
    reason: 'manual',
    task,
    projectRoot: '/p',
    completedWork: [],
    remainingWork: [],
    blockers: [],
    changedFiles: [],
    decisions: [],
    unresolvedErrors: [],
    pressure: { score: 0, directive: 'CONTINUE', signals: {} as never, reasons: [] },
    risk: { level: 'low', score: 0, factors: [] },
    continuationRef: `${id}.md`,
  };
}

function minSession(id: string, task: string): SessionState {
  return {
    schema: 1,
    id,
    agent: 'claude',
    task,
    projectRoot: '/p',
    startedAt: '2026-05-21T00:00:00.000Z',
    lastActivityAt: '2026-05-21T00:00:00.000Z',
    status: 'ended',
    changedFiles: {},
    decisions: [],
    commands: [],
    errors: [],
    completedWork: [],
    pendingWork: [],
    blockers: [],
    retries: 0,
    heartbeats: 0,
    toolCalls: 0,
    compactions: 0,
    clarificationLoops: 0,
    cumulativeDiffBytes: 0,
    rereadCounts: {},
  };
}

async function seedRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kairo-inc-'));
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'inc-test', dependencies: { express: '^4.19.0' } }),
  );
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'index.ts'), 'export const x = 1;\n');
  return root;
}

describe('MemoryEngine.index incremental reuse', () => {
  it('first build embeds every chunk; repeat hits the memoryFingerprint cache', async () => {
    const root = await seedRoot();
    try {
      const adapter = withRedaction(new FileStorageAdapter(root), systemClock);
      await adapter.init();
      const intel = await new RepoScanner(systemClock).scan(root);
      const engine = new MemoryEngine(adapter);

      const inputs = {
        intel,
        sessions: [minSession('s1', 'wire payments')],
        checkpoint: minCheckpoint('cp1', 'wire payments'),
        projectRoot: root,
      };

      const r1 = await engine.index(inputs);
      expect(r1.reused).toBe(false);
      expect(r1.embedded).toBeGreaterThan(0);
      expect(r1.reusedVectors).toBe(0);
      expect(r1.embedded + r1.reusedVectors).toBe(r1.chunks);

      const r2 = await engine.index(inputs);
      // Identical inputs → memoryFingerprint matches → top-level reuse.
      expect(r2.reused).toBe(true);
      expect(r2.embedded).toBe(0);
      expect(r2.reusedVectors).toBe(r1.chunks);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('mutating one chunk re-embeds only that chunk; the rest are reused per-chunk', async () => {
    const root = await seedRoot();
    try {
      const adapter = withRedaction(new FileStorageAdapter(root), systemClock);
      await adapter.init();
      const intel = await new RepoScanner(systemClock).scan(root);
      const engine = new MemoryEngine(adapter);

      const inputs1 = {
        intel,
        sessions: [minSession('s1', 'wire payments')],
        checkpoint: minCheckpoint('cp1', 'wire payments'),
        projectRoot: root,
      };
      const r1 = await engine.index(inputs1);
      expect(r1.embedded).toBeGreaterThan(0);

      // Mutate ONLY the checkpoint task — most chunks (repo intel + docs)
      // are still byte-identical → per-chunk text-hash cache should kick in.
      const inputs2 = {
        ...inputs1,
        checkpoint: minCheckpoint('cp2', 'add idempotency keys'),
      };
      const r2 = await engine.index(inputs2);
      expect(r2.reused).toBe(false);
      // At least one chunk changed (checkpoint task) → some embedding work.
      expect(r2.embedded).toBeGreaterThan(0);
      // At least one chunk unchanged (repo intelligence) → some reuse.
      expect(r2.reusedVectors).toBeGreaterThan(0);
      // Invariant: every chunk is either embedded or reused exactly once.
      expect(r2.embedded + r2.reusedVectors).toBe(r2.chunks);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
