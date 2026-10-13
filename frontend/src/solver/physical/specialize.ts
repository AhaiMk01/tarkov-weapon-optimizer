/**
 * Shared declarations of the physical models (ADR 0010 section 2, ADR 0007, ADR 0013 sections 4A and 4C): the declared constants of the objective
 * frames and of MOA, the request fields a model reads, the weight node of the spatial search, and the objective and spatial metadata every model
 * carries. The model Precise and Fast solve is the template count model (`specializeFast.ts`; built through the proof layer for Precise,
 * `specializeCount.ts`). The occurrence-level model that used to live here left production with owner decision 2d as amended (2026-10-12): it
 * stays in the tests as the independent cross-check (`tests/physical/occurrence/`).
 */

import type { IdealPoint } from '../types';
import { PhysicalModelError } from './errors';
import { penaltyLineIsValid, type NodePenalty, type PenaltyLine } from './spatial';

// ---------------------------------------------------------------------------------------------
// Declared constants (ADR 0010 section 2, ADR 0007)
// ---------------------------------------------------------------------------------------------

/** fE = ERGO_SCALE x ergonomics (or TED). */
export const ERGO_SCALE = 10;
/** fR = RECOIL_SCALE x summed recoil modifier. */
export const RECOIL_SCALE = 1000;
/** Tchebycheff augmentation weight, one hundredth. */
export const AUGMENTATION = 0.01;
/** Both ergonomics clamps run over [0, ERGO_CLAMP_MAX]. */
export const ERGO_CLAMP_MAX = 100;
/**
 * MOA per unit of centre of impact, K = 100 / 2.9089 = 1000000 / 29089 as the nearest double of the exact quotient (for display and the Fast
 * model; the Precise rows are built from the exact rational `MOA_K_RATIONAL` in `proof.ts`).
 */
export const MOA_K = 1000000 / 29089;


// ---------------------------------------------------------------------------------------------
// Request, node
// ---------------------------------------------------------------------------------------------

/**
 * The request fields a model builder reads, named as `SolveParams` names them. Filters (excludes) and the market, owned stock and
 * receiver bans are NOT here: they are already decided by the domain masks. `maxMOA` is the provisional MOA cap (ADR 0006).
 */
export interface SpecializeRequest {
  maxPrice?: number | null;
  minErgonomics?: number | null;
  maxRecoilV?: number | null;
  maxRecoilSum?: number | null;
  minMagCapacity?: number | null;
  minSightingRange?: number | null;
  maxWeight?: number | null;
  maxMOA?: number | null;
  includeItems?: readonly string[] | null;
  includeCategories?: readonly (readonly string[])[] | null;
  ergoWeight?: number | null;
  recoilWeight?: number | null;
  priceWeight?: number | null;
  useTrueErgo?: boolean;
  useTchebycheff?: boolean;
  /** The payoff table the Tchebycheff objective is measured against: an input (INTERPRETATIONS.md choices 9 and 17). */
  idealPoint?: IdealPoint | null;
  preventOverswing?: boolean;
  equipErgoModifier?: number | null;
  /**
   * FAST ONLY (`specializeFast`; the Precise model never reads it): install at most ONE copy of every template. Counts and slot edges become
   * binary and no presence column is needed. Default false at this level, so the pure model function and the research callers keep the full
   * count model; the Fast solve passes `allowRepeatedParts !== true` (owner decision 2c).
   */
  singleCopy?: boolean;
}

/**
 * One node of the spatial search over total weight (ADR 0007 section 6): the closed interval enforced on the weight column and,
 * optionally, the lower envelope of the weight penalty to use on it (otherwise `secantOfPenalty` derives it). The loop that picks
 * nodes is Phase 2.4b-3. Only requests that read TED (TrueErgo or Prevent Overswing) have a use for a node; others ignore it.
 */
export interface SpatialNode {
  weightMin: number;
  weightMax: number;
  penalty?: PenaltyLine;
}

// ---------------------------------------------------------------------------------------------
// Model description
// ---------------------------------------------------------------------------------------------

/** The request or the domain is already proved empty: no solve is needed, and the LP text is infeasible by construction. */
export interface ProvedEmpty {
  /** `domain` when the prepared domain itself is empty; `request` when a constant row of the request is false. */
  source: 'domain' | 'request';
  reasons: readonly string[];
}

export interface ObjectiveCoefficient {
  column: string;
  value: number;
  formula: string;
}

export interface ObjectiveMeta {
  sense: 'maximize';
  column: 'total_obj';
  kind: 'weighted' | 'tchebycheff';
  /** fE = ergoScale x (ergonomics | TED), fR = recoilScale x summed recoil modifier, fP = RUB spend. */
  frame: { ergoScale: number; recoilScale: number; priceScale: number };
  ergoSource: 'capped_ergo' | 'ted';
  weights: { e: number; r: number; p: number };
  /** The oracle score equals `scale` x (LP objective) + `offset`: the LP objective IS the oracle's (axis scaling changes columns, not the frame). */
  toOracle: { scale: 1; offset: 0 };
  coefficients: readonly ObjectiveCoefficient[];
  tchebycheff: null | {
    ideal: IdealPoint;
    ce: number;
    cr: number;
    cp: number;
    /** Axes with a positive weight. */
    active: readonly ('e' | 'r' | 'p')[];
  };
}

export interface SpatialMeta {
  /** The interval enforced on the weight column (the node clipped to the active weight domain). */
  weightMin: number;
  weightMax: number;
  penalty: NodePenalty | { line: PenaltyLine; kind: 'supplied'; exact: boolean };
}

/**
 * A weight-penalty line supplied with a node, verified against q on the node interval: it must be a lower envelope (on or below q over the
 * closed interval, decided in exact rationals). The Precise and the Fast model state the same TED rows on a node and share this check.
 */
export function checkedNodePenalty(lo: number, hi: number, line: PenaltyLine): { line: PenaltyLine; kind: 'supplied'; exact: boolean } {
  if (!Number.isFinite(line.slope) || !Number.isFinite(line.intercept) || line.slope < 0 || !penaltyLineIsValid(lo, hi, line)) {
    throw new PhysicalModelError('INVALID_REQUEST', `The supplied weight-penalty line is not a lower envelope of q on [${lo}, ${hi}]`, { lo, hi, line });
  }
  const exact = hi <= 3 || lo === hi;
  return { line, kind: 'supplied', exact };
}

export interface ModelStats {
  /** Smallest and largest magnitude of a written matrix coefficient. */
  minAbsCoefficient: number;
  maxAbsCoefficient: number;
  columns: number;
  rows: number;
  nonzeros: number;
  binaries: number;
  integers: number;
  continuous: number;
  lpChars: number;
}
