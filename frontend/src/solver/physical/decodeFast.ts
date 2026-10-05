/**
 * Decoding a solution of the Fast model into a rooted occurrence tree (Phase 2.4c).
 *
 * `decodeFast(model, values)` reads only the decision columns (the base and the edge counts `e_s_c`), never an auxiliary column or a purchase,
 * and builds the tree from the root outward. Every instance is the path-derived `parent/slot:item` id of the blueprint's scheme, so the result is
 * a `PhysicalBuild` the exact validator judges like any Precise build; spend and provenance are recomputed by the validator from the placements.
 *
 * Construction (breadth first, deterministic): the receiver is the first instance. An instance of template t visits the slots t owns in raw-id
 * order; in each it takes one child from the remaining edge counts of that slot (the lowest candidate index with a positive count that is not a
 * template already on the instance's own root path), creates the child instance and queues it. Children of a slot are therefore spread one per
 * copy of the owner, the first copies in creation order taking them when fewer children than copies exist, and a required slot has exactly as many
 * children as copies, so every copy takes one.
 *
 * Acyclic template graph (every pinned gun): the construction consumes every edge count, whatever the choice among candidates, because the
 * instances of a template are created from its incoming edges and each takes at most one child per slot (the model's slot rows state exactly
 * that). The result is then a tree the model describes in full.
 * Cyclic graph: the choice among candidates matters (a child must not repeat an ancestor template, and a part may only be reachable through one
 * parent copy), so the same construction becomes a depth-first search with backtracking over those choices, bounded by `SEARCH_STEP_LIMIT` steps.
 * A count point with no tree (unreachable from the receiver, or every arrangement repeats an ancestor) leaves edge counts unconsumed and the decode
 * is REJECTED (`ok: false`): the caller treats it like a validator rejection and cuts the point out.
 *
 * A column that is missing or not an integer within the reading tolerance is a solver fault, not a rejectable point: it throws
 * `PhysicalModelError('DECODE_FAILED')`, the same as the Precise decoder.
 */

import { ROOT_INSTANCE_ID } from './blueprint';
import type { ColumnValues } from './decode';
import { BINARY_READ_TOLERANCE } from './decode';
import { PhysicalModelError } from './errors';
import type { FastModel } from './specializeFast';
import type { PhysicalBuild, PhysicalPlacement } from './validate';

export type FastDecoded =
  | { ok: true; build: PhysicalBuild; /** Index among the domain's accessible bases. */ baseIndex: number }
  /** A count point that is no rooted tree (cyclic graphs only): nothing is published and the point is cut. */
  | { ok: false; reason: string; baseIndex: number };

function readInteger(values: ColumnValues, name: string, lo: number, hi: number): number {
  const value = values[name];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PhysicalModelError('DECODE_FAILED', `Decision column ${name} is missing from the solution`, { column: name });
  }
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) > BINARY_READ_TOLERANCE || rounded < lo || rounded > hi) {
    throw new PhysicalModelError('DECODE_FAILED', `Decision column ${name} is not an integer within [${lo}, ${hi}]: ${String(value)}`, { column: name, value });
  }
  return rounded;
}

interface PendingInstance {
  id: string;
  template: number;
  /** Templates on the path from the receiver to this instance, itself included. */
  path: ReadonlySet<number>;
}

export function decodeFast(model: FastModel, values: ColumnValues): FastDecoded {
  const { domain, graph } = model;
  if (model.provedEmpty?.source === 'domain') {
    throw new PhysicalModelError('DECODE_FAILED', 'The domain is empty: there is no build to decode', { reasons: model.provedEmpty.reasons });
  }

  // --- base ---
  let baseIndex = -1;
  for (let b = 0; b < domain.bases.length; b++) {
    if (readInteger(values, model.base(b), 0, 1) === 1) {
      if (baseIndex >= 0) throw new PhysicalModelError('DECODE_FAILED', 'More than one base is selected', { bases: [baseIndex, b] });
      baseIndex = b;
    }
  }
  if (baseIndex < 0) throw new PhysicalModelError('DECODE_FAILED', 'No base is selected');
  const chosen = domain.bases[baseIndex];
  const base: PhysicalBuild['base'] = chosen.kind === 'naked' ? { kind: 'naked' } : { kind: 'preset', presetId: chosen.presetId };

  // --- remaining edge counts, per slot in candidate order ---
  const remaining: Int32Array[] = graph.slots.map(slot => new Int32Array(slot.candidates.length));
  for (const edge of model.edges) {
    remaining[edge.slot.index][edge.slot.candidates.indexOf(edge.child)] = readInteger(values, edge.column, 0, edge.max);
  }

  const placements = model.graph.acyclic ? placeGreedily(model, remaining) : placeBySearch(model, remaining);
  if (placements.kind === 'tree') return { ok: true, build: { base, placements: placements.placements }, baseIndex };
  return { ok: false, baseIndex, reason: placements.reason };
}

type Placed = { kind: 'tree'; placements: PhysicalPlacement[] } | { kind: 'none'; reason: string };

