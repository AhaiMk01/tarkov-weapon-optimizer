// Differential: production dataService extractors (via buildItemLookup) vs the independent
// reference reader, on the production adapter's output for the pinned raw documents.
//
//  * Known Stage 2 defect (ADR 0013 §4A): `extractAllPresets` pushes one item id per
//    `containsItems` entry and ignores `count`, so a preset holding 3 copies of a part reads as
//    1. Stage 1 expects to expose this; it does not require the extractor to pass.
//  * Barter valuation: production sums in binary64 and uses Math.round; the reference evaluates
//    avg24hPrice ?? basePrice ?? 0 exactly over Q and rounds floor(total + 1/2) (ADR 0010 §2).
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
}
interface ProductionPreset {
  id: string;
  name: string;
  /** string[] today (one id per raw entry); {itemId,count}[] after the Stage 2 repair. */
  items: unknown[];
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

/** Per-item quantity as production represents it, tolerant of the Stage 2 count-bearing shape. */
function productionQuantities(items: readonly unknown[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const entry of items) {
    if (typeof entry === 'string') {
      out.set(entry, (out.get(entry) ?? 0) + 1);
    } else if (typeof entry === 'object' && entry !== null) {
      const e = entry as { itemId?: unknown; id?: unknown; count?: unknown };
      const id = String(e.itemId ?? e.id);
      out.set(id, (out.get(id) ?? 0) + (typeof e.count === 'number' ? e.count : 1));
    }
  }
  return out;
}

interface QuantityMismatch { gunId: string; presetId: string; presetName: string; itemId: string; itemName: string; expected: number; got: number }

function comparePresetQuantities(source: Record<string, ProductionLookupEntry> = lookup) {
  const mismatches: QuantityMismatch[] = [];
  const identityProblems: string[] = [];
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
  return { mismatches, identityProblems, comparedPresets };
}

const quantities = comparePresetQuantities();

test('production all_presets lists exactly the reference presets for every gun, in order', () => {
  assert.deepEqual(quantities.identityProblems, []);
  assert.equal(quantities.comparedPresets, 399);
});

test('KNOWN DEFECT PRESENT: production extractAllPresets currently loses preset counts', t => {
  const presets = new Set(quantities.mismatches.map(m => m.presetId));
  const unitsLost = quantities.mismatches.reduce((sum, m) => sum + (m.expected - m.got), 0);
  t.diagnostic(`count loss: ${quantities.mismatches.length} (preset,item) quantities wrong in ${presets.size} of ${quantities.comparedPresets} presets, ${unitsLost} units missing`);
  const isMod = (itemId: string) => (world.items.get(itemId) as RefItem).types.includes('mods');
  const modMismatches = quantities.mismatches.filter(m => isMod(m.itemId));
  const modUnitsLost = modMismatches.reduce((sum, m) => sum + (m.expected - m.got), 0);
  t.diagnostic(`  of which mods: ${modMismatches.length} entries, ${modUnitsLost} units; non-mod (ammo) entries: ${quantities.mismatches.length - modMismatches.length}, ${unitsLost - modUnitsLost} units`);
  // The mismatch set must be exactly the reference's own count>1 entries, each read as 1 copy:
  // no other kind of divergence hides inside the defect.
  const { summary } = gunPresetMultiplicities(world);
  const expected = summary.multiplicities.map(m => `${m.presetId}|${m.itemId}|${m.count}|1`).sort();
  const actual = quantities.mismatches.map(m => `${m.presetId}|${m.itemId}|${m.expected}|${m.got}`).sort();
  assert.deepEqual(actual, expected);
  assert.equal(quantities.mismatches.length, 56);
  assert.equal(presets.size, 52);
  assert.equal(modMismatches.length, 35, 'entries whose item is a weapon mod (the rest are ammo in magazines)');
  assert.equal(unitsLost, 626);
  // When Stage 2 repairs the extractor this assertion fails: remove the todo flag below and
  // retire this test at the same time.
  assert.ok(quantities.mismatches.length > 0);
});

test(
  'production extractAllPresets preserves reference preset quantities',
  { todo: 'Stage 2 repairs preset count loss (ADR 0013 §4A)' },
  t => {
    for (const m of quantities.mismatches) {
      t.diagnostic(`preset ${m.presetId} "${m.presetName}" (gun ${m.gunId}): item ${m.itemId} "${m.itemName}" expected x${m.expected}, production x${m.got}`);
    }
    assert.deepEqual(quantities.mismatches, [], `${quantities.mismatches.length} preset quantities differ from the raw source`);
  },
);

test('control: a count-bearing extractor output (the Stage 2 shape) passes the same comparison', () => {
  const repaired: Record<string, ProductionLookupEntry> = {};
  for (const [id, entry] of Object.entries(lookup)) {
    repaired[id] = entry.type !== 'gun' ? entry : {
      ...entry,
      all_presets: (entry.all_presets ?? []).map(p => ({
        ...p,
        items: (world.items.get(p.id) as RefItem).components.map(c => ({ itemId: c.itemId, count: c.count })),
      })),
    };
  }
  const result = comparePresetQuantities(repaired);
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.comparedPresets, 399);
});

// ----------------------------------------------------------------------------------------
// Barter valuation (adapter output -> extractBarterOffers) vs exact reference
// ----------------------------------------------------------------------------------------

const bartersByItem = indexBartersByOfferedItem(world.barters);

function barterSignatures(offers: readonly ProductionOffer[]): string[] {
  return offers
    .filter(o => o.source.startsWith('barter:'))
    .map(o => `${o.price}|${o.source}|${o.trader_level}|${JSON.stringify((o.barter_requirements ?? []).map(r => [r.name, r.count, r.unit_price]))}`)
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
    out.push(`${offer.priceRUB}|barter:${trader?.normalizedName}|${barter.minTraderLevel}|${JSON.stringify(requirements)}`);
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

test('barter valuation: production offers equal the exact-rational reference (price, trader, level, requirements)', t => {
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
