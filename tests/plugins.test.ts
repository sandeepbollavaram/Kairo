import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkCompatibility, loadPlugins, ManifestZ } from '../src/plugins/loader.js';

/**
 * v0.9.4 — plugin manifest contract (ADR-0015). Plugins are
 * declarations; no code is loaded or executed.
 */
describe('manifest validation', () => {
  it('accepts a minimal valid manifest', () => {
    const ok = ManifestZ.safeParse({
      apiVersion: 'kairo.plugin/1',
      name: 'demo',
      version: '0.1.0',
      description: 'A demo plugin',
      capabilities: ['read-events'],
      kairoCompatibility: '^0.9',
    });
    expect(ok.success).toBe(true);
  });

  it('rejects an unknown apiVersion', () => {
    const r = ManifestZ.safeParse({
      apiVersion: 'kairo.plugin/2',
      name: 'demo',
      version: '0.1.0',
      description: 'x',
      capabilities: [],
      kairoCompatibility: '*',
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown capabilities', () => {
    const r = ManifestZ.safeParse({
      apiVersion: 'kairo.plugin/1',
      name: 'demo',
      version: '0.1.0',
      description: 'x',
      capabilities: ['arbitrary-code-execution'],
      kairoCompatibility: '*',
    });
    expect(r.success).toBe(false);
  });
});

describe('checkCompatibility', () => {
  it('caret-pins minor for 0.x', () => {
    expect(checkCompatibility('^0.9', '0.9.4')).toBe(true);
    expect(checkCompatibility('^0.9', '0.9.0')).toBe(true);
    expect(checkCompatibility('^0.9', '0.10.0')).toBe(false);
    expect(checkCompatibility('^0.9', '1.0.0')).toBe(false);
  });

  it('caret-pins major for 1.x+', () => {
    expect(checkCompatibility('^1', '1.0.0')).toBe(true);
    expect(checkCompatibility('^1', '1.4.2')).toBe(true);
    expect(checkCompatibility('^1', '2.0.0')).toBe(false);
  });

  it('honours disjunctions', () => {
    expect(checkCompatibility('^0.9 || ^1', '0.9.4')).toBe(true);
    expect(checkCompatibility('^0.9 || ^1', '1.2.3')).toBe(true);
    expect(checkCompatibility('^0.9 || ^1', '0.8.0')).toBe(false);
  });

  it('* matches anything', () => {
    expect(checkCompatibility('*', '0.0.1')).toBe(true);
    expect(checkCompatibility('*', '99.99.99')).toBe(true);
  });
});

describe('loadPlugins', () => {
  it('reads .kairo/plugins/*.json and validates each one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairo-plug-'));
    try {
      const dir = join(root, '.kairo', 'plugins');
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'good.json'),
        JSON.stringify({
          apiVersion: 'kairo.plugin/1',
          name: 'good-plugin',
          version: '0.1.0',
          description: 'ok',
          capabilities: ['read-events'],
          kairoCompatibility: '^0.9',
        }),
      );
      await writeFile(
        join(dir, 'bad.json'),
        JSON.stringify({
          apiVersion: 'kairo.plugin/1',
          name: 'bad-plugin',
          // missing required fields
        }),
      );
      const plugins = await loadPlugins(root);
      expect(plugins.length).toBe(2);
      const good = plugins.find((p) => p.manifest.name === 'good-plugin');
      const bad = plugins.find((p) => p.manifestPath.endsWith('bad.json'));
      expect(good?.compatible).toBe(true);
      expect(bad?.warning).toMatch(/Schema validation failed/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('marks incompatible kairo versions but still returns the manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairo-plug-'));
    try {
      const dir = join(root, '.kairo', 'plugins');
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'future.json'),
        JSON.stringify({
          apiVersion: 'kairo.plugin/1',
          name: 'future-plugin',
          version: '0.1.0',
          description: 'targets v2',
          capabilities: ['read-events'],
          kairoCompatibility: '^2',
        }),
      );
      const plugins = await loadPlugins(root);
      expect(plugins[0]?.compatible).toBe(false);
      expect(plugins[0]?.warning).toMatch(/targets/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns empty when no plugins directory exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairo-plug-'));
    try {
      const plugins = await loadPlugins(root);
      expect(plugins).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
