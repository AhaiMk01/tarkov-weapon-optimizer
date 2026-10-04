import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReferenceFixture, ReferenceRequest } from './domain';
import type { ReferenceBuild } from './build';
import { resolveFixture, resolveRequest } from './resolve';
import { computeStats } from './stats';
import { coordinatesOf, scoreCoordinates, scoreBuild, tchebycheffCoefficients } from './score';
import { eq, fromBinary64, q, toNumber } from './q';

const fixture: ReferenceFixture = {
  schemaVersion: 1,
  items: [{ id: 'part', ergonomics: 10, recoilModifier: -0.25, offers: [{ kind: 'trader', trader: 'prapor', level: 1, price: 500 }] }],
  weapons: [{ id: 'gun', ergonomics: 40, weightKg: 4, offers: [{ kind: 'trader', trader: 'prapor', level: 1, price: 1500 }] }],
};
const objective = (r: Partial<ReferenceRequest>) => resolveRequest(fixture, { weapon_id: 'gun', ...r }).objective;

const ideal = { zE: 600, nadE: 200, zR: -400, nadR: -100, zP: 0, nadP: 2000 };

test('linear weighted sum: (e/10) fE - r fR - (p/1000) fP with dyadic weights is exact', () => {
  const obj = objective({ ergo_weight: 0.5, recoil_weight: 0.25, price_weight: 0.5 });
  assert.deepEqual(scoreCoordinates(obj, { fE: q(600), fR: q(-100), fP: q(2000) }), q(54));
});

test('binary64 weights 0.4 / 0.6 give scores that are close to, but not exactly, 84 and 200', () => {
  const obj = objective({ ergo_weight: 0.4, recoil_weight: 0.6, price_weight: 0 });
  const a = scoreCoordinates(obj, { fE: q(600), fR: q(-100), fP: q(0) });
  const b = scoreCoordinates(obj, { fE: q(500), fR: q(-300), fP: q(0) });
  assert.ok(!eq(a, q(84)));
  assert.ok(!eq(b, q(200)));
  assert.ok(Math.abs(toNumber(a) - 84) < 1e-12);
  assert.ok(Math.abs(toNumber(b) - 200) < 1e-12);
  assert.ok(b.n * a.d > a.n * b.d, 'B outranks A');
});

test('all-zero weights score zero for every build, weighted and Tchebycheff', () => {
  const zeros = { ergo_weight: 0, recoil_weight: 0, price_weight: 0 };
  for (const c of [{ fE: q(900), fR: q(-700), fP: q(10) }, { fE: q(0), fR: q(500), fP: q(99999) }]) {
    assert.deepEqual(scoreCoordinates(objective(zeros), c), q(0));
    assert.deepEqual(scoreCoordinates(objective({ ...zeros, use_tchebycheff: true, ideal_point: ideal }), c), q(0));
  }
});

test('Tchebycheff coefficients: normalization by weight sum and by max(range, 1)', () => {
  const co = tchebycheffCoefficients(objective({ ergo_weight: 1, recoil_weight: 1, price_weight: 2, use_tchebycheff: true, ideal_point: ideal }));
  assert.deepEqual(co.ce, q(1, 1600)); // 1 / (4 * 400)
  assert.deepEqual(co.cr, q(1, 1200)); // 1 / (4 * 300)
  assert.deepEqual(co.cp, q(1, 4000)); // 2 / (4 * 2000)
  assert.deepEqual(co.active, ['e', 'r', 'p']);
});

test('Tchebycheff worked example with literal rationals', () => {
  const obj = objective({ ergo_weight: 1, recoil_weight: 1, price_weight: 2, use_tchebycheff: true, ideal_point: ideal });
  // d_e = 1/16, d_r = 1/12, d_p = 1/4; augmentation (1/100)(5/16 + 1/4 - 1/4) = 1/320
  assert.deepEqual(scoreCoordinates(obj, { fE: q(500), fR: q(-300), fP: q(1000) }), q(-79, 320));
});

