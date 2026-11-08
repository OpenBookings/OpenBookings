/**
 * Seeded randomness for generated demo data. The same seed always yields the
 * same hotels, so a rebuilt area looks the same and tests are reproducible.
 */

export type Rng = {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [min, max], both ends included. */
  int(min: number, max: number): number;
  pick<T>(xs: readonly T[]): T;
};

/** cyrb53: a well-mixed 53-bit string hash. */
function cyrb53(str: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function seededRng(seed: string): Rng {
  let state = cyrb53(seed) >>> 0;
  // mulberry32
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (xs) => xs[Math.floor(next() * xs.length)],
  };
}

/** A ~10 km grid cell: the unit a generated area is keyed on. */
export function areaKey(lat: number, lon: number): string {
  return `${lat.toFixed(1)}:${lon.toFixed(1)}`;
}
