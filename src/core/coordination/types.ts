/**
 * Coordinated cognition model (v0.7.0, ADR-0007). Cooperative, deterministic,
 * file-ledger-based — not a network scheduler.
 */

export type LeaseScopeKind = 'task' | 'path' | 'module';
export type LeaseStatus = 'active' | 'released' | 'expired' | 'superseded';

export interface Worker {
  workerId: string;
  /** Memory namespace; defaults to the workerId (per-worker isolation). */
  namespace: string;
  agent: string;
  /** Last event ts attributed to this worker. */
  lastSeen: string;
}

export interface Lease {
  id: string;
  workerId: string;
  scopeKind: LeaseScopeKind;
  /** Task string, or a path/module prefix. */
  scope: string;
  acquiredAt: string;
  expiresAt: string;
  status: LeaseStatus;
  /** For `superseded`: the lease id that already held an overlapping scope. */
  supersededBy?: string;
}

export interface LeaseDecision {
  granted: boolean;
  lease?: Lease;
  reason: string;
  /** The active lease that blocked acquisition, if denied. */
  conflict?: Lease;
}

export interface CoordinationState {
  /** Reference time the projection was evaluated against. */
  asOf: string;
  workers: Worker[];
  /** Currently-active (not released/expired/superseded) leases. */
  activeLeases: Lease[];
  /** All leases, any status, for explainability/audit. */
  allLeases: Lease[];
}

export interface TimelineCheckpoint {
  id: string;
  workerId: string;
  sessionId: string;
  task: string;
  reason: string;
  createdAt: string;
  parentId?: string;
}
