import type { SessionState } from '../../types/domain.js';
import { assessSession } from '../risk/riskEngine.js';
import { proposeChangelog } from './changelog.js';
import { applyBump, formatSemver, parseSemver, type Bump } from './semver.js';
import type { ReleasePlan } from './types.js';

/**
 * Suggests the next version, tag, and release notes from the session. Per ADR-0003 it
 * does NOT bump package.json, tag, or push — it returns a plan for a human to apply.
 */
export function proposeReleasePlan(state: SessionState, currentVersion: string): ReleasePlan {
  const parsed = parseSemver(currentVersion) ?? { major: 0, minor: 0, patch: 0 };
  const corpus = [state.task, ...state.decisions.flatMap((d) => [d.summary, d.rationale ?? ''])]
    .join('\n')
    .toLowerCase();

  const reasoning: string[] = [];
  let bump: Bump;
  if (/breaking change|\bbreaking\b|remove (public|the) api|incompatib/.test(corpus)) {
    bump = 'major';
    reasoning.push('Breaking-change language found in task/decisions → MAJOR.');
  } else if (
    Object.values(state.changedFiles).some(
      (f) => f.changeKind === 'created' && /(^|\/)src\//.test(f.path),
    )
  ) {
    bump = 'minor';
    reasoning.push('New source modules were added → MINOR (new functionality).');
  } else {
    bump = 'patch';
    reasoning.push('No new features or breaking changes detected → PATCH.');
  }

  if (parsed.major === 0 && bump === 'major') {
    reasoning.push('Pre-1.0: a breaking change bumps MINOR by convention, not MAJOR.');
  }

  const next = applyBump(parsed, bump);
  const nextVersion = formatSemver(next);

  const risk = assessSession(state);
  if (risk.level !== 'low') {
    reasoning.push(
      `Session engineering risk is ${risk.level.toUpperCase()} — review before tagging.`,
    );
  }

  const notes = [
    `## ${nextVersion}`,
    '',
    proposeChangelog(state).markdown,
    '',
    risk.level !== 'low' ? `> Risk at release: ${risk.level.toUpperCase()}.` : '',
    `> Generated from kairo-session ${state.id}.`,
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    currentVersion: formatSemver(parsed),
    bump,
    nextVersion,
    tag: `v${nextVersion}`,
    notes,
    reasoning,
  };
}
