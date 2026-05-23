import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * v1.4.2 — Bug B + Bug C regression tests, surfaced by a Python repo
 * dogfood that triggered false-positive doctor warnings.
 *
 *   - Bug A (kairo init reports wrong form when skipping) is covered
 *     by tests in tests/cli.test.ts via the kairo init e2e path.
 *   - Bug B (doctor demands package.json) — verified here against
 *     Python / Rust / Go / Java / empty-with-git project shapes.
 *   - Bug C (version match warns for global/npx installs) — verified
 *     here by running doctor in a project with no local node_modules
 *     and asserting the version check does NOT fail.
 */

const repoRoot = resolve(process.cwd());
const kairoBin = join(repoRoot, 'dist', 'cli', 'cli.js');

interface DoctorJson {
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  ok: boolean;
}

function runDoctorJson(projectRoot: string): DoctorJson {
  const r = spawnSync(process.execPath, [kairoBin, 'doctor', '--json', '-C', projectRoot], {
    encoding: 'utf8',
  });
  if (!r.stdout) {
    throw new Error(`doctor produced no output: ${r.stderr}`);
  }
  return JSON.parse(r.stdout) as DoctorJson;
}

describe('doctor — Bug B: non-Node project markers (v1.4.2)', () => {
  it('Python project (pyproject.toml) is recognised as a valid project root', async () => {
    if (!existsSync(kairoBin)) {
      // Skip when dist/ hasn't been built (e.g. typecheck-only CI cells).
      return;
    }
    const root = await mkdtemp(join(tmpdir(), 'kairo-doctor-py-'));
    try {
      await writeFile(join(root, 'pyproject.toml'), '[project]\nname = "demo"\n');
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src', 'main.py'), 'print("hi")\n');

      const j = runDoctorJson(root);
      const projectCheck = j.checks.find((c) => c.name === 'project root');
      expect(projectCheck, 'project root check missing').toBeDefined();
      expect(projectCheck!.ok).toBe(true);
      expect(projectCheck!.detail).toContain('pyproject.toml');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('Python project (requirements.txt) is recognised as a valid project root', async () => {
    if (!existsSync(kairoBin)) return;
    const root = await mkdtemp(join(tmpdir(), 'kairo-doctor-pyreq-'));
    try {
      await writeFile(join(root, 'requirements.txt'), 'numpy==1.24\n');
      const j = runDoctorJson(root);
      const projectCheck = j.checks.find((c) => c.name === 'project root');
      expect(projectCheck!.ok).toBe(true);
      expect(projectCheck!.detail).toContain('requirements.txt');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('Rust project (Cargo.toml) is recognised as a valid project root', async () => {
    if (!existsSync(kairoBin)) return;
    const root = await mkdtemp(join(tmpdir(), 'kairo-doctor-rust-'));
    try {
      await writeFile(join(root, 'Cargo.toml'), '[package]\nname = "demo"\n');
      const j = runDoctorJson(root);
      const projectCheck = j.checks.find((c) => c.name === 'project root');
      expect(projectCheck!.ok).toBe(true);
      expect(projectCheck!.detail).toContain('Cargo.toml');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('Go project (go.mod) is recognised as a valid project root', async () => {
    if (!existsSync(kairoBin)) return;
    const root = await mkdtemp(join(tmpdir(), 'kairo-doctor-go-'));
    try {
      await writeFile(join(root, 'go.mod'), 'module example.com/demo\ngo 1.21\n');
      const j = runDoctorJson(root);
      const projectCheck = j.checks.find((c) => c.name === 'project root');
      expect(projectCheck!.ok).toBe(true);
      expect(projectCheck!.detail).toContain('go.mod');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('directory with only .git is recognised as a valid project root', async () => {
    if (!existsSync(kairoBin)) return;
    const root = await mkdtemp(join(tmpdir(), 'kairo-doctor-git-'));
    try {
      // Simulate `git init` — .git is a directory in the working tree.
      await mkdir(join(root, '.git'), { recursive: true });
      const j = runDoctorJson(root);
      const projectCheck = j.checks.find((c) => c.name === 'project root');
      expect(projectCheck!.ok).toBe(true);
      expect(projectCheck!.detail).toContain('.git');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('truly empty directory (no markers) fails project root with explanation', async () => {
    if (!existsSync(kairoBin)) return;
    const root = await mkdtemp(join(tmpdir(), 'kairo-doctor-empty-'));
    try {
      const j = runDoctorJson(root);
      const projectCheck = j.checks.find((c) => c.name === 'project root');
      expect(projectCheck!.ok).toBe(false);
      // The error names a few of the expected markers so the user knows what to do.
      expect(projectCheck!.detail).toMatch(/package\.json|pyproject|Cargo|go\.mod/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('doctor — Bug C: version match for non-local installs (v1.4.2)', () => {
  it('Python project with no node_modules does NOT fail version match', async () => {
    if (!existsSync(kairoBin)) return;
    const root = await mkdtemp(join(tmpdir(), 'kairo-doctor-vermatch-'));
    try {
      await writeFile(join(root, 'pyproject.toml'), '[project]\nname = "demo"\n');
      // No node_modules. No package.json. Doctor should NOT flag version
      // match as failing — it's running against a global or npx install.
      const j = runDoctorJson(root);
      const vc = j.checks.find((c) => c.name === 'version match');
      expect(vc, 'version match check missing').toBeDefined();
      expect(vc!.ok, `version match should be ok for non-local install; got: ${vc!.detail}`).toBe(
        true,
      );
      // The detail line should explain WHY it's ok (global / npx form).
      expect(vc!.detail).toMatch(/global|npx|dev repo/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('doctor — Bug A regression: kairo init in Python repo with stale local-form .mcp.json', () => {
  it('after kairo init --force on a Python repo, .mcp.json is no longer the local-form path', async () => {
    if (!existsSync(kairoBin)) return;
    const root = await mkdtemp(join(tmpdir(), 'kairo-init-stale-'));
    try {
      // Reconstruct the bug: a Python repo with a stale v1.0.x-era .mcp.json
      // referencing ./node_modules/kairo-mcp/dist/index.js that doesn't exist.
      await writeFile(join(root, 'pyproject.toml'), '[project]\nname = "demo"\n');
      await writeFile(
        join(root, '.mcp.json'),
        JSON.stringify(
          {
            mcpServers: {
              kairo: {
                command: 'node',
                args: ['./node_modules/kairo-mcp/dist/index.js'],
                env: { KAIRO_PROJECT_ROOT: '.' },
              },
            },
          },
          null,
          2,
        ),
      );

      // `kairo init --force` rewrites the .mcp.json.
      const r = spawnSync(process.execPath, [kairoBin, 'init', '--force', '--json', '-C', root], {
        encoding: 'utf8',
      });
      expect(r.status).toBe(0);

      // The new form must NOT be the broken local form — there's no
      // node_modules/kairo-mcp/dist/index.js in this Python repo.
      const written = JSON.parse(
        await (await import('node:fs/promises')).readFile(join(root, '.mcp.json'), 'utf8'),
      ) as { mcpServers: { kairo: { command: string; args?: string[] } } };
      const cmd = written.mcpServers.kairo.command;
      const args = written.mcpServers.kairo.args ?? [];
      const isStaleLocalForm =
        cmd === 'node' && args.some((a) => a.includes('./node_modules/kairo-mcp/'));
      expect(isStaleLocalForm, 'kairo init --force still wrote the broken local form').toBe(false);
      // It must be one of the v1.4.0 valid forms.
      expect(['kairo-mcp', 'npx']).toContain(cmd);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
