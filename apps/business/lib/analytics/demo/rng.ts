/**
 * mulberry32 over an FNV-1a hash of the seed string. Small, fast, and — the
 * only property that matters here — reproducible, so the same property and the
 * same date range always produce the same numbers on the server and in the
 * browser.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer, inclusive of both bounds. */
  int(min: number, max: number): number;
  pick<T>(items: T[]): T;
  /** True with probability `p`. */
  bool(p: number): boolean;
}

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function makeRng(seed: string): Rng {
  let state = hashSeed(seed);

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    bool: (p) => next() < p,
  };
}
