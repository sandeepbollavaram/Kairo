import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChangedFile, SessionState } from '../src/types/domain.js';
import { proposeCommit } from '../src/core/github/commitMessage.js';
import { proposeChangelog } from '../src/core/github/changelog.js';
import { proposeReleasePlan } from '../src/core/github/releasePlan.js';
import { applyBump, parseSemver } from '../src/core/github/semver.js';
import { readGitContext } from '../src/core/github/gitContext.js';

function cf(path: string, changeKind: ChangedFile['changeKind']): ChangedFile {
  return { path, changeKind, risk: 'low', touches: 1, lastTs: '' };
}

function state(p: Partial<SessionState>): SessionState {
  return {
    id: 'sess-1',
    agent: 'a',
    task: 'add SSO login to the auth service',
    projectRoot: '/p',
    startedAt: '',
    lastActivityAt: '',
    status: 'active',
    changedFiles: {},
    decisions: [],
    commands: [],
    errors: [],
    completedWork: [],
    pendingWork: [],
    blockers: [],
    retries: 0,
    heartbeats: 0,
    toolCalls: 0,
    compactions: 0,
    clarificationLoops: 0,
    cumulativeDiffBytes: 0,
    rereadCounts: {},
    ...p,
  };
}

describe('semver', () => {
  it('parses and bumps, with the pre-1.0 breaking convention', () => {
    const v = parseSemver('v0.3.1')!;
    expect(v).toEqual({ major: 0, minor: 3, patch: 1 });
    expect(applyBump(v, 'major')).toEqual({ major: 0, minor: 4, patch: 0 });
    expect(applyBump({ major: 1, minor: 2, patch: 3 }, 'major')).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
    });
    expect(applyBump(v, 'patch')).toEqual({ major: 0, minor: 3, patch: 2 });
  });
});

describe('commit message proposal', () => {
  it('classifies a docs-only change as docs and never emits an AI co-author', () => {
    const c = proposeCommit(
      state({
        task: 'update the README',
        changedFiles: { 'README.md': cf('README.md', 'modified') },
      }),
    );
    expect(c.type).toBe('docs');
    expect(c.message.toLowerCase()).not.toContain('co-authored-by');
    expect(c.message).toContain('Refs: kairo-session sess-1');
  });

  it('classifies new source modules as feat with a scope', () => {
    const c = proposeCommit(
      state({
        changedFiles: {
          'src/auth/sso.ts': cf('src/auth/sso.ts', 'created'),
          'src/auth/index.ts': cf('src/auth/index.ts', 'modified'),
        },
      }),
    );
    expect(c.type).toBe('feat');
    expect(c.scope).toBe('auth');
    expect(c.header.startsWith('feat(auth):')).toBe(true);
  });

  it('classifies resolved-error sessions as fix', () => {
    const c = proposeCommit(
      state({
        task: 'investigate flaky checkout',
        changedFiles: { 'src/pay/checkout.ts': cf('src/pay/checkout.ts', 'modified') },
        errors: [{ ts: '', message: 'NPE in checkout', resolved: true }],
      }),
    );
    expect(c.type).toBe('fix');
  });
});

describe('changelog proposal', () => {
  it('buckets created/modified/deleted/resolved into Added/Changed/Removed/Fixed', () => {
    const f = proposeChangelog(
      state({
        decisions: [{ ts: '', summary: 'Adopt event-sourced storage' }],
        changedFiles: {
          'src/a.ts': cf('src/a.ts', 'created'),
          'src/b.ts': cf('src/b.ts', 'modified'),
          'src/c.ts': cf('src/c.ts', 'deleted'),
        },
        errors: [{ ts: '', message: 'race condition', resolved: true }],
      }),
    );
    expect(f.markdown).toContain('Adopt event-sourced storage');
    expect(f.markdown).toMatch(/### Added[\s\S]*src\/a\.ts/);
    expect(f.markdown).toMatch(/### Removed[\s\S]*src\/c\.ts/);
    expect(f.markdown).toMatch(/### Fixed[\s\S]*race condition/);
  });
});

describe('release plan proposal', () => {
  it('PATCH when only docs/modifications', () => {
    const p = proposeReleasePlan(
      state({ changedFiles: { 'README.md': cf('README.md', 'modified') } }),
      '0.4.0',
    );
    expect(p.bump).toBe('patch');
    expect(p.nextVersion).toBe('0.4.1');
    expect(p.tag).toBe('v0.4.1');
  });

  it('MINOR when new source modules are added', () => {
    const p = proposeReleasePlan(
      state({ changedFiles: { 'src/new.ts': cf('src/new.ts', 'created') } }),
      '0.4.0',
    );
    expect(p.bump).toBe('minor');
    expect(p.nextVersion).toBe('0.5.0');
  });

  it('MAJOR intent pre-1.0 still only bumps MINOR (documented convention)', () => {
    const p = proposeReleasePlan(
      state({ task: 'BREAKING CHANGE: remove the public API surface' }),
      '0.4.0',
    );
    expect(p.bump).toBe('major');
    expect(p.nextVersion).toBe('0.5.0');
    expect(p.reasoning.join(' ')).toMatch(/pre-1\.0/i);
  });
});

describe('git context (read-only, real git)', () => {
  let repo: string;
  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'kairo-git-'));
    const g = (args: string[]): void => {
      execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    };
    g(['init', '-b', 'main']);
    g(['config', 'user.email', 'test@example.com']);
    g(['config', 'user.name', 'Test']);
    await writeFile(join(repo, 'a.txt'), 'hello');
    g(['add', '.']);
    g(['commit', '-m', 'chore: initial commit']);
    g(['tag', 'v0.1.0']);
    await writeFile(join(repo, 'untracked.txt'), 'x');
  });
  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('reports branch, last tag, recent commits and untracked count without mutating', async () => {
    const ctx = await readGitContext(repo);
    expect(ctx.isRepo).toBe(true);
    expect(ctx.branch).toBe('main');
    expect(ctx.lastTag).toBe('v0.1.0');
    expect(ctx.recentCommits[0]).toBe('chore: initial commit');
    expect(ctx.untracked).toBe(1);
  });

  it('degrades safely outside a git repo', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'kairo-nogit-'));
    try {
      const ctx = await readGitContext(tmp);
      expect(ctx.isRepo).toBe(false);
      expect(ctx.recentCommits).toEqual([]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
