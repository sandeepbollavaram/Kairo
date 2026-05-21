import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStorageAdapter } from '../src/storage/fileStorageAdapter.js';
import { withRedaction } from '../src/storage/redactingAdapter.js';
import { SessionManager } from '../src/core/session/sessionManager.js';
import { systemClock } from '../src/utils/time.js';
import { runBenchmark } from '../src/perf/index.js';
import { runScenarios } from '../src/perf/runner.js';
import { renderPerformanceReport } from '../src/perf/report.js';

/**
 * v0.9.3 — benchmark harness (ADR-0014). Asserts shape and determinism of
 * the runner; wall-clock timings vary by host so we never assert numbers.
 */
async function seedProject(root: string): Promise<void> {
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'perf-e2e', dependencies: { express: '^4.19.0' } }),
  );
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'index.ts'), 'export const x = 1;\n');
  const adapter = withRedaction(new FileStorageAdapter(root), systemClock);
  const sessions = new SessionManager(adapter, systemClock);
  await sessions.init();
  await sessions.startSession({ agent: 'claude', task: 'perf seed', projectRoot: root });
  await sessions.record({ kind: 'file', path: 'src/x.ts', changeKind: 'modified' });
  await sessions.checkpoint({ reason: 'manual', completed: ['x'] });
  await sessions.endSession();
}

describe('benchmark runner (pure shape)', () => {
  it('reports min/median/p95/max + counters for each scenario', async () => {
    const results = await runScenarios(
      [
        {
          name: 'noop',
          run: () => Promise.resolve({ counters: { ran: 1 } }),
        },
      ],
      { iterations: 5 },
    );
    expect(results.length).toBe(1);
    const r = results[0]!;
    expect(r.skipped).toBe(false);
    expect(r.stats.iterations).toBe(5);
    expect(r.stats.median).toBeGreaterThanOrEqual(0);
    expect(r.stats.p95).toBeGreaterThanOrEqual(r.stats.median);
    expect(r.counters.ran).toBe(1);
  });

  it('honours skipIf without timing the scenario', async () => {
    const results = await runScenarios([
      {
        name: 'gated',
        skipIf: () => 'precondition not met',
        run: () => Promise.reject(new Error('should not run')),
      },
    ]);
    expect(results[0]?.skipped).toBe(true);
    expect(results[0]?.skipReason).toBe('precondition not met');
  });
});

describe('runBenchmark over a real project', () => {
  it('writes a deterministic-shape PERFORMANCE.md', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairo-perf-'));
    try {
      await seedProject(root);
      // Build a SessionManager for the run (no live session needed).
      const adapter = withRedaction(new FileStorageAdapter(root), systemClock);
      const sessions = new SessionManager(adapter, systemClock);
      await sessions.init();
      const r = await runBenchmark(sessions, root, {
        iterations: 2,
        now: () => new Date('2026-05-21T00:00:00.000Z'),
      });
      expect(r.report.scenarios.length).toBeGreaterThan(0);
      const md = await readFile(r.reportPath, 'utf8');
      expect(md).toContain('# Kairo performance report');
      expect(md).toContain('repo.cold-scan');
      expect(md).toContain('repo.warm-scan');
      // Skipped scenarios appear with `_skipped_` marker only if any are skipped.
      // The shape of the table is what we assert; numbers are not.
      expect(md).toMatch(/\| `repo\.cold-scan` \| \d+/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('renderPerformanceReport is a pure function', () => {
    const md1 = renderPerformanceReport({
      kairoVersion: '0.9.3',
      projectRoot: '/p',
      startedAt: '2026-05-21T00:00:00.000Z',
      totalMs: 12.34,
      scenarios: [
        {
          name: 'x',
          stats: { iterations: 1, min: 1, median: 1, p95: 1, max: 1, totalMs: 1 },
          counters: { a: 1 },
          skipped: false,
        },
      ],
    });
    const md2 = renderPerformanceReport({
      kairoVersion: '0.9.3',
      projectRoot: '/p',
      startedAt: '2026-05-21T00:00:00.000Z',
      totalMs: 12.34,
      scenarios: [
        {
          name: 'x',
          stats: { iterations: 1, min: 1, median: 1, p95: 1, max: 1, totalMs: 1 },
          counters: { a: 1 },
          skipped: false,
        },
      ],
    });
    expect(md1).toBe(md2);
  });
});
