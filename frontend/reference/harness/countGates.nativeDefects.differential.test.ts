// Two production-relevant native defects the Stage 3 count-model gates found (workstream 3.1, countGates.differential.ts), kept as TODO tests with
// minimal reproductions. Not fixed here: the gates never edit production (docs/stage3-plan.md, "Rules carried over"). Both are defects of the pinned
// HiGHS 1.15.1 under production's EXACT native options (presolve off, mip_rel_gap 0, mip_abs_gap 1e-9, integrality 1e-7 per decision 5b, primal/dual
// feasibility 1e-9), not of the count model: the model text is right (its point is validated by both validators), the solver's answer is not.
//
// 1. SolveError raised as SolverError. On some small certified count models HiGHS returns the model status `SolveError` for random_seed 0 AND 11, the
//    first two seeds of `PRECISE_RANDOM_SEEDS`. `solveWithPresolvePolicy` turns that status into a typed `SolverError` (neither optimal, a limit nor an
//    infeasibility), so `solvePrecise` and `solve()` THROW for a valid request: the request fails instead of returning the certified optimum. The same text
//    is Optimal with seed 29, with integrality 1e-9 or 1e-6, or with presolve on. Found by the gates' objective directions on two ledger fixtures:
//      F07-stock-empty                    weights ergo 0.53, recoil 1.98, price 1091.08  (exact optimum -1091.08)
//      F11-active-recoil-axis-weighted    weights ergo 1.07, recoil 0,    price 1753.12  (exact optimum -1753.12)
//    and in seeded worlds: in the 3,200-world campaign 4 worlds raised it, and in the adversarial MOA world 41000215 (profile { moa: true }) it is the
//    world's OWN request that throws; another world (40000206) raised it on the THIRD seed, 29. User-reachable weight settings.
//
// 2. A false Infeasible that the second opinion does not catch. The integer count text of lpFuzz world 30001860 (TrueErgo) on the singleton weight node
//    [2.5, 2.5] kg is reported Infeasible under seeds 0, 11 AND 29 (and with integrality 1e-9), although it has a point both validators accept (the
//    oracle build [naked, i6 x1] of weight 2.5; the relaxed-edge text and presolve on find it). Production's decision 5a settles a node on two agreeing
//    qualified verdicts, so on this text it would CERTIFY the node infeasible. In that world production still returns the certified optimum (it solves
//    the relaxed-edge text first and its spatial nodes are not this singleton), so no wrong answer was observed end to end; the defect shows that a
//    seed-only second opinion is not a sound guard for infeasibility verdicts of the integer text.
//
// What production should do about either (retry with another seed or setting, treat as unresolved, cross-check infeasibility differently) is an owner
// decision; this file only records the defects.
//
// Run alone: cd frontend && npx tsx --test reference/harness/countGates.nativeDefects.differential.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEDGER } from '../ledger/index';
import type { SolveParams } from '../../src/solver/types';
import { adversarialCase } from './acyclicFastWorlds.differential';
import { toProduction } from './toProduction.differential';

/** The minimal reproduction: the direction model of F07-stock-empty above, shrunk by row deletion while the SolveError persists (9 of 19 rows). */
const MINIMAL_SOLVE_ERROR_LP = `Maximize
  obj: total_obj
Subject To
  base_sum: 1 base_0 = 1
  raw_ergo_def: 1 raw_ergo - 1 n_2 - 2 n_5 = 0
  c1_regime: 1 c1_low + 1 c1_mid + 1 c1_high = 1
  c1_zero: 1 capped_ergo + 100 c1_low <= 100
  c1_full: 1 capped_ergo - 100 c1_high >= 0
  c1_eqhi: 1 capped_ergo - 1 raw_ergo + 201 c1_mid <= 201
  ergo_frame: 1 ergo_axis - 10 capped_ergo = 0
  price_def: 1 price_axis - 1000 base_0 - 100 n_2 - 300 n_5 = 0
  obj_def: 1 total_obj - 0.053000000000000005 ergo_axis + 1.98 rec_axis + 1.0910799999999998 price_axis = 0
Bounds
  -1.6653345369377358e-15 <= raw_ergo <= 3.000000000000002
  0 <= capped_ergo <= 3.000000000000002
  rec_mod = 0
  rec_axis = 0
  0 <= price_axis <= 1400.000000000001
  0 <= ergo_axis <= 30.000000000000025
  -1527.5120000000013 <= total_obj <= 1.590000000000002
Binary
  base_0 n_2 n_5 e_0_2 e_4_5 c1_low c1_mid c1_high
End
`;

interface NativeLike {
  getNativeHighs(): { solveStructured(lp: string, options: Record<string, number | boolean | string>): Promise<{ modelStatus: { name: string }; objectiveValue: number | null }> };
}
interface NativeSolveLike {
  nativeSolveOptions(tau: number): Record<string, number | boolean | string>;
}
interface PreciseLike {
  solvePrecise(context: { params: SolveParams; deadline: number }): Promise<{ kind: string; best?: { score: number } }>;
}
const NATIVE = '../../src/solver/native/index.ts';
const NATIVE_SOLVE = '../../src/solver/physical/nativeSolve.ts';
const SOLVE_PRECISE = '../../src/solver/physical/solvePrecise.ts';

