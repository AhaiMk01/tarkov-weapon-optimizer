// Differential helper for the production occurrence-level validator (Stage 2, phase 2.4b-3a).
//
// For a ledger case it maps the reference fixture and request into the production lookup and request (`toProduction.differential.ts`,
// `blueprint.differential.ts`) and compares the production verdict `validatePhysicalBuild` with the reference verdict `inspectBuild` on the
// SAME build: accept or reject, the set of violation codes and, when both compute them, every exact statistic as a canonical rational string.
// It also generates the deterministic invalid mutations of a build (the second family of the differential), which are plain data so the test
// can count them per operator.
//
// Representation mapping (documented here instead of weakening a check):
//
//  * Category chains. The mapped production lookup carries only the own `category_id`; the nested `data.bsgCategory` chain the blueprint and the
//    validator read is rebuilt from the fixture's `categories` (own first, then ancestors) with `productionLookup` (blueprint.differential.ts).
//  * Barter prices. The mapper prices a barter with `Math.round` of a float sum, the reference rounds the exact total of the decoded binary64
//    leaves (INTERPRETATIONS.md choice 3); they differ by 1 RUB at an exact .5 boundary (one ledger case). That is a mapper defect Stage 2
//    numerics repairs, not a validator difference, so the prices of the mapped barters are overwritten with the reference's exact lot price
//    (`withExactBarterPrices`) before the validator runs; the number of offers changed is reported.
//  * Offer order. The mapper sorts each offer list by price, the reference keeps the source order. Verdicts, spend and the per-occurrence
//    SOURCE agree whatever the order; which of two equally cheap lot mixes covers a deficit, and so which occurrence is charged the lot price,
//    can depend on it, so per-occurrence charges are compared by their sum (the spend), not one by one.
//  * Preset components. The extractors carry a preset's receiver entry as `receiver_id` (base identity), never as stock, so the mapped preset does
//    not supply the receiver as a part. The reference does supply it (a component with the receiver id), which only matters to a build that
//    installs the receiver template as an item; the `receiver-as-item` mutation is therefore not generated for a case whose presets list the receiver.
//  * Features the production inputs cannot carry (a flea gate per base or per offer, non-canonical trader names, a receiver magazine capacity)
//    make a case "skipped", recorded and never silently dropped (`VALIDATOR_UNSUPPORTED`).
//
// Differential helper: may import production code (reference/independenceScan.ts); no non-differential file may import this one.

import type { LedgerCase } from '../ledger/index';
import {
  add as addQ, barterRequirementTotal, enumerateBuilds, gt, inspectBuild, resolveFixture, resolveRequest, roundHalfUp, ROOT_INSTANCE_ID, toNumber,
  toString, ZERO,
  type BaseChoice, type BuildStats, type Placement, type ReferenceBuild, type ReferenceFixture, type ReferenceItem, type ReferenceRequest, type ReferenceSlot,
  type ResolvedFixture, type ResolvedOffer,
} from '../oracle/index';
import {
  preparePhysicalValidator, PRODUCTION_ONLY_VIOLATION_CODES,
  type PhysicalBuild, type PhysicalValidation, type PhysicalValidationRequest, type PhysicalValidator, type PhysicalViolationCode,
} from '../../src/solver/physical';
import { nextDown, nextUp } from '../../src/solver/physical/numeric';
import type { ItemLookup, OfferInfo } from '../../src/solver/types';
import { productionLookup } from './blueprint.differential';
import { detectUnsupported, mapRequest } from './toProduction.differential';

// ---------------------------------------------------------------------------------------------
// Case preparation
// ---------------------------------------------------------------------------------------------

/** The unsupported features of `toProduction.differential.ts` that change a verdict or a statistic of the validator. */
export const VALIDATOR_UNSUPPORTED = [
  'flea_player_level_on_base',
  'flea_offers_distinct_player_levels',
  'non_canonical_trader_name',
  'weapon_magazine_capacity',
] as const;

export function validatorUnsupported(fixture: ReferenceFixture, request: ReferenceRequest): string[] {
  return detectUnsupported(fixture, request)
    .filter(f => (VALIDATOR_UNSUPPORTED as readonly string[]).includes(f.feature))
    .map(f => `${f.feature}: ${f.detail}`);
}

