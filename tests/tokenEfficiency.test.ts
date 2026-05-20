import { describe, it, expect } from 'vitest';
import { buildContinuationMarkdown } from '../src/core/continuation/continuationBuilder.js';
import { resolveBudget, clip, DEFAULT_BUDGETS } from '../src/core/brief/budget.js';
import type { Checkpoint } from '../src/types/domain.js';

function cp(over: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: 'cp1',
    sessionId: 's1',
    agent: 'claude',
    createdAt: '2026-01-01T00:00:00.000Z',
    reason: 'manual',
    task: 'wire payment flow',
    projectRoot: '/p',
    completedWork: ['m1'],
    remainingWork: ['m2', 'm3', 'm4', 'm5'],
    blockers: [],
    changedFiles: [],
    decisions: [],
    unresolvedErrors: [],
    pressure: { score: 0.1, directive: 'CONTINUE', signals: {} as never, reasons: [] },
    risk: { level: 'low', score: 0.1, factors: [] },
    continuationRef: 'cp1.md',
    ownerWorkerId: 'alice',
    ...over,
  };
}

describe('clip util', () => {
  it('truncates with ellipsis when over budget', () => {
    expect(clip('hello world', 5)).toBe('hell…');
    expect(clip('short', 100)).toBe('short');
    expect(clip('x', 0)).toBe('x');
  });
});

describe('brief modes', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({
    path: `src/m${i}.ts`,
    changeKind: 'modified' as const,
    risk: i % 5 === 0 ? ('high' as const) : ('low' as const),
    touches: 1,
    lastTs: '',
  }));
  const richCp = cp({
    changedFiles: many,
    decisions: Array.from({ length: 10 }, (_, i) => ({ ts: '', summary: `decision ${i}` })),
  });

  it('tiny is small and contains only the critical sections', () => {
    const md = buildContinuationMarkdown(richCp, { budget: resolveBudget('tiny') });
    expect(md.length).toBeLessThanOrEqual(DEFAULT_BUDGETS.tiny.maxBriefChars);
    expect(md).toContain('# Kairo Continuation Brief (tiny)');
    expect(md).toContain('Task');
    expect(md).toContain('Stop point');
    expect(md).toContain('Next');
    // tiny does NOT include the full "Engineering risk at checkpoint" section header
    expect(md).not.toContain('## Engineering risk at checkpoint');
  });

  it('normal is bounded and keeps the existing section structure (back-compat)', () => {
    const md = buildContinuationMarkdown(richCp); // default = normal
    expect(md.length).toBeLessThanOrEqual(DEFAULT_BUDGETS.normal.maxBriefChars);
    expect(md).toContain('# Kairo Continuation Brief');
    expect(md).toContain('## Engineering risk at checkpoint'); // still present
    expect(md).toContain('## Recommended next actions');
    // Caps the file table — 25 inputs, normal shows top 10 + an "and N more" row.
    expect(md).toMatch(/and 15 more/);
  });

  it('deep shows everything (opt-in)', () => {
    const md = buildContinuationMarkdown(richCp, { budget: resolveBudget('deep') });
    expect(md).not.toMatch(/and \d+ more \(deep mode/); // no truncation row in deep
    expect(md).toContain('src/m24.ts'); // last file present
  });

  it('honours an explicit maxBriefChars override', () => {
    const md = buildContinuationMarkdown(richCp, {
      budget: resolveBudget('normal', { maxBriefChars: 500 }),
    });
    expect(md.length).toBeLessThanOrEqual(500);
    expect(md.endsWith('…')).toBe(true); // truncation marker present
  });
});

describe('recall is budget-aware', () => {
  it('tiny mode → no recall, normal mode → up to maxRecallItems', () => {
    // Pure budget shape assertion (the integration with MemoryEngine is tested
    // separately; this confirms the budget contract used by SessionManager).
    expect(resolveBudget('tiny').maxRecallItems).toBe(0);
    expect(resolveBudget('normal').maxRecallItems).toBe(3);
    expect(resolveBudget('deep').maxRecallItems).toBe(8);
    expect(resolveBudget('normal').includeGraphs).toBe(false);
  });
});
