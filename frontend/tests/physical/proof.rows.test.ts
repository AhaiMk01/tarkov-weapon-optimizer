// The construction error of every constructed coefficient, proved on the exact rational path (src/solver/physical/proof.ts, spatial.ts): each
// emitted row is an OUTER relaxation of its target row (every real point meeting the target meets the emitted row), the secant of the weight
// penalty is verified at or below q, the objective carries its proved frame error and an exact power-of-two scale, and the incumbent's score is
// the exact rational of the oracle's definition. Boundary cases, narrow intervals, the 3 kg knee and negative or zero inputs are explicit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RAT_ZERO, rat, ratAdd, ratCmp, ratDiv, ratFromDouble, ratInt, ratMul, ratString, ratSub, ratToNumber, type Rat,
} from '../../src/solver/physical/exact';
import { ratAbs, ratFromString, ratRoundUp } from '../../src/solver/physical/rational';
import {
  MAX_AXIS_SCALE_EXPONENT, MIN_SURVIVING_COEFFICIENT, MOA_K_RATIONAL, chooseAxisScale, exactAxes, exactObjectiveScore, gearEnclosure, gearFactor,
  moaFallbackRow, moaReplacementRow, paddedRhs, planObjective, scoreEnclosure, tchebycheffCoefficients, upperBoundExact, upperBoundOf,
} from '../../src/solver/physical/proof';
import {
  exactWeightPenalty, lineEnclosure, penaltyLineIsValid, secantOfPenalty, TED_FREE_WEIGHT_KG, weightPenalty,
} from '../../src/solver/physical/spatial';
import { nextDown, nextUp } from '../../src/solver/physical/numeric';

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const R = ratFromDouble;
const HUNDRED = ratInt(100);

// ---------------------------------------------------------------------------------------------
// MOA rows
// ---------------------------------------------------------------------------------------------

/** The target row of ADR 0007 section 1, in exact rationals: c/100 A - M x >= c - L - M, with c = coi K and M the emitted Big-M. */
function targetHolds(coi: number, limit: number, bigM: number, a: Rat, x: 0 | 1): boolean {
  const c = ratMul(R(coi), MOA_K_RATIONAL);
  const left = ratSub(ratMul(ratDiv(c, HUNDRED), a), ratMul(R(bigM), ratInt(x)));
  return ratCmp(left, ratSub(ratSub(c, R(limit)), R(bigM))) >= 0;
}

function emittedHolds(plan: { coefficient: number; bigM: number; rhs: { emitted: number } }, a: Rat, x: 0 | 1): boolean {
  const left = ratSub(ratMul(R(plan.coefficient), a), ratMul(R(plan.bigM), ratInt(x)));
  return ratCmp(left, R(plan.rhs.emitted)) >= 0;
}

