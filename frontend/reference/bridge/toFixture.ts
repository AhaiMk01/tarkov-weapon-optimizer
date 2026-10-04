// Raw-source -> reference-oracle bridge (Stage 1, ADR 0010 section 1 and 5, ADR 0013 section 3).
//
// fixtureForWeapon maps the independent raw reader's world (reference/source) into the oracle's
// ReferenceFixture (reference/oracle) for one weapon's full reachable closure. Nothing here imports
// production code: every rule below is re-derived from the pinned raw documents and the oracle schema.
//
// Principles (full rules in README.md):
//  * Exact numbers pass through as the raw binary64 leaves; the oracle decodes them exactly.
//  * A missing optional stat maps to the schema's documented default by OMITTING the field, and each
//    application of a default is recorded in provenance. Nothing is defaulted silently.
//  * Unknown, malformed or unrepresentable source data throws a BridgeError (an evidence error, never an
//    empty fixture and never infeasibility). A non-empty slot filter list other than allowedItems is
//    refused rather than dropped.

import type {
  ReferenceBarterOffer, ReferenceFixture, ReferenceItem, ReferenceOffer, ReferencePreset, ReferenceSlot, ReferenceTraderOffer,
  ReferenceWeapon,
} from '../oracle/index';
import { indexBartersByOfferedItem } from '../source/rawReader';
import type { RawWorld, RefBarter, RefItem, RefSlot } from '../source/rawReader';
import { referenceFleaOffer } from '../source/referenceRules';

/** An evidence error: the source data cannot be mapped faithfully into the oracle schema. */
export class BridgeError extends Error {
  readonly subject: string;
  constructor(subject: string, message: string) {
    super(`${subject}: ${message}`);
    this.name = 'BridgeError';
    this.subject = subject;
  }
}

export type OfferKind = 'trader' | 'flea' | 'barter';

export interface FixtureOptions {
  /**
   * Barters with a non-integer ingredient count (377 of 1128 ingredient entries in the pinned capture are
   * fractional) cannot pass the oracle's `checkFixture` today (it requires integer counts). 'omit' (default)
   * leaves such barters out and records each one in provenance.omitted; 'include' maps them verbatim.
   */
  fractionalBarters?: 'omit' | 'include';
  /**
   * Offer kinds attached to the NAKED receiver. Default ['trader']: a gun template's flea price and barters
   * price its factory configuration, not a bare receiver, and the production base model likewise lets the
   * naked receiver be bought from traders only. Presets and mods always get all three kinds.
   */
  weaponOfferKinds?: readonly OfferKind[];
}

export type DefaultScope = 'weapon' | 'item' | 'preset';

/** One field default applied by omission (the oracle then applies the documented schema default). */
export interface AppliedDefault {
  scope: DefaultScope;
  field: string;
  /** The schema default the oracle applies. */
  value: number;
  /** Template ids the default was applied to, code-unit sorted. */
  ids: string[];
}

export interface OmittedBarter {
  kind: 'barter';
  barterId: string;
  subjectId: string;
  reason: 'fractional-ingredient-count';
  ingredientCounts: number[];
}

export interface TaskGatedOffer {
  kind: 'trader' | 'barter';
  subjectId: string;
  trader: string;
  level: number;
  /** Raw taskUnlock id. The adopted domain treats the offer as available; this records how many are gated. */
  taskUnlock: string;
}

export interface FixtureProvenance {
  weaponId: string;
  weaponName: string;
  lang: string;
  options: { fractionalBarters: 'omit' | 'include'; weaponOfferKinds: OfferKind[] };
  closure: {
    /** Items in fixture.items (installable closure plus supply-only items). */
    items: number;
    /** Template slots over the receiver and every item. */
    slots: number;
    presets: number;
    presetComponentEntries: number;
  };
  /** Preset components outside the installable closure (typically ammunition): kept as inert supply-only items. */
  supplyOnlyItemIds: string[];
  /** Closure items whose raw `types` lack 'mods' (ammunition reached through revolver camora slots). */
  nonModItemIds: string[];
  defaults: AppliedDefault[];
  omitted: OmittedBarter[];
  taskGated: TaskGatedOffer[];
}

export interface BridgeResult {
  fixture: ReferenceFixture;
  provenance: FixtureProvenance;
}

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

const codeUnitCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

class DefaultLog {
  private readonly byKey = new Map<string, AppliedDefault>();
  record(scope: DefaultScope, field: string, value: number, id: string): void {
    const key = `${scope}\u0000${field}`;
    const entry = this.byKey.get(key);
    if (entry) entry.ids.push(id);
    else this.byKey.set(key, { scope, field, value, ids: [id] });
  }
  list(): AppliedDefault[] {
    return [...this.byKey.values()]
      .map(entry => ({ ...entry, ids: [...entry.ids].sort(codeUnitCompare) }))
      .sort((a, b) => codeUnitCompare(`${a.scope}.${a.field}`, `${b.scope}.${b.field}`));
  }
}

function propNumber(props: Readonly<Record<string, unknown>> | null, key: string, subject: string): number | null {
  const value = props?.[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BridgeError(subject, `properties.${key} must be a finite number, got ${JSON.stringify(value)}`);
  }
  return value;
}

/** The raw weight as its binary64 value, after proving it is the nearest binary64 to its JSON token. */
function weightOf(item: RefItem): number | null {
  if (item.weight === null) return null;
  if (Number(item.weight.text) !== item.weight.value) {
    throw new BridgeError(item.id, `weight token "${item.weight.text}" does not decode to the stored value ${item.weight.value}`);
  }
  return item.weight.value;
}

function isMod(item: RefItem): boolean {
  return item.types.includes('mods');
}

function approxEqual(a: number, b: number, relative: number): boolean {
  return Math.abs(a - b) <= relative * Math.max(1, Math.abs(a), Math.abs(b));
}

/** Own category first, then ancestors up to the root, proven against the category tree. */
function categoryChain(world: RawWorld, item: RefItem): string[] {
  const chain = [...item.categoryIds];
  let expected: string | null = chain.length > 0 ? chain[0] : null;
  for (const id of chain) {
    if (id !== expected) throw new BridgeError(item.id, `category list is not the own-then-ancestors chain at ${id}`);
    const category = world.categories.get(id);
    if (!category) throw new BridgeError(item.id, `category ${id} is unresolved`);
    expected = category.parentId;
  }
  if (chain.length > 0 && expected !== null) {
    throw new BridgeError(item.id, `category chain stops at ${chain[chain.length - 1]} whose parent ${expected} is not listed`);
  }
  return chain;
}

function mapSlots(world: RawWorld, owner: RefItem): ReferenceSlot[] {
  return owner.slots.map((slot: RefSlot): ReferenceSlot => {
    const where = `${owner.id}/${slot.id}`;
    for (const [list, name] of [
      [slot.allowedCategoryIds, 'allowedCategories'],
      [slot.excludedItemIds, 'excludedItems'],
      [slot.excludedCategoryIds, 'excludedCategories'],
    ] as const) {
      if (list.length > 0) {
        throw new BridgeError(where, `slot filter ${name} is non-empty (${list.length} entries); the oracle schema only models allowedItems and refuses to drop it silently`);
      }
    }
    for (const allowed of slot.allowedItemIds) {
      if (!world.items.has(allowed)) throw new BridgeError(where, `allowed item ${allowed} is unresolved`);
    }
    return { id: slot.id, required: slot.required, allowedItemIds: [...slot.allowedItemIds] };
  });
}

interface StatFields {
  weightKg?: number;
  centerOfImpact?: number;
  magazineCapacity?: number;
  sightingRange?: number;
}

/**
 * Shared stat reads for a receiver or an item. `scope` only labels the default log. The modifier trio
 * (recoilModifier, accuracyModifier and the ergonomics cross-check) is handled by the callers.
 */
function commonStats(item: RefItem, scope: 'weapon' | 'item', defaults: DefaultLog): StatFields {
  const props = item.properties;
  const out: StatFields = {};
  const optional = (field: keyof StatFields, value: number | null): void => {
    if (value === null) defaults.record(scope, field, 0, item.id);
    else out[field] = value;
  };
  optional('weightKg', weightOf(item));
  optional('centerOfImpact', propNumber(props, 'centerOfImpact', item.id));
  optional('magazineCapacity', propNumber(props, 'capacity', item.id));
  optional('sightingRange', propNumber(props, 'sightingRange', item.id));
  return out;
}

