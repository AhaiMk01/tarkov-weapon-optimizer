/**
 * The message protocol between the client (`api/workerChannel.ts`) and the worker runtime (`solver/workerRuntime.ts`), Phase 2.7a.
 *
 * Requests carry a client-stamped EPOCH deadline (`payload.deadline`, epoch milliseconds, `requestGuard.ts` `epochNow`): the client stamps it
 * when the call enters, so time spent queued in the worker counts against the request (ADR 0013 section 4D). A `cancel` message targets a
 * running or queued request by id and is handled out of band: it never waits in the worker dispatch chain.
 */

import type { ExploreRequest, MOAFloorRequest, OptimizeRequest } from '../api/client';

/** Default budgets of the operations that run a search (milliseconds). */
export const DEFAULT_OPTIMIZE_TIME_LIMIT_MS = 60_000;
export const DEFAULT_EXPLORE_TIME_LIMIT_MS = 60_000;
export const DEFAULT_FLOOR_TIME_LIMIT_MS = 30_000;

/** A budget as requested: a finite nonnegative number, otherwise the default. */
export function resolveTimeLimit(requested: unknown, fallback: number): number {
  return typeof requested === 'number' && Number.isFinite(requested) && requested >= 0 ? requested : fallback;
}

export type WorkerOperation =
  | 'loadData' | 'optimize' | 'explore' | 'getInfo' | 'getWeaponMods' | 'getGunsmithTasks' | 'getStatus' | 'computeMOAFloor' | 'clearCache';

export interface WorkerPayload {
  lang?: string;
  gameMode?: string;
  request?: OptimizeRequest | ExploreRequest | MOAFloorRequest;
  weaponId?: string;
  /** getWeaponMods: also return the conflict/slot graph. */
  withCompat?: boolean;
  /** Epoch-millisecond deadline of the request, stamped by the client at entry. Absent for metadata operations. */
  deadline?: number;
}

export interface WorkerRequestMessage {
  type: WorkerOperation;
  id: number;
  payload: WorkerPayload;
}

/** An out-of-band cancel of the request `targetId` (running or queued). It has its own message id and no response. */
export interface WorkerCancelMessage {
  type: 'cancel';
  id: number;
  payload: { targetId: number };
}

export type WorkerInMessage = WorkerRequestMessage | WorkerCancelMessage;

/**
 * `result` / `dataLoaded`: the request finished. `error`: it failed (payload: `SerializedWorkerError`). `snapshot`: a verified partial result
 * the client keeps even if it later abandons the request (the payload of a `CancellationError`).
 */
export interface WorkerOutMessage {
  type: 'result' | 'dataLoaded' | 'error' | 'snapshot';
  id: number;
  payload: unknown;
}
