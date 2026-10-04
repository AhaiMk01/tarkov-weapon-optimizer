/**
 * Count-bearing preset quantities (ADR 0013 section 4A, Stage 2 phase 2.2), offline.
 *
 *  - extractAllPresets: counts kept, repeated entries summed, receiver entry carried as `receiver_id`,
 *    absent/null/malformed counts are SourceDataErrors (also on the GraphQL-shaped path).
 *  - The IndexedDB cache version moved, and the GraphQL fallback query asks for `count`.
 *  - presetSupply / mergeComponents: the one place that sums repeated entries and drops non-positive supply.
 *  - LP: a preset supplies q_{b,i} = count (x_i <= sum_b q base_b), q = 1 keeps the legacy row text.
 *  - structuralBounds: preset weight = receiver once + supplied components x copies.
 *  - The copied shopping list shows the supplied quantity.
 *
 * Run: npx tsx test_preset_quantities.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildItemLookup, extractAllPresets, CACHE_VERSION } from './src/solver/dataService.ts';
import { SourceDataError } from './src/solver/sourceErrors.ts';
import { mergeComponents, presetSupply } from './src/solver/presetSupply.ts';
import { buildCompatibilityMap } from './src/solver/compatibilityMap.ts';
import { computeStructuralBounds } from './src/solver/structuralBounds.ts';
import { buildLP } from './src/solver/lpBuilder.ts';
import { solve } from './src/solver/solver.ts';
import { shoppingListLines } from './src/components/common/shoppingList.ts';
import { validateBuild } from './src/solver/validateBuild.ts';
import { choiceFixture } from './test_solver_fixtures.ts';
import type { GunLookupEntry, ModLookupEntry, OfferInfo, PresetInfo } from './src/solver/types.ts';
import type { OptimizeResponse } from './src/api/client.ts';

/* eslint-disable @typescript-eslint/no-explicit-any -- raw API shapes are probed on purpose */

let checks = 0;
const ok = (cond: unknown, message: string) => { checks++; assert.ok(cond, message); };
const eq = <T>(actual: T, expected: T, message: string) => { checks++; assert.deepEqual(actual, expected, message); };

// --------------------------------------------------------------------------------------------
// 1. extractAllPresets
// --------------------------------------------------------------------------------------------

const PRESET_OFFER = [{ priceRUB: 1000, source: 'prapor', vendor: { name: 'Prapor', normalizedName: 'prapor', minTraderLevel: 1 } }];
const rawGun = (containsItems: any[], id = 'gun'): any => ({
  id,
  properties: { presets: [{ id: 'pre', name: 'The Preset', shortName: 'TP', containsItems, buyFor: PRESET_OFFER, bartersFor: [] }] },
});
const entry = (itemId: string, count: unknown): any => ({ item: { id: itemId }, ...(count === undefined ? {} : { count }) });

