import assert from 'node:assert/strict';
import { assessCandidatePruning } from './benchmarks/experiments/candidatePrune.ts';
import { buildCompatibilityMap } from './src/solver/compatibilityMap.ts';
import { getAvailablePrice } from './src/solver/dataService.ts';
import { buildLP } from './src/solver/lpBuilder.ts';
import { solve } from './src/solver/solver.ts';
import { presetSupply } from './src/solver/presetSupply.ts';
import type { GunLookupEntry, ItemLookup, ModLookupEntry, OfferInfo, PresetInfo, SolveParams, SlotInfo } from './src/solver/types.ts';

const offer = (price: number): OfferInfo[] => [{
  price, source: 'mechanic', vendor_name: 'Mechanic', vendor_normalized: 'mechanic', trader_level: 1,
}];

interface SlotSpec { id: string; required?: boolean; allows: string[]; nameId?: string }
interface ModSpec {
  id: string;
  slots?: SlotSpec[];
  conflicts?: string[];
  slotConflicts?: string[];
  purchasable?: boolean;
  offers?: OfferInfo[];
  price?: number;
  ergo?: number;
  recoil?: number;
  weight?: number;
  capacity?: number;
  sighting?: number;
  accuracy?: number;
  coi?: number;
  category?: string;
  handbook?: string[];
}

function slot(spec: SlotSpec): SlotInfo {
  return {
    id: spec.id,
    name: spec.id,
    nameId: spec.nameId ?? spec.id,
    required: spec.required ?? false,
    allowedItems: spec.allows,
  };
}

function graph(input: {
  slots: SlotSpec[];
  mods: ModSpec[];
  /** `items` are the ids the preset supplies, one copy each. */
  presets?: { id: string; items: string[]; price?: number }[];
  includeItems?: string[];
  excludeItems?: string[];
}): SolveParams {
  const presets: PresetInfo[] = (input.presets ?? []).map(preset => ({
    id: preset.id,
    name: preset.id,
    receiver_id: 'gun',
    items: preset.items.map(itemId => ({ itemId, count: 1 })),
    image: null,
    price: preset.price ?? 500,
    price_source: 'mechanic',
    offers: offer(preset.price ?? 500),
    purchasable: true,
  }));
  const gun: GunLookupEntry = {
    type: 'gun', data: { name: 'Fixture receiver' }, presets, all_presets: presets,
    slots: input.slots.map(slot),
    stats: {
      naked_ergonomics: 0, naked_recoil_v: 100, naked_recoil_h: 100,
      default_ergonomics: 0, default_recoil_v: 100, default_recoil_h: 100, default_preset_image: null,
      accuracy_modifier: 0, fire_rate: 600, fire_modes: [], caliber: '', weight: 1,
      width: 1, height: 1, sighting_range: 0, category: 'gun', category_id: 'gun',
      camera_snap: 0, center_of_impact: 1, deviation_max: 0, deviation_curve: 0,
      recoil_angle: 0, recoil_dispersion: 0, offers: offer(1000), price: 1000, price_source: 'mechanic',
    },
  };
  const itemLookup: ItemLookup = { gun };
  for (const mod of input.mods) {
    const entry: ModLookupEntry = {
      type: 'mod', data: { name: mod.id }, slots: (mod.slots ?? []).map(slot),
      conflicting_items: mod.conflicts ?? [], conflicting_slot_ids: mod.slotConflicts ?? [],
      stats: {
        ergonomics: mod.ergo ?? 0,
        recoil_modifier: mod.recoil ?? 0,
        accuracy_modifier: mod.accuracy ?? 0,
        center_of_impact: mod.coi ?? 0,
        offers: mod.offers ?? (mod.purchasable === false ? [] : offer(mod.price ?? 100)),
        purchasable: mod.purchasable !== false,
        price: mod.price ?? (mod.purchasable === false ? 0 : 100),
        price_source: 'mechanic',
        weight: mod.weight ?? 0.1,
        width: 1, height: 1, min_level_flea: 1,
        capacity: mod.capacity ?? 0,
        sighting_range: mod.sighting ?? 0,
        category: 'fixture', category_id: mod.category ?? 'fixture',
        handbook_categories: mod.handbook,
      },
    };
    itemLookup[mod.id] = entry;
  }
  return {
    weaponId: 'gun', itemLookup, compatibilityMap: buildCompatibilityMap('gun', itemLookup),
    ergoWeight: 1, recoilWeight: 0, priceWeight: 0, fleaAvailable: true, preciseMode: true,
    includeItems: input.includeItems, excludeItems: input.excludeItems,
  };
}

