/**
 * The error and enclosure model of the emitted LP (ADR 0007 section 4 and 6, ADR 0010 section 2, ADR 0013 sections 4B and 4C, Phase 2.5).
 *
 * Why it exists. The text HiGHS reads is a binary64 rendering of a real model. Most of its coefficients ARE the model: an item statistic, a
 * price, a weight, a small integer, a power of two are exact binary64 leaves, and the physical truth (the oracle, the validator) decodes the
 * same leaves exactly. A few coefficients are CONSTRUCTED from leaves and declared constants (K = 1000000/29089, a weight divided by 10, a
 * secant, a normalization quotient, a cap minus a recoil), and a double cannot hold them. For each of those this module computes the exact
 * rational TARGET, chooses the emitted double by directed rounding, and proves an absolute CONSTRUCTION ERROR in exact rational arithmetic
 * (`exact.ts`, no interval estimate and no shortcut), from the binary64 inputs and the finite domains of the columns:
 *
 *   - a constructed ROW is emitted with its right-hand side moved OUTWARD by at least the coefficient deficit `sum |a'_i - a_i| B_i`
 *     (B_i the magnitude bound of column i), in the direction that relaxes the row. Every physical build then satisfies the emitted row, so the
 *     emitted model is an OUTER RELAXATION of the physical one, with no reliance on the solver's feasibility tolerance. The padding is derived
 *     from the exact need and rounded outward, never a nominal margin; the record keeps the `need` so a parsed model can be checked against it;
 *   - the OBJECTIVE keeps its constructed coefficients unpadded and carries the proved frame error `sum |c'_j - c_j| B_j` in objective units
 *     (the coefficients of a weighted or augmented Tchebycheff objective, through the actual scalarization, never an unscaled extra);
 *   - the SECANT of the weight penalty is verified exactly (`spatial.ts`) and its shift is reported in points and in objective units;
 *   - a power-of-two SCALING of an axis column (`column_n = column / 2^k`, exact) makes every objective coefficient on it survive HiGHS's
 *     small_matrix_value filter, in the oracle's own units, or the proof is withheld.
 *
 * What a proof may use. A native upper bound is valid only for a QUALIFIED solve (`nativeProof.ts`: the parsed model equals the emitted one,
 * the parsed padded right-hand sides dominate their needs, the native tolerances are the declared ones, presolve is off): then
 * `UB = UB_native + frame error` (exact rationals, then enclosed by the smallest double above, the ADR's `nextUp`) is an upper bound of
 * the physical optimum in the oracle's frame. Anything unqualified is an UNKNOWN bound (`Infinity` here, `null` on the wire), never a finite
 * guess. A verified incumbent contributes the downward enclosure of its exact rational score as the lower bound and the upward enclosure as
 * its part of the upper bound; the certificate compares the exact upper bound with the exact score.
 *
 * Pure: no solver, no text, no native module.
 */

import type { IdealPoint } from '../types';
import { RAT_ZERO, rat, ratAdd, ratCmp, ratDiv, ratFromDouble, ratInt, ratMax, ratMul, ratSub, ratToNumber, type Rat } from './exact';
import type { Interval } from './numeric';
import { ratAbs, ratFromString, ratMagnitude, ratPositivePart, ratRoundDown, ratRoundUp } from './rational';
import { exactWeightPenalty, type WeightInterval } from './spatial';

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

/** HiGHS drops a matrix entry of magnitude at most this when it reads a model (its default `small_matrix_value`; `src/solver/native/options.ts`). */
export const HIGHS_SMALL_MATRIX_VALUE = 1e-9;
/** HiGHS rejects a matrix entry of magnitude at least this (its default `large_matrix_value`). */
export const HIGHS_LARGE_MATRIX_VALUE = 1e15;
/**
 * Smallest magnitude an emitted coefficient may have when the model is free to choose it (a positive Big-M, a rescaled objective chain): a
 * thousand times HiGHS's small_matrix_value, so it survives the read with room to spare. Derived from the declared threshold, never a free
 * literal. Any M at least as large as the one the proof needs is just as valid, so a positive M is raised to it.
 */