test('a replacement row is an outer relaxation: every real accuracy that meets the exact target meets the emitted row, on the exact MOA boundary too', () => {
  const next = lcg(34);
  const cois = [0.0625, 0.125, 0.5, 0.1, 1 / 3, 0.0043, 2.3, 100];
  const accuracyRanges = [{ lo: -10, hi: 0 }, { lo: -5, hi: 20 }, { lo: -0.3, hi: 0.3 }, { lo: 0, hi: 0 }, { lo: -35.5, hi: 12.25 }];
  let checked = 0;
  for (const coi of cois) {
    const K = ratToNumber(MOA_K_RATIONAL);
    for (const accuracy of accuracyRanges) {
      for (const limit of [0.5, 2, 4.297, coi * K, coi * K * 1.1, 17.189, 1e3, -1, 0]) {
        const plan = moaReplacementRow(coi, limit, accuracy);
        assert.ok(plan.bigM >= 0);
        const c = ratMul(R(coi), MOA_K_RATIONAL);
        // the accuracy at which MOA = L exactly: c (1 - A/100) = L  <=>  A = 100 (1 - L / c)
        const boundary = ratMul(HUNDRED, ratSub(ratInt(1), ratDiv(R(limit), c)));
        const samples: Rat[] = [R(accuracy.lo), R(accuracy.hi), boundary, ratAdd(boundary, rat(1n, 1n << 60n)), ratSub(boundary, rat(1n, 1n << 60n))];
        for (let k = 0; k < 12; k++) samples.push(ratAdd(R(accuracy.lo), ratMul(ratDiv(rat(BigInt(Math.floor(next() * 1e6)), 1000000n), ratInt(1)), ratSub(R(accuracy.hi), R(accuracy.lo)))));
        for (const a of samples) {
          // the proof is over the accuracy DOMAIN: a sample outside it (the boundary can lie anywhere) says nothing
          if (ratCmp(a, R(accuracy.lo)) < 0 || ratCmp(a, R(accuracy.hi)) > 0) continue;
          for (const x of [0, 1] as const) {
            checked++;
            if (targetHolds(coi, limit, plan.bigM, a, x)) assert.ok(emittedHolds(plan, a, x), `coi ${coi} L ${limit} A ${ratString(a)} x ${x}`);
          }
        }
        // the barrel being absent must never bind: with x = 0 the emitted row holds over the WHOLE accuracy domain
        for (const edge of [accuracy.lo, accuracy.hi]) assert.ok(emittedHolds(plan, R(edge), 0), `coi ${coi} L ${limit}: x = 0 is vacuous at A = ${edge}`);
        // and the padding is exactly what the coefficient deficit needs: no more than one ulp of slack beyond it
        const magnitude = Math.max(Math.abs(accuracy.lo), Math.abs(accuracy.hi));
        assert.ok(plan.rhs.coefficientError >= 0 && plan.rhs.allowance >= plan.rhs.coefficientError - 1e-300);
        assert.ok(plan.rhs.coefficientError <= 2 ** -50 * Math.abs(coi * K / 100) * Math.max(1, magnitude) + 1e-300, 'the deficit is a few ulps of the coefficient times the range');
      }
    }
  }
  assert.ok(checked > 1000);
});

test('the proved coefficient deficit is within the ADR 0007 gamma-3 bound for c (1 - A / 100) and never larger than the analytic estimate', () => {
  const u = 2 ** -53;
  const gamma3 = (3 * u) / (1 - 3 * u);
  for (const [coi, aMin] of [[0.0625, -10], [0.5, -5], [0.1, -35.5], [2.3, -0.3]] as const) {
    const c = coi * ratToNumber(MOA_K_RATIONAL);
    const plan = moaReplacementRow(coi, 4, { lo: aMin, hi: 5 });
    // the analytic bound of the MOA^max computation, for A <= 0: gamma3 |c| (1 + |A|/100) + Delta_c (1 + |A|/100) + (|c| + Delta_c)/100 Delta_A
    // with Delta_c = rounding of K x coi (<= u |c|) and Delta_A = 0 (the accuracy bound is a leaf here). The row's own deficit is the exact
    // quantity |c'/100 - c/100| x B_A, which the same u-level analysis bounds by u (c/100) B_A.
    const analytic = gamma3 * Math.abs(c) * (1 + Math.abs(aMin) / 100) + u * Math.abs(c) * (1 + Math.abs(aMin) / 100);
    const rowAnalytic = u * (Math.abs(c) / 100) * Math.max(Math.abs(aMin), 5);
    assert.ok(plan.rhs.coefficientError <= rowAnalytic * (1 + 1e-9) + 1e-300, `coi ${coi}: exact deficit ${plan.rhs.coefficientError} within u c/100 B_A = ${rowAnalytic}`);
    assert.ok(rowAnalytic <= analytic, 'the row deficit is far below the MOA^max operation bound');
  }
});

