import { describe, it, expect } from 'vitest';
import { STABILITY, byTier, stabilityOf, type StabilityEntry } from '../src/contracts/stability.js';

/**
 * v0.9.4 — API stability registry (ADR-0015). The registry is the
 * mechanical promise that v1.0.0 will keep: anything `stable` here must
 * stay callable with the same shape across every v1.x release.
 */
describe('stability registry', () => {
  it('has unique ids per surface', () => {
    const seen = new Set<string>();
    for (const e of STABILITY) {
      const key = `${e.surface}:${e.id}`;
      expect(seen.has(key), `duplicate: ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('every entry uses a valid tier', () => {
    for (const e of STABILITY) {
      expect(['stable', 'experimental', 'internal', 'deprecated']).toContain(e.tier);
    }
  });

  it('the v0.1.0 continuity-loop tools are stable', () => {
    const core = [
      'kairo_session_start',
      'kairo_session_status',
      'kairo_record',
      'kairo_heartbeat',
      'kairo_checkpoint',
      'kairo_continuation',
      'kairo_session_end',
    ];
    for (const name of core) {
      const entry = stabilityOf(name);
      expect(entry?.tier, name).toBe('stable');
    }
  });

  it('v0.9.3 / v0.9.4 tools are experimental, not stable', () => {
    const exp = [
      'kairo_benchmark',
      'kairo_perf_report',
      'kairo_compact_memory',
      'kairo_index_status',
      'kairo_plugins_list',
      'kairo_stability_of',
    ];
    for (const name of exp) {
      expect(stabilityOf(name)?.tier, name).toBe('experimental');
    }
  });

  it('byTier filters correctly', () => {
    const stable = byTier('stable');
    const exp = byTier('experimental');
    expect(stable.length).toBeGreaterThan(0);
    expect(exp.length).toBeGreaterThan(0);
    // Disjoint sets.
    const stableIds = new Set(stable.map((e: StabilityEntry) => e.id));
    for (const e of exp) {
      expect(stableIds.has(e.id), `${e.id} appears in both tiers`).toBe(false);
    }
  });

  it('unregistered ids return undefined (treated as internal)', () => {
    expect(stabilityOf('kairo_nonexistent')).toBeUndefined();
  });
});
