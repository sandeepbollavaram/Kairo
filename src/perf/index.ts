import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SessionManager } from '../core/session/sessionManager.js';
import { kairoPaths } from '../storage/paths.js';
import { SERVER_VERSION } from '../server/createServer.js';
import { runScenarios, type RunOptions, type ScenarioSpec } from './runner.js';
import { renderPerformanceReport } from './report.js';
import { standardScenarios } from './scenarios.js';
import type { BenchmarkReport } from './types.js';

export interface RunBenchmarkOptions extends RunOptions {
  /** Override the scenario list (advanced). */
  scenarios?: ScenarioSpec[];
  /** ISO timestamp used in the report header. Pinnable for tests. */
  now?: () => Date;
  /** Override the report path. Defaults to `.kairo/reports/PERFORMANCE.md`. */
  reportPath?: string;
}

export interface RunBenchmarkResult {
  report: BenchmarkReport;
  reportPath: string;
  markdown: string;
}

/**
 * Run the benchmark suite end-to-end and write the report (ADR-0014).
 * Reads pass through the v0.9.1 migration pipeline; nothing is mutated.
 */
export async function runBenchmark(
  sessions: SessionManager,
  projectRoot: string,
  opts: RunBenchmarkOptions = {},
): Promise<RunBenchmarkResult> {
  const paths = kairoPaths(projectRoot);
  const specs = opts.scenarios ?? standardScenarios(sessions, projectRoot);
  const startedAt = (opts.now ?? (() => new Date()))().toISOString();
  const runOpts: RunOptions = {};
  if (opts.iterations !== undefined) runOpts.iterations = opts.iterations;
  if (opts.only !== undefined) runOpts.only = opts.only;
  const results = await runScenarios(specs, runOpts);
  const totalMs = results.reduce((acc, r) => acc + (r.skipped ? 0 : r.stats.median), 0);
  const report: BenchmarkReport = {
    kairoVersion: SERVER_VERSION,
    projectRoot,
    startedAt,
    totalMs,
    scenarios: results,
  };
  const markdown = renderPerformanceReport(report);
  const reportPath = opts.reportPath ?? `${paths.reportsDir}/PERFORMANCE.md`;
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, markdown, 'utf8');
  return { report, reportPath, markdown };
}

export { renderPerformanceReport } from './report.js';
export * from './types.js';
