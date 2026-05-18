import { SECRET_PATTERNS } from './patterns.js';

export interface RedactionResult<T> {
  value: T;
  /** secret type → number of occurrences removed. Never contains values. */
  findings: Record<string, number>;
  get redacted(): boolean;
}

/**
 * The redaction boundary. Recursively walks any JSON-serializable value and replaces
 * detected secrets in every string. Object *keys* are preserved (they carry structure,
 * not secrets); only string *values* and array elements are scanned.
 *
 * This module is pure. It is wired in at the storage-adapter seam
 * (see storage/redactingAdapter.ts) so no engine can write un-sanitized data.
 */
export function redactString(input: string): { value: string; findings: Record<string, number> } {
  let value = input;
  const findings: Record<string, number> = {};
  for (const pattern of SECRET_PATTERNS) {
    // Fresh lastIndex each pass; patterns are global.
    pattern.regex.lastIndex = 0;
    value = value.replace(pattern.regex, (...args: string[]) => {
      findings[pattern.type] = (findings[pattern.type] ?? 0) + 1;
      const groups = args.slice(1, -2);
      return pattern.replace(args[0] as string, ...groups);
    });
  }
  return { value, findings };
}

export function sanitize<T>(input: T): RedactionResult<T> {
  const findings: Record<string, number> = {};

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      const r = redactString(node);
      mergeInto(findings, r.findings);
      return r.value;
    }
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (node !== null && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        out[k] = walk(v);
      }
      return out;
    }
    return node;
  };

  const value = walk(input) as T;
  return {
    value,
    findings,
    get redacted(): boolean {
      return Object.keys(findings).length > 0;
    },
  };
}

function mergeInto(target: Record<string, number>, source: Record<string, number>): void {
  for (const [k, v] of Object.entries(source)) {
    target[k] = (target[k] ?? 0) + v;
  }
}
