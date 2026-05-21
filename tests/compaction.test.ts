import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStorageAdapter } from '../src/storage/fileStorageAdapter.js';
import { withRedaction } from '../src/storage/redactingAdapter.js';
import { SessionManager } from '../src/core/session/sessionManager.js';
import { systemClock } from '../src/utils/time.js';
import { compact } from '../src/core/compaction/compactor.js';
import { kairoPaths } from '../src/storage/paths.js';

/**
 * v0.9.3 — memory compaction (ADR-0014). Asserts:
 *   1. Dry-run touches nothing on disk.
 *   2. Apply moves only events of ended sessions older than the cutoff.
 *   3. Events referenced by surviving checkpoints are NEVER archived.
 *   4. Compaction never deletes — archive + manifest remain.
 *   5. Replay-safety: events.jsonl stays parseable after compaction.
 */
async function seedActiveSession(root: string): Promise<string> {
  const adapter = withRedaction(new FileStorageAdapter(root), systemClock);
  const sessions = new SessionManager(adapter, systemClock);
  await sessions.init();
  const start = await sessions.startSession({
    agent: 'claude',
    task: 'compaction smoke',
    projectRoot: root,
  });
  await sessions.record({ kind: 'file', path: 'src/x.ts', changeKind: 'modified' });
  await sessions.checkpoint({ reason: 'manual', completed: ['x'] });
  await sessions.endSession();
  return start.sessionId;
}

/** Synthesise an "old ended session" by writing events directly with a past ts. */
async function seedOldEndedSession(root: string, id: string, daysAgo: number): Promise<void> {
  const paths = kairoPaths(root);
  await mkdir(paths.base, { recursive: true });
  const ts = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  const events = [
    {
      schema: 1,
      id: `${id}-1`,
      ts,
      sessionId: id,
      type: 'session.started',
      payload: { agent: 'x', task: 'old', projectRoot: root, startedAt: ts },
    },
    {
      schema: 1,
      id: `${id}-2`,
      ts,
      sessionId: id,
      type: 'heartbeat',
      payload: {},
    },
    {
      schema: 1,
      id: `${id}-3`,
      ts,
      sessionId: id,
      type: 'session.ended',
      payload: { endedAt: ts },
    },
  ];
  const existing = await readFile(paths.events, 'utf8').catch(() => '');
  const body = existing + events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  await writeFile(paths.events, body, 'utf8');
}

describe('compaction (dry-run)', () => {
  it('reports candidates without touching disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairo-compact-'));
    try {
      const currentId = await seedActiveSession(root);
      await seedOldEndedSession(root, 'OLD123', 200);

      const paths = kairoPaths(root);
      const before = await readFile(paths.events, 'utf8');

      const r = await compact(root, {
        dryRun: true,
        olderThanDays: 90,
        now: () => new Date(),
      });
      expect(r.applied).toBe(false);
      expect(r.plan.candidateSessionIds).toContain('OLD123');
      expect(r.plan.candidateSessionIds).not.toContain(currentId);

      // events.jsonl is untouched.
      const after = await readFile(paths.events, 'utf8');
      expect(after).toBe(before);

      // The dry-run still writes the report (this is by design).
      const report = await readFile(r.plan.reportPath, 'utf8');
      expect(report).toContain('Mode: `dry-run`');
      expect(report).toContain('OLD123');

      // No archive directory created in dry-run mode.
      const items = await readdir(paths.base);
      expect(items).not.toContain('archive');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('compaction (apply)', () => {
  it('archives only candidate sessions; lineage-protected sessions stay', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairo-compact-'));
    try {
      // The "current" session has a checkpoint → its events are lineage-protected.
      const currentId = await seedActiveSession(root);
      await seedOldEndedSession(root, 'OLD-A', 200);
      await seedOldEndedSession(root, 'OLD-B', 200);

      const paths = kairoPaths(root);
      const adapterBefore = new FileStorageAdapter(root);
      const eventsBefore = await adapterBefore.readEvents();

      const r = await compact(root, {
        dryRun: false,
        olderThanDays: 90,
        now: () => new Date(),
      });

      expect(r.applied).toBe(true);
      // Archive file + manifest exist.
      const archiveBody = await readFile(r.plan.archivePath, 'utf8');
      expect(archiveBody).toContain('OLD-A');
      expect(archiveBody).toContain('OLD-B');
      const manifest = await readFile(r.plan.manifestPath, 'utf8');
      expect(manifest).toContain('Kairo compaction archive manifest');

      // events.jsonl now retains only the current session's events.
      const adapterAfter = new FileStorageAdapter(root);
      const eventsAfter = await adapterAfter.readEvents();
      expect(eventsAfter.length).toBeLessThan(eventsBefore.length);
      for (const e of eventsAfter) {
        expect(e.sessionId).toBe(currentId);
      }

      // Replay-safety: the current session still loads.
      const checkpoints = await readdir(paths.checkpointsDir);
      expect(checkpoints.length).toBeGreaterThan(0);

      // Report reflects what happened.
      const report = await readFile(r.plan.reportPath, 'utf8');
      expect(report).toContain('Mode: `applied`');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('lineage protection: a session with a checkpoint is never archived', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairo-compact-'));
    try {
      // Seed a "current" session with a checkpoint and synthesise an OLD timestamp
      // for ALL its events by rewriting them. The checkpoint must protect it.
      const currentId = await seedActiveSession(root);
      const paths = kairoPaths(root);
      const raw = await readFile(paths.events, 'utf8');
      const oldTs = new Date(Date.now() - 365 * 86_400_000).toISOString();
      const rewritten =
        raw
          .split('\n')
          .filter((l) => l.trim().length > 0)
          .map((l) => {
            const obj = JSON.parse(l) as { sessionId: string; ts: string };
            return JSON.stringify({ ...obj, ts: obj.sessionId === currentId ? oldTs : obj.ts });
          })
          .join('\n') + '\n';
      await writeFile(paths.events, rewritten, 'utf8');

      const r = await compact(root, { dryRun: false, olderThanDays: 30 });
      expect(r.plan.candidateSessionIds).not.toContain(currentId);
      // No archive should have been created (no candidates).
      const items = await readdir(paths.base);
      expect(items).not.toContain('archive');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
