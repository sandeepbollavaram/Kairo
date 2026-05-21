import type { BenchmarkReport, BenchmarkScenarioResult } from './types.js';

/**
 * Renders a benchmark report as deterministic markdown (ADR-0014). No
 * timestamps inside the table body so two reports with the same numbers
 * compare cleanly.
 */
export function renderPerformanceReport(report: BenchmarkReport): string {
  const lines: string[] = [];
  lines.push('# Kairo performance report');
  lines.push('');
  lines.push(`- Kairo: \`${report.kairoVersion}\``);
  lines.push(`- Project: \`${report.projectRoot}\``);
  lines.push(`- Started: \`${report.startedAt}\``);
  lines.push(`- Sum of medians: **${report.totalMs.toFixed(2)} ms**`);
  lines.push('');
  lines.push('> Wall-clock timings depend on the host; treat them as relative.');
  lines.push('');
  lines.push('## Scenarios');
  lines.push('');
  lines.push('| Scenario | n | min (ms) | median (ms) | p95 (ms) | max (ms) | Counters |');
  lines.push('|---|---:|---:|---:|---:|---:|---|');
  for (const s of report.scenarios) {
    lines.push(renderRow(s));
  }
  lines.push('');
  const skipped = report.scenarios.filter((s) => s.skipped);
  if (skipped.length > 0) {
    lines.push('## Skipped');
    lines.push('');
    for (const s of skipped) {
      lines.push(`- \`${s.name}\` — ${s.skipReason ?? 'no reason recorded'}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderRow(s: BenchmarkScenarioResult): string {
  if (s.skipped) {
    return `| \`${s.name}\` | – | – | – | – | – | _skipped_ |`;
  }
  const c = s.counters;
  const counterText =
    Object.keys(c).length === 0
      ? '—'
      : Object.entries(c)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ');
  return (
    `| \`${s.name}\` | ${s.stats.iterations} | ${fmt(s.stats.min)} | ${fmt(s.stats.median)} | ` +
    `${fmt(s.stats.p95)} | ${fmt(s.stats.max)} | ${counterText} |`
  );
}

function fmt(n: number): string {
  return n.toFixed(2);
}
