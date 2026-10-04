// Differential: the PRODUCTION JSON API adapter vs the independent reference reader, both fed
// the same pinned raw bytes (the adapter reads them through a stubbed fetch; no network).
//
// This is one of the few files allowed to import production code, strictly as the system under
// test (frontend/reference/independence.test.ts). Reference expectations come from rawReader.ts
// and referenceRules.ts, never from the adapter.
//
// What it establishes (ADR 0010 §1/§5, ADR 0013 §3): which adapter transformations are TRUSTED
// on this evidence (checked field by field, zero mismatches, nonzero coverage) and which are
// NOT (unproved defaults, projections that drop source fields, ignored source fields).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { fetchAllDataFromJsonApi } from '../../src/solver/jsonApiAdapter';
import { SourceDataError } from '../../src/solver/sourceErrors';
import { loadPinnedDocument } from './pins';
import { loadPinnedWorld, pinnedTexts } from './pinnedWorld';
import { withPinnedFetch } from './pinnedFetchStub';
import { SourceError, indexBartersByOfferedItem, readRawWorld } from './rawReader';
import type { RawTexts, RawWorld, RefBarter, RefItem } from './rawReader';
import { referenceFleaOffer } from './referenceRules';
import { auditBarterCounts, auditContainsCounts, categoryChain, gunPresetMultiplicities } from './sourceChecks';

// The adapter's output is deliberately untyped (GraphQL-shaped JSON); this harness probes it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

// ----------------------------------------------------------------------------------------
// Ledger
// ----------------------------------------------------------------------------------------

interface Tally { checks: number; mismatchCount: number; mismatches: string[] }

class Ledger {
  readonly tallies = new Map<string, Tally>();
  readonly defaulted = new Map<string, number>();

  private tally(name: string): Tally {
    let t = this.tallies.get(name);
    if (!t) {
      t = { checks: 0, mismatchCount: 0, mismatches: [] };
      this.tallies.set(name, t);
    }
    return t;
  }

  eq(name: string, actual: unknown, expected: unknown, context: string): void {
    const t = this.tally(name);
    t.checks++;
    if (!isDeepStrictEqual(actual, expected)) {
      t.mismatchCount++;
      if (t.mismatches.length < 25) t.mismatches.push(`${context}: adapter ${JSON.stringify(actual)} != reference ${JSON.stringify(expected)}`);
    }
  }

  /**
   * Compare a scalar the source may leave null. When the source value is null the adapter
   * substitutes a default; that substitution is recorded as an EXERCISED default, not compared.
   */
  eqOrDefault(name: string, actual: unknown, raw: unknown, defaultLabel: string, context: string): void {
    if (raw === null || raw === undefined) {
      this.defaulted.set(defaultLabel, (this.defaulted.get(defaultLabel) ?? 0) + 1);
      return;
    }
    this.eq(name, actual, raw, context);
  }

  noteDefault(label: string): void {
    this.defaulted.set(label, (this.defaulted.get(label) ?? 0) + 1);
  }
}

// ----------------------------------------------------------------------------------------
// Comparison of one adapter run against the reference world
// ----------------------------------------------------------------------------------------