export const MIN_SURVIVING_COEFFICIENT = 1000 * HIGHS_SMALL_MATRIX_VALUE;
/** The largest exponent of an axis scale: a link-row coefficient 2^40 (1.1e12) stays far below `large_matrix_value`. */
export const MAX_AXIS_SCALE_EXPONENT = 40;

/** K = 100 / 2.9089 = 1000000 / 29089, MOA per unit of centre of impact, as the exact rational the adopted contract names. */
export const MOA_K_RATIONAL: Rat = rat(1000000n, 29089n);
/** K / 100 = 10000 / 29089, the coefficient scale of the accuracy sum in a MOA row. */
export const MOA_K_OVER_100_RATIONAL: Rat = rat(10000n, 29089n);

const ONE = ratInt(1);
const HUNDRED = ratInt(100);

// ---------------------------------------------------------------------------------------------
// Constructed rows
// ---------------------------------------------------------------------------------------------

export type RowRelation = '>=' | '<=';

/** One coefficient of a constructed row: its exact target, the double emitted and the magnitude bound of its column. */
export interface TargetCoefficient {
  target: Rat;
  emitted: number;
  /** max(|lower|, |upper|) of the column's finite domain, exact. */
  magnitude: Rat;
}

/** The padded right-hand side of a constructed row (see the module comment). */
export interface PaddedRhs {
  /** The double written to the text. */
  emitted: number;
  /** The exact right-hand side the emitted one must dominate: target -/+ the coefficient deficit. A parsed model is checked against it. */
  need: Rat;
  /** Proved upward bound of the coefficient deficit `sum |emitted_i - target_i| magnitude_i`, in the row's own units. */
  coefficientError: number;
  /** How far the emitted right-hand side sits from the exact target, rounded up: at least `coefficientError`. */
  allowance: number;
}

/**
 * The right-hand side of a row `sum a'_i z_i  (>= | <=)  r''` that is an outer relaxation of the target row `sum a_i z_i  (>= | <=)  r`:
 * every real point of the column domains that meets the target meets the emitted row. For `>=` the emitted `r''` is the largest double at
 * most `r - deficit`, for `<=` the smallest double at least `r + deficit`, decided by exact comparison.
 */
export function paddedRhs(relation: RowRelation, targetRhs: Rat, coefficients: readonly TargetCoefficient[]): PaddedRhs {
  let deficit = RAT_ZERO;
  for (const c of coefficients) deficit = ratAdd(deficit, ratMul(ratAbs(ratSub(ratFromDouble(c.emitted), c.target)), c.magnitude));
  const need = relation === '>=' ? ratSub(targetRhs, deficit) : ratAdd(targetRhs, deficit);
  const emitted = relation === '>=' ? ratRoundDown(need) : ratRoundUp(need);
  return {
    emitted,
    need,
    coefficientError: ratRoundUp(deficit),
    allowance: ratRoundUp(ratAbs(ratSub(ratFromDouble(emitted), targetRhs))),
  };
}

/** The record of one constructed row, kept on the model so the parsed row can be checked against it. */
export interface RowProof {
  row: string;
  family: string;
  relation: RowRelation;
  need: Rat;
  emitted: number;
  coefficientError: number;
  allowance: number;
}

export const rowProof = (row: string, family: string, relation: RowRelation, p: PaddedRhs): RowProof => ({
  row, family, relation, need: p.need, emitted: p.emitted, coefficientError: p.coefficientError, allowance: p.allowance,
});

// ---------------------------------------------------------------------------------------------
// MOA (ADR 0007 section 1 and 4)
// ---------------------------------------------------------------------------------------------

/**
 * M = max(0, max over the accuracy range of c (1 - A / 100) - L) for c = coi K, as an exact rational: the Big-M a replacement or fallback row
 * needs so that it does not bind when its selector is off. c (1 - A/100) is linear in A, so the maximum is at an end of the range (the lower
 * end for a positive centre of impact, the upper end for a negative one).
 */
