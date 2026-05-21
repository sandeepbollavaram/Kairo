import type { StorageAdapter } from './storageAdapter.js';
import type { AuditEntry, KairoEvent } from '../types/events.js';
import type { Checkpoint, SessionState } from '../types/domain.js';
import type { RepoIntelligence } from '../core/repo/types.js';
import type { VectorIndex } from '../core/vector/types.js';
import type { TelemetryEvent } from '../core/telemetry/types.js';
import { logger } from '../utils/logger.js';

/**
 * Deterministic in-process fault injection for storage operations
 * (ADR-0013). Tests configure rules; the adapter applies them.
 *
 * Honest scope: faults are *simulations*, not real disk failures. They
 * prove the handler code is correct (e.g. the caller releases a lease on
 * appendEvent error), not that the OS layer is correct. By convention this
 * adapter is test-only — the constructor warns when NODE_ENV is not "test".
 */
export type StorageMethod =
  | 'init'
  | 'appendEvent'
  | 'readEvents'
  | 'saveSessionSnapshot'
  | 'loadSessionSnapshot'
  | 'saveCheckpoint'
  | 'loadCheckpoint'
  | 'loadLatestCheckpoint'
  | 'saveContinuation'
  | 'loadContinuation'
  | 'loadLatestContinuation'
  | 'saveIntelligence'
  | 'loadLatestIntelligence'
  | 'loadIntelligenceByFingerprint'
  | 'saveGraph'
  | 'saveVectorIndex'
  | 'loadVectorIndex'
  | 'audit'
  | 'readAudit'
  | 'appendTelemetry'
  | 'readTelemetry'
  | 'saveReport';

export interface FailRule {
  /** Trigger on the Nth call (1-indexed). Default 1. */
  afterN?: number;
  /** Trigger on every call once `afterN` is reached. Default false. */
  repeating?: boolean;
  /** Error to throw. Defaults to a generic Error. */
  error?: Error;
}

interface RuleState {
  rule: FailRule;
  calls: number;
  fired: boolean;
}

export class FaultInjector {
  private readonly rules = new Map<StorageMethod, RuleState>();

  failOn(method: StorageMethod, rule: FailRule = {}): this {
    this.rules.set(method, { rule, calls: 0, fired: false });
    return this;
  }

  reset(): void {
    this.rules.clear();
  }

  /**
   * Test whether the next call to `method` should throw. Increments the
   * internal counter for that method on every call (whether or not it
   * fires).
   */
  shouldFail(method: StorageMethod): Error | undefined {
    const state = this.rules.get(method);
    if (!state) return undefined;
    state.calls += 1;
    const trigger = state.rule.afterN ?? 1;
    if (state.calls < trigger) return undefined;
    if (state.fired && !state.rule.repeating) return undefined;
    state.fired = true;
    return state.rule.error ?? new Error(`FaultInjector: simulated failure in ${method}`);
  }
}

export class FaultInjectingAdapter implements StorageAdapter {
  constructor(
    private readonly inner: StorageAdapter,
    private readonly fi: FaultInjector,
  ) {
    if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
      logger.warn('FaultInjectingAdapter is test-only and should never wrap a production adapter.');
    }
  }

  private maybeThrow(m: StorageMethod): void {
    const err = this.fi.shouldFail(m);
    if (err) throw err;
  }

  async init(): Promise<void> {
    this.maybeThrow('init');
    return this.inner.init();
  }
  async appendEvent(e: KairoEvent): Promise<void> {
    this.maybeThrow('appendEvent');
    return this.inner.appendEvent(e);
  }
  async readEvents(): Promise<KairoEvent[]> {
    this.maybeThrow('readEvents');
    return this.inner.readEvents();
  }
  async saveSessionSnapshot(s: SessionState): Promise<void> {
    this.maybeThrow('saveSessionSnapshot');
    return this.inner.saveSessionSnapshot(s);
  }
  async loadSessionSnapshot(id: string): Promise<SessionState | undefined> {
    this.maybeThrow('loadSessionSnapshot');
    return this.inner.loadSessionSnapshot(id);
  }
  async saveCheckpoint(c: Checkpoint): Promise<void> {
    this.maybeThrow('saveCheckpoint');
    return this.inner.saveCheckpoint(c);
  }
  async loadCheckpoint(id: string): Promise<Checkpoint | undefined> {
    this.maybeThrow('loadCheckpoint');
    return this.inner.loadCheckpoint(id);
  }
  async loadLatestCheckpoint(): Promise<Checkpoint | undefined> {
    this.maybeThrow('loadLatestCheckpoint');
    return this.inner.loadLatestCheckpoint();
  }
  async saveContinuation(name: string, md: string): Promise<string> {
    this.maybeThrow('saveContinuation');
    return this.inner.saveContinuation(name, md);
  }
  async loadContinuation(name: string): Promise<string | undefined> {
    this.maybeThrow('loadContinuation');
    return this.inner.loadContinuation(name);
  }
  async loadLatestContinuation(): Promise<string | undefined> {
    this.maybeThrow('loadLatestContinuation');
    return this.inner.loadLatestContinuation();
  }
  async saveIntelligence(i: RepoIntelligence): Promise<void> {
    this.maybeThrow('saveIntelligence');
    return this.inner.saveIntelligence(i);
  }
  async loadLatestIntelligence(): Promise<RepoIntelligence | undefined> {
    this.maybeThrow('loadLatestIntelligence');
    return this.inner.loadLatestIntelligence();
  }
  async loadIntelligenceByFingerprint(fp: string): Promise<RepoIntelligence | undefined> {
    this.maybeThrow('loadIntelligenceByFingerprint');
    return this.inner.loadIntelligenceByFingerprint(fp);
  }
  async saveGraph(kind: string, md: string): Promise<void> {
    this.maybeThrow('saveGraph');
    return this.inner.saveGraph(kind, md);
  }
  async saveVectorIndex(i: VectorIndex): Promise<void> {
    this.maybeThrow('saveVectorIndex');
    return this.inner.saveVectorIndex(i);
  }
  async loadVectorIndex(): Promise<VectorIndex | undefined> {
    this.maybeThrow('loadVectorIndex');
    return this.inner.loadVectorIndex();
  }
  async audit(e: AuditEntry): Promise<void> {
    this.maybeThrow('audit');
    return this.inner.audit(e);
  }
  async readAudit(): Promise<AuditEntry[]> {
    this.maybeThrow('readAudit');
    return this.inner.readAudit();
  }
  async appendTelemetry(e: TelemetryEvent): Promise<void> {
    this.maybeThrow('appendTelemetry');
    return this.inner.appendTelemetry(e);
  }
  async readTelemetry(): Promise<TelemetryEvent[]> {
    this.maybeThrow('readTelemetry');
    return this.inner.readTelemetry();
  }
  async saveReport(name: string, md: string): Promise<void> {
    this.maybeThrow('saveReport');
    return this.inner.saveReport(name, md);
  }
}
