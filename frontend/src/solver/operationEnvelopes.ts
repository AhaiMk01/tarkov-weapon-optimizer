/**
 * The response envelopes of a request that stops BEFORE any model work (ADR 0013 sections 5 and 6, Phase 2.7a): an invalid `owned_items`
 * list, a request that expired in the queue, a request cancelled before dispatch. Nothing is resolved, nothing was searched, so every
 * operation has its own null envelope: no build, no certificate, no bound, no node, a search that never started (`limit`), and the factual
 * reason. The shapes follow the transport of `api/client.ts`.
 *
 * Used by the worker runtime for every operation, by `solver.ts` for a direct call, and by Phase 2.7b's Explore and floor drivers for their
 * own entry stops.
 */

import type { ExploreResponse, MOAFloorResponse, OptimizeResponse } from '../api/client';
import type { PrecisionRequest } from './types';
import { invalidOwnedItemsOutcome } from './physical/outcome';
import { PUBLIC_REASONS } from './physical/reasons';

/** The default absolute objective tolerance (`solvePrecise.ts` `DEFAULT_OBJECTIVE_TOLERANCE`), repeated here to keep this module light. */
const DEFAULT_TOLERANCE = 1e-5;

/** Why a request stopped before any model work. */
export type PreModelStop = 'invalid_owned_items' | 'queue_timeout' | 'cancelled';

/** The public reason of a pre-model stop (the closed set of `physical/reasons.ts`). */
export const preModelReason = (stop: PreModelStop): string => {
  switch (stop) {
    case 'invalid_owned_items': return PUBLIC_REASONS.invalidOwnedItems;
    case 'queue_timeout': return PUBLIC_REASONS.queueTimeoutBeforeDispatch;
    case 'cancelled': return PUBLIC_REASONS.cancelledByUser;
  }
};

export interface OptimizeEnvelopeInput {
  precisionRequest: PrecisionRequest;
  /** The request carries a MOA cap (its `moa_qualification` stays `provisional_model` even though no model ran). */
  moaDependent: boolean;
  /** Milliseconds spent on the request so far (the queue wait is part of it when known). */
  elapsedMs?: number;
  tolerance?: number;
}

/** Optimize and Gunsmith: incomplete, certificate none, nothing resolved, empty manifest, null objective and bounds, no node, `limit`. */
export function optimizeEnvelope(stop: PreModelStop, input: OptimizeEnvelopeInput): OptimizeResponse {
  const outcome = invalidOwnedItemsOutcome(input.moaDependent);
  return {
    status: outcome.status,
    precision_request: input.precisionRequest,
    precision_resolved: outcome.precision_resolved,
    model_qualification: outcome.model_qualification,
    moa_qualification: outcome.moa_qualification,
    physical_certificate: outcome.physical_certificate,
    selected_items: [],
    selected_item_ids: [],
    slot_pairs: [],
    objective_value: null,
    optimization: {
      lower_bound: null, upper_bound: null, absolute_gap: null, tolerance: input.tolerance ?? DEFAULT_TOLERANCE, nodes: 0, termination: outcome.termination,
    },
    reason: preModelReason(stop),
    solve_time_ms: input.elapsedMs ?? 0,
  };
}

export interface ExploreEnvelopeInput {
  precisionRequest: PrecisionRequest;
  moaDependent: boolean;
  elapsedMs?: number;
}

/** Explore: `invalid`, no points, no invented schedule or per-target record, the reason. The aggregate precision and model are unresolved. */
export function exploreEnvelope(stop: PreModelStop, input: ExploreEnvelopeInput): ExploreResponse {
  return {
    curve_status: 'invalid',
    points: [],
    sweep_schedule: [],
    step_outcomes: [],
    total_solve_time_ms: input.elapsedMs ?? 0,
    precision_request: input.precisionRequest,
    precision_resolved: null,
    model_qualification: null,
    moa_qualification: input.moaDependent ? 'provisional_model' : null,
    reason: preModelReason(stop),
  };
}

/** MOA floor: `unresolved`, null floor, display floor and lower bound, no witness; always `provisional_model`. */
export function floorEnvelope(stop: PreModelStop, input: { elapsedMs?: number } = {}): MOAFloorResponse {
  return {
    status: 'unresolved',
    moa_qualification: 'provisional_model',
    floor: null,
    display_floor: null,
    proved_lower_bound: null,
    solve_time_ms: input.elapsedMs ?? 0,
    reason: preModelReason(stop),
  };
}