{
  const [preset] = extractAllPresets(rawGun([entry('gun', 1), entry('a', 2), entry('b', 1), entry('c', 60)]));
  eq(preset.items, [{ itemId: 'a', count: 2 }, { itemId: 'b', count: 1 }, { itemId: 'c', count: 60 }], 'counts above one survive');
  eq(preset.receiver_id, 'gun', 'receiver identity is carried separately');
  ok(!preset.items.some(c => c.itemId === 'gun'), 'the receiver entry is not supplied stock');
}
{
  const [preset] = extractAllPresets(rawGun([entry('a', 1), entry('gun', 1), entry('a', 1), entry('b', 2), entry('a', 3)]));
  eq(preset.items, [{ itemId: 'a', count: 5 }, { itemId: 'b', count: 2 }], 'repeated entries sum, in first-appearance order');
}
{
  const [preset] = extractAllPresets(rawGun([entry('a', 0), entry('b', 1)]));
  eq(preset.items, [{ itemId: 'a', count: 0 }, { itemId: 'b', count: 1 }], 'a zero count is kept faithfully');
  eq([...presetSupply(preset.items)], [['b', 1]], 'but a zero count supplies nothing');
}
{
  const unusable: Array<[string, unknown, RegExp]> = [
    ['absent', undefined, /absent/],
    ['null', null, /null/],
    ['fractional', 1.5, /integer/],
    ['negative', -1, /nonnegative/],
    ['string', '2', /string/],
    ['infinite', Infinity, /finite/],
    ['unsafe', 2 ** 60, /integer/],
    ['NaN', NaN, /integer/],
  ];
  for (const [label, raw, message] of unusable) {
    assert.throws(
      () => extractAllPresets(rawGun([entry('gun', 1), entry('widget', raw)])),
      (error: unknown) => error instanceof SourceDataError
        && error.kind === 'preset_component_count'
        && error.subjectId === 'pre'
        && error.itemId === 'widget'
        && message.test(error.message)
        && error.message.includes('pre')
        && error.message.includes('widget'),
      `${label} count`,
    );
    checks++;
  }
  // The receiver's own entry is validated too: it is dropped from stock, not exempt from the rule.
  assert.throws(() => extractAllPresets(rawGun([entry('gun', undefined)])), SourceDataError);
  checks++;
  // buildItemLookup reaches the same rule for both preset lists.
  assert.throws(() => buildItemLookup([rawGun([entry('a', null)])], []), SourceDataError);
  checks++;
}
{
  const lookup = buildItemLookup([rawGun([entry('a', 2)])], []);
  const gun = lookup.gun as GunLookupEntry;
  eq(gun.presets[0].items, [{ itemId: 'a', count: 2 }], 'purchasable presets are count-bearing');
  eq(gun.all_presets[0].items, [{ itemId: 'a', count: 2 }], 'all presets are count-bearing');
}
{
  // An absent barter ingredient quantity is a source error as well; a fractional one is fine.
  const withBarter = (count: unknown): any => {
    const gun = rawGun([entry('a', 1)]);
    gun.properties.presets[0].buyFor = [];
    gun.properties.presets[0].bartersFor = [{
      trader: { name: 'Mechanic', normalizedName: 'mechanic' }, level: 2,
      requiredItems: [{ item: { id: 'bolt', name: 'Bolt', avg24hPrice: 100, basePrice: 90 }, ...(count === undefined ? {} : { count }) }],
    }];
    return gun;
  };
  assert.throws(
    () => buildItemLookup([withBarter(undefined)], []),
    (error: unknown) => error instanceof SourceDataError && error.kind === 'barter_ingredient_count' && error.subjectId === 'pre' && error.itemId === 'bolt',
  );
  checks++;
  assert.throws(() => buildItemLookup([withBarter(null)], []), SourceDataError);
  checks++;
  const priced = (buildItemLookup([withBarter(2.5)], []) as any).gun.all_presets[0];
  eq(priced.price, 250, 'a fractional ingredient quantity prices as count x unit price');
}

// --------------------------------------------------------------------------------------------
// 2. Cache version and GraphQL fallback query
// --------------------------------------------------------------------------------------------

ok(CACHE_VERSION > 15, `cache version must move past the default-filled payloads (got ${CACHE_VERSION})`);
{
  const source = readFileSync(new URL('./src/solver/dataService.ts', import.meta.url), 'utf8');
  ok(/containsItems\s*\{\s*item\s*\{\s*id\s*\}\s*count\s*\}/.test(source), 'the GraphQL fallback query asks for containsItems { item { id } count }');
  ok(!/count\s*\?\?\s*1/.test(source), 'no `count ?? 1` default remains in dataService');
  const adapter = readFileSync(new URL('./src/solver/jsonApiAdapter.ts', import.meta.url), 'utf8');
  ok(!/count\s*\?\?\s*1/.test(adapter), 'no `count ?? 1` default remains in the adapter');
}

