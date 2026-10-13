import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReferenceFixture, ReferenceRequest } from './domain';
import type { ReferenceBuild } from './build';
import { resolveFixture, resolveRequest } from './resolve';
import { MOA_K } from './constants';
import {
  clampErgonomics, computeStats, effectiveCenterOfImpact, effectiveErgonomics, moaOf,
  overswingPercent, tedOf, weightPenalty,
} from './stats';
import { add, eq, fromBinary64, mul, q, toNumber, toString } from './q';

// --- pure formulas -----------------------------------------------------------------------------

test('first clamp: every regime and both boundaries', () => {
  assert.deepEqual(clampErgonomics(q(-5)), q(0)); // wholly below zero
  assert.deepEqual(clampErgonomics(q(0)), q(0)); // lower boundary
  assert.deepEqual(clampErgonomics(q(1, 2)), q(1, 2)); // identity
  assert.deepEqual(clampErgonomics(q(100)), q(100)); // upper boundary
  assert.deepEqual(clampErgonomics(q(1000, 7)), q(100)); // wholly above the cap
});

test('effective ergonomics: gear factor then second clamp', () => {
  assert.deepEqual(effectiveErgonomics(q(80), q(1)), q(80)); // identity factor
  assert.deepEqual(effectiveErgonomics(q(80), q(0)), q(0)); // zero equipment factor
  assert.deepEqual(effectiveErgonomics(q(80), q(1, 2)), q(40)); // factor below one
  assert.deepEqual(effectiveErgonomics(q(90), q(5, 4)), q(100)); // factor above one saturates (112.5 -> 100)
  assert.deepEqual(effectiveErgonomics(q(60), q(5, 4)), q(75)); // factor above one, unsaturated
  assert.deepEqual(effectiveErgonomics(q(-20), q(5, 4)), q(0)); // negative raw is clamped before the gear factor
  assert.deepEqual(effectiveErgonomics(q(250), q(1, 2)), q(50)); // clamp to 100 first, then halve
});

test('weight penalty is 0 up to 3 kg and 100 - 300/W above it', () => {
  assert.deepEqual(weightPenalty(q(2)), q(0));
  assert.deepEqual(weightPenalty(q(3)), q(0));
  assert.deepEqual(weightPenalty(q(6)), q(50));
  assert.deepEqual(weightPenalty(q(7, 2)), q(100, 7)); // 100 - 600/7
  assert.deepEqual(weightPenalty(q(-4)), q(0));
});

test('TED boundary at W = 3 kg: zero ergonomics is not an overswing at exactly 3 kg, but is just above', () => {
  assert.deepEqual(tedOf(q(0), q(3)), q(0));
  assert.deepEqual(overswingPercent(q(0), q(3)), q(0));
  const w = q(49, 16); // 3.0625 kg, exactly representable
  assert.deepEqual(tedOf(q(0), w), q(-100, 49));
  assert.deepEqual(overswingPercent(q(0), w), q(25, 16)); // ((49/16 - 3) / 4) * 100
  // with enough effective ergonomics the same weight is fine
  assert.ok(tedOf(q(10), w).n > 0n);
  assert.deepEqual(overswingPercent(q(10), w), q(0));
});

test('overswing is nonzero iff TED < 0 over a grid of ergonomics and weights', () => {
  for (let e = 0; e <= 100; e += 5) {
    for (let w = -2; w <= 12; w += 1) {
      for (const frac of [q(0), q(1, 3), q(1, 2), q(99, 100)]) {
        const weight = add(q(w), frac);
        const ergo = q(e);
        const negative = tedOf(ergo, weight).n < 0n;
        const nonzero = overswingPercent(ergo, weight).n > 0n;
        assert.equal(nonzero, negative, `e=${e} w=${toString(weight)}`);
      }
    }
  }
});

test('overswing saturates at 100 and never goes negative', () => {
  assert.deepEqual(overswingPercent(q(0), q(7)), q(100));
  assert.deepEqual(overswingPercent(q(0), q(50)), q(100));
  assert.deepEqual(overswingPercent(q(100), q(50)), q(0));
});