function patchBarterPrices(offers: OfferInfo[], resolved: readonly ResolvedOffer[]): number {
  const references = resolved
    .filter((o): o is Extract<ResolvedOffer, { kind: 'barter' }> => o.kind === 'barter')
    .map(o => ({ offer: o, total: barterRequirementTotal(o) }))
    .filter(r => gt(r.total, ZERO));
  const used = new Set<number>();
  let changed = 0;
  for (const offer of offers) {
    if (!offer.source.startsWith('barter:')) continue;
    const requirements = JSON.stringify((offer.barter_requirements ?? []).map(r => [r.count, r.unit_price]));
    const k = references.findIndex((r, i) => !used.has(i)
      && r.offer.trader === offer.vendor_normalized
      && r.offer.level === offer.trader_level
      && JSON.stringify(r.offer.requirements.map(q => [toNumber(q.count), toNumber(q.avg24hPrice ?? q.basePrice ?? ZERO)])) === requirements);
    if (k < 0) throw new Error(`no reference barter matches the mapped offer ${offer.source} level ${String(offer.trader_level)}`);
    used.add(k);
    const exact = toNumber(roundHalfUp(references[k].total));
    if (exact !== offer.price) {
      offer.price = exact;
      changed++;
    }
  }
  return changed;
}

/** Overwrite the mapped barter lot prices with the reference's exact rounding. Returns how many prices changed. */
export function withExactBarterPrices(lookup: ItemLookup, fixture: ReferenceFixture): number {
  const resolved: ResolvedFixture = resolveFixture(fixture);
  let changed = 0;
  for (const item of fixture.items) {
    const entry = lookup[item.id];
    if (entry.type === 'mod') changed += patchBarterPrices(entry.stats.offers, resolved.items.get(item.id)!.offers);
  }
  for (const weapon of fixture.weapons) {
    const entry = lookup[weapon.id];
    if (entry.type !== 'gun') continue;
    changed += patchBarterPrices(entry.stats.offers, resolved.weapons.get(weapon.id)!.offers);
    for (const preset of entry.all_presets) changed += patchBarterPrices(preset.offers, resolved.presets.get(preset.id)!.offers);
  }
  return changed;
}

export interface ValidatorCase {
  id: string;
  family: number;
  fixture: ReferenceFixture;
  request: ReferenceRequest;
  /** Features the production inputs cannot carry; a case that lists any is not compared. */
  skipped: string[];
  lookup: ItemLookup;
  /** Barter prices overwritten with the exact rounding. */
  barterPricesPatched: number;
}

export function prepareValidatorCase(c: LedgerCase): ValidatorCase {
  const skipped = validatorUnsupported(c.fixture, c.request);
  if (skipped.length > 0) return { id: c.id, family: c.family, fixture: c.fixture, request: c.request, skipped, lookup: {}, barterPricesPatched: 0 };
  const lookup = productionLookup(c.fixture);
  return { id: c.id, family: c.family, fixture: c.fixture, request: c.request, skipped, lookup, barterPricesPatched: withExactBarterPrices(lookup, c.fixture) };
}

/** The production request of a reference request: the same fields under their `SolveParams` names. */
export function productionRequestOf(request: ReferenceRequest): PhysicalValidationRequest {
  return { ...mapRequest(request), weaponId: request.weapon_id };
}

export function toPhysicalBuild(build: ReferenceBuild): PhysicalBuild {
  return {
    base: build.base.kind === 'naked' ? { kind: 'naked' } : { kind: 'preset', presetId: build.base.presetId },
    placements: build.placements.map(p => ({ ...p })),
    ...(build.rootInstanceId === undefined ? {} : { rootInstanceId: build.rootInstanceId }),
  };
}

// ---------------------------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------------------------

export interface Verdict {
  ok: boolean;
  /** Distinct violation codes, sorted. */
  codes: string[];
  /** Exact statistics as canonical rational strings; null when an installed item is unknown. */
  stats: Record<string, string> | null;
  /** Source of every installed occurrence in instanceId code-unit order, and the sum of the charges. */
  sources: string[] | null;
}

const distinctCodes = (violations: readonly { code: string }[]): string[] => [...new Set(violations.map(v => v.code))].sort();

