import { randomBytes } from 'node:crypto';

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

/**
 * A monotonic, lexicographically sortable id (ULID-style): 48-bit millisecond
 * timestamp + 80 bits of randomness. Sorting ids sorts by creation time, which the
 * event log relies on for ordering without a separate sequence column.
 */
export function newId(now: number = Date.now()): string {
  let ts = now;
  const time: string[] = [];
  for (let i = 9; i >= 0; i--) {
    time[i] = ENCODING[ts % 32] as string;
    ts = Math.floor(ts / 32);
  }
  const rnd = randomBytes(16);
  let rand = '';
  for (let i = 0; i < 16; i++) {
    rand += ENCODING[(rnd[i] as number) % 32];
  }
  return time.join('') + rand;
}