function exactBigM(coi: number, limit: number, accuracy: Interval): Rat {
  const c = ratMul(ratFromDouble(coi), MOA_K_RATIONAL);
  const at = (a: number): Rat => ratMul(c, ratSub(ONE, ratDiv(ratFromDouble(a), HUNDRED)));
  const worst = ratMax(at(accuracy.lo), at(accuracy.hi));
  return ratPositivePart(ratSub(worst, ratFromDouble(limit)));
}

/** The double Big-M of a row: the smallest double at least the exact need, raised to {@link MIN_SURVIVING_COEFFICIENT} when it is positive. */
export function bigMOf(coi: number, limit: number, accuracy: Interval): number {
  const m = ratRoundUp(exactBigM(coi, limit, accuracy));
  return m === 0 ? 0 : Math.max(m, MIN_SURVIVING_COEFFICIENT);
}

export interface MoaRowPlan {
  /** Coefficient of the accuracy sum (the nearest double of coi K / 100; zero for a zero centre of impact). */
  coefficient: number;
  /** Coefficient magnitude of the barrel selector(s): the Big-M, zero when none is needed. */
  bigM: number;
  rhs: PaddedRhs;
}

/** The replacement row of one barrel: `coefficient A - M x_b >= rhs` (ADR 0007 section 1), M a double that dominates the exact need. */
export function moaReplacementRow(coi: number, limit: number, accuracy: Interval): MoaRowPlan {
  const c = ratMul(ratFromDouble(coi), MOA_K_RATIONAL);
  const target = ratMul(ratFromDouble(coi), MOA_K_OVER_100_RATIONAL);
  const coefficient = ratToNumber(target);
  const bigM = bigMOf(coi, limit, accuracy);
  // c/100 A - M x_b >= c - L - M with M the emitted double: the target is exact in M, only c/100 is constructed.
  const rhs = paddedRhs('>=', ratSub(ratSub(c, ratFromDouble(limit)), ratFromDouble(bigM)), [
    { target, emitted: coefficient, magnitude: ratMagnitude(accuracy.lo, accuracy.hi) },
  ]);
  return { coefficient, bigM, rhs };
}

/**
 * The intrinsic fallback row: `coefficient A + M sum_b x_b >= rhs` with barrels (M the Big-M of the intrinsic value), or the unconditional
 * `coefficient A >= rhs` without them.
 */
export function moaFallbackRow(coi: number, limit: number, accuracy: Interval, withBarrels: boolean): MoaRowPlan {
  const c = ratMul(ratFromDouble(coi), MOA_K_RATIONAL);
  const target = ratMul(ratFromDouble(coi), MOA_K_OVER_100_RATIONAL);
  const coefficient = ratToNumber(target);
  const bigM = withBarrels ? bigMOf(coi, limit, accuracy) : 0;
  const rhs = paddedRhs('>=', ratSub(c, ratFromDouble(limit)), [
    { target, emitted: coefficient, magnitude: ratMagnitude(accuracy.lo, accuracy.hi) },
  ]);
  return { coefficient, bigM, rhs };
}

// ---------------------------------------------------------------------------------------------
// Gear factor (ADR 0007 section 5)
// ---------------------------------------------------------------------------------------------

export interface GearFactor {
  /** max(0, 1 + modifier), exact. */
  target: Rat;
  /** The largest double at most the target and the smallest at least it; equal exactly when the factor is representable. */
  low: number;
  high: number;
}

export function gearFactor(modifier: number): GearFactor {
  const target = ratMax(RAT_ZERO, ratAdd(ONE, ratFromDouble(modifier)));
  return { target, low: ratRoundDown(target), high: ratRoundUp(target) };
}