const STAT_NAMES = [
  'rawErgonomics', 'ergonomics', 'effectiveErgonomics', 'recoilModifierSum', 'recoilVertical', 'recoilHorizontal', 'weight', 'weightPenalty', 'ted',
  'overswingPercent', 'accuracyModifierSum', 'effectiveCenterOfImpact', 'moa', 'magazineCapacity', 'sightingRange', 'spend',
] as const;

export function referenceVerdict(fixture: ResolvedFixture, request: ReturnType<typeof resolveRequest>, build: ReferenceBuild): Verdict {
  const { violations, stats } = inspectBuild(fixture, request, build);
  return { ok: violations.length === 0, codes: distinctCodes(violations), stats: stats ? referenceStats(stats) : null, sources: stats ? referenceSources(stats) : null };
}

function referenceStats(stats: BuildStats): Record<string, string> {
  return Object.fromEntries(STAT_NAMES.map(name => [name, toString(stats[name])]));
}

function referenceSources(stats: BuildStats): string[] {
  return stats.acquisition.occurrences.map(o => o.source.kind);
}

export function productionVerdict(result: PhysicalValidation): Verdict {
  const stats = result.stats;
  return {
    ok: result.violations.length === 0,
    codes: distinctCodes(result.violations),
    stats: stats ? Object.fromEntries(STAT_NAMES.map(name => [name, stats.exact[name]])) : null,
    sources: stats ? stats.acquisition.occurrences.map(o => o.source) : null,
  };
}

const PRODUCTION_ONLY: readonly string[] = PRODUCTION_ONLY_VIOLATION_CODES;

/**
 * Null when the production verdict is the reference verdict: same accept/reject, same code set (production-only codes in `expectedExtra`
 * are required and removed first), same exact statistics and the same per-occurrence sources. Otherwise a one-line description.
 */
export function compareVerdicts(reference: Verdict, production: Verdict, expectedExtra: readonly PhysicalViolationCode[] = []): string | null {
  const extra = production.codes.filter(c => PRODUCTION_ONLY.includes(c));
  const missingExtra = expectedExtra.filter(c => !extra.includes(c));
  const unexpectedExtra = extra.filter(c => !expectedExtra.includes(c as PhysicalViolationCode));
  if (missingExtra.length > 0) return `production did not report the expected ${missingExtra.join(',')}`;
  if (unexpectedExtra.length > 0) return `production reported the production-only ${unexpectedExtra.join(',')}`;
  const shared = production.codes.filter(c => !PRODUCTION_ONLY.includes(c));
  if (JSON.stringify(shared) !== JSON.stringify(reference.codes)) return `codes: reference [${reference.codes.join(',')}] production [${shared.join(',')}]`;
  const accepted = reference.ok && expectedExtra.length === 0;
  if (production.ok !== accepted) return `verdict: reference ${reference.ok ? 'accepts' : 'rejects'}, production ${production.ok ? 'accepts' : 'rejects'}`;
  if ((reference.stats === null) !== (production.stats === null)) return `statistics: reference ${reference.stats ? 'computed' : 'null'}, production ${production.stats ? 'computed' : 'null'}`;
  if (reference.stats && production.stats) {
    for (const name of STAT_NAMES) {
      if (reference.stats[name] !== production.stats[name]) return `${name}: reference ${reference.stats[name]}, production ${production.stats[name]}`;
    }
  }
  if (JSON.stringify(reference.sources) !== JSON.stringify(production.sources)) return `sources: reference ${JSON.stringify(reference.sources)}, production ${JSON.stringify(production.sources)}`;
  return null;
}

/** Both sides for one (case, request): the reference resolved once, the production validator prepared once. */
export interface Judge {
  reference(build: ReferenceBuild): Verdict;
  production(build: ReferenceBuild, claimedSpend?: number): PhysicalValidation;
  /** The exact reference statistics of a build (null when an item is unknown). */
  stats(build: ReferenceBuild): BuildStats | null;
}

export function judgeFor(c: ValidatorCase, request: ReferenceRequest): Judge {
  const fixture = resolveFixture(c.fixture);
  const resolvedRequest = resolveRequest(c.fixture, request);
  const validator: PhysicalValidator = preparePhysicalValidator(c.lookup, productionRequestOf(request));
  return {
    reference: build => referenceVerdict(fixture, resolvedRequest, build),
    production: (build, claimedSpend) => {
      const physical = toPhysicalBuild(build);
      return validator.validate(claimedSpend === undefined ? physical : { ...physical, claimed: { spend: claimedSpend } });
    },
    stats: build => inspectBuild(fixture, resolvedRequest, build).stats,
  };
}