function needsPreset(params: SolveParams, itemId: string): boolean {
  const entry = params.itemLookup[itemId];
  if (entry?.type !== 'mod') return false;
  if (entry.stats.purchasable === false) return false;
  const [price, , available] = getAvailablePrice(entry.stats, params.traderLevels, params.fleaAvailable ?? true, params.playerLevel ?? null, params.barterAvailable ?? false, params.barterExcludeDogtags ?? false);
  return !(available && price > 0);
}

/** Every subset, checked by the same placement, conflict, required-slot, and preset rules as a validated build. */
function feasibleBuilds(params: SolveParams): string[][] {
  const lp = buildLP(params);
  const ids = lp.indexToItem.slice(1).filter(id => id.length > 0);
  assert.ok(ids.length <= 8, `exhaustive fixture has ${ids.length} model items`);
  const weapon = params.itemLookup[params.weaponId];
  if (weapon?.type !== 'gun') throw new Error('fixture weapon missing');
  const bases: { id: string; items: Set<string> }[] = [{ id: 'naked', items: new Set() }];
  for (const preset of weapon.presets) bases.push({ id: preset.id, items: new Set(presetSupply(preset.items).keys()) });
  const builds: string[][] = [];
  const limit = 1 << ids.length;
  for (let mask = 0; mask < limit; mask++) {
    const selected = ids.filter((_, index) => (mask & (1 << index)) !== 0);
    if (bases.some(base => covers(params, base.items, selected) && placeable(params, lp.slotItemsMap, lp.slotOwnerMap, selected))) {
      builds.push(selected);
    }
  }
  return builds;
}

function covers(params: SolveParams, retained: Set<string>, selected: string[]): boolean {
  return selected.every(id => !needsPreset(params, id) || retained.has(id));
}

function conflicts(params: SolveParams, a: string, b: string): boolean {
  const left = params.itemLookup[a];
  const right = params.itemLookup[b];
  return (left?.type === 'mod' && left.conflicting_items.includes(b))
    || (right?.type === 'mod' && right.conflicting_items.includes(a));
}

function placeable(
  params: SolveParams,
  slotItems: Record<string, string[]>,
  slotOwner: Record<string, string>,
  selected: string[],
): boolean {
  const chosen = new Set(selected);
  for (let i = 0; i < selected.length; i++) {
    for (let j = i + 1; j < selected.length; j++) {
      if (conflicts(params, selected[i], selected[j])) return false;
    }
  }
  const used = new Set<string>();
  const occupiedBy = new Map<string, string>();
  const reachesWeapon = (): boolean => {
    for (const itemId of selected) {
      let current = itemId;
      const walk = new Set<string>();
      while (current !== params.weaponId) {
        if (walk.has(current)) return false;
        walk.add(current);
        const slotId = [...occupiedBy.entries()].find(([, placed]) => placed === current)?.[0];
        if (!slotId) return false;
        const owner = slotOwner[slotId];
        if (!owner) return false;
        current = owner;
      }
    }
    return true;
  };
  const assign = (index: number): boolean => {
    if (index === selected.length) return requirementsMet(params, selected, used) && reachesWeapon();
    const itemId = selected[index];
    for (const [slotId, allowed] of Object.entries(slotItems)) {
      if (!allowed.includes(itemId) || used.has(slotId)) continue;
      const owner = slotOwner[slotId];
      if (owner !== params.weaponId && !chosen.has(owner)) continue;
      if (conflicts(params, itemId, owner)) continue;
      const entry = params.itemLookup[itemId];
      if (entry?.type === 'mod' && entry.conflicting_slot_ids.some(id => used.has(id))) continue;
      used.add(slotId);
      occupiedBy.set(slotId, itemId);
      if (assign(index + 1)) return true;
      used.delete(slotId);
      occupiedBy.delete(slotId);
    }
    return false;
  };
  return assign(0);
}

function requirementsMet(params: SolveParams, selected: string[], used: Set<string>): boolean {
  const owners = [params.weaponId, ...selected];
  for (const ownerId of owners) {
    const entry = params.itemLookup[ownerId];
    if (!entry) continue;
    for (const slot of entry.slots) {
      if (slot.required && !used.has(slot.id)) return false;
    }
    if (entry.type === 'mod') {
      for (const slotId of entry.conflicting_slot_ids) {
        if (used.has(slotId)) return false;
      }
    }
  }
  return true;
}

