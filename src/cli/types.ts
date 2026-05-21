/**
 * CLI command framework (v1.1.0, ADR-0016).
 */
import type { Output } from './output.js';
import type { FlagSpec } from './flags.js';

export interface CommandContext {
  /** Project root after `--project` resolution. */
  projectRoot: string;
  out: Output;
  argv: string[];
}

export interface CommandResult {
  /** Process exit code. 0 = ok. */
  exitCode: number;
}

export interface CommandSpec {
  /** Subcommand name (e.g. "status"). */
  name: string;
  /** Optional aliases. */
  aliases?: string[];
  /** One-line summary for `kairo help`. */
  summary: string;
  /** Per-command flag specs (additional to globals). */
  flags?: FlagSpec[];
  /** Positional args descriptor for help text. */
  args?: string;
  /** Multi-line help body (paragraphs separated by blank lines). */
  help: string;
  /** Concrete usage examples. */
  examples?: string[];
  /** Execute. */
  run(ctx: CommandContext): Promise<CommandResult>;
}