test('the fallback row: unconditional without barrels, with a Big-M on the barrel selector with them, and a zero intrinsic centre of impact keeps its constant row', () => {
  const accuracy = { lo: -10, hi: 0 };
  const alone = moaFallbackRow(0.0625, 4, accuracy, false);
  assert.equal(alone.bigM, 0, 'no barrel selector: nothing to relax');
  const withBarrels = moaFallbackRow(0.0625, 2, accuracy, true);
  assert.ok(withBarrels.bigM > 0, 'a cap below the worst intrinsic MOA needs a barrel to be installed');
  // c0/100 A + M >= c0 - L must hold for EVERY accuracy of the domain when a barrel is installed (the sum of selectors is at least 1)
  assert.ok(ratCmp(ratAdd(ratMul(R(withBarrels.coefficient), R(accuracy.lo)), R(withBarrels.bigM)), R(withBarrels.rhs.emitted)) >= 0);
  const zero = moaFallbackRow(0, 3, accuracy, true);
  assert.equal(zero.coefficient, 0);
  assert.equal(zero.bigM, 0, 'intrinsic MOA 0 never exceeds a cap of 3');
  assert.equal(zero.rhs.emitted, -3, 'the constant row 0 >= -L is kept exactly');
  const forcing = moaFallbackRow(0, -0.5, accuracy, true);
  assert.equal(forcing.bigM, 0.5, 'a negative cap forces a barrel: M = -L');
});

// ---------------------------------------------------------------------------------------------
// Recoil caps and the gear factor
// ---------------------------------------------------------------------------------------------

test('a recoil cap right-hand side is the smallest double at least the exact cap - naked, for any sign of naked recoil, so no build the exact cap admits is cut', () => {
  const magnitude = R(1);
  for (const [naked, cap] of [[0, 50], [-5.5, 10], [165.3, 120.7], [0.1, 0.3], [0.3, 0.1], [250, 250]] as const) {
    const padded = paddedRhs('<=', ratSub(R(cap), R(naked)), [{ target: R(naked), emitted: naked, magnitude }]);
    assert.ok(ratCmp(R(padded.emitted), ratSub(R(cap), R(naked))) >= 0, `cap ${cap} naked ${naked}`);
    assert.ok(ratCmp(R(nextDown(padded.emitted)), ratSub(R(cap), R(naked))) < 0 || padded.emitted === nextDown(padded.emitted));
    assert.equal(padded.coefficientError, 0, 'the coefficient is the leaf itself');
  }
  // 0.3 - 0.1 is not a double: the exact value is 0.19999999999999998335..., and the emitted one is the next double up
  const exactDifference = ratSub(R(0.3), R(0.1));
  assert.equal(ratCmp(R(0.3 - 0.1), exactDifference) === 0, true, 'this particular difference happens to be exact');
  const inexact = ratSub(R(1), R(0.1));
  const padded = paddedRhs('<=', inexact, [{ target: R(0.1), emitted: 0.1, magnitude }]);
  assert.ok(ratCmp(R(padded.emitted), inexact) >= 0 && padded.emitted >= 1 - 0.1);
});

test('a recoil sum cap with a coefficient that is a rounded sum pads its right-hand side by the exact deficit times the modifier range', () => {
  const nakedV = 0.1;
  const nakedH = 0.2;
  const total = ratAdd(R(nakedV), R(nakedH));
  const coefficient = ratToNumber(total);
  const range = { lo: -0.4, hi: 0.3 };
  const padded = paddedRhs('<=', ratSub(R(1), total), [{ target: total, emitted: coefficient, magnitude: R(Math.max(Math.abs(range.lo), Math.abs(range.hi))) }]);
  // every modifier m in the range meeting the exact cap (nakedV + nakedH) m <= 1 - (nakedV + nakedH) meets the emitted row
  const next = lcg(5);
  for (let k = 0; k < 200; k++) {
    const m = ratAdd(R(range.lo), ratMul(rat(BigInt(Math.floor(next() * 1e9)), 1000000000n), ratSub(R(range.hi), R(range.lo))));
    const exactHolds = ratCmp(ratMul(total, m), ratSub(R(1), total)) <= 0;
    const emittedHolds = ratCmp(ratMul(R(coefficient), m), R(padded.emitted)) <= 0;
    if (exactHolds) assert.ok(emittedHolds);
  }
  assert.ok(padded.coefficientError > 0 || ratCmp(R(coefficient), total) === 0);
});

