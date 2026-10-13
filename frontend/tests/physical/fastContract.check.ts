// The Fast contract (Stage 3 workstream 3.4; ADR 0013 sections 6 and 7; stage 2 decisions 2a, 2b, 2c) as one pure check of a production
// `OptimizeResponse` from a Fast request:
//
//   - every PUBLISHED witness (status optimal or feasible) validates in the adopted physical domain: the production validator
//     (`validatePhysicalBuild`, path-derived instance ids demanded) accepts the published base and placements against the request's hard
//     constraints, TED included (Prevent Overswing: TED >= 0);
//   - every outcome is truthfully qualified: never `certified_optimal` or `certified_infeasible`, never status `infeasible`; resolved
//     `fast` / `approximate`; the section 6 status/certificate pairs (optimal <-> approximate_optimal, feasible <-> feasible, incomplete <-> none);
//     no physical upper bound or gap; a reason from the closed public set exactly when the table requires one; a completed empty model search
//     reports the approximate-model reason (or the Fast provisional-MOA reason under a MOA cap), never infeasibility;
//   - owner decision 2c: `single_copy` is present exactly when repeats are not allowed, and a single-copy build installs no part twice.
//
// It returns the list of violations (empty = the response honours the contract), so the unit tests and the 172-gun benchmark share it.
import type { OptimizeResponse } from '../../src/api/client';
import { validatePhysicalBuild } from '../../src/solver/physical';
import type { PhysicalBuild, PhysicalValidation } from '../../src/solver/physical';
import { PUBLIC_REASONS, PUBLIC_REASON_SET } from '../../src/solver/physical/reasons';
import type { SolveParams } from '../../src/solver/types';

/** The envelopes production returns before any model work: nothing is resolved, there is no build. */
const PRE_MODEL_REASONS: ReadonlySet<string> = new Set([PUBLIC_REASONS.invalidOwnedItems]);

export const returnsBuild = (r: Pick<OptimizeResponse, 'status'>): boolean => r.status === 'optimal' || r.status === 'feasible';

/** The published build as the production validator reads it. */
export function publishedBuild(params: SolveParams, r: OptimizeResponse): PhysicalBuild {
  const presetId = r.selected_preset?.id;
  return {
    base: presetId === undefined || presetId === params.weaponId ? { kind: 'naked' } : { kind: 'preset', presetId },
    placements: r.slot_pairs ?? [],
  };
}

/** The production validator's verdict on the published build (path-derived instance ids demanded, the request's own physical options). */
export function validatePublished(params: SolveParams, r: OptimizeResponse): PhysicalValidation {
  return validatePhysicalBuild(params.itemLookup, params, publishedBuild(params, r), {
    requirePathInstanceIds: true,
    isAmmo: params.physicalOptions?.isAmmo,
    categoryChainOf: params.physicalOptions?.categoryChainOf,
  });
}

export interface FastContractReport {
  violations: string[];
  /** The production validator's verdict, when a build was published. */
  validation: PhysicalValidation | null;
}

