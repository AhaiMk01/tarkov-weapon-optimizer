/**
 * Typed failures of the physical-model preparation (blueprint and subproblem domain).
 *
 * These are input or evidence failures, never proofs of infeasibility: a caller must not turn one into an
 * `infeasible` status (ADR 0002 section 5, ADR 0013 section 4A).
 */

export type PhysicalModelErrorCode =
  /** The weapon id is not a gun entry of the lookup. */
  | 'UNKNOWN_WEAPON'
  /** Two distinct templates, or one template twice, define the same template slot id (issue #29). */
  | 'SLOT_ID_COLLISION'
  /** A slot allowlist mixes ammunition with installable parts (INTERPRETATIONS.md choice 15). */
  | 'MIXED_AMMO_SLOT'
  /** A factory preset is malformed: wrong receiver, duplicate id, or a component count that is not a nonnegative integer. */
  | 'BAD_PRESET'
  /** The occurrence universe exceeded the configured safety limit. Never an infeasibility claim. */
  | 'OCCURRENCE_LIMIT'
  /** `owned_items` is not a valid multiset input (ADR 0008 section 1). */
  | 'INVALID_OWNED_ITEMS'
  /** An offer is malformed: a barter lot size that is not an integer of at least 1. */
  | 'BAD_OFFER'
  /** A request field the domain preparation reads is malformed (a non-finite trader or player level). */
  | 'INVALID_REQUEST'
  /** The blueprint was not prepared from the lookup it is being used with. */
  | 'FOREIGN_BLUEPRINT'
  /** The domain was not prepared from the blueprint it is being specialized with. */
  | 'FOREIGN_DOMAIN'
  /** The masks of a domain contradict each other (an active owner with a required slot nobody can fill). An internal fault. */
  | 'DOMAIN_INCONSISTENT'
  /**
   * The part graph reachable from the receiver has a cycle. No gun has one (owner decision 2026-10-12), so this is bad data, not a supported case:
   * the blueprint builder throws it rather than unroll forever, and the operation reports it as a generic error.
   */
  | 'CYCLIC_PART_GRAPH'
  /** A solution vector cannot be read as a physical build: a missing or non-integral decision column, an unrooted placement. */
  | 'DECODE_FAILED';

export class PhysicalModelError extends Error {
  readonly code: PhysicalModelErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: PhysicalModelErrorCode, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = 'PhysicalModelError';
    this.code = code;
    this.details = details;
  }
}