function ergonomicsOf(item: RefItem): number | null {
  const top = item.ergonomicsModifier;
  const fromProps = propNumber(item.properties, 'ergonomics', item.id);
  if (top !== null && fromProps !== null && top !== fromProps) {
    throw new BridgeError(item.id, `ergonomicsModifier ${top} disagrees with properties.ergonomics ${fromProps}`);
  }
  if (top === null && fromProps !== null && isMod(item)) {
    throw new BridgeError(item.id, 'properties.ergonomics is present but ergonomicsModifier is absent');
  }
  return top ?? fromProps;
}

/** recoilModifier as a fraction: the raw properties.recoilModifier, proven equal to the top-level percent / 100. */
function recoilFractionOf(item: RefItem): number | null {
  if (!isMod(item)) return null; // ammunition carries an unrelated properties.recoilModifier
  const top = item.recoilModifier;
  const fraction = propNumber(item.properties, 'recoilModifier', item.id);
  if (top === null && fraction === null) return null;
  if (top === null || fraction === null) {
    throw new BridgeError(item.id, 'recoilModifier is present in only one of the item and its properties; cannot prove the unit');
  }
  if (!approxEqual(top / 100, fraction, 1e-12)) {
    throw new BridgeError(item.id, `top-level recoilModifier ${top} (percent) disagrees with properties.recoilModifier ${fraction} (fraction)`);
  }
  return fraction;
}

/** accuracyModifier in percent points: the raw top-level value, proven against properties.accuracyModifier (fraction). */
function accuracyPercentOf(item: RefItem): number | null {
  if (!isMod(item)) return null;
  const top = item.accuracyModifier;
  const fraction = propNumber(item.properties, 'accuracyModifier', item.id);
  if (top === null && fraction === null) return null;
  if (top === null || fraction === null) {
    throw new BridgeError(item.id, 'accuracyModifier is present in only one of the item and its properties; cannot prove the unit');
  }
  if (!approxEqual(top, fraction * 100, 1e-9)) {
    throw new BridgeError(item.id, `top-level accuracyModifier ${top} (percent points) disagrees with properties.accuracyModifier ${fraction} (fraction)`);
  }
  return top;
}

// ---------------------------------------------------------------------------------------------
// offers
// ---------------------------------------------------------------------------------------------

interface Context {
  readonly world: RawWorld;
  readonly options: { fractionalBarters: 'omit' | 'include'; weaponOfferKinds: OfferKind[] };
  readonly defaults: DefaultLog;
  readonly omitted: OmittedBarter[];
  readonly taskGated: TaskGatedOffer[];
}

const bartersCache = new WeakMap<RawWorld, ReadonlyMap<string, readonly RefBarter[]>>();

function bartersOffering(world: RawWorld, itemId: string): readonly RefBarter[] {
  let index = bartersCache.get(world);
  if (!index) {
    index = indexBartersByOfferedItem(world.barters);
    bartersCache.set(world, index);
  }
  return index.get(itemId) ?? [];
}

/** The trader key a request trader_levels map uses: the raw normalizedName, required to be canonical lower case. */
function traderKey(world: RawWorld, traderId: string, subject: string): string {
  const trader = world.traders.get(traderId);
  if (!trader) throw new BridgeError(subject, `trader ${traderId} is unresolved`);
  const key = trader.normalizedName;
  if (key === '' || key !== key.trim().toLowerCase()) {
    throw new BridgeError(subject, `trader ${traderId} has a non-canonical normalizedName ${JSON.stringify(key)}`);
  }
  return key;
}

function loyaltyLevel(value: number | null, subject: string, what: string): number {
  if (value === null || !Number.isInteger(value) || value < 1) {
    throw new BridgeError(subject, `${what} loyalty level must be an integer >= 1, got ${String(value)}`);
  }
  return value;
}