/** The real range of `gear_ergo = f x capped`, for capped in [lo, hi] with lo >= 0, as an enclosure by doubles. */
export function gearEnclosure(factor: GearFactor, capped: Interval): Interval {
  if (capped.lo < 0) throw new RangeError('the first clamp is never negative');
  return {
    lo: ratRoundDown(ratMul(ratFromDouble(factor.low), ratFromDouble(capped.lo))),
    hi: ratRoundUp(ratMul(ratFromDouble(factor.high), ratFromDouble(capped.hi))),
  };
}

// ---------------------------------------------------------------------------------------------
// Objective (ADR 0010 section 2, ADR 0007 section 6)
// ---------------------------------------------------------------------------------------------

export type AxisName = 'e' | 'r' | 'p';

export interface ObjectiveWeights {
  e: number;
  r: number;
  p: number;
}

/** The three objective frames' finite ranges: fE = 10 x (ergonomics | TED), fR = 1000 x recoil modifier sum, fP = RUB spend. */
export interface AxisRanges {
  ergo: Interval;
  rec: Interval;
  price: Interval;
}

export interface ObjectiveTerm {
  column: 'ergo_axis' | 'rec_axis' | 'price_axis';
  /** The exact coefficient of the axis in the oracle objective. */
  target: Rat;
  /** The double emitted for it in oracle units (before the power-of-two rescaling). */
  emitted: number;
  /** |emitted - target|, rounded up. */
  error: number;
  /** The column's magnitude bound B_j, rounded up. */
  magnitude: number;
  /** error x B_j, rounded up. */
  contribution: number;
}

export interface DeviationPlan {
  axis: AxisName;
  /** The exact normalization coefficient c_a. */
  target: Rat;
  /** c_a as a double, oracle units (unscaled). */
  emitted: number;
  /** The exact ideal coordinate of the payoff table (a binary64 leaf). */
  ideal: number;
  /** The row's padded right-hand side in oracle units, `c_a z_a` for fE and `-(c_a z_a)` for the others (see `specialize.ts`). */
  rhs: PaddedRhs;
}

export interface ObjectivePlan {
  kind: 'weighted' | 'tchebycheff';
  terms: readonly ObjectiveTerm[];
  deviations: readonly DeviationPlan[];
  /**
   * Proved upper bound of |true objective - emitted objective| over the domains of the three axis columns, in oracle units: the sum of
   * `|c'_j - c_j| B_j` (the deviation rows are padded, so their errors are allowances of the rows, not part of this).
   */
  frameError: number;
  /**
   * Per axis column, the exact power of two its objective coefficients are expressed through (`column_n = column / factor`), so that every
   * coefficient the solver reads survives its small-coefficient filter; factor 1 when none is needed.
   */
  axisScales: readonly AxisScale[];
  /** Non-null when some axis cannot be scaled legally: the model keeps its text and the proof is withheld. */
  withheld: string | null;
}

const ERGO_SCALE_RAT = ratInt(10);
const SCALE_RAT = ratInt(1000);
const AUGMENTATION_RAT = rat(1n, 100n);

/** Resolved weights as exact rationals. */
const weightsOf = (w: ObjectiveWeights): { e: Rat; r: Rat; p: Rat } => ({ e: ratFromDouble(w.e), r: ratFromDouble(w.r), p: ratFromDouble(w.p) });

/** The exact Tchebycheff normalization coefficients (ADR 0010 section 2): c_a = w_a / (sum max(range_a, 1)), sum = e + r + p or 1. */
export function tchebycheffCoefficients(weights: ObjectiveWeights, ideal: IdealPoint): { ce: Rat; cr: Rat; cp: Rat } {
  const { e, r, p } = weightsOf(weights);
  const total = ratAdd(ratAdd(e, r), p);
  const sum = total.n === 0n ? ONE : total;
  const floorOne = (range: Rat): Rat => ratMax(range, ONE);
  const zE = ratFromDouble(ideal.zE);
  const nadE = ratFromDouble(ideal.nadE);
  const zR = ratFromDouble(ideal.zR);
  const nadR = ratFromDouble(ideal.nadR);
  const zP = ratFromDouble(ideal.zP);
  const nadP = ratFromDouble(ideal.nadP);
  return {
    ce: ratDiv(e, ratMul(sum, floorOne(ratSub(zE, nadE)))),
    cr: ratDiv(r, ratMul(sum, floorOne(ratSub(nadR, zR)))),
    cp: ratDiv(p, ratMul(sum, floorOne(ratSub(nadP, zP)))),
  };
}

