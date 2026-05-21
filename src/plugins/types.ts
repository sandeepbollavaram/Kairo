/**
 * Plugin manifest contract (v0.9.4, ADR-0015).
 *
 * **Manifest-only.** Kairo does NOT load or execute plugin code in-process.
 * A plugin declares itself, its capabilities, and (optionally) an external
 * MCP server config that the host (Claude Desktop, Cursor, the IDE) can
 * wire up. The host runs it, not Kairo.
 */

export type PluginCapability =
  | 'read-events'
  | 'read-checkpoints'
  | 'read-telemetry'
  | 'render-reports'
  | 'extend-inspect'
  | 'embedder-provider';

export interface PluginMcpServerSpec {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface KairoPluginManifest {
  apiVersion: 'kairo.plugin/1';
  name: string;
  version: string;
  description: string;
  /** Coarse-grained UI/discovery hints — declarations, not enforcement. */
  capabilities: PluginCapability[];
  /** Semver range of Kairo this plugin targets, e.g. "^0.9 || ^1". */
  kairoCompatibility: string;
  /** Optional external MCP server config; the HOST loads it, not Kairo. */
  mcpServer?: PluginMcpServerSpec;
  homepage?: string;
  author?: string;
}

export interface LoadedPlugin {
  manifest: KairoPluginManifest;
  /** Absolute path to the manifest file on disk. */
  manifestPath: string;
  /** True if `kairoCompatibility` matches the running build. */
  compatible: boolean;
  /** Reason a plugin was rejected, if any. */
  warning?: string;
}
