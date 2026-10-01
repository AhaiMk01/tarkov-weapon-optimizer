import assert from 'node:assert/strict';
import { solve } from './src/solver/solver';
import { choiceFixture } from './test_solver_fixtures';
import { buildCompatibilityMap } from './src/solver/compatibilityMap';
import { validateBuild } from './benchmarks/validateBuild';
import { weightPenalty } from './src/solver/trueErgo';
import {
  splitAdaptiveInterval,
  solveAdaptiveEnvelope,
} from './benchmarks/experiments/adaptiveEnvelope';
import { solveNodeOptionTuning } from './benchmarks/experiments/nodeOptionTuning';
import type { ItemLookup, ModLookupEntry, SlotInfo } from './src/solver/types';

console.log('Running spatial candidates correctness and small-graph verification...');

// ============================================================================
// 1. Mathematical Proof & Properties of Geometric-Mean Split W* = sqrt(a * b)
// ============================================================================
{
  console.log('  1. Verifying mathematical properties of adaptive envelope split...');
  
  // Test intervals [a, b] for a >= 3
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
    
    // Invariant 1: Strictly interior split a < W* < b
    assert.ok(split > a, `Split point ${split} must be > a (${a})`);
    assert.ok(split < b, `Split point ${split} must be < b (${b})`);
    assert.equal(left[0], a);
    assert.equal(right[1], b);
    assert.equal(left[1], right[0]);
    assert.equal(split, Math.sqrt(a * b));

    // Invariant 2: Secant slope and error function
    const m = (weightPenalty(b) - weightPenalty(a)) / (b - a);
    const c = weightPenalty(a) - m * a;
    const s = (w: number) => m * w + c;
    const E = (w: number) => weightPenalty(w) - s(w);

    // Endpoint equality: E(a) = 0, E(b) = 0
    assert.ok(Math.abs(E(a)) < 1e-10, `E(a) must be 0, got ${E(a)}`);
    assert.ok(Math.abs(E(b)) < 1e-10, `E(b) must be 0, got ${E(b)}`);

    // Concavity: E(W) >= 0 for all W in [a, b]
    const steps = 100;
    for (let i = 1; i < steps; i++) {
      const w = a + (b - a) * (i / steps);
      assert.ok(E(w) >= -1e-12, `E(W) must be >= 0 inside [${a}, ${b}], got E(${w}) = ${E(w)}`);
    }

    // Maximum error occurs at W* = sqrt(a * b)
    const eMax = E(split);
    for (let i = 0; i <= steps; i++) {
      const w = a + (b - a) * (i / steps);
      assert.ok(E(w) <= eMax + 1e-10, `E(${w}) = ${E(w)} must be <= E(W*) = ${eMax}`);
    }
  }

  // Invariant 3: Bound is NOT guaranteed outside its interval
  // Counterexample on [4, 6]: at W = 1, secant s(1) = 12.5(1) - 25 = -12.5 < q(1) = 0
  {
    const a = 4.0, b = 6.0;
    const m = (weightPenalty(b) - weightPenalty(a)) / (b - a); // (50 - 25)/2 = 12.5
    const c = weightPenalty(a) - m * a; // 25 - 50 = -25
    const s = (w: number) => m * w + c;
    assert.equal(m, 12.5);
    assert.equal(c, -25);
    assert.equal(s(1), -12.5);
    assert.equal(weightPenalty(1), 0);
    // At W=1, s(1) < q(1), proving s does NOT universally exceed q outside [a, b]
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
      zoom: [null, null],
    },
    offers: [{ price: 100, source: 'mechanic', vendor_name: 'Mechanic', vendor_normalized: 'mechanic', trader_level: 1 }],
    purchasable: true,
  });
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
  p.itemLookup.gun.presets = [{
    id: 'preset_bundle',
    name: 'Bundle Preset',
    price: 500,
    price_source: 'mechanic',
    purchasable: true,
    items: ['P1'],
    offers: [{ price: 500, source: 'mechanic', vendor_name: 'Mechanic', vendor_normalized: 'mechanic', trader_level: 1 }],
  }];
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
  // Receiver weight 2 kg (naked_ergo = 50).
  // Slot allows either:
  // - Part Light: weight 1.5 kg (total W = 3.5 kg, penalty = 100 - 300/3.5 = 14.29, ergo +20 -> raw 70 -> TED = 55.71)
  // - Part Heavy: weight 3.0 kg (total W = 5.0 kg, penalty = 100 - 300/5.0 = 40.00, ergo +40 -> raw 90 -> TED = 50.00)
  // Light gives TED 55.71 > Heavy TED 50.00, so TED optimization MUST select Light!
  const p = choiceFixture([
    { id: 'LightMod', weight: 3.5, ergo: 20 },
    { id: 'HeavyMod', weight: 5.0, ergo: 40 },
  ], 2.0, 50);
  const receiver = p.itemLookup.gun as any;
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
// 4. Honest Incomplete Status Behavior
// ============================================================================
console.log('  4. Verifying honest incomplete status on deadline limit...');
{
  const p = choiceFixture([{ id: 'Part', weight: 1, ergo: 10 }]);
  // Impose 0ms deadline to force immediate limit before solving
  const req = { ...p, timeLimitMs: 0, preciseMode: true };
  const resA = await solveAdaptiveEnvelope(req);
  const resB = await solveNodeOptionTuning(req);

  for (const [name, res] of [['Candidate A', resA], ['Candidate B', resB]] as const) {
    assert.equal(res.status, 'incomplete', `${name} must be incomplete on 0ms deadline`);
    assert.equal(res.selected_items.length, 0, `${name} must have 0 selected items`);
    assert.equal(res.objective_value, 0, `${name} objective must be 0`);
    assert.ok(res.reason?.includes('time limit') || res.reason?.includes('Time limit'), `${name} reason must mention time limit`);
  }
}

console.log('All spatial candidates correctness tests passed successfully!');