/**
 * Plan the objective rows of a request: the exact targets, the emitted doubles, the proved frame error and the power-of-two rescaling that
 * makes every coefficient of the objective chain survive the HiGHS small-coefficient filter (or the reason it cannot).
 */
export function planObjective(weights: ObjectiveWeights, ideal: IdealPoint | null, ranges: AxisRanges): ObjectivePlan {
  const w = weightsOf(weights);
  const axisTargets: { column: ObjectiveTerm['column']; target: Rat; range: Interval }[] = [];
  const deviations: DeviationPlan[] = [];
  if (ideal === null) {
    // score = (e / 10) fE - r fR - (p / 1000) fP
    axisTargets.push(
      { column: 'ergo_axis', target: ratDiv(w.e, ERGO_SCALE_RAT), range: ranges.ergo },
      { column: 'rec_axis', target: ratSub(RAT_ZERO, w.r), range: ranges.rec },
      { column: 'price_axis', target: ratSub(RAT_ZERO, ratDiv(w.p, SCALE_RAT)), range: ranges.price },
    );
  } else {
    // score = 0.01 (c_e fE - c_r fR - c_p fP) - max over active axes of the signed deviations
    const { ce, cr, cp } = tchebycheffCoefficients(weights, ideal);
    axisTargets.push(
      { column: 'ergo_axis', target: ratMul(AUGMENTATION_RAT, ce), range: ranges.ergo },
      { column: 'rec_axis', target: ratSub(RAT_ZERO, ratMul(AUGMENTATION_RAT, cr)), range: ranges.rec },
      { column: 'price_axis', target: ratSub(RAT_ZERO, ratMul(AUGMENTATION_RAT, cp)), range: ranges.price },
    );
    const zE = ratFromDouble(ideal.zE);
    const zR = ratFromDouble(ideal.zR);
    const zP = ratFromDouble(ideal.zP);
    const mag = (range: Interval): Rat => ratMagnitude(range.lo, range.hi);
    if (weights.e > 0) {
      // t >= c_e (zE - fE)  <=>  t + c_e fE >= c_e zE
      const emitted = ratToNumber(ce);
      deviations.push({ axis: 'e', target: ce, emitted, ideal: ideal.zE, rhs: paddedRhs('>=', ratMul(ce, zE), [{ target: ce, emitted, magnitude: mag(ranges.ergo) }]) });
    }
    if (weights.r > 0) {
      // t >= c_r (fR - zR)  <=>  t - c_r fR >= -(c_r zR)
      const emitted = ratToNumber(cr);
      deviations.push({ axis: 'r', target: cr, emitted, ideal: ideal.zR, rhs: paddedRhs('>=', ratSub(RAT_ZERO, ratMul(cr, zR)), [{ target: cr, emitted, magnitude: mag(ranges.rec) }]) });
    }
    if (weights.p > 0) {
      const emitted = ratToNumber(cp);
      deviations.push({ axis: 'p', target: cp, emitted, ideal: ideal.zP, rhs: paddedRhs('>=', ratSub(RAT_ZERO, ratMul(cp, zP)), [{ target: cp, emitted, magnitude: mag(ranges.price) }]) });
    }
  }

  let frameError = RAT_ZERO;
  const terms: ObjectiveTerm[] = axisTargets.map(({ column, target, range }) => {
    const emitted = ratToNumber(target);
    const error = ratAbs(ratSub(ratFromDouble(emitted), target));
    const magnitude = ratMagnitude(range.lo, range.hi);
    const contribution = ratMul(error, magnitude);
    frameError = ratAdd(frameError, contribution);
    return {
      column, target, emitted,
      error: ratRoundUp(error), magnitude: ratRoundUp(magnitude), contribution: ratRoundUp(contribution),
    };
  });

  const columnOf: Record<AxisName, ObjectiveTerm['column']> = { e: 'ergo_axis', r: 'rec_axis', p: 'price_axis' };
  const axisScales = terms.map((t): AxisScale => chooseAxisScale(t.column, [t.emitted, ...deviations.filter(d => columnOf[d.axis] === t.column).map(d => d.emitted)]));
  return {
    kind: ideal === null ? 'weighted' : 'tchebycheff',
    terms,
    deviations,
    frameError: ratRoundUp(frameError),
    axisScales,
    withheld: axisScales.find(s => s.withheld !== null)?.withheld ?? null,
  };
}