function usedIds(builds: string[][]): Set<string> {
  return new Set(builds.flat());
}

function assertPreservesValidated(params: SolveParams): void {
  const before = feasibleBuilds(params);
  const report = assessCandidatePruning(params);
  const removed = new Set([...report.impossible, ...report.alreadyFixedZero]);
  const used = usedIds(before);
  for (const id of removed) {
    assert.equal(used.has(id), false, `${id} is removed but appears in a validated build`);
  }
  if (report.rootUnvalidated) {
    assert.equal(before.length, 0, 'rootUnvalidated must mean no validated build');
    assert.equal(report.impossible.length, 0);
  }
}

const unbuyable = { purchasable: true, offers: [] as OfferInfo[], price: 0 };

// Current availability already drops a part that cannot be bought and is not retained.
{
  const params = graph({
    slots: [{ id: 'mount', allows: ['Kept', 'Gone'] }],
    mods: [
      { id: 'Kept', ergo: 5 },
      { id: 'Gone', ...unbuyable, ergo: 9 },
    ],
  });
  const report = assessCandidatePruning(params);
  assert.equal(report.reachable, 2);
  assert.equal(report.droppedBeforeModel, 1);
  assert.deepEqual(report.impossible, []);
  assert.ok(!buildLP(params).indexToItem.includes('Gone'));
}

// A preset-retained part stays. A part with no purchase path and no preset supply (formerly a free "found in raid" stand-in) is not modelled:
// Stage 2 caps it at zero copies (ADR 0013 section 4A), so no build installs it and the model does not carry it.
{
  const params = graph({
    slots: [{ id: 'mount', allows: ['Raid', 'Retained'] }],
    mods: [
      { id: 'Raid', purchasable: false, ergo: 4 },
      { id: 'Retained', ...unbuyable, ergo: 3 },
    ],
    presets: [{ id: 'boxed', items: ['Retained'] }],
  });
  const report = assessCandidatePruning(params);
  assert.deepEqual(report.impossible, []);
  assert.deepEqual(report.alreadyFixedZero, []);
  assert.ok(!feasibleBuilds(params).some(build => build.includes('Raid')), 'a part nothing supplies is never installed');
  assert.ok(!buildLP(params).indexToItem.includes('Raid'));
  assert.ok(feasibleBuilds(params).some(build => build.includes('Retained')));
}

// A child of a parent the availability filter already removed is a new impossible candidate.
// An alternative surviving parent keeps the child.
{
  const orphan = graph({
    slots: [{ id: 'mount', allows: ['Parent', 'Host'] }],
    mods: [
      { id: 'Parent', ergo: 1, slots: [{ id: 'child', allows: ['Useful'] }] },
      { id: 'Useful', ergo: 5 },
      { id: 'Host', ...unbuyable, slots: [{ id: 'dead', allows: ['Orphan'] }] },
      { id: 'Orphan', ergo: 1 }, // buyable: it is in the model, so only its dropped owner makes it impossible
    ],
  });
  // Host is reachable, then dropped because it cannot be bought. Orphan stays in the
  // LP only on Host's slot, so its owner is no longer a variable.
  const orphanLp = buildLP(orphan);
  assert.equal(orphanLp.slotOwnerMap['dead'], 'Host');
  assert.equal(orphanLp.indexToItem.includes('Host'), false);
  const orphanReport = assessCandidatePruning(orphan);
  assert.ok(orphanReport.impossible.includes('Orphan') || orphanReport.alreadyFixedZero.includes('Orphan'));
  assert.ok(!orphanReport.impossible.includes('Useful'));
  assertPreservesValidated(orphan);

  const alternative = graph({
    slots: [{ id: 'mount', allows: ['Dead', 'Live'] }],
    mods: [
      { id: 'Dead', ...unbuyable, slots: [{ id: 'from-dead', allows: ['Child'] }] },
      { id: 'Live', slots: [{ id: 'from-live', allows: ['Child'] }] },
      { id: 'Child', ergo: 2 },
    ],
  });
  const alternativeReport = assessCandidatePruning(alternative);
  assert.ok(!alternativeReport.impossible.includes('Child'));
  assert.ok(!alternativeReport.alreadyFixedZero.includes('Child'));
  assertPreservesValidated(alternative);
}

