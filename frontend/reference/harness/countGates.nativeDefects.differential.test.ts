// Two native defects of the pinned HiGHS 1.15.1 the Stage 3 count-model gates found (workstream 3.1, countGates.differential.ts), with minimal
// reproductions, and the regression tests of how production now handles them (Stage 3 follow-up, owner decisions of 2026-10-12, docs/stage2-plan.md
// decision 5a). Both are defects of the solver under production's EXACT native options (presolve off, mip_rel_gap 0, mip_abs_gap 1e-9, integrality 1e-7
// per decision 5b, primal/dual feasibility 1e-9), not of the count model: the model text is right (its point is validated by both validators).
//
// 1. SolveError. On some small certified count models HiGHS returns the model status `SolveError` for random_seed 0 AND 11 and `Optimal` for others
//    (and with integrality 1e-9 or 1e-6, or with presolve on). Before the follow-up, `solveWithPresolvePolicy` turned that status into a typed
//    `SolverError`, so `solvePrecise` and `solve()` THREW for a valid request. Found by the gates' objective directions on two ledger fixtures:
//      F07-stock-empty                    weights ergo 0.53, recoil 1.98, price 1091.08  (exact optimum -1091.08)
//      F11-active-recoil-axis-weighted    weights ergo 1.07, recoil 0,    price 1753.12  (exact optimum -1753.12)
//    and in seeded worlds: 4 of the 3,200-world campaign; the adversarial MOA world 41000215 (profile { moa: true }) throws on its OWN request, and world
//    40000206 (profile { moa: true, bigAccuracy: true }) raised it on the third seed. Owner: "retry seeds, never throw". A SolveError (and PresolveError,
//    PostsolveError) is now an INCONCLUSIVE opinion and the node moves on to the next seed of `PRECISE_RANDOM_SEEDS` (six seeds); a certificate still needs
//    two agreeing qualified verdicts. The tests below run those requests end to end.
//
// 2. A false Infeasible that the second opinion does not catch. The integer count text of lpFuzz world 30001860 (TrueErgo) on the singleton weight node
//    [2.5, 2.5] kg is reported Infeasible under every production seed (and with integrality 1e-9), although it has a point both validators accept (the
//    oracle build [naked, i6 x1] of weight 2.5); the relaxed-edge text of the same node finds it. Owner: "relaxation must agree". A node is now treated
//    as infeasible only when its relaxed-edge text (same cuts) is settled Infeasible too; an integer-text Infeasible whose relaxation has a point, or no
//    settled verdict, leaves the node unresolved (no certificate), and an integral relaxed point the validator accepts becomes the node's build. The tests
//    below show the guard on the real node text and, with a solver that answers Infeasible for every integer text (this defect, everywhere), end to end.
//    The guard is sound, not complete: the ROW-DELETED minimal text below keeps the false Infeasible on its relaxation too (characterized below), so a
//    relaxation that shares the defect is not detected.
//
// Run alone: cd frontend && npx tsx --test reference/harness/countGates.nativeDefects.differential.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEDGER } from '../ledger/index';
import type { SolveParams } from '../../src/solver/types';
import { prepareSubproblemDomain, preparePhysicalWeapon, specializeCount } from '../../src/solver/physical';
import { adversarialCase } from './acyclicFastWorlds.differential';
import { generateCase } from './lpFuzz.differential';
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
interface NativeResultLike {
  modelStatus: { code: number; name: string };
  objectiveValue: number | null;
  mipDualBound: number | null;
  colNames: readonly string[] | null;
  colValues: Float64Array | null;
}
type SolveFnLike = (lp: string, options: Record<string, number | boolean | string>, extras?: unknown) => Promise<NativeResultLike>;
interface PreciseRunLike {
  kind: string;
  best?: { score: number };
  certified?: boolean;
  outcome: { status: string; physical_certificate: string; reason?: string };
  summary: { telemetry: { inconclusiveSolves: number; extraSeedSolves: number; relaxationChecks: number; relaxationVetoes: number; relaxationRescues: number; confirmedInfeasible: number } };
}
interface PreciseLike {
  solvePrecise(context: { params: SolveParams; deadline: number; solve?: SolveFnLike; edgeIntegrality?: 'relaxed-first' | 'integer' }): Promise<PreciseRunLike>;
  PRECISE_RANDOM_SEEDS: readonly number[];
}
interface NativeSolveFnLike {
  nativeSolve: SolveFnLike;
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
  test(`production Precise returns the certified optimum of ${c.id} with weights ${JSON.stringify(c.weights)} instead of throwing (inconclusive seeds retried)`, async () => {
    const ledgerCase = LEDGER.find(x => x.id === c.id);
    assert.ok(ledgerCase, c.id);
    const { params } = toProduction(ledgerCase.fixture, ledgerCase.request, { preciseMode: true, objectiveTolerance: 1e-9 });
    const { solvePrecise } = (await import(SOLVE_PRECISE)) as PreciseLike;
    const weighted = { ...params, ergoWeight: c.weights.e, recoilWeight: c.weights.r, priceWeight: c.weights.p };
    // At the gates' 1e-9 tolerance: the optimum, never a throw. A certificate is not promised there (decision 5b: two Optimal bounds may sit 1e-7
    // apart, which is a disagreement at 1e-9; on F07 seeds 29 and 47 do, and the remaining seeds are inconclusive), so the answer is the optimum with
    // either a certificate or the proof-prerequisite reason.
    const result = await solvePrecise({ params: weighted, deadline: performance.now() + 30_000 });
    assert.equal(result.kind, 'build');
    assert.ok(Math.abs((result.best?.score ?? Number.NaN) - c.optimum) <= 1e-6);
    assert.ok(result.summary.telemetry.inconclusiveSolves >= 1, 'the defect still occurs: at least one solve reached no verdict');
    assert.ok(result.summary.telemetry.extraSeedSolves >= 1, 'and the node moved on to further seeds');
    assert.ok(result.certified === true || (result.outcome.status === 'feasible' && result.outcome.reason === 'Required proof prerequisite unavailable'), `${result.outcome.status} / ${result.outcome.reason}`);
    // At the default runtime tolerance (1e-5) two agreeing qualified verdicts are reached within the seed list: the certified optimum.
    const atDefault = await solvePrecise({ params: { ...weighted, objectiveTolerance: 1e-5 }, deadline: performance.now() + 30_000 });
    assert.equal(atDefault.kind, 'build');
    assert.ok(Math.abs((atDefault.best?.score ?? Number.NaN) - c.optimum) <= 1e-6);
    assert.ok(atDefault.summary.telemetry.inconclusiveSolves >= 1);
    assert.equal(atDefault.certified, true, 'two agreeing qualified verdicts within the seed list');
    assert.equal(atDefault.outcome.status, 'optimal');
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

/** The model text of fuzz world 30001860's TrueErgo request on the singleton weight node [2.5, 2.5] kg, as production's `specializeCount` writes it. */
function world30001860Node(): { params: SolveParams; integer: string; relaxed: string } {
  const world = generateCase(30001860);
  const { params } = toProduction(world.fixture, world.request, { preciseMode: true, objectiveTolerance: 1e-9 });
  const blueprint = preparePhysicalWeapon(params.itemLookup, params.weaponId, params.physicalOptions);
  const domain = prepareSubproblemDomain(blueprint, params.itemLookup, params);
  const model = specializeCount(blueprint, domain, params, { weightMin: 2.5, weightMax: 2.5 });
  return { params, integer: model.lp(), relaxed: model.lpRelaxedEdges() };
}

/** A text whose slot-edge columns are integer (the integer count text), as opposed to the relaxed-edge text where they are bounded continuous columns. */
const integerEdges = (lp: string): boolean => {
  const at = lp.search(/\n(General|Binary)\n/);
  return at >= 0 && /\se_\d+_\d+\b/.test(lp.slice(at));
};

test('native defect 2 (characterization of the limit of the guard): on the ROW-DELETED minimal text the relaxed-edge text is falsely Infeasible too', async () => {
  const native = (await import(NATIVE)) as NativeLike;
  const { nativeSolveOptions } = (await import(NATIVE_SOLVE)) as NativeSolveLike;
  const production = { ...nativeSolveOptions(1e-9), presolve: 'off', time_limit: 60 };
  // Relax the edge columns of the minimal text as `lpRelaxedEdges` does: out of Binary and General; a binary edge gets the bounds 0 and 1 (a general one has its own).
  const out: string[] = [];
  const binaryEdges: string[] = [];
  let section = '';
  for (const line of MINIMAL_FALSE_INFEASIBLE_LP.split('\n')) {
    if (['Bounds', 'General', 'Binary', 'End'].includes(line.trim())) section = line.trim();
    if ((section === 'General' || section === 'Binary') && line.startsWith('  ')) {
      const names = line.trim().split(/\s+/);
      const edges = names.filter(n => /^e_\d+_\d+$/.test(n));
      if (section === 'Binary') binaryEdges.push(...edges);
      out.push(`  ${names.filter(n => !edges.includes(n)).join(' ')}`);
      continue;
    }
    out.push(line);
  }
  const relaxed = out.join('\n').replace('\nGeneral\n', `\n${binaryEdges.map(e => `  0 <= ${e} <= 1`).join('\n')}\nGeneral\n`);
  assert.equal(integerEdges(relaxed), false);
  for (const seed of [0, 11, 29]) assert.equal((await native.getNativeHighs().solveStructured(relaxed, { ...production, random_seed: seed })).modelStatus.name, 'Infeasible', `seed ${seed}`);
  assert.equal((await native.getNativeHighs().solveStructured(relaxed, { ...production, presolve: 'choose' })).modelStatus.name, 'Optimal', 'yet it is feasible');
});

/** The pinned solve, except that every INTEGER count text is answered Infeasible (defect 2 everywhere); `tamperRelaxed` may also rewrite relaxed answers. */
async function lyingSolve(tamperRelaxed?: (r: NativeResultLike) => NativeResultLike): Promise<SolveFnLike> {
  const { nativeSolve } = (await import(NATIVE_SOLVE)) as NativeSolveFnLike;
  return async (lp, options, extras) => {
    const real = await nativeSolve(lp, options, extras);
    if (integerEdges(lp)) return { ...real, modelStatus: { code: 8, name: 'Infeasible' }, colValues: null, objectiveValue: null, mipDualBound: null };
    return tamperRelaxed === undefined ? real : tamperRelaxed(real);
  };
}

test('relaxation must agree: with every integer text answered Infeasible, integer-only Precise on world 30001860 still returns its certified optimum (found by the relaxation), never emptiness', async () => {
  const { solvePrecise } = (await import(SOLVE_PRECISE)) as PreciseLike;
  const { params } = world30001860Node();
  const honest = await solvePrecise({ params, deadline: performance.now() + 60_000, edgeIntegrality: 'integer' });
  assert.equal(honest.kind, 'build');
  assert.equal(honest.certified, true);
  const lying = await solvePrecise({ params, deadline: performance.now() + 60_000, edgeIntegrality: 'integer', solve: await lyingSolve() });
  assert.equal(lying.kind, 'build', `got ${lying.kind}: ${lying.outcome.status} / ${lying.outcome.reason}`);
  assert.ok(Math.abs((lying.best?.score ?? Number.NaN) - (honest.best?.score ?? Number.NaN)) <= 1e-6, 'the same optimum');
  assert.ok(lying.summary.telemetry.relaxationChecks >= 1, 'each integer Infeasible was put to the relaxation');
  assert.ok(lying.summary.telemetry.relaxationRescues >= 1, 'and the relaxation found the build the integer text hid');
});

test('relaxation must agree: an integer-text Infeasible after a FRACTIONAL relaxation of the same text is never a certified infeasibility (relaxed-first, no extra solve)', async () => {
  const { solvePrecise } = (await import(SOLVE_PRECISE)) as PreciseLike;
  const { params } = world30001860Node();
  // Every relaxed answer gets one slot edge set to 0.5: a fractional relaxation (still a valid bound), so every node falls back to the lying integer text.
  const fractional = (r: NativeResultLike): NativeResultLike => {
    if (r.modelStatus.name !== 'Optimal' || r.colValues === null || r.colNames === null) return r;
    const j = r.colNames.findIndex(name => /^e_\d+_\d+$/.test(name));
    if (j < 0) return r;
    const colValues = Float64Array.from(r.colValues);
    colValues[j] = 0.5;
    return { ...r, colValues };
  };
  const result = await solvePrecise({ params, deadline: performance.now() + 60_000, solve: await lyingSolve(fractional) });
  assert.notEqual(result.kind, 'empty', 'no node is pruned on an integer verdict its relaxation does not share');
  assert.notEqual(result.outcome.physical_certificate, 'certified_infeasible');
  assert.notEqual(result.outcome.status, 'optimal');
  assert.equal(result.outcome.reason, 'Required proof prerequisite unavailable');
  assert.ok(result.summary.telemetry.relaxationVetoes >= 1);
  assert.equal(result.summary.telemetry.relaxationChecks, 0, 'the fractional relaxation of the same text already refutes the agreement');
  assert.equal(result.summary.telemetry.confirmedInfeasible, 0);
});

for (const [seed, profile] of [[41000215, { moa: true }], [40000206, { moa: true, bigAccuracy: true }]] as const) {
  test(`production Precise answers the own request of adversarial MOA world ${seed} ${JSON.stringify(profile)} instead of throwing`, async () => {
    const world = adversarialCase(seed, profile);
    const { params } = toProduction(world.fixture, world.request, { preciseMode: true, objectiveTolerance: 1e-9 });
    const { solvePrecise } = (await import(SOLVE_PRECISE)) as PreciseLike;
    const result = await solvePrecise({ params, deadline: performance.now() + 30_000 });
    assert.ok(result.kind === 'build' || result.kind === 'empty', `${result.kind}: ${result.outcome.status} / ${result.outcome.reason}`);
  });
}
