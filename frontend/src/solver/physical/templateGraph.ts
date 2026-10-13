/**
 * The template-level view of a prepared physical domain (Phase 2.4c, the Fast model).
 *
 * The blueprint unrolls a weapon into path-qualified occurrences (up to 151k on the pinned capture); the Fast model works on the
 * TEMPLATES instead: one count per item template and one count per (template slot, candidate template) edge. This module derives that view
 * from the blueprint and the request's domain masks, so Fast reads exactly the domain Precise reads (the same active occurrences, the same
 * filters, the same supply): nothing here looks at the item lookup, a market or a stash.
 *
 *  - A template slot is identified by its raw slot id. A raw id belongs to exactly one template (the blueprint throws SLOT_ID_COLLISION
 *    otherwise), so the owner of a slot is a function of its id, and the physical slots of one raw id are exactly the slots of the copies of
 *    its owner.
 *  - A candidate edge (slot, child template) exists when some ACTIVE occurrence of the owner has an ACTIVE candidate occurrence of that child
 *    in that slot. The union over occurrences is taken; on an acyclic part graph every active occurrence of a template has the same active
 *    candidates (Lemma 1 of docs/research/acyclic-fast-exactness.md, asserted on every domain by `assertCountModelApplies`), so the union is
 *    what each of them sees.
 *  - `maxCopies[t]` bounds how many copies of a template any physical tree can hold (conflicts and caps ignored): the exact maximum over trees
 *    (a longest-choice dynamic program over the template DAG, so far smaller than the occurrence count: a rail segment that fits twelve rails
 *    can have thousands of occurrences and still at most a dozen copies).
 *
 * The graph is ACYCLIC (owner decision 2026-10-12: no gun has a cyclic part graph). The blueprint builder throws an internal `CYCLIC_PART_GRAPH`
 * error on a cycle reachable from the receiver, and every candidate edge here is an edge of that unrolling, so the topological order below
 * covers every active template.
 */

import type { PhysicalBlueprint } from './blueprint';
import type { SubproblemDomain } from './domain';
import { PhysicalModelError } from './errors';

/** One template slot: a raw slot id, its owner template, and the candidate templates that can fill it. */
export interface TemplateSlot {
  /** Position in `TemplateGraph.slots`. */
  readonly index: number;
  /** Index into `PhysicalBlueprint.rawSlotIds`. */
  readonly rawIdx: number;
  readonly slotId: string;
  /** Owner template (0 = the receiver). */
  readonly owner: number;
  readonly required: boolean;
  /** Candidate template indexes, ascending. */
  readonly candidates: readonly number[];
}

export interface TemplateGraph {
  readonly templateCount: number;
  /** 1 for the receiver and for every template with at least one active occurrence. */
  readonly active: Uint8Array;
  /** Slots with at least one candidate, ascending by raw id. */
  readonly slots: readonly TemplateSlot[];
  /** The slots each template owns (every template index has an entry). */
  readonly slotsOf: readonly (readonly TemplateSlot[])[];
  /** For each template, the slots listing it as a candidate. */
  readonly slotsHolding: readonly (readonly TemplateSlot[])[];
  /** Total candidate edges. */
  readonly edgeCount: number;
  /** Topological order of the active templates, the receiver first (parents before children). */
  readonly topological: Int32Array;
  /** Upper bound on the copies of each template in any physical tree (0 for an inactive template; the receiver has 1). */
  readonly maxCopies: Int32Array;
}

