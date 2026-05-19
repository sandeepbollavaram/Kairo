import type { StorageAdapter } from '../../storage/storageAdapter.js';
import type { KairoEvent } from '../../types/events.js';
import { EVENT_SCHEMA_VERSION } from '../../types/events.js';
import type { EventPayloads } from '../session/eventPayloads.js';
import type { Clock } from '../../utils/time.js';
import { newId } from '../../utils/ids.js';
import type { RepoGraph } from '../graph/types.js';
import type {
  CoordinationState,
  Lease,
  LeaseDecision,
  LeaseScopeKind,
  TimelineCheckpoint,
  Worker,
} from './types.js';

type CoordType = 'worker.registered' | 'lease.acquired' | 'lease.renewed' | 'lease.released';

/**
 * Projects coordination state from the shared event log and appends coordination
 * events (ADR-0007). Pure projection → deterministic; conflict resolution is by log
 * order (earliest overlapping lease wins). Cooperative: a denied acquire is advisory.
 */
export class CoordinationManager {
  constructor(
    private readonly adapter: StorageAdapter,
    private readonly clock: Clock,
  ) {}

  private async append<K extends CoordType>(
    sessionId: string,
    type: K,
    payload: EventPayloads[K],
  ): Promise<void> {
    const event: KairoEvent<EventPayloads[K]> = {
      schema: EVENT_SCHEMA_VERSION,
      id: newId(this.clock.now()),
      ts: this.clock.iso(),
      sessionId,
      type,
      payload,
    };
    await this.adapter.appendEvent(event);
  }

  static scopesOverlap(kind: LeaseScopeKind, a: string, b: string): boolean {
    const x = a.trim().toLowerCase();
    const y = b.trim().toLowerCase();
    if (kind === 'task') return x === y;
    // path / module: identical, or one is an ancestor of the other.
    if (x === y) return true;
    return x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
  }

  /** Deterministic left-fold of coordination events → state at `asOf`. */
  async state(asOfMs?: number): Promise<CoordinationState> {
    // Append order is causal truth on a single shared log. Array.sort is stable, so
    // ordering by ts ALONE keeps append order for equal timestamps (e.g. fixed clock
    // / same-ms appends) — sorting by id too would corrupt causality.
    const events = (await this.adapter.readEvents())
      .filter((e) => e.type.startsWith('worker.') || e.type.startsWith('lease.'))
      .sort((p, q) => (p.ts < q.ts ? -1 : p.ts > q.ts ? 1 : 0));

    const asOf = asOfMs ?? this.clock.now();
    const workers = new Map<string, Worker>();
    const leases = new Map<string, Lease>();

    const activeAt = (l: Lease, atIso: string): boolean =>
      l.status === 'active' && Date.parse(l.expiresAt) > Date.parse(atIso);

    for (const e of events) {
      if (e.type === 'worker.registered') {
        const p = e.payload as EventPayloads['worker.registered'];
        workers.set(p.workerId, {
          workerId: p.workerId,
          namespace: p.namespace,
          agent: p.agent,
          lastSeen: e.ts,
        });
      } else if (e.type === 'lease.acquired') {
        const p = e.payload as EventPayloads['lease.acquired'];
        const w = workers.get(p.workerId);
        if (w) w.lastSeen = e.ts;
        const lease: Lease = {
          id: p.leaseId,
          workerId: p.workerId,
          scopeKind: p.scopeKind,
          scope: p.scope,
          acquiredAt: p.acquiredAt,
          expiresAt: new Date(Date.parse(p.acquiredAt) + p.ttlMs).toISOString(),
          status: 'active',
        };
        // Earliest overlapping holder (different worker) wins → this one superseded.
        for (const other of leases.values()) {
          if (
            other.workerId !== lease.workerId &&
            activeAt(other, e.ts) &&
            other.scopeKind === lease.scopeKind &&
            CoordinationManager.scopesOverlap(lease.scopeKind, lease.scope, other.scope)
          ) {
            lease.status = 'superseded';
            lease.supersededBy = other.id;
            break;
          }
        }
        leases.set(lease.id, lease);
      } else if (e.type === 'lease.renewed') {
        const p = e.payload as EventPayloads['lease.renewed'];
        const l = leases.get(p.leaseId);
        if (l && l.workerId === p.workerId && l.status === 'active') {
          l.expiresAt = new Date(Date.parse(p.renewedAt) + p.ttlMs).toISOString();
        }
      } else if (e.type === 'lease.released') {
        const p = e.payload as EventPayloads['lease.released'];
        const l = leases.get(p.leaseId);
        if (l && l.workerId === p.workerId && l.status === 'active') l.status = 'released';
      }
    }

    for (const l of leases.values()) {
      if (l.status === 'active' && Date.parse(l.expiresAt) <= asOf) l.status = 'expired';
    }

    const allLeases = [...leases.values()].sort((a, b) =>
      a.acquiredAt < b.acquiredAt ? -1 : a.acquiredAt > b.acquiredAt ? 1 : a.id < b.id ? -1 : 1,
    );
    return {
      asOf: new Date(asOf).toISOString(),
      workers: [...workers.values()].sort((a, b) => (a.workerId < b.workerId ? -1 : 1)),
      activeLeases: allLeases.filter((l) => l.status === 'active'),
      allLeases,
    };
  }

  /** sessionId → namespace, from `worker.registered` events (for memory isolation). */
  async sessionNamespaceMap(): Promise<Map<string, string>> {
    const m = new Map<string, string>();
    for (const e of await this.adapter.readEvents()) {
      if (e.type === 'worker.registered') {
        const p = e.payload as EventPayloads['worker.registered'];
        m.set(e.sessionId, p.namespace);
      }
    }
    return m;
  }

