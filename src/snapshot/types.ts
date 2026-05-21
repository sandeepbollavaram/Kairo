/**
 * Snapshot format (ADR-0013). A snapshot is a single self-describing JSON
 * document containing the full contents of every persisted Kairo artefact.
 */
import type { Checkpoint, SessionState } from '../types/domain.js';
import type { AuditEntry, KairoEvent } from '../types/events.js';
import type { TelemetryEvent } from '../core/telemetry/types.js';
import type { RepoIntelligence } from '../core/repo/types.js';
import type { VectorIndex } from '../core/vector/types.js';

export const SNAPSHOT_SCHEMA = 1 as const;

export interface SnapshotCounts {
  events: number;
  telemetry: number;
  audit: number;
  sessions: number;
  checkpoints: number;
  continuations: number;
  graphs: number;
  intelligence: number;
  vectorIndex: 0 | 1;
}

export interface SnapshotManifest {
  snapshotSchema: typeof SNAPSHOT_SCHEMA;
  kairoVersion: string;
  createdAt: string;
  sourceProjectRoot: string;
  counts: SnapshotCounts;
  schemas: {
    event: number;
    telemetry: number;
    audit: number;
    session: number;
    checkpoint: number;
    intelligence: number;
    vectorIndex: number;
  };
  /** sha256 over the canonical JSON of the content payload (manifest excluded). */
  contentSha256: string;
}

export interface SnapshotContinuation {
  name: string;
  markdown: string;
}

export interface SnapshotGraph {
  kind: string;
  markdown: string;
}

export interface KairoSnapshot {
  manifest: SnapshotManifest;
  events: KairoEvent[];
  telemetry: TelemetryEvent[];
  audit: AuditEntry[];
  sessions: SessionState[];
  checkpoints: Checkpoint[];
  continuations: SnapshotContinuation[];
  graphs: SnapshotGraph[];
  intelligence: {
    latest: RepoIntelligence | null;
    byFingerprint: Record<string, RepoIntelligence>;
  };
  vectorIndex: VectorIndex | null;
}
