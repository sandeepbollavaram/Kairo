/** Minimal semver handling — no dependency, only what the release planner needs. */

export type Bump = 'major' | 'minor' | 'patch';

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

const RE = /^v?(\d+)\.(\d+)\.(\d+)/;

export function parseSemver(input: string): SemVer | undefined {
  const m = RE.exec(input.trim());
  if (!m) return undefined;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function applyBump(v: SemVer, bump: Bump): SemVer {
  if (bump === 'major') {
    // Pre-1.0 convention: a breaking change bumps MINOR, not MAJOR, until 1.0.0.
    return v.major === 0
      ? { major: 0, minor: v.minor + 1, patch: 0 }
      : { major: v.major + 1, minor: 0, patch: 0 };
  }
  if (bump === 'minor') return { major: v.major, minor: v.minor + 1, patch: 0 };
  return { major: v.major, minor: v.minor, patch: v.patch + 1 };
}

export function formatSemver(v: SemVer): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}
