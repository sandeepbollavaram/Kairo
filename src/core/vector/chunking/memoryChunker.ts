import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { RepoIntelligence } from '../../repo/types.js';
import type { Checkpoint, SessionState } from '../../../types/domain.js';
import type { MemoryChunk } from '../types.js';
import { scoreItems } from '../../salience/salienceEngine.js';
import { resolveConfig, inferProfile, CRITICAL_DIRS } from '../../salience/config.js';
import type { SalienceContext, SalienceItem } from '../../salience/types.js';

/**
 * Builds architecture-aware chunks (ADR-0005) across the five memory classes from
 * artifacts Kairo already derives deterministically. It does NOT blindly chunk every
 * file — structural knowledge comes from the salience-ranked module graph and repo
 * intelligence, not a file dump.
 */
function fold(strings: string[]): string {
  return strings
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' — ');
}

export function chunkRepoIntelligence(intel: RepoIntelligence): MemoryChunk[] {
  const chunks: MemoryChunk[] = [];

  // Salience for graph groups, reusing the ADR-0004 subsystem.
  const profile = inferProfile({
    topLevelDirs: intel.inventory.topLevelDirs,
    frameworkCategories: intel.frameworks.map((f) => f.category),
  });
  const ctx: SalienceContext = {
    sourceRoots: ['src', 'lib', 'app', 'sources', 'packages', 'apps', 'libs'],
    entryPoints: intel.entryPoints.map((e) => e.path),
    workspaceGlobs: [],
    frameworkDirs: [...CRITICAL_DIRS],
    profile,
  };
  const config = resolveConfig(profile);

  const g = intel.moduleGraph;
  const idToLabel = new Map(g.nodes.map((n) => [n.id, n.label]));
  const neighbors = new Map<string, Set<string>>();
  const degree = new Map<string, number>();
  for (const e of g.edges) {
    const a = idToLabel.get(e.from)!;
    const b = idToLabel.get(e.to)!;
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    if (!neighbors.has(b)) neighbors.set(b, new Set());
    neighbors.get(a)!.add(b);
    neighbors.get(b)!.add(a);
    degree.set(a, (degree.get(a) ?? 0) + (e.weight ?? 1));
    degree.set(b, (degree.get(b) ?? 0) + (e.weight ?? 1));
  }
  const items: SalienceItem[] = g.nodes.map((n) => ({
    id: n.label,
    path: n.label,
    metrics: { fanIn: degree.get(n.label) ?? 0, fanOut: degree.get(n.label) ?? 0 },
  }));
  const salience = new Map(scoreItems(items, ctx, config).map((s) => [s.id, s.score]));

  // Structural overview.
  chunks.push({
    id: 'struct:overview',
    kind: 'structural',
    // Logical locator — never the absolute local path (it would leak into memory).
    locator: '(repository)',
    text: fold([
      `Repository architecture overview.`,
      `Primary language ${intel.languages.primary}.`,
      `Frameworks: ${intel.frameworks.map((f) => f.name).join(', ') || 'none'}.`,
      `Top-level: ${intel.inventory.topLevelDirs.join(', ')}.`,
      `Entry points: ${intel.entryPoints.map((e) => e.path).join(', ') || 'none'}.`,
      `${g.nodes.length} module groups, ${g.edges.length} dependency edges${g.truncated ? ' (truncated)' : ''}.`,
    ]),
    salience: 1.5,
    graphDegree: g.edges.length,
    runtimeReachable: true,
    neighbors: [],
  });

  // One structural chunk per module group (already salience-ranked & capped).
  for (const n of g.nodes) {
    const nbrs = [...(neighbors.get(n.label) ?? [])].sort();
    chunks.push({
      id: `struct:mod:${n.label}`,
      kind: 'structural',
      locator: n.label,
      text: fold([
        `Module group "${n.label}".`,
        nbrs.length ? `Depends-with: ${nbrs.join(', ')}.` : 'Leaf module.',
        `Graph degree ${degree.get(n.label) ?? 0}.`,
      ]),
      salience: salience.get(n.label) ?? 0,
      graphDegree: degree.get(n.label) ?? 0,
      runtimeReachable: intel.entryPoints.some((e) => e.path.includes(n.label)),
      neighbors: nbrs,
    });
  }

  // Operational memory: build/test/deploy facts.
  chunks.push({
    id: 'op:tooling',
    kind: 'operational',
    locator: 'tooling',
    text: fold([
      `Build & operational profile.`,
      `Frameworks/tooling: ${intel.frameworks.map((f) => `${f.name}${f.version ? `@${f.version}` : ''}`).join(', ')}.`,
      intel.ciWorkflows.length
        ? `CI workflows: ${intel.ciWorkflows.join(', ')}.`
        : 'No CI detected.',
    ]),
    salience: 0.8,
    graphDegree: 0,
    runtimeReachable: false,
    neighbors: [],
  });

  return chunks;
}

