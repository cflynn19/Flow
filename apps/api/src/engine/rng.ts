/**
 * Seeded PRNG (mulberry32). Every execution gets its own generator so that passing the
 * same `seed` to /execute reproduces a run exactly -- which is what makes the engine
 * testable despite being built around simulated randomness.
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

export function randomInt(rng: () => number, min: number, max: number): number {
  if (max <= min) return min;
  return Math.floor(min + rng() * (max - min + 1));
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)] ?? items[0];
  return item as T;
}
