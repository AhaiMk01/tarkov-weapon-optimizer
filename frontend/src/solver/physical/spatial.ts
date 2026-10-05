/**
 * The weight penalty of TrueErgo and its per-interval lower envelopes (ADR 0007 section 6).
 *
 * q(W) = max(0, 100 - 300 / W) is zero up to 3 kg and concave above it, with a convex kink at 3 kg. TED subtracts q(W), so a
 * maximization of TED needs a LOWER bound of q on the node interval: a secant is such a bound only inside one concave piece.
 * This module gives the exact real-valued lines (closed forms, so each is one or two roundings, not a subtraction of
 * rounded values) and a validity check for lines supplied from outside (Phase 2.5 will pass outward-shifted ones). The
 * spatial search that picks intervals is Phase 2.4b-3; this phase only enforces a given interval in the LP.
 */

export const TED_FREE_WEIGHT_KG = 3;
export const TED_PENALTY_CAP = 100;
export const TED_PENALTY_NUMERATOR = 300;

/** q(W): the TED weight penalty, in ergonomics points. */
export const weightPenalty = (weightKg: number): number =>
  weightKg <= TED_FREE_WEIGHT_KG ? 0 : TED_PENALTY_CAP - TED_PENALTY_NUMERATOR / weightKg;

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
  /** lo === hi: q is a constant on the node, the line is exact. */
  | 'constant_exact'
  /** lo >= 3 kg, lo < hi: the chord of the concave piece, below q on the node (a relaxation). */
  | 'secant'
  /** lo < 3 < hi: only q >= 0 holds across the knee, so the zero line is used (a relaxation; split at 3 kg to tighten). */
  | 'knee_zero_relaxation';

export interface NodePenalty {
  line: PenaltyLine;
  kind: PenaltyKind;
  /** True when the line equals q on the whole node (the model is exact there). */
  exact: boolean;
}

/** The exact secant-based lower envelope of q on `[lo, hi]` (closed forms; see the module comment). */
export function secantOfPenalty(lo: number, hi: number): NodePenalty {
  if (!(lo <= hi)) throw new RangeError(`weight interval [${String(lo)}, ${String(hi)}] is empty`);
  if (hi <= TED_FREE_WEIGHT_KG) return { line: { slope: 0, intercept: 0 }, kind: 'zero_exact', exact: true };
  if (lo === hi) return { line: { slope: 0, intercept: weightPenalty(lo) }, kind: 'constant_exact', exact: true };
  if (lo < TED_FREE_WEIGHT_KG) return { line: { slope: 0, intercept: 0 }, kind: 'knee_zero_relaxation', exact: false };
  // q(hi) - q(lo) = 300 (1/lo - 1/hi), so the chord slope is 300 / (lo hi) and its intercept 100 - 300/lo - 300/hi.
  const slope = TED_PENALTY_NUMERATOR / (lo * hi);
  const intercept = TED_PENALTY_CAP - TED_PENALTY_NUMERATOR / lo - TED_PENALTY_NUMERATOR / hi;
  return { line: { slope, intercept }, kind: 'secant', exact: false };
}

/**
 * Is `line` on or below q over `[lo, hi]` (up to `slack`)? Exact on each piece: on [lo, min(hi, 3)] q is flat, and on
 * [max(lo, 3), hi] q is concave, so line - q is convex there and its maximum is at an endpoint.
 */
export function penaltyLineIsValid(lo: number, hi: number, line: PenaltyLine, slack = 1e-9): boolean {
  const at = (w: number): number => line.slope * w + line.intercept;
  const ok = (w: number): boolean => at(w) <= weightPenalty(w) + slack;
  if (!ok(lo) || !ok(hi)) return false;
  if (lo < TED_FREE_WEIGHT_KG && hi > TED_FREE_WEIGHT_KG && !ok(TED_FREE_WEIGHT_KG)) return false;
  return true;
}

/** Range of `slope * W + intercept` over `[lo, hi]`, as plain endpoints (the caller widens it outward). */
export function lineRange(line: PenaltyLine, lo: number, hi: number): { lo: number; hi: number } {
  const a = line.slope * lo + line.intercept;
  const b = line.slope * hi + line.intercept;
  return { lo: Math.min(a, b), hi: Math.max(a, b) };
}
