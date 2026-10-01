import type { SolveParams, OptimizeResponse, ModelResponse } from '../../src/solver/types';
import { buildLP } from '../../src/solver/lpBuilder';
import { canonicalizeTraderLevels } from '../../src/solver/reuseKey';
import { solveModel } from './experimentHelper';

/**
 * Prototype B for Issue #27: Node-Level Option Tuning.
 * 
 * Tests whether exact-proof solver options (presolve: 'on', simplex_strategy: 1)
 * accelerate individual node MIP solves without loosening mip_rel_gap or
 * compromising dual bound validity.
 */

export const TUNED_NODE_OPTIONS = {
  mip_rel_gap: 0,
  mip_abs_gap: 1e-9,
  mip_feasibility_tolerance: 1e-8,
  primal_feasibility_tolerance: 1e-9,
  dual_feasibility_tolerance: 1e-9,
  presolve: 'on',
  simplex_strategy: 1,
};

export async function solveNodeOptionTuning(input: SolveParams): Promise<OptimizeResponse> {
  const start = performance.now();
  const deadline = start + Math.max(0, input.timeLimitMs ?? 60_000);
  let params = { ...input };
  if (params.traderLevels) params.traderLevels = canonicalizeTraderLevels(params.traderLevels) as any;
  const nonlinear = !!(params.useTrueErgo || params.preventOverswing);
  if (nonlinear) params.preciseMode = true;

  if (performance.now() >= deadline) {
    return {
      status: 'incomplete',
      reason: 'Request time limit reached',
      selected_items: [],
      objective_value: 0,
      solve_time_ms: performance.now() - start,
    };
  }

  // Linear path with tuned options
  if (!nonlinear) {
    const remainingSec = Math.max(0.001, (deadline - performance.now()) / 1000);
    const res = await solveModel(params, undefined, remainingSec, TUNED_NODE_OPTIONS);
    const { axes: _a, bound: _b, incumbentEligible: _e, ...response } = res;
    return response;
  }

  // Nonlinear spatial search with tuned options per node
  const tolerance = Math.max(1e-7, params.objectiveTolerance ?? 1e-5);
  const maxNodes = Math.max(0, params.maxSpatialNodes ?? 512);
  const [lo, hi] = buildLP(params).weightBounds;

  type Node = { interval: [number, number]; bound: number };
  const queue: Node[] = lo < 3 && hi > 3
    ? [{ interval: [lo, 3], bound: Infinity }, { interval: [3, hi], bound: Infinity }]
    : [{ interval: [lo, hi], bound: Infinity }];

  let incumbent: ModelResponse | undefined;
  let nodes = 0;
  let unresolved = -Infinity;
  let limitReason = 'Spatial node or time limit reached';
  let closedBound = -Infinity;

  const splitInterval = (interval: [number, number]): [[number, number], [number, number]] | undefined => {
    const [a, b] = interval;
    const mid = (a + b) / 2;
    if (mid <= a || mid >= b || b - a < 1e-10) return undefined;
    return [[a, mid], [mid, b]];
  };

  while (queue.length && nodes < maxNodes && performance.now() < deadline) {
    queue.sort((a, b) => b.bound - a.bound);
    const node = queue.shift()!;
    if (incumbent && node.bound <= incumbent.objective_value + tolerance) {
      closedBound = Math.max(closedBound, node.bound);
      continue;
    }

    const remainingSec = Math.max(0.001, (deadline - performance.now()) / 1000);
    const result = await solveModel(params, node.interval, remainingSec, TUNED_NODE_OPTIONS);
    nodes++;

    if (result.status === 'infeasible') continue;

    if (result.status !== 'optimal' || result.bound == null) {
      unresolved = Math.max(unresolved, node.bound);
      limitReason = result.reason ?? result.status;
      break;
    }

    const bound = Math.min(node.bound, result.bound);

    if (result.incumbentEligible !== false && result.final_stats) {
      const feasible = !params.preventOverswing || result.final_stats.true_ergo_delta! >= -1e-7;
      if (feasible && (!incumbent || result.objective_value > incumbent.objective_value)) {
        incumbent = result;
      }
    }

    if (incumbent && bound <= incumbent.objective_value + tolerance) {
      closedBound = Math.max(closedBound, bound);
      continue;
    }

    const parts = splitInterval(node.interval);
    if (!parts) {
      unresolved = Math.max(unresolved, bound);
      limitReason = 'Numerical interval resolution reached before certification';
      break;
    }
    queue.push({ interval: parts[0], bound }, { interval: parts[1], bound });
  }

  const upper = Math.max(incumbent?.objective_value ?? -Infinity, closedBound, unresolved, ...queue.map(n => n.bound));
  if (!incumbent) {
    const exhausted = !queue.length && unresolved === -Infinity;
    return {
      status: exhausted ? 'infeasible' : 'incomplete',
      reason: exhausted ? 'No valid configuration found' : limitReason,
      selected_items: [],
      objective_value: 0,
      solve_time_ms: performance.now() - start,
    };
  }

  const gap = Math.max(0, upper - incumbent.objective_value);
  const certified = gap <= tolerance;
  const { axes: _a, bound: _b, incumbentEligible: _e, ...response } = incumbent;
  return {
    ...response,
    status: certified ? 'optimal' : 'feasible',
    reason: certified ? undefined : limitReason,
    solve_time_ms: performance.now() - start,
    optimization: {
      lower_bound: incumbent.objective_value,
      upper_bound: upper,
      absolute_gap: gap,
      tolerance,
      nodes,
      termination: certified ? 'optimal' : 'limit',
    },
  };
}
