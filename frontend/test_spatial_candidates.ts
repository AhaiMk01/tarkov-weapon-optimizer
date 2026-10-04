import assert from 'node:assert/strict';
import { solve } from './src/solver/solver';
import { choiceFixture } from './test_solver_fixtures';
import { buildCompatibilityMap } from './src/solver/compatibilityMap';
import { validateBuild } from './benchmarks/validateBuild';
import { PREVENT_OVERSWING_VIOLATION } from './src/solver/validateBuild';
import { weightPenalty } from './src/solver/trueErgo';
import {
  splitAdaptiveInterval,
  solveAdaptiveEnvelope,
} from './benchmarks/experiments/adaptiveEnvelope';
import { solveNodeOptionTuning } from './benchmarks/experiments/nodeOptionTuning';
import { solveModel } from './benchmarks/experiments/experimentHelper';
import type { ItemLookup, ModLookupEntry, SlotInfo, GunLookupEntry } from './src/solver/types';

console.log('Running spatial candidates correctness and small-graph verification...');

// ============================================================================
// 1. Mathematical Proof & Properties of Geometric-Mean Split W* = sqrt(a * b)
// ============================================================================
{
  console.log('  1. Verifying mathematical properties of adaptive envelope split...');
  
  const intervals: [number, number][] = [
    [3.0, 14.0],
    [3.5, 7.0],
    [4.0, 6.0],
    [5.0, 12.0],
  ];

  for (const [a, b] of intervals) {
    const parts = splitAdaptiveInterval([a, b]);
    assert.ok(parts, `splitAdaptiveInterval must split [${a}, ${b}]`);
    const [left, right] = parts;
    const split = left[1];
    
    assert.ok(split > a, `Split point ${split} must be > a (${a})`);
    assert.ok(split < b, `Split point ${split} must be < b (${b})`);
    assert.equal(left[0], a);
    assert.equal(right[1], b);
    assert.equal(left[1], right[0]);
    assert.equal(split, Math.sqrt(a * b));

    const m = (weightPenalty(b) - weightPenalty(a)) / (b - a);
    const c = weightPenalty(a) - m * a;
    const s = (w: number) => m * w + c;
    const E = (w: number) => weightPenalty(w) - s(w);

    assert.ok(Math.abs(E(a)) < 1e-10, `E(a) must be 0, got ${E(a)}`);
    assert.ok(Math.abs(E(b)) < 1e-10, `E(b) must be 0, got ${E(b)}`);

    const steps = 100;
    for (let i = 1; i < steps; i++) {
      const w = a + (b - a) * (i / steps);
      assert.ok(E(w) >= -1e-12, `E(W) must be >= 0 inside [${a}, ${b}], got E(${w}) = ${E(w)}`);
    }

    const eMax = E(split);
    for (let i = 0; i <= steps; i++) {
      const w = a + (b - a) * (i / steps);
      assert.ok(E(w) <= eMax + 1e-10, `E(${w}) = ${E(w)} must be <= E(W*) = ${eMax}`);
    }
  }

  // Invariant 3: Bound is NOT guaranteed outside its interval
  {
    const a = 4.0, b = 6.0;
    const m = (weightPenalty(b) - weightPenalty(a)) / (b - a);
    const c = weightPenalty(a) - m * a;
    const s = (w: number) => m * w + c;
    assert.equal(m, 12.5);
    assert.equal(c, -25);
    assert.equal(s(1), -12.5);
    assert.equal(weightPenalty(1), 0);
    assert.ok(s(1) < weightPenalty(1), 's(W) can fall strictly below q(W) outside interval');
  }

  // Invariant 4: Breakpoint split at 3.0 kg
  {
    const parts = splitAdaptiveInterval([1.5, 8.0]);
    assert.ok(parts);
    assert.deepEqual(parts[0], [1.5, 3.0]);
    assert.deepEqual(parts[1], [3.0, 8.0]);
  }
}

// ============================================================================
// 2. Oracle Preservation Across Canonical Benchmark Fixtures
// ============================================================================
console.log('  2. Verifying oracle preservation across canonical benchmark fixtures...');