test('native defect 1 (characterization): the minimal count model is SolveError under production options with seeds 0 and 11, Optimal otherwise', async () => {
  const native = (await import(NATIVE)) as NativeLike;
  const { nativeSolveOptions } = (await import(NATIVE_SOLVE)) as NativeSolveLike;
  const production = { ...nativeSolveOptions(1e-9), presolve: 'off', time_limit: 60 };
  const status = async (options: Record<string, number | boolean | string>): Promise<string> => (await native.getNativeHighs().solveStructured(MINIMAL_SOLVE_ERROR_LP, options)).modelStatus.name;
  assert.equal(await status({ ...production, random_seed: 0 }), 'SolveError');
  assert.equal(await status({ ...production, random_seed: 11 }), 'SolveError');
  assert.equal(await status({ ...production, random_seed: 29 }), 'Optimal');
  assert.equal(await status({ ...production, random_seed: 0, mip_feasibility_tolerance: 1e-9 }), 'Optimal');
  assert.equal(await status({ ...production, random_seed: 0, mip_feasibility_tolerance: 1e-6 }), 'Optimal');
});

const CASES: { id: string; weights: { e: number; r: number; p: number }; optimum: number }[] = [
  { id: 'F07-stock-empty', weights: { e: 0.53, r: 1.98, p: 1091.08 }, optimum: -1091.08 },
  { id: 'F11-active-recoil-axis-weighted', weights: { e: 1.07, r: 0, p: 1753.12 }, optimum: -1753.12 },
];

for (const c of CASES) {
  test(`production Precise returns the optimum of ${c.id} with weights ${JSON.stringify(c.weights)} instead of throwing`, {
    todo: 'production defect: a native SolveError under the decision-5b options with seeds 0 and 11 raises SolverError and fails the request (reported, not fixed by 3.1)',
  }, async () => {
    const ledgerCase = LEDGER.find(x => x.id === c.id);
    assert.ok(ledgerCase, c.id);
    const { params } = toProduction(ledgerCase.fixture, ledgerCase.request, { preciseMode: true, objectiveTolerance: 1e-9 });
    const { solvePrecise } = (await import(SOLVE_PRECISE)) as PreciseLike;
    const result = await solvePrecise({ params: { ...params, ergoWeight: c.weights.e, recoilWeight: c.weights.r, priceWeight: c.weights.p }, deadline: performance.now() + 30_000 });
    assert.equal(result.kind, 'build');
    assert.ok(Math.abs((result.best?.score ?? Number.NaN) - c.optimum) <= 1e-6);
  });
}

/**
 * The minimal reproduction of defect 2: the integer count text of lpFuzz world 30001860 on the weight node [2.5, 2.5], shrunk by row deletion (17 of 45
 * rows) while "Infeasible under production options with seeds 0 and 11, Optimal with presolve on" persists.
 */
const MINIMAL_FALSE_INFEASIBLE_LP = `Maximize
  obj: total_obj
Subject To
  base_sum: 1 base_0 + 1 base_1 = 1
  in_6: 1 n_6 - 1 e_3_6 - 1 e_4_6 = 0
  slot_3: 1 e_3_2 + 1 e_3_6 - 1 n_1 <= 0
  slot_4: 1 e_4_2 + 1 e_4_6 + 1 e_4_7 - 1 n_1 <= 0
  tconf_0: 1 n_1 + 1 n_3 <= 1
  node_fix: 1 weight = 2.5
  raw_ergo_def: 1 raw_ergo - 5 n_1 + 2 n_2 - 6 n_3 - 3 n_4 + 6 n_6 - 2 n_7 = 11
  rec_mod_def: 1 rec_mod + 0.15625 n_1 + 0.03125 n_2 + 0.03125 n_6 - 0.0625 n_7 = 0
  rec_axis_def: 1 rec_axis - 1000 rec_mod = 0
  weight_def: 1 weight - 0.25 n_1 - 1.5 n_2 - 0.75 n_3 - 0.5 n_4 - 0.5 n_6 - 1 n_7 = 1
  c1_regime: 1 c1_low + 1 c1_mid + 1 c1_high = 1
  c1_zero: 1 capped_ergo + 100 c1_low <= 100
  c1_full: 1 capped_ergo - 100 c1_high >= 0
  c1_eqhi: 1 capped_ergo - 1 raw_ergo + 201 c1_mid <= 201
  price_def: 1 price_axis - 3500 base_0 - 5000 base_1 - 300 n_1 - 100 n_2 - 50 n_4 - 150 lot_3_0 - 400 lot_6_0 = 0
  lim_min_ergo: 1 capped_ergo >= 7
  obj_def: 1 total_obj - 0.2 ergo_axis + 1 rec_axis + 0.001 price_axis = 0
Bounds
  0 <= n_2 <= 3
  0 <= n_6 <= 2
  0 <= e_7_2 <= 2
  0 <= lot_3_0 <= 1
  0 <= lot_6_0 <= 2
  -2.0000000000000853 <= raw_ergo <= 27.00000000000009
  0 <= capped_ergo <= 27.00000000000009
  -0.31250000000000083 <= rec_mod <= 7.806255641895636e-16
  -312.5000000000009 <= rec_axis <= 7.806255641895637e-13
  0 <= price_axis <= 6600.000000000006
  0.9999999999999774 <= weight <= 8.000000000000025
  0 <= gear_ergo <= 27.00000000000009
  0 <= eff_ergo <= 27.00000000000009
  0 <= ted <= 27.00000000000009
  0 <= ergo_axis <= 270.00000000000097
  -6.600000000000789 <= total_obj <= 366.5000000000013
General
  n_2 n_6 e_7_2 lot_3_0 lot_6_0
Binary
  base_0 base_1 n_1 n_3 n_4 n_7 e_0_1 e_1_2 e_1_3 e_2_4 e_3_2 e_3_6 e_4_2 e_4_6 e_4_7 e_6_2 c1_low c1_mid c1_high c2_low c2_mid c2_high
End
`;

