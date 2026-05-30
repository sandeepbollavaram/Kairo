/**
 * Atlas Capsule types (v1.6.0, ADR-0020).
 *
 * A capsule is a portable, token-budgeted AI handoff package: it tells the next
 * agent what is known, what changed, what remains, what to read first, and what
 * is safe to skip initially — so it does significantly LESS unnecessary
 * rescanning of the repository.
 *
 * Honesty contract (enforced in wording, not just docs):
 *   - A capsule REDUCES unnecessary rescanning; it does NOT prevent all reads.
 *   - It is a *trusted starting point*, not a replacement for validation.
 *   - Agents may still reread files when they detect a mismatch.
 *
 * Determinism contract: a capsule is a pure projection of existing `.kairo/`
 * state (sessions, checkpoints, briefs, memory, graphs, Atlas projection,
 * telemetry/risk, changed files, git state if available). It is NOT a second
 * state store and never mutates `.kairo/`. Given identical inputs (the same
 * `.kairo/` contents and the same git snapshot passed in), `renderCapsule`
 * returns a byte-identical string.
 */

export const CAPSULE_SCHEMA_VERSION = 1 as const;

/** Capsule budget tiers. Mirror the brief modes but are capsule-specific. */
export type CapsuleMode = 'tiny' | 'standard' | 'deep';

/** Agents a capsule can be optimised for. `generic` is plain markdown. */
export type CapsuleTarget = 'claude' | 'codex' | 'cursor' | 'generic';

export const CAPSULE_MODES: readonly CapsuleMode[] = ['tiny', 'standard', 'deep'];
export const CAPSULE_TARGETS: readonly CapsuleTarget[] = ['claude', 'codex', 'cursor', 'generic'];

/** A file the next agent should open first, with a short reason. */
export interface CapsuleReadFirst {
  /** Repo-relative path. Never absolute. */
  path: string;
  /** Why it matters: risk level, touch count, or structural centrality. */
  reason: string;
}

/** A coarse area the next agent can skip on first read (with the honest caveat). */
export interface CapsuleSkipArea {
  /** Repo-relative path or glob-ish prefix. Never absolute. */
  path: string;
  /** Why it is usually safe to skip initially. */
  reason: string;
}

/**
 * The neutral, target-agnostic projection a capsule renders from. This is the
 * single source of truth the renderer consumes; targets differ only in framing
 * and which sections they emphasise, never in the underlying facts.
 */
export interface CapsuleProjection {
  schemaVersion: typeof CAPSULE_SCHEMA_VERSION;

  // 1–3 identity
  /** Basename of the project root only — never an absolute path. */
  repoName: string;
  /** Current git branch if discoverable, else undefined. */
  branch?: string;
  /** Project version (package.json) if discoverable, else undefined. */
  version?: string;

  // 4–6 session / checkpoint / task
  latestSessionId?: string;
  latestCheckpointId?: string;
  /** Checkpoint reason (manual / pressure / session-end) if available. */
  checkpointReason?: string;
  /** ISO time the checkpoint was created, if available. */
  checkpointAt?: string;
  /** The task being worked on. */
  task?: string;

  // 7–9 work state
  completedWork: string[];
  remainingWork: string[];
  blockers: string[];
  /** Repo-relative changed files, risk-ranked. */
  changedFiles: CapsuleChangedFile[];

  // 10–11 reading plan
  readFirst: CapsuleReadFirst[];
  skipInitially: CapsuleSkipArea[];

  // 12–13 architecture
  /** A few honest architecture-orienting lines (frameworks, languages, entry points). */
  architecture: string[];
  /** Top relevant Atlas nodes (most central / most active), bounded. */
  atlasNodes: CapsuleAtlasNode[];

  // 14 memory recall
  /** Top memory recall items relevant to the task, bounded. */
  memoryRecall: CapsuleMemoryItem[];

  // 15 risks
  risks: string[];

  // 16–18 actions
  commands: string[];
  nextActions: string[];
  doNotTouch: string[];

  // 19 verification
  /** Short verification status line (e.g. "unverified — run npm test"). */
  verification: string;

  /** Honest note about derivation/limits. */
  note: string;
}

export interface CapsuleChangedFile {
  path: string;
  changeKind: string;
  risk: 'low' | 'medium' | 'high';
  touches: number;
}

export interface CapsuleAtlasNode {
  id: string;
  group: string;
  /** Degree-centrality salience in [0,1]. Topology signal, not semantic. */
  salience: number;
  changed: boolean;
  risk?: 'low' | 'medium' | 'high';
}

export interface CapsuleMemoryItem {
  kind: string;
  locator: string;
  score: number;
  why: string;
}

/** The rendered capsule plus the metadata callers (CLI/MCP/dashboard) need. */
export interface RenderedCapsule {
  mode: CapsuleMode;
  target: CapsuleTarget;
  /** The capsule markdown, already budget-bounded. */
  text: string;
  /** Character count of `text` (a deterministic, tokeniser-agnostic proxy). */
  chars: number;
  /** True when the budget forced truncation (a marker is present in `text`). */
  truncated: boolean;
  /** Char budget that was applied. */
  maxChars: number;
  /** Files the next agent should read first (echoed for structured callers). */
  readFirst: CapsuleReadFirst[];
  /** Areas safe to skip initially (echoed for structured callers). */
  skipInitially: CapsuleSkipArea[];
}

/** Truncation marker appended when a capsule exceeds its budget. */
export const TRUNCATION_MARKER = '\n\n— capsule truncated to fit budget —';