  async registerWorker(
    sessionId: string,
    workerId: string,
    namespace: string,
    agent: string,
  ): Promise<void> {
    await this.append(sessionId, 'worker.registered', { workerId, namespace, agent });
  }

  async acquire(args: {
    sessionId: string;
    workerId: string;
    scopeKind: LeaseScopeKind;
    scope: string;
    ttlMs: number;
  }): Promise<LeaseDecision> {
    const st = await this.state();
    const mineActive = st.activeLeases.find(
      (l) =>
        l.workerId === args.workerId &&
        l.scopeKind === args.scopeKind &&
        CoordinationManager.scopesOverlap(args.scopeKind, l.scope, args.scope),
    );
    if (mineActive) {
      return { granted: true, lease: mineActive, reason: 'You already hold an overlapping lease.' };
    }
    const conflict = st.activeLeases.find(
      (l) =>
        l.workerId !== args.workerId &&
        l.scopeKind === args.scopeKind &&
        CoordinationManager.scopesOverlap(args.scopeKind, l.scope, args.scope),
    );
    if (conflict) {
      await this.adapter.audit({
        ts: this.clock.iso(),
        kind: 'lifecycle',
        message:
          `lease denied: ${args.scopeKind}:${args.scope} held by ${conflict.workerId} ` +
          `until ${conflict.expiresAt}`,
      });
      return {
        granted: false,
        conflict,
        reason:
          `Scope ${args.scopeKind}:"${args.scope}" is leased by worker ` +
          `"${conflict.workerId}" until ${conflict.expiresAt}. Coordinate or wait — ` +
          `Kairo advises, it does not preempt (ADR-0002).`,
      };
    }
    const leaseId = newId(this.clock.now());
    const acquiredAt = this.clock.iso();
    await this.append(args.sessionId, 'lease.acquired', {
      leaseId,
      workerId: args.workerId,
      scopeKind: args.scopeKind,
      scope: args.scope,
      ttlMs: args.ttlMs,
      acquiredAt,
    });
    return {
      granted: true,
      reason: `Lease granted on ${args.scopeKind}:"${args.scope}".`,
      lease: {
        id: leaseId,
        workerId: args.workerId,
        scopeKind: args.scopeKind,
        scope: args.scope,
        acquiredAt,
        expiresAt: new Date(Date.parse(acquiredAt) + args.ttlMs).toISOString(),
        status: 'active',
      },
    };
  }

  async renew(
    sessionId: string,
    workerId: string,
    leaseId: string,
    ttlMs: number,
  ): Promise<LeaseDecision> {
    const st = await this.state();
    const lease = st.allLeases.find((l) => l.id === leaseId);
    if (!lease || lease.workerId !== workerId) {
      return { granted: false, reason: `No lease ${leaseId} owned by ${workerId}.` };
    }
    if (lease.status !== 'active') {
      return { granted: false, reason: `Lease ${leaseId} is ${lease.status}; re-acquire instead.` };
    }
    await this.append(sessionId, 'lease.renewed', {
      leaseId,
      workerId,
      renewedAt: this.clock.iso(),
      ttlMs,
    });
    return { granted: true, reason: `Lease ${leaseId} renewed.` };
  }

  async release(sessionId: string, workerId: string, leaseId: string): Promise<LeaseDecision> {
    const st = await this.state();
    const lease = st.allLeases.find((l) => l.id === leaseId);
    if (!lease || lease.workerId !== workerId) {
      return { granted: false, reason: `No lease ${leaseId} owned by ${workerId}.` };
    }
    await this.append(sessionId, 'lease.released', {
      leaseId,
      workerId,
      releasedAt: this.clock.iso(),
    });
    return { granted: true, reason: `Lease ${leaseId} released.` };
  }

  /** The distributed checkpoint DAG across workers/sessions. */
  async timeline(): Promise<TimelineCheckpoint[]> {
    const events = await this.adapter.readEvents();
    const out: TimelineCheckpoint[] = [];
    for (const e of events) {
      if (e.type !== 'checkpoint.created') continue;
      const p = e.payload as EventPayloads['checkpoint.created'];
      const cp = await this.adapter.loadCheckpoint(p.checkpointId);
      if (!cp) continue;
      out.push({
        id: cp.id,
        workerId: cp.ownerWorkerId ?? cp.agent,
        sessionId: cp.sessionId,
        task: cp.task,
        reason: cp.reason,
        createdAt: cp.createdAt,
        ...(cp.parentCheckpointId ? { parentId: cp.parentCheckpointId } : {}),
      });
    }
    return out.sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1,
    );
  }

  async timelineGraph(): Promise<RepoGraph> {
    const tl = await this.timeline();
    const nodes = tl.map((c) => ({
      id: c.id.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 60),
      label: `${c.workerId}\n${c.task.slice(0, 28)}\n${c.reason}`,
      group: c.workerId,
    }));
    const ids = new Set(tl.map((c) => c.id));
    const edges = tl
      .filter((c) => c.parentId && ids.has(c.parentId))
      .map((c) => ({
        from: c.parentId!.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 60),
        to: c.id.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 60),
      }));
    return {
      // RepoGraph.kind is cosmetic here; the title/note identify this as the timeline.
      kind: 'module',
      title: 'Engineering timeline (distributed checkpoint graph)',
      nodes,
      edges,
      truncated: false,
      note: 'Checkpoint DAG across workers/sessions (ADR-0007). Deterministic from the shared log.',
    };
  }
}
