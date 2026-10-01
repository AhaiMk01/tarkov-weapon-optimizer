import type { OptimizeResponse } from '../../src/api/client';
import type { SolveParams } from '../../src/solver/types';
import { buildLP } from '../../src/solver/lpBuilder';
import { canonicalizeTraderLevels } from '../../src/solver/reuseKey';
import { solveModel, type ModelResponse } from './experimentHelper';

export interface SpatialTelemetry {
  candidate: 'adaptive-envelope';
  nodes: number;
  geometric_splits: number;
  linear_splits: number;
  proved_bounds_retained: number;
  lower_bound: number;
  upper_bound: number | null;
  absolute_gap: number | null;
  normalized_gap: number | null;
  termination: string;
}

export interface AdaptiveSolveResult extends OptimizeResponse {
  mechanism_telemetry?: SpatialTelemetry;
}

/**
 * Prototype A for Issue #27: Adaptive Spatial Envelope.
 * 
 * Mathematically derived splitting rule for the concave penalty q(W) = max(0, 100 - 300/W).
 * For W >= 3, the maximum error of the secant approximation E(W) = q(W) - s(W)
 * occurs uniquely at the geometric mean W* = sqrt(a * b).
 * Splitting at W* cuts the maximum approximation error symmetrically.
 */
export function splitAdaptiveInterval(
  interval: [number, number]
): { parts: [[number, number], [number, number]] | undefined; isGeometric: boolean } {
  const [a, b] = interval;
  if (b - a < 1e-10) return { parts: undefined, isGeometric: false };

  // 1. Breakpoint split: non-differentiable at 3.0 kg
  if (a < 3.0 && b > 3.0) {
    return { parts: [[a, 3.0], [3.0, b]], isGeometric: false };
  }

  // 2. Concave region W >= 3.0: split at maximum secant error point W* = sqrt(a * b)
  if (a >= 3.0) {
    const split = Math.sqrt(a * b);
    if (split <= a + 1e-10 || split >= b - 1e-10) {
      const mid = (a + b) / 2;
      if (mid <= a || mid >= b || b - a < 1e-10) return { parts: undefined, isGeometric: false };
      return { parts: [[a, mid], [mid, b]], isGeometric: false };
    }
    return { parts: [[a, split], [split, b]], isGeometric: true };
  }

  // 3. Flat region W <= 3.0: q(W) = 0 identically, arithmetic midpoint is exact
  const mid = (a + b) / 2;
  if (mid <= a || mid >= b) return { parts: undefined, isGeometric: false };
  return { parts: [[a, mid], [mid, b]], isGeometric: false };
}

export async function solveAdaptiveEnvelope(input: SolveParams): Promise<AdaptiveSolveResult> {
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

  if (!nonlinear) {
    const res = await solveModel(params, undefined, (deadline - performance.now()) / 1000);
    const { axes: _a, bound: _b, incumbentEligible: _e, ...response } = res;
    return response;
  }

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

  let geometricSplits = 0;
  let linearSplits = 0;
  let provedBoundsRetained = 0;

  while (queue.length && nodes < maxNodes && performance.now() < deadline) {
    queue.sort((a, b) => b.bound - a.bound);
    const node = queue.shift()!;
    if (incumbent && node.bound <= incumbent.objective_value + tolerance) {
      closedBound = Math.max(closedBound, node.bound);
      continue;
    }

    const remainingSec = Math.max(0.001, (deadline - performance.now()) / 1000);
    const result = await solveModel(params, node.interval, remainingSec);
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
    } else {
      provedBoundsRetained++;
    }

    if (incumbent && bound <= incumbent.objective_value + tolerance) {
      closedBound = Math.max(closedBound, bound);
      continue;
    }

    const { parts, isGeometric } = splitAdaptiveInterval(node.interval);
    if (!parts) {
      unresolved = Math.max(unresolved, bound);
      limitReason = 'Numerical interval resolution reached before certification';
      break;
    }
    if (isGeometric) geometricSplits++;
    else linearSplits++;

    queue.push({ interval: parts[0], bound }, { interval: parts[1], bound });
  }

  const upper = Math.max(incumbent?.objective_value ?? -Infinity, closedBound, unresolved, ...queue.map(n => n.bound));
  const hasUpper = Number.isFinite(upper) && upper > -Infinity;
  const lowerVal = incumbent?.objective_value ?? 0;
  const absGap = hasUpper ? Math.max(0, upper - lowerVal) : null;
  const normGap = (hasUpper && absGap != null) ? absGap / Math.max(1, Math.abs(lowerVal)) : null;

  if (!incumbent) {
    const exhausted = !queue.length && unresolved === -Infinity;
    return {
      status: exhausted ? 'infeasible' : 'incomplete',
      reason: exhausted ? 'No valid configuration found' : limitReason,
      selected_items: [],
      objective_value: 0,
      solve_time_ms: performance.now() - start,
      mechanism_telemetry: {
        candidate: 'adaptive-envelope',
        nodes,
        geometric_splits: geometricSplits,
        linear_splits: linearSplits,
        proved_bounds_retained: provedBoundsRetained,
        lower_bound: 0,
        upper_bound: hasUpper ? upper : null,
        absolute_gap: absGap,
        normalized_gap: normGap,
        termination: 'limit',
      },
    };
  }

  const certified = absGap != null && absGap <= tolerance;
  const { axes: _a, bound: _b, incumbentEligible: _e, ...response } = incumbent;
  return {
    ...response,
    status: certified ? 'optimal' : 'feasible',
    reason: certified ? undefined : limitReason,
    solve_time_ms: performance.now() - start,
    optimization: {
      lower_bound: lowerVal,
      upper_bound: upper,
      absolute_gap: absGap ?? Infinity,
      tolerance,
      nodes,
      termination: certified ? 'optimal' : 'limit',
    },
    mechanism_telemetry: {
      candidate: 'adaptive-envelope',
      nodes,
      geometric_splits: geometricSplits,
      linear_splits: linearSplits,
      proved_bounds_retained: provedBoundsRetained,
      lower_bound: lowerVal,
      upper_bound: hasUpper ? upper : null,
      absolute_gap: absGap,
      normalized_gap: normGap,
      termination: certified ? 'optimal' : 'limit',
    },
  };
}
