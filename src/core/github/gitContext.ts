import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitContext } from './types.js';
import { logger } from '../../utils/logger.js';

const exec = promisify(execFile);

/**
 * Read-only git introspection. Per ADR-0003 this module runs ONLY non-mutating
 * commands; it never stages, commits, tags, or pushes. Every call degrades to a safe
 * partial result rather than throwing, because "not a git repo" is a normal state.
 */
async function git(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await exec('git', args, { cwd, windowsHide: true, timeout: 5_000 });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

function countLines(s: string | undefined, pred: (l: string) => boolean): number {
  if (!s) return 0;
  return s.split('\n').filter((l) => l.length > 0 && pred(l)).length;
}

export async function readGitContext(cwd: string): Promise<GitContext> {
  const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (inside !== 'true') {
    return { isRepo: false, staged: 0, unstaged: 0, untracked: 0, recentCommits: [] };
  }

  const [branch, status, lastTag, log, aheadBehind] = await Promise.all([
    git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(cwd, ['status', '--porcelain']),
    git(cwd, ['describe', '--tags', '--abbrev=0']),
    git(cwd, ['log', '-5', '--pretty=%s']),
    git(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']),
  ]);

  // Porcelain: XY <path>. X=index (staged), Y=worktree (unstaged); '??' = untracked.
  const staged = countLines(status, (l) => /^[MADRC]/.test(l));
  const unstaged = countLines(status, (l) => /^.[MD]/.test(l));
  const untracked = countLines(status, (l) => l.startsWith('??'));

  let ahead: number | undefined;
  let behind: number | undefined;
  if (aheadBehind) {
    const [a, b] = aheadBehind.split(/\s+/).map(Number);
    if (Number.isFinite(a)) ahead = a;
    if (Number.isFinite(b)) behind = b;
  }

  const ctx: GitContext = {
    isRepo: true,
    staged,
    unstaged,
    untracked,
    recentCommits: log ? log.split('\n').filter(Boolean) : [],
  };
  if (branch) ctx.branch = branch;
  if (lastTag) ctx.lastTag = lastTag;
  if (ahead !== undefined) ctx.ahead = ahead;
  if (behind !== undefined) ctx.behind = behind;

  logger.info('Read git context', { branch: ctx.branch, staged, unstaged, untracked });
  return ctx;
}
