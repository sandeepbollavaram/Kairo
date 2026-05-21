import { mkdir, readFile, rename, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Checkpoint } from '../../types/domain.js';
import { kairoPaths } from '../../storage/paths.js';
import { FileStorageAdapter } from '../../storage/fileStorageAdapter.js';
import { logger } from '../../utils/logger.js';

/**
 * Memory compaction (v0.9.3, ADR-0014). Conservative on purpose: prefers
 * false negatives ("did not archive an event that could safely have been
 * archived") over false positives ("archived something replay needs").
 *
 * Compaction NEVER deletes. Archived events go to `.kairo/archive/`; the
 * manifest at `.kairo/archive/MANIFEST.md` records what was moved, when,
 * and why.
 */

export interface CompactionOptions {
  /** Sessions ended longer ago than this become candidates (default 90). */
  olderThanDays?: number;
  /** Dry-run only writes the report. Default true. */
  dryRun?: boolean;
  /** Clock injection for deterministic tests. */
  now?: () => Date;
}

export interface CompactionPlan {
  candidateEvents: number;
  retainedEvents: number;
  candidateSessionIds: string[];
  reasons: CompactionReason[];
  archivePath: string;
  manifestPath: string;
  reportPath: string;
}

export interface CompactionReason {
  sessionId: string;
  events: number;
  status: 'archived' | 'retained';
  detail: string;
}

export interface CompactionResult {
  plan: CompactionPlan;
  applied: boolean;
  /** Markdown report (also written to disk). */
  markdown: string;
}

export async function compact(
  projectRoot: string,
  opts: CompactionOptions = {},
): Promise<CompactionResult> {
  const paths = kairoPaths(projectRoot);
  const adapter = new FileStorageAdapter(projectRoot);
  await adapter.init();

  const olderThanDays = opts.olderThanDays ?? 90;
  const dryRun = opts.dryRun ?? true;
  const now = (opts.now ?? (() => new Date()))();
  const cutoffMs = now.getTime() - olderThanDays * 86_400_000;

  // ── Load ──────────────────────────────────────────────────────────────
  const events = await adapter.readEvents();
  const checkpoints = await loadAllCheckpoints(adapter, paths.checkpointsDir);

  // Build the set of sessions whose ended-at is older than the cutoff.
  const sessionStatus = new Map<string, { lastTs: string; ended: boolean; events: number }>();
  for (const e of events) {
    const s = sessionStatus.get(e.sessionId) ?? { lastTs: e.ts, ended: false, events: 0 };
    s.lastTs = s.lastTs < e.ts ? e.ts : s.lastTs;
    s.events += 1;
    if (e.type === 'session.ended') s.ended = true;
    sessionStatus.set(e.sessionId, s);
  }

  // Walk lineage from every checkpoint; sessions referenced by surviving
  // checkpoints' chains must NOT be archived.
  const protectedSessions = new Set<string>();
  for (const cp of checkpoints) protectedSessions.add(cp.sessionId);

  const candidates = new Set<string>();
  const reasons: CompactionReason[] = [];
  for (const [sid, st] of sessionStatus.entries()) {
    const eligible = st.ended && Date.parse(st.lastTs) < cutoffMs;
    if (!eligible) {
      reasons.push({
        sessionId: sid,
        events: st.events,
        status: 'retained',
        detail: st.ended
          ? `ended at ${st.lastTs}, within ${olderThanDays}-day window`
          : 'session not ended',
      });
      continue;
    }
    if (protectedSessions.has(sid)) {
      reasons.push({
        sessionId: sid,
        events: st.events,
        status: 'retained',
        detail: 'referenced by an existing checkpoint',
      });
      continue;
    }
    candidates.add(sid);
    reasons.push({
      sessionId: sid,
      events: st.events,
      status: 'archived',
      detail: `ended at ${st.lastTs}, older than ${olderThanDays} days`,
    });
  }

  const archived = events.filter((e) => candidates.has(e.sessionId));
  const retained = events.filter((e) => !candidates.has(e.sessionId));

  const ts = now.toISOString().replace(/[:.]/g, '-');
  const archivePath = join(paths.base, 'archive', `events-${ts}.jsonl`);
  const manifestPath = join(paths.base, 'archive', 'MANIFEST.md');
  const reportPath = join(paths.reportsDir, 'COMPACTION.md');

  const plan: CompactionPlan = {
    candidateEvents: archived.length,
    retainedEvents: retained.length,
    candidateSessionIds: [...candidates].sort(),
    reasons: reasons.sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
    archivePath,
    manifestPath,
    reportPath,
  };

  const markdown = renderReport(plan, { olderThanDays, dryRun, now: now.toISOString() });
  await mkdir(paths.reportsDir, { recursive: true });
  await writeFile(reportPath, markdown, 'utf8');

  if (dryRun || archived.length === 0) {
    return { plan, applied: false, markdown };
  }

  // ── Apply ────────────────────────────────────────────────────────────
  await mkdir(join(paths.base, 'archive'), { recursive: true });
  // Write archive first (atomically), then rewrite events.jsonl.
  const archiveBody = archived.map((e) => JSON.stringify(e)).join('\n') + '\n';
  const tmpArchive = `${archivePath}.${process.pid}.tmp`;
  await writeFile(tmpArchive, archiveBody, 'utf8');
  await rename(tmpArchive, archivePath);

  const retainedBody =
    retained.map((e) => JSON.stringify(e)).join('\n') + (retained.length > 0 ? '\n' : '');
  const tmpEvents = `${paths.events}.${process.pid}.tmp`;
  await writeFile(tmpEvents, retainedBody, 'utf8');
  await rename(tmpEvents, paths.events);

  await appendManifest(manifestPath, plan, now);

  logger.info('Compaction applied', {
    archived: archived.length,
    retained: retained.length,
    archivePath,
  });

  return { plan, applied: true, markdown };
}