test('the gear factor is max(0, 1 + modifier) in exact rationals: representable factors give one equality, others the two neighbouring doubles', () => {
  const exact = gearFactor(-0.25);
  assert.equal(exact.low, 0.75);
  assert.equal(exact.high, 0.75, 'a representable factor needs no enclosure');
  const inexact = gearFactor(-0.15);
  assert.ok(inexact.low < inexact.high && inexact.high === nextUp(inexact.low));
  assert.ok(ratCmp(R(inexact.low), inexact.target) < 0 && ratCmp(R(inexact.high), inexact.target) > 0);
  assert.equal(gearFactor(-1).low, 0);
  assert.equal(gearFactor(-2).high, 0, 'a negative factor is floored at zero');
  assert.equal(gearFactor(0).low, 1);
  const above = gearFactor(0.2);
  assert.ok(above.low <= 1.2 && above.high > 1.2 && above.high === nextUp(above.low), '1 + 0.2 lies between two doubles');
  // the enclosure of gear = f x capped contains the exact value for every capped in range
  const capped = { lo: 0, hi: 100 };
  const enclosure = gearEnclosure(inexact, capped);
  for (const value of [0, 1 / 3, 50, 99.99999999999999, 100]) {
    const gear = ratMul(inexact.target, R(value));
    assert.ok(ratCmp(R(enclosure.lo), gear) <= 0 && ratCmp(R(enclosure.hi), gear) >= 0, `capped ${value}`);
  }
  assert.throws(() => gearEnclosure(inexact, { lo: -1, hi: 1 }), RangeError, 'the first clamp is never negative');
});

// ---------------------------------------------------------------------------------------------
// The weight-penalty secant
// ---------------------------------------------------------------------------------------------

/** The binary64 secant a naive implementation writes: closed forms, no verification. */
function naiveSecant(lo: number, hi: number): { slope: number; intercept: number } {
  return { slope: 300 / (lo * hi), intercept: 100 - 300 / lo - 300 / hi };
}

test('the secant is a verified lower envelope of q: exact at the ends it must be, shifted by exactly what the construction error needs, never above', () => {
  const next = lcg(11);
  const intervals: [number, number][] = [[3, 3.5], [3, 3 + 2 ** -30], [4, 4 + 1e-9], [4, 5], [3.1, 3.7], [10.3, 10.3000001], [7, 12], [5.5, 5.5 + 2 ** -45], [3, 20], [100, 101]];
  for (let k = 0; k < 400; k++) {
    const lo = 3 + next() * 12;
    intervals.push([lo, lo * (1 + 10 ** -(1 + Math.floor(next() * 12)))]);
  }
  let nakedInvalid = 0;
  for (const [lo, hi] of intervals) {
    if (!(lo < hi)) continue;
    const penalty = secantOfPenalty(lo, hi);
    assert.equal(penalty.kind, 'secant');
    assert.ok(penaltyLineIsValid(lo, hi, penalty.line), `[${lo}, ${hi}] the emitted line is at or below q (exact)`);
    // the line is below the exact chord by `shift` at most: tight, not padded
    const chordAtLo = exactWeightPenalty(R(lo));
    const lineAtLo = ratAdd(ratMul(R(penalty.line.slope), R(lo)), R(penalty.line.intercept));
    assert.ok(ratCmp(ratSub(chordAtLo, lineAtLo), R(penalty.shift)) <= 0, `[${lo}, ${hi}] the gap to q at lo is within the reported shift`);
    assert.ok(penalty.shift >= 0 && penalty.shift < 1e-10, `shift ${penalty.shift}`);
    const naive = naiveSecant(lo, hi);
    if (!penaltyLineIsValid(lo, hi, naive)) nakedInvalid++;
  }
  assert.ok(nakedInvalid > 0, 'the unverified binary64 secant is above q for some of these intervals: that is the defect the exact shift removes');
});

