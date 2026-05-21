/**
 * Benchmark types (ADR-0014). Pure data — no Date.now()/Math.random()
 * leaks into the structured results so callers can snapshot them safely.
 */

export interface BenchmarkStats {
  iterations: number;
  /** Milliseconds. */
  min: number;
  median: number;
  p95: number;
  max: number;
  /** Sum of all iteration durations (ms). */
  totalMs: number;
}

export interface BenchmarkScenarioResult {
  name: string;
  stats: BenchmarkStats;
  /** Scenario-specific counters (chunks built, files scanned, …). */
  counters: Record<string, number>;
  /** True if the scenario was skipped because preconditions weren't met. */
  skipped: boolean;
  skipReason?: string;
}

export interface BenchmarkReport {
  kairoVersion: string;
  projectRoot: string;
  startedAt: string;
  /** Total seconds across all scenarios (sum of medians). */
  totalMs: number;
  scenarios: BenchmarkScenarioResult[];
}
