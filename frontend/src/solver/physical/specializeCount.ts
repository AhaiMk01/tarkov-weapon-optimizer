/**
 * The certifiable count model of Precise (owner decision 2e, Phase 2.10; docs/research/acyclic-fast-exactness.md; ADR 0013 sections 4A and 4C).
 *
 * On an acyclic part graph (owner decision 2d) Precise does not need path-qualified occurrence variables. The template-level count model of Fast
 * (`specializeFast.ts`: one integer count per item template, one integer count per slot edge) projects onto exactly the physical feasible set, and the
 * model emitted here is that model built THROUGH THE PROOF LAYER, so a solve of it can carry a certificate:
 *
 *   - every constructed coefficient (the recoil caps, the MOA rows, the weighted or Tchebycheff objective, the gear factor, the weight-penalty secant) is built
 *     in exact rationals and rounded outward in the direction that relaxes its row (`proof.ts`), the emitted model is an OUTER RELAXATION of the physical
 *     problem, and `CountModel.proof` records the exact need of every padded row, the objective's frame error and the secant, which is what
 *     `assessNativeResult` (readback equal, allowances dominating, declared tolerances, presolve off) and the bound evidence read;
 *   - every other row is a binary64 leaf or a small integer: the statistics are `sum n_t x leaf`, so the text is the model;
 *   - every auxiliary has a finite enclosed domain; clamps specialize to leaf-only graph rows, and MOA and presence Big-Ms come from active ranges;
 *   - several copies of a part are always allowed (the `singleCopy` restriction of Fast is not read);
 *   - the MOA rows state the oracle's rule exactly: the cap binds the installed barrel with the LARGEST centre of impact (`FastModelOptions.moaDominance`), so the
 *     one place the plain Fast rows differ from the oracle is gone, not guarded.
 *
 * What makes the count model exact (research sections 3 to 5): on an acyclic ACTIVE template graph every active occurrence of one template has the same active
 * candidates in every slot (Lemma 1), so a rooted physical tree is exactly a rooted tree of templates with the union candidate sets, slot capacity and required
 * occupancy are per-template counts (a transportation problem on a DAG, realized by the greedy decoder `decodeFast`), the ancestor rule is vacuous, and every
 * other rule is copy-agnostic or global by raw slot id. The two directions a certificate needs are kept apart:
 *
 *   LIFTING   every physical build is an integer point of the model with the same objective. This is what the CERTIFICATE rests on: an upper bound of the
 *             model is an upper bound of the physical optimum, and an infeasible model has no physical build. It needs only the unions, the copy bounds, the rows
 *             being implied by the physical rules, and the outward padding.
 *   PROJECTION every integer point decodes to a physical build of the same installed multiset. This needs acyclicity; it is what makes the model's optimum
 *             reachable by a verified witness. A point that fails the decode or the exact validator (a tolerance boundary) is cut out and the node re-solved,
 *             and a witness is published only after the independent validator accepted it, so a projection failure can lose a witness, never fake a certificate.
 *
 * Preconditions (owner decision 2026-10-12). Part graphs are acyclic (no gun has a cyclic one): the blueprint builder throws an internal `CYCLIC_PART_GRAPH`
 * error on a cycle reachable from the receiver, so the active graph of every domain is acyclic too. Lemma 1 then holds by theorem; its conclusion is still
 * verified on every domain (`assertCountModelApplies`: the candidate templates of every active
 * occurrence's slot equal the graph's union set) as an internal assertion, and a failure is a solver error, never a fallback to another model.
 *
 * TrueErgo and Prevent Overswing: the weight is an aggregate the count model carries exactly (`weight = receiver + sum n_t x weight_t`), a weight node is rows on
 * it, and the node's penalty line is a function of the weight only. Node by node the model's integer points project onto exactly the physical builds whose weight
 * lies in the node, with the same objective function of the projection as the occurrence model, so the spatial search over weight transfers unchanged.
 */

import type { PhysicalBlueprint } from './blueprint';
import type { SubproblemDomain } from './domain';
import { PhysicalModelError } from './errors';
import type { ModelProof } from './proof';
import type { SpatialNode, SpecializeRequest } from './specialize';
import { specializeFast, templateStructureOf, type CountRowFamilyRecord, type FastModel, type FastModelOptions } from './specializeFast';

/** A certified count model: a `FastModel` that carries its proof record and row families. */
export interface CountModel extends FastModel {
  readonly certified: true;
  readonly proof: ModelProof;
  readonly rowFamilies: readonly CountRowFamilyRecord[];
}

export interface CountModelCheck {
  /** Slots of active occurrences whose candidate templates were compared with the graph's union set (Lemma 1, checked on the data). */
  slotsChecked: number;
}

