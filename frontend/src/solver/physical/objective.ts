/**
 * The three objective axes of a verified build, from the validator's exact statistics (ADR 0010 section 2).
 *
 * fE = 10 x (TED when TrueErgo is requested, else the first-clamp ergonomics), fR = 1000 x the summed recoil modifier, fP = the exact
 * RUB spend. These are the frames the LP columns `ergo_axis`, `rec_axis` and `price_axis` carry, so scoring a build with
 * `objectiveScore(objectiveModel(request), axes)` (src/solver/trueErgo.ts, the same coefficients the LP writes) re-derives the LP objective
 * from exact statistics instead of from the solver's column values.
 */

import type { ObjectiveAxes } from '../trueErgo';
import { ERGO_SCALE, RECOIL_SCALE } from './specialize';
import type { PhysicalBuildStats } from './validate';

export function axesOfStats(
  stats: Pick<PhysicalBuildStats, 'ergonomics' | 'ted' | 'recoilModifierSum' | 'spend'>,
  useTrueErgo: boolean,
): ObjectiveAxes {
  return {
    fE: ERGO_SCALE * (useTrueErgo ? stats.ted : stats.ergonomics),
    fR: RECOIL_SCALE * stats.recoilModifierSum,
    fP: stats.spend,
  };
}
