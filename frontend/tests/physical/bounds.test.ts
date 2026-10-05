// Request-level raw ranges over the active occurrences: exact min/max of weight, ergonomics, recoil modifier and accuracy over the
// structurally buildable ACTIVE trees, multiplicity counted (ADR 0007 principle 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeActiveBounds, PhysicalModelError, preparePhysicalWeapon, prepareSubproblemDomain } from '../../src/solver/physical';
import { gun, lookupOf, mod, modWith, slot, WEAPON } from './lpFixtures';

/** The enclosure is a few ulps wide on purpose; compare to nine decimals. */
const nine = (x: number): number => Math.round(x * 1e9) / 1e9 + 0;
const range = (r: { lo: number; hi: number }): number[] => [nine(r.lo), nine(r.hi)];

/**
 * Receiver 2 kg, ergonomics 10. s1 (optional) takes a, b or nothing; s2 (required) takes a. a (0.5 kg, +3 ergonomics, recoil -0.1, accuracy -5)
 * carries an optional slot c for k (0.25 kg, +2, accuracy +1); b (1 kg, -4, recoil +0.2, accuracy +4).
 */
const lookup = () => lookupOf(
  gun(WEAPON, { weight: 2, ergo: 10, slots: [slot('s1', ['a', 'b']), slot('s2', ['a'], true)] }),
  ['a', modWith('a', { weight: 0.5, ergo: 3, recoil: -0.1, accuracy: -5, slots: [slot('c', ['k'])] })],
  ['b', modWith('b', { weight: 1, ergo: -4, recoil: 0.2, accuracy: 4 })],
  ['k', modWith('k', { weight: 0.25, ergo: 2, accuracy: 1 })],
);

test('ranges sum the best and worst candidate of every slot, an optional slot also allowed to stay empty, a required one not', () => {
  const l = lookup();
  const bp = preparePhysicalWeapon(l, WEAPON);
  const bounds = computeActiveBounds(bp, prepareSubproblemDomain(bp, l));
  // weight: 2 + s2 (a, 0.5, k optional +0.25) + s1 (empty 0, a 0.5 + 0.25, or b 1): min 2 + 0.5 = 2.5, max 2 + 0.75 + 1 = 3.75
  assert.deepEqual(range(bounds.weight), [2.5, 3.75]);
  // ergonomics: 10 + s2 (a 3, k +2) + s1 (empty, a 3 + 2, b -4): min 10 + 3 - 4 = 9, max 10 + 5 + 5 = 20
  assert.deepEqual(range(bounds.ergonomics), [9, 20]);
  // recoil modifier: s2 a -0.1; s1 empty, a -0.1 or b +0.2: min -0.2, max 0.1
  assert.deepEqual(range(bounds.recoil), [-0.2, 0.1]);
  // accuracy counts every occurrence: s2 a (-5, k adds 0..1), s1 (empty, a -5 (+k), b +4): min -5 - 5 = -10, max (-5 + 1) + 4 = 0
  assert.deepEqual(range(bounds.accuracy), [-10, 0]);
});

test('masks tighten the ranges: an excluded or unavailable item no longer widens them', () => {
  const l = lookup();
  const bp = preparePhysicalWeapon(l, WEAPON);
  const withoutB = computeActiveBounds(bp, prepareSubproblemDomain(bp, l, { excludeItems: ['b'] }));
  assert.deepEqual(range(withoutB.ergonomics), [13, 20]);
  const noK = computeActiveBounds(bp, prepareSubproblemDomain(bp, l, { excludeItems: ['k'] }));
  assert.deepEqual(range(noK.weight), [2.5, 3.5]);
});

test('bounds of an empty domain are an internal error, never a number', () => {
  const l = lookupOf(gun(WEAPON, { slots: [slot('r', [], true)] }), ['unused', mod('unused')]);
  const bp = preparePhysicalWeapon(l, WEAPON);
  const domain = prepareSubproblemDomain(bp, l);
  assert.equal(domain.empty, true);
  assert.throws(() => computeActiveBounds(bp, domain), (e: unknown) => e instanceof PhysicalModelError && e.code === 'DOMAIN_INCONSISTENT');
});
