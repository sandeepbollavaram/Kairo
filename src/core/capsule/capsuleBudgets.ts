/**
 * Capsule budgets (v1.6.0, ADR-0020). Budgets are character counts — a
 * deterministic, tokeniser-agnostic local proxy for tokens, consistent with the
 * brief budgets in `core/brief/budget.ts`. Honest: exact token cost depends on
 * the model's tokeniser; chars are a tight upper bound for ASCII code and a
 * reasonable signal elsewhere.
 *
 * The capsule exists because prompts got too large, so the tiny tier must be
 * genuinely tiny and the standard tier must stay compact by default.
 */

import type { CapsuleMode } from './capsuleTypes.js';

export interface CapsuleBudget {
  mode: CapsuleMode;
  /** Hard cap on the rendered capsule, in characters. */
  maxChars: number;
  /** Max changed files listed. */
  maxChangedFiles: number;
  /** Max "files to read first" entries. */
  maxReadFirst: number;
  /** Max "safe to skip initially" entries. */
  maxSkip: number;
  /** Max Atlas nodes included. */
  maxAtlasNodes: number;
  /** Max memory recall items included. */
  maxMemoryItems: number;
  /** Max risk/warning lines. */
  maxRisks: number;
  /** Max completed/remaining work items each. */
  maxWorkItems: number;
}

export const CAPSULE_BUDGETS: Record<CapsuleMode, CapsuleBudget> = {
  tiny: {
    mode: 'tiny',
    maxChars: 1_500,
    maxChangedFiles: 5,
    maxReadFirst: 3,
    maxSkip: 2,
    maxAtlasNodes: 0,
    maxMemoryItems: 0,
    maxRisks: 3,
    maxWorkItems: 3,
  },
  standard: {
    mode: 'standard',
    maxChars: 4_000,
    maxChangedFiles: 10,
    maxReadFirst: 6,
    maxSkip: 5,
    maxAtlasNodes: 5,
    maxMemoryItems: 3,
    maxRisks: 5,
    maxWorkItems: 6,
  },
  deep: {
    mode: 'deep',
    maxChars: 20_000,
    maxChangedFiles: 40,
    maxReadFirst: 20,
    maxSkip: 12,
    maxAtlasNodes: 15,
    maxMemoryItems: 8,
    maxRisks: 20,
    maxWorkItems: 30,
  },
};

export function resolveCapsuleBudget(
  mode: CapsuleMode = 'standard',
  maxCharsOverride?: number,
): CapsuleBudget {
  const base = CAPSULE_BUDGETS[mode];
  if (typeof maxCharsOverride === 'number' && maxCharsOverride > 0) {
    return { ...base, maxChars: maxCharsOverride };
  }
  return { ...base };
}
