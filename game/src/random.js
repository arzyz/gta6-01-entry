// One seeded random stream for the whole game (mulberry32).
//
// Determinism is a feature here, not an accident: a given seed always builds the same
// Coral Bay, deals the same traffic and stages the same ?shot= screenshot scenes, which
// keeps the game testable and the screenshots reproducible. Every random choice in the
// simulation draws from the single stream handed to createWorld — never from
// Math.random — so a run can be replayed exactly by reusing its seed.

export function createRandom(seed) {
  let state = seed | 0;
  return function nextRandom() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [min, max], both ends included. */
export function randInt(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

/** Float in [min, max). */
export function randRange(random, min, max) {
  return min + random() * (max - min);
}

/** True with probability p (0..1). */
export function chance(random, p) {
  return random() < p;
}

/** A uniformly chosen element of a non-empty array. */
export function pick(random, items) {
  return items[Math.floor(random() * items.length)];
}
