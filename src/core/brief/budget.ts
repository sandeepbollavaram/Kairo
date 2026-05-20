/**
 * Brief modes & token budgets (v0.8.2, ADR-0010). Budgets are character counts —
 * a deterministic, tokeniser-agnostic local proxy for tokens. Honest: exact token
 * cost depends on the model's tokeniser; chars are a tight upper bound for ASCII
 * code/identifiers and a reasonable signal everywhere else.
 */

export type BriefMode = 'tiny' | 'normal' | 'deep';

export interface BriefBudget {
  mode: BriefMode;
  maxBriefChars: number;
  maxRecallItems: number;
  maxChunkChars: number;
  maxWarnings: number;
  /** Inline Mermaid into briefs. Default false — graphs live in `.kairo/graphs/`. */
  includeGraphs: boolean;
}

export const DEFAULT_BUDGETS: Record<BriefMode, BriefBudget> = {
  tiny: {
    mode: 'tiny',
    maxBriefChars: 1500,
    maxRecallItems: 0,
    maxChunkChars: 0,
    maxWarnings: 3,
    includeGraphs: false,
  },
  normal: {
    mode: 'normal',
    maxBriefChars: 4000,
    maxRecallItems: 3,
    maxChunkChars: 200,
    maxWarnings: 5,
    includeGraphs: false,
  },
  deep: {
    mode: 'deep',
    maxBriefChars: 20_000,
    maxRecallItems: 8,
    maxChunkChars: 600,
    maxWarnings: 20,
    includeGraphs: false,
  },
};

export function resolveBudget(
  mode: BriefMode = 'normal',
  overrides: Partial<BriefBudget> = {},
): BriefBudget {
  return { ...DEFAULT_BUDGETS[mode], ...overrides };
}

/** Trim text to a max length, suffixing an ellipsis when truncated. */
export function clip(text: string, max: number): string {
  if (max <= 0 || text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}
