/**
 * The weight penalty of TrueErgo and its per-interval lower envelopes (ADR 0007 section 6, ADR 0013 section 4C).
 *
 * q(W) = max(0, 100 - 300 / W) is zero up to 3 kg and concave above it, with a convex kink at 3 kg. TED subtracts q(W), so a
 * maximization of TED needs a LOWER bound of q on the node interval: a secant is such a bound only inside one concave piece.
 *
 * Every line returned here is a VERIFIED lower envelope, proved on the exact rational path (`rational.ts`): the secant of the node is
 * computed in exact rationals from the binary64 endpoints, its slope is the nearest double, and its intercept is the largest double that
 * keeps the emitted line at or below the real secant at both ends of the node (a line is linear, so below at the two ends is below
 * between). The outward shift is therefore exactly as large as the construction error needs and no larger: no fixed 1e-9, no estimate.
 * `shift` reports it (in ergonomics points, rounded up). `penaltyLineIsValid` checks a line supplied from outside with no slack at all.
 */

import { RAT_ZERO, ratAdd, ratCmp, ratDiv, ratFromDouble, ratInt, ratMul, ratSub, type Rat } from './exact';
import { ratRoundDown, ratRoundUp } from './rational';

export const TED_FREE_WEIGHT_KG = 3;
export const TED_PENALTY_CAP = 100;
export const TED_PENALTY_NUMERATOR = 300;

/** q(W): the TED weight penalty, in ergonomics points (binary64, for display and scoring helpers; the proofs use {@link exactWeightPenalty}). */
export const weightPenalty = (weightKg: number): number =>
  weightKg <= TED_FREE_WEIGHT_KG ? 0 : TED_PENALTY_CAP - TED_PENALTY_NUMERATOR / weightKg;

const FREE = ratInt(TED_FREE_WEIGHT_KG);
const CAP = ratInt(TED_PENALTY_CAP);
const NUMERATOR = ratInt(TED_PENALTY_NUMERATOR);

/** q(w) of an exact rational weight. */
export function exactWeightPenalty(w: Rat): Rat {
  return ratCmp(w, FREE) <= 0 ? RAT_ZERO : ratSub(CAP, ratDiv(NUMERATOR, w));
}

/** A line `slope * W + intercept` claimed to lie on or below q over a closed weight interval. */
export interface PenaltyLine {
  slope: number;
  intercept: number;
}

/** A closed weight interval in kilograms, `lo <= hi`. */
export interface WeightInterval {
  lo: number;
  hi: number;
}

export type PenaltyKind =
  /** hi <= 3 kg: q is identically 0, the line is exact. */
  | 'zero_exact'
  /** lo === hi: q is a constant on the node; the line is that constant rounded down (exact up to `shift`). */
  | 'constant_exact'
  /** lo >= 3 kg, lo < hi: the chord of the concave piece, below q on the node (a relaxation). */
  | 'secant'
  /** lo < 3 < hi: only q >= 0 holds across the knee, so the zero line is used (a relaxation; split at 3 kg to tighten). */
  | 'knee_zero_relaxation';

export interface NodePenalty {
  line: PenaltyLine;
  kind: PenaltyKind;
  /** True when the line equals q on the whole node up to `shift` (no split of the node can tighten the model). */
  exact: boolean;
  /** How far below the real line (the exact chord or constant) the emitted line sits at its lowest margin on the node, in points, rounded up. */
  shift: number;
}

/** The value of `slope * w + intercept` at an exact rational weight, exact. */
function lineAt(line: PenaltyLine, w: Rat): Rat {
  return ratAdd(ratMul(ratFromDouble(line.slope), w), ratFromDouble(line.intercept));
}

/** The double nearest to a positive rational, decided by exact comparison of the two neighbours. */
function nearestDouble(a: Rat): number {
  const down = ratRoundDown(a);
  const up = ratRoundUp(a);
  if (down === up) return down;
  return ratCmp(ratSub(a, ratFromDouble(down)), ratSub(ratFromDouble(up), a)) <= 0 ? down : up;
}

