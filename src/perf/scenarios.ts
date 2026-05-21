import { unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { SessionManager } from '../core/session/sessionManager.js';
import { kairoPaths } from '../storage/paths.js';
import { InspectProjection } from '../inspect/projections.js';
import { exportSnapshot } from '../snapshot/export.js';
import type { ScenarioSpec } from './runner.js';

/**
 * Standard benchmark scenarios (ADR-0014). Each one is small, focused, and
 * deterministic: no Date.now()/Math.random() inside the timed path.
 */
export function standardScenarios(sessions: SessionManager, projectRoot: string): ScenarioSpec[] {
  const paths = kairoPaths(projectRoot);
  const projection = new InspectProjection(projectRoot);

  return [
    {
      name: 'repo.cold-scan',
      // First scan: force=true bypasses the cache. We always run this even
      // when a cache exists — the timing is the cold path, deliberately.
      run: async () => {
        await sessions.scanRepo(projectRoot, true);
        return { counters: {} };
      },
    },
    {
      name: 'repo.warm-scan',
      // Cached read: should be orders of magnitude faster.
      run: async () => {
        const r = await sessions.scanRepo(projectRoot, false);
        return { counters: { fromCache: r.fromCache ? 1 : 0 } };
      },
    },
    {
      name: 'graph.generate',
      // The scan persists graphs; here we just exercise the InspectProjection
      // graph reader (representative of how surfaces consume them).
      run: async () => {
        const list = await projection.listGraphs();
        let nodes = 0;
        for (const k of list) {
          const g = await projection.readGraph(k);
          if (g) nodes += g.nodes;
        }
        return { counters: { graphs: list.length, totalNodes: nodes } };
      },
    },
    {
      name: 'inspect.projection',
      run: async () => {
        const o = await projection.overview();
        await projection.listSessions();
        await projection.listCheckpoints();
        return {
          counters: {
            events: o.eventCount,
            telemetry: o.telemetryCount,
            sessions: o.sessionCount,
            checkpoints: o.checkpointCount,
          },
        };
      },
    },
    {
      name: 'brief.tiny',
      skipIf: async () => {
        const cp = await projection.latestCheckpoint();
        return cp ? undefined : 'no checkpoint exists';
      },
      run: async () => {
        const b = await sessions.buildBrief({ mode: 'tiny' });
        return { counters: { chars: b?.chars ?? 0 } };
      },
    },
    {
      name: 'brief.normal',
      skipIf: async () => {
        const cp = await projection.latestCheckpoint();
        return cp ? undefined : 'no checkpoint exists';
      },
      run: async () => {
        const b = await sessions.buildBrief({ mode: 'normal' });
        return { counters: { chars: b?.chars ?? 0 } };
      },
    },
    {
      name: 'brief.deep',
      skipIf: async () => {
        const cp = await projection.latestCheckpoint();
        return cp ? undefined : 'no checkpoint exists';
      },
      run: async () => {
        const b = await sessions.buildBrief({ mode: 'deep' });
        return { counters: { chars: b?.chars ?? 0 } };
      },
    },
    {
      name: 'snapshot.export',
      skipIf: () => (existsSync(paths.base) ? undefined : '.kairo/ does not exist'),
      run: async () => {
        const r = await exportSnapshot(projectRoot, {
          path: `${paths.base}/snapshots/bench-snapshot.json`,
          now: () => new Date('2026-05-21T00:00:00.000Z'),
        });
        return {
          counters: {
            bytes: r.bytes,
            events: r.snapshot.manifest.counts.events,
            checkpoints: r.snapshot.manifest.counts.checkpoints,
          },
        };
      },
      teardown: async () => {
        const benchSnap = `${paths.base}/snapshots/bench-snapshot.json`;
        if (existsSync(benchSnap)) await unlink(benchSnap).catch(() => undefined);
      },
    },
  ];
}
