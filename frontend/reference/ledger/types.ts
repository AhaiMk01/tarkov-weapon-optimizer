// Case record of the 14-family behavioral ledger (ADR 0013 section 3, ADR 0010 section 4).
//
// The ledger is the permanent behavioral contract the Stage 2 solver rewrite must satisfy in
// Stage 3. Every expectation below is derived by hand from the ADRs (the derivation sits in the
// case's `derivation` field); the oracle only checks the derivations, never produces them. The
// ledger imports nothing but the oracle's public surface (reference/independence.test.ts).

import type { IdealPointCheck, ReferenceBuild, ReferenceFixture, ReferenceRequest, ViolationCode } from '../oracle/index';

export type Family = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export const FAMILIES: readonly Family[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

// ---------------------------------------------------------------------------------------------
// Admitted public outcomes (ADR 0013 section 6, ADR 0010 section 1). Names mirror the transport
// shapes of ADR 0013 section 5 so Stage 3 can compare field by field.
// ---------------------------------------------------------------------------------------------

export type SolveStatus = 'optimal' | 'feasible' | 'incomplete' | 'infeasible' | 'error';
export type PhysicalCertificate = 'certified_optimal' | 'approximate_optimal' | 'feasible' | 'certified_infeasible' | 'none';
export type ModelQualification = 'exact' | 'approximate' | null;
export type MoaQualification = 'provisional_model' | null;

/** The public result a qualified solve of this case may publish in one resolved precision mode. */
export interface AdmittedOutcome {
  status: SolveStatus;
  physical_certificate: PhysicalCertificate;
  model_qualification: ModelQualification;
  moa_qualification: MoaQualification;
  /** Search completion only (never proof authority): `optimal` for every completed executed search, emptiness included. */
  termination: 'optimal' | 'limit';
  /** Public reason string required for this outcome, or null when none is required. */
  reason: string | null;
}

export interface AdmittedOutcomes {
  /** Precise resolved mode, search completed and verified. */
  precise: AdmittedOutcome;
  /**
   * Fast resolved mode when its search completes and every published witness validates. A failed
   * Fast reconstruction is always additionally permitted as incomplete / none with reason
   * 'Independent build validation failed' (never certified); Fast emptiness is never a physical
   * proof, and Fast never receives `certified_optimal` or `certified_infeasible`.
   */
  fast: AdmittedOutcome;
}

// ---------------------------------------------------------------------------------------------
// Tolerance
// ---------------------------------------------------------------------------------------------

/** Statistics the oracle computes for a build; names match the oracle's BuildStats fields. */
export type StatName =
  | 'rawErgonomics' | 'ergonomics' | 'effectiveErgonomics'
  | 'recoilModifierSum' | 'recoilVertical' | 'recoilHorizontal'
  | 'weight' | 'weightPenalty' | 'ted'
  | 'accuracyModifierSum' | 'effectiveCenterOfImpact' | 'moa'
  | 'magazineCapacity' | 'sightingRange' | 'spend';

/** A hand-derived exact statistic of one build, checked against the oracle's exact statistics. */
export interface StatCheck {
  label: string;
  build: ReferenceBuild;
  /** Exact rational strings (canonical `n` or `n/d`). */
  values: Partial<Record<StatName, string>>;
  /** Overswing strength is nonzero exactly when TED < 0 (the only normative overswing statement). */
  overswingNonzero?: boolean;
}

/**
 * The requested runtime tolerance the solver is held to, and whether the case probes a small exact
 * positive separation. A small positive gap is never an exact tie (ADR 0013 section 3).
 */
export interface RuntimeTolerance {
  /** Requested absolute runtime tolerance, in the objective frame or the unit of the capped quantity. */
  absolute: number;
  kind: 'well_separated' | 'tiny_positive_gap' | 'near_cap';
  /** Exact rational separation (tiny_positive_gap: best score minus runner-up score; near_cap: |value - cap|). Null when well separated. */
  gap: string | null;
  /**
   * True when the gap exceeds `absolute`, so a solver held to that tolerance can distinguish the two
   * builds. False means the case is exact-arithmetic only: Stage 3 may skip exact equality for it,
   * but may never report the near-tie as an exact tie.
   */
  resolvableAtTolerance: boolean;
  /** near_cap only: the hand-derived value of the statistic of `build` against the cap. */
  capCheck?: { build: ReferenceBuild; stat: StatName; value: string; cap: string; direction: 'max' | 'min' };
}

// ---------------------------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------------------------

/**
 * Hand-derived per-occurrence acquisition provenance of one build (ADR 0008 principle 5): for an item
 * installed K times, instances in code-unit order of instanceId take preset supply first, owned stock
 * second and the paid remainder last, carrying the actual offer kind. Offers are whole lots
 * (interpretation 1): the paid occurrences take the units of the cheapest lot cover in offer-index
 * order, and `charged` is the RUB charged to the occurrence: the full lot price on the first unit
 * taken from a lot, 0 on the other units of the same lot and on preset, owned and unavailable units.
 */
export interface ProvenanceCheck {
  label: string;
  build: ReferenceBuild;
  /** One record per installed occurrence, in instanceId code-unit order. */
  occurrences: { instanceId: string; source: 'preset' | 'owned' | 'offer' | 'unavailable'; via?: 'trader' | 'flea' | 'barter'; charged: string }[];
}

export interface Rejection {
  label: string;
  build: ReferenceBuild;
  /** Distinct violation codes the reference validator must report for this build, sorted. */
  codes: ViolationCode[];
}

/** A Tchebycheff reference point (ideal and nadir) in the objective frame, as canonical rational strings. */
export interface PayoffTableText {
  zE: string;
  nadE: string;
  zR: string;
  nadR: string;
  zP: string;
  nadP: string;
}

/**
 * Hand-derived admissibility of the Tchebycheff payoff table (INTERPRETATIONS.md choice 17). The three single-axis payoff solves have
 * tied optima, so the nadir is not unique: every admissible table (one tied optimal build per axis, chosen jointly) is listed with the
 * exact Tchebycheff optimum under it, and tables a solver must NOT report are named with the verdict the oracle must return.
 */
export interface PayoffExpectation {
  /** The exact, unique ideal coordinates: max fE, min fR, min fP over the feasible builds. */
  ideal: { zE: string; zR: string; zP: string };
  /** Every admissible table, sorted ascending by (zE, nadE, zR, nadR, zP, nadP), each with its exact Tchebycheff optimum. */
  tables: { table: PayoffTableText; maxScore: string; maximizers: string[] }[];
  /** Tables built from a non-optimal or non-attainable endpoint choice; the oracle must reject each with this code. */
  rejected: { label: string; table: PayoffTableText; code: Extract<IdealPointCheck, { status: 'inadmissible' }>['code'] }[];
}

export interface Expected {
  /** Complete feasible projection keys (base + installed multiset), sorted in code-unit order. */
  projectionKeys: string[];
  /** Exact maximum score as a canonical rational string, or null when nothing is feasible. */
  maxScore: string | null;
  /** Projection keys whose score equals maxScore exactly, sorted. */
  maximizers: string[];
  empty: boolean;
  /** Hand-derived exact scores of selected feasible projections. */
  scores?: Record<string, string>;
  /** Named invalid builds that must be rejected with exactly these codes. */
  rejections?: Rejection[];
  /** Named builds that must validate cleanly. */
  accepts?: { label: string; build: ReferenceBuild }[];
  statChecks?: StatCheck[];
  provenance?: ProvenanceCheck[];
  /** Informative: number of accepted physical builds (distinct placements), for the oracle's multiplicity. */
  physicalBuildCount?: number;
  /** Payoff-table admissibility of a Tchebycheff case (the request's own ideal_point is one of the admissible tables). */
  payoff?: PayoffExpectation;
}

export interface LedgerCase {
  id: string;
  family: Family;
  /** Subcase tags; every required tag of the family must appear in some case (see index.ts). */
  subcases: string[];
  title: string;
  adrRefs: string[];
  /** What must hold for the case to mean anything (stated in prose). */
  prerequisites: string;
  /** Description of the source fixture and request: what is modeled. */
  source: string;
  fixture: ReferenceFixture;
  request: ReferenceRequest;
  /** True when the request has a MOA cap (ADR 0006): outcomes then carry provisional_model. */
  moaDependent: boolean;
  expected: Expected;
  runtimeTolerance: RuntimeTolerance;
  admitted: AdmittedOutcomes;
  /** The hand derivation: which builds exist, why others are illegal, and the arithmetic. */
  derivation: string;
  /** Interpretation choices of the oracle the case relies on (numbered in ../INTERPRETATIONS.md), and other caveats. */
  notes: string[];
  /** Set only for a documented oracle bug: the case then runs as a node:test `todo`. */
  todo?: string;
}

/** An owned-stock monotonicity relation between two cases that differ only by a larger stash (family 7). */
export interface MonotonicityRelation {
  smaller: string;
  larger: string;
}