async function loadAllCheckpoints(adapter: FileStorageAdapter, dir: string): Promise<Checkpoint[]> {
  const out: Checkpoint[] = [];
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return out;
  }
  for (const f of files) {
    const id = f.replace(/\.json$/, '');
    const cp = await adapter.loadCheckpoint(id);
    if (cp) out.push(cp);
  }
  return out;
}

async function appendManifest(
  manifestPath: string,
  plan: CompactionPlan,
  now: Date,
): Promise<void> {
  await mkdir(dirOf(manifestPath), { recursive: true });
  let existing = '';
  try {
    existing = await readFile(manifestPath, 'utf8');
  } catch {
    /* first compaction */
  }
  const entry =
    `\n## ${now.toISOString()}\n\n` +
    `- Archive: \`${plan.archivePath}\`\n` +
    `- Archived events: ${plan.candidateEvents}\n` +
    `- Retained events: ${plan.retainedEvents}\n` +
    `- Sessions archived: ${plan.candidateSessionIds.length}\n`;
  const header = existing
    ? existing
    : '# Kairo compaction archive manifest\n\n> Every line below records a compaction event. ' +
      'Archived events are MOVED, never deleted.\n';
  await writeFile(manifestPath, header + entry, 'utf8');
}

function dirOf(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx === -1 ? '.' : p.slice(0, idx);
}

function renderReport(
  plan: CompactionPlan,
  meta: { olderThanDays: number; dryRun: boolean; now: string },
): string {
  const lines: string[] = [];
  lines.push('# Kairo compaction report');
  lines.push('');
  lines.push(`- Mode: \`${meta.dryRun ? 'dry-run' : 'applied'}\``);
  lines.push(`- olderThanDays: \`${meta.olderThanDays}\``);
  lines.push(`- Generated: \`${meta.now}\``);
  lines.push(`- Candidate events: **${plan.candidateEvents}**`);
  lines.push(`- Retained events: **${plan.retainedEvents}**`);
  lines.push(`- Candidate sessions: ${plan.candidateSessionIds.length}`);
  lines.push('');
  lines.push('## Per-session decisions');
  lines.push('');
  lines.push('| Session | Events | Decision | Reason |');
  lines.push('|---|---:|---|---|');
  for (const r of plan.reasons) {
    lines.push(`| \`${r.sessionId}\` | ${r.events} | ${r.status} | ${r.detail} |`);
  }
  lines.push('');
  lines.push(
    '> Compaction NEVER deletes. Archived events are moved to ' +
      `\`${plan.archivePath}\`; the manifest is at \`${plan.manifestPath}\`.`,
  );
  return lines.join('\n');
}
