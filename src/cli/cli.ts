#!/usr/bin/env node
/**
 * Kairo CLI entry point (v1.1.0, ADR-0016).
 */
import { resolve as resolvePath } from 'node:path';
import { Output } from './output.js';
import { parse, type FlagSpec } from './flags.js';
import { COMMANDS, findCommand } from './commands.js';
import { SERVER_VERSION } from '../server/createServer.js';
import { resolveProjectRoot } from '../storage/paths.js';
import type { CommandSpec } from './types.js';

const GLOBAL_FLAGS: FlagSpec[] = [
  { name: 'json', type: 'boolean', help: 'Machine-readable JSON output.' },
  { name: 'quiet', short: 'q', type: 'boolean', help: 'Suppress non-essential output.' },
  { name: 'verbose', short: 'v', type: 'boolean', help: 'Print extra detail.' },
  { name: 'no-color', type: 'boolean', help: 'Disable ANSI colour.' },
  { name: 'project', short: 'C', type: 'string', help: 'Project root (default: cwd).' },
  { name: 'help', short: 'h', type: 'boolean', help: 'Show help.' },
  { name: 'version', short: 'V', type: 'boolean', help: 'Print version and exit.' },
];

async function main(rawArgv: string[]): Promise<number> {
  // Split global flags from the subcommand. We do a first pass that stops at
  // the first positional (the subcommand name) so per-command flags pass
  // through untouched.
  const [globalArgs, subArgs] = splitAtSubcommand(rawArgv);

  let globals: ReturnType<typeof parse>['values'];
  try {
    globals = parse(globalArgs, GLOBAL_FLAGS).values;
  } catch (e) {
    process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }

  const out = new Output({
    json: Boolean(globals.json),
    quiet: Boolean(globals.quiet),
    verbose: Boolean(globals.verbose),
    noColor: Boolean(globals['no-color']) || process.env.NO_COLOR !== undefined,
    stdout: process.stdout,
    stderr: process.stderr,
  });

  if (globals.version) {
    if (out.maybeJson({ version: SERVER_VERSION })) return 0;
    out.line(SERVER_VERSION);
    return 0;
  }

  const [name, ...rest] = subArgs;

  if (!name || globals.help) {
    if (name && globals.help) {
      const cmd = findCommand(name);
      if (cmd) {
        renderCommandHelp(out, cmd);
        return 0;
      }
    }
    renderTopLevelHelp(out);
    return name ? 0 : 0;
  }

  if (name === 'help') {
    const target = rest[0];
    if (target) {
      const cmd = findCommand(target);
      if (!cmd) {
        out.error(`No such command: ${target}`);
        return 2;
      }
      renderCommandHelp(out, cmd);
      return 0;
    }
    renderTopLevelHelp(out);
    return 0;
  }

  const cmd = findCommand(name);
  if (!cmd) {
    out.error(`Unknown command: ${name}`);
    out.info(`Run \`kairo help\` for the command list.`);
    return 2;
  }

  // Per-command --help short-circuit.
  if (rest.includes('--help') || rest.includes('-h')) {
    renderCommandHelp(out, cmd);
    return 0;
  }

  const projectRoot = resolvePath(
    typeof globals.project === 'string' ? globals.project : resolveProjectRoot(),
  );

  try {
    const result = await cmd.run({ projectRoot, out, argv: rest });
    return result.exitCode;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (out.json) {
      out.emitJsonError('UNEXPECTED', msg);
    } else {
      out.error(msg);
      if (out.verbose && e instanceof Error && e.stack) {
        out.detail(e.stack);
      }
    }
    return 1;
  }
}

/**
 * Pull every global flag out of the argv stream regardless of position, then
 * return [globalArgs, subArgs]. Mirrors git/docker — `kairo doctor --json`
 * works the same as `kairo --json doctor`.
 */
