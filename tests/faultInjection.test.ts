import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStorageAdapter } from '../src/storage/fileStorageAdapter.js';
import { FaultInjector, FaultInjectingAdapter } from '../src/storage/faultAdapter.js';

/**
 * v0.9.2 — failure-injection contract (ADR-0013). Asserts that the
 * FaultInjector triggers errors deterministically and that the wrapper
 * delegates correctly when no rule matches.
 */
describe('FaultInjector', () => {
  it('fires once on the configured method', () => {
    const fi = new FaultInjector().failOn('appendEvent');
    expect(fi.shouldFail('appendEvent')).toBeInstanceOf(Error);
    // One-shot by default: subsequent calls succeed.
    expect(fi.shouldFail('appendEvent')).toBeUndefined();
  });

  it('honours afterN and repeating', () => {
    const fi = new FaultInjector().failOn('readEvents', {
      afterN: 2,
      repeating: true,
      error: new Error('EIO'),
    });
    expect(fi.shouldFail('readEvents')).toBeUndefined();
    expect(fi.shouldFail('readEvents')?.message).toBe('EIO');
    expect(fi.shouldFail('readEvents')?.message).toBe('EIO');
  });

  it('does not affect unconfigured methods', () => {
    const fi = new FaultInjector().failOn('appendEvent');
    expect(fi.shouldFail('saveCheckpoint')).toBeUndefined();
    expect(fi.shouldFail('readEvents')).toBeUndefined();
  });
});

describe('FaultInjectingAdapter', () => {
  it('throws when the injector fires; delegates otherwise', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairo-fault-'));
    try {
      const real = new FileStorageAdapter(root);
      await real.init();
      const fi = new FaultInjector().failOn('appendEvent', { error: new Error('disk full') });
      const adapter = new FaultInjectingAdapter(real, fi);

      const evt = {
        schema: 1 as const,
        id: '01',
        ts: '2026-05-21T00:00:00.000Z',
        sessionId: 's1',
        type: 'heartbeat' as const,
        payload: {},
      };
      await expect(adapter.appendEvent(evt)).rejects.toThrow('disk full');
      // Second call: no rule fires → delegates to the real adapter.
      await adapter.appendEvent(evt);
      const events = await adapter.readEvents();
      expect(events.length).toBe(1);
      expect(events[0]?.id).toBe('01');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('readEvents failure is surfaced to the caller', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairo-fault-'));
    try {
      const real = new FileStorageAdapter(root);
      await real.init();
      const fi = new FaultInjector().failOn('readEvents');
      const adapter = new FaultInjectingAdapter(real, fi);
      await expect(adapter.readEvents()).rejects.toThrow(/simulated failure in readEvents/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('is constructible and forwards calls when no rule matches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairo-fault-'));
    try {
      const real = new FileStorageAdapter(root);
      const adapter = new FaultInjectingAdapter(real, new FaultInjector());
      await adapter.init(); // delegates without throwing
      expect(adapter).toBeInstanceOf(FaultInjectingAdapter);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
