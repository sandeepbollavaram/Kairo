# SDK

> Small, local, dependency-light client for reading `.kairo/` (ADR-0015).

## When to use the SDK vs MCP

- **MCP** (`kairo-mcp` binary, stdio): for AI agents and the MCP host. The
  wire protocol carries every interaction.
- **SDK** (`kairo-mcp/sdk`): for **local code in the same process** — build
  scripts, CI checks, editor extensions, test harnesses. Reads `.kairo/`
  directly via the same projections the web inspector renders.

The SDK is **read-only**. Any mutation (start a session, checkpoint, lease,
refresh memory) still goes through the MCP tool layer.

## Install

```bash
npm install kairo-mcp
```

```ts
import { KairoClient } from 'kairo-mcp/sdk';
```

## Quick start

```ts
const k = new KairoClient({ projectRoot: '/abs/path/to/repo' });

const overview = await k.overview();
console.log(`Events: ${overview.eventCount}, sessions: ${overview.sessionCount}`);

for (const s of await k.sessions()) {
  console.log(s.id, s.status, s.task);
}

const latest = await k.latestCheckpoint();
if (latest) {
  const brief = await k.brief(latest.continuationRef);
  console.log(brief);
}
```

## API

```ts
class KairoClient {
  constructor(opts?: { projectRoot?: string });
  static version(): string;
  hasKairo(): boolean;

  // Inspect projections (read-only)
  overview(): Promise<InspectOverview>;
  sessions(): Promise<SessionListEntry[]>;
  session(id: string): Promise<SessionState | undefined>;
  checkpoints(): Promise<CheckpointListEntry[]>;
  checkpoint(id: string): Promise<Checkpoint | undefined>;
  latestCheckpoint(): Promise<Checkpoint | undefined>;
  graphs(): Promise<string[]>;
  graph(kind: string): Promise<GraphSummary | undefined>;
  memoryIndex(): Promise<MemoryIndexSnapshot | undefined>;
  coordination(): Promise<CoordinationSnapshot>;
  risk(): Promise<RiskSnapshot>;
  brief(name: string): Promise<string | undefined>;
  latestBrief(): Promise<string | undefined>;

  // Reports
  readReport(name: string): Promise<string | undefined>;

  // Snapshot validation (does NOT import)
  validateSnapshot(path: string): Promise<{ manifest; warnings }>;

  // Stability registry
  stabilityOf(id: string): StabilityEntry | undefined;
  byTier(tier: StabilityTier): StabilityEntry[];
  stabilityRegistry(): readonly StabilityEntry[];

  // Plugins (manifest-only)
  plugins(): Promise<LoadedPlugin[]>;
}
```

## Examples

### CI: assert a stable surface still resolves

```ts
import { KairoClient } from 'kairo-mcp/sdk';
const k = new KairoClient();
for (const id of ['kairo_session_start', 'kairo_checkpoint', 'kairo_brief']) {
  if (k.stabilityOf(id)?.tier !== 'stable') {
    throw new Error(`${id} is no longer stable`);
  }
}
```

### Validate a snapshot before sharing it

```ts
const { manifest, warnings } = await k.validateSnapshot('./snapshot.json');
if (warnings.length > 0) console.warn(warnings);
console.log(`${manifest.counts.events} events, sha256=${manifest.contentSha256}`);
```

### Read the latest continuation brief

```ts
const brief = await k.latestBrief();
if (brief) process.stdout.write(brief);
```

## Honest scope

- **Local-first.** The SDK does NOT speak the MCP wire protocol. It opens
  files in `.kairo/`. If you need remote access, run `kairo-mcp` and talk
  to it over its transport.
- **Read-only.** No write methods exist. Mutations stay in MCP.
- **Dependency-light.** Pulls in `zod` (already a Kairo dep). Nothing else.
- **Schema-aware.** Reads pass through the v0.9.1 migration + quarantine
  path, so the SDK sees the same data the MCP server sees.
