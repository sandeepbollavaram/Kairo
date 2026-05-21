import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { kairoPaths } from '../storage/paths.js';
import { SERVER_VERSION } from '../server/createServer.js';
import type { KairoPluginManifest, LoadedPlugin } from './types.js';
import { logger } from '../utils/logger.js';

/**
 * Plugin manifest loader (v0.9.4, ADR-0015). Reads
 * `.kairo/plugins/*.json` (or a single `.kairo/plugins.json` array),
 * validates with zod, performs a semver-range compatibility check, and
 * returns the manifests. NOTHING IS EVER EXECUTED IN-PROCESS.
 */

const CapabilityZ = z.enum([
  'read-events',
  'read-checkpoints',
  'read-telemetry',
  'render-reports',
  'extend-inspect',
  'embedder-provider',
]);

export const ManifestZ = z
  .object({
    apiVersion: z.literal('kairo.plugin/1'),
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string(),
    capabilities: z.array(CapabilityZ),
    kairoCompatibility: z.string().min(1),
    mcpServer: z
      .object({
        command: z.string().min(1),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
    homepage: z.string().optional(),
    author: z.string().optional(),
  })
  .passthrough();

export async function loadPlugins(projectRoot?: string): Promise<LoadedPlugin[]> {
  const paths = kairoPaths(projectRoot);
  const dir = join(paths.base, 'plugins');
  const indexFile = join(paths.base, 'plugins.json');
  const out: LoadedPlugin[] = [];

  // (a) Multi-file form: `.kairo/plugins/*.json`
  if (existsSync(dir)) {
    let files: string[] = [];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
    } catch {
      /* unreadable dir → skip */
    }
    for (const f of files) {
      const p = join(dir, f);
      out.push(await loadManifestFile(p));
    }
  }

  // (b) Single-file array form: `.kairo/plugins.json`
  if (existsSync(indexFile)) {
    try {
      const raw = JSON.parse(await readFile(indexFile, 'utf8')) as unknown;
      const arr = Array.isArray(raw) ? raw : [raw];
      for (let i = 0; i < arr.length; i++) {
        out.push(parseManifest(arr[i], `${indexFile}#${i}`));
      }
    } catch (e) {
      logger.warn(`Could not read ${indexFile}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return out;
}

async function loadManifestFile(path: string): Promise<LoadedPlugin> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return parseManifest(raw, path);
  } catch (e) {
    return {
      manifest: brokenManifest(path),
      manifestPath: path,
      compatible: false,
      warning: `Failed to parse: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function parseManifest(raw: unknown, source: string): LoadedPlugin {
  const result = ManifestZ.safeParse(raw);
  if (!result.success) {
    return {
      manifest: brokenManifest(source),
      manifestPath: source,
      compatible: false,
      warning:
        'Schema validation failed: ' +
        result.error.issues
          .slice(0, 3)
          .map((iss) => `${iss.path.join('.')}: ${iss.message}`)
          .join('; '),
    };
  }
  const manifest = result.data as KairoPluginManifest;
  const compatible = checkCompatibility(manifest.kairoCompatibility, SERVER_VERSION);
  const entry: LoadedPlugin = {
    manifest,
    manifestPath: source,
    compatible,
  };
  if (!compatible) {
    entry.warning = `Plugin targets ${manifest.kairoCompatibility}; running ${SERVER_VERSION}`;
  }
  return entry;
}

function brokenManifest(source: string): KairoPluginManifest {
  return {
    apiVersion: 'kairo.plugin/1',
    name: `broken:${source}`,
    version: '0.0.0',
    description: '(invalid manifest)',
    capabilities: [],
    kairoCompatibility: '*',
  };
}

/**
 * Tiny semver-range matcher — supports the forms we actually need for
 * plugin metadata: `1.2.3`, `^1.2`, `^0.9`, `>=0.9 <1`, `*`, and disjunctions
 * via `||`. Not a full semver implementation; the registry it serves is
 * a hint, not a security boundary.
 */
export function checkCompatibility(range: string, version: string): boolean {
  const parts = range
    .split('||')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (matchOne(part, version)) return true;
  }
  return false;
}

function matchOne(range: string, version: string): boolean {
  range = range.trim();
  if (range === '*') return true;
  if (range.startsWith('^')) {
    const target = parseSemver(range.slice(1).trim());
    const v = parseSemver(version);
    if (!target || !v) return false;
    // ^0.x.y means "compatible with 0.x" — minor pinned.
    if (target.major === 0) return v.major === 0 && v.minor === target.minor && cmp(v, target) >= 0;
    return v.major === target.major && cmp(v, target) >= 0;
  }
  if (range.startsWith('>=')) {
    const target = parseSemver(range.slice(2).trim());
    const v = parseSemver(version);
    return target && v ? cmp(v, target) >= 0 : false;
  }
  // Conjunction with a space → all must match.
  if (range.includes(' ')) {
    return range
      .split(/\s+/)
      .filter(Boolean)
      .every((sub) => matchOne(sub, version));
  }
  if (range.startsWith('<')) {
    const target = parseSemver(range.slice(1).trim());
    const v = parseSemver(version);
    return target && v ? cmp(v, target) < 0 : false;
  }
  // Exact match.
  return range === version;
}

interface Semver {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(s: string): Semver | undefined {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(s);
  if (!m) return undefined;
  return {
    major: Number(m[1]),
    minor: m[2] !== undefined ? Number(m[2]) : 0,
    patch: m[3] !== undefined ? Number(m[3]) : 0,
  };
}

function cmp(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}