test('narrow intervals, the knee and singletons: kinds, exactness and validity', () => {
  // singleton above 3 kg: q(W) as a constant, rounded DOWN, exact up to the reported shift
  const single = secantOfPenalty(4.1, 4.1);
  assert.equal(single.kind, 'constant_exact');
  assert.equal(single.line.slope, 0);
  assert.ok(ratCmp(R(single.line.intercept), exactWeightPenalty(R(4.1))) <= 0);
  assert.ok(ratCmp(ratSub(exactWeightPenalty(R(4.1)), R(single.line.intercept)), R(single.shift)) <= 0);
  // exactly 3 kg: q = 0, the zero line, exact
  assert.deepEqual(secantOfPenalty(3, 3), { line: { slope: 0, intercept: 0 }, kind: 'zero_exact', exact: true, shift: 0 });
  assert.equal(secantOfPenalty(1, 3).kind, 'zero_exact');
  // across the knee only q >= 0 holds: the zero line, a relaxation, valid on the whole interval
  const knee = secantOfPenalty(2, 5);
  assert.deepEqual(knee, { line: { slope: 0, intercept: 0 }, kind: 'knee_zero_relaxation', exact: false, shift: 0 });
  assert.ok(penaltyLineIsValid(2, 5, knee.line));
  // an interval starting exactly at the knee uses a chord (q(3) = 0 is an end of the concave piece)
  const atKnee = secantOfPenalty(3, 3.0000000001);
  assert.equal(atKnee.kind, 'secant');
  assert.ok(penaltyLineIsValid(3, 3.0000000001, atKnee.line));
  // the weight penalty itself is zero up to 3 kg, 100 - 300/W above
  assert.equal(weightPenalty(TED_FREE_WEIGHT_KG), 0);
  assert.deepEqual(exactWeightPenalty(R(6)), ratInt(50));
  assert.deepEqual(exactWeightPenalty(R(2.5)), RAT_ZERO);
  // an empty or non-finite interval is refused
  assert.throws(() => secantOfPenalty(5, 4), RangeError);
  assert.throws(() => secantOfPenalty(Number.NaN, 4), RangeError);
});

test('a supplied line is checked with no slack and in exact arithmetic: one ulp above q at an end is invalid', () => {
  assert.equal(penaltyLineIsValid(4, 5, { slope: 15, intercept: -35 }), true, 'the exact chord');
  assert.equal(penaltyLineIsValid(4, 5, { slope: 15, intercept: nextUp(-35) }), false, 'one ulp above the chord is above q at both ends');
  assert.equal(penaltyLineIsValid(4, 5, { slope: 15, intercept: nextDown(-35) }), true);
  assert.equal(penaltyLineIsValid(4, 5, { slope: 15, intercept: -35 + 1e-12 }), false, 'a 1e-12 excess is invalid: no fixed 1e-9 slack');
  assert.equal(penaltyLineIsValid(4, 5, { slope: 15, intercept: -35 + 1e-12 }, 1e-9), true, 'unless the caller states a slack');
  assert.equal(penaltyLineIsValid(2, 5, { slope: 0, intercept: 0 }), true);
  assert.equal(penaltyLineIsValid(2, 5, { slope: 1, intercept: 0 }), false, 'above q at the knee');
  assert.equal(penaltyLineIsValid(5, 4, { slope: 0, intercept: 0 }), false);
});

