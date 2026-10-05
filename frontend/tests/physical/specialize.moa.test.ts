// The provisional MOA rows (ADR 0006, ADR 0007 principles 1 to 3): exact replacement Big-M rows, the intrinsic fallback, zero-intrinsic
// receivers, signed accuracy, multi-copy A_min and the constant-row cases. MOA = effectiveCOI x (1 - sum(accuracy)/100) x K,
// K = 1000000/29089 = 34.377..., so COI 1/16 is 2.149, 1/8 is 4.297 and 1/2 is 17.189 MOA.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunWith, lookupOf, modWith, slot, WEAPON } from './lpFixtures';
import { MOA_K } from '../../src/solver/physical';
import { solve } from './lpHarness';

const ergo = { ergoWeight: 1, recoilWeight: 0 } as const;
const count = (build: { installed: ReadonlyMap<string, number> } | null, id: string): number => build?.installed.get(id) ?? 0;

test('K is the declared 100 / 2.9089 as one correctly rounded quotient of exact integers', () => {
  assert.equal(MOA_K, 1000000 / 29089);
  assert.ok(Math.abs(MOA_K - 100 / 2.9089) < 1e-12);
});

test('a positive barrel COI replaces the receiver COI: 1/8 gives 4.297 MOA, within a cap of 5 and outside a cap of 4', async () => {
  const lookup = lookupOf(
    gunWith(WEAPON, { coi: 0.0625, slots: [slot('s', ['b'])] }),
    ['b', modWith('b', { ergo: 2, coi: 0.125 })],
  );
  const loose = await solve(lookup, WEAPON, { ...ergo, maxMOA: 5 });
  assert.equal(loose.solution.objective, 2);
  assert.equal(count(loose.build, 'b'), 1);
  const tight = await solve(lookup, WEAPON, { ...ergo, maxMOA: 4 });
  assert.equal(count(tight.build, 'b'), 0, 'with the barrel the MOA is 4.297 > 4; without it the intrinsic 2.149 stays');
  assert.equal(tight.solution.status, 'Optimal');
});

test('an optional barrel slot keeps the intrinsic COI as a legal fallback and a too-wide barrel is excluded', async () => {
  const lookup = lookupOf(
    gunWith(WEAPON, { coi: 0.0625, slots: [slot('s', ['bad', 'good'])] }),
    ['bad', modWith('bad', { ergo: 5, coi: 0.5 })],
    ['good', modWith('good', { ergo: 2, coi: 0.125 })],
  );
  const { solution, build } = await solve(lookup, WEAPON, { ...ergo, maxMOA: 5 });
  assert.equal(solution.objective, 2);
  assert.equal(count(build, 'good'), 1);
  assert.equal(count(build, 'bad'), 0);
});

test('a required barrel slot has no empty fallback: only a barrel without COI falls back to the intrinsic value', async () => {
  const lookup = lookupOf(
    gunWith(WEAPON, { coi: 0.0625, slots: [slot('s', ['bad', 'good', 'bz'], true)] }),
    ['bad', modWith('bad', { ergo: 5, coi: 0.5 })],
    ['good', modWith('good', { ergo: 2, coi: 0.125 })],
    ['bz', modWith('bz', { ergo: 1 })],
  );
  const { solution, build } = await solve(lookup, WEAPON, { ...ergo, maxMOA: 5 });
  assert.equal(solution.objective, 2);
  assert.equal(count(build, 'good'), 1);
  // good removed: bz (no COI) keeps the intrinsic 2.149, and bad (17.189) never fits.
  const noGood = await solve(lookup, WEAPON, { ...ergo, maxMOA: 3 });
  assert.equal(noGood.solution.objective, 1);
  assert.equal(count(noGood.build, 'bz'), 1);
});

