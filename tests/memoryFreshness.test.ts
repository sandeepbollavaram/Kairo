import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryEngine } from '../src/core/vector/memory/memoryEngine.js';
import { computeMemoryFingerprint } from '../src/core/vector/memory/memoryFingerprint.js';
import { chunkRepoIntelligence } from '../src/core/vector/chunking/memoryChunker.js';
import type { RepoIntelligence } from '../src/core/repo/types.js';
import { INTELLIGENCE_SCHEMA } from '../src/core/repo/types.js';
import type { Checkpoint, SessionState } from '../src/types/domain.js';
import { FileStorageAdapter } from '../src/storage/fileStorageAdapter.js';
import { withRedaction } from '../src/storage/redactingAdapter.js';
import { SessionManager } from '../src/core/session/sessionManager.js';
import { fixedClock } from '../src/utils/time.js';

function intel(): RepoIntelligence {
  return {
    schema: INTELLIGENCE_SCHEMA,
    fingerprint: 'repo-fp-stable',
    generatedAt: '2026-01-01T00:00:00.000Z',
    projectRoot: '/p',
    inventory: {
      totalFiles: 1,
      totalBytes: 1,
      byExtension: { ts: 1 },
      topLevelDirs: ['src'],
      sourceDirs: [],
      truncated: false,
    },
    languages: { byFiles: { TypeScript: 1 }, primary: 'TypeScript' },
    frameworks: [],
    entryPoints: [],
    manifests: [],
    ciWorkflows: [],
    moduleGraph: { kind: 'module', title: 'm', truncated: false, note: '', nodes: [], edges: [] },
  };
}
function session(id: string, decisionSummary: string): SessionState {
  return {
    id,
    decisions: [{ ts: '2026-01-02T00:00:00.000Z', summary: decisionSummary }],
  } as never;
}
function checkpoint(id: string, task: string): Checkpoint {
  return {
    id,
    sessionId: 's-alice',
    createdAt: '2026-01-03T00:00:00.000Z',
    task,
    remainingWork: [],
    blockers: [],
    risk: { level: 'low' },
  } as never;
}

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kairo-fresh-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('memory fingerprint', () => {
  it('is deterministic and order-independent', () => {
    const a = chunkRepoIntelligence(intel());
    const b = chunkRepoIntelligence(intel());
    expect(computeMemoryFingerprint(a)).toBe(computeMemoryFingerprint(b));
    expect(computeMemoryFingerprint([...a].reverse())).toBe(computeMemoryFingerprint(a));
  });
  it('changes when a decision or checkpoint chunk changes', () => {
    const base = chunkRepoIntelligence(intel());
    const withDecision = [
      ...base,
      {
        id: 'decision:x',
        kind: 'decision' as const,
        locator: 's',
        text: 'decided A',
        salience: 1,
        graphDegree: 0,
        runtimeReachable: false,
        neighbors: [],
        namespace: 'alice',
      },
    ];
    expect(computeMemoryFingerprint(withDecision)).not.toBe(computeMemoryFingerprint(base));
  });
});

describe('MemoryEngine index invalidation (v0.7.1)', () => {
  it('reuses when nothing changed, rebuilds when a decision/checkpoint appears', async () => {
    const adapter = withRedaction(new FileStorageAdapter(root), fixedClock(0));
    await adapter.init();
    const m = new MemoryEngine(adapter);

    const base = { intel: intel(), sessions: [], checkpoint: undefined, projectRoot: root };
    const first = await m.index(base);
    expect(first.reused).toBe(false);

    // Idempotent: same inputs → reuse, no re-embed.
    expect((await m.index(base)).reused).toBe(true);
    expect((await m.index(base)).reused).toBe(true);

    // A decision appears (repo fingerprint unchanged) → MUST invalidate.
    const withDecision = {
      intel: intel(),
      sessions: [session('s-alice', 'extract reducer')],
      checkpoint: undefined,
      projectRoot: root,
      namespaceOf: () => 'alice',
    };
    const reb = await m.index(withDecision);
    expect(reb.reused).toBe(false);
    expect(reb.memoryFingerprint).not.toBe(first.memoryFingerprint);

    // A checkpoint appears → invalidates again (covers timeline updates too,
    // since the timeline is derived from checkpoints).
    const withCp = { ...withDecision, checkpoint: checkpoint('cp1', 'wire auth') };
    expect((await m.index(withCp)).reused).toBe(false);
    expect((await m.index(withCp)).reused).toBe(true); // then stable again
  });

  it('shared checkpoint memory is visible cross-namespace; private decisions are not', async () => {
    const adapter = withRedaction(new FileStorageAdapter(root), fixedClock(0));
    await adapter.init();
    const m = new MemoryEngine(adapter);
    await m.index({
      intel: intel(),
      sessions: [session('s-alice', 'alice private reasoning xyzzy')],
      checkpoint: checkpoint('cp1', 'shared continuity task plover'),
      projectRoot: root,
      namespaceOf: () => 'alice',
    });

    // Bob's view (namespace "bob"): sees the shared checkpoint, not alice's decision.
    const asBob = await m.search({ text: 'task' }, { namespace: 'bob' });
    const ids = asBob.map((r) => r.chunk.id);
    expect(ids.some((i) => i.startsWith('session:checkpoint:'))).toBe(true);
    expect(asBob.every((r) => r.chunk.namespace !== 'alice')).toBe(true);
  });
});

describe('SessionManager 2-worker freshness (end to end)', () => {
  async function scaffold(): Promise<void> {
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'p' }));
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'index.ts'), 'export const x = 1;\n');
  }
  function mgr(): SessionManager {
    return new SessionManager(
      withRedaction(new FileStorageAdapter(root), fixedClock(1)),
      fixedClock(1),
    );
  }

  it('worker B refreshes and sees worker A shared checkpoint, never A private decision', async () => {
    await scaffold();

    const a = mgr();
    await a.init();
    await a.startSession({
      agent: 'claude',
      task: 'refactor core',
      projectRoot: root,
      worker: 'alice',
    });
    await a.record({ kind: 'decision', summary: 'alice-only secret rationale wibble' });
    await a.checkpoint({ reason: 'manual', completed: ['shared milestone grault'] });

    const b = mgr();
    await b.init();
    await b.startSession({
      agent: 'claude',
      task: 'add caching',
      projectRoot: root,
      worker: 'bob',
    });
    const r1 = await b.refreshMemory();
    const r2 = await b.refreshMemory();
    expect(r2?.rebuilt).toBe(false); // repeated refresh is idempotent

    const hits = await b.searchMemory({ text: 'milestone task' });
    expect(hits.some((h) => h.chunk.id.startsWith('session:checkpoint:'))).toBe(true);
    expect(hits.every((h) => h.chunk.namespace !== 'alice')).toBe(true);
    expect(r1).toBeDefined();
  });
});