function traderOffersOf(ctx: Context, subject: RefItem): ReferenceTraderOffer[] {
  return subject.buyFromTrader.map((offer, index): ReferenceTraderOffer => {
    const where = `${subject.id}.buyFromTrader[${index}]`;
    const trader = traderKey(ctx.world, offer.traderId, where);
    const level = loyaltyLevel(offer.minTraderLevel, where, 'trader offer');
    // priceRUB is the RUB price whatever the offer currency (USD and EUR offers are converted upstream).
    if (offer.priceRUB === null) throw new BridgeError(where, 'trader offer has no priceRUB');
    if (offer.taskUnlock !== null) ctx.taskGated.push({ kind: 'trader', subjectId: subject.id, trader, level, taskUnlock: offer.taskUnlock });
    return { kind: 'trader', trader, level, price: offer.priceRUB };
  });
}

function fleaOffersOf(ctx: Context, subject: RefItem, scope: DefaultScope): ReferenceOffer[] {
  const flea = referenceFleaOffer(subject);
  if (!flea) return [];
  if (subject.minLevelForFlea === null) {
    ctx.defaults.record(scope, 'fleaMinPlayerLevel', 0, subject.id);
    return [{ kind: 'flea', price: flea.priceRUB }];
  }
  return [{ kind: 'flea', price: flea.priceRUB, minPlayerLevel: subject.minLevelForFlea }];
}

function barterOffersOf(ctx: Context, subject: RefItem): ReferenceBarterOffer[] {
  const out: ReferenceBarterOffer[] = [];
  for (const barter of bartersOffering(ctx.world, subject.id)) {
    const where = `barter ${barter.id}`;
    const trader = traderKey(ctx.world, barter.traderId, where);
    const level = loyaltyLevel(barter.minTraderLevel, where, 'barter');
    if (!Number.isInteger(barter.offered.count) || barter.offered.count < 1) {
      throw new BridgeError(where, `offered count must be a positive integer, got ${barter.offered.count}`);
    }
    if (ctx.options.fractionalBarters === 'omit' && barter.requirements.some(r => !Number.isInteger(r.count))) {
      ctx.omitted.push({
        kind: 'barter', barterId: barter.id, subjectId: subject.id,
        reason: 'fractional-ingredient-count', ingredientCounts: barter.requirements.map(r => r.count),
      });
      continue;
    }
    let requiresDogtag = false;
    const requirements = barter.requirements.map(requirement => {
      const ingredient = ctx.world.items.get(requirement.itemId);
      if (!ingredient) throw new BridgeError(where, `ingredient ${requirement.itemId} is unresolved`);
      if (/dogtag/i.test(ingredient.normalizedName)) requiresDogtag = true;
      const mapped: ReferenceBarterOffer['requirements'][number] = { itemId: requirement.itemId, count: requirement.count };
      if (ingredient.avg24hPrice !== null) mapped.avg24hPrice = ingredient.avg24hPrice;
      if (ingredient.basePrice !== null) mapped.basePrice = ingredient.basePrice;
      return mapped;
    });
    if (barter.taskUnlock !== null) ctx.taskGated.push({ kind: 'barter', subjectId: subject.id, trader, level, taskUnlock: barter.taskUnlock });
    const offer: ReferenceBarterOffer = { kind: 'barter', trader, level, requirements, offeredCount: barter.offered.count };
    if (requiresDogtag) offer.requiresDogtag = true;
    out.push(offer);
  }
  return out;
}

function offersOf(ctx: Context, subject: RefItem, kinds: readonly OfferKind[], scope: DefaultScope): ReferenceOffer[] {
  return [
    ...(kinds.includes('trader') ? traderOffersOf(ctx, subject) : []),
    ...(kinds.includes('flea') ? fleaOffersOf(ctx, subject, scope) : []),
    ...(kinds.includes('barter') ? barterOffersOf(ctx, subject) : []),
  ];
}

const ALL_KINDS: readonly OfferKind[] = ['trader', 'flea', 'barter'];

// ---------------------------------------------------------------------------------------------
// closure
// ---------------------------------------------------------------------------------------------

function reachableFrom(world: RawWorld, roots: Iterable<string>, skip: ReadonlySet<string>): Set<string> {
  const seen = new Set<string>();
  const queue: string[] = [];
  const visit = (id: string, via: string): void => {
    if (skip.has(id) || seen.has(id)) return;
    if (!world.items.has(id)) throw new BridgeError(via, `referenced item ${id} is unresolved`);
    seen.add(id);
    queue.push(id);
  };
  for (const id of roots) visit(id, 'closure root');
  for (let i = 0; i < queue.length; i++) {
    const owner = world.items.get(queue[i]) as RefItem;
    for (const slot of owner.slots) for (const allowed of slot.allowedItemIds) visit(allowed, `${owner.id}/${slot.id}`);
  }
  return seen;
}

