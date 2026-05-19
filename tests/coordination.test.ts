import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoordinationManager } from '../src/core/coordination/coordinationManager.js';
import { FileStorageAdapter } from '../src/storage/fileStorageAdapter.js';
import { withRedaction } from '../src/storage/redactingAdapter.js';
import { fixedClock } from '../src/utils/time.js';
import { retrieve } from '../src/core/vector/retrieval/hybridRetriever.js';
import { DeterministicEmbedder } from '../src/core/vector/embedding/deterministicEmbedder.js';
import type { EmbeddedChunk } from '../src/core/vector/types.js';

let root: string;
function mgr(epoch = 1_000): CoordinationManager {
  return new CoordinationManager(
    withRedaction(new FileStorageAdapter(root), fixedClock(epoch)),
    fixedClock(epoch),
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kairo-coord-'));
  await withRedaction(new FileStorageAdapter(root), fixedClock(0)).init();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('cooperative leases', () => {
  it('grants, then denies an overlapping scope to another worker with an explanation', async () => {
    const c = mgr();
    await c.registerWorker('s1', 'alice', 'alice', 'claude');
    await c.registerWorker('s2', 'bob', 'bob', 'claude');

    const a = await c.acquire({
      sessionId: 's1',
      workerId: 'alice',
      scopeKind: 'path',
      scope: 'src/core',
      ttlMs: 60_000,
    });
    expect(a.granted).toBe(true);

    // Overlapping sub-path requested by a different worker → denied + conflict.
    const b = await c.acquire({
      sessionId: 's2',
      workerId: 'bob',
      scopeKind: 'path',
      scope: 'src/core/session',
      ttlMs: 60_000,
    });
    expect(b.granted).toBe(false);
    expect(b.conflict?.workerId).toBe('alice');
    expect(b.reason).toMatch(/leased by worker "alice"/);

    // Same worker re-requesting an overlapping scope is idempotent (granted).
    const aAgain = await c.acquire({
      sessionId: 's1',
      workerId: 'alice',
      scopeKind: 'path',
      scope: 'src/core/session',
      ttlMs: 60_000,
    });
    expect(aAgain.granted).toBe(true);

    // A disjoint path is free.
    const d = await c.acquire({
      sessionId: 's2',
      workerId: 'bob',
      scopeKind: 'path',
      scope: 'src/server',
      ttlMs: 60_000,
    });
    expect(d.granted).toBe(true);
  });

  it('release frees the scope; expiry is deterministic against the clock', async () => {
    const c = mgr(1_000);
    await c.registerWorker('s1', 'alice', 'alice', 'claude');
    const a = await c.acquire({
      sessionId: 's1',
      workerId: 'alice',
      scopeKind: 'task',
      scope: 'refactor auth',
      ttlMs: 5_000,
    });
    expect(a.granted).toBe(true);

    // 10s later (> ttl) the lease is projected as expired — deterministically.
    const stExpired = await c.state(1_000 + 10_000);
    expect(stExpired.activeLeases).toHaveLength(0);
    expect(stExpired.allLeases[0]!.status).toBe('expired');

    // Before expiry it is active; after release it is gone.
    expect((await c.state(1_500)).activeLeases).toHaveLength(1);
    await c.release('s1', 'alice', a.lease!.id);
    expect((await c.state(1_500)).activeLeases).toHaveLength(0);
  });

  it('conflict resolution is deterministic by log order (earliest wins → superseded)', async () => {
    const c = mgr();
    await c.registerWorker('s1', 'alice', 'alice', 'claude');
    await c.registerWorker('s2', 'bob', 'bob', 'claude');
    await c.acquire({
      sessionId: 's1',
      workerId: 'alice',
      scopeKind: 'module',
      scope: 'core',
      ttlMs: 60_000,
    });
    // Force a raw overlapping acquire from bob bypassing the guard (simulates a
    // concurrent appender that did not see alice's lease yet).
    const adapter = withRedaction(new FileStorageAdapter(root), fixedClock(2_000));
    await adapter.appendEvent({
      schema: 1,
      id: 'zzz-late',
      ts: new Date(2_000).toISOString(),
      sessionId: 's2',
      type: 'lease.acquired',
      payload: {
        leaseId: 'bob-lease',
        workerId: 'bob',
        scopeKind: 'module',
        scope: 'core',
        ttlMs: 60_000,
        acquiredAt: new Date(2_000).toISOString(),
      },
    });
    const st = await c.state(3_000);
    const bob = st.allLeases.find((l) => l.id === 'bob-lease')!;
    expect(bob.status).toBe('superseded');
    expect(st.activeLeases.filter((l) => l.scope === 'core')).toHaveLength(1);
    // Re-projection is identical (determinism).
    expect(JSON.stringify(await c.state(3_000))).toBe(JSON.stringify(st));
  });

  it('scopesOverlap: ancestor/descendant paths overlap, siblings do not', () => {
    expect(CoordinationManager.scopesOverlap('path', 'a/b', 'a/b/c')).toBe(true);
    expect(CoordinationManager.scopesOverlap('path', 'a/b', 'a/bc')).toBe(false);
    expect(CoordinationManager.scopesOverlap('task', 'X', 'x')).toBe(true);
  });
});

describe('namespace retrieval isolation (deterministic)', () => {
  const e = new DeterministicEmbedder();
  const chunk = (over: Partial<EmbeddedChunk>): EmbeddedChunk => ({
    id: 'x',
    kind: 'session',
    locator: 'l',
    text: 'auth work',
    salience: 1,
    graphDegree: 1,
    runtimeReachable: false,
    neighbors: [],
    vector: e.embed('auth work'),
    ...over,
  });

  it("a worker never sees another worker's private session memory; shared is visible to all", () => {
    const shared = chunk({ id: 'struct:overview', kind: 'structural', namespace: 'workspace' });
    const aliceMem = chunk({ id: 'decision:alice', kind: 'decision', namespace: 'alice' });
    const bobMem = chunk({ id: 'decision:bob', kind: 'decision', namespace: 'bob' });
    const all = [shared, aliceMem, bobMem];

    const asAlice = retrieve({ text: 'auth' }, all, e.embed('auth'), { namespace: 'alice' }).map(
      (r) => r.chunk.id,
    );
    expect(asAlice).toContain('struct:overview');
    expect(asAlice).toContain('decision:alice');
    expect(asAlice).not.toContain('decision:bob');

    // No namespace requested → no isolation (back-compat).
    const noIso = retrieve({ text: 'auth' }, all, e.embed('auth')).map((r) => r.chunk.id);
    expect(noIso).toContain('decision:bob');
  });
});