test('the line enclosure contains the line at every real weight of the node, rounded outward', () => {
  const penalty = secantOfPenalty(4, 5.5);
  const enclosure = lineEnclosure(penalty.line, 4, 5.5);
  const next = lcg(9);
  for (let k = 0; k < 100; k++) {
    const w = ratAdd(R(4), ratMul(rat(BigInt(Math.floor(next() * 1e9)), 1000000000n), R(1.5)));
    const value = ratAdd(ratMul(R(penalty.line.slope), w), R(penalty.line.intercept));
    assert.ok(ratCmp(R(enclosure.lo), value) <= 0 && ratCmp(R(enclosure.hi), value) >= 0);
  }
});

// ---------------------------------------------------------------------------------------------
// The objective: frame error, scale, exact score
// ---------------------------------------------------------------------------------------------

const ranges = { ergo: { lo: 0, hi: 1000 }, rec: { lo: -500, hi: 500 }, price: { lo: 0, hi: 1e6 } };

test('the weighted objective carries the exact error of e/10 and p/1000 times the axis magnitudes, and its recoil coefficient is the leaf itself', () => {
  const plan = planObjective({ e: 3, r: 0.7, p: 1 }, null, ranges);
  assert.equal(plan.kind, 'weighted');
  const [ergo, rec, price] = plan.terms;
  assert.equal(ergo.emitted, 0.3);
  assert.ok(ergo.emitted < 0.3 === false || ergo.emitted === 3 / 10, 'e / 10 is the correctly rounded quotient');
  assert.deepEqual(ergo.target, rat(3n, 10n));
  assert.equal(rec.emitted, -0.7);
  assert.equal(rec.error, 0, 'the recoil weight is a leaf: no construction error');
  assert.deepEqual(price.target, rat(-1n, 1000n));
  // the frame error is exactly sum |c' - c| B, rounded up
  const errorE = ratAbs(ratSub(R(ergo.emitted), rat(3n, 10n)));
  const errorP = ratAbs(ratSub(R(price.emitted), rat(-1n, 1000n)));
  const exactTotal = ratAdd(ratMul(errorE, R(1000)), ratMul(errorP, R(1e6)));
  assert.equal(plan.frameError, ratRoundUp(exactTotal));
  assert.ok(plan.frameError > 0 && plan.frameError < 1e-9);
  assert.ok(plan.axisScales.every(s => s.exponent === 0 && s.factor === 1), 'every coefficient survives: no axis is scaled');
  assert.equal(plan.deviations.length, 0);
  // a weight that is exact in binary64 after the division has no frame error at all
  assert.equal(planObjective({ e: 5, r: 1, p: 0 }, null, ranges).frameError, 0);
});

test('Tchebycheff: exact normalization coefficients with the floor of one, padded deviation rows, and a frame error through the 0.01 augmentation', () => {
  const ideal = { zE: 150, nadE: 100, zR: -100, nadR: 0, zP: 5000, nadP: 6000 };
  const coefficients = tchebycheffCoefficients({ e: 1, r: 1, p: 0 }, ideal);
  assert.deepEqual(coefficients.ce, rat(1n, 100n), 'c_e = 1 / (2 x 50)');
  assert.deepEqual(coefficients.cr, rat(1n, 200n));
  assert.deepEqual(coefficients.cp, RAT_ZERO, 'an inactive axis has coefficient 0');
  const plan = planObjective({ e: 1, r: 1, p: 0 }, ideal, ranges);
  assert.equal(plan.kind, 'tchebycheff');
  assert.deepEqual(plan.deviations.map(d => d.axis), ['e', 'r'], 'only axes with a positive weight deviate');
  for (const d of plan.deviations) {
    assert.ok(d.rhs.coefficientError > 0 || d.emitted === ratToNumber(d.target), 'the padded row records its deficit');
    assert.equal(d.rhs.emitted <= ratToNumber(d.rhs.need) || ratCmp(R(d.rhs.emitted), d.rhs.need) <= 0, true, '>= rows move down');
  }
  // the normalization floor: a payoff range under one reads as one
  const floor = tchebycheffCoefficients({ e: 1, r: 0, p: 0 }, { zE: 110, nadE: 109.5, zR: 0, nadR: 0, zP: 0, nadP: 0 });
  assert.deepEqual(floor.ce, ratInt(1));
  // all-zero weights: sum reads as 1, every coefficient is 0
  const zero = tchebycheffCoefficients({ e: 0, r: 0, p: 0 }, ideal);
  assert.deepEqual([zero.ce, zero.cr, zero.cp], [RAT_ZERO, RAT_ZERO, RAT_ZERO]);
  assert.deepEqual(planObjective({ e: 0, r: 0, p: 0 }, ideal, ranges).deviations, []);
});

