// Reference validator (ADR 0010 section 5, ADR 0013 section 3).
//
// validateReference(fixture, request, build) checks an externally supplied build against the
// reference domain in exact Q. It validates structure itself and trusts nothing about the
// producer, including the enumerator: rootedness and connectivity, per-occurrence slot capacity,
// allowed items, no ancestor-template repetition, required occupancy, template / self / slot
// conflicts, includes and excludes, availability and quantity caps, base accessibility and every
// request hard cap. Violation codes are stable strings.

import { acquire, baseOffer, receiverOwned } from './acquisition';
import type { Placement, ReferenceBuild } from './build';
import { ROOT_INSTANCE_ID } from './constants';
import type { ReferenceFixture, ReferenceRequest } from './domain';
import {
  matchesCategory, resolveFixture, resolveRequest,
  type ResolvedFixture, type ResolvedRequest, type ResolvedSlot, type ResolvedTemplate,
} from './resolve';
import { computeStats, type BuildStats } from './stats';
import { add, ge, le, lt, toString, ZERO } from './q';

export type ViolationCode =
  | 'BASE_UNKNOWN_PRESET'
  | 'BASE_WRONG_WEAPON'
  | 'BASE_INACCESSIBLE'
  | 'DUPLICATE_INSTANCE_ID'
  | 'UNKNOWN_ITEM'
  | 'UNKNOWN_PARENT_INSTANCE'
  | 'UNROOTED_PLACEMENT'
  | 'UNKNOWN_SLOT'
  | 'ITEM_NOT_ALLOWED_IN_SLOT'
  | 'SLOT_CAPACITY_EXCEEDED'
  | 'ANCESTOR_TEMPLATE_REPETITION'
  | 'MISSING_REQUIRED_SLOT'
  | 'TEMPLATE_CONFLICT'
  | 'SELF_CONFLICT_COPY_CAP'
  | 'SLOT_CONFLICT'
  | 'EXCLUDED_ITEM'
  | 'EXCLUDED_CATEGORY'
  | 'MISSING_INCLUDE_ITEM'
  | 'MISSING_INCLUDE_CATEGORY_GROUP'
  | 'QUANTITY_CAP_EXCEEDED'
  | 'MAX_PRICE_EXCEEDED'
  | 'MIN_ERGONOMICS_NOT_MET'
  | 'MAX_RECOIL_V_EXCEEDED'
  | 'MAX_RECOIL_SUM_EXCEEDED'
  | 'MIN_MAGAZINE_NOT_MET'
  | 'MIN_SIGHTING_NOT_MET'
  | 'MAX_WEIGHT_EXCEEDED'
  | 'MAX_MOA_EXCEEDED'
  | 'OVERSWING_PREVENTED';

export interface Violation {
  code: ViolationCode;
  detail: string;
}

export interface ValidationResult {
  ok: boolean;
  violations: Violation[];
}

export interface Inspection {
  violations: Violation[];
  /** Statistics, present when every installed item exists in the fixture. */
  stats: BuildStats | null;
}

const slotKey = (parentInstanceId: string, slotId: string) => JSON.stringify([parentInstanceId, slotId]);

