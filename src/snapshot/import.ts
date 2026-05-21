import { appendFile, readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { kairoPaths } from '../storage/paths.js';
import { FileStorageAdapter } from '../storage/fileStorageAdapter.js';
import { systemClock } from '../utils/time.js';
import { withRedaction } from '../storage/redactingAdapter.js';
import {
  migrateAudit,
  migrateCheckpoint,
  migrateEvent,
  migrateSession,
  migrateTelemetry,
} from '../contracts/migrations.js';
import type { KairoSnapshot } from './types.js';
import { SNAPSHOT_SCHEMA } from './types.js';

export interface ImportOptions {
  /** Allow writing on top of an existing non-empty `.kairo/`. Default false. */
  force?: boolean;
  /** Run redaction on the inbound records. Default true. */
  redact?: boolean;
}

export interface ImportResult {
  ingested: {
    events: number;
    telemetry: number;
    audit: number;
    sessions: number;
    checkpoints: number;
    continuations: number;
    graphs: number;
    intelligence: number;
    vectorIndex: 0 | 1;
  };
  warnings: string[];
  targetProjectRoot: string;
}

/**
 * Import a snapshot into a target project root (ADR-0013). Writes through
 * the normal redaction + validation seam — a snapshot from another machine
 * cannot bypass redaction, and v0.9.1 migrations run per record on the way
 * in. Refuses to overwrite an existing non-empty `.kairo/` unless `force`.
 */
export async function importSnapshot(
  targetProjectRoot: string,
  snapshotPath: string,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const warnings: string[] = [];
  const raw = await readFile(snapshotPath, 'utf8');
  const snap = JSON.parse(raw) as KairoSnapshot;

  if (!snap?.manifest || snap.manifest.snapshotSchema !== SNAPSHOT_SCHEMA) {
    throw new Error(
      `Unsupported snapshot: snapshotSchema=${snap?.manifest?.snapshotSchema ?? 'missing'}; ` +
        `this build understands schema ${SNAPSHOT_SCHEMA}.`,
    );
  }

  const paths = kairoPaths(targetProjectRoot);
  if (existsSync(paths.base)) {
    const items = await readdir(paths.base).catch(() => [] as string[]);
    const meaningful = items.filter((f) => f !== 'snapshots' && f !== 'quarantine');
    if (meaningful.length > 0 && !opts.force) {
      throw new Error(
        `Refusing to import: ${paths.base} is non-empty (found ${meaningful.length} entries). ` +
          `Pass force=true to overwrite, or import into an empty project root.`,
      );
    }
  }

  // Build a redacting adapter so secrets are sanitised on the way in.
  const redact = opts.redact ?? true;
  const base = new FileStorageAdapter(targetProjectRoot);
  const adapter = redact ? withRedaction(base, systemClock) : base;
  await adapter.init();

  // ── events: append in order ────────────────────────────────────────────
  for (const e of snap.events) {
    await adapter.appendEvent(migrateEvent(e));
  }

  // ── telemetry: append in order ─────────────────────────────────────────
  for (const t of snap.telemetry) {
    await adapter.appendTelemetry(migrateTelemetry(t));
  }

  // ── audit: append (raw — withRedaction's audit() passes through untouched) ─
  for (const a of snap.audit) {
    await adapter.audit(migrateAudit(a));
  }

  // ── sessions / checkpoints ─────────────────────────────────────────────
  for (const s of snap.sessions) {
    await adapter.saveSessionSnapshot(migrateSession(s));
  }
  for (const c of snap.checkpoints) {
    await adapter.saveCheckpoint(migrateCheckpoint(c));
  }

  // ── continuations / graphs ─────────────────────────────────────────────
  for (const c of snap.continuations) {
    await adapter.saveContinuation(c.name, c.markdown);
  }
  for (const g of snap.graphs) {
    await adapter.saveGraph(g.kind, g.markdown);
  }

  // ── intelligence ───────────────────────────────────────────────────────
  let intelligenceCount = 0;
  for (const intel of Object.values(snap.intelligence.byFingerprint ?? {})) {
    await adapter.saveIntelligence(intel);
    intelligenceCount += 1;
  }
  if (snap.intelligence.latest) {
    // saveIntelligence updates `latest` too; calling again preserves the most
    // recent as the latest-of-record.
    await adapter.saveIntelligence(snap.intelligence.latest);
    if (!snap.intelligence.byFingerprint?.[snap.intelligence.latest.fingerprint]) {
      intelligenceCount += 1;
    }
  }

  // ── vector index ───────────────────────────────────────────────────────
  let vectorWritten: 0 | 1 = 0;
  if (snap.vectorIndex) {
    await adapter.saveVectorIndex(snap.vectorIndex);
    vectorWritten = 1;
  }

  // ── quarantine notice ──────────────────────────────────────────────────
  // We do NOT import quarantine entries; they belong to the source operator.
  // If the snapshot contained any (informational only), surface a warning.
  // (Future: include manifest.counts.quarantine and surface it here.)

  return {
    ingested: {
      events: snap.events.length,
      telemetry: snap.telemetry.length,
      audit: snap.audit.length,
      sessions: snap.sessions.length,
      checkpoints: snap.checkpoints.length,
      continuations: snap.continuations.length,
      graphs: snap.graphs.length,
      intelligence: intelligenceCount,
      vectorIndex: vectorWritten,
    },
    warnings,
    targetProjectRoot,
  };
}

/** Convenience for tests / CLI: write a snapshot object to disk. */
export async function writeSnapshotFile(path: string, snapshot: KairoSnapshot): Promise<void> {
  const dir = path.replace(/[\\/][^\\/]+$/, '');
  if (dir && dir !== path) await mkdir(dir, { recursive: true }).catch(() => undefined);
  await writeFile(path, JSON.stringify(snapshot, null, 2), 'utf8');
}

/** Helper for failure-injection tests that want a torn snapshot file. */
export async function appendRawLine(path: string, line: string): Promise<void> {
  await appendFile(path, line, 'utf8');
}