export interface AxisScale {
  column: ObjectiveTerm['column'];
  /** The objective rows read `column / 2^exponent` through a link row (exact); 0 when every coefficient of the axis already survives. */
  exponent: number;
  factor: number;
  withheld: string | null;
}

/**
 * The power-of-two factor 2^k (k >= 0) that lifts the smallest nonzero objective coefficient of one axis column to
 * {@link MIN_SURVIVING_COEFFICIENT}. A power of two is an exact binary64 factor: the objective rows read `column_n = column / 2^k` (a link row
 * `column - 2^k column_n = 0`), every coefficient on `column_n` is the exact product `c 2^k`, and the objective and the optimum are unchanged, in
 * the oracle's own units. Only the AXIS is scaled, never the whole objective chain: scaling the chain (the deviation rows included) put
 * right-hand sides of 1e8 into rows HiGHS must satisfy to an absolute 1e-9, which no double can do (measured at a price normalization of 1e12:
 * `Solve error`, primal infeasibility 1.95e-9). With no k up to {@link MAX_AXIS_SCALE_EXPONENT} that works the axis is left as written and the
 * proof is withheld.
 */
export function chooseAxisScale(column: ObjectiveTerm['column'], coefficients: readonly number[]): AxisScale {
  const magnitudes = coefficients.map(Math.abs).filter(m => m > 0);
  if (magnitudes.length === 0) return { column, exponent: 0, factor: 1, withheld: null };
  const smallest = Math.min(...magnitudes);
  if (smallest >= MIN_SURVIVING_COEFFICIENT) return { column, exponent: 0, factor: 1, withheld: null };
  let exponent = 0;
  while (exponent <= MAX_AXIS_SCALE_EXPONENT && smallest * 2 ** exponent < MIN_SURVIVING_COEFFICIENT) exponent++;
  if (exponent > MAX_AXIS_SCALE_EXPONENT) {
    return {
      column, exponent: 0, factor: 1,
      withheld: `the objective coefficient ${smallest} of ${column} is below ${MIN_SURVIVING_COEFFICIENT / 2 ** MAX_AXIS_SCALE_EXPONENT}: no power-of-two scaling of the axis (up to 2^${MAX_AXIS_SCALE_EXPONENT}) lifts it above ${MIN_SURVIVING_COEFFICIENT}`,
    };
  }
  return { column, exponent, factor: 2 ** exponent, withheld: null };
}

// ---------------------------------------------------------------------------------------------
// The exact score of a verified build (the incumbent) and its enclosure
// ---------------------------------------------------------------------------------------------

export interface ExactAxes {
  fE: Rat;
  fR: Rat;
  fP: Rat;
}

/** The exact objective axes of a build from the validator's canonical rational statistics. */
export function exactAxes(exact: Readonly<Record<'ergonomics' | 'ted' | 'recoilModifierSum' | 'spend', string>>, useTrueErgo: boolean): ExactAxes {
  return {
    fE: ratMul(ERGO_SCALE_RAT, ratFromString(useTrueErgo ? exact.ted : exact.ergonomics)),
    fR: ratMul(SCALE_RAT, ratFromString(exact.recoilModifierSum)),
    fP: ratFromString(exact.spend),
  };
}

