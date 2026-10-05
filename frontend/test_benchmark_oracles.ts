import assert from 'node:assert/strict';
import { solve } from './src/solver/solver.ts';
import { buildCompatibilityMap } from './src/solver/compatibilityMap.ts';
import { choiceFixture, physicalViolations } from './test_solver_fixtures.ts';
import { validateBuild } from './benchmarks/validateBuild.ts';
import type { ItemLookup, ModLookupEntry, SlotInfo } from './src/solver/types.ts';

console.log('Running benchmark oracle correctness checks...');

// 1. Interchangeable two-slot A + B counterexample:
// The legacy single-copy template model restricted both slots with sum(x_i) <= 1 and missed A+B. The Fast model counts copies per template and per
// slot edge (Phase 2.4c), so it finds A+B as well; Precise places [left->B, right->A] exactly.
// Each part lists itself as conflicting, which caps it at one installed copy (ADR 0003): the exact model installs as many copies of a part
// as it has slots for, so without the cap it would fill both slots with B (two copies, see 1b) and this fixture would not separate the models.
{
  const p = choiceFixture([{ id: 'A', weight: 1.1, ergo: 10 }, { id: 'B', weight: 1.1, ergo: 20 }]);
  (p.itemLookup.A as ModLookupEntry).conflicting_items = ['A'];
  (p.itemLookup.B as ModLookupEntry).conflicting_items = ['B'];
  p.itemLookup.gun.slots = ['left', 'right'].map(id => ({
    id, name: id, nameId: id, required: false, allowedItems: ['A', 'B'],
  }));
  p.compatibilityMap = buildCompatibilityMap('gun', p.itemLookup);

  const resPrecise = await solve({ ...p, preciseMode: true });
  assert.equal(resPrecise.status, 'optimal');
  assert.deepEqual(resPrecise.selected_items.map(i => i.id).sort(), ['A', 'B']);
  assert.equal(resPrecise.final_stats?.ergonomics, 30);
  // The template-level validateBuild reads a self-conflict as a conflict of the part with itself; the occurrence-level one reads the copy cap.
  assert.deepEqual(physicalViolations(p, resPrecise), []);

  const resFast = await solve({ ...p, preciseMode: false });
  assert.equal(resFast.status, 'optimal');
  assert.deepEqual(resFast.selected_items.map(i => i.id).sort(), ['A', 'B']);
  assert.equal(resFast.final_stats?.ergonomics, 30);
  assert.deepEqual(physicalViolations(p, resFast), []);
  assert.ok(Math.abs(resFast.objective_value - resPrecise.objective_value) < 1e-9, 'on this acyclic graph the Fast optimum is the exact optimum');
}

// 1b. No copy cap: the exact model installs two copies of the better part, one per slot, as distinct occurrences. So does the Fast model now:
// the single-copy assumption of the template model is gone.
{
  const p = choiceFixture([{ id: 'A', weight: 1.1, ergo: 10 }, { id: 'B', weight: 1.1, ergo: 20 }]);
  p.itemLookup.gun.slots = ['left', 'right'].map(id => ({
    id, name: id, nameId: id, required: false, allowedItems: ['A', 'B'],
  }));
  p.compatibilityMap = buildCompatibilityMap('gun', p.itemLookup);
  const res = await solve({ ...p, preciseMode: true });
  assert.equal(res.status, 'optimal');
  assert.deepEqual(res.selected_items.map(i => i.id), ['B', 'B']);
  assert.equal(new Set(res.selected_items.map(i => i.instanceId)).size, 2, 'two copies are two instances');
  assert.deepEqual(res.selected_item_ids, ['B', 'B']);
  assert.equal(res.final_stats?.ergonomics, 40);
  const fast = await solve({ ...p, preciseMode: false });
  assert.deepEqual(fast.selected_items.map(i => i.id), ['B', 'B']);
  assert.equal(new Set(fast.selected_items.map(i => i.instanceId)).size, 2, 'two copies are two instances');
  assert.equal(fast.final_stats?.ergonomics, 40);
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
  // Add direct conflict between Opt1 and Opt2. Each part also lists itself, capping it at one copy (the exact model fills every open slot
  // with copies of the best allowed part otherwise, which is not what this fixture is about).
  const m1 = p.itemLookup.Opt1 as ModLookupEntry;
  m1.conflicting_items = ['Opt2', 'Opt1'];
  (p.itemLookup.Opt2 as ModLookupEntry).conflicting_items = ['Opt2'];

  p.itemLookup.gun.slots = [
    { id: 's1', name: 'S1', nameId: 's1', required: false, allowedItems: ['Opt1', 'Opt2'] },
    { id: 's2', name: 'S2', nameId: 's2', required: false, allowedItems: ['Opt1', 'Opt2'] },
  ];
  p.compatibilityMap = buildCompatibilityMap('gun', p.itemLookup);

  const res = await solve({ ...p, preciseMode: true });
  assert.equal(res.status, 'optimal');
  // Cannot select both despite two open slots; should pick Opt1 (ergo 25)
  assert.deepEqual(res.selected_items.map(i => i.id), ['Opt1']);
  assert.deepEqual(physicalViolations(p, res), []);
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
    receiver_id: 'gun',
    items: [{ itemId: 'P1', count: 1 }],
    image: null,
    offers: [{ price: 500, source: 'mechanic', vendor_name: 'Mechanic', vendor_normalized: 'mechanic', trader_level: 1 }],
  }];
  p.itemLookup.gun.all_presets = p.itemLookup.gun.presets; // the physical model reads the full preset list
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

// 8. A preset that supplies two copies of its part. The model installs one copy, so the part is still retained
// at 0 RUB, and the response carries the count-bearing contents that the validator checks.
{
  const p = choiceFixture([{ id: 'P1', weight: 1, ergo: 10, price: 300 }]);
  p.itemLookup.gun.presets = [{
    id: 'preset_pair',
    name: 'Pair Preset',
    price: 500,
    price_source: 'mechanic',
    purchasable: true,
    receiver_id: 'gun',
    items: [{ itemId: 'P1', count: 2 }],
    image: null,
    offers: [{ price: 500, source: 'mechanic', vendor_name: 'Mechanic', vendor_normalized: 'mechanic', trader_level: 1 }],
  }];
  p.itemLookup.gun.all_presets = p.itemLookup.gun.presets; // the physical model reads the full preset list
  p.compatibilityMap = buildCompatibilityMap('gun', p.itemLookup);
  const res = await solve({ ...p, ergoWeight: 0, priceWeight: 100, recoilWeight: 0, preciseMode: true });
  assert.equal(res.status, 'optimal');
  assert.equal(res.selected_preset?.id, 'preset_pair');
  assert.deepEqual(res.selected_preset?.items, [{ itemId: 'P1', count: 2 }]);
  assert.equal(res.selected_preset?.receiver_id, 'gun');
  assert.equal(res.final_stats?.total_price, 500);
  assert.deepEqual(validateBuild({ weapon_id: 'gun' }, res, p.itemLookup), []);
  // A response that misreports the supplied count is a contents mismatch.
  const misreported = { ...res, selected_preset: { ...res.selected_preset!, items: [{ itemId: 'P1', count: 1 }] } };
  assert.ok(validateBuild({ weapon_id: 'gun' }, misreported, p.itemLookup).includes('Preset contents mismatch'));
}

console.log('All benchmark oracle checks passed successfully.');