const checkMemo = new WeakMap<SubproblemDomain, CountModelCheck>();

/**
 * Assert that the count model is exact for a prepared, nonempty domain (see the module comment): the conclusion of Lemma 1 holds on
 * this very domain (a failure throws `DOMAIN_INCONSISTENT`: it would contradict the theorem, so it is a fault, and the caller reports it as a solver error,
 * never by falling back to another model). Memoized per (immutable) domain.
 */
export function assertCountModelApplies(blueprint: PhysicalBlueprint, domain: SubproblemDomain): CountModelCheck {
  if (domain.blueprint !== blueprint) {
    throw new PhysicalModelError('FOREIGN_DOMAIN', `The domain was not prepared from the blueprint of ${blueprint.weaponId}`, { weaponId: blueprint.weaponId });
  }
  const cached = checkMemo.get(domain);
  if (cached !== undefined) return cached;
  if (domain.empty) throw new PhysicalModelError('DOMAIN_INCONSISTENT', 'An empty domain has no count model to check: its emptiness is decided by the domain', { weaponId: blueprint.weaponId });
  const { graph } = templateStructureOf(blueprint, domain);
  const check = candidateSetsAgree(blueprint, domain, graph.slots);
  if (check.disagreement !== null) {
    throw new PhysicalModelError('DOMAIN_INCONSISTENT', `Lemma 1 fails on an acyclic part graph: the active candidates of a slot depend on the path (${check.disagreement})`, { weaponId: blueprint.weaponId });
  }
  const result = { slotsChecked: check.checked };
  checkMemo.set(domain, result);
  return result;
}

/**
 * The conclusion of Lemma 1 on the data: every ACTIVE occurrence's slot lists, among its ACTIVE candidates, exactly the templates of the graph's union set of
 * that raw slot id. (A slot an active occurrence owns that the graph has no entry for must have no active candidate.) Linear in the active occurrences' slots.
 */
function candidateSetsAgree(
  bp: PhysicalBlueprint, domain: SubproblemDomain, slots: readonly { rawIdx: number; candidates: readonly number[] }[],
): { checked: number; disagreement: string | null } {
  const expected = new Map<number, ReadonlySet<number>>();
  for (const slot of slots) expected.set(slot.rawIdx, new Set(slot.candidates));
  const none: ReadonlySet<number> = new Set();
  const stamp = new Int32Array(bp.templateCount).fill(-1);
  let next = 0;
  let checked = 0;
  for (let v = 0; v < bp.occurrenceCount; v++) {
    if (!domain.occActive[v]) continue;
    for (let s = bp.occSlotStart[v]; s < bp.occSlotStart[v + 1]; s++) {
      const raw = bp.slotRawIdArray[s];
      const want = expected.get(raw) ?? none;
      const mark = next++;
      let distinct = 0;
      let outside = -1;
      for (let c = bp.slotCandStart[s], end = c + bp.slotCandCount[s]; c < end; c++) {
        if (!domain.occActive[c]) continue;
        const t = bp.occTemplate[c];
        if (stamp[t] === mark) continue;
        stamp[t] = mark;
        distinct++;
        if (!want.has(t)) outside = t;
      }
      checked++;
      if (outside >= 0 || distinct !== want.size) {
        const owner = bp.templateIds[bp.occTemplate[v]];
        return { checked, disagreement: `${owner} slot ${bp.rawSlotIds[raw]} lists ${distinct} active candidate template(s), the union has ${want.size}${outside >= 0 ? ` (${bp.templateIds[outside]} is outside it)` : ''}` };
      }
    }
  }
  return { checked, disagreement: null };
}

/**
 * Specialize the certified count model of one request (see the module comment). Asserts first that the model applies (`assertCountModelApplies`):
 * a certificate is never built on an unverified graph.
 *
 * @param node Optional weight node, read only by requests that use TED (`SpatialNode`).
 * @param options `moaDominance: 'always'` states the larger-centre-of-impact MOA terms on every MOA model (tests); the default states them when they can matter.
 */
export function specializeCount(
  blueprint: PhysicalBlueprint, domain: SubproblemDomain, request: SpecializeRequest = {}, node?: SpatialNode, options: Pick<FastModelOptions, 'moaDominance'> = {},
): CountModel {
  if (!domain.empty) assertCountModelApplies(blueprint, domain);
  const model = specializeFast(blueprint, domain, request, node, { certified: true, moaDominance: options.moaDominance });
  if (!model.certified || model.proof === null || model.rowFamilies === null) {
    throw new PhysicalModelError('DOMAIN_INCONSISTENT', 'The certified count model came back without its proof record', { weaponId: blueprint.weaponId });
  }
  return model as CountModel;
}
