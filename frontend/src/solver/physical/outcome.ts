/**
 * The Optimize outcome classifier (ADR 0013 section 6, Phase 2.6): a PURE function from what a search established to the public status,
 * certificate, qualifications, termination and reason of an `OptimizeResponse`. It knows nothing about HiGHS, LP text or builds; the Precise
 * pipeline (`solvePrecise.ts`) and the Fast pipeline (`solveFast.ts`) each report the same small set of facts, and `solver.ts` only assembles.
 *
 * The table (section 6), with D = the request carries a MOA cap (it depends on the provisional MOA model):
 *
 *   end        mode     status / certificate                                  qualification        termination  reason
 *   optimum    precise  optimal / certified_optimal  (D: approximate_optimal)  exact, moa null (D: provisional_model)  optimal  none
 *   optimum    fast     optimal / approximate_optimal                          approximate, moa kept  optimal  none
 *   empty      precise  infeasible / certified_infeasible                      exact, moa null        optimal  none
 *   empty      precise  (D) incomplete / none                                  exact, provisional     optimal  Provisional MOA model infeasible
 *   empty      fast     incomplete / none                                      approximate, moa kept  optimal  Approximate model infeasible
 *   empty      fast     (D) incomplete / none                                  approximate, provisional  optimal  Fast provisional MOA model infeasible
 *   unproved   witness  feasible / feasible                                    resolved qualifiers    completion  by precedence
 *   unproved   none     incomplete / none                                      resolved qualifiers    completion  by precedence
 *   (invalid owned_items, before any model work)  incomplete / none, null resolved fields, termination limit, Invalid owned_items format
 *
 * `termination` is search completion ONLY: `optimal` when the executed model search finished (the emptiness and optimum rows always, and a
 * finished search whose proof or candidate was then withheld), `limit` when it was unfinished or never started. It carries no authority: the
 * certificate and the reason do.
 *
 * Reason precedence (section 6):
 *   1. a completed qualified proof wins and is never downgraded: an `optimum` or `empty` end ignores every observed flag;
 *   2. otherwise an observed validation failure, then an observed proof-prerequisite failure, outrank every coincident interrupt (the ADR names
 *      both without ordering them: a rejected build is a concrete fact about the candidate, so it is reported first);
 *   3. otherwise the pure interrupts in the order cancel, deadline, node limit, native solution limit;
 *   4. a stop with no observed cause (an optimum whose proof was withheld, a spatial interval too narrow to split) is a proof prerequisite
 *      that is not available.
 *
 * Interval resolution (the one stop cause the ADR does not list). A spatial search that cannot split a node interval any further while the
 * node's bound still exceeds the incumbent by more than the tolerance (`INTERVAL_RESOLUTION_REASON`, internal) is reported as
 * `Required proof prerequisite unavailable` with termination `limit`: the representable weight resolution is a prerequisite of the proof that
 * is missing (the section 6 no-proof rows cover "representation proof withholding"), it is no interrupt (no clock, node cap or native limit was
 * hit), and the search is unfinished. No public reason is invented for it; the owner may add one later.
 */

import type { ModelQualification, MoaQualification, PhysicalCertificate, PrecisionResolved, SolveStatus } from '../types';
import { INTERVAL_RESOLUTION_REASON, PUBLIC_REASONS } from './reasons';

export type ResolvedMode = 'fast' | 'precise';

/** Factual stop observations of one search. Each field is a fact the pipeline saw, not a verdict about the result. */
export interface StopObservations {
  /** An out-of-band cancel was observed. */
  cancelled?: boolean;
  /** The request deadline (or the native time limit derived from it) was reached. */
  deadline?: boolean;
  /** The spatial node cap was reached. */
  nodeLimit?: boolean;
  /** A native solution limit stopped a solve. */
  nativeSolutionLimit?: boolean;
  /** A candidate failed decoding or independent validation, or was rejected repeatedly. */
  validationFailed?: boolean;
  /** A representation, parser, native or numerical proof prerequisite was unavailable (the proof or the proof input was withheld). */
  proofPrerequisiteUnavailable?: boolean;
}

/** How the executed search ended, as far as proof goes. */
export type SearchEnd =
  /** It finished and established the optimum: Precise a qualified bound within the tolerance of a verified witness, Fast a native optimum. */
  | 'optimum'
  /** It finished and established that the model has no point: Precise proved (qualified solves), Fast the native verdict. */
  | 'empty'
  /** Anything else: interrupted, withheld, rejected or unstarted. */
  | 'unproved';

export interface OptimizeFacts {
  /** The model that ran. */
  mode: ResolvedMode;
  /** The request carries a MOA cap, so the result depends on the provisional MOA model. */
  moaDependent: boolean;
  end: SearchEnd;
  /** An independently verified build exists (a prior or the current witness). */
  witness: boolean;
  /** The executed model search finished (search completion only, never proof authority). */
  searchFinished: boolean;
  observed?: StopObservations;
}