// ---------------------------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------------------------

/** Every (base, tree) build the oracle enumerates for the case request, including those its own validator rejects for caps or availability. */
export function enumeratedBuilds(c: ValidatorCase): { builds: ReferenceBuild[]; complete: boolean } {
  const enumeration = enumerateBuilds(c.fixture, c.request);
  return { builds: enumeration.builds, complete: enumeration.complete };
}

/** `count` items spread evenly over `items` (all of them when there are no more than `count`). */
export function spread<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  const out: T[] = [];
  for (let k = 0; k < count; k++) out.push(items[Math.floor((k * items.length) / count)]);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------------------------

export type BuildMutationKind =
  | 'drop-leaf' | 'drop-inner' | 'duplicate-instance' | 'reparent-missing' | 'reparent-cycle' | 'child-takes-root-id' | 'add-legal' | 'add-anywhere'
  | 'swap-item' | 'unknown-item' | 'unknown-slot' | 'receiver-as-item' | 'swap-base' | 'claim-spend-right' | 'claim-spend-wrong';

export type RequestMutationKind = 'cap-boundary' | 'overswing' | 'market' | 'owned' | 'filter';

export interface BuildMutation {
  kind: BuildMutationKind;
  build: ReferenceBuild;
  /** Set for `claim-spend-*`: the claimed spend to attach to the production build. */
  claimedSpend?: number;
}

export interface RequestMutation {
  kind: RequestMutationKind;
  label: string;
  request: ReferenceRequest;
}

const ROOT = ROOT_INSTANCE_ID;
const instanceIdOf = (parent: string, slotId: string, itemId: string): string => `${parent}/${slotId}:${itemId}`;
const withPlacements = (build: ReferenceBuild, placements: Placement[]): ReferenceBuild => ({ ...build, placements });

function slotsOf(fixture: ReferenceFixture, weaponId: string, itemId: string): readonly ReferenceSlot[] {
  if (itemId === weaponId) return fixture.weapons.find(w => w.id === weaponId)?.slots ?? [];
  return fixture.items.find(i => i.id === itemId)?.slots ?? [];
}