/** Checks one Fast response against the contract. `params` is the request as sent (`preciseMode` false). */
export function checkFastContract(params: SolveParams, r: OptimizeResponse): FastContractReport {
  const v: string[] = [];
  const add = (msg: string) => v.push(msg);
  if (params.preciseMode === true) add('checkFastContract called on a Precise request');

  // --- qualification, whatever the outcome ---------------------------------------------------------------------------------------------
  if (r.physical_certificate === 'certified_optimal' || r.physical_certificate === 'certified_infeasible') add(`Fast carries a certificate: ${r.physical_certificate}`);
  if (r.status === 'infeasible') add('Fast reported status infeasible (a Fast emptiness is never a proof)');
  if (!['optimal', 'feasible', 'incomplete'].includes(r.status)) add(`unexpected status ${r.status}`);
  if (r.reason !== undefined && !PUBLIC_REASON_SET.has(r.reason)) add(`reason outside the closed public set: ${JSON.stringify(r.reason)}`);
  const opt = r.optimization;
  if (opt === undefined) add('no optimization metadata');
  else {
    if (opt.upper_bound !== null) add(`Fast published a physical upper bound ${opt.upper_bound}`);
    if (opt.absolute_gap !== null) add(`Fast published a gap ${opt.absolute_gap}`);
    if (opt.termination !== 'optimal' && opt.termination !== 'limit') add(`termination ${String(opt.termination)}`);
  }
  const expectedRequest = params.precisionRequest ?? 'fast';
  if (r.precision_request !== expectedRequest) add(`precision_request ${String(r.precision_request)}, expected ${expectedRequest}`);

  const preModel = r.reason !== undefined && PRE_MODEL_REASONS.has(r.reason);
  if (preModel) {
    if (r.status !== 'incomplete' || r.physical_certificate !== 'none') add(`pre-model envelope ${r.status}/${r.physical_certificate}`);
    if (r.precision_resolved !== null || r.model_qualification !== null) add('pre-model envelope resolved a mode');
  } else {
    if (r.precision_resolved !== 'fast') add(`precision_resolved ${String(r.precision_resolved)}`);
    if (r.model_qualification !== 'approximate') add(`model_qualification ${String(r.model_qualification)}`);
    const moa = params.maxMOA != null ? 'provisional_model' : null;
    if (r.moa_qualification !== moa) add(`moa_qualification ${String(r.moa_qualification)}, expected ${String(moa)}`);
    const singleCopy = params.allowRepeatedParts !== true;
    if ((r.single_copy === true) !== singleCopy) add(`single_copy ${String(r.single_copy)} with allowRepeatedParts ${String(params.allowRepeatedParts)}`);
  }

  // --- status / certificate pairs (ADR 0013 section 6) ---------------------------------------------------------------------------------
  if (r.status === 'optimal') {
    if (r.physical_certificate !== 'approximate_optimal') add(`optimal with certificate ${r.physical_certificate}`);
    if (r.reason !== undefined) add(`optimal with a reason: ${r.reason}`);
    if (opt?.termination !== 'optimal') add('optimal with termination limit');
  } else if (r.status === 'feasible') {
    if (r.physical_certificate !== 'feasible') add(`feasible with certificate ${r.physical_certificate}`);
    if (r.reason === undefined) add('feasible without a reason');
  } else if (r.status === 'incomplete') {
    if (r.physical_certificate !== 'none') add(`incomplete with certificate ${r.physical_certificate}`);
    if (r.reason === undefined) add('incomplete without a reason');
    // A completed empty model search: the approximate-model reason, never an infeasibility claim. (A completed search whose candidates were all
    // rejected reports the validation failure instead; both are completed searches.)
    if (!preModel && opt?.termination === 'optimal') {
      const empties: string[] = params.maxMOA != null
        ? [PUBLIC_REASONS.fastProvisionalMoaModelInfeasible]
        : [PUBLIC_REASONS.approximateModelInfeasible];
      const allowed = [...empties, PUBLIC_REASONS.independentBuildValidationFailed, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable];
      if (r.reason !== undefined && !allowed.includes(r.reason)) add(`completed search with no build reports ${r.reason}`);
    }
  }

  // --- the build ------------------------------------------------------------------------------------------------------------------------
  let validation: PhysicalValidation | null = null;
  if (returnsBuild(r)) {
    if (r.selected_preset === undefined) add('a published build without selected_preset');
    if (!Array.isArray(r.slot_pairs)) add('a published build without slot_pairs');
    if (r.objective_value === null || !Number.isFinite(r.objective_value)) add(`objective_value ${String(r.objective_value)}`);
    if (opt && opt.lower_bound !== null && r.objective_value !== null && opt.lower_bound > r.objective_value) add(`lower_bound ${opt.lower_bound} above the objective ${r.objective_value}`);
    validation = validatePublished(params, r);
    if (!validation.ok) add(`production validator rejects the published build: ${JSON.stringify(validation.violations.slice(0, 4))}`);
    // instances and the installed multiset agree
    const ids = (r.selected_items ?? []).map(i => i.id).sort();
    const placed = (r.slot_pairs ?? []).map(p => p.itemId).sort();
    if (JSON.stringify(ids) !== JSON.stringify(placed)) add('selected_items and slot_pairs disagree');
    if (JSON.stringify([...(r.selected_item_ids ?? [])].sort()) !== JSON.stringify(placed)) add('selected_item_ids and slot_pairs disagree');
    if (params.allowRepeatedParts !== true && new Set(placed).size !== placed.length) add(`single copy, yet a part is installed twice: ${placed.join(',')}`);
    if (params.preventOverswing === true && validation.stats !== null && validation.stats.ted < 0) add(`Prevent Overswing, yet TED ${validation.stats.ted}`);
  } else {
    if ((r.slot_pairs ?? []).length > 0 || (r.selected_item_ids ?? []).length > 0) add(`status ${r.status} with a build attached`);
    if (r.objective_value !== null && r.objective_value !== undefined) add(`status ${r.status} with objective_value ${r.objective_value}`);
    if (opt && opt.lower_bound !== null) add(`status ${r.status} with lower_bound ${opt.lower_bound}`);
  }
  return { violations: v, validation };
}