export interface OptimizeOutcome {
  status: SolveStatus;
  physical_certificate: PhysicalCertificate;
  precision_resolved: PrecisionResolved;
  model_qualification: ModelQualification;
  moa_qualification: MoaQualification;
  termination: 'optimal' | 'limit';
  /** One of the closed set of public reasons; absent when none is required. */
  reason?: string;
}

const moaQualificationOf = (moaDependent: boolean): MoaQualification => (moaDependent ? 'provisional_model' : null);

/** A request depends on the provisional MOA model exactly when it carries a MOA cap (absence is null: a cap of 0 or below is a real cap). */
export const isMoaDependent = (params: { maxMOA?: number | null }): boolean => params.maxMOA != null;

/** The public reason of the observed stop, by the precedence above. Total: a stop with no observed cause is an unavailable prerequisite. */
export function stopReason(observed: StopObservations = {}): string {
  if (observed.validationFailed) return PUBLIC_REASONS.independentBuildValidationFailed;
  if (observed.proofPrerequisiteUnavailable) return PUBLIC_REASONS.requiredProofPrerequisiteUnavailable;
  if (observed.cancelled) return PUBLIC_REASONS.cancelledByUser;
  if (observed.deadline) return PUBLIC_REASONS.timeLimitReached;
  if (observed.nodeLimit) return PUBLIC_REASONS.nodeLimitReached;
  if (observed.nativeSolutionLimit) return PUBLIC_REASONS.nativeSolutionLimitReached;
  return PUBLIC_REASONS.requiredProofPrerequisiteUnavailable;
}

/**
 * The observation behind one internal stop reason: a public reason maps to its own observation, the internal interval-resolution reason to an
 * unavailable proof prerequisite (see the header), and anything else (a native text outside the closed set must never reach here) to the same.
 */
export function observationsOfReason(reason: string | null | undefined): StopObservations {
  switch (reason) {
    case null:
    case undefined: return {};
    case PUBLIC_REASONS.cancelledByUser: return { cancelled: true };
    case PUBLIC_REASONS.timeLimitReached: return { deadline: true };
    case PUBLIC_REASONS.nodeLimitReached: return { nodeLimit: true };
    case PUBLIC_REASONS.nativeSolutionLimitReached: return { nativeSolutionLimit: true };
    case PUBLIC_REASONS.independentBuildValidationFailed: return { validationFailed: true };
    case PUBLIC_REASONS.requiredProofPrerequisiteUnavailable:
    case INTERVAL_RESOLUTION_REASON:
    default: return { proofPrerequisiteUnavailable: true };
  }
}

/** The fenced reason of a model emptiness that carries no physical authority (a completed search, no certificate). */
function emptinessReason(mode: ResolvedMode, moaDependent: boolean): string {
  if (mode === 'fast') return moaDependent ? PUBLIC_REASONS.fastProvisionalMoaModelInfeasible : PUBLIC_REASONS.approximateModelInfeasible;
  return PUBLIC_REASONS.provisionalMoaModelInfeasible;
}

/** Classify one executed search. Pure, total over consistent facts; inconsistent facts (a programming error) throw. */
export function classifyOptimize(facts: OptimizeFacts): OptimizeOutcome {
  const { mode, moaDependent, end, witness, searchFinished } = facts;
  if (end === 'optimum' && !(witness && searchFinished)) throw new Error('classifyOptimize: an optimum needs a verified witness and a finished search');
  if (end === 'empty' && (witness || !searchFinished)) throw new Error('classifyOptimize: an emptiness needs a finished search and no witness');
  const base = {
    precision_resolved: mode,
    model_qualification: mode === 'precise' ? 'exact' : 'approximate',
    moa_qualification: moaQualificationOf(moaDependent),
  } as const;

  if (end === 'optimum') {
    // Only a Precise optimum that does not lean on the provisional MOA model is a physical certificate.
    const certified = mode === 'precise' && !moaDependent;
    return { ...base, status: 'optimal', physical_certificate: certified ? 'certified_optimal' : 'approximate_optimal', termination: 'optimal' };
  }
  if (end === 'empty') {
    if (mode === 'precise' && !moaDependent) return { ...base, status: 'infeasible', physical_certificate: 'certified_infeasible', termination: 'optimal' };
    return { ...base, status: 'incomplete', physical_certificate: 'none', termination: 'optimal', reason: emptinessReason(mode, moaDependent) };
  }
  return {
    ...base,
    status: witness ? 'feasible' : 'incomplete',
    physical_certificate: witness ? 'feasible' : 'none',
    termination: searchFinished ? 'optimal' : 'limit',
    reason: stopReason(facts.observed),
  };
}

/**
 * An invalid `owned_items` list is rejected before hashing, caching or any model work: nothing resolved, no certificate, search never started.
 * The MOA qualification stays what the request says (a cap it carries), since the stash check does not run the model either way.
 */
export function invalidOwnedItemsOutcome(moaDependent: boolean): OptimizeOutcome {
  return {
    status: 'incomplete',
    physical_certificate: 'none',
    precision_resolved: null,
    model_qualification: null,
    moa_qualification: moaQualificationOf(moaDependent),
    termination: 'limit',
    reason: PUBLIC_REASONS.invalidOwnedItems,
  };
}
