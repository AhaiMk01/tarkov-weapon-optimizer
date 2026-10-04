// Differential: production dataService extractors (via buildItemLookup) vs the independent
// reference reader, on the production adapter's output for the pinned raw documents.
//
//  * Preset quantities (ADR 0013 section 4A, repaired in Stage 2 phase 2.2): `extractAllPresets` returns
//    count-bearing components `{ itemId, count }` (repeated entries summed) and carries the receiver's
//    own `containsItems` entry as `receiver_id`, base identity kept apart from component supply. Before
//    the repair it pushed one item id per entry and ignored `count`, so a preset holding 3 copies of a
//    part read as 1 (56 (preset, item) quantities wrong in 52 of 399 presets).
//  * Barter valuation: production sums in binary64 and uses Math.round; the reference evaluates
//    avg24hPrice ?? basePrice ?? 0 exactly over Q and rounds floor(total + 1/2) (ADR 0010 section 2).
//
// One of the few files allowed to import production code, strictly as the system under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllDataFromJsonApi } from '../../src/solver/jsonApiAdapter';
import { loadPinnedWorld } from './pinnedWorld';
import { withPinnedFetch } from './pinnedFetchStub';
import { indexBartersByOfferedItem } from './rawReader';
import type { RefItem } from './rawReader';
import { referenceBarterOffer } from './referenceRules';
import { expandComponents, gunPresetMultiplicities } from './sourceChecks';

// dataService.ts cannot be statically imported here: tsconfig.reference.json has no DOM lib, and
// dataService references IndexedDB and typed-Response APIs, which would break `tsc -b` for the
// whole reference project. A non-literal specifier keeps tsc from following the import while the
// runtime still loads the real module. The slice of its surface that is used is declared below.
const DATA_SERVICE = '../../src/solver/dataService.ts';

interface ProductionOffer {
  price: number;
  source: string;
  trader_level: number | null;
  barter_requirements?: Array<{ name: string; count: number; unit_price: number }>;
  /** Barters only: the units one barter delivers (`offeredItem.count`). */
  lot_size?: number;
}
interface ProductionPreset {
  id: string;
  name: string;
  /** The receiver the preset is built on: base identity, not component supply. */
  receiver_id: string;
  /** Count-bearing component supply, one entry per distinct item; excludes the receiver. */
  items: Array<{ itemId: string; count: number }>;
  offers: ProductionOffer[];
}
interface ProductionLookupEntry {
  type: 'gun' | 'mod';
  all_presets?: ProductionPreset[];
  stats: { offers: ProductionOffer[] };
}
type BuildItemLookup = (guns: unknown[], mods: unknown[]) => Record<string, ProductionLookupEntry>;

const { buildItemLookup } = (await import(DATA_SERVICE)) as { buildItemLookup: BuildItemLookup };

const { result: adapterOutput } = await withPinnedFetch(() => fetchAllDataFromJsonApi('en', 'regular'));
const lookup = buildItemLookup(adapterOutput.guns, adapterOutput.mods);
const { world } = loadPinnedWorld('en');

// ----------------------------------------------------------------------------------------
// Preset quantities
// ----------------------------------------------------------------------------------------

/** Per-item quantity as production represents it: repeated entries sum (the extractor already merged them). */
function productionQuantities(items: readonly { itemId: string; count: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const { itemId, count } of items) out.set(itemId, (out.get(itemId) ?? 0) + count);
  return out;
}

interface QuantityMismatch { gunId: string; presetId: string; presetName: string; itemId: string; itemName: string; expected: number; got: number }

function comparePresetQuantities(source: Record<string, ProductionLookupEntry> = lookup) {
  const mismatches: QuantityMismatch[] = [];
  const identityProblems: string[] = [];
  const receiverProblems: string[] = [];
  let comparedPresets = 0;
  for (const gun of world.items.values()) {
    if (!gun.types.includes('gun')) continue;
    const entry = source[gun.id];
    const production = entry?.all_presets ?? [];
    const productionIds = production.map(p => p.id);
    if (JSON.stringify(productionIds) !== JSON.stringify(gun.presetIds)) {
      identityProblems.push(`${gun.id}: production presets ${productionIds.length} vs reference ${gun.presetIds.length}`);
      continue;
    }
    production.forEach(preset => {
      comparedPresets++;
      const rawPreset = world.items.get(preset.id) as RefItem;
      const expected = expandComponents(rawPreset.components);
      // The raw preset lists the receiver itself as a component; production carries it as `receiver_id` (base
      // identity) and keeps it out of the supplied stock. Compare the stock, and the receiver separately.
      if (preset.receiver_id !== gun.id) receiverProblems.push(`${preset.id}: receiver_id ${preset.receiver_id} != ${gun.id}`);
      if (expected.get(gun.id) !== 1) receiverProblems.push(`${preset.id}: raw source lists the receiver x${expected.get(gun.id) ?? 0}, not exactly once`);
      expected.delete(gun.id);
      const got = productionQuantities(preset.items);
      for (const itemId of new Set([...expected.keys(), ...got.keys()])) {
        const e = expected.get(itemId) ?? 0;
        const g = got.get(itemId) ?? 0;
        if (e !== g) {
          mismatches.push({
            gunId: gun.id,
            presetId: preset.id,
            presetName: world.translateItemKey(rawPreset.nameKey),
            itemId,
            itemName: world.translateItemKey((world.items.get(itemId) as RefItem).nameKey),
            expected: e,
            got: g,
          });
        }
      }
    });
  }
  return { mismatches, identityProblems, receiverProblems, comparedPresets };
}