/**
 * The verified lower envelope of q on `[lo, hi]` (see the module comment). Throws a RangeError for an empty interval or a non-finite end.
 */
export function secantOfPenalty(lo: number, hi: number): NodePenalty {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(lo <= hi)) throw new RangeError(`weight interval [${String(lo)}, ${String(hi)}] is empty or not finite`);
  if (hi <= TED_FREE_WEIGHT_KG) return { line: { slope: 0, intercept: 0 }, kind: 'zero_exact', exact: true, shift: 0 };
  const rlo = ratFromDouble(lo);
  const rhi = ratFromDouble(hi);
  if (lo === hi) {
    const q = exactWeightPenalty(rlo);
    const intercept = ratRoundDown(q);
    return { line: { slope: 0, intercept }, kind: 'constant_exact', exact: true, shift: ratRoundUp(ratSub(q, ratFromDouble(intercept))) };
  }
  if (lo < TED_FREE_WEIGHT_KG) return { line: { slope: 0, intercept: 0 }, kind: 'knee_zero_relaxation', exact: false, shift: 0 };
  // The real chord: q(hi) - q(lo) = 300 (1/lo - 1/hi), so its slope is 300 / (lo hi) and its intercept 100 - 300/lo - 300/hi.
  const slope = ratDiv(NUMERATOR, ratMul(rlo, rhi));
  const intercept = ratSub(ratSub(CAP, ratDiv(NUMERATOR, rlo)), ratDiv(NUMERATOR, rhi));
  const emittedSlope = nearestDouble(slope);
  // chord(w) - line(w) = (slope - emittedSlope) w + (intercept - emittedIntercept) must be >= 0 at both ends of the node.
  const slopeDeficit = ratSub(slope, ratFromDouble(emittedSlope));
  const atLo = ratMul(slopeDeficit, rlo);
  const atHi = ratMul(slopeDeficit, rhi);
  const lowest = ratCmp(atLo, atHi) <= 0 ? atLo : atHi;
  const emittedIntercept = ratRoundDown(ratAdd(intercept, lowest));
  const interceptGap = ratSub(intercept, ratFromDouble(emittedIntercept));
  const gapAtLo = ratAdd(atLo, interceptGap);
  const gapAtHi = ratAdd(atHi, interceptGap);
  const shift = ratRoundUp(ratCmp(gapAtLo, gapAtHi) >= 0 ? gapAtLo : gapAtHi);
  return { line: { slope: emittedSlope, intercept: emittedIntercept }, kind: 'secant', exact: false, shift };
}

/**
 * Is `line` on or below q over `[lo, hi]` (up to `slack` points, default none), decided in exact rational arithmetic? On each piece the line
 * minus q is convex (q is flat up to 3 kg and concave above), so its maximum over a piece is at an end of the piece.
 */
export function penaltyLineIsValid(lo: number, hi: number, line: PenaltyLine, slack = 0): boolean {
  if (!Number.isFinite(line.slope) || !Number.isFinite(line.intercept) || !Number.isFinite(lo) || !Number.isFinite(hi) || !(lo <= hi)) return false;
  const allowance = ratFromDouble(slack);
  const ok = (w: Rat): boolean => ratCmp(lineAt(line, w), ratAdd(exactWeightPenalty(w), allowance)) <= 0;
  if (!ok(ratFromDouble(lo)) || !ok(ratFromDouble(hi))) return false;
  if (lo < TED_FREE_WEIGHT_KG && hi > TED_FREE_WEIGHT_KG && !ok(FREE)) return false;
  return true;
}

/**
 * An enclosure `[lo, hi]` of `slope * W + intercept` over `W in [wlo, whi]`: exact in rationals, rounded outward, so it contains the value
 * for every real weight of the node (a weight is a real number, not a double).
 */
export function lineEnclosure(line: PenaltyLine, wlo: number, whi: number): { lo: number; hi: number } {
  const a = lineAt(line, ratFromDouble(wlo));
  const b = lineAt(line, ratFromDouble(whi));
  const ordered = ratCmp(a, b) <= 0;
  return { lo: ratRoundDown(ordered ? a : b), hi: ratRoundUp(ordered ? b : a) };
}
