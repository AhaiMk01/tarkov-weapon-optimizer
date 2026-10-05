/**
 * Public reason strings of ADR 0013 section 6, verbatim: a CLOSED set. Locale mappings cover these strings, so no code builds an alias and no
 * response carries any other reason. `outcome.ts` chooses among them (precedence), the pipelines only report what they observed.
 */
export const PUBLIC_REASONS = {
  approximateModelInfeasible: 'Approximate model infeasible',
  provisionalMoaModelInfeasible: 'Provisional MOA model infeasible',
  fastProvisionalMoaModelInfeasible: 'Fast provisional MOA model infeasible',
  invalidOwnedItems: 'Invalid owned_items format',
  queueTimeoutBeforeDispatch: 'Queue timeout before dispatch',
  independentBuildValidationFailed: 'Independent build validation failed',
  requiredProofPrerequisiteUnavailable: 'Required proof prerequisite unavailable',
  cancelledByUser: 'Cancelled by user',
  timeLimitReached: 'Time limit reached',
  nodeLimitReached: 'Node limit reached',
  nativeSolutionLimitReached: 'Native solution limit reached',
} as const;

export type PublicReason = (typeof PUBLIC_REASONS)[keyof typeof PUBLIC_REASONS];

/** Every public reason, for the tests that check a response never leaves the closed set. */
export const PUBLIC_REASON_SET: ReadonlySet<string> = new Set<string>(Object.values(PUBLIC_REASONS));

/**
 * The INTERNAL diagnostic of a spatial search that ends before certification and has no ADR string: a node interval that can no longer be
 * split while its bound still exceeds the incumbent by more than the tolerance. It never reaches a response: `outcome.ts` reports it as
 * `Required proof prerequisite unavailable` (a representation/numerical proof prerequisite is missing; no interrupt was hit) with
 * termination `limit`. See the decision note in `outcome.ts`.
 */
export const INTERVAL_RESOLUTION_REASON = 'Numerical interval resolution reached before certification';

/**
 * The public reason of a native model status that ended a solve with neither an optimum nor an infeasibility verdict. The time limit and the
 * solution limit are the two pure native interrupts. Every other limit status (iteration, objective bound or target, interrupt, memory,
 * unknown) is a native search that ended without a proof for a reason that is not a clock or a cap of ours: its own text is not in the closed
 * set, so it is a proof prerequisite that is unavailable.
 */
export function reasonOfNativeLimit(status: string): PublicReason {
  if (status === 'TimeLimit') return PUBLIC_REASONS.timeLimitReached;
  if (status === 'SolutionLimit') return PUBLIC_REASONS.nativeSolutionLimitReached;
  return PUBLIC_REASONS.requiredProofPrerequisiteUnavailable;
}
