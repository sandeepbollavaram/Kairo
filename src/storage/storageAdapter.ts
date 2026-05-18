import type { AuditEntry, KairoEvent } from '../types/events.js';
import type { Checkpoint, SessionState } from '../types/domain.js';

/**
 * Persistence seam. Engines depend only on this interface, never on the filesystem.
 * Backends (file, SQLite, vector store) are interchangeable, and the redaction
 * decorator (see redactingAdapter.ts) wraps any adapter so sanitization cannot be
 * bypassed.
 */
export interface StorageAdapter {
  init(): Promise<void>;

  /** Append a single event. Must be atomic at the record level. */
  appendEvent(event: KairoEvent): Promise<void>;
  /** Read the full event log in chronological order. */
  readEvents(): Promise<KairoEvent[]>;

  saveSessionSnapshot(state: SessionState): Promise<void>;
  loadSessionSnapshot(id: string): Promise<SessionState | undefined>;

  saveCheckpoint(checkpoint: Checkpoint): Promise<void>;
  loadCheckpoint(id: string): Promise<Checkpoint | undefined>;
  loadLatestCheckpoint(): Promise<Checkpoint | undefined>;

  /** Persist a continuation brief. Returns the stored filename. */
  saveContinuation(name: string, markdown: string): Promise<string>;
  loadContinuation(name: string): Promise<string | undefined>;
  loadLatestContinuation(): Promise<string | undefined>;

  /** Append an audit record. Never contains secret values. */
  audit(entry: AuditEntry): Promise<void>;
}
