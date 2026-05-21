/**
 * CLI output helpers (v1.1.0, ADR-0016).
 *
 * Zero dependencies. TTY-aware ANSI. No emojis. Quiet by default.
 * Deterministic JSON mode for machine consumers.
 */

export interface OutputOptions {
  json: boolean;
  quiet: boolean;
  verbose: boolean;
  noColor: boolean;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export class Output {
  constructor(private readonly opts: OutputOptions) {}

  get json(): boolean {
    return this.opts.json;
  }
  get quiet(): boolean {
    return this.opts.quiet;
  }
  get verbose(): boolean {
    return this.opts.verbose;
  }

  /** Should ANSI colour be emitted? */
  private get colorOn(): boolean {
    if (this.opts.noColor || this.opts.json) return false;
    return Boolean((this.opts.stdout as { isTTY?: boolean }).isTTY);
  }

  // ── colour primitives (only used when colorOn) ────────────────────────

  private wrap(code: number, s: string): string {
    return this.colorOn ? `[${code}m${s}[0m` : s;
  }
  dim(s: string): string {
    return this.wrap(2, s);
  }
  bold(s: string): string {
    return this.wrap(1, s);
  }
  cyan(s: string): string {
    return this.wrap(36, s);
  }
  green(s: string): string {
    return this.wrap(32, s);
  }
  yellow(s: string): string {
    return this.wrap(33, s);
  }
  red(s: string): string {
    return this.wrap(31, s);
  }

  // ── line emission ─────────────────────────────────────────────────────

  /** Always emit, regardless of --quiet. */
  write(s: string): void {
    this.opts.stdout.write(s);
  }
  line(s = ''): void {
    this.opts.stdout.write(`${s}\n`);
  }

  /** Suppressed by --quiet. Use for headers, hints, context. */
  info(s: string): void {
    if (this.opts.quiet || this.opts.json) return;
    this.opts.stdout.write(`${s}\n`);
  }

  /** Emit when --verbose, otherwise drop. */
  detail(s: string): void {
    if (!this.opts.verbose || this.opts.json) return;
    this.opts.stdout.write(`${this.dim(s)}\n`);
  }

  /** Always to stderr; never suppressed. */
  error(s: string): void {
    this.opts.stderr.write(`${this.red('error:')} ${s}\n`);
  }

  /** Warnings to stderr; suppressed by --quiet. */
  warn(s: string): void {
    if (this.opts.quiet || this.opts.json) return;
    this.opts.stderr.write(`${this.yellow('warn:')} ${s}\n`);
  }

  // ── structured emission ───────────────────────────────────────────────

  /**
   * Emit a JSON document and return — caller should exit. Keys sorted
   * deterministically at every level.
   */
  emitJson(value: unknown): void {
    this.opts.stdout.write(JSON.stringify(canonical(value), null, 2));
    this.opts.stdout.write('\n');
  }

  /** JSON error envelope. Stable shape from v1.1.0 onwards. */
  emitJsonError(code: string, message: string): void {
    this.emitJson({ error: { code, message } });
  }

  /**
   * If `--json`, emit the JSON value and return true (caller stops).
   * Otherwise return false — caller renders human output.
   */
  maybeJson(value: unknown): boolean {
    if (!this.opts.json) return false;
    this.emitJson(value);
    return true;
  }

  /**
   * Render a key/value section. Skipped under --quiet.
   */
  kv(rows: Array<[string, string]>, opts: { keyWidth?: number } = {}): void {
    if (this.opts.quiet || this.opts.json) return;
    const w = opts.keyWidth ?? Math.max(...rows.map(([k]) => k.length));
    for (const [k, v] of rows) {
      this.opts.stdout.write(`  ${this.dim((k + ':').padEnd(w + 2))} ${v}\n`);
    }
  }

  /**
   * Render a table. Header row dimmed; cell strings as-is (caller colours
   * individual cells if needed).
   */
  table(header: string[], rows: string[][]): void {
    if (this.opts.json || rows.length === 0) {
      if (rows.length === 0 && !this.opts.quiet && !this.opts.json) {
        this.opts.stdout.write(`  ${this.dim('(none)')}\n`);
      }
      return;
    }
    const widths = header.map((h, i) =>
      Math.max(visibleWidth(h), ...rows.map((r) => visibleWidth(r[i] ?? ''))),
    );
    const fmtRow = (cells: string[]): string =>
      '  ' + cells.map((c, i) => padRight(c ?? '', widths[i] ?? 0)).join('  ');
    this.opts.stdout.write(`${this.dim(fmtRow(header))}\n`);
    for (const row of rows) {
      this.opts.stdout.write(`${fmtRow(row)}\n`);
    }
  }

  /** Print a single-line "Next step" hint. Suppressed by --quiet. */
  hint(s: string): void {
    if (this.opts.quiet || this.opts.json) return;
    this.opts.stdout.write(`\n${this.dim('next:')} ${s}\n`);
  }

  /** Section heading. */
  heading(s: string): void {
    if (this.opts.quiet || this.opts.json) return;
    this.opts.stdout.write(`\n${this.cyan(s)}\n`);
  }
}

/** Strip ANSI escape codes for width calculation. */
function visibleWidth(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[[0-9;]*m/g, '').length;
}

function padRight(s: string, width: number): string {
  const w = visibleWidth(s);
  return w >= width ? s : s + ' '.repeat(width - w);
}

/** Sort object keys at every level for deterministic JSON output. */
function canonical(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(canonical);
  const obj: Record<string, unknown> = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = canonical(obj[k]);
  return out;
}