function compareOffers(L: Ledger, adapter: Loose, raw: RefItem, world: RawWorld, bartersByItem: ReadonlyMap<string, readonly RefBarter[]>, ctx: string): void {
  const buyFor: Loose[] = adapter.buyFor ?? [];
  const traderCount = raw.buyFromTrader.length;
  L.eq('trader offers', buyFor.length - (referenceFleaOffer(raw) ? 1 : 0), traderCount, `${ctx} trader offer count`);
  raw.buyFromTrader.forEach((offer, i) => {
    const a = buyFor[i];
    const trader = world.traders.get(offer.traderId);
    if (!a || !trader) {
      L.eq('trader offers', Boolean(a) && Boolean(trader), true, `${ctx} trader offer ${i} present and trader resolved`);
      return;
    }
    L.eq('trader offers', a.source, trader.normalizedName, `${ctx} offer ${i} source`);
    L.eq('trader offers', a.vendor?.normalizedName, trader.normalizedName, `${ctx} offer ${i} vendor.normalizedName`);
    L.eq('translation', a.vendor?.name, world.translateTraderKey(trader.nameKey), `${ctx} offer ${i} trader name`);
    L.eqOrDefault('trader offers', a.currency, offer.currency, 'trader offer currency ?? "RUB"', `${ctx} offer ${i} currency`);
    L.eqOrDefault('trader offers', a.price, offer.price, 'trader offer price ?? 0', `${ctx} offer ${i} price`);
    L.eqOrDefault('trader offers', a.priceRUB, offer.priceRUB, 'trader offer priceRUB ?? 0', `${ctx} offer ${i} priceRUB`);
    L.eqOrDefault('trader offers', a.vendor?.minTraderLevel, offer.minTraderLevel, 'trader offer minTraderLevel ?? 1', `${ctx} offer ${i} minTraderLevel`);
    L.eqOrDefault('trader offers', a.vendor?.buyLimit, offer.buyLimit, 'trader offer buyLimit ?? 0', `${ctx} offer ${i} buyLimit`);
  });

  const flea = referenceFleaOffer(raw);
  const rest = buyFor.slice(traderCount);
  L.eq('flea offer', rest.length, flea ? 1 : 0, `${ctx} flea offer presence`);
  if (flea && rest[0]) {
    const a = rest[0];
    L.eq('flea offer', { currency: a.currency, price: a.price, priceRUB: a.priceRUB, source: a.source }, {
      currency: 'RUB', price: flea.priceRUB, priceRUB: flea.priceRUB, source: 'fleaMarket',
    }, `${ctx} flea offer`);
    if (world.fleaMarket) {
      L.eq('translation', a.vendor?.name, world.translateItemKey(world.fleaMarket.nameKey), `${ctx} flea vendor name`);
      L.eqOrDefault('flea offer', a.vendor?.normalizedName, world.fleaMarket.normalizedName, 'flea normalizedName ?? "flea-market"', `${ctx} flea normalizedName`);
      L.eqOrDefault('flea offer', a.vendor?.foundInRaidRequired, world.fleaMarket.foundInRaidRequired, 'flea foundInRaidRequired ?? false', `${ctx} flea foundInRaidRequired`);
      L.eqOrDefault('flea offer', a.vendor?.enabled, world.fleaMarket.enabled, 'flea enabled ?? true', `${ctx} flea enabled`);
    }
  }

  const expected = bartersByItem.get(raw.id) ?? [];
  const bartersFor: Loose[] = adapter.bartersFor ?? [];
  L.eq('barter offers', bartersFor.length, expected.length, `${ctx} barter count`);
  expected.forEach((barter, i) => {
    const a = bartersFor[i];
    if (!a) return;
    const trader = world.traders.get(barter.traderId);
    if (trader) {
      L.eq('barter offers', a.trader?.normalizedName, trader.normalizedName, `${ctx} barter ${barter.id} trader`);
      L.eq('translation', a.trader?.name, world.translateTraderKey(trader.nameKey), `${ctx} barter ${barter.id} trader name`);
    }
    L.eqOrDefault('barter offers', a.level, barter.minTraderLevel, 'barter minTraderLevel ?? 1 (level)', `${ctx} barter ${barter.id} level`);
    const required: Loose[] = a.requiredItems ?? [];
    L.eq('barter offers', required.length, barter.requirements.length, `${ctx} barter ${barter.id} requirement count`);
    barter.requirements.forEach((requirement, j) => {
      const r = required[j];
      const source = world.items.get(requirement.itemId);
      if (!r || !source) return;
      L.eq('barter offers', r.item?.id, requirement.itemId, `${ctx} barter ${barter.id} req ${j} id`);
      L.eq('translation', r.item?.name, world.translateItemKey(source.nameKey), `${ctx} barter ${barter.id} req ${j} name`);
      L.eq('barter offers', r.count, requirement.count, `${ctx} barter ${barter.id} req ${j} count`);
      L.eq('barter offers', r.item?.avg24hPrice, source.avg24hPrice, `${ctx} barter ${barter.id} req ${j} avg24hPrice`);
      L.eqOrDefault('barter offers', r.item?.basePrice, source.basePrice, 'barter requirement basePrice ?? null', `${ctx} barter ${barter.id} req ${j} basePrice`);
    });
  });
}