test('MOA: replacement barrel COI, linear subtractive accuracy, K = 100 / 2.9089', () => {
  const coi = fromBinary64(0.053);
  assert.ok(eq(moaOf(coi, q(0)), mul(coi, MOA_K)));
  // M4A1 14.5" barrel: replacement predicts 1.82199..., additive would predict 2.1658
  assert.ok(Math.abs(toNumber(moaOf(coi, q(0))) - 1.821994568) < 1e-8);
  // signed accuracy: -5% worsens MOA by exactly 5%
  assert.ok(eq(moaOf(coi, q(-5)), mul(mul(coi, MOA_K), q(105, 100))));
  assert.ok(eq(moaOf(coi, q(16)), mul(mul(coi, MOA_K), q(84, 100))));
});

test('effective COI: the barrel overrides only when its COI is positive', () => {
  const weapon = fromBinary64(0.01);
  assert.deepEqual(effectiveCenterOfImpact(weapon, [fromBinary64(0.053)]), fromBinary64(0.053));
  assert.deepEqual(effectiveCenterOfImpact(weapon, []), weapon);
  assert.deepEqual(effectiveCenterOfImpact(weapon, [q(0)]), weapon); // zero COI falls back to intrinsic
  assert.deepEqual(effectiveCenterOfImpact(weapon, [q(-1, 10)]), weapon); // nonpositive falls back
  assert.deepEqual(effectiveCenterOfImpact(q(0), []), q(0)); // zero intrinsic with no barrel
  // several positive overriders: the worst (largest) COI, matching one replacement row per installed barrel
  assert.deepEqual(effectiveCenterOfImpact(weapon, [q(1, 20), q(1, 10), q(0)]), q(1, 10));
});

// --- build statistics --------------------------------------------------------------------------

const fixture: ReferenceFixture = {
  schemaVersion: 1,
  items: [
    { id: 'mount', weightKg: 0.0155, ergonomics: 2, sightingRange: 100, recoilModifier: -0.05, accuracyModifier: 3 },
    { id: 'barrel', weightKg: 1, ergonomics: -3, recoilModifier: -0.1, accuracyModifier: -2, centerOfImpact: 0.053, magazineCapacity: 0 },
    { id: 'bad-barrel', weightKg: 0.5, centerOfImpact: 0 },
    { id: 'mag', weightKg: 0.25, magazineCapacity: 30, sightingRange: 0 },
    { id: 'sight', weightKg: 0.5, sightingRange: 400 },
  ],
  weapons: [{
    id: 'gun', weightKg: 2.5, ergonomics: 50, recoilVertical: 100, recoilHorizontal: 200, centerOfImpact: 0.01,
    sightingRange: 50, magazineCapacity: 0,
  }],
};
const rf = resolveFixture(fixture);
const req = (r: Partial<ReferenceRequest> = {}) => resolveRequest(fixture, { weapon_id: 'gun', ...r });
const build = (...ids: string[]): ReferenceBuild => ({
  base: { kind: 'naked' },
  placements: ids.map((itemId, i) => ({ parentInstanceId: 'weapon_0', slotId: `s${i}`, childInstanceId: `weapon_0/s${i}:${itemId}`, itemId })),
});

test('fractional source mass is preserved: two 0.0155 kg mounts weigh exactly the decoded leaves', () => {
  const stats = computeStats(rf, req(), build('mount', 'mount'));
  const leaf = fromBinary64(0.0155);
  assert.ok(eq(stats.weight, add(q(5, 2), add(leaf, leaf))));
  // neither the decimal 2.531 nor an integer-rounded mass
  assert.ok(!eq(stats.weight, q(2531, 1000)));
  assert.ok(!eq(stats.weight, q(5, 2)));
  assert.ok(Math.abs(toNumber(stats.weight) - 2.531) < 1e-15);
});

