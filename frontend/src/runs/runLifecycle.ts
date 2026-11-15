/**
 * How a request runs and what the UI is told about it: the sequence every solve shares (busy, let the MOA floor settle, take the controller, call
 * the API, announce, classify a failure, release the controller) for Optimize and Gunsmith, the per-weapon Explore loop, and the MOA floor's
 * debounce, sequence guard and retry. State is `runState.ts`; this module only moves it between phases.
 *
 * Nothing here reaches for React, the worker or the DOM: the API client, the request controllers, the toast, the log and the clock are passed in
 * (the same stance as `solver/workerRuntime.ts`), so `tests/runs/` drives whole runs with fakes. The component builds each request (it owns the
 * controls the request reads) and hands it over as a thunk, evaluated where the sequence needs it.
 */

import type { ExploreRequest, GameMode, MOAFloorRequest, OptimizeRequest, OptimizeResponse, computeMOAFloor, explore, optimize } from '../api/client';
import { classifyFailure } from '../components/common/failureView';
import { retainedFloorOf, floorViewOf } from '../components/common/floorView';
import { reasonViewOf, resultViewOf, toastOf } from '../components/common/resultView';
import { asExploreSnapshot, exploreToastOf, retainedExploreOf } from '../components/explore/exploreView';
import type { ExploreWeaponRun } from '../components/explore/exploreView';
import { idleRuns, reduceExplore, reduceFloor, reduceRun } from './runState';
import type { ExploreEvent, ExploreTradeoff, FloorEvent, RunEvent, RunsState } from './runState';

export interface Toast {
  type: 'success' | 'info' | 'warning' | 'error';
  /** i18n key of the message. */
  key: string;
  params?: Record<string, string | number>;
}

/** One cancellable request at a time (`components/common/useRequestController.ts` is the React implementation). */
export interface RunController {
  begin(): AbortController;
  end(controller: AbortController): void;
  cancel(): void;
}

export interface RunLifecycleDeps {
  api: { optimize: typeof optimize; explore: typeof explore; computeMOAFloor: typeof computeMOAFloor };
  controllers: { optimize: RunController; explore: RunController; gunsmith: RunController; floor: RunController };
  announce(toast: Toast): void;
  logError(message: string, error: unknown): void;
  /** Runs `fn` after `ms` milliseconds; the returned function cancels it. */
  setTimer(fn: () => void, ms: number): () => void;
}

/** A change of the MOA floor's inputs waits this long before it is asked, so dragging a slider does not start a solve per tick. */
export const FLOOR_DEBOUNCE_MS = 400;

type SingleKind = 'optimize' | 'gunsmith';

/** What differs between the two single-request runs: the toast of a finished result, the failure toast and the log line. */
const SINGLE = {
  optimize: { toast: 'optimize', failedKey: 'toast.optimize_failed', failedLog: 'Optimization failed' },
  gunsmith: { toast: 'gunsmith', failedKey: 'toast.gunsmith_failed', failedLog: 'Gunsmith optimization failed' },
} as const;

export interface ExplorePlan {
  /** The weapons to sweep, in order (repeats are dropped). Nothing runs for an empty list. */
  weaponIds: readonly string[];
  tradeoff: ExploreTradeoff;
  weaponName(weaponId: string): string;
  requestOf(weaponId: string): ExploreRequest;
  gameMode: GameMode;
  lang: string;
}

export interface RunLifecycle {
  getState(): RunsState;
  subscribe(listener: () => void): () => void;
  /** Optimize and Gunsmith: the same request, shown in their own panels. */
  run(kind: SingleKind, request: () => OptimizeRequest, gameMode: GameMode, lang: string): Promise<void>;
  explore(plan: ExplorePlan): Promise<void>;
  /**
   * Asks the MOA floor about `request` after a short pause, and returns what stops that: the pause, or the request already in flight (it is
   * aborted, and an answer that still arrives is ignored once a newer question was asked). `null` is "not wanted": the floor is just cleared.
   */
  watchFloor(request: MOAFloorRequest | null, gameMode: GameMode, lang: string): () => void;
  /** The data behind the results was reloaded. */
  clearResults(): void;
  /** The Optimize weapon changed: its result no longer belongs to it. */
  clearOptimizeResult(): void;
}