/**
 * The exact objective value of a build (ADR 0010 section 2): the weighted sum, or the augmented Tchebycheff score
 * `0.01 (c_e fE - c_r fR - c_p fP) - max_active d_a` with the signed deviations and no outer zero clamp. The oracle's definition, in exact rationals
 * of the resolved binary64 weights and of the payoff table's leaves.
 */
export function exactObjectiveScore(weights: ObjectiveWeights, ideal: IdealPoint | null, axes: ExactAxes): Rat {
  const w = weightsOf(weights);
  if (ideal === null) {
    return ratSub(ratSub(ratMul(ratDiv(w.e, ERGO_SCALE_RAT), axes.fE), ratMul(w.r, axes.fR)), ratMul(ratDiv(w.p, SCALE_RAT), axes.fP));
  }
  const { ce, cr, cp } = tchebycheffCoefficients(weights, ideal);
  const augmented = ratMul(AUGMENTATION_RAT, ratSub(ratSub(ratMul(ce, axes.fE), ratMul(cr, axes.fR)), ratMul(cp, axes.fP)));
  const deviations: Rat[] = [];
  if (weights.e > 0) deviations.push(ratMul(ce, ratSub(ratFromDouble(ideal.zE), axes.fE)));
  if (weights.r > 0) deviations.push(ratMul(cr, ratSub(axes.fR, ratFromDouble(ideal.zR))));
  if (weights.p > 0) deviations.push(ratMul(cp, ratSub(axes.fP, ratFromDouble(ideal.zP))));
  const maxDeviation = deviations.length === 0 ? RAT_ZERO : deviations.reduce((a, b) => (ratCmp(a, b) >= 0 ? a : b));
  return ratSub(augmented, maxDeviation);
}

/**
 * The a-priori cap bound (owner decision 2026-10-18, amending G1; `docs/proofs/count-model.md` section 16): an upper bound of the exact score of every
 * build whose weight lies in `interval`, from the objective's structure alone, with no solve. It applies when {@link exactObjectiveScore} is `e x TED`:
 * a weighted sum (no ideal point) with TED as the ergonomics axis and recoil and price weights 0. TED = eff - q(W) with eff <= 100 (both ergonomics
 * clamps) and q nondecreasing, so a build with W >= lo has fE <= 10 (100 - q(lo)), and the score is nondecreasing in fE (e >= 0) and blind to fR and fP.
 * Same arguments as {@link exactObjectiveScore}; `null` for any other objective.
 */
export function aprioriScoreBound(weights: ObjectiveWeights, ideal: IdealPoint | null, useTrueErgo: boolean, interval: WeightInterval): Rat | null {
  if (!useTrueErgo || ideal !== null || weights.r !== 0 || weights.p !== 0 || !(Number.isFinite(weights.e) && weights.e >= 0)) return null;
  const tedCap = ratSub(HUNDRED, exactWeightPenalty(ratFromDouble(interval.lo)));
  return exactObjectiveScore(weights, null, { fE: ratMul(ERGO_SCALE_RAT, tedCap), fR: RAT_ZERO, fP: RAT_ZERO });
}

export interface ScoreEnclosure {
  /** The exact score rounded to nearest (what is shown). */
  nominal: number;
  /** The largest double at most the exact score: the proof lower bound. */
  lower: number;
  /** The smallest double at least the exact score: the incumbent's part of the upper bound. */
  upper: number;
  exact: Rat;
}

export function scoreEnclosure(score: Rat): ScoreEnclosure {
  return { nominal: ratToNumber(score), lower: ratRoundDown(score), upper: ratRoundUp(score), exact: score };
}

// ---------------------------------------------------------------------------------------------
// The corrected upper bound of one node
// ---------------------------------------------------------------------------------------------

/**
 * What was proved about the solve of one node (a `NodeEvaluation` carries it; `nodeUpperBound` in `search.ts` turns it into a bound).
 */