function compareCategory(L: Ledger, adapter: Loose, raw: RefItem, world: RawWorld, ctx: string): void {
  const chain = raw.categoryIds.length ? categoryChain(world, raw.categoryIds[0]) : [];
  const actualIds: string[] = [];
  const actualNames: string[] = [];
  let node: Loose | null = adapter.bsgCategory ?? null;
  while (node) {
    actualIds.push(node.id);
    actualNames.push(node.name);
    node = node.parent ?? null;
  }
  L.eq('categories', actualIds, chain, `${ctx} category chain ids`);
  L.eq('translation', actualNames, chain.map(id => world.translateItemKey((world.categories.get(id) as { nameKey: string }).nameKey)), `${ctx} category names`);
  const expectedHandbook = raw.handbookCategoryIds
    .map(id => world.handbookCategories.get(id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined)
    .map(c => world.translateItemKey(c.nameKey));
  L.eq('translation', (adapter.handbookCategories ?? []).map((c: Loose) => c.name), expectedHandbook, `${ctx} handbook categories`);
}

function comparePreset(L: Ledger, adapter: Loose, raw: RefItem, world: RawWorld, bartersByItem: ReadonlyMap<string, readonly RefBarter[]>, ctx: string): void {
  L.eq('dereference', adapter.id, raw.id, `${ctx} preset id`);
  L.eq('translation', adapter.name, world.translateItemKey(raw.nameKey), `${ctx} preset name`);
  L.eq('translation', adapter.shortName, world.translateItemKey(raw.shortNameKey), `${ctx} preset shortName`);
  const actual = (adapter.containsItems ?? []).map((c: Loose) => ({ itemId: c.item?.id, count: c.count }));
  L.eq('preset components', actual, raw.components.map(c => ({ itemId: c.itemId, count: c.count })), `${ctx} preset containsItems`);
  compareOffers(L, adapter, raw, world, bartersByItem, `${ctx} preset`);
}

function compareItem(L: Ledger, adapter: Loose, raw: RefItem, world: RawWorld, bartersByItem: ReadonlyMap<string, readonly RefBarter[]>): void {
  const ctx = `${raw.id}`;
  L.eq('translation', adapter.name, world.translateItemKey(raw.nameKey), `${ctx} name`);
  L.eq('translation', adapter.shortName, world.translateItemKey(raw.shortNameKey), `${ctx} shortName`);
  L.eq('scalars', adapter.normalizedName, raw.normalizedName, `${ctx} normalizedName`);
  L.eqOrDefault('scalars', adapter.weight, raw.weight?.value ?? null, 'item weight ?? 0', `${ctx} weight`);
  L.eqOrDefault('scalars', adapter.basePrice, raw.basePrice, 'item basePrice ?? 0', `${ctx} basePrice`);
  L.eq('scalars', adapter.avg24hPrice, raw.avg24hPrice, `${ctx} avg24hPrice`);
  L.eqOrDefault('scalars', adapter.minLevelForFlea, raw.minLevelForFlea, 'item minLevelForFlea ?? 0', `${ctx} minLevelForFlea`);
  L.eqOrDefault('scalars', adapter.accuracyModifier, raw.accuracyModifier, 'item accuracyModifier ?? 0', `${ctx} accuracyModifier`);
  L.eqOrDefault('scalars', adapter.ergonomicsModifier, raw.ergonomicsModifier, 'item ergonomicsModifier ?? 0', `${ctx} ergonomicsModifier`);
  L.eqOrDefault('scalars', adapter.recoilModifier, raw.recoilModifier, 'item recoilModifier ?? 0', `${ctx} recoilModifier`);
  L.eq('dereference', adapter.conflictingSlotIds, raw.conflictingSlotIds, `${ctx} conflictingSlotIds`);
  L.eq('dereference', (adapter.conflictingItems ?? []).map((c: Loose) => c.id), raw.conflictingItemIds, `${ctx} conflictingItems`);
  compareCategory(L, adapter, raw, world, ctx);
  compareOffers(L, adapter, raw, world, bartersByItem, ctx);

  const props: Loose | null = adapter.properties ?? null;
  if (raw.properties === null) {
    L.eq('scalars', props, null, `${ctx} properties`);
    return;
  }
  for (const [key, value] of Object.entries(raw.properties)) {
    if (key === 'slots' || key === 'presets' || key === 'defaultPreset') continue;
    L.eq('scalars', props?.[key], value, `${ctx} properties.${key}`);
  }
  const slots: Loose[] = props?.slots ?? [];
  L.eq('dereference', slots.length, raw.slots.length, `${ctx} slot count`);
  raw.slots.forEach((slot, i) => {
    const a = slots[i];
    if (!a) return;
    L.eq('dereference', a.id, slot.id, `${ctx} slot ${i} id`);
    L.eq('translation', a.name, world.translateItemKey(slot.nameKey), `${ctx} slot ${i} name`);
    L.eq('dereference', a.nameId, slot.nameId, `${ctx} slot ${i} nameId`);
    L.eq('dereference', a.required, slot.required, `${ctx} slot ${i} required`);
    L.eq('dereference', a.filters?.allowedItems, slot.allowedItemIds, `${ctx} slot ${i} allowedItems`);
  });
  if (raw.types.includes('gun')) {
    const presets: Loose[] = props?.presets ?? [];
    L.eq('dereference', presets.map(p => p.id), raw.presetIds, `${ctx} preset ids`);
    presets.forEach((preset, i) => {
      const rawPreset = world.items.get(raw.presetIds[i]);
      if (rawPreset) comparePreset(L, preset, rawPreset, world, bartersByItem, `${ctx} preset ${raw.presetIds[i]}`);
    });
    L.eq('dereference', props?.defaultPreset?.id ?? null, raw.defaultPresetId, `${ctx} defaultPreset`);
  }
}

function compareAdapter(out: { guns: Loose[]; mods: Loose[] }, world: RawWorld): Ledger {
  const L = new Ledger();
  const bartersByItem = indexBartersByOfferedItem(world.barters);
  const rawGuns = [...world.items.values()].filter(i => i.types.includes('gun'));
  const rawMods = [...world.items.values()].filter(i => i.types.includes('mods'));
  L.eq('population', out.guns.map(g => g.id), rawGuns.map(i => i.id), 'gun ids and order');
  L.eq('population', out.mods.map(m => m.id), rawMods.map(i => i.id), 'mod ids and order');
  L.eq('population', rawGuns.some(g => g.types.includes('mods')), false, 'no raw item is both gun and mods');
  rawGuns.forEach((raw, i) => out.guns[i] && compareItem(L, out.guns[i], raw, world, bartersByItem));
  rawMods.forEach((raw, i) => out.mods[i] && compareItem(L, out.mods[i], raw, world, bartersByItem));
  return L;
}

// ----------------------------------------------------------------------------------------
// Run the production adapter on pinned bytes
// ----------------------------------------------------------------------------------------

async function runAdapter(lang: string, overrides: Record<string, string> = {}) {
  return withPinnedFetch(() => fetchAllDataFromJsonApi(lang, 'regular'), overrides);
}

const en = await runAdapter('en');
const zh = await runAdapter('zh');
const enWorld = loadPinnedWorld('en').world;
const zhWorld = loadPinnedWorld('zh').world;
const enLedger = compareAdapter(en.result, enWorld);
const zhLedger = compareAdapter(zh.result, zhWorld);

const URL_BASE = 'https://json.tarkov.dev/regular/';
const sorted = (xs: readonly string[]) => [...xs].sort();

test('the adapter read exactly the pinned documents, through the stub, with no network', () => {
  assert.deepEqual(sorted(en.requested), sorted(['items', 'items_en', 'barters', 'traders', 'traders_en'].map(d => URL_BASE + d)));
  assert.deepEqual(
    sorted(zh.requested),
    sorted(['items', 'items_zh', 'items_en', 'barters', 'traders', 'traders_zh', 'traders_en'].map(d => URL_BASE + d)),
  );
});

// Transformation id -> what is established. A transformation is TRUSTED only with nonzero
// coverage and zero mismatches against the reference on the pinned capture.
const TRANSFORMATIONS: Array<[string, string]> = [
  ['population', 'guns/mods split by `types`, document order, no duplicates'],
  ['translation', 'translation keys resolved for names, short names, slot/category/handbook/trader/flea names'],
  ['dereference', 'preset/defaultPreset/containsItems/conflictingItems/allowedItems IDs rewrapped; slot ids, nameId, required'],
  ['preset components', 'preset containsItems ids and validated counts passed through unchanged (no count default)'],
  ['categories', 'bsgCategory parent chain rebuilt from categories[0]'],
  ['trader offers', 'buyFromTrader mapped to buyFor (source/vendor/price/priceRUB/minTraderLevel/buyLimit)'],
  ['flea offer', 'synthesized flea offer (rule, price, vendor descriptor)'],
  ['barter offers', 'bartersFor index by offered item; level = minTraderLevel; requirement ids/counts/prices'],
  ['scalars', 'weights, prices, modifiers and properties passed through exactly'],
];

for (const [lang, ledger] of [['en', enLedger], ['zh', zhLedger]] as const) {
  for (const [id, description] of TRANSFORMATIONS) {
    test(`adapter vs reference [${lang}]: ${id} -- ${description}`, t => {
      const tally = ledger.tallies.get(id);
      assert.ok(tally && tally.checks > 0, `transformation "${id}" had no coverage`);
      t.diagnostic(`${id}: ${tally.checks} checks, ${tally.mismatchCount} mismatches`);
      assert.equal(tally.mismatchCount, 0, `${tally.mismatchCount} mismatches, first: ${tally.mismatches.slice(0, 5).join(' | ')}`);
    });
  }
}

test('requested-language items resolve through zh, not English, when the zh document has the key', () => {
  const gun = zh.result.guns[0];
  const raw = zhWorld.items.get(gun.id) as RefItem;
  assert.equal(gun.name, zhWorld.translateItemKey(raw.nameKey));
  assert.notEqual(gun.name, enWorld.translateItemKey(raw.nameKey));
});

// ----------------------------------------------------------------------------------------
// Defaults the adapter applies: which are ever exercised on the pinned capture
// ----------------------------------------------------------------------------------------

test('adapter defaults: record which are ever exercised on the pinned capture', t => {
  const { docs } = loadPinnedWorld('en');
  const containsAudit = auditContainsCounts(docs.itemsData);
  const barterAudit = auditBarterCounts(docs.barters);
  const exercised: Record<string, number> = {
    'absent/null preset containsItems count (now a source error)': containsAudit.absent + containsAudit.nullCount,
    'absent/null barter requirement count (now a source error)': barterAudit.absentOrNull,
    ...Object.fromEntries(enLedger.defaulted),
  };
  t.diagnostic(`defaults exercised (en): ${JSON.stringify(exercised)}`);
  // ADR 0013 section 4A: the adapter no longer defaults a count (`contained.count ?? 1` and
  // `req.count ?? 1` were removed in Stage 2 phase 2.2); an absent or null count is a SourceDataError.
  // On the pinned capture none occurs: every raw entry carries an explicit count, which is why the
  // repair changes no pinned output. That is evidence about THIS capture only.
  assert.equal(exercised['absent/null preset containsItems count (now a source error)'], 0);
  assert.equal(exercised['absent/null barter requirement count (now a source error)'], 0);
  // Every default the pinned capture DOES exercise, recorded exactly: only the 172 guns lack the
  // mod-only `accuracyModifier`/`recoilModifier` fields. No other `??` default fires.
  assert.deepEqual(Object.fromEntries(enLedger.defaulted), {
    'item accuracyModifier ?? 0': 172,
    'item recoilModifier ?? 0': 172,
  });
});

// ----------------------------------------------------------------------------------------
// The comparison has power: deliberately corrupted adapter output is flagged
// ----------------------------------------------------------------------------------------

test('the comparison can fail: each transformation check flags a deliberately corrupted adapter output', () => {
  const bartersByItem = indexBartersByOfferedItem(enWorld.barters);
  const rawMod = [...enWorld.items.values()].find(i =>
    i.types.includes('mods') && i.buyFromTrader.length > 0 && referenceFleaOffer(i) && (bartersByItem.get(i.id)?.length ?? 0) > 0
      && i.slots.length > 0 && i.categoryIds.length > 0);
  const rawGun = [...enWorld.items.values()].find(i => i.types.includes('gun') && i.presetIds.length > 0);
  assert.ok(rawMod && rawGun, 'fixture items for the power test exist');
  const adapterMod = en.result.mods.find(m => m.id === rawMod.id) as Loose;
  const adapterGun = en.result.guns.find(g => g.id === rawGun.id) as Loose;

  const corruptions: Array<[string, RefItem, Loose, (item: Loose) => void]> = [
    ['translation', rawMod, adapterMod, item => { item.name += '!'; }],
    ['scalars', rawMod, adapterMod, item => { item.weight += 1; }],
    ['trader offers', rawMod, adapterMod, item => { item.buyFor[0].priceRUB += 1; }],
    ['flea offer', rawMod, adapterMod, item => { item.buyFor[item.buyFor.length - 1].priceRUB += 1; }],
    ['barter offers', rawMod, adapterMod, item => { item.bartersFor[0].level += 1; }],
    ['categories', rawMod, adapterMod, item => { item.bsgCategory.id = 'not-a-category'; }],
    ['dereference', rawMod, adapterMod, item => { item.properties.slots[0].required = !item.properties.slots[0].required; }],
    ['preset components', rawGun, adapterGun, item => { item.properties.presets[0].containsItems[0].count += 1; }],
  ];
  for (const [id, raw, adapter, corrupt] of corruptions) {
    const clean = new Ledger();
    compareItem(clean, structuredClone(adapter), raw, enWorld, bartersByItem);
    assert.equal(clean.tallies.get(id)?.mismatchCount, 0, `${id}: the uncorrupted item matches`);
    const dirty = structuredClone(adapter);
    corrupt(dirty);
    const ledger = new Ledger();
    compareItem(ledger, dirty, raw, enWorld, bartersByItem);
    assert.ok((ledger.tallies.get(id)?.mismatchCount ?? 0) > 0, `${id}: corruption was not detected`);
  }
});

// ----------------------------------------------------------------------------------------
// Trusted vs untrusted
// ----------------------------------------------------------------------------------------

test('trusted vs untrusted adapter transformations (recorded from this comparison)', t => {
  const world = enWorld;
  const { summary } = gunPresetMultiplicities(world);
  const offersGunModPreset = world.barters.filter(b => {
    const types = world.items.get(b.offered.itemId)?.types ?? [];
    return types.includes('gun') || types.includes('mods') || types.includes('preset');
  });
  const trusted = TRANSFORMATIONS
    .filter(([id]) => {
      const a = enLedger.tallies.get(id);
      const b = zhLedger.tallies.get(id);
      return a && b && a.checks > 0 && b.checks > 0 && a.mismatchCount === 0 && b.mismatchCount === 0;
    })
    .map(([id, description]) => `${id}: ${description} (${enLedger.tallies.get(id)?.checks} en + ${zhLedger.tallies.get(id)?.checks} zh checks)`);

  const untrusted = [
    `(repaired) containsItems[].count and barter req.count are no longer defaulted: an absent/null/malformed count is a SourceDataError (0 absent of ${auditContainsCounts(loadPinnedWorld('en').docs.itemsData).entries} entries here).`,
    'slot.filters is projected to allowedItems only: allowedCategories/excludedCategories/excludedItems are dropped. ' +
      'Never non-empty in the pinned capture, so nothing is lost here, but the source schema does not promise that.',
    `barter offeredItem.count is ignored: ${world.barters.filter(b => b.offered.count !== 1).length} barters offer >1 unit ` +
      `(all ammo here; ${offersGunModPreset.filter(b => b.offered.count !== 1).length} for gun/mod/preset targets).`,
    `barter taskUnlock is ignored: ${offersGunModPreset.filter(b => b.taskUnlock !== null).length} barters for gun/mod/preset ` +
      'targets are task-gated, yet are mapped like any other barter.',
    'flea `||` rule (avg24hPrice || lastLowPrice): zero avg24hPrice never occurs in the pinned capture, so `||` vs `??` is not distinguished by data (the reference unit test pins the rule).',
    'iconLink / image links and other display-only fields are not compared.',
    `(repaired) preset quantities downstream: dataService extractAllPresets now keeps the ${summary.entriesGt1} gun-preset entries with count > 1; see extractors.differential.test.ts.`,
  ];
  t.diagnostic(`TRUSTED (${trusted.length}):\n  - ${trusted.join('\n  - ')}`);
  t.diagnostic(`NOT TRUSTED / UNPROVED / REPAIRED (${untrusted.length}):\n  - ${untrusted.join('\n  - ')}`);
  assert.equal(trusted.length, TRANSFORMATIONS.length, 'every compared transformation is trusted on the pinned capture');
});

// ----------------------------------------------------------------------------------------
// Synthetic perturbations of the pinned bytes (labelled synthetic; not evidence about upstream)
// ----------------------------------------------------------------------------------------

function mutateDoc(name: string, mutate: (data: Loose) => void): string {
  const parsed = JSON.parse(loadPinnedDocument(name).text) as { data: Loose };
  mutate(parsed.data);
  return JSON.stringify(parsed);
}

test('SYNTHETIC: translation falls back requested language -> English -> key, matching the reference', async () => {
  const gun = enWorld.items.get(en.result.guns[0].id) as RefItem;
  const slotKey = gun.slots[0].nameKey;
  const traderKey = [...enWorld.traders.values()][0].nameKey;
  const gunWithBarterTrader = [...zhWorld.traders.values()].find(t => t.id === [...enWorld.traders.values()][0].id);
  assert.ok(gunWithBarterTrader);
  const overrides = {
    // English fallback: absent from zh, present in en.
    items_zh: mutateDoc('items_zh', data => { delete data[gun.nameKey]; delete data[slotKey]; delete data[gun.shortNameKey]; }),
    // Key fallback: also absent from en (shortName only).
    items_en: mutateDoc('items_en', data => { delete data[gun.shortNameKey]; }),
    traders_zh: mutateDoc('traders_zh', data => { delete data[traderKey]; }),
  };
  const run = await runAdapter('zh', overrides);
  const texts: RawTexts = { ...pinnedTexts('zh'), itemsLang: overrides.items_zh, itemsEn: overrides.items_en, tradersLang: overrides.traders_zh };
  const world = readRawWorld(texts, 'zh');
  const adapterGun = run.result.guns[0];
  assert.equal(adapterGun.name, enWorld.translateItemKey(gun.nameKey), 'English fallback for the name');
  assert.equal(adapterGun.shortName, gun.shortNameKey, 'key fallback when absent from both languages');
  assert.equal(adapterGun.properties.slots[0].name, enWorld.translateItemKey(slotKey), 'English fallback for the slot name');
  const ledger = compareAdapter(run.result, world);
  const translation = ledger.tallies.get('translation');
  assert.ok(translation && translation.checks > 0);
  assert.equal(translation.mismatchCount, 0, translation.mismatches.slice(0, 5).join(' | '));
});

function firstMultiCopyEntry(): { presetId: string; index: number; itemId: string; count: number } {
  const { summary } = gunPresetMultiplicities(enWorld);
  const first = summary.multiplicities[0];
  const preset = enWorld.items.get(first.presetId) as RefItem;
  const index = preset.components.findIndex(c => c.itemId === first.itemId && c.count === first.count);
  return { presetId: first.presetId, index, itemId: first.itemId, count: first.count };
}

/** Run the adapter on the pinned bytes with one preset component's raw `count` replaced (a SYNTHETIC perturbation). */
function mutatePresetCount(mutate: (entry: Loose) => void) {
  const target = firstMultiCopyEntry();
  const items = mutateDoc('items', data => { mutate(data.items[target.presetId].containsItems[target.index]); });
  return { target, items };
}

test('SYNTHETIC: the reference reader rejects an absent preset count', () => {
  const { target, items } = mutatePresetCount(entry => { delete entry.count; });
  assert.throws(
    () => readRawWorld({ ...pinnedTexts('en'), items }),
    (error: unknown) => error instanceof SourceError && error.path.includes(target.presetId) && /count is absent/.test(error.message),
  );
});

test('the adapter rejects an absent/null/malformed preset count as a source error naming the preset and the item', async () => {
  const cases: Array<[string, (entry: Loose) => void, RegExp]> = [
    ['absent', entry => { delete entry.count; }, /absent/],
    ['null', entry => { entry.count = null; }, /null/],
    ['fractional', entry => { entry.count = 1.5; }, /integer/],
    ['negative', entry => { entry.count = -1; }, /nonnegative/],
    ['string', entry => { entry.count = '2'; }, /string/],
    ['boolean', entry => { entry.count = true; }, /boolean/],
    ['unsafe integer', entry => { entry.count = 2 ** 53; }, /integer/],
  ];
  for (const [label, mutate, message] of cases) {
    const { target, items } = mutatePresetCount(mutate);
    await assert.rejects(
      () => runAdapter('en', { items }),
      (error: unknown) => error instanceof SourceDataError
        && error.kind === 'preset_component_count'
        && error.subjectId === target.presetId
        && error.itemId === target.itemId
        && message.test(error.message)
        && /count/i.test(error.message)
        && error.message.includes(target.presetId)
        && error.message.includes(target.itemId),
      `${label} count must be rejected`,
    );
  }
});

test('the adapter rejects an overflowing preset count (JSON 1e999 parses to Infinity)', async () => {
  const target = firstMultiCopyEntry();
  const original = loadPinnedDocument('items').text;
  // Text-level perturbation: JSON.stringify cannot write an Infinity, the raw token can.
  const marker = '"count":';
  const presetStart = original.indexOf(`"${target.presetId}":{`);
  assert.ok(presetStart >= 0, 'target preset located in the raw text');
  const containsStart = original.indexOf('"containsItems"', presetStart);
  const entryStart = original.indexOf(marker, containsStart);
  const numberStart = entryStart + marker.length;
  const numberEnd = numberStart + /^\d+/.exec(original.slice(numberStart))![0].length;
  const items = original.slice(0, numberStart) + '1e999' + original.slice(numberEnd);
  await assert.rejects(
    () => runAdapter('en', { items }),
    (error: unknown) => error instanceof SourceDataError && error.kind === 'preset_component_count' && /finite|integer/.test(error.message),
  );
});

test('a valid multi-copy preset count passes through the adapter exactly (no default, no clamp)', async () => {
  const target = firstMultiCopyEntry();
  const run = await runAdapter('en');
  const gun = run.result.guns.find(g => (g.properties?.presets ?? []).some((p: Loose) => p.id === target.presetId));
  assert.ok(gun, 'a gun carrying the multi-copy preset');
  const preset = gun.properties.presets.find((p: Loose) => p.id === target.presetId);
  assert.equal(preset.containsItems[target.index].count, target.count);
  assert.ok(target.count > 1);
});

test('the adapter rejects an absent/null/negative barter ingredient count, naming the barter and the ingredient; fractional counts stay valid', async () => {
  // A barter that offers a mod (so the adapter converts it) and has at least one ingredient.
  const modIds = new Set([...enWorld.items.values()].filter(i => i.types.includes('mods')).map(i => i.id));
  const index = enWorld.barters.findIndex(b => modIds.has(b.offered.itemId) && b.requirements.length > 0);
  assert.ok(index >= 0);
  const barter = enWorld.barters[index];
  const mutateBarter = (mutate: (requirement: Loose) => void) => mutateDoc('barters', data => { mutate((data as unknown as Loose[])[index].requiredItems[0]); });
  const cases: Array<[string, (requirement: Loose) => void, RegExp]> = [
    ['absent', r => { delete r.count; }, /absent/],
    ['null', r => { r.count = null; }, /null/],
    ['negative', r => { r.count = -0.5; }, /nonnegative/],
    ['string', r => { r.count = '155.1'; }, /string/],
  ];
  for (const [label, mutate, message] of cases) {
    const barters = mutateBarter(mutate);
    await assert.rejects(
      () => runAdapter('en', { barters }),
      (error: unknown) => error instanceof SourceDataError
        && error.kind === 'barter_ingredient_count'
        && error.subjectId === barter.offered.itemId
        && error.itemId === barter.requirements[0].itemId
        && message.test(error.message)
        && error.message.includes(barter.offered.itemId)
        && error.message.includes(barter.requirements[0].itemId),
      `${label} ingredient count must be rejected`,
    );
  }
  // A fractional count is genuine source data and is accepted unchanged.
  const fractional = mutateBarter(r => { r.count = 155.1; });
  const run = await runAdapter('en', { barters: fractional });
  const mod = run.result.mods.find((m: Loose) => m.id === barter.offered.itemId) as Loose;
  const offerIndex = enWorld.barters.filter(b => b.offered.itemId === barter.offered.itemId).findIndex(b => b.id === barter.id);
  assert.equal(mod.bartersFor[offerIndex].requiredItems[0].count, 155.1);
});

test('a barter that offers an item the adapter never converts (ammunition) does not block loading', async () => {
  const convertedIds = new Set([...enWorld.items.values()].filter(i => i.types.includes('mods') || i.types.includes('gun') || i.types.includes('preset')).map(i => i.id));
  const index = enWorld.barters.findIndex(b => !convertedIds.has(b.offered.itemId) && b.requirements.length > 0);
  assert.ok(index >= 0, 'an ammunition/other barter exists');
  const barters = mutateDoc('barters', data => { delete (data as unknown as Loose[])[index].requiredItems[0].count; });
  const run = await runAdapter('en', { barters });
  assert.ok(run.result.guns.length > 0);
});