/** The deterministic invalid (and near-valid) mutations of one build. Every operator is capped so a case contributes a bounded number. */
export function buildMutations(c: ValidatorCase, seed: ReferenceBuild, exactSpend: number | null): BuildMutation[] {
  const out: BuildMutation[] = [];
  const add = (kind: BuildMutationKind, build: ReferenceBuild, claimedSpend?: number) => out.push(claimedSpend === undefined ? { kind, build } : { kind, build, claimedSpend });
  const ps = seed.placements;
  const weaponId = c.request.weapon_id;
  const hasChild = (id: string) => ps.some(p => p.parentInstanceId === id);

  // 1 and 2: drop a placement. A leaf leaves a possibly required slot empty; an inner node orphans its subtree.
  spread(ps.filter(p => !hasChild(p.childInstanceId)), 6).forEach(p => add('drop-leaf', withPlacements(seed, ps.filter(q => q !== p))));
  spread(ps.filter(p => hasChild(p.childInstanceId)), 4).forEach(p => add('drop-inner', withPlacements(seed, ps.filter(q => q !== p))));

  // 3: a second record with the same instance id (same slot, then a different slot id).
  spread(ps, 4).forEach(p => {
    add('duplicate-instance', withPlacements(seed, [...ps, { ...p }]));
    add('duplicate-instance', withPlacements(seed, [...ps, { ...p, slotId: 'ghost-slot' }]));
  });

  // 4 and 5: a parent that has no record; a cycle (a placement hangs on its own descendant).
  spread(ps, 4).forEach(p => add('reparent-missing', withPlacements(seed, ps.map(q => (q === p ? { ...q, parentInstanceId: 'ghost-parent' } : q)))));
  spread(ps.filter(p => p.parentInstanceId !== ROOT), 3).forEach(p => {
    const parent = ps.find(q => q.childInstanceId === p.parentInstanceId);
    if (parent) add('reparent-cycle', withPlacements(seed, ps.map(q => (q === parent ? { ...q, parentInstanceId: p.childInstanceId } : q))));
  });

  // 6: a child that claims the receiver id.
  spread(ps, 2).forEach(p => add('child-takes-root-id', withPlacements(seed, ps.map(q => (q === p ? { ...q, childInstanceId: ROOT } : q)))));

  // 7: one more placement. `add-legal` fills a free physical slot of an installed parent with an item that slot allows (valid shape, so conflicts,
  // caps, copies and supply decide); `add-anywhere` puts any item of the fixture under the receiver, in a slot that may be full, wrong or absent.
  const owners: { instanceId: string; itemId: string }[] = [{ instanceId: ROOT, itemId: weaponId }, ...ps.map(p => ({ instanceId: p.childInstanceId, itemId: p.itemId }))];
  const taken = new Set(ps.map(p => JSON.stringify([p.parentInstanceId, p.slotId])));
  const additions: Placement[] = [];
  for (const owner of owners) {
    for (const slot of slotsOf(c.fixture, weaponId, owner.itemId)) {
      if (taken.has(JSON.stringify([owner.instanceId, slot.id]))) continue;
      for (const itemId of new Set(slot.allowedItemIds)) {
        additions.push({ parentInstanceId: owner.instanceId, slotId: slot.id, childInstanceId: instanceIdOf(owner.instanceId, slot.id, itemId), itemId });
      }
    }
  }
  spread(additions, 14).forEach(p => add('add-legal', withPlacements(seed, [...ps, p])));
  const rootSlots = slotsOf(c.fixture, weaponId, weaponId);
  spread(c.fixture.items, 10).forEach((item: ReferenceItem) => {
    const slotId = rootSlots.find(s => s.allowedItemIds.includes(item.id))?.id ?? rootSlots[0]?.id ?? 'ghost-slot';
    add('add-anywhere', withPlacements(seed, [...ps, { parentInstanceId: ROOT, slotId, childInstanceId: instanceIdOf(ROOT, slotId, item.id), itemId: item.id }]));
  });

  // 8 to 11: change what a placement is.
  const itemIds = c.fixture.items.map(i => i.id);
  const receiverIsStock = (c.fixture.presets ?? []).some(preset => preset.components.some(component => component.itemId === weaponId));
  spread(ps, 4).forEach((p, k) => {
    const other = itemIds.find(id => id !== p.itemId) ?? p.itemId;
    add('swap-item', withPlacements(seed, ps.map(q => (q === p ? { ...q, itemId: other } : q))));
    add('swap-item', withPlacements(seed, ps.map(q => (q === p ? { ...q, itemId: itemIds[(k + 1) % itemIds.length] } : q))));
    add('unknown-item', withPlacements(seed, ps.map(q => (q === p ? { ...q, itemId: 'ghost-item' } : q))));
    add('unknown-slot', withPlacements(seed, ps.map(q => (q === p ? { ...q, slotId: 'ghost-slot' } : q))));
    if (!receiverIsStock) add('receiver-as-item', withPlacements(seed, ps.map(q => (q === p ? { ...q, itemId: weaponId } : q))));
  });

  // 12: swap the base to every other base: the naked receiver, each preset, a preset that does not exist.
  const bases: BaseChoice[] = [{ kind: 'naked' }, ...(c.fixture.presets ?? []).map((p): BaseChoice => ({ kind: 'preset', presetId: p.id })), { kind: 'preset', presetId: 'ghost-preset' }];
  for (const base of bases) add('swap-base', { ...seed, base });

  // 13: a claimed spend, right and wrong (production-only codes; the physical verdict is unchanged).
  if (exactSpend !== null && Number.isFinite(exactSpend)) {
    add('claim-spend-right', seed, exactSpend);
    add('claim-spend-wrong', seed, exactSpend + 1);
    add('claim-spend-wrong', seed, nextUp(exactSpend + 1e-3));
  }
  return out;
}