// Required slot with no filler removes the parent, then the child that could only mount on it.
{
  const params = graph({
    slots: [{ id: 'mount', allows: ['Body', 'Other'] }],
    mods: [
      { id: 'Body', ergo: 1, slots: [{ id: 'need', required: true, allows: ['Missing'] }] },
      { id: 'Missing', ...unbuyable },
      { id: 'Other', ergo: 3 },
      { id: 'OnlyOnBody', ergo: 4 },
    ],
  });
  // OnlyOnBody is not attached yet; attach it through Body.
  params.itemLookup['Body'] && params.itemLookup['Body'].type === 'mod'
    ? params.itemLookup['Body'].slots.push({ id: 'side', name: 'side', nameId: 'side', required: false, allowedItems: ['OnlyOnBody'] })
    : undefined;
  params.compatibilityMap = buildCompatibilityMap('gun', params.itemLookup);
  const report = assessCandidatePruning(params);
  assert.ok(report.impossible.includes('Body'), `Body should be impossible, got ${JSON.stringify(report)}`);
  assert.ok(report.impossible.includes('OnlyOnBody') || report.alreadyFixedZero.includes('OnlyOnBody'));
  assert.ok(!report.impossible.includes('Other'));
  assertPreservesValidated(params);
}

// Two parents that only mount on each other are not placeable just because each lists the other.
{
  const params = graph({
    slots: [{ id: 'mount', allows: ['Gate'] }],
    mods: [
      { id: 'Gate', slots: [{ id: 'need', required: true, allows: ['Missing'] }, { id: 'to-a', allows: ['LoopA'] }] },
      { id: 'Missing', ...unbuyable },
      { id: 'LoopA', slots: [{ id: 'to-b', allows: ['LoopB'] }] },
      { id: 'LoopB', slots: [{ id: 'to-a2', allows: ['LoopA'] }] },
    ],
  });
  const report = assessCandidatePruning(params);
  assert.equal(report.rootUnvalidated, false);
  assert.ok(report.impossible.includes('LoopA'));
  assert.ok(report.impossible.includes('LoopB'));
  assertPreservesValidated(params);
}

// A named lock is not removed, even when it has no legal placement.
{
  const params = graph({
    slots: [{ id: 'mount', allows: ['Kept'] }],
    mods: [
      { id: 'Kept', ergo: 1 },
      { id: 'Locked', ...unbuyable },
    ],
    includeItems: ['Locked'],
  });
  // Locked is not reachable, so force it into a dead slot of a dropped host by listing it on Kept's absent peer.
  const hosted = graph({
    slots: [{ id: 'mount', allows: ['Kept', 'Ghost'] }],
    mods: [
      { id: 'Kept', ergo: 1 },
      { id: 'Ghost', ...unbuyable, slots: [{ id: 'ghost-slot', allows: ['Locked'] }] },
      { id: 'Locked', purchasable: false },
    ],
    includeItems: ['Locked'],
  });
  const report = assessCandidatePruning(hosted);
  assert.ok(!report.impossible.includes('Locked'));
  assert.ok(!report.alreadyFixedZero.includes('Locked'));
  assert.ok(buildLP(hosted).indexToItem.includes('Locked'));
  assertPreservesValidated(hosted);
  void params;
}

// Conflict with the only parent removes the child. Conflict with one of two parents does not.
{
  const only = graph({
    slots: [{ id: 'mount', allows: ['Parent'] }],
    mods: [
      { id: 'Parent', slots: [{ id: 'child', allows: ['Clash'] }] },
      { id: 'Clash', conflicts: ['Parent'], ergo: 2 },
    ],
  });
  const onlyReport = assessCandidatePruning(only);
  assert.ok(onlyReport.impossible.includes('Clash'));
  assertPreservesValidated(only);

  const either = graph({
    slots: [{ id: 'mount', allows: ['Left', 'Right'] }],
    mods: [
      { id: 'Left', slots: [{ id: 'left-slot', allows: ['Part'] }] },
      { id: 'Right', slots: [{ id: 'right-slot', allows: ['Part'] }] },
      { id: 'Part', conflicts: ['Left'], ergo: 2 },
    ],
  });
  const eitherReport = assessCandidatePruning(either);
  assert.ok(!eitherReport.impossible.includes('Part'));
  assertPreservesValidated(either);
}

// Two equivalent parts that a build can mount together are not impossible, and are not a dominated drop.
{
  const params = graph({
    slots: [
      { id: 'left', required: true, allows: ['A', 'B'] },
      { id: 'right', required: true, allows: ['A', 'B'] },
    ],
    mods: [
      { id: 'A', ergo: 5, price: 10 },
      { id: 'B', ergo: 5, price: 50 },
    ],
  });
  const report = assessCandidatePruning(params);
  assert.deepEqual(report.impossible, []);
  assert.deepEqual(report.dominance, []);
  const builds = feasibleBuilds(params);
  assert.ok(builds.some(build => build.includes('A') && build.includes('B')));
  assertPreservesValidated(params);
}

