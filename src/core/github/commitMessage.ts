import type { ChangedFile, SessionState } from '../../types/domain.js';
import { assessSession } from '../risk/riskEngine.js';
import type { CommitProposal, CommitType } from './types.js';

/**
 * Generates a Conventional-Commits message FROM Kairo's session memory — not from a
 * diff. The value is that the message reflects the decisions and risk Kairo recorded,
 * which a diff-only tool cannot see. Per ADR-0003 this only produces text.
 *
 * Deliberately emits no AI co-author/attribution trailer: these are the author's
 * commits.
 */
function fileCategory(path: string): CommitType | 'src' {
  if (/(^|\/)(__tests__|tests?|spec)\//i.test(path) || /\.(test|spec)\.[tj]sx?$/i.test(path)) {
    return 'test';
  }
  if (/\.md$|(^|\/)docs?\//i.test(path)) return 'docs';
  if (/\.github\/workflows\//i.test(path)) return 'ci';
  if (
    /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|tsconfig.*\.json|eslint\.config\.|\.prettierrc|vitest\.config\.)/i.test(
      path,
    )
  ) {
    return 'build';
  }
  return 'src';
}

function topLevelScope(paths: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const p of paths) {
    const seg = p.split('/');
    // Prefer the dir under src/ (e.g. src/auth/x.ts -> "auth"); else top dir.
    const scope = seg[0] === 'src' && seg.length > 2 ? seg[1] : seg.length > 1 ? seg[0] : undefined;
    if (scope) counts.set(scope, (counts.get(scope) ?? 0) + 1);
  }
  let best: string | undefined;
  let max = 0;
  for (const [k, v] of counts) {
    if (v > max) {
      max = v;
      best = k;
    }
  }
  return best;
}

function classify(state: SessionState, files: ChangedFile[]): { type: CommitType; why: string } {
  const cats = files.map((f) => fileCategory(f.path));
  const all = (c: CommitType): boolean => cats.length > 0 && cats.every((x) => x === c);
  const hasResolvedErrors = state.errors.some((e) => e.resolved);
  const createdSrc = files.some(
    (f) => f.changeKind === 'created' && fileCategory(f.path) === 'src',
  );
  const refactorIntent = [state.task, ...state.decisions.map((d) => d.summary)]
    .join(' ')
    .match(/\brefactor|restructure|rename|extract\b/i);

  if (all('docs')) return { type: 'docs', why: 'every changed file is documentation' };
  if (all('test')) return { type: 'test', why: 'every changed file is a test' };
  if (all('ci')) return { type: 'ci', why: 'every changed file is a CI workflow' };
  if (all('build')) return { type: 'build', why: 'every changed file is build/config' };
  if (createdSrc) return { type: 'feat', why: 'new source modules were created' };
  if (hasResolvedErrors) {
    return { type: 'fix', why: 'errors were recorded and resolved during the session' };
  }
  if (refactorIntent) return { type: 'refactor', why: 'task/decisions indicate a refactor' };
  if (files.length === 0) return { type: 'chore', why: 'no file changes recorded' };
  return { type: 'feat', why: 'source files modified with no fix/refactor signal' };
}

function subjectFrom(task: string, type: CommitType): string {
  let s = (task || `${type} changes`).trim().replace(/\.$/, '');
  s = s.charAt(0).toLowerCase() + s.slice(1);
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

export function proposeCommit(state: SessionState, extraSummary?: string): CommitProposal {
  const files = Object.values(state.changedFiles);
  const { type, why } = classify(state, files);
  const scope = topLevelScope(files.map((f) => f.path));
  const subject = subjectFrom(state.task, type);
  const header = scope ? `${type}(${scope}): ${subject}` : `${type}: ${subject}`;

  const body: string[] = [];
  if (extraSummary) body.push(extraSummary.trim(), '');

  if (state.decisions.length > 0) {
    for (const d of state.decisions.slice(0, 8)) {
      body.push(`- ${d.summary}${d.rationale ? ` (${d.rationale})` : ''}`);
    }
    body.push('');
  }

  if (files.length > 0) {
    const shown = files
      .slice(0, 10)
      .map((f) => `- ${f.changeKind}: ${f.path}`)
      .join('\n');
    body.push('Changed files:', shown);
    if (files.length > 10) body.push(`- …and ${files.length - 10} more`);
    body.push('');
  }

  const risk = assessSession(state);
  const footer: string[] = [];
  if (risk.level !== 'low') {
    footer.push(
      `Risk: ${risk.level.toUpperCase()} — ${risk.factors[0]?.detail ?? 'review carefully'}`,
    );
  }
  const unresolved = state.errors.filter((e) => !e.resolved).length;
  if (unresolved > 0) footer.push(`WARNING: ${unresolved} unresolved error(s) at commit time.`);
  footer.push(`Refs: kairo-session ${state.id}`);

  const message = [header, '', body.join('\n').trim(), '', footer.join('\n')]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const reasoning = [
    `Type "${type}": ${why}.`,
    scope ? `Scope "${scope}": most-touched area.` : 'No dominant scope; omitted.',
    `Engineering risk ${risk.level.toUpperCase()} folded into the footer.`,
  ];

  return {
    type,
    ...(scope ? { scope } : {}),
    header,
    message,
    reasoning,
  };
}
