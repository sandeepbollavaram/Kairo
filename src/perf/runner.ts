import type { BenchmarkScenarioResult, BenchmarkStats } from './types.js';

/**
 * Pure benchmark runner (ADR-0014). Uses `process.hrtime.bigint()` for
 * monotonic nanosecond timing — robust against system-clock changes during
 * a run.
 */
export interface ScenarioFn {
  (): Promise<{ counters?: Record<string, number> } | void>;
}

export interface ScenarioSpec {
  name: string;
  /** Optional precondition; if it returns a reason, the scenario is skipped. */
  skipIf?: () => string | undefined | Promise<string | undefined>;
  /** Optional one-shot setup (NOT timed). */
  setup?: () => Promise<void>;
  /** Optional one-shot teardown (NOT timed). */
  teardown?: () => Promise<void>;
  /** The hot path — this is what's timed. */
  run: ScenarioFn;
}

export interface RunOptions {
  iterations?: number;
  /** Optional subset of scenarios to run (by name). */
  only?: string[];
}

const NS_PER_MS = 1_000_000n;

export async function runScenarios(
  specs: ScenarioSpec[],
  opts: RunOptions = {},
): Promise<BenchmarkScenarioResult[]> {
  const iterations = Math.max(1, opts.iterations ?? 5);
  const only = opts.only && opts.only.length > 0 ? new Set(opts.only) : undefined;
  const out: BenchmarkScenarioResult[] = [];

  for (const spec of specs) {
    if (only && !only.has(spec.name)) continue;
    const skipReason = spec.skipIf ? await spec.skipIf() : undefined;
    if (skipReason !== undefined) {
      out.push({
        name: spec.name,
        stats: zeroStats(iterations),
        counters: {},
        skipped: true,
        skipReason,
      });
      continue;
    }
    if (spec.setup) await spec.setup();
    const durations: number[] = [];
    let counters: Record<string, number> = {};
    for (let i = 0; i < iterations; i++) {
      const t0 = process.hrtime.bigint();
      const res = await spec.run();
      const t1 = process.hrtime.bigint();
      durations.push(Number((t1 - t0) / NS_PER_MS));
      if (res && res.counters) counters = mergeCounters(counters, res.counters);
    }
    if (spec.teardown) await spec.teardown();
    out.push({
      name: spec.name,
      stats: summarise(durations),
      counters,
      skipped: false,
    });
  }
  return out;
}

function summarise(values: number[]): BenchmarkStats {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    iterations: n,
    min: sorted[0] ?? 0,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[n - 1] ?? 0,
    totalMs: sum,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx] ?? 0;
}

function mergeCounters(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    // Counters across iterations: take the LAST observed value (these
    // describe steady-state, not per-iteration deltas).
    out[k] = v;
  }
  return out;
}

function zeroStats(iterations: number): BenchmarkStats {
  return { iterations, min: 0, median: 0, p95: 0, max: 0, totalMs: 0 };
}