const quantities = comparePresetQuantities();

test('production all_presets lists exactly the reference presets for every gun, in order', () => {
  assert.deepEqual(quantities.identityProblems, []);
  assert.equal(quantities.comparedPresets, 399);
});

test('production extractAllPresets preserves reference preset quantities', t => {
  for (const m of quantities.mismatches) {
    t.diagnostic(`preset ${m.presetId} "${m.presetName}" (gun ${m.gunId}): item ${m.itemId} "${m.itemName}" expected x${m.expected}, production x${m.got}`);
  }
  assert.deepEqual(quantities.mismatches, [], `${quantities.mismatches.length} preset quantities differ from the raw source`);
});

test('the quantity comparison covers the real multi-copy population: 56 gun-preset entries with count > 1 (35 mods)', t => {
  const { summary } = gunPresetMultiplicities(world);
  const isMod = (itemId: string) => (world.items.get(itemId) as RefItem).types.includes('mods');
  const modEntries = summary.multiplicities.filter(m => isMod(m.itemId));
  t.diagnostic(`${summary.multiplicities.length} multi-copy entries in ${summary.presetsWithGt1} presets (${modEntries.length} weapon mods, the rest ammunition)`);
  assert.equal(summary.multiplicities.length, 56);
  assert.equal(summary.presetsWithGt1, 52);
  assert.equal(modEntries.length, 35);
  // Each of them is read back with its exact raw count, not as one copy.
  const byPreset = new Map(Object.values(lookup).flatMap(e => e.all_presets ?? []).map(p => [p.id, p]));
  for (const m of summary.multiplicities) {
    assert.equal(productionQuantities(byPreset.get(m.presetId)?.items ?? []).get(m.itemId), m.count, `${m.presetId} ${m.itemId}`);
  }
});

test('the receiver is base identity: every preset carries receiver_id and keeps the receiver out of the supplied stock', () => {
  assert.deepEqual(quantities.receiverProblems, []);
  const presets = Object.values(lookup).flatMap(e => e.all_presets ?? []);
  assert.equal(presets.length, 399);
  for (const p of presets) assert.ok(!p.items.some(c => c.itemId === p.receiver_id), `${p.id} lists its receiver as stock`);
});

test('control: a tampered count is flagged by the quantity comparison', () => {
  const victim = Object.entries(lookup).find(([, e]) => e.type === 'gun' && (e.all_presets ?? []).some(p => p.items.length > 0));
  assert.ok(victim);
  const [id, entry] = victim;
  let tamperedOnce = false;
  const tampered: Record<string, ProductionLookupEntry> = {
    ...lookup,
    [id]: {
      ...entry,
      all_presets: (entry.all_presets ?? []).map(p => {
        if (tamperedOnce || p.items.length === 0) return p;
        tamperedOnce = true;
        return { ...p, items: p.items.map((c, i) => (i === 0 ? { ...c, count: c.count + 1 } : c)) };
      }),
    },
  };
  const result = comparePresetQuantities(tampered);
  assert.equal(result.mismatches.length, 1);
  assert.equal(result.comparedPresets, 399);
});

test('control: a count-collapsed output (the pre-repair shape, one copy per entry) is flagged for exactly the multi-copy entries', () => {
  const collapsed: Record<string, ProductionLookupEntry> = {};
  for (const [id, entry] of Object.entries(lookup)) {
    collapsed[id] = entry.type !== 'gun' ? entry : {
      ...entry,
      all_presets: (entry.all_presets ?? []).map(p => ({ ...p, items: p.items.map(c => ({ itemId: c.itemId, count: 1 })) })),
    };
  }
  const result = comparePresetQuantities(collapsed);
  const { summary } = gunPresetMultiplicities(world);
  assert.equal(result.mismatches.length, summary.multiplicities.length);
  assert.equal(result.mismatches.length, 56);
});

// ----------------------------------------------------------------------------------------
// Barter valuation (adapter output -> extractBarterOffers) vs exact reference
// ----------------------------------------------------------------------------------------

const bartersByItem = indexBartersByOfferedItem(world.barters);

function barterSignatures(offers: readonly ProductionOffer[]): string[] {
  return offers
    .filter(o => o.source.startsWith('barter:'))
    .map(o => `${o.price}|${o.source}|${o.trader_level}|${JSON.stringify((o.barter_requirements ?? []).map(r => [r.name, r.count, r.unit_price]))}|lot ${o.lot_size}`)
    .sort();
}