test('Tchebycheff keeps a negative active deviation: no outer zero clamp', () => {
  const obj = objective({ ergo_weight: 1, recoil_weight: 0, price_weight: 0, use_tchebycheff: true, ideal_point: ideal });
  // fE = 700 is better than zE = 600: d_e = (1/400)(600 - 700) = -1/4; score = 7/400 + 1/4 = 107/400
  assert.deepEqual(scoreCoordinates(obj, { fE: q(700), fR: q(0), fP: q(0) }), q(107, 400));
  assert.ok(scoreCoordinates(obj, { fE: q(700), fR: q(0), fP: q(0) }).n > 0n);
});

test('inactive axes never enter the maximum, even when their deviation would dominate', () => {
  const active = objective({ ergo_weight: 1, recoil_weight: 0, price_weight: 0, use_tchebycheff: true, ideal_point: ideal });
  const c = { fE: q(600), fR: q(5000), fP: q(900000) };
  // ergo deviation is exactly zero; recoil and price are far worse than ideal but inactive
  assert.deepEqual(scoreCoordinates(active, c), q(3, 200)); // (1/100)(600/400) - 0
});

test('normalization floors: ranges below one are floored to one', () => {
  // zE - nadE = 1/2 -> floor 1; nadR - zR = -3 -> floor 1; nadP - zP = 0 -> floor 1
  const flat = { zE: 100, nadE: 99.5, zR: 10, nadR: 7, zP: 5, nadP: 5 };
  const co = tchebycheffCoefficients(objective({ ergo_weight: 1, recoil_weight: 1, price_weight: 1, use_tchebycheff: true, ideal_point: flat }));
  assert.deepEqual(co.ce, q(1, 3));
  assert.deepEqual(co.cr, q(1, 3));
  assert.deepEqual(co.cp, q(1, 3));
});

test('coordinates: fE = 10 x ergonomics, or 10 x TED when TrueErgo is on', () => {
  const rf = resolveFixture(fixture);
  const build: ReferenceBuild = {
    base: { kind: 'naked' },
    placements: [{ parentInstanceId: 'weapon_0', slotId: 's', childInstanceId: 'weapon_0/s:part', itemId: 'part' }],
  };
  const plain = resolveRequest(fixture, { weapon_id: 'gun', equip_ergo_modifier: -0.5 });
  const stats = computeStats(rf, plain, build);
  assert.deepEqual(coordinatesOf(stats, plain), { fE: q(500), fR: q(-250), fP: q(2000) });
  const trueErgo = resolveRequest(fixture, { weapon_id: 'gun', equip_ergo_modifier: -0.5, use_true_ergo: true });
  const tedStats = computeStats(rf, trueErgo, build);
  // effective = 50 * 1/2 = 25; weight 4 kg => penalty 100 - 75 = 25; TED = 0
  assert.deepEqual(tedStats.ted, q(0));
  assert.deepEqual(coordinatesOf(tedStats, trueErgo).fE, q(0));
});

test('scoreBuild composes coordinates and the objective', () => {
  const rf = resolveFixture(fixture);
  const request = resolveRequest(fixture, { weapon_id: 'gun', ergo_weight: 1, recoil_weight: 0, price_weight: 0 });
  const empty: ReferenceBuild = { base: { kind: 'naked' }, placements: [] };
  assert.deepEqual(scoreBuild(computeStats(rf, request, empty), request), q(40)); // (1/10) * 10 * 40
});

test('exact ties are exact equality: a tiny positive gap is not a tie', () => {
  const obj = objective({ ergo_weight: 1, recoil_weight: 0, price_weight: 0 });
  const a = scoreCoordinates(obj, { fE: q(500), fR: q(0), fP: q(0) });
  const b = scoreCoordinates(obj, { fE: q(500), fR: q(0), fP: q(0) });
  const c = scoreCoordinates(obj, { fE: fromBinary64(500.0000000000001), fR: q(0), fP: q(0) });
  assert.ok(eq(a, b));
  assert.ok(!eq(a, c));
});
