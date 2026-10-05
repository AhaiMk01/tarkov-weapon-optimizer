// The objective and the ergonomics clamps (ADR 0007 principle 5, ADR 0010 section 2, INTERPRETATIONS 12, 16, 17): both clamps over
// every regime and boundary, the gear factor, all-zero weights, and the augmented Tchebycheff form against a given payoff table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gun, lookupOf, mod, slot, WEAPON } from './lpFixtures';
import { assertReadbackMatches, prepare, solve } from './lpHarness';

const close = (actual: number, expected: number, tolerance = 1e-9): void =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
const count = (build: { installed: ReadonlyMap<string, number> } | null, id: string): number => build?.installed.get(id) ?? 0;
const ergo = { ergoWeight: 1, recoilWeight: 0 } as const;

const oneMod = (receiverErgo: number, partErgo: number) => lookupOf(
  gun(WEAPON, { ergo: receiverErgo, slots: [slot('s', ['a'])] }),
  ['a', mod('a', { ergo: partErgo })],
);

test('first clamp: a raw ergonomics above 100 scores as 100', async () => {
  const { solution } = await solve(oneMod(90, 30), WEAPON, ergo);
  close(solution.objective, 100);
});

test('first clamp: a raw ergonomics below zero scores as 0, not negative', async () => {
  const forced = await solve(oneMod(5, -20), WEAPON, { ...ergo, includeItems: ['a'] });
  close(forced.solution.objective, 0);
  const free = await solve(oneMod(5, -20), WEAPON, ergo);
  close(free.solution.objective, 5);
  assert.equal(count(free.build, 'a'), 0);
});

test('first clamp: the exact boundaries 0 and 100 are identity points', async () => {
  const top = await solve(oneMod(60, 40), WEAPON, { ...ergo, includeItems: ['a'] });
  close(top.solution.objective, 100);
  const bottom = await solve(oneMod(20, -20), WEAPON, { ...ergo, includeItems: ['a'] });
  close(bottom.solution.objective, 0);
  const mid = await solve(oneMod(20, 30), WEAPON, ergo);
  close(mid.solution.objective, 50);
});

test('TrueErgo gear: the effective ergonomics is clamp(factor x displayed, 0, 100), the factor floored at zero', async () => {
  const lookup = oneMod(80, 0);
  const at = (modifier: number | null) => solve(lookup, WEAPON, { ...ergo, useTrueErgo: true, equipErgoModifier: modifier });
  close((await at(null)).solution.objective, 80, 1e-7); // identity: the receiver weighs 1 kg, no penalty
  close((await at(-0.15)).solution.objective, 68, 1e-7); // factor 0.85 below one
  close((await at(0.2)).solution.objective, 96, 1e-7); // factor 1.2 above one: 96, under the second clamp
  close((await at(0.5)).solution.objective, 100, 1e-7); // 80 x 1.5 = 120 saturates at 100
  close((await at(-1)).solution.objective, 0, 1e-7); // zero factor
  close((await at(-2)).solution.objective, 0, 1e-7); // a negative factor is floored at zero
});

test('the gear factor and the second clamp do not touch a non-TED score (INTERPRETATIONS 16)', async () => {
  const plain = await solve(oneMod(80, 0), WEAPON, { ...ergo, equipErgoModifier: -0.5 });
  close(plain.solution.objective, 80);
});

test('all-zero weights give a zero objective and every feasible build is optimal', async () => {
  const { solution, build } = await solve(oneMod(10, 5), WEAPON, { ergoWeight: 0, recoilWeight: 0, priceWeight: 0 });
  assert.equal(solution.status, 'Optimal');
  close(solution.objective, 0);
  assert.ok(build);
});

test('a negative weight resolves to zero and never rewards a worse value', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { ergo: 10, slots: [slot('s', ['a'])] }),
    ['a', mod('a', { ergo: 5, recoil: 0.1 })],
  );
  // recoil weight -3 resolves to 0: the recoil worsening is ignored and the +5 ergonomics wins.
  const { solution, build } = await solve(lookup, WEAPON, { ergoWeight: 1, recoilWeight: -3 });
  close(solution.objective, 15);
  assert.equal(count(build, 'a'), 1);
});

