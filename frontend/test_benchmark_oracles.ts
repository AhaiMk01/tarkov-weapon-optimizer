import assert from 'node:assert/strict';
import { solve } from './src/solver/solver.ts';
import { buildCompatibilityMap } from './src/solver/compatibilityMap.ts';
import { choiceFixture } from './test_solver_fixtures.ts';
import { validateBuild } from './benchmarks/validateBuild.ts';
import type { ItemLookup, ModLookupEntry, SlotInfo } from './src/solver/types.ts';

console.log('Running benchmark oracle correctness checks...');

// 1. Interchangeable two-slot A + B counterexample:
// Fast mode restricts both slots with sum(x_i) <= 1, missing A+B.
// Precise mode allows exact placement [left->B, right->A].
{
  const p = choiceFixture([{ id: 'A', weight: 1.1, ergo: 10 }, { id: 'B', weight: 1.1, ergo: 20 }]);
  p.itemLookup.gun.slots = ['left', 'right'].map(id => ({
    id, name: id, nameId: id, required: false, allowedItems: ['A', 'B'],
  }));
  p.compatibilityMap = buildCompatibilityMap('gun', p.itemLookup);

  const resPrecise = await solve({ ...p, preciseMode: true });
  assert.equal(resPrecise.status, 'optimal');
  assert.deepEqual(resPrecise.selected_items.map(i => i.id).sort(), ['A', 'B']);
  assert.equal(resPrecise.final_stats?.ergonomics, 30);
  assert.deepEqual(validateBuild({ weapon_id: 'gun' }, resPrecise, p.itemLookup), []);

  const resFast = await solve({ ...p, preciseMode: false });
  assert.equal(resFast.status, 'optimal');
  assert.deepEqual(resFast.selected_items.map(i => i.id), ['B']);
  assert.equal(resFast.final_stats?.ergonomics, 20);
  // Proof that Fast mode cannot validly upper-bound the exact optimum:
  assert.ok(resFast.objective_value < resPrecise.objective_value, 'Fast mode optimum must not upper-bound exact optimum');
}

// 2. Required slot must be filled; empty required slot is infeasible
{
  const p = choiceFixture([{ id: 'ReqPart', weight: 1, ergo: 15 }]);
  p.itemLookup.gun.slots = [{ id: 'must_have', name: 'Must Have', nameId: 'must_have', required: true, allowedItems: ['ReqPart'] }];
  p.compatibilityMap = buildCompatibilityMap('gun', p.itemLookup);

  const res = await solve({ ...p, preciseMode: true });
  assert.equal(res.status, 'optimal');
  assert.deepEqual(res.selected_items.map(i => i.id), ['ReqPart']);
  assert.deepEqual(validateBuild({ weapon_id: 'gun' }, res, p.itemLookup), []);
}

// 3. Alternative parents: Child can connect through ParentA or ParentB in the same parent slot
{
  const base = choiceFixture([]);
  const lookup: ItemLookup = { ...base.itemLookup };

  // Gun has one mount slot allowing either ParentA or ParentB
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
      offers: [{ price: 100, source: 'mechanic', vendor_name: 'Mechanic', vendor_normalized: 'mechanic', trader_level: 1 }],
      purchasable: true,
      price: 100,
      price_source: 'mechanic',
      weight: 0.5,
      width: 1,
      height: 1,
      min_level_flea: 1,
      capacity: 0,
      sighting_range: 0,
      category: 'fixture',
      category_id: 'fixture',
    },
  });

  lookup.ParentA = makeMod('ParentA', 5, [{ id: 'child_slot_a', name: 'CS_A', nameId: 'cs_a', required: false, allowedItems: ['Sight'] }]);
  lookup.ParentB = makeMod('ParentB', 20, [{ id: 'child_slot_b', name: 'CS_B', nameId: 'cs_b', required: false, allowedItems: ['Sight'] }]);
  lookup.Sight = makeMod('Sight', 10);

  const cmap = buildCompatibilityMap('gun', lookup);
  const res = await solve({
    weaponId: 'gun',
    itemLookup: lookup,
    compatibilityMap: cmap,
    ergoWeight: 100,
    recoilWeight: 0,
    priceWeight: 0,
    fleaAvailable: true,
    preciseMode: true,
  });

  assert.equal(res.status, 'optimal');
  // Should select ParentB (ergo 20) + Sight (ergo 10) = total 30 ergo
  assert.deepEqual(res.selected_items.map(i => i.id).sort(), ['ParentB', 'Sight']);
  assert.deepEqual(validateBuild({ weapon_id: 'gun' }, res, lookup), []);
}

