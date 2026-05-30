import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStorageAdapter } from '../src/storage/fileStorageAdapter.js';
import { withRedaction } from '../src/storage/redactingAdapter.js';
import { SessionManager } from '../src/core/session/sessionManager.js';
import { systemClock } from '../src/utils/time.js';
import { createCapsule } from '../src/core/capsule/index.js';
import { CapsuleProjectionBuilder } from '../src/core/capsule/capsuleProjection.js';
import { renderCapsule, clamp } from '../src/core/capsule/capsuleRenderer.js';
import { resolveCapsuleBudget, CAPSULE_BUDGETS } from '../src/core/capsule/capsuleBudgets.js';
import { buildAgentsMd, writeAgentsMd } from '../src/core/capsule/agentsMd.js';
import { TRUNCATION_MARKER, type CapsuleProjection } from '../src/core/capsule/capsuleTypes.js';
import { stabilityOf } from '../src/contracts/stability.js';

/**
 * Atlas Capsule tests (v1.6.0, ADR-0020).
 *
 * Covers the determinism + safety + budget contract: deterministic generation,
 * mode budgets, target-specific wording, redaction, no absolute-path leakage,
 * files-to-read-first / safe-to-skip presence, missing-checkpoint and empty-repo
 * fallbacks, AGENTS.md refusal/force, MCP/CLI registration, and replay
 * determinism.
 */

async function seedRepo(root: string): Promise<void> {
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'capsule-demo',
      version: '9.9.9',
      dependencies: { express: '^4.19.0' },
    }),
  );
  await mkdir(join(root, 'src', 'api'), { recursive: true });
  await mkdir(join(root, 'src', 'core'), { recursive: true });
  await mkdir(join(root, 'src', 'payment'), { recursive: true });
  await mkdir(join(root, 'docs'), { recursive: true });
  await mkdir(join(root, 'tests'), { recursive: true });
  await writeFile(
    join(root, 'src', 'api', 'server.ts'),
    `import { charge } from '../payment/charge.js';\nimport { log } from '../core/log.js';\nexport const app = () => charge() && log();\n`,
  );
  await writeFile(
    join(root, 'src', 'payment', 'charge.ts'),
    `import { log } from '../core/log.js';\nexport const charge = () => log();\n`,
  );
  await writeFile(join(root, 'src', 'core', 'log.ts'), `export const log = () => true;\n`);
  await writeFile(join(root, 'docs', 'guide.md'), `# Guide\n`);
  await writeFile(join(root, 'tests', 'app.test.ts'), `export const t = 1;\n`);
}

/** Seed a repo with a real checkpoint via the SessionManager. */
async function seedWithCheckpoint(root: string): Promise<void> {
  await seedRepo(root);
  const adapter = withRedaction(new FileStorageAdapter(root), systemClock);
  const sessions = new SessionManager(adapter, systemClock);
  await sessions.init();
  await sessions.startSession({
    agent: 'claude',
    task: 'wire the payment path',
    projectRoot: root,
  });
  await sessions.record({
    kind: 'file',
    path: 'src/payment/charge.ts',
    changeKind: 'modified',
    risk: 'high',
  });
  await sessions.record({ kind: 'file', path: 'src/api/server.ts', changeKind: 'modified' });
  await sessions.record({ kind: 'pending', item: 'add refund flow' });
  await sessions.record({ kind: 'completed', item: 'charge happy path' });
  await sessions.checkpoint({ reason: 'manual' });
  await sessions.endSession();
}

async function withTmp(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'capsule-'));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// ── 1. deterministic generation + 15. replay determinism ───────────────────