test('the weighted score is (e/10) fE - r fR - (p/1000) fP over exact frames', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { ergo: 10, slots: [slot('s', ['a'])] }),
    ['a', mod('a', { ergo: 5, recoil: -0.05 })],
  );
  // none: 10 - 0 - 5 = 5? e = 2, r = 3, p = 1000: none = 2 x 10 - 3 x 0 - 1 x 5000 = -4980; a = 2 x 15 + 3 x 50 - 1 x 5100 = -4920.
  const { solution } = await solve(lookup, WEAPON, { ergoWeight: 2, recoilWeight: 3, priceWeight: 1000 });
  close(solution.objective, -4920, 1e-6);
});

test('augmented Tchebycheff against a given payoff table: signed deviations, the 0.01 augmentation, inactive price axis', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { ergo: 10, slots: [slot('s', ['a', 'b'])] }),
    ['a', mod('a', { ergo: 5, recoil: -0.05 })],
    ['b', mod('b', { ergo: 10 })],
  );
  const idealPoint = { zE: 150, nadE: 100, zR: -100, nadR: 0, zP: 5000, nadP: 6000 };
  // e = r = 1, p = 0: sum 2, c_e = 1/(2 x 50) = 0.01, c_r = 1/(2 x 100) = 0.005, c_p = 0 (inactive).
  // none: fE 100, fR 0   -> 0.01 (0.01 x 100) - max(0.5, 0.5) = -0.49
  // a:    fE 150, fR -50 -> 0.01 (1.5 + 0.25) - max(0, 0.25)  = -0.2325
  // b:    fE 200, fR 0   -> 0.01 (2.0) - max(-0.5, 0.5)       = -0.48
  const { solution, build } = await solve(lookup, WEAPON, { ergoWeight: 1, recoilWeight: 1, priceWeight: 0, useTchebycheff: true, idealPoint });
  assert.equal(solution.status, 'Optimal');
  close(solution.objective, -0.2325, 1e-9);
  assert.equal(count(build, 'a'), 1);
});

test('a Tchebycheff request without a payoff table is an input error, never a silent fallback to the weighted score', () => {
  assert.throws(() => prepare(oneMod(1, 1), WEAPON, { useTchebycheff: true }), /ideal point/);
});

test('the normalization floor: a payoff range below one is clamped to one', async () => {
  const lookup = oneMod(10, 1);
  // zE - nadE = 0.5 < 1, so c_e = 1 / (1 x 1) = 1 for e only: score = 0.01 x fE - (zE - fE).
  const idealPoint = { zE: 110, nadE: 109.5, zR: 0, nadR: 0, zP: 0, nadP: 0 };
  const { solution } = await solve(lookup, WEAPON, { ergoWeight: 1, recoilWeight: 0, priceWeight: 0, useTchebycheff: true, idealPoint });
  // a: fE 110: 0.01 x 110 - (110 - 110) = 1.1
  close(solution.objective, 1.1, 1e-9);
});

test('a very wide price normalization is a reported matrix-filter risk, and the readback shows HiGHS would drop the coefficient', async () => {
  const lookup = oneMod(10, 2);
  const wide = { zE: 100, nadE: 0, zR: -100, nadR: 0, zP: 0, nadP: 1e8 };
  const { model } = prepare(lookup, WEAPON, { ergoWeight: 1, recoilWeight: 1, priceWeight: 1, useTchebycheff: true, idealPoint: wide });
  assert.equal(model.matrixFilterRisk, true);
  assert.ok(model.stats.minAbsCoefficient <= 1e-9, `smallest coefficient ${model.stats.minAbsCoefficient}`);
  await assert.rejects(assertReadbackMatches(model.lp), /adjusted the model|different model/);
  // a normal normalization keeps every coefficient
  const normal = prepare(lookup, WEAPON, { ergoWeight: 1, recoilWeight: 1, priceWeight: 1, useTchebycheff: true, idealPoint: { zE: 100, nadE: 0, zR: -100, nadR: 0, zP: 0, nadP: 10000 } });
  assert.equal(normal.model.matrixFilterRisk, false);
  await assertReadbackMatches(normal.model.lp);
});