export function buildTemplateGraph(blueprint: PhysicalBlueprint, domain: SubproblemDomain): TemplateGraph {
  if (domain.empty) throw new PhysicalModelError('DOMAIN_INCONSISTENT', 'The template graph of an empty domain is undefined', { weaponId: blueprint.weaponId });
  const T = blueprint.templateCount;
  const R = blueprint.rawSlotIds.length;
  const { occTemplate, occSlotStart, slotCandStart, slotCandCount, slotRawIdArray } = blueprint;
  const active = new Uint8Array(T);
  active[0] = 1;
  for (let t = 1; t < T; t++) if (domain.templateActiveCount[t] > 0) active[t] = 1;

  // --- slots and candidate edges, one pass over the active occurrences (each occurrence is a candidate of exactly one slot) ---
  const ownerOfRaw = new Int32Array(R).fill(-1);
  const requiredOfRaw = new Uint8Array(R);
  const candidateSets: (Set<number> | undefined)[] = new Array<Set<number> | undefined>(R);
  for (let v = 0; v < blueprint.occurrenceCount; v++) {
    if (!domain.occActive[v]) continue;
    const owner = occTemplate[v];
    for (let s = occSlotStart[v]; s < occSlotStart[v + 1]; s++) {
      const raw = slotRawIdArray[s];
      ownerOfRaw[raw] = owner;
      if (blueprint.slotRequired(s)) requiredOfRaw[raw] = 1;
      let set = candidateSets[raw];
      for (let c = slotCandStart[s], end = c + slotCandCount[s]; c < end; c++) {
        if (!domain.occActive[c]) continue;
        if (!set) { set = new Set(); candidateSets[raw] = set; }
        set.add(occTemplate[c]);
      }
    }
  }
  const slots: TemplateSlot[] = [];
  const slotsOf: TemplateSlot[][] = Array.from({ length: T }, () => []);
  const slotsHolding: TemplateSlot[][] = Array.from({ length: T }, () => []);
  let edgeCount = 0;
  for (let raw = 0; raw < R; raw++) {
    const owner = ownerOfRaw[raw];
    if (owner < 0) continue;
    const set = candidateSets[raw];
    if (!set || set.size === 0) {
      if (requiredOfRaw[raw]) {
        throw new PhysicalModelError('DOMAIN_INCONSISTENT', `An active occurrence of ${blueprint.templateIds[owner]} owns the required slot ${blueprint.rawSlotIds[raw]} with no active candidate`, { slot: blueprint.rawSlotIds[raw] });
      }
      continue;
    }
    const slot: TemplateSlot = {
      index: slots.length,
      rawIdx: raw,
      slotId: blueprint.rawSlotIds[raw],
      owner,
      required: requiredOfRaw[raw] === 1,
      candidates: [...set].sort((a, b) => a - b),
    };
    slots.push(slot);
    slotsOf[owner].push(slot);
    for (const c of slot.candidates) slotsHolding[c].push(slot);
    edgeCount += slot.candidates.length;
  }

  // --- topological order (Kahn) over the active templates ---
  const indegree = new Int32Array(T);
  for (const slot of slots) for (const c of slot.candidates) indegree[c]++;
  // A candidate edge into the receiver cannot exist (the receiver is an ancestor of everything), so the receiver starts the order.
  const order: number[] = [];
  const queue: number[] = [];
  for (let t = 0; t < T; t++) if (active[t] && indegree[t] === 0) queue.push(t);
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i];
    order.push(t);
    for (const slot of slotsOf[t]) for (const c of slot.candidates) if (--indegree[c] === 0) queue.push(c);
  }

  return {
    templateCount: T,
    active,
    slots,
    slotsOf,
    slotsHolding,
    edgeCount,
    topological: Int32Array.from(order),
    maxCopies: copyBounds(blueprint, domain, active, slotsOf, order),
  };
}

/**
 * Upper bound on the copies of each template: the exact maximum over physical trees, K_c(t) = [t = c] + sum over the slots r of t
 * of max over the candidates d of K_c(d), evaluated children first for every target c (each slot of a copy holds one child, whatever else holds
 * the others), then the receiver's value. Capped by the active occurrence count and by 1 for a self-conflicting template.
 */
function copyBounds(
  blueprint: PhysicalBlueprint,
  domain: SubproblemDomain,
  active: Uint8Array,
  slotsOf: readonly (readonly TemplateSlot[])[],
  topological: readonly number[],
): Int32Array {
  const T = blueprint.templateCount;
  const bounds = new Int32Array(T);
  bounds[0] = 1;
  const k = new Float64Array(T);
  for (let c = 1; c < T; c++) {
    if (!active[c]) continue;
    let bound = domain.templateActiveCount[c];
    if (blueprint.templateSelfConflict[c] === 1) bound = Math.min(bound, 1);
    if (bound > 1) {
      k.fill(0);
      for (let i = topological.length - 1; i >= 0; i--) {
        const t = topological[i];
        let total = t === c ? 1 : 0;
        for (const slot of slotsOf[t]) {
          let best = 0;
          for (const d of slot.candidates) if (k[d] > best) best = k[d];
          total += best;
        }
        k[t] = total;
      }
      bound = Math.min(bound, k[0]);
    }
    bounds[c] = Math.max(1, bound);
  }
  return bounds;
}
