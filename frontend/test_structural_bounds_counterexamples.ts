import assert from 'node:assert/strict';
import { choiceFixture } from './test_solver_fixtures.ts';
import { buildCompatibilityMap } from './src/solver/compatibilityMap.ts';
import { computeStructuralBounds } from './src/solver/structuralBounds.ts';
import type { ItemLookup, ModLookupEntry, SlotInfo } from './src/solver/types.ts';

console.log('Running counterexample regression tests for Issue #22...');

// Counterexample 1: Negative optional weights
// Receiver 1kg, optional -0.5kg part -> valid build is 0.5kg.
// Bounds must enclose 0.5kg (minWeight <= 0.5kg).
{
  const base = choiceFixture([]);
  const lookup: ItemLookup = { ...base.itemLookup };
  lookup.gun.slots = [
    { id: 'opt_slot', name: 'Opt', nameId: 'opt', required: false, allowedItems: ['NegPart'] },
  ];
  const makeMod = (id: string, weight: number): ModLookupEntry => ({
    type: 'mod',
    data: { name: id },
    slots: [],
    conflicting_items: [],
    conflicting_slot_ids: [],
    stats: {
      ergonomics: 0,
      recoil_modifier: 0,
      accuracy_modifier: 0,
      center_of_impact: 0,
      offers: [{ price: 100, source: 'mechanic', vendor_name: 'Mechanic', vendor_normalized: 'mechanic', trader_level: 1 }],
      purchasable: true,
      price: 100,
      price_source: 'mechanic',
      weight,
      width: 1,
      height: 1,
      min_level_flea: 1,
      capacity: 0,
      sighting_range: 0,
      category: 'fixture',
      category_id: 'fixture',
    },
  });
  lookup.NegPart = makeMod('NegPart', -0.5);
  const cmap = buildCompatibilityMap('gun', lookup);

  const bounds = computeStructuralBounds('gun', lookup, cmap);
  console.log('Counterexample 1 bounds:', bounds.weightBounds);
  assert.ok(bounds.weightBounds[0] <= 0.5 + 1e-6, `minWeight must be <= 0.5kg, got ${bounds.weightBounds[0]}`);
  assert.ok(bounds.weightBounds[1] >= 1.0 - 1e-6, `maxWeight must be >= 1.0kg, got ${bounds.weightBounds[1]}`);
}

// Counterexample 2: Cyclic graph traversal order independence
// Weapon chooses A or B
// A chooses B or C
// B accepts A
// Weights: weapon=1, A=1, B=1, C=10 kg
// Valid placement: weapon -> B -> A -> C = 13 kg
{
  const makeModWithSlots = (id: string, weight: number, slots: SlotInfo[]): ModLookupEntry => ({
    type: 'mod',
    data: { name: id },
    slots,
    conflicting_items: [],
    conflicting_slot_ids: [],
    stats: {
      ergonomics: 0,
      recoil_modifier: 0,
      accuracy_modifier: 0,
      center_of_impact: 0,
      offers: [{ price: 100, source: 'mechanic', vendor_name: 'Mechanic', vendor_normalized: 'mechanic', trader_level: 1 }],
      purchasable: true,
      price: 100,
      price_source: 'mechanic',
      weight,
      width: 1,
      height: 1,
      min_level_flea: 1,
      capacity: 0,
      sighting_range: 0,
      category: 'fixture',
      category_id: 'fixture',
    },
  });

  // Test both orders of root slots: [A, B] and [B, A]
  for (const rootOrder of [['A', 'B'], ['B', 'A']]) {
    const base = choiceFixture([]);
    const lookup: ItemLookup = { ...base.itemLookup };

    lookup.gun.slots = [
      { id: 'root_slot', name: 'Root', nameId: 'root', required: false, allowedItems: rootOrder },
    ];
    lookup.A = makeModWithSlots('A', 1, [
      { id: 'a_slot', name: 'ASlot', nameId: 'aslot', required: false, allowedItems: ['B', 'C'] },
    ]);
    lookup.B = makeModWithSlots('B', 1, [
      { id: 'b_slot', name: 'BSlot', nameId: 'bslot', required: false, allowedItems: ['A'] },
    ]);
    lookup.C = makeModWithSlots('C', 10, []);

    const cmap = buildCompatibilityMap('gun', lookup);
    const bounds = computeStructuralBounds('gun', lookup, cmap);
    console.log(`Counterexample 2 rootOrder [${rootOrder.join(',')}]: maxWeight = ${bounds.weightBounds[1]}`);
    assert.equal(bounds.weightBounds[1], 13, `maxWeight must be 13kg regardless of order, got ${bounds.weightBounds[1]}`);
  }
}

// Counterexample 3: Receiver naked_ergonomics included
// Receiver with 40 naked_ergonomics and required +5 attachment -> total ergonomics 45.
{
  const base = choiceFixture([]);
  const lookup: ItemLookup = { ...base.itemLookup };
  lookup.gun.stats.naked_ergonomics = 40;
  lookup.gun.slots = [
    { id: 'req_slot', name: 'Req', nameId: 'req', required: true, allowedItems: ['Part5'] },
  ];
  const makeMod = (id: string, ergo: number): ModLookupEntry => ({
    type: 'mod',
    data: { name: id },
    slots: [],
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
      weight: 0.1,
      width: 1,
      height: 1,
      min_level_flea: 1,
      capacity: 0,
      sighting_range: 0,
      category: 'fixture',
      category_id: 'fixture',
    },
  });
  lookup.Part5 = makeMod('Part5', 5);
  const cmap = buildCompatibilityMap('gun', lookup);

  const bounds = computeStructuralBounds('gun', lookup, cmap);
  console.log('Counterexample 3 ergoBounds:', bounds.ergoBounds);
  assert.equal(bounds.ergoBounds[0], 45, `minErgo must be 45 (40 naked + 5 part), got ${bounds.ergoBounds[0]}`);
  assert.equal(bounds.ergoBounds[1], 45, `maxErgo must be 45 (40 naked + 5 part), got ${bounds.ergoBounds[1]}`);
}

console.log('All counterexample tests passed.');