test('a zero or negative barrel COI falls back to the intrinsic COI instead of overriding it', async () => {
  const lookup = lookupOf(
    gunWith(WEAPON, { coi: 0.5, slots: [slot('s', ['bm', 'bn', 'bg'])] }),
    ['bm', modWith('bm', { ergo: 3 })],
    ['bn', modWith('bn', { ergo: 4, coi: -0.25 })],
    ['bg', modWith('bg', { ergo: 2, coi: 0.125 })],
  );
  // intrinsic 17.189 > 10: only the replacing barrel bg (4.297) is feasible; the receiver alone, bm and bn all keep 17.189.
  const { solution, build } = await solve(lookup, WEAPON, { ...ergo, maxMOA: 10 });
  assert.equal(solution.objective, 2);
  assert.equal(count(build, 'bg'), 1);
});

test('a zero-intrinsic-COI receiver still gets its replacement rows, and its constant fallback row is kept', async () => {
  const lookup = lookupOf(
    gunWith(WEAPON, { coi: 0, slots: [slot('s', ['b'])] }),
    ['b', modWith('b', { ergo: 9, coi: 0.125 })],
  );
  // intrinsic MOA is 0 (a constant row 0 >= -L, true for L = 3); the barrel's 4.297 exceeds 3, so it must stay out.
  const capped = await solve(lookup, WEAPON, { ...ergo, maxMOA: 3 });
  assert.equal(capped.solution.status, 'Optimal');
  assert.equal(count(capped.build, 'b'), 0);
  assert.ok(capped.model.lp.includes('moa_rep_1'));
  const roomy = await solve(lookup, WEAPON, { ...ergo, maxMOA: 5 });
  assert.equal(count(roomy.build, 'b'), 1);
  // A negative cap is below the constant intrinsic MOA 0: no build exists and no row is silently dropped.
  const below = await solve(lookup, WEAPON, { ...ergo, maxMOA: -1 });
  assert.equal(below.solution.status, 'Infeasible');
});

test('the constant intrinsic MOA row of a receiver with no barrel: a cap below it contradicts every build', async () => {
  const lookup = lookupOf(gunWith(WEAPON, { coi: 0.0625, slots: [slot('s', ['a'])] }), ['a', modWith('a', { ergo: 4 })]);
  const ok = await solve(lookup, WEAPON, { ...ergo, maxMOA: 2.2 });
  assert.equal(ok.solution.status, 'Optimal');
  const tooTight = await solve(lookup, WEAPON, { ...ergo, maxMOA: 2 });
  assert.equal(tooTight.solution.status, 'Infeasible');
  // A zero intrinsic COI with no barrel is the empty row 0 >= -L: it holds for L >= 0 and is a contradiction for L < 0.
  const zero = lookupOf(gunWith(WEAPON, { coi: 0, slots: [slot('s', ['a'])] }), ['a', modWith('a', { ergo: 4 })]);
  const holds = await solve(zero, WEAPON, { ...ergo, maxMOA: 0 });
  assert.equal(holds.solution.status, 'Optimal');
  assert.equal(holds.model.rowFamilies.find(f => f.id === 'moa')?.vacuous, 1);
  const fails = await solve(zero, WEAPON, { ...ergo, maxMOA: -0.5 });
  assert.equal(fails.model.provedEmpty?.source, 'request');
  assert.equal(fails.solution.status, 'Infeasible');
});

test('signed accuracy: a negative suppressor modifier widens the MOA and a positive one tightens it', async () => {
  const lookup = lookupOf(
    gunWith(WEAPON, { coi: 0.125, slots: [slot('s1', ['sup']), slot('s2', ['scope'])] }),
    ['sup', modWith('sup', { ergo: 5, accuracy: -5 })],
    ['scope', modWith('scope', { ergo: 1, accuracy: 10 })],
  );
  // MOA 4.297 intrinsic; suppressor alone 4.512; scope alone 3.867; both 4.082.
  const tight = await solve(lookup, WEAPON, { ...ergo, maxMOA: 4.4 });
  assert.equal(count(tight.build, 'scope'), 1);
  assert.equal(count(tight.build, 'sup'), 1, 'with the scope the suppressor fits: 4.082 <= 4.4');
  const tighter = await solve(lookup, WEAPON, { ...ergo, maxMOA: 4.0 });
  assert.equal(count(tighter.build, 'scope'), 1);
  assert.equal(count(tighter.build, 'sup'), 0, '4.082 > 4.0 but 3.867 <= 4.0');
});