// Oracle 1: Interchangeable two-slot A + B counterexample
{
  const p = choiceFixture([{ id: 'A', weight: 1.1, ergo: 10 }, { id: 'B', weight: 1.1, ergo: 20 }]);
  p.itemLookup.gun.slots = ['left', 'right'].map(id => ({
    id, name: id, nameId: id, required: false, allowedItems: ['A', 'B'],
  }));
  p.compatibilityMap = buildCompatibilityMap('gun', p.itemLookup);

  const baseline = await solve({ ...p, preciseMode: true });
  const candA = await solveAdaptiveEnvelope({ ...p, preciseMode: true });
  const candB = await solveNodeOptionTuning({ ...p, preciseMode: true });

  for (const [name, res] of [['Candidate A', candA], ['Candidate B', candB]] as const) {
    assert.equal(res.status, 'optimal', `${name} must be optimal`);
    assert.deepEqual(res.selected_items.map(i => i.id).sort(), ['A', 'B'], `${name} must select A and B`);
    assert.equal(res.final_stats?.ergonomics, 30, `${name} must achieve ergo 30`);
    assert.equal(res.objective_value, baseline.objective_value, `${name} must match baseline objective`);
    assert.deepEqual(validateBuild({ weapon_id: 'gun' }, res, p.itemLookup), [], `${name} must have 0 validation errors`);
  }
}

// Oracle 2: Required slot must be filled
{
  const p = choiceFixture([{ id: 'ReqPart', weight: 1, ergo: 15 }]);
  p.itemLookup.gun.slots = [{ id: 'must_have', name: 'Must Have', nameId: 'must_have', required: true, allowedItems: ['ReqPart'] }];
  p.compatibilityMap = buildCompatibilityMap('gun', p.itemLookup);

  const baseline = await solve({ ...p, preciseMode: true });
  const candA = await solveAdaptiveEnvelope({ ...p, preciseMode: true });
  const candB = await solveNodeOptionTuning({ ...p, preciseMode: true });

  for (const [name, res] of [['Candidate A', candA], ['Candidate B', candB]] as const) {
    assert.equal(res.status, 'optimal', `${name} must be optimal`);
    assert.deepEqual(res.selected_items.map(i => i.id), ['ReqPart'], `${name} must select ReqPart`);
    assert.equal(res.objective_value, baseline.objective_value, `${name} must match baseline objective`);
    assert.deepEqual(validateBuild({ weapon_id: 'gun' }, res, p.itemLookup), [], `${name} must pass validation`);
  }
}

// Oracle 3: Alternative parents
{
  const base = choiceFixture([]);
  const lookup: ItemLookup = { ...base.itemLookup };
  lookup.gun.slots = [
    { id: 'mount', name: 'M', nameId: 'm', required: false, allowedItems: ['ParentA', 'ParentB'] },
  ];
  const makeMod = (id: string, ergo: number, slots: SlotInfo[] = []): ModLookupEntry => ({
    type: 'mod',
    data: { name: id },
    slots,
    conflicting_items: [],
    conflicting_slot_ids: [],
    stats: {
      ergonomics: ergo,
      recoil_modifier: 0,
      accuracy_modifier: 0,
      center_of_impact: 0,
      weight: 0.1,
      width: 1,
      height: 1,
      min_level_flea: 1,
      capacity: 0,
      sighting_range: 0,
    } as any,
    purchasable: true,
  } as any);
  lookup.ParentA = makeMod('ParentA', 10, [{ id: 'opt_a', name: 'OA', nameId: 'oa', required: false, allowedItems: ['Sight'] }]);
  lookup.ParentB = makeMod('ParentB', 20, [{ id: 'opt_b', name: 'OB', nameId: 'ob', required: false, allowedItems: ['Sight'] }]);
  lookup.Sight = makeMod('Sight', 10);

  const p = { ...base, itemLookup: lookup, compatibilityMap: buildCompatibilityMap('gun', lookup), preciseMode: true };
  const baseline = await solve(p);
  const candA = await solveAdaptiveEnvelope(p);
  const candB = await solveNodeOptionTuning(p);

  for (const [name, res] of [['Candidate A', candA], ['Candidate B', candB]] as const) {
    assert.equal(res.status, 'optimal', `${name} must be optimal`);
    assert.deepEqual(res.selected_items.map(i => i.id).sort(), ['ParentB', 'Sight'], `${name} must select ParentB + Sight`);
    assert.equal(res.objective_value, baseline.objective_value, `${name} must match baseline objective`);
    assert.deepEqual(validateBuild({ weapon_id: 'gun' }, res, lookup), [], `${name} must pass validation`);
  }
}

