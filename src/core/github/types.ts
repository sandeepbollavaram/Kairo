import type { Bump } from './semver.js';

/** Read-only snapshot of the working tree. All fields best-effort. */
export interface GitContext {
  isRepo: boolean;
  branch?: string;
  /** Commits ahead / behind the upstream, if an upstream is configured. */
  ahead?: number;
  behind?: number;
  staged: number;
  unstaged: number;
  untracked: number;
  lastTag?: string;
  /** Subjects of the most recent commits, newest first. */
  recentCommits: string[];
}

export type CommitType = 'feat' | 'fix' | 'docs' | 'refactor' | 'test' | 'build' | 'ci' | 'chore';

export interface CommitProposal {
  type: CommitType;
  scope?: string;
  /** Conventional Commits subject line, e.g. `feat(auth): add SSO login`. */
  header: string;
  message: string;
  reasoning: string[];
}

export interface ChangelogFragment {
  markdown: string;
}

export interface ReleasePlan {
  currentVersion: string;
  bump: Bump;
  nextVersion: string;
  tag: string;
  notes: string;
  reasoning: string[];
}