/** Unconsumed edge counts as a message, for the rejection reason. */
function leftover(model: FastModel, remaining: readonly Int32Array[]): string {
  let unplaced = 0;
  let sample = '';
  for (const slot of model.graph.slots) {
    const counts = remaining[slot.index];
    for (let j = 0; j < counts.length; j++) {
      if (counts[j] <= 0) continue;
      unplaced += counts[j];
      if (sample === '') sample = `${counts[j]} x ${model.blueprint.templateIds[slot.candidates[j]]} in ${slot.slotId}`;
    }
  }
  return `${unplaced} counted placement(s) are not reachable from the receiver without repeating an ancestor (for example ${sample})`;
}

/** Breadth-first, first candidate that is allowed: exact on an acyclic graph (see the header). */
function placeGreedily(model: FastModel, remaining: Int32Array[]): Placed {
  const { blueprint: bp, graph } = model;
  const placements: PhysicalPlacement[] = [];
  const queue: PendingInstance[] = [{ id: ROOT_INSTANCE_ID, template: 0, path: new Set([0]) }];
  for (let i = 0; i < queue.length; i++) {
    const instance = queue[i];
    for (const slot of graph.slotsOf[instance.template]) {
      const counts = remaining[slot.index];
      let pick = -1;
      for (let j = 0; j < slot.candidates.length; j++) {
        if (counts[j] > 0 && !instance.path.has(slot.candidates[j])) {
          pick = j;
          break;
        }
      }
      if (pick < 0) continue;
      counts[pick]--;
      const child = slot.candidates[pick];
      const itemId = bp.templateIds[child];
      const childInstanceId = `${instance.id}/${slot.slotId}:${itemId}`;
      placements.push({ parentInstanceId: instance.id, slotId: slot.slotId, childInstanceId, itemId });
      queue.push({ id: childInstanceId, template: child, path: new Set([...instance.path, child]) });
    }
  }
  return remaining.every(counts => counts.every(c => c === 0)) ? { kind: 'tree', placements } : { kind: 'none', reason: leftover(model, remaining) };
}

/** Most decisions the search over a cyclic graph may take before the point is given up as having no tree. */
export const SEARCH_STEP_LIMIT = 200_000;

/**
 * Depth-first search for an arrangement that consumes every edge count: the decisions are (instance, slot) in creation order, each takes one of the
 * allowed candidates that still has a count, or leaves the slot empty when the counts left for that slot can still be placed on the owner copies not
 * yet decided. The first arrangement found is the greedy one whenever the greedy one works.
 */
function placeBySearch(model: FastModel, remaining: Int32Array[]): Placed {
  const { blueprint: bp, graph } = model;
  // Copies of each template the counts call for: the receiver once, every other template as many as its incoming edges.
  const copies = new Int32Array(graph.templateCount);
  copies[0] = 1;
  const slotRemaining = new Int32Array(graph.slots.length);
  for (const slot of graph.slots) {
    slotRemaining[slot.index] = remaining[slot.index].reduce((a, b) => a + b, 0);
    slot.candidates.forEach((c, j) => { copies[c] += remaining[slot.index][j]; });
  }
  let total = slotRemaining.reduce((a, b) => a + b, 0);
  const decided = new Int32Array(graph.slots.length);
  const decisions: { instance: PendingInstance; slot: (typeof graph.slots)[number] }[] = [];
  const placements: PhysicalPlacement[] = [];
  const open = (instance: PendingInstance): void => { for (const slot of graph.slotsOf[instance.template]) decisions.push({ instance, slot }); };
  open({ id: ROOT_INSTANCE_ID, template: 0, path: new Set([0]) });
  let steps = 0;
  let aborted = false;

  const go = (k: number): boolean => {
    if (k === decisions.length) return total === 0;
    if (++steps > SEARCH_STEP_LIMIT) {
      aborted = true;
      return false;
    }
    const { instance, slot } = decisions[k];
    const counts = remaining[slot.index];
    for (let j = 0; j < slot.candidates.length; j++) {
      const child = slot.candidates[j];
      if (counts[j] <= 0 || instance.path.has(child)) continue;
      counts[j]--;
      slotRemaining[slot.index]--;
      total--;
      decided[slot.index]++;
      const itemId = bp.templateIds[child];
      const childInstanceId = `${instance.id}/${slot.slotId}:${itemId}`;
      const length = decisions.length;
      placements.push({ parentInstanceId: instance.id, slotId: slot.slotId, childInstanceId, itemId });
      open({ id: childInstanceId, template: child, path: new Set([...instance.path, child]) });
      if (go(k + 1)) return true;
      decisions.length = length;
      placements.pop();
      decided[slot.index]--;
      total++;
      slotRemaining[slot.index]++;
      counts[j]++;
      if (aborted) return false;
    }
    // Leave the slot empty: only while the counts still left for it fit on the copies of the owner that have not decided it yet.
    decided[slot.index]++;
    if (slotRemaining[slot.index] <= copies[slot.owner] - decided[slot.index] && go(k + 1)) return true;
    decided[slot.index]--;
    return false;
  };

  if (go(0)) return { kind: 'tree', placements };
  return { kind: 'none', reason: aborted ? `no arrangement found within ${SEARCH_STEP_LIMIT} steps` : leftover(model, remaining) };
}
