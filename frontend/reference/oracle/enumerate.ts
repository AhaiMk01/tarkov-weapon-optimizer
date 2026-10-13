// Rooted-build enumerator (ADR 0003, ADR 0013 section 3).
//
// Enumerates every rooted occurrence tree of a weapon over instance-qualified physical slots
// (parentInstance, templateSlot): each slot occurrence holds at most one child, required slots
// are never left empty, and a child template may not repeat any ancestor template (including the
// receiver). Siblings and cousins may repeat templates, so multi-copy builds exist.
//
// Trees are structural only: conflicts, caps, includes and every hard constraint are the
// validator's job. The one request-dependent prune is sound by construction: an item the request
// excludes by id or category can never appear in an accepted build, so it is never generated
// (a required slot that can only take such items correctly forces its owner off).
//
// Hitting a node or size cap yields complete: false. An incomplete enumeration is never a proof
// of emptiness.

import { accessibleBases } from './acquisition';
import { childInstanceId, type BaseChoice, type Placement, type ReferenceBuild } from './build';
import { ROOT_INSTANCE_ID } from './constants';
import type { ReferenceFixture, ReferenceRequest } from './domain';
import {
  isExcludedByRequest, resolveFixture, resolveRequest,
  type ResolvedFixture, type ResolvedSlot,
} from './resolve';

export interface EnumerateOptions {
  /** Maximum placement expansions (items tried in slots) before stopping. Default 5,000,000. */
  maxNodes?: number;
  /** Maximum trees to generate (builds, for enumerateBuilds). Default 500,000. */
  maxTrees?: number;
  /** Alias of maxTrees for enumerateBuilds, where it caps the number of (base, tree) builds. */
  maxBuilds?: number;
}

export interface TreeEnumeration {
  trees: Placement[][];
  complete: boolean;
  nodes: number;
}

export interface BuildEnumeration {
  builds: ReferenceBuild[];
  bases: BaseChoice[];
  treeCount: number;
  complete: boolean;
  nodes: number;
}

const DEFAULT_MAX_NODES = 5_000_000;
const DEFAULT_MAX_TREES = 500_000;

interface Context {
  fixture: ResolvedFixture;
  installable: (itemId: string) => boolean;
  maxNodes: number;
  nodes: number;
  stopped: boolean;
}

function* expandSlots(
  ctx: Context, parentInstanceId: string, slots: readonly ResolvedSlot[], index: number, ancestors: readonly string[],
): Generator<Placement[]> {
  if (index === slots.length) {
    yield [];
    return;
  }
  for (const choice of slotOptions(ctx, parentInstanceId, slots[index], ancestors)) {
    for (const rest of expandSlots(ctx, parentInstanceId, slots, index + 1, ancestors)) {
      if (ctx.stopped) return;
      yield [...choice, ...rest];
    }
    if (ctx.stopped) return;
  }
}

function* slotOptions(
  ctx: Context, parentInstanceId: string, slot: ResolvedSlot, ancestors: readonly string[],
): Generator<Placement[]> {
  if (!slot.required) yield [];
  for (const itemId of new Set(slot.allowedItemIds)) {
    if (ctx.stopped) return;
    if (ancestors.includes(itemId)) continue; // no ancestor-template repetition
    if (!ctx.installable(itemId)) continue;
    const item = ctx.fixture.items.get(itemId);
    if (!item) continue;
    if (++ctx.nodes > ctx.maxNodes) {
      ctx.stopped = true;
      return;
    }
    const childId = childInstanceId(parentInstanceId, slot.id, itemId);
    const placement: Placement = { parentInstanceId, slotId: slot.id, childInstanceId: childId, itemId };
    for (const below of expandSlots(ctx, childId, item.slots, 0, [...ancestors, itemId])) {
      if (ctx.stopped) return;
      yield [placement, ...below];
    }
  }
}

function enumerateResolved(
  fixture: ResolvedFixture, weaponId: string, installable: (itemId: string) => boolean, options: EnumerateOptions,
): TreeEnumeration {
  const weapon = fixture.weapons.get(weaponId);
  if (!weapon) throw new Error(`enumerateTrees: unknown weapon ${weaponId}`);
  const maxTrees = options.maxTrees ?? DEFAULT_MAX_TREES;
  const ctx: Context = { fixture, installable, maxNodes: options.maxNodes ?? DEFAULT_MAX_NODES, nodes: 0, stopped: false };
  const trees: Placement[][] = [];
  let complete = true;
  for (const tree of expandSlots(ctx, ROOT_INSTANCE_ID, weapon.slots, 0, [weapon.id])) {
    if (trees.length >= maxTrees) {
      complete = false; // a further tree exists beyond the cap
      break;
    }
    trees.push(tree);
  }
  if (ctx.stopped) complete = false;
  return { trees, complete, nodes: ctx.nodes };
}

/** Every rooted occurrence tree of a weapon, independent of base and of hard constraints. */
export function enumerateTrees(fixture: ReferenceFixture, weaponId: string, options: EnumerateOptions = {}): TreeEnumeration {
  return enumerateResolved(resolveFixture(fixture), weaponId, () => true, options);
}

/** Every rooted tree paired with every accessible base. Hard constraints are left to the validator. */
export function enumerateBuilds(
  fixture: ReferenceFixture, request: ReferenceRequest, options: EnumerateOptions = {},
): BuildEnumeration {
  const rf = resolveFixture(fixture);
  const rr = resolveRequest(fixture, request);
  const bases = accessibleBases(rf, rr);
  if (bases.length === 0) {
    // No accessible base: emptiness is proved without looking at any tree.
    return { builds: [], bases, treeCount: 0, complete: true, nodes: 0 };
  }
  const installable = (itemId: string) => {
    const item = rf.items.get(itemId);
    return item !== undefined && !isExcludedByRequest(rr, item);
  };
  const maxBuilds = options.maxBuilds ?? options.maxTrees ?? DEFAULT_MAX_TREES;
  const maxTrees = Math.ceil(maxBuilds / bases.length);
  const { trees, complete: treesComplete, nodes } = enumerateResolved(rf, rr.weaponId, installable, { ...options, maxTrees });
  const builds: ReferenceBuild[] = [];
  let complete = treesComplete;
  outer: for (const base of bases) {
    for (const tree of trees) {
      if (builds.length >= maxBuilds) {
        complete = false;
        break outer;
      }
      builds.push({ base, placements: tree });
    }
  }
  return { builds, bases, treeCount: trees.length, complete, nodes };
}