// Same displayed stats and a cheaper standalone price do not survive a slot, conflict, preset, or lock difference.
{
  const differentSlot = graph({
    slots: [{ id: 'mount', allows: ['Cheap', 'Costly'] }],
    mods: [
      { id: 'Cheap', ergo: 5, price: 10, slots: [{ id: 'extra', allows: [] }] },
      { id: 'Costly', ergo: 5, price: 50 },
    ],
  });
  assert.deepEqual(assessCandidatePruning(differentSlot).dominance, []);

  const differentConflict = graph({
    slots: [{ id: 'mount', allows: ['Cheap', 'Costly', 'Neighbor'] }],
    mods: [
      { id: 'Cheap', ergo: 5, price: 10, conflicts: ['Neighbor'] },
      { id: 'Costly', ergo: 5, price: 50 },
      { id: 'Neighbor', ergo: 1 },
    ],
  });
  assert.deepEqual(assessCandidatePruning(differentConflict).dominance.map(drop => drop.drop), []);

  const retained = graph({
    slots: [{ id: 'mount', allows: ['Cheap', 'Retained'] }],
    mods: [
      { id: 'Cheap', ergo: 5, price: 10 },
      { id: 'Retained', ...unbuyable, ergo: 5 },
    ],
    presets: [{ id: 'boxed', items: ['Retained'], price: 100 }],
  });
  assert.deepEqual(assessCandidatePruning(retained).dominance, []);
  assert.ok(feasibleBuilds(retained).some(build => build.includes('Retained')));

  const locked = graph({
    slots: [{ id: 'mount', allows: ['Cheap', 'Named'] }],
    mods: [
      { id: 'Cheap', ergo: 5, price: 10 },
      { id: 'Named', ergo: 5, price: 50 },
    ],
    includeItems: ['Named'],
  });
  assert.ok(!assessCandidatePruning(locked).dominance.some(drop => drop.drop === 'Named'));
}

// On one slot, the strictly more expensive identical part is a witness drop, not an all-ties drop.
{
  const params = graph({
    slots: [{ id: 'mount', allows: ['Cheap', 'Costly'] }],
    mods: [
      { id: 'Cheap', ergo: 5, price: 10 },
      { id: 'Costly', ergo: 5, price: 50 },
    ],
  });
  const report = assessCandidatePruning(params);
  assert.deepEqual(report.impossible, []);
  assert.deepEqual(report.dominance.map(drop => drop.drop), ['Costly']);
  assert.equal(report.dominance[0].guarantee, 'optimal-value-and-one-witness');
  const builds = feasibleBuilds(params);
  assert.ok(builds.some(build => build.includes('Cheap') && !build.includes('Costly')));
  assert.ok(builds.some(build => build.includes('Costly') && !build.includes('Cheap')));
  const without = graph({
    slots: [{ id: 'mount', allows: ['Cheap', 'Costly'] }],
    mods: [
      { id: 'Cheap', ergo: 5, price: 10 },
      { id: 'Costly', ergo: 5, price: 50 },
    ],
    excludeItems: ['Costly'],
  });
  assert.equal(feasibleBuilds(without).some(build => build.includes('Costly')), false);
}

// Removing the proved-impossible id does not change the certified objective.
{
  const params = graph({
    slots: [{ id: 'mount', allows: ['Parent', 'Ghost'] }],
    mods: [
      { id: 'Parent', ergo: 2, slots: [{ id: 'child', allows: ['Useful'] }] },
      { id: 'Useful', ergo: 5 },
      { id: 'Ghost', ...unbuyable, slots: [{ id: 'nowhere', allows: ['Lost'] }] },
      { id: 'Lost', ergo: 20 },
    ],
  });
  const report = assessCandidatePruning(params);
  assert.ok(report.impossible.includes('Lost') || report.alreadyFixedZero.includes('Lost'));
  const baseline = await solve(params);
  const pruned = await solve({
    ...params,
    excludeItems: [...report.impossible, ...report.alreadyFixedZero],
  });
  assert.equal(baseline.status, 'optimal');
  assert.equal(pruned.status, 'optimal');
  assert.equal(pruned.objective_value, baseline.objective_value);
  assert.ok(!baseline.selected_items.some(item => item.id === 'Lost'));
}

console.log('candidate prune preservation passed');