// --------------------------------------------------------------------------------------------
// 3. presetSupply / mergeComponents
// --------------------------------------------------------------------------------------------

eq([...presetSupply([{ itemId: 'a', count: 1 }, { itemId: 'b', count: 0 }, { itemId: 'a', count: 2 }])], [['a', 3]], 'presetSupply sums repeats and drops zero supply');
eq([...presetSupply(undefined)], [], 'presetSupply of nothing is empty');
eq(mergeComponents([{ itemId: 'a', count: 1 }, { itemId: 'b', count: 0 }, { itemId: 'a', count: 2 }]), [{ itemId: 'a', count: 3 }, { itemId: 'b', count: 0 }], 'mergeComponents keeps zero entries');

// --------------------------------------------------------------------------------------------
// 4. LP supply rows
// --------------------------------------------------------------------------------------------

const MECHANIC: OfferInfo[] = [{ price: 500, source: 'mechanic', vendor_name: 'Mechanic', vendor_normalized: 'mechanic', trader_level: 1 }];
/** A gun with one required slot choosing P1 (which has no standalone offer) and a preset supplying it. */
function presetFixture(items: PresetInfo['items']) {
  const p = choiceFixture([{ id: 'P1', weight: 2, ergo: 10, price: 300 }]);
  const mod = p.itemLookup.P1 as ModLookupEntry;
  mod.stats.offers = [];
  mod.stats.price = 0;
  const preset: PresetInfo = {
    id: 'bundle', name: 'Bundle', receiver_id: 'gun', items, image: null,
    price: 500, price_source: 'mechanic', offers: MECHANIC, purchasable: true,
  };
  const gun = p.itemLookup.gun as GunLookupEntry;
  gun.presets = [preset];
  gun.all_presets = [preset];
  p.compatibilityMap = buildCompatibilityMap('gun', p.itemLookup);
  return p;
}
const rowsOf = (lp: string, prefix: string) => lp.split('\n').filter(line => line.trim().startsWith(prefix));

{
  const single = buildLP(presetFixture([{ itemId: 'P1', count: 1 }])).lpString;
  eq(rowsOf(single, 'avail_').map(r => r.trim()), ['avail_1: x_1 - base_2 <= 0'], 'q = 1 keeps the legacy availability row');
  eq(rowsOf(single, 'buy_ge_').map(r => r.trim()), ['buy_ge_1: buy_1 - x_1 + base_2 >= 0'], 'q = 1 keeps the legacy purchase row');

  const pair = buildLP(presetFixture([{ itemId: 'P1', count: 2 }])).lpString;
  eq(rowsOf(pair, 'avail_').map(r => r.trim()), ['avail_1: x_1 - 2 base_2 <= 0'], 'the availability row reads q_{b,i} = 2');
  eq(rowsOf(pair, 'buy_ge_').map(r => r.trim()), ['buy_ge_1: buy_1 - x_1 + 2 base_2 >= 0'], 'the purchase row reads q_{b,i} = 2');

  const repeated = buildLP(presetFixture([{ itemId: 'P1', count: 1 }, { itemId: 'P1', count: 2 }])).lpString;
  eq(rowsOf(repeated, 'avail_').map(r => r.trim()), ['avail_1: x_1 - 3 base_2 <= 0'], 'repeated entries sum into one supply');

  // Without a supply the part has no purchase path at all, so it never enters the model.
  const zero = buildLP(presetFixture([{ itemId: 'P1', count: 0 }]));
  ok(!zero.indexToItem.includes('P1'), 'a zero count supplies nothing: the part has no source and is not modelled');
  ok(rowsOf(zero.lpString, 'buy_le_nb_').length === 0, 'and no preset-membership row exists for it');
  const emptyPreset = buildLP(presetFixture([]));
  ok(!emptyPreset.indexToItem.includes('P1'), 'an empty preset supplies nothing');
}
{
  // End to end: a preset that supplies two copies still retains the one installed copy at 0 RUB.
  const p = presetFixture([{ itemId: 'P1', count: 2 }]);
  const res = await solve({ ...p, ergoWeight: 0, priceWeight: 100, recoilWeight: 0, preciseMode: true });
  eq(res.status, 'optimal', 'solved');
  eq(res.selected_preset?.id, 'bundle', 'the preset is the base');
  eq(res.selected_preset?.items, [{ itemId: 'P1', count: 2 }], 'the response carries the supplied quantity');
  eq(res.selected_preset?.receiver_id, 'gun', 'and the receiver identity');
  eq(res.final_stats?.total_price, 500, 'the supplied part costs nothing extra');
  eq(validateBuild({ weapon_id: 'gun' }, res, p.itemLookup), [], 'the validator accepts the count-bearing contents');
  const reported = { ...res, selected_preset: { ...res.selected_preset!, items: [{ itemId: 'P1', count: 1 }] } };
  ok(validateBuild({ weapon_id: 'gun' }, reported, p.itemLookup).includes('Preset contents mismatch'), 'a misreported count is a contents mismatch');
  const none = presetFixture([{ itemId: 'P1', count: 0 }]);
  const res0 = await solve({ ...none, ergoWeight: 0, priceWeight: 100, recoilWeight: 0, preciseMode: true });
  ok(!res0.selected_items.some(item => item.id === 'P1'), 'a zero-count preset never supplies the part');
}