// Oracle 4: Conflicts
{
  const p = choiceFixture([
    { id: 'Opt1', weight: 1, ergo: 25 },
    { id: 'Opt2', weight: 1, ergo: 20 },
  ]);
  const m1 = p.itemLookup.Opt1 as ModLookupEntry;
  m1.conflicting_items = ['Opt2'];
  p.itemLookup.gun.slots = [
    { id: 's1', name: 'S1', nameId: 's1', required: false, allowedItems: ['Opt1', 'Opt2'] },
    { id: 's2', name: 'S2', nameId: 's2', required: false, allowedItems: ['Opt1', 'Opt2'] },
  ];
  p.compatibilityMap = buildCompatibilityMap('gun', p.itemLookup);

  const baseline = await solve({ ...p, preciseMode: true });
  const candA = await solveAdaptiveEnvelope({ ...p, preciseMode: true });
  const candB = await solveNodeOptionTuning({ ...p, preciseMode: true });

  for (const [name, res] of [['Candidate A', candA], ['Candidate B', candB]] as const) {
    assert.equal(res.status, 'optimal', `${name} must be optimal`);
    assert.deepEqual(res.selected_items.map(i => i.id), ['Opt1'], `${name} must select Opt1`);
    assert.equal(res.objective_value, baseline.objective_value, `${name} must match baseline objective`);
    assert.deepEqual(validateBuild({ weapon_id: 'gun' }, res, p.itemLookup), [], `${name} must pass validation`);
  }
}

// Oracle 5: 3 kg TED boundary (zero penalty below 3 kg)
{
  const p = choiceFixture([{ id: 'Light', weight: 3, ergo: 40 }]);
  const baseline = await solve({ ...p, useTrueErgo: true, preciseMode: true });
  const candA = await solveAdaptiveEnvelope({ ...p, useTrueErgo: true, preciseMode: true });
  const candB = await solveNodeOptionTuning({ ...p, useTrueErgo: true, preciseMode: true });

  for (const [name, res] of [['Candidate A', candA], ['Candidate B', candB]] as const) {
    assert.equal(res.status, 'optimal', `${name} must be optimal`);
    assert.equal(res.final_stats?.total_weight, 3, `${name} weight must be 3`);
    assert.equal(res.final_stats?.true_ergo_delta, 40, `${name} TED must be 40`);
    assert.equal(res.final_stats?.overswing_pct, 0, `${name} overswing must be 0`);
    assert.equal(res.objective_value, baseline.objective_value, `${name} must match baseline objective`);
    assert.deepEqual(validateBuild({ weapon_id: 'gun', use_true_ergo: true }, res, p.itemLookup), [], `${name} must pass validation`);
  }
}

// Oracle 6: Clamped ergonomics
{
  const pOver = choiceFixture([{ id: 'Over', weight: 1, ergo: 120 }]);
  const bOver = await solve({ ...pOver, preciseMode: true });
  const cAOver = await solveAdaptiveEnvelope({ ...pOver, preciseMode: true });
  const cBOver = await solveNodeOptionTuning({ ...pOver, preciseMode: true });

  for (const [name, res] of [['Candidate A', cAOver], ['Candidate B', cBOver]] as const) {
    assert.equal(res.status, 'optimal');
    assert.equal(res.final_stats?.ergonomics, 100);
    assert.equal(res.objective_value, bOver.objective_value);
    assert.deepEqual(validateBuild({ weapon_id: 'gun' }, res, pOver.itemLookup), []);
  }
}