describe('capsule determinism', () => {
  it('two builds of the same .kairo/ render byte-identical capsules', async () => {
    await withTmp(async (root) => {
      await seedWithCheckpoint(root);
      // Skip recall so the comparison is independent of any embedder timing.
      const a = await createCapsule({ projectRoot: root, mode: 'deep', skipRecall: true });
      const b = await createCapsule({ projectRoot: root, mode: 'deep', skipRecall: true });
      expect(a.rendered.text).toBe(b.rendered.text);
      expect(a.rendered.chars).toBe(b.rendered.chars);
    });
  });

  it('the pure renderer is a deterministic function of its inputs', () => {
    const p = emptyProjection();
    expect(renderCapsule(p, { mode: 'standard' }).text).toBe(
      renderCapsule(p, { mode: 'standard' }).text,
    );
  });
});

// ── 2. mode budgets + truncation marker ─────────────────────────────────────

describe('mode budgets', () => {
  it('tiny / standard / deep each stay within their char budget', async () => {
    await withTmp(async (root) => {
      await seedWithCheckpoint(root);
      for (const mode of ['tiny', 'standard', 'deep'] as const) {
        const { rendered } = await createCapsule({ projectRoot: root, mode, skipRecall: true });
        expect(rendered.maxChars).toBe(CAPSULE_BUDGETS[mode].maxChars);
        expect(rendered.chars).toBeLessThanOrEqual(rendered.maxChars);
      }
    });
  });

  it('emits a truncation marker when the budget is exceeded', () => {
    const long = 'x'.repeat(5000);
    const r = clamp(long, 100);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(100);
    expect(r.text.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it('a tiny budget on a rich projection truncates and flags it', async () => {
    await withTmp(async (root) => {
      await seedWithCheckpoint(root);
      const { rendered } = await createCapsule({
        projectRoot: root,
        mode: 'deep',
        maxChars: 300,
        skipRecall: true,
      });
      expect(rendered.chars).toBeLessThanOrEqual(300);
      expect(rendered.truncated).toBe(true);
      expect(rendered.text).toContain('capsule truncated');
    });
  });

  it('resolveCapsuleBudget honours a positive override only', () => {
    expect(resolveCapsuleBudget('tiny').maxChars).toBe(1500);
    expect(resolveCapsuleBudget('tiny', 999).maxChars).toBe(999);
    expect(resolveCapsuleBudget('tiny', 0).maxChars).toBe(1500);
    expect(resolveCapsuleBudget('tiny', -5).maxChars).toBe(1500);
  });
});

// ── 3. target-specific wording ──────────────────────────────────────────────

describe('target wording', () => {
  it('renders distinct framing per target without changing the facts', async () => {
    await withTmp(async (root) => {
      await seedWithCheckpoint(root);
      const claude = await createCapsule({ projectRoot: root, target: 'claude', skipRecall: true });
      const codex = await createCapsule({ projectRoot: root, target: 'codex', skipRecall: true });
      const generic = await createCapsule({
        projectRoot: root,
        target: 'generic',
        skipRecall: true,
      });

      expect(claude.rendered.text).toContain('Claude Code');
      expect(claude.rendered.text).toContain('kairo_session_start');
      expect(codex.rendered.text).toContain('Codex');
      expect(codex.rendered.text).toContain('AGENTS.md');
      expect(generic.rendered.text).toContain('AI agent');
      // Same underlying task fact across targets.
      for (const r of [claude, codex, generic]) {
        expect(r.rendered.text).toContain('wire the payment path');
      }
    });
  });

  it('every capsule states the honest "reduces rescanning / not a guarantee" framing', async () => {
    await withTmp(async (root) => {
      await seedWithCheckpoint(root);
      const { rendered } = await createCapsule({ projectRoot: root, skipRecall: true });
      expect(rendered.text.toLowerCase()).toContain('reduces unnecessary rescanning');
      expect(rendered.text.toLowerCase()).toContain('not a guarantee');
    });
  });
});

// ── 4. redaction + 5. no absolute path leakage ─────────────────────────────

describe('redaction & path safety', () => {
  it('redacts secret-shaped values that reach the renderer', () => {
    // Values matching the real SECRET_PATTERNS, assembled at runtime so no
    // scannable secret literal ever lives in this source file (GitHub push
    // protection would otherwise block the commit).
    const stripe = ['sk', 'live', 'ABCDEFGHIJKLMNOP1234567890'].join('_');
    const aws = 'AKIA' + 'IOSFODNN7EXAMPLE';
    const ghToken = 'ghp_' + 'a'.repeat(40);
    const p = emptyProjection();
    p.task = `rotate ${stripe} and ${aws}`;
    p.risks = [`leaked ${ghToken} in a log`];
    const { text } = renderCapsule(p, { mode: 'deep' });
    expect(text).not.toContain(stripe);
    expect(text).not.toContain(aws);
    expect(text).not.toContain(ghToken);
    expect(text).toContain('«REDACTED');
  });

  it('drops absolute paths and emits only repo-relative file paths', async () => {
    await withTmp(async (root) => {
      await seedRepo(root);
      const adapter = withRedaction(new FileStorageAdapter(root), systemClock);
      const sessions = new SessionManager(adapter, systemClock);
      await sessions.init();
      await sessions.startSession({ agent: 'claude', task: 'edge paths', projectRoot: root });
      // Record an absolute path; the projection must drop it.
      await sessions.record({ kind: 'file', path: '/etc/passwd', changeKind: 'modified' });
      await sessions.record({ kind: 'file', path: 'src/core/log.ts', changeKind: 'modified' });
      await sessions.checkpoint({ reason: 'manual' });

      const projection = await new CapsuleProjectionBuilder(root).build();
      for (const f of projection.changedFiles) {
        expect(f.path.startsWith('/')).toBe(false);
        expect(/^[A-Za-z]:\\/.test(f.path)).toBe(false);
      }
      expect(projection.changedFiles.some((f) => f.path === 'src/core/log.ts')).toBe(true);
      expect(projection.changedFiles.some((f) => f.path.includes('passwd'))).toBe(false);

      const { text } = renderCapsule(projection, { mode: 'deep' });
      expect(text).not.toContain(root); // the absolute temp root never appears
    });
  });
});

// ── 6 & 7. files-to-read-first + safe-to-skip present ──────────────────────

describe('reading plan', () => {
  it('populates files-to-read-first from changed files (risk-ranked)', async () => {
    await withTmp(async (root) => {
      await seedWithCheckpoint(root);
      const { rendered } = await createCapsule({ projectRoot: root, skipRecall: true });
      expect(rendered.readFirst.length).toBeGreaterThan(0);
      // The high-risk file sorts first.
      expect(rendered.readFirst[0]?.path).toBe('src/payment/charge.ts');
      expect(rendered.text).toContain('Read first');
    });
  });

  it('populates safe-to-skip-initially with the honest caveat', async () => {
    await withTmp(async (root) => {
      await seedWithCheckpoint(root);
      const { rendered } = await createCapsule({ projectRoot: root, skipRecall: true });
      expect(rendered.skipInitially.length).toBeGreaterThan(0);
      expect(rendered.text).toContain('Safe to skip initially');
      expect(rendered.text.toLowerCase()).toContain('unless you detect a mismatch');
    });
  });

  it('never lists an actively-changed area as safe to skip', async () => {
    await withTmp(async (root) => {
      await seedRepo(root);
      const adapter = withRedaction(new FileStorageAdapter(root), systemClock);
      const sessions = new SessionManager(adapter, systemClock);
      await sessions.init();
      await sessions.startSession({ agent: 'claude', task: 'edit a test', projectRoot: root });
      await sessions.record({ kind: 'file', path: 'tests/app.test.ts', changeKind: 'modified' });
      await sessions.checkpoint({ reason: 'manual' });
      const projection = await new CapsuleProjectionBuilder(root).build();
      // tests/ was changed → must not appear as safe-to-skip.
      expect(projection.skipInitially.some((s) => s.path.startsWith('test'))).toBe(false);
    });
  });
});

// ── 8. missing checkpoint fallback + 9. empty repo fallback ─────────────────

describe('fallbacks', () => {
  it('renders a sane capsule when there is no checkpoint', async () => {
    await withTmp(async (root) => {
      await seedRepo(root); // repo exists, but no .kairo/ session/checkpoint
      const { projection, rendered } = await createCapsule({ projectRoot: root, skipRecall: true });
      expect(projection.latestCheckpointId).toBeUndefined();
      expect(rendered.text).toContain('No checkpoint yet');
      expect(rendered.chars).toBeGreaterThan(0);
      expect(rendered.chars).toBeLessThanOrEqual(rendered.maxChars);
    });
  });

  it('renders for a completely empty repo without throwing', async () => {
    await withTmp(async (root) => {
      const { rendered } = await createCapsule({ projectRoot: root, skipRecall: true });
      expect(rendered.chars).toBeGreaterThan(0);
      expect(rendered.text).toContain('Kairo Capsule');
    });
  });
});

// ── 10 & 11. AGENTS.md export refusal / force ──────────────────────────────

describe('AGENTS.md export', () => {
  it('refuses to overwrite an existing AGENTS.md without force', async () => {
    await withTmp(async (root) => {
      await seedWithCheckpoint(root);
      await writeFile(join(root, 'AGENTS.md'), 'pre-existing\n');
      const { projection, rendered } = await createCapsule({
        projectRoot: root,
        target: 'codex',
        skipRecall: true,
      });
      const body = buildAgentsMd(rendered, projection);
      const r = await writeAgentsMd(root, body, { force: false });
      expect(r.written).toBe(false);
      expect(r.refusedReason).toMatch(/already exists/i);
      // Original content untouched.
      expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe('pre-existing\n');
    });
  });

  it('overwrites with force and includes a generated header + reading plan', async () => {
    await withTmp(async (root) => {
      await seedWithCheckpoint(root);
      await writeFile(join(root, 'AGENTS.md'), 'pre-existing\n');
      const { projection, rendered } = await createCapsule({
        projectRoot: root,
        target: 'codex',
        skipRecall: true,
      });
      const body = buildAgentsMd(rendered, projection);
      const r = await writeAgentsMd(root, body, { force: true });
      expect(r.written).toBe(true);
      const written = await readFile(join(root, 'AGENTS.md'), 'utf8');
      expect(written).toContain('Generated by Kairo Atlas Capsule');
      expect(written).toContain('# AGENTS.md');
      expect(written).toContain('Read first');
    });
  });

  it('writes AGENTS.md when none exists', async () => {
    await withTmp(async (root) => {
      await seedWithCheckpoint(root);
      const { projection, rendered } = await createCapsule({
        projectRoot: root,
        target: 'codex',
        skipRecall: true,
      });
      const r = await writeAgentsMd(root, buildAgentsMd(rendered, projection));
      expect(r.written).toBe(true);
      expect(existsSync(join(root, 'AGENTS.md'))).toBe(true);
    });
  });
});

// ── 12. MCP tool registration + 13/14. CLI & route registration ─────────────

describe('registration & stability', () => {
  it('registers kairo_capsule_create as an experimental MCP tool', () => {
    const e = stabilityOf('kairo_capsule_create');
    expect(e).toBeDefined();
    expect(e?.surface).toBe('mcp-tool');
    expect(e?.tier).toBe('experimental');
    expect(e?.since).toBe('1.6.0');
  });

  it('registers the capsule CLI command and /capsules route', () => {
    expect(stabilityOf('capsule')?.surface).toBe('cli-command');
    expect(stabilityOf('/capsules')?.surface).toBe('inspect-route');
  });
});

// ── helpers ─────────────────────────────────────────────────────────────────

function emptyProjection(): CapsuleProjection {
  return {
    schemaVersion: 1,
    repoName: 'demo',
    completedWork: [],
    remainingWork: [],
    blockers: [],
    changedFiles: [],
    readFirst: [],
    skipInitially: [],
    architecture: ['Primary language: TypeScript'],
    atlasNodes: [],
    memoryRecall: [],
    risks: [],
    commands: [],
    nextActions: ['Start a Kairo session.'],
    doNotTouch: [],
    verification: 'unverified — no checkpoint recorded',
    note: 'test projection',
  };
}
