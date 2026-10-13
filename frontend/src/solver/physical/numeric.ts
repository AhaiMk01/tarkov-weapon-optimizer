/**
 * Directed-rounding helpers for the finite domains of auxiliary columns (ADR 0007 section 4, ADR 0013 section 4C).
 *
 * The complete outward-error DAG, coefficient and allowance proofs belong to Phase 2.5. This phase only needs every auxiliary
 * column to carry a finite domain that provably contains the value of every physical build, so the helpers here widen an
 * enclosure by one unit in the last place per operation and by the classical n-term summation bound.
 */

const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);

/** Unit roundoff of binary64 (round to nearest). */
export const UNIT_ROUNDOFF = 2 ** -53;

/** The smallest double strictly above `x` (`x` finite). */
export function nextUp(x: number): number {
  if (!Number.isFinite(x)) return x;
  if (x === 0) return Number.MIN_VALUE;
  f64[0] = x;
  u64[0] += x > 0 ? 1n : -1n;
  return f64[0];
}

/** The largest double strictly below `x` (`x` finite). */
export function nextDown(x: number): number {
  if (!Number.isFinite(x)) return x;
  if (x === 0) return -Number.MIN_VALUE;
  f64[0] = x;
  u64[0] += x > 0 ? -1n : 1n;
  return f64[0];
}

/** A closed interval of reals enclosed by binary64 endpoints (`lo <= hi`). */
export interface Interval {
  readonly lo: number;
  readonly hi: number;
}

/**
 * One ulp outward on both sides: encloses the rounding error of the single operation that produced the endpoints. An endpoint of exactly
 * zero stays zero: it came from a multiplication by zero or an exact cancellation, and a denormal bound (5e-324) is not worth the risk
 * of the wrapper failing to read it back (highs-js cannot parse such a bound in its solution printout).
 */
export const outward = (i: Interval): Interval => ({ lo: i.lo === 0 ? 0 : nextDown(i.lo), hi: i.hi === 0 ? 0 : nextUp(i.hi) });

/** Exact-endpoint interval sum, enclosed outward. */
export const iAdd = (a: Interval, b: Interval): Interval => outward({ lo: a.lo + b.lo, hi: a.hi + b.hi });

/** Scale by a constant (either sign), enclosed outward. */
export function iScale(c: number, a: Interval): Interval {
  const p = c * a.lo;
  const q = c * a.hi;
  return outward({ lo: Math.min(p, q), hi: Math.max(p, q) });
}

/**
 * Enclosure of a sum of `terms` binary64 values whose computed range is `[lo, hi]` and whose absolute values add up to
 * `absSum`: any order of summation errs by at most `terms * u * absSum` (the classical bound), so widen by that, rounded up.
 */
export function sumEnclosure(lo: number, hi: number, terms: number, absSum: number): Interval {
  if (absSum === 0) return { lo, hi }; // every term is zero: the sum is exactly zero, nothing to widen
  const slack = nextUp(nextUp(terms + 1) * UNIT_ROUNDOFF * nextUp(absSum));
  return { lo: nextDown(lo - slack), hi: nextUp(hi + slack) };
}

/**
 * Exact error of the binary64 sum `s = fl(a + b)` (Knuth TwoSum): `a + b = s + err` with no rounding, for finite operands whose sum does not
 * overflow. It decides the direction of a directed rounding without any change of the platform rounding mode.
 */
function twoSumError(a: number, b: number, s: number): number {
  const bb = s - a;
  return (a - (s - bb)) + (b - bb);
}

/** `a + b` rounded toward +Infinity: the smallest double that is at least the exact sum. */
export function addUp(a: number, b: number): number {
  const s = a + b;
  if (!Number.isFinite(s)) return s;
  return twoSumError(a, b, s) > 0 ? nextUp(s) : s;
}

/** `a + b` rounded toward -Infinity: the largest double that is at most the exact sum. */
export function addDown(a: number, b: number): number {
  const s = a + b;
  if (!Number.isFinite(s)) return s;
  return twoSumError(a, b, s) < 0 ? nextDown(s) : s;
}

/** `a - b` rounded toward +Infinity. */
export const subUp = (a: number, b: number): number => addUp(a, -b);

/** `a - b` rounded toward -Infinity. */
export const subDown = (a: number, b: number): number => addDown(a, -b);

/**
 * The gap `upper - lower` of a bound pair, never below the true gap: rounded up, clamped at zero, `Infinity` when either end is not finite
 * (an unknown bound is an unbounded gap, never a zero one).
 */
export function gapUpward(upper: number, lower: number): number {
  if (!Number.isFinite(upper) || !Number.isFinite(lower)) return Infinity;
  return Math.max(0, subUp(upper, lower));
}

/** Throws when a number that must appear in the model text is not finite. */
export function finiteOrThrow(value: number, what: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${what} is not finite: ${String(value)}`);
  return value;
}
