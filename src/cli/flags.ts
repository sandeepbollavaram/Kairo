/**
 * Tiny zero-dependency flag parser for the `kairo` CLI (v1.1.0, ADR-0016).
 *
 * Supports:
 *   --flag, -f             boolean
 *   --flag value, -f value space-separated value
 *   --flag=value           inline value
 *   --no-flag              negates a boolean
 *   --                     end-of-options sentinel
 *
 * Returns { values, positional }. Caller validates required args.
 */

export interface FlagSpec {
  /** Long name (without leading --). */
  name: string;
  /** Short alias (single letter, without leading -). */
  short?: string;
  /** Value type. */
  type: 'boolean' | 'string' | 'number';
  /** Default value when not present. */
  default?: string | number | boolean;
  /** Help line. */
  help: string;
}

export interface ParseResult {
  values: Record<string, string | number | boolean>;
  positional: string[];
}

export function parse(argv: string[], specs: FlagSpec[]): ParseResult {
  const byLong = new Map<string, FlagSpec>();
  const byShort = new Map<string, FlagSpec>();
  for (const s of specs) {
    byLong.set(s.name, s);
    if (s.short) byShort.set(s.short, s);
  }

  const values: Record<string, string | number | boolean> = {};
  for (const s of specs) {
    if (s.default !== undefined) values[s.name] = s.default;
    else if (s.type === 'boolean') values[s.name] = false;
  }

  const positional: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i] ?? '';
    if (a === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--no-')) {
      const name = a.slice(5);
      const spec = byLong.get(name);
      if (!spec) throw new Error(`Unknown flag: --${name}`);
      if (spec.type !== 'boolean') throw new Error(`--no-${name} is not a boolean flag`);
      values[name] = false;
      i++;
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
      const inline = eq === -1 ? undefined : a.slice(eq + 1);
      const spec = byLong.get(name);
      if (!spec) throw new Error(`Unknown flag: --${name}`);
      if (spec.type === 'boolean') {
        values[name] = inline === undefined ? true : inline !== 'false';
        i++;
      } else {
        const v = inline ?? argv[i + 1];
        if (v === undefined) throw new Error(`Missing value for --${name}`);
        values[name] = spec.type === 'number' ? Number(v) : v;
        i += inline === undefined ? 2 : 1;
      }
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      const short = a.slice(1);
      const spec = byShort.get(short);
      if (!spec) throw new Error(`Unknown flag: -${short}`);
      if (spec.type === 'boolean') {
        values[spec.name] = true;
        i++;
      } else {
        const v = argv[i + 1];
        if (v === undefined) throw new Error(`Missing value for -${short}`);
        values[spec.name] = spec.type === 'number' ? Number(v) : v;
        i += 2;
      }
      continue;
    }
    positional.push(a);
    i++;
  }

  return { values, positional };
}