// 4. Conflicts: Part A conflicts with Part B
{
  const p = choiceFixture([
    { id: 'Opt1', weight: 1, ergo: 25 },
    { id: 'Opt2', weight: 1, ergo: 20 },
  ]);
  // Add direct conflict between Opt1 and Opt2
  const m1 = p.itemLookup.Opt1 as ModLookupEntry;
  m1.conflicting_items = ['Opt2'];

  p.itemLookup.gun.slots = [
    { id: 's1', name: 'S1', nameId: 's1', required: false, allowedItems: ['Opt1', 'Opt2'] },
    { id: 's2', name: 'S2', nameId: 's2', required: false, allowedItems: ['Opt1', 'Opt2'] },
  ];
  p.compatibilityMap = buildCompatibilityMap('gun', p.itemLookup);

  const res = await solve({ ...p, preciseMode: true });
  assert.equal(res.status, 'optimal');
  // Cannot select both despite two open slots; should pick Opt1 (ergo 25)
  assert.deepEqual(res.selected_items.map(i => i.id), ['Opt1']);
  assert.deepEqual(validateBuild({ weapon_id: 'gun' }, res, p.itemLookup), []);
}

// 5. 3 kg TED boundary: below or equal to 3 kg, weight penalty is zero
{
  const p = choiceFixture([
    { id: 'Light', weight: 3, ergo: 40 },
  ]);
  const res = await solve({ ...p, useTrueErgo: true, preciseMode: true });
  assert.equal(res.status, 'optimal');
  // Choice weight 3 kg -> total weight 3 kg -> weightPenalty = 0 -> TED = Ergo = 40
  assert.equal(res.final_stats?.total_weight, 3);
  assert.equal(res.final_stats?.true_ergo_delta, 40);
  assert.equal(res.final_stats?.overswing_pct, 0);
  assert.deepEqual(validateBuild({ weapon_id: 'gun', use_true_ergo: true }, res, p.itemLookup), []);
}
// 6. Clamped ergonomics: ergo clamped to [0, 100]
{
  const pOver = choiceFixture([{ id: 'Over', weight: 1, ergo: 120 }]);
  const resOver = await solve({ ...pOver, preciseMode: true });
  assert.equal(resOver.status, 'optimal');
  assert.equal(resOver.final_stats?.ergonomics, 100);
  assert.deepEqual(validateBuild({ weapon_id: 'gun' }, resOver, pOver.itemLookup), []);

  const pUnder = choiceFixture([{ id: 'Under', weight: 1, ergo: -20 }]);
  const resUnder = await solve({ ...pUnder, preciseMode: true });
  assert.equal(resUnder.status, 'optimal');
  assert.equal(resUnder.final_stats?.ergonomics, 0);
  assert.deepEqual(validateBuild({ weapon_id: 'gun' }, resUnder, pUnder.itemLookup), []);
}

// 7. Retained preset parts: preset includes P1; selecting preset means P1 has ₽0 buy cost
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

  // Optimizing for lowest price with ergoWeight=0, priceWeight=100
  const res = await solve({
    ...p,
    ergoWeight: 0,
    priceWeight: 100,
    recoilWeight: 0,
    preciseMode: true,
  });
  assert.equal(res.status, 'optimal');
  // Preset costs ₽500, naked receiver costs ₽1000 + P1 ₽300 = ₽1300.
  // Solver should select preset_bundle with base price ₽500 and P1 retained at ₽0.
  assert.equal(res.selected_preset?.id, 'preset_bundle');
  assert.equal(res.final_stats?.total_price, 500);
  assert.deepEqual(validateBuild({ weapon_id: 'gun' }, res, p.itemLookup), []);
}

console.log('All benchmark oracle checks passed successfully.');
