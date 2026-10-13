// Native solves that lie on purpose, for the rejection paths of the count-model pipelines (Fast and Precise): the tests reach them with an honest model
// and a solver whose answer is tampered with.
import type { NativeResult } from '../../src/solver/native';
import { nativeSolve } from '../../src/solver/physical/nativeSolve';
import type { SolveFn } from '../../src/solver/physical/nativeSolve';

/**
 * The pinned solve, with every slot-edge column (`e_*`) of its primal answer raised to at least 1 on the first `times` calls: an integer point that
 * puts more children in a slot than the slot holds, which the decoder cannot place, so the pipeline rejects it and cuts it out. The status, the bound
 * and the readback are the real ones, so the solve stays qualified.
 */
export function overfillEdges(times = Number.POSITIVE_INFINITY): SolveFn & { calls: () => number } {
  let calls = 0;
  const solve = async (lp: string, options: Parameters<SolveFn>[1], extras?: Parameters<SolveFn>[2]): Promise<NativeResult> => {
    const real = await nativeSolve(lp, options, extras);
    if (calls++ >= times || real.colValues === null || real.colNames === null) return real;
    const colValues = Float64Array.from(real.colValues);
    real.colNames.forEach((name, j) => {
      if (name.startsWith('e_')) colValues[j] = Math.max(1, Math.round(colValues[j]));
    });
    return { ...real, colValues };
  };
  return Object.assign(solve, { calls: () => calls });
}