export function createRunLifecycle(deps: RunLifecycleDeps): RunLifecycle {
  let state: RunsState = idleRuns;
  const listeners = new Set<() => void>();
  const commit = (next: RunsState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const runEvent = (kind: SingleKind, event: RunEvent<OptimizeResponse>): void => commit({ ...state, [kind]: reduceRun(state[kind], event) });
  const exploreEvent = (event: ExploreEvent): void => commit({ ...state, explore: reduceExplore(state.explore, event) });
  const floorEvent = (event: FloorEvent): void => commit({ ...state, floor: reduceFloor(state.floor, event) });

  /** Settles when the floor request in flight (if any) has settled: other requests wait for it, so a cancel that escalates never takes them down. */
  let floorSettled: Promise<unknown> = Promise.resolve();
  let floorSeq = 0;
  let exploreSeq = 0;

  /** The floor must not hold up another request: cancel it (softly) and wait until it has settled before the next request is sent. */
  const settleFloor = async (): Promise<void> => {
    deps.controllers.floor.cancel();
    await floorSettled;
  };

  const run: RunLifecycle['run'] = async (kind, request, gameMode, lang) => {
    const spec = SINGLE[kind];
    runEvent(kind, { type: 'started' });
    await settleFloor();
    const controller = deps.controllers[kind].begin();
    try {
      const res = await deps.api.optimize(request(), gameMode, lang, { signal: controller.signal });
      runEvent(kind, { type: 'done', result: res });
      deps.announce(toastOf(resultViewOf(res), spec.toast));
    } catch (err) {
      const failure = classifyFailure(err);
      if (failure.kind === 'cancelled') {
        runEvent(kind, { type: 'cancelled' });
        deps.announce({ type: 'info', key: 'toast.cancelled' });
      } else {
        deps.logError(spec.failedLog, err);
        runEvent(kind, { type: 'failed', failure });
        deps.announce({ type: 'error', key: spec.failedKey });
      }
    } finally {
      deps.controllers[kind].end(controller);
    }
  };

  /**
   * Cancelling an Explore request goes through the request signal: the worker returns the points found so far (curve status partial or invalid,
   * with `Cancelled by user`), or, if it does not answer in time, the request is hard-terminated and rejects with the last published snapshot.
   * Either way the points already found stay on screen, and the weapons not yet started are not run.
   */
  const exploreWeapons: RunLifecycle['explore'] = async plan => {
    const weaponIds = [...new Set(plan.weaponIds)];
    if (weaponIds.length === 0) return;
    const token = ++exploreSeq;
    const current = (): boolean => token === exploreSeq;
    const patch = (index: number, change: Partial<ExploreWeaponRun>): void => {
      if (current()) exploreEvent({ type: 'weaponPatched', index, patch: change });
    };

    exploreEvent({ type: 'started', weaponIds, tradeoff: plan.tradeoff });
    await settleFloor();
    if (!current()) return;
    const controller = deps.controllers.explore.begin();

    try {
      for (const id of weaponIds) {
        if (!current() || controller.signal.aborted) break;
        const index = state.explore.runs.length;
        exploreEvent({ type: 'weaponStarted', run: { weaponId: id, weaponName: plan.weaponName(id), response: null, phase: 'running' } });
        const request = plan.requestOf(id);
        try {
          const res = await deps.api.explore(request, plan.gameMode, plan.lang, {
            signal: controller.signal,
            // Live progress: the verified partial result after every launched target (points so far, per-target coverage).
            onSnapshot: raw => {
              const snapshot = asExploreSnapshot(raw);
              if (snapshot !== null) patch(index, { response: snapshot.response, launched: snapshot.launched, scheduled: snapshot.scheduled });
            },
          });
          const cancelled = reasonViewOf(res.reason)?.cancelled === true;
          patch(index, { response: res, phase: cancelled ? 'cancelled' : 'done', launched: undefined, scheduled: undefined });
        } catch (err) {
          const failure = classifyFailure(err);
          if (failure.kind !== 'cancelled') deps.logError(`Exploration failed for ${id}`, err);
          // A hard-terminated or failed sweep keeps the points published so far: the retained snapshot (or the last live one).
          const kept = retainedExploreOf(err)?.response ?? state.explore.runs[index]?.response ?? null;
          if (failure.kind === 'cancelled') patch(index, { response: kept, phase: 'cancelled' });
          else patch(index, { response: kept, phase: 'failed', error: failure.message });
        }
      }
    } finally {
      if (current()) {
        deps.controllers.explore.end(controller);
        exploreEvent({ type: 'settled' });
        deps.announce(exploreToastOf(state.explore.runs, weaponIds.length));
      }
    }
  };

  // A request that was disabled does not advance the sequence: only a question actually asked can be superseded.
  const watchFloor: RunLifecycle['watchFloor'] = (request, gameMode, lang) => {
    floorEvent({ type: 'reset' });
    if (request === null) return () => {};
    const seq = ++floorSeq;
    floorEvent({ type: 'asking' });
    let controller: AbortController | null = null;
    const cancelTimer = deps.setTimer(() => {
      const c = deps.controllers.floor.begin();
      controller = c;
      floorSettled = deps.api.computeMOAFloor(request, gameMode, lang, { signal: c.signal })
        .then(response => {
          if (seq !== floorSeq) return;
          floorEvent({ type: 'answered', view: floorViewOf(response) });
        })
        .catch(err => {
          // A hard-terminated or failed floor still carries what it had established (its best witness and proved bound): show that, as an
          // interrupted result (it does not narrow the MOA control).
          const failure = classifyFailure(err);
          if (failure.kind !== 'cancelled') deps.logError('Failed to compute MOA floor', err);
          if (seq !== floorSeq) return;
          const retained = retainedFloorOf(err);
          if (retained !== null) floorEvent({ type: 'retained', view: floorViewOf(retained, { interrupted: true }) });
          if (failure.kind !== 'cancelled') floorEvent({ type: 'errored', message: failure.message });
        })
        .finally(() => {
          deps.controllers.floor.end(c);
          if (seq === floorSeq) floorEvent({ type: 'settled' });
        });
    }, FLOOR_DEBOUNCE_MS);
    return () => {
      cancelTimer();
      controller?.abort();
    };
  };

  return {
    getState: () => state,
    subscribe: listener => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    run,
    explore: exploreWeapons,
    watchFloor,
    clearResults: () => {
      runEvent('optimize', { type: 'cleared' });
      runEvent('gunsmith', { type: 'cleared' });
    },
    clearOptimizeResult: () => runEvent('optimize', { type: 'resultCleared' }),
  };
}