test('an axis scale is an exact power of two: none when every coefficient survives, the smallest k that lifts the smallest one, withheld when no k up to 2^40 does', () => {
  const none = (column: 'price_axis'): ReturnType<typeof chooseAxisScale> => ({ column, exponent: 0, factor: 1, withheld: null });
  assert.deepEqual(chooseAxisScale('price_axis', [0.1, 1, 0.001]), none('price_axis'));
  assert.deepEqual(chooseAxisScale('price_axis', []), none('price_axis'));
  assert.deepEqual(chooseAxisScale('price_axis', [0, 0]), none('price_axis'), 'zero coefficients are absent, not small');
  assert.equal(chooseAxisScale('price_axis', [MIN_SURVIVING_COEFFICIENT, 1]).exponent, 0, 'exactly the floor survives');
  assert.equal(chooseAxisScale('price_axis', [nextDown(MIN_SURVIVING_COEFFICIENT), 1]).exponent, 1, 'just below it needs one doubling');
  const wide = chooseAxisScale('price_axis', [3.3e-11, 3.3e-9]);
  assert.equal(wide.exponent, 15);
  assert.equal(wide.factor, 2 ** 15);
  assert.ok(3.3e-11 * wide.factor >= MIN_SURVIVING_COEFFICIENT);
  // the product is exact: dividing back returns the coefficient bit for bit
  for (const c of [3.3e-11, 0.003, 1 / 3]) assert.equal((c * wide.factor) / wide.factor, c);
  const lowest = MIN_SURVIVING_COEFFICIENT / 2 ** MAX_AXIS_SCALE_EXPONENT;
  assert.equal(chooseAxisScale('price_axis', [lowest, 1]).exponent, MAX_AXIS_SCALE_EXPONENT, 'the last legal coefficient');
  const impossible = chooseAxisScale('price_axis', [lowest / 2, 1]);
  assert.equal(impossible.factor, 1);
  assert.match(impossible.withheld ?? '', /no power-of-two scaling of the axis/);
  assert.equal(chooseAxisScale('rec_axis', [-3.3e-11]).exponent, 15, 'the sign does not matter');
  // a plan scales only the axis that needs it, from the smaller of its objective and deviation coefficients
  const plan = planObjective({ e: 1, r: 1, p: 1 }, { zE: 100, nadE: 0, zR: -100, nadR: 0, zP: 0, nadP: 1e8 }, ranges);
  assert.deepEqual(plan.axisScales.map(s => [s.column, s.exponent]), [['ergo_axis', 0], ['rec_axis', 0], ['price_axis', 15]]);
  assert.equal(plan.withheld, null);
  assert.match(planObjective({ e: 1, r: 1, p: 1 }, { zE: 100, nadE: 0, zR: -100, nadR: 0, zP: 0, nadP: 1e30 }, ranges).withheld ?? '', /price_axis/);
});

