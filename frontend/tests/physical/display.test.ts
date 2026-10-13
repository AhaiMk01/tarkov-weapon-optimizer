// Outward display rounding and witness-safe cap submission (src/solver/physical/display.ts, ADR 0007 section 7): a displayed or submitted value is at
// least the achieved witness and finite, or it is withheld (null) and the raw witness stays the truth. Every decision is an exact rational comparison.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ratCmp, ratFromDouble } from '../../src/solver/physical/exact';
import { nextDown, nextUp } from '../../src/solver/physical/numeric';
import {
  DISPLAY_DECIMALS, maxSafeWitness, outwardDisplay, outwardGridCeil, outwardSafeCeil, submissionIsSafe,
} from '../../src/solver/physical/display';

test('the naive ceiling reads back BELOW the witness; the outward one never does', () => {
  const hi = 0.043000000000000003;
  assert.equal(hi, nextUp(0.043), 'the witness is the double just above 0.043');
  assert.equal(hi * 1000, 43, 'the float product rounds down to 43');
  assert.equal(Math.ceil(hi * 1000) / 1000, 0.043, 'so the naive ceiling reads 0.043 ...');
  assert.ok(0.043 < hi, '... which is BELOW the witness: a cap of 0.043 would reject the witness itself');
  assert.equal(outwardSafeCeil(hi, 3), 0.044, 'the outward ceiling moves up one place');
  // the double 0.043 itself parses from the decimal 0.043: that decimal IS its outward display
  assert.equal(outwardSafeCeil(0.043, 3), 0.043);
  assert.equal(outwardSafeCeil(nextDown(0.043), 3), 0.043);
  const d = outwardDisplay(nextUp(0.043), 3);
  assert.deepEqual(d, { text: '0.044', value: 0.044 });
});

test('the display is the smallest decimal with the requested places that is at least the witness, for every supported precision and sign', () => {
  assert.deepEqual(outwardDisplay(2.149, 1), { text: '2.2', value: 2.2 });
  assert.deepEqual(outwardDisplay(2.149, 2), { text: '2.15', value: 2.15 });
  assert.deepEqual(outwardDisplay(2.149, 3), { text: '2.149', value: 2.149 }, 'the decimal 2.149 parses to the very double 2.149');
  assert.deepEqual(outwardDisplay(2.15, 1), { text: '2.2', value: 2.2 });
  assert.deepEqual(outwardDisplay(0, 2), { text: '0.00', value: 0 });
  assert.deepEqual(outwardDisplay(-0.0004, 3), { text: '0.000', value: 0 }, 'a negative witness rounds up toward zero');
  assert.deepEqual(outwardDisplay(-1.2345, 2), { text: '-1.23', value: -1.23 });
  assert.deepEqual(outwardDisplay(-0.5, 1), { text: '-0.5', value: -0.5 });
  assert.deepEqual(outwardDisplay(-0.05, 1), { text: '0.0', value: 0 });
  assert.deepEqual(outwardDisplay(1234.5678, 4), { text: '1234.5678', value: 1234.5678 });
  for (const decimals of DISPLAY_DECIMALS) {
    for (const hi of [0.1, 0.2, 0.3, 1 / 3, 2.149, 17.189, 1e-5, 123456.789, -7.77, -0.0001]) {
      const shown = outwardDisplay(hi, decimals);
      assert.ok(shown !== null);
      assert.ok(ratCmp(ratFromDouble(shown.value), ratFromDouble(hi)) >= 0, `${hi} at ${decimals}: ${shown.text} is at least the witness`);
      // and it is the SMALLEST such decimal: one place below parses under the witness
      const oneBelow = (Number(shown.text.replace('.', '')) - 1) / 10 ** decimals;
      assert.ok(Number(oneBelow.toFixed(decimals)) < hi, `${hi} at ${decimals}: ${oneBelow.toFixed(decimals)} is under the witness`);
      assert.ok(Number(shown.text) === shown.value && shown.text.split('.')[1].length === decimals);
    }
  }
});

test('an unsupported precision, a non-finite witness or one beyond the precision-dependent safe range is withheld, never rounded', () => {
  for (const bad of [0, 5, -1, 1.5, Number.NaN, Infinity]) assert.equal(outwardSafeCeil(1.5, bad), null, `decimals ${bad}`);
  for (const hi of [Number.NaN, Infinity, -Infinity]) assert.equal(outwardSafeCeil(hi, 2), null, `witness ${hi}`);
  assert.equal(maxSafeWitness(2), (Number.MAX_SAFE_INTEGER - 10) / 100);
  assert.equal(maxSafeWitness(0), null);
  const limit = maxSafeWitness(3) as number;
  assert.notEqual(outwardSafeCeil(limit, 3), null, 'the largest safe witness is accepted');
  assert.equal(outwardSafeCeil(limit * 2, 3), null);
  assert.equal(outwardSafeCeil(1e300, 4), null);
  assert.equal(outwardSafeCeil(-limit * 2, 3), null);
  assert.equal(outwardSafeCeil(undefined as unknown as number, 2), null);
});

test('a cap on an offset grid is origin + ceil((hi - origin) / step) step, computed exactly and never below the witness', () => {
  // grid 0.05 from origin 0.01: 0.01, 0.06, 0.11, ...
  const cap = outwardGridCeil(0.07, 0.01, 0.05) as number;
  assert.ok(Math.abs(cap - 0.11) < 1e-15 && cap >= 0.07);
  // a witness exactly on the grid is its own cap
  assert.equal(outwardGridCeil(0.5, 0, 0.25), 0.5);
  assert.equal(outwardGridCeil(0.5000000000000001, 0, 0.25), 0.75, 'one ulp above a grid point goes to the next one');
  assert.equal(outwardGridCeil(-0.3, 0, 0.25), -0.25, 'a negative witness');
  assert.equal(outwardGridCeil(3, 1, 0.5), 3);
  // the zero-aligned case
  assert.equal(outwardGridCeil(2.149, 0, 0.1), 2.2);
  for (const [hi, origin, step] of [[2.149, 0, 0.1], [0.043, 0.001, 0.0005], [1e6 + 0.3, 0.5, 0.25], [-4.4, -1, 0.3]] as const) {
    const c = outwardGridCeil(hi, origin, step) as number;
    assert.ok(submissionIsSafe(c, hi), `${hi} on grid ${origin} + k ${step}`);
  }
});

test('a grid cap is withheld for a non-positive step, a non-finite input, or an index beyond the safe integers', () => {
  assert.equal(outwardGridCeil(1, 0, 0), null);
  assert.equal(outwardGridCeil(1, 0, -0.5), null);
  assert.equal(outwardGridCeil(Number.NaN, 0, 0.5), null);
  assert.equal(outwardGridCeil(1, Infinity, 0.5), null);
  assert.equal(outwardGridCeil(1e300, 0, 1e-10), null, 'the grid index overflows');
  assert.equal(outwardGridCeil(Number.MAX_VALUE, 0, 1), null, 'at the top of the doubles the grid index is beyond the safe integers');
});

test('the pre-submission guard: a cap is submitted only when it is finite and at least the witness it must admit', () => {
  assert.equal(submissionIsSafe(0.044, 0.043), true);
  assert.equal(submissionIsSafe(0.043, 0.043), true);
  assert.equal(submissionIsSafe(nextDown(0.043), 0.043), false, 'one ulp below the witness would reject the witness itself');
  assert.equal(submissionIsSafe(Infinity, 1), false);
  assert.equal(submissionIsSafe(Number.NaN, 1), false);
  assert.equal(submissionIsSafe(1, Number.NaN), false);
});