// --------------------------------------------------------------------------------------------
// 5. structuralBounds preset weight
// --------------------------------------------------------------------------------------------

{
  // Receiver 1 kg; the only mod weighs 5 kg (P1: build weight 6 => part weight 5).
  const base = choiceFixture([{ id: 'P1', weight: 6, ergo: 10 }], 1);
  const gun = base.itemLookup.gun as GunLookupEntry;
  const withPreset = (items: PresetInfo['items']) => {
    gun.presets = [{ id: 'bundle', name: 'Bundle', receiver_id: 'gun', items, image: null, price: 500, price_source: 'mechanic', offers: MECHANIC, purchasable: true }];
    return computeStructuralBounds('gun', base.itemLookup, base.compatibilityMap).weightBounds;
  };
  eq(withPreset([]), [6, 6], 'no preset stock: the DAG alone decides (receiver 1 + part 5)');
  eq(withPreset([{ itemId: 'P1', count: 1 }]), [6, 6], 'one supplied copy weighs 5 kg on top of one receiver, not two');
  eq(withPreset([{ itemId: 'P1', count: 3 }]), [6, 16], 'three supplied copies weigh 15 kg: receiver 1 + 3 x 5');
  eq(withPreset([{ itemId: 'P1', count: 1 }, { itemId: 'P1', count: 2 }]), [6, 16], 'repeated entries sum');
  eq(withPreset([{ itemId: 'P1', count: 0 }]), [6, 6], 'a zero count adds no weight');
}

// --------------------------------------------------------------------------------------------
// 6. Copied shopping list
// --------------------------------------------------------------------------------------------

{
  const item = (id: string, name: string) => ({ id, name, price: 0, ergonomics: 0, recoil_modifier: 0 });
  const result: Pick<OptimizeResponse, 'selected_items' | 'selected_preset'> = {
    selected_items: [item('a', 'Rail'), item('b', 'Grip'), item('c', 'Stock')],
    selected_preset: { id: 'pre', name: 'Preset', price: 1, receiver_id: 'gun', items: [{ itemId: 'a', count: 2 }, { itemId: 'b', count: 1 }] },
  };
  eq(shoppingListLines(result), ['Rail ×2', 'Grip', 'Stock'], 'a part the preset supplies twice carries x2; single copies and bought parts are plain names');
  eq(shoppingListLines({ selected_items: result.selected_items }), ['Rail', 'Grip', 'Stock'], 'no preset, no quantities');
}

console.log(`Preset quantity checks passed (${checks} assertions)`);