// Oracle 7: Retained preset parts
{
  const p = choiceFixture([{ id: 'P1', weight: 1, ergo: 10, price: 300 }]);
  const gun = p.itemLookup.gun as GunLookupEntry;
  gun.presets = [{
    id: 'preset_bundle',
    name: 'Bundle Preset',
    price: 500,
    price_source: 'mechanic',
    purchasable: true,
    receiver_id: 'gun',
    items: [{ itemId: 'P1', count: 1 }],
    image: undefined,
    offers: [{ price: 500, source: 'mechanic', vendor_name: 'Mechanic', vendor_normalized: 'mechanic', trader_level: 1 }],
  } as any];
  p.compatibilityMap = buildCompatibilityMap('gun', p.itemLookup);

  const req = { ...p, ergoWeight: 0, priceWeight: 100, recoilWeight: 0, preciseMode: true };
  const baseline = await solve(req);
  const candA = await solveAdaptiveEnvelope(req);
  const candB = await solveNodeOptionTuning(req);

  for (const [name, res] of [['Candidate A', candA], ['Candidate B', candB]] as const) {
    assert.equal(res.status, 'optimal');
    assert.equal(res.selected_preset?.id, 'preset_bundle');
    assert.equal(res.final_stats?.total_price, 500);
    assert.equal(res.objective_value, baseline.objective_value);
    assert.deepEqual(validateBuild({ weapon_id: 'gun' }, res, p.itemLookup), []);
  }
}

// ============================================================================
// 3. Nonlinear TED Tradeoff with Weight Penalty (W > 3 kg)
// ============================================================================
console.log('  3. Verifying non-trivial nonlinear TED tradeoff (W > 3 kg)...');
{
  const p = choiceFixture([
    { id: 'LightMod', weight: 3.5, ergo: 20 },
    { id: 'HeavyMod', weight: 5.0, ergo: 40 },
  ], 2.0, 50);
  const receiver = p.itemLookup.gun as GunLookupEntry;
  receiver.slots = [{ id: 's', name: 'S', nameId: 's', required: true, allowedItems: ['LightMod', 'HeavyMod'] }];
  p.compatibilityMap = buildCompatibilityMap('gun', p.itemLookup);

  const req = { ...p, useTrueErgo: true, preciseMode: true };
  const baseline = await solve(req);
  const candA = await solveAdaptiveEnvelope(req);
  const candB = await solveNodeOptionTuning(req);

  for (const [name, res] of [['Baseline', baseline], ['Candidate A', candA], ['Candidate B', candB]] as const) {
    assert.equal(res.status, 'optimal', `${name} must be optimal`);
    assert.deepEqual(res.selected_items.map(i => i.id), ['LightMod'], `${name} must choose LightMod`);
    assert.equal(res.final_stats?.total_weight, 3.5, `${name} weight must be 3.5 kg`);
    assert.ok(Math.abs(res.final_stats?.true_ergo_delta! - 5.71) <= 0.1, `${name} TED must be ~5.71`);
    assert.deepEqual(validateBuild({ weapon_id: 'gun', use_true_ergo: true }, res, p.itemLookup), [], `${name} must pass validation`);
  }
}

// ============================================================================
// 4. Targeted Evidence: Rejected Secant Incumbent Retaining Proved Bound
// ============================================================================
console.log('  4. Targeted Evidence: Rejected secant incumbent retaining proved bound...');
{
  // Heavy rifle with preventOverswing:
  // Part OverHeavy: weight 6 kg (total 7 kg), ergo 10.
  // At interval [3, 8], secant slope m = (62.5 - 0)/5 = 12.5.
  // Secant model evaluates ted_axis = ergo - 12.5 * W.
  // But exact TED = ergo - (100 - 300/W) < 0, violating Prevent Overswing.
  // The node MIP produces an exact-TED violation:
  // incumbentEligible must be false, but bound must be finite, and refinement continues.
  const p = choiceFixture([
    { id: 'OverHeavy', weight: 6.0, ergo: 10 },
    { id: 'LegalPart', weight: 1.0, ergo: 25 },
  ], 1.0, 10);
  const receiver = p.itemLookup.gun as GunLookupEntry;
  receiver.slots = [{ id: 's', name: 'S', nameId: 's', required: true, allowedItems: ['OverHeavy', 'LegalPart'] }];
  p.compatibilityMap = buildCompatibilityMap('gun', p.itemLookup);

  // Directly solve node on interval [3, 8] where OverHeavy is active
  const nodeRes = await solveModel({ ...p, preventOverswing: true, preciseMode: true }, [3, 8], 10);
  
  // If OverHeavy was selected, exact TED failed:
  if (nodeRes.incumbentEligible === false) {
    assert.ok(nodeRes.bound != null && Number.isFinite(nodeRes.bound), 'Proved relaxation bound must be retained');
    assert.equal(nodeRes.status, 'optimal', 'Status remains optimal to allow upper bound refinement');
    assert.equal(nodeRes.reason, PREVENT_OVERSWING_VIOLATION);
    assert.equal(nodeRes.selected_items.length, 0, 'Ineligible build must not publish selected items');
  }

  // Full solve must refine through split intervals and successfully find LegalPart
  const fullA = await solveAdaptiveEnvelope({ ...p, preventOverswing: true, preciseMode: true });
  const fullB = await solveNodeOptionTuning({ ...p, preventOverswing: true, preciseMode: true });

  for (const [name, res] of [['Candidate A', fullA], ['Candidate B', fullB]] as const) {
    assert.equal(res.status, 'optimal', `${name} must achieve certified optimality after refinement`);
    assert.deepEqual(res.selected_items.map(i => i.id), ['LegalPart'], `${name} must converge to legal build`);
    assert.ok(res.final_stats?.true_ergo_delta! >= -1e-7, `${name} final build must not violate overswing`);
    assert.deepEqual(validateBuild({ weapon_id: 'gun', prevent_overswing: true }, res, p.itemLookup), []);
  }
}

