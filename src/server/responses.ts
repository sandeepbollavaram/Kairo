import type { PressureSnapshot } from '../types/domain.js';
import { directiveBanner } from '../pressure/pressureModel.js';
import { KairoError } from '../utils/errors.js';

export interface ToolText {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
  // The MCP SDK's CallToolResult carries an open index signature; mirror it so our
  // helper's return type is structurally assignable to the SDK handler return type.
  [key: string]: unknown;
}

/**
 * Standard tool response: a human-readable summary, the active pressure directive
 * (so the agent always sees it), and a machine-readable JSON block for agents that
 * parse structured output.
 */
export function ok(summary: string, data: unknown, pressure?: PressureSnapshot): ToolText {
  const parts = [summary.trim()];
  if (pressure) parts.push('', directiveBanner(pressure));
  parts.push('', '```json', JSON.stringify(data, null, 2), '```');
  return { content: [{ type: 'text', text: parts.join('\n') }] };
}

export function fail(error: unknown): ToolText {
  const message =
    error instanceof KairoError
      ? `${error.message}${error.hint ? `\nHint: ${error.hint}` : ''}`
      : `Kairo internal error: ${error instanceof Error ? error.message : String(error)}`;
  return { content: [{ type: 'text', text: message }], isError: true };
}
