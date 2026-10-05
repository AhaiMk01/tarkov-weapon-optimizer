// The LP text writer and the directed-rounding helpers under it (ADR 0013 section 4C: shortest round-trip numbers, merged columns, finite domains).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LpWriter, lpNumber, mergeTerms } from '../../src/solver/physical/lpText';
import { nextDown, nextUp, outward, sumEnclosure } from '../../src/solver/physical/numeric';

test('numbers are written with the shortest round-trip digits, never rounded', () => {
  assert.equal(lpNumber(0.1 + 0.2), '0.30000000000000004');
  assert.equal(lpNumber(0.0155), '0.0155');
  assert.equal(lpNumber(-0), '0');
  assert.equal(lpNumber(1e-7), '1e-7');
  assert.equal(lpNumber(1e21), '1e+21');
  for (const value of [0.1, 1 / 3, 34.37735192, 123456789.12345679, 2 ** -40]) assert.equal(Number(lpNumber(value)), value);
  assert.throws(() => lpNumber(Number.NaN));
  assert.throws(() => lpNumber(Infinity));
});

test('repeated columns of a row are merged and exact zeros dropped, in first-appearance order', () => {
  assert.deepEqual(mergeTerms([['a', 1], ['b', 2], ['a', 1]]), { names: ['a', 'b'], coefs: [2, 2] });
  assert.deepEqual(mergeTerms([['a', 1], ['a', -1], ['b', 3]]), { names: ['b'], coefs: [3] });
  assert.deepEqual(mergeTerms([['a', 0]]), { names: [], coefs: [] });
  assert.throws(() => mergeTerms([['a', Number.NaN]]));
});

test('the writer refuses an empty, duplicated or undeclared row and an infinite or empty domain', () => {
  const w = new LpWriter();
  w.addColumn('x', 'continuous', 0, 10);
  w.addColumn('b', 'binary', 0, 1);
  assert.throws(() => w.addColumn('x', 'continuous', 0, 1), /twice/);
  assert.throws(() => w.addColumn('y', 'continuous', 0, Infinity), /not finite/);
  assert.throws(() => w.addColumn('y', 'continuous', 2, 1), /empty domain/);
  assert.throws(() => w.addColumn('y', 'binary', 0, 2), /binary/);
  assert.throws(() => w.addRow('r', [['x', 0]], '<=', 1), /no variables/);
  assert.throws(() => w.addRow('r', [['ghost', 1]], '<=', 1), /undeclared/);
  w.addRow('r', [['x', 1], ['b', -2.5]], '>=', -1);
  assert.throws(() => w.addRow('r', [['x', 1]], '<=', 1), /twice/);
  w.setObjective('x');
  assert.equal(w.toString(), ['Maximize', '  obj: x', 'Subject To', '  r: 1 x - 2.5 b >= -1', 'Bounds', '  0 <= x <= 10', 'Binary', '  b', 'End'].join('\n'));
});

test('a fixed column is written as an equality and an integer column in the General section', () => {
  const w = new LpWriter();
  w.addColumn('f', 'continuous', 2, 2);
  w.addColumn('n', 'integer', 0, 5);
  w.addRow('r', [['f', 1], ['n', 1]], '=', 3);
  w.setObjective('f');
  const text = w.toString();
  assert.ok(text.includes('  f = 2'));
  assert.ok(text.includes('General\n  n'));
});

test('nextUp and nextDown step exactly one double', () => {
  assert.ok(nextUp(1) > 1 && nextUp(1) - 1 === Number.EPSILON);
  assert.ok(nextDown(1) < 1 && 1 - nextDown(1) === Number.EPSILON / 2);
  assert.equal(nextUp(-1), -(1 - Number.EPSILON / 2));
  assert.equal(nextDown(nextUp(5)), 5);
  assert.ok(nextUp(0) > 0 && nextDown(0) < 0);
  assert.equal(nextUp(Infinity), Infinity);
});

test('outward leaves an exact zero alone and widens anything else by one ulp', () => {
  assert.deepEqual(outward({ lo: 0, hi: 0 }), { lo: 0, hi: 0 });
  assert.deepEqual(outward({ lo: 1, hi: 2 }), { lo: nextDown(1), hi: nextUp(2) });
});

test('a sum enclosure contains the sum computed in any order and does not widen an all-zero sum', () => {
  assert.deepEqual(sumEnclosure(0, 0, 10, 0), { lo: 0, hi: 0 });
  const values = [0.1, 0.2, 0.3, 0.4, 0.7, 1e-3, 5.5];
  const abs = values.reduce((a, b) => a + Math.abs(b), 0);
  const forward = values.reduce((a, b) => a + b, 0);
  const backward = [...values].reverse().reduce((a, b) => a + b, 0);
  const box = sumEnclosure(Math.min(forward, backward), Math.max(forward, backward), values.length, abs);
  for (const total of [forward, backward]) assert.ok(box.lo <= total && total <= box.hi);
  assert.ok(box.lo < Math.min(forward, backward) && box.hi > Math.max(forward, backward));
});
