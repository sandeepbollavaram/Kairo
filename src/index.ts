#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { FileStorageAdapter } from './storage/fileStorageAdapter.js';
import { withRedaction } from './storage/redactingAdapter.js';
import { SessionManager } from './core/session/sessionManager.js';
import { createServer, SERVER_VERSION } from './server/createServer.js';
import { resolveProjectRoot } from './storage/paths.js';
import { systemClock } from './utils/time.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  const projectRoot = resolveProjectRoot();
  const adapter = withRedaction(new FileStorageAdapter(projectRoot), systemClock);
  const sessions = new SessionManager(adapter, systemClock);
  await sessions.init();

  const server = createServer(sessions);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info(`Kairo v${SERVER_VERSION} ready (stdio)`, { projectRoot });

  const shutdown = (signal: string): void => {
    logger.info(`Received ${signal}, shutting down`);
    void server.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  logger.error('Fatal startup error', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