test('stats of a mixed build', () => {
  const stats = computeStats(rf, req(), build('mount', 'barrel', 'mag'));
  assert.deepEqual(stats.rawErgonomics, q(49)); // 50 + 2 - 3
  assert.deepEqual(stats.ergonomics, q(49));
  assert.ok(eq(stats.recoilModifierSum, add(fromBinary64(-0.05), fromBinary64(-0.1))));
  assert.ok(eq(stats.recoilVertical, mul(q(100), add(q(1), stats.recoilModifierSum))));
  assert.ok(eq(stats.recoilHorizontal, mul(q(200), add(q(1), stats.recoilModifierSum))));
  assert.deepEqual(stats.magazineCapacity, q(30));
  assert.deepEqual(stats.sightingRange, q(100));
  assert.deepEqual(stats.accuracyModifierSum, q(1)); // +3 - 2
  assert.deepEqual(stats.effectiveCenterOfImpact, fromBinary64(0.053)); // barrel replaces the receiver COI
});

test('MOA barrel fallback: a nonpositive-COI barrel leaves the intrinsic COI in force', () => {
  const stats = computeStats(rf, req(), build('bad-barrel'));
  assert.deepEqual(stats.effectiveCenterOfImpact, fromBinary64(0.01));
  assert.ok(eq(stats.moa, mul(fromBinary64(0.01), MOA_K)));
});

test('receiver sighting range and magazine capacity count when no part reaches the cap', () => {
  const stats = computeStats(rf, req(), build());
  assert.deepEqual(stats.sightingRange, q(50));
  assert.deepEqual(stats.magazineCapacity, q(0));
  assert.deepEqual(stats.weight, q(5, 2));
});

test('ergonomics regimes through a build: below zero, identity and saturation', () => {
  const low: ReferenceFixture = { ...fixture, items: [{ id: 'anchor', ergonomics: -80 }], weapons: [{ id: 'gun', ergonomics: 30 }] };
  const lowStats = computeStats(resolveFixture(low), resolveRequest(low, { weapon_id: 'gun' }), build('anchor'));
  assert.deepEqual(lowStats.rawErgonomics, q(-50));
  assert.deepEqual(lowStats.ergonomics, q(0));
  const high: ReferenceFixture = { ...fixture, items: [{ id: 'booster', ergonomics: 90 }], weapons: [{ id: 'gun', ergonomics: 30 }] };
  const highStats = computeStats(resolveFixture(high), resolveRequest(high, { weapon_id: 'gun', equip_ergo_modifier: 0.25 }), build('booster'));
  assert.deepEqual(highStats.rawErgonomics, q(120));
  assert.deepEqual(highStats.ergonomics, q(100));
  assert.deepEqual(highStats.effectiveErgonomics, q(100));
});

test('TED of a build subtracts the weight penalty from gear-adjusted ergonomics', () => {
  // receiver 2.5 kg + barrel 1 + mag 0.25 + sight 0.5 + mount 0.0155 > 3 kg
  const stats = computeStats(rf, req({ equip_ergo_modifier: -0.5 }), build('mount', 'barrel', 'mag', 'sight'));
  assert.deepEqual(stats.effectiveErgonomics, q(49, 2));
  assert.ok(eq(stats.ted, add(stats.effectiveErgonomics, mul(q(-1), stats.weightPenalty))));
  assert.ok(stats.weightPenalty.n > 0n);
});

test('spend comes from the acquisition model', () => {
  const priced: ReferenceFixture = {
    ...fixture,
    weapons: [{ id: 'gun', offers: [{ kind: 'trader', trader: 'prapor', level: 1, price: 1000 }] }],
    items: [{ id: 'mag', offers: [{ kind: 'trader', trader: 'prapor', level: 1, price: 250 }] }],
  };
  const stats = computeStats(resolveFixture(priced), resolveRequest(priced, { weapon_id: 'gun' }), build('mag', 'mag'));
  assert.deepEqual(stats.spend, q(1500));
});
