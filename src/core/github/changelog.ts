import type { SessionState } from '../../types/domain.js';
import type { ChangelogFragment } from './types.js';

/**
 * Builds a Keep-a-Changelog fragment from the session. Decisions drive the prose
 * (they capture intent); raw file changes are the fallback so a fragment is never
 * empty. Per ADR-0003 this only produces text — it does not edit CHANGELOG.md.
 */
export function proposeChangelog(state: SessionState): ChangelogFragment {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  const fixed: string[] = [];

  for (const f of Object.values(state.changedFiles)) {
    if (f.changeKind === 'created') added.push(f.path);
    else if (f.changeKind === 'deleted') removed.push(f.path);
    else changed.push(f.path);
  }
  for (const e of state.errors) {
    if (e.resolved) fixed.push(e.message);
  }

  // Prefer decisions as the human-readable summary of intent.
  const decisionLines = state.decisions.map((d) => d.summary);

  const section = (title: string, items: string[]): string[] => {
    if (items.length === 0) return [];
    const uniq = [...new Set(items)].slice(0, 12);
    return [`### ${title}`, ...uniq.map((i) => `- ${i}`), ''];
  };

  const lines: string[] = [];
  if (decisionLines.length > 0) {
    lines.push(...section('Added / Changed', decisionLines));
  }
  lines.push(
    ...section('Added', added),
    ...section('Changed', changed),
    ...section('Fixed', fixed),
    ...section('Removed', removed),
  );

  if (lines.length === 0) {
    lines.push('### Changed', '- _No file changes recorded in this session._', '');
  }

  return { markdown: lines.join('\n').trim() };
}
