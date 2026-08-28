// Seedable PRNG so every simulation run is reproducible (a requirement for
// verifying algorithm behavior in tests, not just "it runs").
// mulberry32 — public-domain 32-bit generator by Tommy Ettinger.
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (n) => Math.floor(next() * n);
  next.range = (lo, hi) => lo + next() * (hi - lo);
  next.pick = (arr) => arr[next.int(arr.length)];
  return next;
}