export function chunkSessionMemory(
  sessions: SessionState[],
  checkpoint: Checkpoint | undefined,
): MemoryChunk[] {
  const chunks: MemoryChunk[] = [];

  // Decision memory (most recent first, bounded).
  const decisions = sessions.flatMap((s) => s.decisions.map((d) => ({ d, sid: s.id }))).slice(-80);
  for (const { d, sid } of decisions) {
    chunks.push({
      id: `decision:${sid}:${d.ts}`,
      kind: 'decision',
      locator: `session ${sid}`,
      text: fold([
        `Engineering decision: ${d.summary}.`,
        d.rationale ? `Rationale: ${d.rationale}.` : '',
      ]),
      salience: 1.2,
      graphDegree: 0,
      runtimeReachable: false,
      neighbors: [],
      ts: d.ts,
    });
  }

  if (checkpoint) {
    chunks.push({
      id: `session:checkpoint:${checkpoint.id}`,
      kind: 'session',
      locator: `checkpoint ${checkpoint.id}`,
      text: fold([
        `Session checkpoint for task: ${checkpoint.task}.`,
        checkpoint.remainingWork.length ? `Remaining: ${checkpoint.remainingWork.join('; ')}.` : '',
        checkpoint.blockers.length ? `Blockers: ${checkpoint.blockers.join('; ')}.` : '',
        `Risk ${checkpoint.risk.level}.`,
      ]),
      salience: 1.3,
      graphDegree: 0,
      runtimeReachable: false,
      neighbors: [],
      ts: checkpoint.createdAt,
    });
  }
  return chunks;
}

const DOC_DIRS = ['docs', 'docs/adr'];
const ROOT_DOCS = ['README.md', 'ARCHITECTURE.md', 'CONTRIBUTING.md', 'SECURITY.md'];
const MAX_DOC_BYTES = 64 * 1024;

/** Decision/semantic memory from ADRs and architecture docs (bounded). */
export async function chunkDocs(projectRoot: string): Promise<MemoryChunk[]> {
  const out: MemoryChunk[] = [];
  const tryFile = async (
    rel: string,
    kind: MemoryChunk['kind'],
    salience: number,
  ): Promise<void> => {
    try {
      const buf = await readFile(join(projectRoot, rel), 'utf8');
      const text = buf.slice(0, MAX_DOC_BYTES).replace(/\s+/g, ' ').trim();
      if (text.length < 40) return;
      out.push({
        id: `doc:${rel}`,
        kind,
        locator: rel,
        text: `${rel}: ${text.slice(0, 4000)}`,
        salience,
        graphDegree: 0,
        runtimeReachable: false,
        neighbors: [],
      });
    } catch {
      /* missing/unreadable doc: skip */
    }
  };
  for (const d of ROOT_DOCS) await tryFile(d, 'semantic', 0.9);
  for (const dir of DOC_DIRS) {
    let entries: string[] = [];
    try {
      entries = (await readdir(join(projectRoot, dir))).filter((f) => f.endsWith('.md')).sort();
    } catch {
      continue;
    }
    for (const f of entries) {
      const rel = `${dir}/${f}`;
      await tryFile(
        rel,
        dir.includes('adr') ? 'decision' : 'semantic',
        dir.includes('adr') ? 1.3 : 0.9,
      );
    }
  }
  return out;
}
