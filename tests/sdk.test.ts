import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStorageAdapter } from '../src/storage/fileStorageAdapter.js';
import { withRedaction } from '../src/storage/redactingAdapter.js';
import { SessionManager } from '../src/core/session/sessionManager.js';
import { systemClock } from '../src/utils/time.js';
import { KairoClient } from '../src/sdk/index.js';
import { exportSnapshot } from '../src/snapshot/export.js';

/**
 * v0.9.4 — SDK ergonomics (ADR-0015). The SDK reads `.kairo/` directly via
 * the same projections the inspect surface uses. No MCP spawn, no network.
 */
async function seedProject(root: string): Promise<void> {
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'sdk-e2e', dependencies: { express: '^4.19.0' } }),
  );
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'index.ts'), 'export const x = 1;\n');
  const adapter = withRedaction(new FileStorageAdapter(root), systemClock);
  const sessions = new SessionManager(adapter, systemClock);
  await sessions.init();
  await sessions.startSession({ agent: 'claude', task: 'sdk smoke', projectRoot: root });
  await sessions.record({ kind: 'file', path: 'src/index.ts', changeKind: 'modified' });
  await sessions.checkpoint({ reason: 'manual', completed: ['init'] });
  await sessions.endSession();
}

describe('KairoClient (local SDK)', () => {
  it('reads overview / sessions / checkpoints without spawning anything', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairo-sdk-'));
    try {
      await seedProject(root);
      const k = new KairoClient({ projectRoot: root });
      expect(k.hasKairo()).toBe(true);
      const o = await k.overview();
      expect(o.eventCount).toBeGreaterThan(0);
      const sessions = await k.sessions();
      expect(sessions.length).toBeGreaterThan(0);
      const cps = await k.checkpoints();
      expect(cps.length).toBeGreaterThan(0);
      const latest = await k.latestCheckpoint();
      expect(latest?.id).toBe(cps[cps.length - 1]?.id);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('exposes the stability registry', () => {
    const k = new KairoClient({ projectRoot: '/tmp/never' });
    expect(k.stabilityOf('kairo_session_start')?.tier).toBe('stable');
    expect(k.stabilityOf('kairo_benchmark')?.tier).toBe('experimental');
    expect(k.stabilityOf('kairo_does_not_exist')).toBeUndefined();
    const stable = k.byTier('stable');
    expect(stable.length).toBeGreaterThan(0);
  });

  it('validates a snapshot without importing it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairo-sdk-'));
    try {
      await seedProject(root);
      const exp = await exportSnapshot(root, {
        now: () => new Date('2026-05-21T00:00:00.000Z'),
      });
      const k = new KairoClient({ projectRoot: root });
      const v = await k.validateSnapshot(exp.path);
      expect(v.manifest.snapshotSchema).toBe(1);
      expect(v.warnings).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('lists plugin manifests (empty when none configured)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairo-sdk-'));
    try {
      const k = new KairoClient({ projectRoot: root });
      const plugins = await k.plugins();
      expect(plugins).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports its own build version', () => {
    expect(KairoClient.version()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
