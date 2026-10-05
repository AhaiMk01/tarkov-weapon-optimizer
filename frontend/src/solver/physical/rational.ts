/**
 * Exact rational helpers for the proof layer (ADR 0007 section 4, ADR 0013 section 4C).
 *
 * The construction errors of the emitted model are proved on the exact rational path: every binary64 input leaf is decoded to the exact
 * rational it denotes (`exact.ts`), every real target (a declared constant such as K = 1000000/29089, a quotient, a secant) is computed in
 * those rationals, and the value that goes into the text is a double chosen from the exact rational by DIRECTED rounding. Nothing here
 * depends on a rounding mode of the platform: the rounding is decided by an exact comparison.
 *
 * Pure, no imports beyond `exact.ts` and `numeric.ts`.
 */

import { RAT_ZERO, rat, ratAdd, ratCmp, ratFromDouble, ratMul, ratSub, ratToNumber, type Rat } from './exact';
import { nextDown, nextUp } from './numeric';

export const ratNeg = (a: Rat): Rat => (a.n === 0n ? RAT_ZERO : rat(-a.n, a.d));
export const ratAbs = (a: Rat): Rat => (a.n < 0n ? rat(-a.n, a.d) : a);
export const ratSign = (a: Rat): -1 | 0 | 1 => (a.n < 0n ? -1 : a.n > 0n ? 1 : 0);

/** max(0, a). */
export const ratPositivePart = (a: Rat): Rat => (a.n > 0n ? a : RAT_ZERO);

/** The exact rational of an integer written as a safe number. */
export const ratOf = (n: number): Rat => ratFromDouble(n);

/** `n` or `n/d` (the canonical text of `ratString`). Throws on anything else. */
export function ratFromString(text: string): Rat {
  const match = /^(-?\d+)(?:\/(\d+))?$/.exec(text);
  if (!match) throw new RangeError(`not a canonical rational: ${JSON.stringify(text)}`);
  return rat(BigInt(match[1]), match[2] === undefined ? 1n : BigInt(match[2]));
}

/**
 * The largest double that is at most `a`. Exact: the nearest double is corrected by comparing its exact value with `a`, so the result does
 * not depend on how `ratToNumber` rounded. Throws a RangeError when `a` is beyond the finite doubles (a bound that cannot be represented is
 * never replaced by an infinity here).
 */
export function ratRoundDown(a: Rat): number {
  let d = ratToNumber(a);
  if (!Number.isFinite(d)) {
    if (a.n > 0n) d = Number.MAX_VALUE; // above every double: the largest double is still at most a
    else throw new RangeError('ratRoundDown: the value is below the smallest finite double');
  }
  while (ratCmp(ratFromDouble(d), a) > 0) d = nextDown(d);
  for (;;) {
    const up = nextUp(d);
    if (!Number.isFinite(up) || ratCmp(ratFromDouble(up), a) > 0) break;
    d = up;
  }
  return d === 0 ? 0 : d;
}

/** The smallest double that is at least `a` (see {@link ratRoundDown}). */
export function ratRoundUp(a: Rat): number {
  let d = ratToNumber(a);
  if (!Number.isFinite(d)) {
    if (a.n < 0n) d = -Number.MAX_VALUE;
    else throw new RangeError('ratRoundUp: the value is above the largest finite double');
  }
  while (ratCmp(ratFromDouble(d), a) < 0) d = nextUp(d);
  for (;;) {
    const down = nextDown(d);
    if (!Number.isFinite(down) || ratCmp(ratFromDouble(down), a) < 0) break;
    d = down;
  }
  return d === 0 ? 0 : d;
}

/** The exact value of the double `d` minus the rational `a`, as an absolute rational: the representation error of `d` as a stand-in for `a`. */
export const ratRepresentationError = (d: number, a: Rat): Rat => ratAbs(ratSub(ratFromDouble(d), a));

/** The exact product of two doubles. */
export const ratProduct = (a: number, b: number): Rat => ratMul(ratFromDouble(a), ratFromDouble(b));

/** The exact sum of doubles. */
export function ratSumOfDoubles(values: Iterable<number>): Rat {
  let total = RAT_ZERO;
  for (const v of values) total = ratAdd(total, ratFromDouble(v));
  return total;
}

/** max(|lo|, |hi|) of an interval of doubles, exact. This is the magnitude bound B of a column with that domain. */
export function ratMagnitude(lo: number, hi: number): Rat {
  const a = ratAbs(ratFromDouble(lo));
  const b = ratAbs(ratFromDouble(hi));
  return ratCmp(a, b) >= 0 ? a : b;
}
