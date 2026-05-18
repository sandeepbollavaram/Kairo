/** Single clock seam so tests can pin time deterministically. */
export interface Clock {
  now(): number;
  iso(): string;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  iso: () => new Date().toISOString(),
};

export function fixedClock(epochMs: number): Clock {
  return {
    now: () => epochMs,
    iso: () => new Date(epochMs).toISOString(),
  };
}