// ---------------------------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------------------------

export function fixtureForWeapon(world: RawWorld, weaponId: string, options: FixtureOptions = {}): BridgeResult {
  const resolvedOptions = {
    fractionalBarters: options.fractionalBarters ?? 'omit',
    weaponOfferKinds: [...(options.weaponOfferKinds ?? (['trader'] as const))],
  };
  const gun = world.items.get(weaponId);
  if (!gun) throw new BridgeError(weaponId, 'weapon id is not an item of the raw world');
  if (!gun.types.includes('gun')) throw new BridgeError(weaponId, `item is not a gun (types: ${gun.types.join(',')})`);
  if (gun.properties === null) throw new BridgeError(weaponId, 'gun has no properties object');

  const defaults = new DefaultLog();
  const ctx: Context = { world, options: resolvedOptions, defaults, omitted: [], taskGated: [] };

  const installable = reachableFrom(world, gun.slots.flatMap(slot => slot.allowedItemIds), new Set());
  if (installable.has(weaponId)) {
    throw new BridgeError(weaponId, 'a slot allowlist reaches the receiver itself; the oracle schema cannot express a receiver installed as an item');
  }

  // Presets: count-bearing supply. Components outside the installable closure (ammunition) cannot be
  // installed anywhere, but checkFixture requires every component to be a known item, so they join the
  // fixture as inert supply-only items together with whatever their own slots reach.
  const presetSubjects = gun.presetIds.map(id => {
    const preset = world.items.get(id);
    if (!preset) throw new BridgeError(weaponId, `preset ${id} is unresolved`);
    return preset;
  });
  if (new Set(gun.presetIds).size !== gun.presetIds.length) throw new BridgeError(weaponId, 'preset list repeats an id');
  const presets = presetSubjects.map(preset => mapPreset(ctx, gun, preset)); // validates every component first
  const supplyRoots = presets.flatMap(preset => preset.components.map(c => c.itemId));
  const skip = new Set<string>([...installable, weaponId]);
  const supplyOnly = reachableFrom(world, supplyRoots.filter(id => !skip.has(id)), skip);

  const itemIds = [...installable, ...supplyOnly].sort(codeUnitCompare);
  const items = itemIds.map(id => mapItem(ctx, world.items.get(id) as RefItem));

  const weapon = mapWeapon(ctx, gun);
  const slotCount = weapon.slots?.length ?? 0;

  const fixture: ReferenceFixture = {
    schemaVersion: 1,
    description: `Bridge fixture for ${gun.normalizedName} (${gun.id}): full reachable closure of the pinned raw capture`,
    items,
    weapons: [weapon],
    presets,
  };
  const provenance: FixtureProvenance = {
    weaponId,
    weaponName: gun.normalizedName,
    lang: world.lang,
    options: resolvedOptions,
    closure: {
      items: items.length,
      slots: slotCount + items.reduce((n, item) => n + (item.slots?.length ?? 0), 0),
      presets: presets.length,
      presetComponentEntries: presets.reduce((n, preset) => n + preset.components.length, 0),
    },
    supplyOnlyItemIds: [...supplyOnly].sort(codeUnitCompare),
    nonModItemIds: [...installable].filter(id => !isMod(world.items.get(id) as RefItem)).sort(codeUnitCompare),
    defaults: defaults.list(),
    omitted: ctx.omitted,
    taskGated: ctx.taskGated,
  };
  return { fixture, provenance };
}

function mapPreset(ctx: Context, gun: RefItem, preset: RefItem): ReferencePreset {
  const { world } = ctx;
  if (!preset.types.includes('preset')) {
    throw new BridgeError(preset.id, `listed as a preset of ${gun.id} but its types are ${preset.types.join(',')}`);
  }
  const baseItem = preset.properties?.baseItem;
  if (baseItem !== undefined && baseItem !== gun.id) {
    throw new BridgeError(preset.id, `properties.baseItem is ${JSON.stringify(baseItem)} but the gun listing it is ${gun.id}`);
  }
  const components = preset.components.map(component => {
    const item = world.items.get(component.itemId);
    if (!item) throw new BridgeError(preset.id, `component ${component.itemId} is unresolved`);
    if (item.types.includes('gun') && item.id !== gun.id) {
      throw new BridgeError(preset.id, `component ${item.id} is a gun other than the receiver ${gun.id}`);
    }
    return { itemId: component.itemId, count: component.count };
  });
  return { id: preset.id, weaponId: gun.id, components, offers: offersOf(ctx, preset, ALL_KINDS, 'preset') };
}

