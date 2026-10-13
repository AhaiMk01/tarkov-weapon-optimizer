/**
 * The shared native HiGHS instance of the running context (one per page or worker). Everything in the app goes through it, so
 * a corruption discard anywhere re-instantiates for everyone and no second copy of the 3.6 MB module is ever created.
 */

import { NativeHighs } from './native';
import type { HighsOptions } from './options';
import type { ModelReadbackResult, NativeResult, SolveExtras } from './native';

let shared: NativeHighs | undefined;

export function getNativeHighs(): NativeHighs {
  shared ??= new NativeHighs();
  return shared;
}

/** Drop the shared instance (the next call re-instantiates). The app calls this when its own post-processing fails. */
export function discardNativeHighs(): void {
  shared?.discard();
}

export function solveStructured(lpText: string, options?: HighsOptions, extras?: SolveExtras): Promise<NativeResult> {
  return getNativeHighs().solveStructured(lpText, options, extras);
}

export function readbackModel(lpText: string, options?: HighsOptions): Promise<ModelReadbackResult> {
  return getNativeHighs().readbackModel(lpText, options);
}
