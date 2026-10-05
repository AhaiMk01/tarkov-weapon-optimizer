/**
 * Public reason strings of ADR 0013 section 6, verbatim. Locale mappings cover these strings, so no code builds an alias.
 *
 * Phase 2.4b-3b uses the subset it can produce; the full status/certificate transport is Phase 2.6.
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

/**
 * The factual reason of a spatial search that ends before certification and has no ADR string: a node interval that can no longer be
 * split while its bound still exceeds the incumbent. Kept out of {@link PUBLIC_REASONS} because ADR 0013 does not list it.
 */
export const INTERVAL_RESOLUTION_REASON = 'Numerical interval resolution reached before certification';
