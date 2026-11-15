/**
 * The state of the four operations the UI runs against the solver (Optimize, Gunsmith, Explore, the MOA floor) and the pure transitions between
 * its phases. No React, no worker: `runLifecycle.ts` drives these transitions, the components only read them.
 *
 * Optimize and Gunsmith are the same single request, so they share one shape. A run keeps its last accepted `result` through every later phase
 * (while the next run is running, after a cancel, after a failure): the previous answer stays on screen until a newer one replaces it.
 *
 *   idle       nothing was asked yet (or the data was reloaded)
 *   running    a request is settling the floor, queued or being solved
 *   done       the request answered: `result` is its response (what that response proves is `resultView.ts`'s business, not a phase)
 *   cancelled  the user abandoned the request; `result` is whatever was kept from before
 *   failed     the request was rejected (a native solver failure or an unexpected error); only this phase carries a `failure`
 */

import type { ExploreWeaponRun } from '../components/explore/exploreView';
import type { Failure } from '../components/common/failureView';
import type { FloorView } from '../components/common/floorView';
import type { OptimizeResponse } from '../api/client';

export type RunState<R> =
  | { phase: 'idle' | 'running' | 'done' | 'cancelled'; result: R | null; failure: null }
  | { phase: 'failed'; result: R | null; failure: Failure };

export type RunEvent<R> =
  | { type: 'started' }
  | { type: 'done'; result: R }
  | { type: 'cancelled' }
  | { type: 'failed'; failure: Failure }
  /** The data behind the results was reloaded: forget the result and the failure (a request still in flight keeps running). */
  | { type: 'cleared' }
  /** The weapon changed: forget the result only. A failure stays shown. */
  | { type: 'resultCleared' };

export const idleRun = <R>(): RunState<R> => ({ phase: 'idle', result: null, failure: null });

export function reduceRun<R>(state: RunState<R>, event: RunEvent<R>): RunState<R> {
  switch (event.type) {
    case 'started': return { phase: 'running', result: state.result, failure: null };
    case 'done': return { phase: 'done', result: event.result, failure: null };
    case 'cancelled': return { phase: 'cancelled', result: state.result, failure: null };
    case 'failed': return { phase: 'failed', result: state.result, failure: event.failure };
    case 'cleared': return { phase: state.phase === 'running' ? 'running' : 'idle', result: null, failure: null };
    case 'resultCleared':
      return state.phase === 'failed' ? { ...state, result: null } : { phase: state.phase === 'done' ? 'idle' : state.phase, result: null, failure: null };
  }
}

export type OptimizeRun = RunState<OptimizeResponse>;

// ---------------------------------------------------------------------------------------------
// Explore: one sweep per requested weapon
// ---------------------------------------------------------------------------------------------

/** The axis an Explore request leaves free: the chart plots it against the swept one. */
export type ExploreTradeoff = 'price' | 'recoil' | 'ergo';

/**
 * `runs` holds one entry per weapon started so far, each with its own phase (`exploreView.ts`); weapons not started yet (a cancel stops the loop)
 * have no entry. `weaponIds` and `tradeoff` are those of the latest request, so the chart keeps its colours and axes while the form changes.
 */
export interface ExploreState {
  phase: 'idle' | 'running' | 'settled';
  weaponIds: string[];
  tradeoff: ExploreTradeoff;
  runs: ExploreWeaponRun[];
}

export type ExploreEvent =
  | { type: 'started'; weaponIds: string[]; tradeoff: ExploreTradeoff }
  | { type: 'weaponStarted'; run: ExploreWeaponRun }
  | { type: 'weaponPatched'; index: number; patch: Partial<ExploreWeaponRun> }
  | { type: 'settled' };

export const idleExplore: ExploreState = { phase: 'idle', weaponIds: [], tradeoff: 'price', runs: [] };

export function reduceExplore(state: ExploreState, event: ExploreEvent): ExploreState {
  switch (event.type) {
    case 'started': return { phase: 'running', weaponIds: event.weaponIds, tradeoff: event.tradeoff, runs: [] };
    case 'weaponStarted': return { ...state, runs: [...state.runs, event.run] };
    case 'weaponPatched': return { ...state, runs: state.runs.map((run, i) => (i === event.index ? { ...run, ...event.patch } : run)) };
    case 'settled': return { ...state, phase: 'settled' };
  }
}

// ---------------------------------------------------------------------------------------------
// The MOA floor
// ---------------------------------------------------------------------------------------------

/** The latest floor question: being asked, answered (`view`), or failed (`error`; a failed floor may still retain what it had established). */
export interface FloorState {
  computing: boolean;
  /** The last floor answer: a result of the PROVISIONAL MOA model, never a game-physical minimum. */
  view: FloorView | null;
  error: string | null;
}

export type FloorEvent =
  | { type: 'reset' }
  | { type: 'asking' }
  | { type: 'answered'; view: FloorView }
  | { type: 'retained'; view: FloorView }
  | { type: 'errored'; message: string }
  | { type: 'settled' };

export const idleFloor: FloorState = { computing: false, view: null, error: null };

export function reduceFloor(state: FloorState, event: FloorEvent): FloorState {
  switch (event.type) {
    case 'reset': return idleFloor;
    case 'asking': return { computing: true, view: null, error: null };
    case 'answered':
    case 'retained': return { ...state, view: event.view };
    case 'errored': return { ...state, error: event.message };
    case 'settled': return { ...state, computing: false };
  }
}

export interface RunsState {
  optimize: OptimizeRun;
  gunsmith: OptimizeRun;
  explore: ExploreState;
  floor: FloorState;
}

export const idleRuns: RunsState = { optimize: idleRun(), gunsmith: idleRun(), explore: idleExplore, floor: idleFloor };