function mapItem(ctx: Context, item: RefItem): ReferenceItem {
  const { world, defaults } = ctx;
  if (!isMod(item)) {
    for (const [field, value] of [
      ['ergonomicsModifier', item.ergonomicsModifier], ['recoilModifier', item.recoilModifier], ['accuracyModifier', item.accuracyModifier],
    ] as const) {
      if (value !== null) {
        throw new BridgeError(item.id, `non-mod item (types ${item.types.join(',')}) carries ${field} ${value}; no rule maps it to a mod stat`);
      }
    }
  }
  const out: ReferenceItem = { id: item.id, categories: categoryChain(world, item) };
  const stats = commonStats(item, 'item', defaults);
  const ergonomics = ergonomicsOf(item);
  const recoil = recoilFractionOf(item);
  const accuracy = accuracyPercentOf(item);
  if (stats.weightKg !== undefined) out.weightKg = stats.weightKg;
  if (ergonomics === null) defaults.record('item', 'ergonomics', 0, item.id);
  else out.ergonomics = ergonomics;
  if (recoil === null) defaults.record('item', 'recoilModifier', 0, item.id);
  else out.recoilModifier = recoil;
  if (accuracy === null) defaults.record('item', 'accuracyModifier', 0, item.id);
  else out.accuracyModifier = accuracy;
  if (stats.centerOfImpact !== undefined) out.centerOfImpact = stats.centerOfImpact;
  if (stats.magazineCapacity !== undefined) out.magazineCapacity = stats.magazineCapacity;
  if (stats.sightingRange !== undefined) out.sightingRange = stats.sightingRange;
  out.slots = mapSlots(world, item);
  out.conflictingItemIds = [...item.conflictingItemIds];
  out.conflictingSlotIds = [...item.conflictingSlotIds];
  out.offers = offersOf(ctx, item, ALL_KINDS, 'item');
  return out;
}

function mapWeapon(ctx: Context, gun: RefItem): ReferenceWeapon {
  const { world, defaults } = ctx;
  const props = gun.properties;
  for (const [field, value] of [['accuracyModifier', gun.accuracyModifier], ['recoilModifier', gun.recoilModifier]] as const) {
    if (value !== null && value !== 0) {
      throw new BridgeError(gun.id, `gun carries a non-zero ${field} (${value}); the oracle's receiver has no such field`);
    }
  }
  const out: ReferenceWeapon = { id: gun.id, categories: categoryChain(world, gun) };
  const stats = commonStats(gun, 'weapon', defaults);
  const ergonomics = ergonomicsOf(gun);
  const vertical = propNumber(props, 'recoilVertical', gun.id);
  const horizontal = propNumber(props, 'recoilHorizontal', gun.id);
  if (stats.weightKg !== undefined) out.weightKg = stats.weightKg;
  if (ergonomics === null) defaults.record('weapon', 'ergonomics', 0, gun.id);
  else out.ergonomics = ergonomics;
  if (vertical === null) defaults.record('weapon', 'recoilVertical', 0, gun.id);
  else out.recoilVertical = vertical;
  if (horizontal === null) defaults.record('weapon', 'recoilHorizontal', 0, gun.id);
  else out.recoilHorizontal = horizontal;
  if (stats.centerOfImpact !== undefined) out.centerOfImpact = stats.centerOfImpact;
  if (stats.sightingRange !== undefined) out.sightingRange = stats.sightingRange;
  if (stats.magazineCapacity !== undefined) out.magazineCapacity = stats.magazineCapacity;
  out.slots = mapSlots(world, gun);
  out.conflictingItemIds = [...gun.conflictingItemIds];
  out.offers = offersOf(ctx, gun, ctx.options.weaponOfferKinds, 'weapon');
  return out;
}
