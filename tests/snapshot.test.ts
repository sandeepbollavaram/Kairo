import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportSnapshot, canonicalJson } from '../src/snapshot/export.js';
import { importSnapshot } from '../src/snapshot/import.js';
import { FileStorageAdapter } from '../src/storage/fileStorageAdapter.js';
import { withRedaction } from '../src/storage/redactingAdapter.js';
import { SessionManager } from '../src/core/session/sessionManager.js';
import { systemClock } from '../src/utils/time.js';

/**
 * v0.9.2 — snapshot/import/export (ADR-0013). Verifies:
 *   1. Export of a real `.kairo/` produces a single JSON file with manifest +
 *      every artefact, and a deterministic contentSha256.
 *   2. Import into an empty target reconstructs the same byte-identical
 *      snapshot when re-exported.
 *   3. Import refuses to overwrite a non-empty .kairo/ without force.
 *   4. Unsupported snapshotSchema is rejected.
 */
async function seedProject(root: string): Promise<string> {
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'snap-e2e', dependencies: { express: '^4.19.0' } }),
  );
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'index.ts'), 'export const x = 1;\n');

  const adapter = withRedaction(new FileStorageAdapter(root), systemClock);
  const sessions = new SessionManager(adapter, systemClock);
  await sessions.init();
  const start = await sessions.startSession({
    agent: 'claude',
    task: 'snapshot smoke',
    projectRoot: root,
  });
  await sessions.record({ kind: 'file', path: 'src/payment/charge.ts', changeKind: 'modified' });
  await sessions.record({ kind: 'decision', summary: 'use idempotency keys' });
  await sessions.checkpoint({ reason: 'manual', completed: ['initial'] });
  await sessions.endSession();
  return start.sessionId;
}

describe('snapshot export + import round-trip', () => {
  it('exports a deterministic JSON snapshot with a content hash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairo-snap-'));
    try {
      await seedProject(root);
      const fixedNow = (): Date => new Date('2026-05-21T00:00:00.000Z');
      const a = await exportSnapshot(root, { now: fixedNow });
      const b = await exportSnapshot(root, { now: fixedNow });
      // The on-disk path is timestamped → identical when `now` is pinned.
      expect(a.path).toBe(b.path);
      expect(a.contentSha256).toBe(b.contentSha256);
      // Manifest carries the counts and the hash itself.
      expect(a.snapshot.manifest.counts.events).toBeGreaterThan(0);
      expect(a.snapshot.manifest.counts.checkpoints).toBeGreaterThan(0);
      expect(a.snapshot.manifest.counts.sessions).toBeGreaterThan(0);
      expect(a.snapshot.manifest.contentSha256).toBe(a.contentSha256);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('imports into an empty target and re-export matches by content hash', async () => {
    const srcRoot = await mkdtemp(join(tmpdir(), 'kairo-snap-src-'));
    const tgtRoot = await mkdtemp(join(tmpdir(), 'kairo-snap-tgt-'));
    try {
      await seedProject(srcRoot);
      const exp = await exportSnapshot(srcRoot, {
        now: () => new Date('2026-05-21T00:00:00.000Z'),
      });

      const r = await importSnapshot(tgtRoot, exp.path);
      expect(r.ingested.events).toBe(exp.snapshot.manifest.counts.events);
      expect(r.ingested.checkpoints).toBe(exp.snapshot.manifest.counts.checkpoints);
      expect(r.ingested.continuations).toBe(exp.snapshot.manifest.counts.continuations);

      // Re-export the target and assert the content hash matches the source.
      // Note: redaction runs on import — for a clean source with no secrets,
      // canonical content should be identical.
      const reExp = await exportSnapshot(tgtRoot, {
        now: () => new Date('2026-05-21T00:00:00.000Z'),
      });
      expect(reExp.contentSha256).toBe(exp.contentSha256);
    } finally {
      await rm(srcRoot, { recursive: true, force: true });
      await rm(tgtRoot, { recursive: true, force: true });
    }
  });

  // Heaviest snapshot test: two full seeds + one export + two imports.
  // Default 5s flakes on Windows + Node 22 CI runners (v1.1.1 dogfood);
  // 20s is a deterministic ceiling, not a delay.
  const HEAVY_TIMEOUT = 20_000;
  it(
    'refuses to overwrite a non-empty .kairo/ unless force',
    async () => {
      const srcRoot = await mkdtemp(join(tmpdir(), 'kairo-snap-src-'));
      const tgtRoot = await mkdtemp(join(tmpdir(), 'kairo-snap-tgt-'));
      try {
        await seedProject(srcRoot);
        await seedProject(tgtRoot);
        const exp = await exportSnapshot(srcRoot, {
          now: () => new Date('2026-05-21T00:00:00.000Z'),
        });
        await expect(importSnapshot(tgtRoot, exp.path)).rejects.toThrow(/Refusing to import/);
        // With force: succeeds.
        const r = await importSnapshot(tgtRoot, exp.path, { force: true });
        expect(r.ingested.events).toBeGreaterThan(0);
      } finally {
        await rm(srcRoot, { recursive: true, force: true });
        await rm(tgtRoot, { recursive: true, force: true });
      }
    },
    HEAVY_TIMEOUT,
  );

  it('rejects an unsupported snapshotSchema', async () => {
    const tgtRoot = await mkdtemp(join(tmpdir(), 'kairo-snap-tgt-'));
    const snapPath = join(tgtRoot, 'bad-snapshot.json');
    try {
      await writeFile(snapPath, JSON.stringify({ manifest: { snapshotSchema: 999 } }), 'utf8');
      await expect(importSnapshot(tgtRoot, snapPath)).rejects.toThrow(/Unsupported snapshot/);
    } finally {
      await rm(tgtRoot, { recursive: true, force: true });
    }
  });

  it('canonicalJson sorts keys deterministically at every level', () => {
    const a = canonicalJson({ b: 2, a: { y: 1, x: 2 } });
    const b = canonicalJson({ a: { x: 2, y: 1 }, b: 2 });
    expect(a).toBe(b);
  });

  it('imported snapshot can be re-loaded with no quarantine', async () => {
    const srcRoot = await mkdtemp(join(tmpdir(), 'kairo-snap-src-'));
    const tgtRoot = await mkdtemp(join(tmpdir(), 'kairo-snap-tgt-'));
    try {
      await seedProject(srcRoot);
      const exp = await exportSnapshot(srcRoot, {
        now: () => new Date('2026-05-21T00:00:00.000Z'),
      });
      await importSnapshot(tgtRoot, exp.path);
      const tgtAdapter = new FileStorageAdapter(tgtRoot);
      const events = await tgtAdapter.readEvents();
      expect(events.length).toBe(exp.snapshot.manifest.counts.events);
      // No quarantine artefact on the target.
      const q = join(tgtRoot, '.kairo', 'quarantine', 'events.jsonl');
      await expect(readFile(q, 'utf8')).rejects.toThrow();
    } finally {
      await rm(srcRoot, { recursive: true, force: true });
      await rm(tgtRoot, { recursive: true, force: true });
    }
  });
});