test('A_min counts every physical occurrence, so two negative-accuracy copies do not make a replacement row falsely infeasible', async () => {
  const lookup = lookupOf(
    gunWith(WEAPON, { coi: 0.0625, slots: [slot('b', ['bb']), slot('s1', ['sup']), slot('s2', ['sup'])] }),
    ['bb', modWith('bb', { ergo: 100, coi: 0.5 })],
    ['sup', modWith('sup', { ergo: 3, accuracy: -5 })],
  );
  // intrinsic 2.149 x 1.10 = 2.364 <= 3 with two suppressors; the 17.189 barrel never fits, so the optimum is two suppressors, no barrel.
  const { solution, build } = await solve(lookup, WEAPON, { ...ergo, maxMOA: 3 });
  assert.equal(solution.status, 'Optimal');
  assert.equal(count(build, 'sup'), 2);
  assert.equal(count(build, 'bb'), 0);
  assert.ok((await solve(lookup, WEAPON, { ...ergo, maxMOA: 3 })).model.activeBounds?.accuracy.lo as number <= -10);
});

test('M_b is derived from the data, never a literal: a barrel whose MOA is far above 1000 does not make the model falsely infeasible', async () => {
  const lookup = lookupOf(
    gunWith(WEAPON, { coi: 0.0625, slots: [slot('s', ['huge'])] }),
    ['huge', modWith('huge', { ergo: 50, coi: 100 })], // 100 x K = 3437.7 MOA
  );
  const { solution, build, model } = await solve(lookup, WEAPON, { ...ergo, maxMOA: 5 });
  assert.equal(solution.status, 'Optimal');
  assert.equal(count(build, 'huge'), 0, 'the 3437 MOA barrel never fits a cap of 5');
  const row = model.lp.split('\n').find(l => l.includes('moa_rep_1:')) ?? '';
  assert.ok(/3437\.7\d*/.test(row) || /34\.3\d* acc_total/.test(row), `the replacement row is stated with the data-derived constants: ${row}`);
  assert.ok(!/\b1000 x_1\b/.test(row), 'no 1000 literal');
});

test('the cap is exact at its boundary: 62500/29089 MOA is met a millionth above and missed a millionth below', async () => {
  const lookup = lookupOf(gunWith(WEAPON, { coi: 0.0625, slots: [slot('s', ['a'])] }), ['a', modWith('a', { ergo: 4 })]);
  const intrinsic = 62500 / 29089;
  assert.equal((await solve(lookup, WEAPON, { ...ergo, maxMOA: intrinsic + 1e-6 })).solution.status, 'Optimal');
  assert.equal((await solve(lookup, WEAPON, { ...ergo, maxMOA: intrinsic - 1e-6 })).solution.status, 'Infeasible');
  // with accuracy: a +20 percent points scales it by 0.8, so the boundary moves to 0.8 x 62500/29089.
  const sharpened = lookupOf(gunWith(WEAPON, { coi: 0.0625, slots: [slot('s', ['a'], true)] }), ['a', modWith('a', { ergo: 4, accuracy: 20 })]);
  assert.equal((await solve(sharpened, WEAPON, { ...ergo, maxMOA: 0.8 * intrinsic + 1e-6 })).solution.status, 'Optimal');
  assert.equal((await solve(sharpened, WEAPON, { ...ergo, maxMOA: 0.8 * intrinsic - 1e-6 })).solution.status, 'Infeasible');
});

test('an exact-zero Big-M stays zero: no denormal coefficient reaches the text, where HiGHS would drop it', async () => {
  // intrinsic COI 0 and a cap of 0: MOA^max - L is exactly 0, so the fallback row has no Big-M term at all.
  const lookup = lookupOf(gunWith(WEAPON, { coi: 0, slots: [slot('s', ['b'])] }), ['b', modWith('b', { ergo: 2, coi: 0.125 })]);
  const { model } = await solve(lookup, WEAPON, { ...ergo, maxMOA: 0 });
  assert.equal(model.matrixFilterRisk, false);
  assert.ok(!/e-3\d\d/.test(model.lp), 'no denormal number');
  assert.ok(model.stats.minAbsCoefficient > 1e-9);
});