function splitAtSubcommand(argv: string[]): [string[], string[]] {
  const globalNames = new Set([
    ...GLOBAL_FLAGS.map((f) => `--${f.name}`),
    ...GLOBAL_FLAGS.filter((f) => f.short).map((f) => `-${f.short!}`),
    ...GLOBAL_FLAGS.map((f) => `--no-${f.name}`),
  ]);
  const before: string[] = [];
  const after: string[] = [];
  let i = 0;
  let sawDoubleDash = false;
  while (i < argv.length) {
    const a = argv[i]!;
    if (sawDoubleDash) {
      after.push(a);
      i++;
      continue;
    }
    if (a === '--') {
      // From here on, everything is positional/subcommand args.
      sawDoubleDash = true;
      i++;
      continue;
    }
    if (a.startsWith('-')) {
      const eq = a.indexOf('=');
      const key = eq === -1 ? a : a.slice(0, eq);
      const naked = key.startsWith('--no-') ? `--${key.slice(5)}` : key;
      if (globalNames.has(naked) || globalNames.has(key)) {
        before.push(a);
        const long = naked.startsWith('--') ? naked.slice(2) : undefined;
        const shortChar =
          naked.length === 2 && !naked.startsWith('--') ? naked.slice(1) : undefined;
        const spec = GLOBAL_FLAGS.find(
          (f) => f.name === long || (shortChar !== undefined && f.short === shortChar),
        );
        if (spec && spec.type !== 'boolean' && eq === -1) {
          if (argv[i + 1] !== undefined) {
            before.push(argv[i + 1]!);
            i += 2;
            continue;
          }
        }
        i++;
        continue;
      }
      // Subcommand-local flag — keep it in subArgs.
      after.push(a);
      i++;
      continue;
    }
    after.push(a);
    i++;
  }
  return [before, after];
}

function renderTopLevelHelp(out: Output): void {
  if (out.maybeJson({ commands: COMMANDS.map((c) => ({ name: c.name, summary: c.summary })) })) {
    return;
  }
  out.line(`${out.bold('kairo')} ${out.dim(`v${SERVER_VERSION}`)}`);
  out.line();
  out.line('Persistent engineering memory and session continuity for AI coding agents.');
  out.line(out.dim('Local-first · deterministic · replay-safe.'));
  out.line();
  // 60-second quick start, dim so it's scannable but not loud.
  out.line(out.bold('Quick start'));
  out.line(`  ${out.dim('$')} cd your-project`);
  out.line(`  ${out.dim('$')} kairo init           ${out.dim('# wire .mcp.json + .gitignore')}`);
  out.line(`  ${out.dim('$')} kairo doctor         ${out.dim('# verify install')}`);
  out.line(`  ${out.dim('$')} kairo status         ${out.dim('# once an agent has run')}`);
  out.line();
  out.line(out.bold('Usage'));
  out.line('  kairo [--json] [--quiet] [--verbose] [--no-color] [-C PATH] <command> [args]');
  out.line();
  out.line(out.bold('Commands'));
  for (const c of COMMANDS) {
    out.line(`  ${c.name.padEnd(14)} ${out.dim(c.summary)}`);
  }
  out.line();
  out.line(out.bold('Global flags'));
  for (const f of GLOBAL_FLAGS) {
    const tag = f.short ? `--${f.name}, -${f.short}` : `--${f.name}`;
    out.line(`  ${tag.padEnd(20)} ${out.dim(f.help)}`);
  }
  out.line();
  out.line(
    `Run ${out.cyan('kairo help <command>')} for detail, or ${out.cyan('kairo doctor')} if something looks off.`,
  );
}

function renderCommandHelp(out: Output, cmd: CommandSpec): void {
  if (
    out.maybeJson({
      name: cmd.name,
      summary: cmd.summary,
      help: cmd.help,
      examples: cmd.examples ?? [],
    })
  ) {
    return;
  }
  const argsStr = cmd.args ? ` ${cmd.args}` : '';
  out.line(`${out.bold('kairo ' + cmd.name)}${out.dim(argsStr)}`);
  out.line();
  out.line(cmd.summary);
  out.line();
  out.line(cmd.help);
  if (cmd.flags && cmd.flags.length > 0) {
    out.line();
    out.line(out.bold('Flags'));
    for (const f of cmd.flags) {
      const tag = f.short ? `--${f.name}, -${f.short}` : `--${f.name}`;
      out.line(`  ${tag.padEnd(20)} ${out.dim(f.help)}`);
    }
  }
  if (cmd.examples && cmd.examples.length > 0) {
    out.line();
    out.line(out.bold('Examples'));
    for (const ex of cmd.examples) out.line(`  ${out.dim('$')} ${ex}`);
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    process.stderr.write(`unhandled: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  },
);
