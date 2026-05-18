/**
 * Core domain model for Kairo's session-continuity engine.
 *
 * `SessionState` is a *derived projection* of the event log, not an independently
 * mutated record. A `Checkpoint` is a durable, sanitized, resumable freeze of that
 * projection plus the next-agent continuation brief.
 */

export type AgentKind = string;

export type ChangeKind = 'created' | 'modified' | 'deleted' | 'renamed';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface ChangedFile {
  path: string;
  changeKind: ChangeKind;
  risk: RiskLevel;
  /** Number of distinct times the agent reported changing this file. */
  touches: number;
  lastTs: string;
  note?: string;
}

export interface Decision {
  ts: string;
  summary: string;
  rationale?: string;
}

export interface CommandRecord {
  ts: string;
  command: string;
  exitCode?: number;
  note?: string;
}

export interface ErrorRecord {
  ts: string;
  message: string;
  resolved: boolean;
  context?: string;
}

export type DirectiveLevel = 'CONTINUE' | 'CHECKPOINT_SOON' | 'CHECKPOINT_NOW';

export interface PressureSignals {
  /** Tool calls handled by Kairo this session (volume proxy). */
  toolCalls: number;
  changedFiles: number;
  cumulativeDiffBytes: number;
  retries: number;
  unresolvedErrors: number;
  /** Re-reads of files already read — a strong proxy for context loss. */
  repeatedRereads: number;
  elapsedMs: number;
}

export interface PressureSnapshot {
  /** Risk of context loss, bounded [0,1]. */
  score: number;
  directive: DirectiveLevel;
  signals: PressureSignals;
  /** Human-readable explanations of the dominant contributing signals. */
  reasons: string[];
}

export type SessionStatus = 'active' | 'checkpointed' | 'ended';

export interface SessionState {
  id: string;
  agent: AgentKind;
  task: string;
  projectRoot: string;
  startedAt: string;
  lastActivityAt: string;
  status: SessionStatus;
  changedFiles: Record<string, ChangedFile>;
  decisions: Decision[];
  commands: CommandRecord[];
  errors: ErrorRecord[];
  completedWork: string[];
  pendingWork: string[];
  blockers: string[];
  retries: number;
  heartbeats: number;
  toolCalls: number;
  cumulativeDiffBytes: number;
  /** path → number of times re-read. */
  rereadCounts: Record<string, number>;
  lastCheckpointId?: string;
}

export type CheckpointReason = 'manual' | 'pressure' | 'session-end';

export interface Checkpoint {
  id: string;
  sessionId: string;
  agent: AgentKind;
  createdAt: string;
  reason: CheckpointReason;
  task: string;
  projectRoot: string;
  completedWork: string[];
  remainingWork: string[];
  blockers: string[];
  changedFiles: ChangedFile[];
  decisions: Decision[];
  unresolvedErrors: ErrorRecord[];
  pressure: PressureSnapshot;
  /** Filename of the generated continuation brief markdown. */
  continuationRef: string;
}