function referenceBarterSignatures(itemId: string): string[] {
  const out: string[] = [];
  for (const barter of bartersByItem.get(itemId) ?? []) {
    const offer = referenceBarterOffer(world, barter);
    if (!offer) continue;
    const trader = world.traders.get(barter.traderId);
    const requirements = barter.requirements.map(r => {
      const source = world.items.get(r.itemId) as RefItem;
      return [world.translateItemKey(source.nameKey), r.count, source.avg24hPrice ?? source.basePrice ?? 0];
    });
    out.push(`${offer.priceRUB}|barter:${trader?.normalizedName}|${barter.minTraderLevel}|${JSON.stringify(requirements)}|lot ${barter.offered.count}`);
  }
  return out.sort();
}

function compareBarterValuation(source: Record<string, ProductionLookupEntry> = lookup) {
  let items = 0;
  let offers = 0;
  const mismatches: string[] = [];
  const check = (label: string, itemId: string, productionOffers: readonly ProductionOffer[]) => {
    items++;
    const actual = barterSignatures(productionOffers);
    const expected = referenceBarterSignatures(itemId);
    offers += expected.length;
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      const missing = expected.filter(e => !actual.includes(e));
      const extra = actual.filter(a => !expected.includes(a));
      mismatches.push(`${label} ${itemId}: reference-only ${JSON.stringify(missing)} production-only ${JSON.stringify(extra)}`);
    }
  };
  for (const [id, entry] of Object.entries(source)) {
    if (entry.type === 'mod') check('mod', id, entry.stats.offers);
    if (entry.type === 'gun') for (const preset of entry.all_presets ?? []) check('preset', preset.id, preset.offers);
  }
  return { items, offers, mismatches };
}

test('barter valuation: production offers equal the exact-rational reference (price, trader, level, requirements, lot size)', t => {
  const result = compareBarterValuation();
  t.diagnostic(`compared ${result.items} mods/presets with ${result.offers} reference barter offers; mismatches=${result.mismatches.length}`);
  for (const m of result.mismatches.slice(0, 10)) t.diagnostic(m);
  // Coverage on the pinned capture: of 855 barters, 173 offer a mod and 134 offer a preset that a
  // gun lists; the rest offer ammo/other items (507), presets no gun lists (37) or guns (4).
  // Production deliberately reads bartersFor only for mods and presets (extractGunStats ignores
  // them), so only those 307 are comparable. A zero or non-positive total is "no offer" on both sides.
  assert.equal(result.offers, 307, 'the comparison must cover the real population of barter offers');
  // Float summation + Math.round disagreeing with exact floor(x + 1/2) would show up here; any
  // re-pin that changes this is flagged rather than silently accepted.
  assert.equal(result.mismatches.length, 0, result.mismatches.slice(0, 5).join(' | '));
});

test('barter lot sizes: every comparable production barter offer carries the source offeredItem.count (all one unit for mods and presets here)', () => {
  const sizes = new Map<number, number>();
  for (const entry of Object.values(lookup)) {
    const offerLists = entry.type === 'mod' ? [entry.stats.offers] : (entry.all_presets ?? []).map(p => p.offers);
    for (const offers of offerLists) {
      for (const o of offers) {
        if (!o.source.startsWith('barter:')) continue;
        assert.ok(Number.isInteger(o.lot_size) && (o.lot_size as number) >= 1, 'a validated integer lot size on every barter offer');
        sizes.set(o.lot_size as number, (sizes.get(o.lot_size as number) ?? 0) + 1);
      }
    }
  }
  // INTERPRETATIONS.md choice 1: the 29 multi-unit barters are all ammunition, which the adapter never converts.
  assert.deepEqual([...sizes], [[1, 307]]);
});

test('control: a tampered lot size is flagged by the valuation comparison', () => {
  const victim = Object.entries(lookup).find(([, e]) => e.type === 'mod' && e.stats.offers.some(o => o.source.startsWith('barter:')));
  assert.ok(victim);
  const [id, entry] = victim;
  const tampered: Record<string, ProductionLookupEntry> = {
    ...lookup,
    [id]: { ...entry, stats: { ...entry.stats, offers: entry.stats.offers.map(o => (o.source.startsWith('barter:') ? { ...o, lot_size: (o.lot_size ?? 1) + 1 } : o)) } },
  };
  assert.ok(compareBarterValuation(tampered).mismatches.length >= 1);
});

test('control: a tampered production barter price is flagged by the valuation comparison', () => {
  const victim = Object.entries(lookup).find(([, e]) => e.type === 'mod' && e.stats.offers.some(o => o.source.startsWith('barter:')));
  assert.ok(victim);
  const [id, entry] = victim;
  const tampered: Record<string, ProductionLookupEntry> = {
    ...lookup,
    [id]: { ...entry, stats: { ...entry.stats, offers: entry.stats.offers.map(o => (o.source.startsWith('barter:') ? { ...o, price: o.price + 1 } : o)) } },
  };
  assert.ok(compareBarterValuation(tampered).mismatches.length >= 1);
});