test('the exact objective score is the oracle definition in rationals: weighted sums are not the float sums, Tchebycheff keeps signed deviations, zero weights score zero', () => {
  // ADR 0010: with binary64 weights e = 0.4, r = 0.6, p = 0, A (fE 600, fR -100) and B (fE 500, fR -300) do NOT score exactly 84 and 200
  const a = exactObjectiveScore({ e: 0.4, r: 0.6, p: 0 }, null, { fE: ratInt(600), fR: ratInt(-100), fP: RAT_ZERO });
  const b = exactObjectiveScore({ e: 0.4, r: 0.6, p: 0 }, null, { fE: ratInt(500), fR: ratInt(-300), fP: RAT_ZERO });
  assert.notDeepEqual(a, ratInt(84));
  assert.notDeepEqual(b, ratInt(200));
  assert.ok(Math.abs(ratToNumber(a) - 84) < 1e-12 && Math.abs(ratToNumber(b) - 200) < 1e-12);
  // the enclosure brackets the exact score and equals it when it is a double
  for (const score of [a, b, ratInt(5), rat(-93n, 400n)]) {
    const e = scoreEnclosure(score);
    assert.ok(ratCmp(R(e.lower), score) <= 0 && ratCmp(R(e.upper), score) >= 0);
    assert.ok(e.nominal === e.lower || e.nominal === e.upper);
  }
  assert.equal(scoreEnclosure(ratInt(5)).lower, 5);
  assert.equal(scoreEnclosure(ratInt(5)).upper, 5);
  // augmented Tchebycheff against the objective test's table: build a (fE 150, fR -50): 0.01 (1.5 + 0.25) - max(0, 0.25) = -93/400
  const ideal = { zE: 150, nadE: 100, zR: -100, nadR: 0, zP: 5000, nadP: 6000 };
  const tch = exactObjectiveScore({ e: 1, r: 1, p: 0 }, ideal, { fE: ratInt(150), fR: ratInt(-50), fP: ratInt(5100) });
  assert.deepEqual(tch, rat(-93n, 400n));
  // all-zero weights: no active axis, score zero for every build, weighted and Tchebycheff
  assert.deepEqual(exactObjectiveScore({ e: 0, r: 0, p: 0 }, null, { fE: ratInt(7), fR: ratInt(-3), fP: ratInt(99) }), RAT_ZERO);
  assert.deepEqual(exactObjectiveScore({ e: 0, r: 0, p: 0 }, ideal, { fE: ratInt(7), fR: ratInt(-3), fP: ratInt(99) }), RAT_ZERO);
  // axes come from the validator's canonical strings
  const axes = exactAxes({ ergonomics: '60', ted: '37/2', recoilModifierSum: '-1/20', spend: '5100' }, true);
  assert.deepEqual(axes, { fE: ratInt(185), fR: ratInt(-50), fP: ratInt(5100) });
  assert.deepEqual(exactAxes({ ergonomics: '60', ted: '37/2', recoilModifierSum: '-1/20', spend: '5100' }, false).fE, ratInt(600));
  assert.deepEqual(ratFromString('-93/400'), rat(-93n, 400n));
});

// ---------------------------------------------------------------------------------------------
// The corrected bound of one node
// ---------------------------------------------------------------------------------------------

test('a node bound is the qualified native bound plus the frame error, exactly: unqualified, missing or non-finite evidence is unknown, never a finite guess', () => {
  assert.deepEqual(upperBoundExact({ nativeDual: 7, qualified: true, frameError: 0.5 }), rat(15n, 2n));
  assert.equal(upperBoundOf({ nativeDual: 7, qualified: true, frameError: 0.5 }), 7.5);
  assert.equal(upperBoundOf({ nativeDual: 1, qualified: true, frameError: 2 ** -60 }), nextUp(1), 'a sum that is not a double is enclosed by the double above');
  for (const evidence of [
    null,
    { nativeDual: 7, qualified: false, frameError: 0 },
    { nativeDual: null, qualified: true, frameError: 0 },
    { nativeDual: Infinity, qualified: true, frameError: 0 },
    { nativeDual: Number.NaN, qualified: true, frameError: 0 },
    { nativeDual: 7, qualified: true, frameError: Infinity },
    { nativeDual: 7, qualified: true, frameError: -1 },
  ]) {
    assert.equal(upperBoundExact(evidence), null);
    assert.equal(upperBoundOf(evidence), null);
  }
});