export interface BoundEvidence {
  /** The native MIP dual bound converted to the oracle's frame (divided by the exact power-of-two scale); null when none was reported. */
  nativeDual: number | null;
  /** The solve was qualified: model readback verified, allowances dominate, tolerances as declared, no proof input withheld. */
  qualified: boolean;
  /** Proved upper bound of |true objective - emitted objective| over the node, oracle units (`ObjectivePlan.frameError`). */
  frameError: number;
}

/**
 * The upper bound a qualified native dual bound proves, EXACT: `UB_native + frame error` as a rational (both are binary64 values, so the
 * sum is exact and needs no rounding; the ADR's `nextUp` only covers the rounding of a floating sum, which this does not do). `null` when
 * the evidence is unqualified or the native bound is missing or not finite (an unqualified component is unknown, never a finite guess).
 * Keeping the bound as a rational lets the search compare it with the incumbent's exact score without a representational ulp: at an
 * objective of 9e6 one ulp is 1.9e-9, larger than a 1e-9 tolerance, so a double-only gap could never certify there.
 */
export function upperBoundExact(evidence: BoundEvidence | null): Rat | null {
  if (evidence === null || !evidence.qualified) return null;
  const { nativeDual, frameError } = evidence;
  if (nativeDual === null || !Number.isFinite(nativeDual) || !Number.isFinite(frameError) || frameError < 0) return null;
  return ratAdd(ratFromDouble(nativeDual), ratFromDouble(frameError));
}

/** {@link upperBoundExact} enclosed by the smallest double above it (what is reported), or null when unknown. */
export function upperBoundOf(evidence: BoundEvidence | null): number | null {
  const exact = upperBoundExact(evidence);
  if (exact === null) return null;
  try {
    return ratRoundUp(exact);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Exact interval helpers (the finite domains of constructed auxiliary columns)
// ---------------------------------------------------------------------------------------------

/** The double enclosure `[lo, hi]` of an exact rational interval: rounded outward, never inward. */
export const ratEnclosure = (lo: Rat, hi: Rat): Interval => ({ lo: ratRoundDown(lo), hi: ratRoundUp(hi) });

/** The exact interval `a - b` (a minus b, as intervals) of two double intervals, as a double enclosure. */
export function differenceEnclosure(a: Interval, b: Interval): Interval {
  return ratEnclosure(ratSub(ratFromDouble(a.lo), ratFromDouble(b.hi)), ratSub(ratFromDouble(a.hi), ratFromDouble(b.lo)));
}

// ---------------------------------------------------------------------------------------------
// What a specialized model records about its own proof inputs
// ---------------------------------------------------------------------------------------------

export interface SecantProof {
  kind: string;
  weightMin: number;
  weightMax: number;
  line: { slope: number; intercept: number };
  /** How far below the real line the emitted line sits, in ergonomics points (>= 0; the emitted line is verified at or below q on the node). */
  shift: number;
  /** The shift carried through the objective's actual coefficients on TED (a weighted `e`, or Tchebycheff's c_e x (0.01 + deviation)): the most the shift can add to the objective. */
  objectiveUnits: number | null;
  exact: boolean;
}

export interface GearProof {
  target: Rat;
  low: number;
  high: number;
}

/** The proof inputs of one specialized model (see the module comment). Immutable. */
export interface ModelProof {
  readonly version: 1;
  /** Every constructed row with its padded right-hand side and the exact need a parsed model must dominate. */
  readonly rows: readonly RowProof[];
  readonly objective: ObjectivePlan | null;
  readonly gear: GearProof | null;
  readonly secant: SecantProof | null;
  /** Non-null: a proof input failed at construction (an axis whose objective coefficient no power-of-two scale can lift above the filter, a constructed value beyond the doubles). Bounds and infeasibility are withheld. */
  readonly withheld: string | null;
}

/** The proof of a model that needs none (an empty domain): nothing constructed, nothing withheld. */
export const EMPTY_MODEL_PROOF: ModelProof = {
  version: 1,
  rows: [],
  objective: null,
  gear: null,
  secant: null,
  withheld: null,
};