export function requestMutations(c: ValidatorCase, stats: BuildStats | null): RequestMutation[] {
  const out: RequestMutation[] = [];
  const base = c.request;
  const add = (kind: RequestMutationKind, label: string, patch: Partial<ReferenceRequest>) => out.push({ kind, label, request: { ...base, ...patch } });

  if (stats) {
    const caps: { field: 'max_price' | 'min_ergonomics' | 'max_recoil_v' | 'max_recoil_sum' | 'min_mag_capacity' | 'min_sighting_range' | 'max_weight' | 'max_moa'; value: number }[] = [
      { field: 'max_price', value: toNumber(stats.spend) },
      { field: 'min_ergonomics', value: toNumber(stats.ergonomics) },
      { field: 'max_recoil_v', value: toNumber(stats.recoilVertical) },
      { field: 'max_recoil_sum', value: toNumber(addQ(stats.recoilVertical, stats.recoilHorizontal)) },
      { field: 'min_mag_capacity', value: toNumber(stats.magazineCapacity) },
      { field: 'min_sighting_range', value: toNumber(stats.sightingRange) },
      { field: 'max_weight', value: toNumber(stats.weight) },
      { field: 'max_moa', value: toNumber(stats.moa) },
    ];
    for (const { field, value } of caps) {
      add('cap-boundary', `${field}=${value}`, { [field]: value });
      add('cap-boundary', `${field}=nextUp`, { [field]: nextUp(value) });
      add('cap-boundary', `${field}=nextDown`, { [field]: nextDown(value) });
      add('cap-boundary', `${field}=+1`, { [field]: value + 1 });
      add('cap-boundary', `${field}=-1`, { [field]: value - 1 });
    }
  }
  add('overswing', 'prevent_overswing', { prevent_overswing: true });
  add('overswing', 'prevent_overswing+gear', { prevent_overswing: true, equip_ergo_modifier: -0.5 });
  add('overswing', 'gear-0.25', { equip_ergo_modifier: -0.25 });

  const traders = new Set<string>();
  const collect = (offers: ReferenceFixture['items'][number]['offers']) => offers?.forEach(o => { if (o.kind !== 'flea') traders.add(o.trader); });
  c.fixture.items.forEach(i => collect(i.offers));
  c.fixture.weapons.forEach(w => collect(w.offers));
  (c.fixture.presets ?? []).forEach(p => collect(p.offers));
  const levels = (level: number): Record<string, number> => Object.fromEntries([...traders].map(t => [t, level]));
  add('market', 'flea off', { flea_available: false });
  add('market', 'flea on', { flea_available: true });
  add('market', 'barter on', { barter_available: true });
  add('market', 'barter off', { barter_available: false });
  add('market', 'barter on, dogtags excluded', { barter_available: true, barter_exclude_dogtags: true });
  add('market', 'traders disabled', { trader_levels: levels(0) });
  add('market', 'traders level 1', { trader_levels: levels(1) });
  add('market', 'traders level 2', { trader_levels: levels(2) });
  add('market', 'traders level 4', { trader_levels: levels(4) });
  add('market', 'player level 1', { player_level: 1 });
  add('market', 'player level 100', { player_level: 100 });
  add('market', 'closed market', { flea_available: false, trader_levels: levels(0) });

  const itemIds = c.fixture.items.map(i => i.id);
  add('owned', 'owned none', { owned_items: [] });
  add('owned', 'owned once each', { owned_items: itemIds });
  add('owned', 'owned twice each', { owned_items: [...itemIds, ...itemIds] });
  add('owned', 'owned the receiver and presets', { owned_items: [c.request.weapon_id, ...(c.fixture.presets ?? []).map(p => p.id)] });
  spread(itemIds, 4).forEach(id => add('owned', `owned ${id} x3`, { owned_items: [id, id, id] }));

  spread(itemIds, 4).forEach(id => {
    add('filter', `exclude ${id}`, { exclude_items: [...(base.exclude_items ?? []), id] });
    add('filter', `include ${id}`, { include_items: [...(base.include_items ?? []), id] });
  });
  const categories = [...new Set(c.fixture.items.flatMap(i => i.categories ?? []))];
  spread(categories, 3).forEach(cat => {
    add('filter', `exclude category ${cat}`, { exclude_categories: [...(base.exclude_categories ?? []), cat] });
    add('filter', `include category ${cat}`, { include_categories: [...(base.include_categories ?? []), [cat]] });
  });
  return out;
}