/** A point of the minimal model: base_0, one copy of n_2 (weight 1 + 1.5 = 2.5, raw ergonomics 11 - 2 = 9 >= 7, the clamp's middle regime). */
const FEASIBLE_POINT_ROWS = [
  'p_base0: base_0 = 1', 'p_base1: base_1 = 0', 'p_n1: n_1 = 0', 'p_n2: n_2 = 1', 'p_n3: n_3 = 0', 'p_n4: n_4 = 0', 'p_n6: n_6 = 0', 'p_n7: n_7 = 0',
  'p_e36: e_3_6 = 0', 'p_e46: e_4_6 = 0', 'p_e32: e_3_2 = 0', 'p_e42: e_4_2 = 0', 'p_e47: e_4_7 = 0', 'p_lot3: lot_3_0 = 0', 'p_lot6: lot_6_0 = 0',
  'p_low: c1_low = 0', 'p_mid: c1_mid = 1', 'p_high: c1_high = 0',
];

test('native defect 2 (characterization): the minimal count model has a feasible point; production options say Infeasible under every production seed', async () => {
  const native = (await import(NATIVE)) as NativeLike;
  const { nativeSolveOptions } = (await import(NATIVE_SOLVE)) as NativeSolveLike;
  const production = { ...nativeSolveOptions(1e-9), presolve: 'off', time_limit: 60 };
  const status = async (lp: string, options: Record<string, number | boolean | string>): Promise<string> => (await native.getNativeHighs().solveStructured(lp, options)).modelStatus.name;
  const at = MINIMAL_FALSE_INFEASIBLE_LP.indexOf('\nBounds\n');
  const pinned = `${MINIMAL_FALSE_INFEASIBLE_LP.slice(0, at)}\n${FEASIBLE_POINT_ROWS.map(r => `  ${r}`).join('\n')}${MINIMAL_FALSE_INFEASIBLE_LP.slice(at)}`;
  assert.equal(await status(pinned, { ...production, random_seed: 0 }), 'Optimal', 'the point satisfies every row');
  assert.equal(await status(MINIMAL_FALSE_INFEASIBLE_LP, { ...production, presolve: 'choose' }), 'Optimal');
  for (const seed of [0, 11, 29]) assert.equal(await status(MINIMAL_FALSE_INFEASIBLE_LP, { ...production, random_seed: seed }), 'Infeasible', `seed ${seed}`);
});

test('production options do not report the feasible minimal count model Infeasible under the second-opinion seeds', {
  todo: 'native defect: a false Infeasible under seeds 0, 11 and 29 that decision 5a would settle as a certified infeasible node (reported, not fixed by 3.1)',
}, async () => {
  const native = (await import(NATIVE)) as NativeLike;
  const { nativeSolveOptions } = (await import(NATIVE_SOLVE)) as NativeSolveLike;
  const production = { ...nativeSolveOptions(1e-9), presolve: 'off', time_limit: 60 };
  const verdicts = [];
  for (const seed of [0, 11]) verdicts.push((await native.getNativeHighs().solveStructured(MINIMAL_FALSE_INFEASIBLE_LP, { ...production, random_seed: seed })).modelStatus.name);
  assert.notDeepEqual(verdicts, ['Infeasible', 'Infeasible']);
});

test('production Precise answers the own request of adversarial MOA world 41000215 instead of throwing', {
  todo: 'production defect: native SolveError raised as SolverError on the request as drawn (reported, not fixed by 3.1)',
}, async () => {
  const world = adversarialCase(41000215, { moa: true });
  const { params } = toProduction(world.fixture, world.request, { preciseMode: true, objectiveTolerance: 1e-9 });
  const { solvePrecise } = (await import(SOLVE_PRECISE)) as PreciseLike;
  const result = await solvePrecise({ params, deadline: performance.now() + 30_000 });
  assert.ok(result.kind === 'build' || result.kind === 'empty', result.kind);
});