/** Validate and, when the items are all known, also compute exact statistics. */
export function inspectBuild(fixture: ResolvedFixture, request: ResolvedRequest, build: ReferenceBuild): Inspection {
  const violations: Violation[] = [];
  const push = (code: ViolationCode, detail: string) => violations.push({ code, detail });
  const weapon = fixture.weapons.get(request.weaponId);
  if (!weapon) throw new Error(`inspectBuild: unknown weapon ${request.weaponId}`);
  const rootId = build.rootInstanceId ?? ROOT_INSTANCE_ID;

  // --- base ------------------------------------------------------------------------------------
  if (build.base.kind === 'preset') {
    const preset = fixture.presets.get(build.base.presetId);
    if (!preset) push('BASE_UNKNOWN_PRESET', build.base.presetId);
    else if (preset.weaponId !== weapon.id) push('BASE_WRONG_WEAPON', `${preset.id} is built on ${preset.weaponId}`);
    else if (!baseOffer(fixture, request, build.base)) push('BASE_INACCESSIBLE', `preset ${preset.id} has no legal offer`);
  } else if (!baseOffer(fixture, request, build.base) && !receiverOwned(fixture, request)) {
    // The naked receiver with no legal offer is accepted only as the owned receiver: nothing at all can be bought (interpretation 18).
    push('BASE_INACCESSIBLE', `receiver ${weapon.id} has no legal offer`);
  }

  // --- instances -------------------------------------------------------------------------------
  const byChild = new Map<string, Placement>();
  const templateOf = new Map<string, ResolvedTemplate>();
  let itemsKnown = true;
  for (const p of build.placements) {
    if (p.childInstanceId === rootId || byChild.has(p.childInstanceId)) {
      push('DUPLICATE_INSTANCE_ID', p.childInstanceId);
    } else {
      byChild.set(p.childInstanceId, p);
    }
    const item = fixture.items.get(p.itemId);
    if (!item) {
      itemsKnown = false;
      push('UNKNOWN_ITEM', `${p.childInstanceId}: ${p.itemId}`);
    } else if (!templateOf.has(p.childInstanceId)) {
      templateOf.set(p.childInstanceId, item);
    }
  }

  // --- rootedness ------------------------------------------------------------------------------
  const children = new Map<string, Placement[]>();
  for (const p of build.placements) {
    const list = children.get(p.parentInstanceId);
    if (list) list.push(p);
    else children.set(p.parentInstanceId, [p]);
  }
  const rooted = new Set<string>();
  const queue: string[] = [rootId];
  for (let i = 0; i < queue.length; i++) {
    for (const child of children.get(queue[i]) ?? []) {
      if (!rooted.has(child.childInstanceId) && child.childInstanceId !== rootId) {
        rooted.add(child.childInstanceId);
        queue.push(child.childInstanceId);
      }
    }
  }
  const parentKnown = (p: Placement) => p.parentInstanceId === rootId || byChild.has(p.parentInstanceId);
  for (const p of build.placements) {
    if (!parentKnown(p)) push('UNKNOWN_PARENT_INSTANCE', `${p.childInstanceId}: parent ${p.parentInstanceId}`);
    else if (!rooted.has(p.childInstanceId)) push('UNROOTED_PLACEMENT', p.childInstanceId);
  }

  // --- slot legality, capacity and ancestor repetition -------------------------------------------
  const slotsOf = (instanceId: string): readonly ResolvedSlot[] | null => {
    if (instanceId === rootId) return weapon.slots;
    return templateOf.get(instanceId)?.slots ?? null;
  };
  const occupancy = new Map<string, number>();
  for (const p of build.placements) {
    const key = slotKey(p.parentInstanceId, p.slotId);
    occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
  }
  for (const [key, count] of occupancy) {
    if (count > 1) push('SLOT_CAPACITY_EXCEEDED', `${key} holds ${count} children`);
  }
  for (const p of build.placements) {
    const slots = parentKnown(p) ? slotsOf(p.parentInstanceId) : null;
    if (slots) {
      const slot = slots.find(s => s.id === p.slotId);
      if (!slot) push('UNKNOWN_SLOT', `${p.childInstanceId}: ${p.parentInstanceId} has no slot ${p.slotId}`);
      else if (!slot.allowedItemIds.includes(p.itemId)) {
        push('ITEM_NOT_ALLOWED_IN_SLOT', `${p.childInstanceId}: ${p.itemId} in ${p.slotId}`);
      }
    }
    if (rooted.has(p.childInstanceId)) {
      if (p.itemId === weapon.id) push('ANCESTOR_TEMPLATE_REPETITION', `${p.childInstanceId}: repeats the receiver`);
      const seen = new Set<string>([p.childInstanceId]);
      for (let cur = byChild.get(p.parentInstanceId); cur && !seen.has(cur.childInstanceId); cur = byChild.get(cur.parentInstanceId)) {
        seen.add(cur.childInstanceId);
        if (cur.itemId === p.itemId) {
          push('ANCESTOR_TEMPLATE_REPETITION', `${p.childInstanceId}: ${p.itemId} repeats ancestor ${cur.childInstanceId}`);
          break;
        }
      }
    }
  }

  // --- required occupancy -----------------------------------------------------------------------
  for (const slot of weapon.slots) {
    if (slot.required && !occupancy.has(slotKey(rootId, slot.id))) push('MISSING_REQUIRED_SLOT', `${rootId}/${slot.id}`);
  }
  for (const p of build.placements) {
    const template = templateOf.get(p.childInstanceId);
    if (!template || !rooted.has(p.childInstanceId)) continue;
    for (const slot of template.slots) {
      if (slot.required && !occupancy.has(slotKey(p.childInstanceId, slot.id))) {
        push('MISSING_REQUIRED_SLOT', `${p.childInstanceId}/${slot.id}`);
      }
    }
  }

  // --- conflicts --------------------------------------------------------------------------------
  const copies = new Map<string, number>();
  for (const p of build.placements) copies.set(p.itemId, (copies.get(p.itemId) ?? 0) + 1);
  const present = new Set<string>([weapon.id, ...copies.keys()]);
  const reportedPairs = new Set<string>();
  const checkTemplateConflicts = (ownerId: string, conflicts: ReadonlySet<string>) => {
    for (const other of conflicts) {
      if (other === ownerId) {
        if ((copies.get(ownerId) ?? 0) > 1) push('SELF_CONFLICT_COPY_CAP', `${ownerId} x${copies.get(ownerId)}`);
      } else if (present.has(other)) {
        const pair = [ownerId, other].sort().join('|');
        if (!reportedPairs.has(pair)) {
          reportedPairs.add(pair);
          push('TEMPLATE_CONFLICT', `${ownerId}/${other}`);
        }
      }
    }
  };
  checkTemplateConflicts(weapon.id, weapon.conflictingItemIds);
  for (const itemId of copies.keys()) {
    const item = fixture.items.get(itemId);
    if (item) checkTemplateConflicts(itemId, item.conflictingItemIds);
  }
  // A blocker blocks every occupied physical slot with a listed template slot id, its own host slot included
  // (interpretation 11); against a required slot this bans the blocker outright (interpretation 14).
  for (const p of build.placements) {
    const item = templateOf.get(p.childInstanceId);
    if (!item) continue;
    for (const blocked of item.conflictingSlotIds) {
      for (const other of build.placements) {
        if (other.slotId === blocked) push('SLOT_CONFLICT', `${p.childInstanceId} blocks slot ${blocked} occupied by ${other.childInstanceId}`);
      }
    }
  }

  // --- includes and excludes ----------------------------------------------------------------------
  for (const p of build.placements) {
    const item = templateOf.get(p.childInstanceId);
    if (request.excludeItems.has(p.itemId)) push('EXCLUDED_ITEM', `${p.childInstanceId}: ${p.itemId}`);
    if (item) {
      for (const category of request.excludeCategories) {
        if (matchesCategory(item, category)) push('EXCLUDED_CATEGORY', `${p.childInstanceId}: ${p.itemId} in ${category}`);
      }
    }
  }
  // A repeated include_items entry still means "at least once" (interpretation 12).
  for (const id of new Set(request.includeItems)) {
    if (!copies.has(id)) push('MISSING_INCLUDE_ITEM', id);
  }
  request.includeCategories.forEach((group, index) => {
    const satisfied = [...templateOf.values()].some(item => group.some(category => matchesCategory(item, category)));
    if (!satisfied) push('MISSING_INCLUDE_CATEGORY_GROUP', `group ${index}: [${group.join(',')}]`);
  });

  // --- acquisition and quantity caps --------------------------------------------------------------
  const acquisition = acquire(fixture, request, build);
  for (const shortfall of acquisition.shortfalls) {
    push('QUANTITY_CAP_EXCEEDED', `${shortfall.itemId}: ${shortfall.count} unit(s) above preset + owned supply and no legal offer`);
  }

  // --- hard caps ----------------------------------------------------------------------------------
  let stats: BuildStats | null = null;
  if (itemsKnown) {
    stats = computeStats(fixture, request, build);
    if (request.maxPrice !== null && !le(stats.spend, request.maxPrice)) {
      push('MAX_PRICE_EXCEEDED', `${toString(stats.spend)} > ${toString(request.maxPrice)}`);
    }
    // min_ergonomics reads the displayed first-clamp ergonomics, before the gear factor (interpretation 8).
    if (request.minErgonomics !== null && !ge(stats.ergonomics, request.minErgonomics)) {
      push('MIN_ERGONOMICS_NOT_MET', `${toString(stats.ergonomics)} < ${toString(request.minErgonomics)}`);
    }
    if (request.maxRecoilV !== null && !le(stats.recoilVertical, request.maxRecoilV)) {
      push('MAX_RECOIL_V_EXCEEDED', `${toString(stats.recoilVertical)} > ${toString(request.maxRecoilV)}`);
    }
    if (request.maxRecoilSum !== null) {
      const total = add(stats.recoilVertical, stats.recoilHorizontal);
      if (!le(total, request.maxRecoilSum)) push('MAX_RECOIL_SUM_EXCEEDED', `${toString(total)} > ${toString(request.maxRecoilSum)}`);
    }
    if (request.minMagCapacity !== null && !ge(stats.magazineCapacity, request.minMagCapacity)) {
      push('MIN_MAGAZINE_NOT_MET', `${toString(stats.magazineCapacity)} < ${toString(request.minMagCapacity)}`);
    }
    if (request.minSightingRange !== null && !ge(stats.sightingRange, request.minSightingRange)) {
      push('MIN_SIGHTING_NOT_MET', `${toString(stats.sightingRange)} < ${toString(request.minSightingRange)}`);
    }
    if (request.maxWeight !== null && !le(stats.weight, request.maxWeight)) {
      push('MAX_WEIGHT_EXCEEDED', `${toString(stats.weight)} > ${toString(request.maxWeight)}`);
    }
    if (request.maxMoa !== null && !le(stats.moa, request.maxMoa)) {
      push('MAX_MOA_EXCEEDED', `${toString(stats.moa)} > ${toString(request.maxMoa)}`);
    }
    if (request.preventOverswing && lt(stats.ted, ZERO)) {
      push('OVERSWING_PREVENTED', `TED ${toString(stats.ted)} < 0`);
    }
  }
  return { violations, stats };
}

export function validateResolved(fixture: ResolvedFixture, request: ResolvedRequest, build: ReferenceBuild): ValidationResult {
  const { violations } = inspectBuild(fixture, request, build);
  return { ok: violations.length === 0, violations };
}

/** Validate a build against the reference domain. Throws ReferenceInputError on a malformed fixture or request. */
export function validateReference(fixture: ReferenceFixture, request: ReferenceRequest, build: ReferenceBuild): ValidationResult {
  return validateResolved(resolveFixture(fixture), resolveRequest(fixture, request), build);
}
