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
 * v1.5.0 PR 7 — Atlas search + filters tests (ADR-0019).
 *
 * Search and filtering are browser-side over the SAME /atlas/graph.json
 * payload. These tests assert the shell exposes the search box + filter chips,
 * the renderer carries the search/filter code paths and the `/` shortcut, and
 * the server contract (payload, CSP) is unchanged.
 */
let projectRoot: string;
let handle: InspectServerHandle;

beforeAll(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), 'kairo-atlas-sf-'));
  await writeFile(
    join(projectRoot, 'package.json'),
    JSON.stringify({ name: 'atlas-sf', dependencies: { express: '^4.19.0' } }),
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
  await sessions.startSession({ agent: 'claude', task: 'atlas search', projectRoot });
  await sessions.record({ kind: 'file', path: 'src/core/log.ts', changeKind: 'modified' });
  await sessions.checkpoint({ reason: 'manual', completed: ['x'] });
  await sessions.endSession();

  handle = await startInspectServer({ projectRoot, port: 0 });
}, 60_000);

afterAll(async () => {
  await handle?.close();
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

describe('Atlas search + filters — shell', () => {
  it('shell exposes the search box and a results container', async () => {
    const body = await (await fetch(`${handle.url}/atlas`)).text();
    expect(body).toContain('atlas-search');
    expect(body).toContain('atlas-results');
    expect(body).toMatch(/type="search"/);
  });

  it('shell exposes the full set of filter chips', async () => {
    const body = await (await fetch(`${handle.url}/atlas`)).text();
    for (const f of [
      'source',
      'changed',
      'risk',
      'salience',
      'checkpoint',
      'session',
      'hideDocs',
      'hideTests',
      'hideExamples',
      'hideGenerated',
    ]) {
      expect(body, `missing filter chip ${f}`).toContain(`data-filter="${f}"`);
    }
  });
});

describe('Atlas search + filters — renderer', () => {
  it('app.js carries the search + filter + shortcut code paths', async () => {
    const js = await (await fetch(`${handle.url}/atlas/app.js`)).text();
    expect(js).toContain('recomputeMatches');
    expect(js).toContain('isVisible');
    expect(js).toContain('renderResults');
    expect(js).toContain('focusNode');
    // '/' keyboard shortcut + Escape clear.
    expect(js).toContain("ev.key === '/'");
    // filter chip wiring via data-filter.
    expect(js).toContain('data-filter');
    // Safety invariants unchanged.
    expect(js).toContain("fetch('/atlas/graph.json'");
    expect(js).not.toMatch(/\beval\s*\(/);
    expect(js).not.toMatch(/new\s+Function\s*\(/);
    expect(js).not.toMatch(/https?:\/\//);
    expect(js).not.toContain('.innerHTML');
  });

  it('app.css styles the search box (readable) + active chip', async () => {
    const css = await (await fetch(`${handle.url}/atlas/app.css`)).text();
    expect(css).toContain('.atlas-search');
    expect(css).toContain('.atlas-chip-active');
    expect(css).toContain('.atlas-results');
    // search input gets explicit theme colours (same dark-mode contrast fix).
    expect(css).toMatch(/\.atlas-search\s*\{[^}]*CanvasText/);
    expect(css).not.toMatch(/url\(\s*["']?https?:/i);
  });
});

describe('Atlas search + filters — contract unchanged', () => {
  it('CSP on /atlas* still equals the Atlas policy', async () => {
    for (const path of ['/atlas', '/atlas/graph.json', '/atlas/app.js', '/atlas/app.css']) {
      expect(
        (await fetch(`${handle.url}${path}`)).headers.get('content-security-policy'),
        path,
      ).toBe(ATLAS_CSP);
    }
  });

  it('graph.json payload is unchanged (search/filter are client-side)', async () => {
    const g = (await (await fetch(`${handle.url}/atlas/graph.json`)).json()) as {
      schemaVersion: number;
      nodes: Array<Record<string, unknown>>;
    };
    expect(g.schemaVersion).toBe(1);
    if (g.nodes.length > 0) {
      const n = g.nodes[0]!;
      // No server-side filter/query fields were added to the payload.
      expect(n).not.toHaveProperty('matched');
      expect(n).not.toHaveProperty('visible');
      expect(n).toHaveProperty('group');
      expect(n).toHaveProperty('flags');
    }
  });
});