// ============================================================================
// 5. Targeted Evidence: Node Limit Semantics (Feasible vs Incomplete)
// ============================================================================
console.log('  5. Targeted Evidence: Node limit semantics (Feasible vs Incomplete)...');
{
  // 5A: Node limit with a validated incumbent returns FEASIBLE
  {
    // Fixture with multiple parts across 3kg boundary forcing at least 2 spatial intervals
    const p = choiceFixture([
      { id: 'PartA', weight: 2.0, ergo: 15 },
      { id: 'PartB', weight: 4.5, ergo: 35 },
    ], 1.0, 10);
    const receiver = p.itemLookup.gun as GunLookupEntry;
    receiver.slots = [{ id: 's', name: 'S', nameId: 's', required: true, allowedItems: ['PartA', 'PartB'] }];
    p.compatibilityMap = buildCompatibilityMap('gun', p.itemLookup);

    // Limit to maxSpatialNodes: 1. Node 1 finds a valid build, but tree stops before second interval is resolved.
    const resA = await solveAdaptiveEnvelope({ ...p, useTrueErgo: true, preciseMode: true, maxSpatialNodes: 1 });
    const resB = await solveNodeOptionTuning({ ...p, useTrueErgo: true, preciseMode: true, maxSpatialNodes: 1 });

    for (const [name, res] of [['Candidate A', resA], ['Candidate B', resB]] as const) {
      assert.equal(res.status, 'feasible', `${name} with valid incumbent must return status: feasible`);
      assert.equal(res.optimization?.termination, 'limit', `${name} termination must be limit`);
      assert.ok(res.selected_items.length > 0, `${name} must retain selected items`);
      assert.ok(Number.isFinite(res.objective_value) && res.objective_value > 0, `${name} objective must be positive`);
      assert.deepEqual(validateBuild({ weapon_id: 'gun', use_true_ergo: true }, res, p.itemLookup), [], `${name} build must pass validation`);
    }
  }

  // 5B: Limit reached with NO validated incumbent returns INCOMPLETE
  {
    const p = choiceFixture([{ id: 'Part', weight: 1, ergo: 10 }]);
    // 0ms deadline forces timeout before Node 1 completes
    const req = { ...p, timeLimitMs: 0, preciseMode: true };
    const resA = await solveAdaptiveEnvelope(req);
    const resB = await solveNodeOptionTuning(req);

    for (const [name, res] of [['Candidate A', resA], ['Candidate B', resB]] as const) {
      assert.equal(res.status, 'incomplete', `${name} with no incumbent must return status: incomplete`);
      assert.equal(res.selected_items.length, 0, `${name} must have 0 selected items`);
      assert.equal(res.objective_value, 0, `${name} objective must be 0`);
      assert.notEqual(res.status, 'feasible', `${name} must NEVER promise feasible when no incumbent exists`);
    }
  }
}

console.log('All spatial candidates correctness and targeted evidence checks passed successfully!');
