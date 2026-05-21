/**
 * Kairo SDK (v0.9.4, ADR-0015). Small, dependency-light, **local** client
 * for reading `.kairo/` state, reports, and stability metadata.
 *
 * Suitable for build scripts, CI checks, and editor extensions that want
 * the same data the web inspector renders — without spawning the MCP
 * server or speaking the wire protocol. Read-only by design.
 *
 * SDK and MCP are parallel ways to read Kairo, not alternatives. MCP is
 * for agents over stdio; SDK is for local code in the same process.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { kairoPaths, type KairoPaths } from '../storage/paths.js';
import { InspectProjection } from '../inspect/projections.js';
import { stabilityOf, byTier, STABILITY } from '../contracts/stability.js';
import type { StabilityEntry, StabilityTier } from '../contracts/stability.js';
import { loadPlugins } from '../plugins/loader.js';
import { SNAPSHOT_SCHEMA } from '../snapshot/types.js';
import type { KairoSnapshot } from '../snapshot/types.js';
import type { LoadedPlugin } from '../plugins/types.js';
import type {
  CheckpointListEntry,
  CoordinationSnapshot,
  GraphSummary,
  InspectOverview,
  MemoryIndexSnapshot,
  RiskSnapshot,
  SessionListEntry,
} from '../inspect/projections.js';
import type { Checkpoint, SessionState } from '../types/domain.js';
import { SERVER_VERSION } from '../server/createServer.js';

export interface KairoClientOptions {
  /** Defaults to `KAIRO_PROJECT_ROOT` env or cwd. */
  projectRoot?: string;
}

export class KairoClient {
  private readonly projection: InspectProjection;
  private readonly paths: KairoPaths;

  constructor(opts: KairoClientOptions = {}) {
    this.projection = new InspectProjection(opts.projectRoot);
    this.paths = kairoPaths(opts.projectRoot);
  }

  /** Build version of the Kairo library this SDK was bundled with. */
  static version(): string {
    return SERVER_VERSION;
  }

  /** True if the target project has a `.kairo/` directory at all. */
  hasKairo(): boolean {
    return this.projection.hasKairo();
  }

  // ── Read-only inspect projections ──────────────────────────────────────

  overview(): Promise<InspectOverview> {
    return this.projection.overview();
  }

  sessions(): Promise<SessionListEntry[]> {
    return this.projection.listSessions();
  }

  session(id: string): Promise<SessionState | undefined> {
    return this.projection.getSession(id);
  }

  checkpoints(): Promise<CheckpointListEntry[]> {
    return this.projection.listCheckpoints();
  }

  checkpoint(id: string): Promise<Checkpoint | undefined> {
    return this.projection.getCheckpoint(id);
  }

  latestCheckpoint(): Promise<Checkpoint | undefined> {
    return this.projection.latestCheckpoint();
  }

  graphs(): Promise<string[]> {
    return this.projection.listGraphs();
  }

  graph(kind: string): Promise<GraphSummary | undefined> {
    return this.projection.readGraph(kind);
  }

  memoryIndex(): Promise<MemoryIndexSnapshot | undefined> {
    return this.projection.memoryIndex();
  }

  coordination(): Promise<CoordinationSnapshot> {
    return this.projection.coordination();
  }

  risk(): Promise<RiskSnapshot> {
    return this.projection.risk();
  }

  /** Read a continuation brief by filename. */
  brief(name: string): Promise<string | undefined> {
    return this.projection.readContinuation(name);
  }

  /** Read the latest continuation brief, if any. */
  async latestBrief(): Promise<string | undefined> {
    const list = await this.projection.listContinuations();
    const last = list[list.length - 1];
    return last ? this.projection.readContinuation(last) : undefined;
  }

  // ── Reports under `.kairo/reports/` ────────────────────────────────────

  /** Read a report from `.kairo/reports/{name}`. Returns undefined if absent. */
  async readReport(name: string): Promise<string | undefined> {
    const p = join(this.paths.reportsDir, name);
    if (!existsSync(p)) return undefined;
    return readFile(p, 'utf8');
  }

  // ── Snapshot validation ───────────────────────────────────────────────

  /**
   * Validate a snapshot file without importing it. Returns the manifest
   * + a list of warnings; throws on unparseable JSON.
   */
  async validateSnapshot(path: string): Promise<{
    manifest: KairoSnapshot['manifest'];
    warnings: string[];
  }> {
    const raw = await readFile(path, 'utf8');
    const snap = JSON.parse(raw) as KairoSnapshot;
    const warnings: string[] = [];
    if (!snap.manifest) {
      throw new Error('Snapshot has no manifest');
    }
    const onDiskSchema = (snap.manifest as { snapshotSchema?: number }).snapshotSchema;
    if (onDiskSchema !== SNAPSHOT_SCHEMA) {
      warnings.push(
        `snapshotSchema=${String(onDiskSchema)}; this build understands ${String(SNAPSHOT_SCHEMA)}`,
      );
    }
    if (!Array.isArray(snap.events)) warnings.push('events: not an array');
    if (!Array.isArray(snap.telemetry)) warnings.push('telemetry: not an array');
    if (!Array.isArray(snap.audit)) warnings.push('audit: not an array');
    return { manifest: snap.manifest, warnings };
  }

  // ── Stability registry ────────────────────────────────────────────────

  /** Lookup a single surface entry (tool/route/schema/snapshot). */
  stabilityOf(id: string): StabilityEntry | undefined {
    return stabilityOf(id);
  }

  /** All entries at the given tier. */
  byTier(tier: StabilityTier): StabilityEntry[] {
    return byTier(tier);
  }

  /** Full registry (sorted by surface, then id, for deterministic output). */
  stabilityRegistry(): readonly StabilityEntry[] {
    return [...STABILITY].sort((a, b) =>
      a.surface === b.surface ? a.id.localeCompare(b.id) : a.surface.localeCompare(b.surface),
    );
  }

  // ── Plugin manifests (metadata only — no execution) ───────────────────

  plugins(): Promise<LoadedPlugin[]> {
    return loadPlugins(this.paths.root);
  }
}

export type { StabilityEntry, StabilityTier } from '../contracts/stability.js';
export type { LoadedPlugin, KairoPluginManifest, PluginCapability } from '../plugins/types.js';
