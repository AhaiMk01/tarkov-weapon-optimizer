/**
 * Outward display rounding and witness-safe cap submission (ADR 0007 section 7, GLOSSARY "Outward Ceiling Rounding").
 *
 * A floor operation reports an achieved upper end `hi` (the upward enclosure of the MOA of a verified witness, a double). Anything shown to a
 * person or submitted back as a cap must parse to a value at least `hi` and finite, or it is withheld (`null`) and the raw witness stays the
 * truth: a displayed or submitted value below the witness would claim a cap the witness itself violates. Naive `Math.ceil(hi * 10 ** d) / 10 ** d`
 * fails exactly where it matters (0.043000000000000003 x 1000 is 43, whose ceiling reads back as 0.043, below hi), so the decimal is searched
 * by the postcondition itself: the smallest decimal whose `Number(text)` is at least `hi` (a monotone test, settled by the exact decimal parse).
 *
 * Pure, no imports beyond `exact.ts` and `rational.ts`. Phase 2.7's floor operation consumes these.
 */

import { rat, ratAdd, ratCmp, ratDiv, ratFromDouble, ratMul, ratSub, type Rat } from './exact';
import { ratRoundUp } from './rational';

/** The decimal places a displayed floor may carry. */
export const DISPLAY_DECIMALS = [1, 2, 3, 4] as const;
export type DisplayDecimals = (typeof DISPLAY_DECIMALS)[number];

const isDisplayDecimals = (d: number): d is DisplayDecimals => Number.isInteger(d) && d >= 1 && d <= 4;

/**
 * The largest witness magnitude a display with `decimals` places can carry without losing integer precision:
 * (Number.MAX_SAFE_INTEGER - 10) / 10^decimals. `null` for an unsupported precision.
 */
export function maxSafeWitness(decimals: number): number | null {
  return isDisplayDecimals(decimals) ? (Number.MAX_SAFE_INTEGER - 10) / 10 ** decimals : null;
}

export interface OutwardDisplay {
  /** The decimal text with exactly `decimals` places (what a person reads). */
  text: string;
  /** The double the text parses to (`Number(text)`): at least `hi`. */
  value: number;
}

/** Decimal text of the integer `n` divided by 10^decimals, with exactly `decimals` places. */
function decimalText(n: bigint, decimals: number): string {
  const negative = n < 0n;
  const digits = (negative ? -n : n).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * The smallest decimal with `decimals` places whose parse is at least `hi`, as text and as the double it parses to. `null` (withheld) when `decimals`
 * is not an integer in 1..4, when `hi` is not finite, when it is beyond `maxSafeWitness(decimals)`, or when the postcondition `parsed >= hi`
 * cannot be established (the raw witness is kept either way).
 */
export function outwardDisplay(hi: number, decimals: number): OutwardDisplay | null {
  const limit = maxSafeWitness(decimals);
  if (limit === null || typeof hi !== 'number' || !Number.isFinite(hi) || Math.abs(hi) > limit) return null;
  // The postcondition is on the PARSED double (ADR 0007 section 7: parsed >= hi). Parsing is monotone in the decimal, so the smallest n whose
  // text parses to at least hi is found from the float estimate, which is off by at most one place either way.
  const atLeastHi = (n: bigint): boolean => Number(decimalText(n, decimals)) >= hi;
  let n = BigInt(Math.ceil(hi * 10 ** decimals));
  for (let step = 0; !atLeastHi(n); step++) {
    if (step > 4) return null;
    n += 1n;
  }
  for (let step = 0; atLeastHi(n - 1n); step++) {
    if (step > 4) return null;
    n -= 1n;
  }
  const text = decimalText(n, decimals);
  const value = Number(text);
  return Number.isFinite(value) && value >= hi ? { text, value } : null;
}

/** `outwardDisplay(hi, decimals)?.value`: the display value at least `hi`, or null when withheld. */
export function outwardSafeCeil(hi: number, decimals: number): number | null {
  return outwardDisplay(hi, decimals)?.value ?? null;
}

/** The ceiling of an exact rational as a bigint. */
function ratCeil(a: Rat): bigint {
  const q = a.n / a.d;
  return a.n > 0n && a.n % a.d !== 0n ? q + 1n : q;
}

/**
 * The cap to submit for a witness whose achieved value is `hi`, on a grid `origin + k step` (an offset grid when `origin` is not a multiple
 * of `step`): `origin + ceil((hi - origin) / step) step`, computed exactly and rounded up to the double, so it is on the grid up to the
 * double and never below `hi`. `null` (withheld) for a non-finite input, a non-positive step, an index beyond safe integers, or a result that
 * would not be a finite double at least `hi`.
 */
export function outwardGridCeil(hi: number, origin: number, step: number): number | null {
  if (![hi, origin, step].every(Number.isFinite) || !(step > 0)) return null;
  const exactStep = ratFromDouble(step);
  const exactOrigin = ratFromDouble(origin);
  const k = ratCeil(ratDiv(ratSub(ratFromDouble(hi), exactOrigin), exactStep));
  if (k > BigInt(Number.MAX_SAFE_INTEGER) || k < -BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const exactCap = ratAdd(exactOrigin, ratMul(rat(k), exactStep));
  let cap: number;
  try {
    cap = ratRoundUp(exactCap);
  } catch {
    return null;
  }
  return submissionIsSafe(cap, hi) ? (cap === 0 ? 0 : cap) : null;
}

/** The pre-submission guard: a cap is submitted only when it is finite and at least the witness it must admit. */
export function submissionIsSafe(cap: number, hi: number): boolean {
  return Number.isFinite(cap) && Number.isFinite(hi) && ratCmp(ratFromDouble(cap), ratFromDouble(hi)) >= 0;
}
