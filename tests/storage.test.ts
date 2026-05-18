import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStorageAdapter } from '../src/storage/fileStorageAdapter.js';
import { withRedaction } from '../src/storage/redactingAdapter.js';
import { fixedClock } from '../src/utils/time.js';
import { EVENT_SCHEMA_VERSION, type KairoEvent } from '../src/types/events.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kairo-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function evt(type: KairoEvent['type'], payload: unknown, id: string): KairoEvent {
  return {
    schema: EVENT_SCHEMA_VERSION,
    id,
    ts: '2026-05-18T00:00:00.000Z',
    sessionId: 's1',
    type,
    payload,
  };
}

describe('FileStorageAdapter (event-sourced)', () => {
  it('appends and reads back events in order', async () => {
    const a = new FileStorageAdapter(root);
    await a.init();
    await a.appendEvent(evt('note.recorded', { note: 'one' }, 'A'));
    await a.appendEvent(evt('note.recorded', { note: 'two' }, 'B'));
    const events = await a.readEvents();
    expect(events.map((e) => e.id)).toEqual(['A', 'B']);
  });

  it('tolerates a torn trailing log line without losing prior history', async () => {
    const a = new FileStorageAdapter(root);
    await a.init();
    await a.appendEvent(evt('note.recorded', { note: 'good' }, 'A'));
    // Simulate a crash mid-append by writing a partial JSON line.
    const { appendFile } = await import('node:fs/promises');
    await appendFile(join(root, '.kairo', 'events.jsonl'), '{"schema":1,"id":"B"', 'utf8');
    const events = await a.readEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe('A');
  });

  it('round-trips checkpoints and continuations and finds the latest', async () => {
    const a = new FileStorageAdapter(root);
    await a.init();
    await a.saveContinuation('001.md', '# first');
    await a.saveContinuation('002.md', '# second');
    expect(await a.loadLatestContinuation()).toBe('# second');
  });
});

describe('redaction boundary', () => {
  it('sanitizes event payloads before they reach disk and writes an audit record', async () => {
    const inner = new FileStorageAdapter(root);
    const a = withRedaction(inner, fixedClock(0));
    await a.init();
    await a.appendEvent(evt('note.recorded', { note: `token ghp_${'a'.repeat(36)}` }, 'A'));

    const onDisk = await readFile(join(root, '.kairo', 'events.jsonl'), 'utf8');
    expect(onDisk).not.toContain('ghp_aaaa');
    expect(onDisk).toContain('«REDACTED:GITHUB_TOKEN»');

    const audit = await readFile(join(root, '.kairo', 'audit.jsonl'), 'utf8');
    expect(audit).toContain('redaction');
    expect(audit).toContain('GITHUB_TOKEN');
    expect(audit).not.toContain('ghp_aaaa');
  });
});
