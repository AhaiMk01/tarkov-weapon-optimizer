// Build representation shared by the enumerator, validator, acquisition model and oracle.
//
// A build is a base choice plus a rooted set of placements. The canonical selection
// projection pi_sel(B) = (base, multiset of installed item ids with counts) is ADR 0010
// section 3; several physical placements may share one projection.

import { codeUnitCompare } from './resolve';

/** One installed occurrence: a child instance attached to a physical slot of its parent. */
export interface Placement {
  parentInstanceId: string;
  /** Template slot id on the parent; the physical slot is (parentInstanceId, slotId). */
  slotId: string;
  childInstanceId: string;
  /** Template id of the installed item. */
  itemId: string;
}

export type BaseChoice = { kind: 'naked' } | { kind: 'preset'; presetId: string };

export interface ReferenceBuild {
  base: BaseChoice;
  placements: Placement[];
  /** Instance id of the receiver; default ROOT_INSTANCE_ID. */
  rootInstanceId?: string;
}

export interface MultisetEntry {
  itemId: string;
  count: number;
}

export interface Projection {
  base: BaseChoice;
  items: MultisetEntry[];
}

/** Deterministic, path-derived instance id. Unique because (parent, slot) is unique per build. */
export function childInstanceId(parentInstanceId: string, slotId: string, itemId: string): string {
  return `${parentInstanceId}/${slotId}:${itemId}`;
}

/** Installed item multiset, sorted by template id in code-unit order. */
export function installedMultiset(build: ReferenceBuild): MultisetEntry[] {
  const counts = new Map<string, number>();
  for (const p of build.placements) counts.set(p.itemId, (counts.get(p.itemId) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => codeUnitCompare(a[0], b[0]))
    .map(([itemId, count]) => ({ itemId, count }));
}

export function projectBuild(build: ReferenceBuild): Projection {
  return { base: build.base, items: installedMultiset(build) };
}

/** Stable string key of a projection; unambiguous because it is JSON. */
export function projectionKey(projection: Projection): string {
  const base = projection.base.kind === 'naked' ? ['naked'] : ['preset', projection.base.presetId];
  return JSON.stringify([base, projection.items.map(e => [e.itemId, e.count])]);
}

/** An edge for makeBuild: [parentInstanceId, slotId, itemId]. */
export type PlacementEdge = [parentInstanceId: string, slotId: string, itemId: string];

/** Build with path-derived instance ids from edges listed parent-first (convenience for fixtures and tests). */
export function makeBuild(base: BaseChoice, ...edges: PlacementEdge[]): ReferenceBuild {
  return {
    base,
    placements: edges.map(([parentInstanceId, slotId, itemId]) => ({
      parentInstanceId,
      slotId,
      childInstanceId: childInstanceId(parentInstanceId, slotId, itemId),
      itemId,
    })),
  };
}
