import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { kairoPaths } from '../storage/paths.js';
import { FileStorageAdapter } from '../storage/fileStorageAdapter.js';
import {
  AUDIT_SCHEMA,
  CHECKPOINT_SCHEMA,
  EVENT_SCHEMA_VERSION,
  INTELLIGENCE_SCHEMA,
  SESSION_SNAPSHOT_SCHEMA,
  TELEMETRY_SCHEMA,
  VECTOR_INDEX_SCHEMA,
} from '../contracts/schemas.js';
import { SERVER_VERSION } from '../server/createServer.js';
import { SNAPSHOT_SCHEMA, type KairoSnapshot, type SnapshotManifest } from './types.js';
import type { Checkpoint, SessionState } from '../types/domain.js';
import type { RepoIntelligence } from '../core/repo/types.js';
import type { VectorIndex } from '../core/vector/types.js';

export interface ExportResult {
  path: string;
  bytes: number;
  contentSha256: string;
  snapshot: KairoSnapshot;
}

export interface ExportOptions {
  /** Override absolute destination path. Defaults to `.kairo/snapshots/snapshot-{ts}.json`. */
  path?: string;
  /** Clock injection — tests pin createdAt for determinism. */
  now?: () => Date;
}

/**
 * Build a portable snapshot of the entire `.kairo/` directory (ADR-0013).
 * Reads pass through `FileStorageAdapter`, so v0.9.1 migrations and
 * quarantine apply transparently. Returns the on-disk path plus the
 * in-memory snapshot for callers that want to inspect it directly.
 */
export async function exportSnapshot(
  projectRoot: string,
  opts: ExportOptions = {},
): Promise<ExportResult> {
  const paths = kairoPaths(projectRoot);
  const adapter = new FileStorageAdapter(projectRoot);
  const now = (opts.now ?? (() => new Date()))();

  const [events, telemetry, audit] = await Promise.all([
    adapter.readEvents(),
    adapter.readTelemetry(),
    adapter.readAudit(),
  ]);

  const sessions: SessionState[] = [];
  for (const f of (await safeReaddir(paths.sessionsDir))
    .filter((x) => x.endsWith('.json'))
    .sort()) {
    const id = f.replace(/\.json$/, '');
    const s = await adapter.loadSessionSnapshot(id);
    if (s) sessions.push(s);
  }

  const checkpoints: Checkpoint[] = [];
  for (const f of (await safeReaddir(paths.checkpointsDir))
    .filter((x) => x.endsWith('.json'))
    .sort()) {
    const id = f.replace(/\.json$/, '');
    const cp = await adapter.loadCheckpoint(id);
    if (cp) checkpoints.push(cp);
  }

  const continuations: KairoSnapshot['continuations'] = [];
  for (const f of (await safeReaddir(paths.continuationsDir))
    .filter((x) => x.endsWith('.md'))
    .sort()) {
    continuations.push({
      name: f,
      markdown: await readFile(join(paths.continuationsDir, f), 'utf8'),
    });
  }

  const graphs: KairoSnapshot['graphs'] = [];
  for (const f of (await safeReaddir(paths.graphsDir)).filter((x) => x.endsWith('.md')).sort()) {
    graphs.push({
      kind: f.replace(/\.md$/, ''),
      markdown: await readFile(join(paths.graphsDir, f), 'utf8'),
    });
  }

  const intelligence: KairoSnapshot['intelligence'] = {
    latest: (await adapter.loadLatestIntelligence()) ?? null,
    byFingerprint: {},
  };
  for (const f of (await safeReaddir(paths.intelligenceDir))
    .filter((x) => x.endsWith('.json') && x !== 'latest.json')
    .sort()) {
    const fp = f.replace(/\.json$/, '');
    try {
      const raw = await readFile(join(paths.intelligenceDir, f), 'utf8');
      intelligence.byFingerprint[fp] = JSON.parse(raw) as RepoIntelligence;
    } catch {
      /* skip unreadable / corrupt intelligence file — caller can inspect */
    }
  }

  let vectorIndex: VectorIndex | null = null;
  try {
    vectorIndex = (await adapter.loadVectorIndex()) ?? null;
  } catch {
    vectorIndex = null;
  }

  const content = {
    events,
    telemetry,
    audit,
    sessions,
    checkpoints,
    continuations,
    graphs,
    intelligence,
    vectorIndex,
  };
  const contentJson = canonicalJson(content);
  const contentSha256 = createHash('sha256').update(contentJson).digest('hex');

  const manifest: SnapshotManifest = {
    snapshotSchema: SNAPSHOT_SCHEMA,
    kairoVersion: SERVER_VERSION,
    createdAt: now.toISOString(),
    sourceProjectRoot: projectRoot,
    counts: {
      events: events.length,
      telemetry: telemetry.length,
      audit: audit.length,
      sessions: sessions.length,
      checkpoints: checkpoints.length,
      continuations: continuations.length,
      graphs: graphs.length,
      intelligence: Object.keys(intelligence.byFingerprint).length + (intelligence.latest ? 1 : 0),
      vectorIndex: vectorIndex ? 1 : 0,
    },
    schemas: {
      event: EVENT_SCHEMA_VERSION,
      telemetry: TELEMETRY_SCHEMA,
      audit: AUDIT_SCHEMA,
      session: SESSION_SNAPSHOT_SCHEMA,
      checkpoint: CHECKPOINT_SCHEMA,
      intelligence: INTELLIGENCE_SCHEMA,
      vectorIndex: VECTOR_INDEX_SCHEMA,
    },
    contentSha256,
  };

  const snapshot: KairoSnapshot = { manifest, ...content };
  const json = JSON.stringify(snapshot, null, 2);

  const destPath = opts.path ?? defaultSnapshotPath(projectRoot, now);
  await mkdir(dirOf(destPath), { recursive: true });
  await writeFile(destPath, json, 'utf8');
  const s = await stat(destPath);

  return { path: destPath, bytes: s.size, contentSha256, snapshot };
}

function defaultSnapshotPath(projectRoot: string, now: Date): string {
  const ts = now.toISOString().replace(/[:.]/g, '-');
  return join(projectRoot, '.kairo', 'snapshots', `snapshot-${ts}.json`);
}

function dirOf(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx === -1 ? '.' : p.slice(0, idx) || basename(p);
}

async function safeReaddir(p: string): Promise<string[]> {
  try {
    return await readdir(p);
  } catch {
    return [];
  }
}

/**
 * Deterministic stringification: keys sorted at every level so that two
 * exports of the same `.kairo/` produce the same `contentSha256`.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(canonicalize);
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = canonicalize(obj[k]);
  return out;
}
