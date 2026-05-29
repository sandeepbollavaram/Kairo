import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStorageAdapter } from '../src/storage/fileStorageAdapter.js';
import { withRedaction } from '../src/storage/redactingAdapter.js';
import { SessionManager } from '../src/core/session/sessionManager.js';
import { systemClock } from '../src/utils/time.js';
import { startInspectServer, type InspectServerHandle } from '../src/inspect/server.js';
import { ATLAS_CSP } from '../src/inspect/atlas/atlasRoutes.js';

/**
 * v1.5.0 PR 5 — Atlas 3D view tests (ADR-0019).
 *
 * The 3D renderer is browser-side (a hand-written perspective projection onto
 * the same 2D canvas — no WebGL library, no remote deps). These tests assert
 * the server contract is unchanged, the 2D/3D toggle is present, the renderer
 * asset carries the 3D code path, and the no-remote / no-eval / scoped-CSP
 * guarantees still hold. Camera/projection math is deterministic in the
 * browser and not asserted at the HTTP layer.
 */
let projectRoot: string;
let handle: InspectServerHandle;

beforeAll(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), 'kairo-atlas-3d-'));
  await writeFile(
    join(projectRoot, 'package.json'),
    JSON.stringify({ name: 'atlas-3d', dependencies: { express: '^4.19.0' } }),
  );
  await mkdir(join(projectRoot, 'src', 'core'), { recursive: true });
  await mkdir(join(projectRoot, 'src', 'api'), { recursive: true });
  await writeFile(
    join(projectRoot, 'src', 'api', 'server.ts'),
    `import { log } from '../core/log.js';\nexport const app = () => log();\n`,
  );
  await writeFile(join(projectRoot, 'src', 'core', 'log.ts'), `export const log = () => true;\n`);

  const adapter = withRedaction(new FileStorageAdapter(projectRoot), systemClock);
  const sessions = new SessionManager(adapter, systemClock);
  await sessions.init();
  await sessions.startSession({ agent: 'claude', task: 'atlas 3d', projectRoot });
  await sessions.record({ kind: 'file', path: 'src/core/log.ts', changeKind: 'modified' });
  await sessions.checkpoint({ reason: 'manual', completed: ['x'] });
  await sessions.endSession();

  handle = await startInspectServer({ projectRoot, port: 0 });
}, 60_000);

afterAll(async () => {
  await handle?.close();
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

describe('Atlas 3D — shell toggle + renderer', () => {
  it('shell exposes a 2D/3D view toggle with 2D active by default', async () => {
    const body = await (await fetch(`${handle.url}/atlas`)).text();
    expect(body).toContain('atlas-mode-2d');
    expect(body).toContain('atlas-mode-3d');
    // 2D is the default-active control.
    expect(body).toMatch(/id="atlas-mode-2d"[^>]*class="[^"]*atlas-mode-active/);
    // 3D is NOT active by default.
    expect(body).not.toMatch(/id="atlas-mode-3d"[^>]*class="[^"]*atlas-mode-active/);
  });

  it('app.js carries both 2D and 3D code paths, same-origin, no eval/remote', async () => {
    const js = await (await fetch(`${handle.url}/atlas/app.js`)).text();
    // 2D context still used (3D projects onto the same canvas).
    expect(js).toContain("getContext('2d')");
    // 3D markers: a perspective projection + camera + 3D layout.
    expect(js).toContain('project3');
    expect(js).toContain('layout3d');
    expect(js).toContain('cam');
    // Mode switch exists.
    expect(js).toContain('setMode');
    // Safety invariants unchanged.
    expect(js).toContain("fetch('/atlas/graph.json'");
    expect(js).not.toMatch(/\beval\s*\(/);
    expect(js).not.toMatch(/new\s+Function\s*\(/);
    expect(js).not.toMatch(/https?:\/\//);
    expect(js).not.toContain('.innerHTML');
    // No WebGL/three.js dependency was smuggled in.
    expect(js).not.toContain("getContext('webgl");
    expect(js.toLowerCase()).not.toContain('three.js');
  });

  it('app.css styles the active mode button', async () => {
    const css = await (await fetch(`${handle.url}/atlas/app.css`)).text();
    expect(css).toContain('.atlas-mode-active');
    expect(css).not.toMatch(/url\(\s*["']?https?:/i);
  });
});

describe('Atlas 3D — contract + CSP unchanged', () => {
  it('CSP on /atlas* is still exactly the Atlas policy', async () => {
    for (const path of ['/atlas', '/atlas/graph.json', '/atlas/app.js', '/atlas/app.css']) {
      expect(
        (await fetch(`${handle.url}${path}`)).headers.get('content-security-policy'),
        path,
      ).toBe(ATLAS_CSP);
    }
  });

  it('rest of the inspect surface stays JS-free', async () => {
    for (const path of ['/', '/sessions', '/checkpoints']) {
      const csp =
        (await fetch(`${handle.url}${path}`)).headers.get('content-security-policy') ?? '';
      expect(csp, path).not.toContain("script-src 'self'");
    }
  });

  it('graph.json payload is unchanged (no new fields needed for 3D)', async () => {
    const g = (await (await fetch(`${handle.url}/atlas/graph.json`)).json()) as {
      schemaVersion: number;
      nodes: Array<Record<string, unknown>>;
    };
    expect(g.schemaVersion).toBe(1);
    if (g.nodes.length > 0) {
      // 3D reuses the same node fields — no z/coordinate fields are added
      // server-side (layout is computed in the browser).
      const n = g.nodes[0]!;
      expect(n).not.toHaveProperty('z');
      expect(n).not.toHaveProperty('x');
      expect(n).not.toHaveProperty('y');
      expect(n).toHaveProperty('salience');
    }
  });
});
