/**
 * Spatial branch and bound over total weight (ADR 0007 section 6, ADR 0013 section 4C, Phase 2.4b-3b).
 *
 * TrueErgo and Prevent Overswing subtract the weight penalty q(W) = max(0, 100 - 300 / W), which is zero up to 3 kg and concave above it.
 * `specializeLP` models q on a weight node by its lower envelope (exact up to 3 kg or at a single weight, a secant otherwise), so a node's
 * optimum is an UPPER bound of the best exactly-scored build of that node, and a decoded build re-scored exactly is an incumbent. This
 * module is the search over nodes, pure: it knows nothing about HiGHS, LP text or builds. A caller supplies `evaluate(node)`.
 *
 * Structure the numerics phase (2.5) slots into:
 *   - {@link nodeUpperBound} is the ONE place a node's upper bound is computed from what was proved about it (2.5 adds the outward-rounded
 *     native allowance and the secant error here);
 *   - {@link combineUpperBounds} is the ONE place the global upper bound is composed (2.5 turns it into the formal proof frame);
 *   - every number in this module is in the objective frame of the LP, `scale` 1 and `offset` 0 (ADR 0010 section 2).
 *
 * Global bound. It always includes the incumbent, every live node, and every node closed WITHOUT a proof of emptiness: a node closed by
 * exactness (its model was exact, so its best build was found) or fathomed by tolerance (its bound is at most the incumbent plus the
 * tolerance). Nodes proved empty contribute nothing. Dropping the fathomed bounds, as the pre-cutover search did for its exactness
 * closures, would hide the up-to-tolerance slack each fathomed node may still hold. A node bound that was never proved stays `Infinity`.
 *
 * Termination. `completed` means the executed search finished (no live node, no stop): it is search completion only, never proof authority.
 * `optimal` additionally needs the justified gap within the tolerance. A search that stopped before finishing always has a live node whose
 * bound exceeds the incumbent by more than the tolerance (nodes within it are fathomed before any limit is checked).
 */

import { INTERVAL_RESOLUTION_REASON, PUBLIC_REASONS } from './reasons';

/** A closed weight interval in kilograms, or `null` for the single root of a request that has no spatial dimension. */
export interface SearchInterval {
  lo: number;
  hi: number;
}

export interface SearchNode {
  /** Monotonic creation number, for deterministic tie-breaks and traces. */
  readonly id: number;
  readonly interval: SearchInterval | null;
  /** Proved upper bound of the best score in this node; `Infinity` until one is proved. */
  readonly bound: number;
}

export interface Candidate<P> {
  /** Exact score of the verified build, in the objective frame. */
  score: number;
  payload: P;
}

export type NodeVerdict =
  /** No build lies in the node: a proof of emptiness (confirmed, never a presolve claim alone). */
  | 'infeasible'
  /** The node model was solved to optimality. */
  | 'solved'
  /** The node was not resolved: a limit, or an unconfirmable infeasibility verdict. Stops the search. */
  | 'unresolved'
  /** A candidate failed decoding or independent validation for a reason the relaxation cannot explain. Stops the search. */
  | 'failed';

export interface NodeEvaluation<P> {
  verdict: NodeVerdict;
  /** Upper bound on the node's best score as reported by the node model; `null` when none was proved. */
  upperBound: number | null;
  /** A verified build, whatever the verdict: a limit stop can still hold a valid incumbent. */
  candidate: Candidate<P> | null;
  /** The node model is exact: a `solved` node needs no split. */
  exact: boolean;
  /** Total weight of the node optimum: the preferred split point of a non-exact node. */
  splitAt?: number;
  /** The factual stop cause of an `unresolved` or `failed` verdict. */
  reason?: string;
}

/** The ONE place a node's upper bound is computed: the tighter of the parent's bound and what the node's own model proved. */
export function nodeUpperBound(parentBound: number, provedBound: number | null): number {
  if (provedBound === null || Number.isNaN(provedBound)) return parentBound;
  return Math.min(parentBound, provedBound);
}

export interface BoundParts {
  /** Score of the incumbent, or `-Infinity` without one. */
  incumbent: number;
  /** Bounds of nodes still live (including a node whose evaluation was cut off). */
  live: readonly number[];
  /** Largest bound among nodes closed without a proof of emptiness (exactness or tolerance), `-Infinity` when none. */
  fathomed: number;
}

/** The ONE place the global upper bound is composed: the largest of the incumbent, the live bounds and the fathomed bound. */
export function combineUpperBounds(parts: BoundParts): number {
  let upper = Math.max(parts.incumbent, parts.fathomed);
  for (const bound of parts.live) upper = Math.max(upper, bound);
  return upper;
}

/**
 * Split a node interval at `at` (clamped to the middle 80 percent so every split shrinks both children by at least a tenth) or at its
 * midpoint. Splitting at the relaxed optimum's weight makes the children's secants exact there. `null` when the interval cannot be split
 * (a point, or narrower than the numeric floor).
 */
export function splitInterval(interval: SearchInterval, at?: number): [SearchInterval, SearchInterval] | null {
  const { lo, hi } = interval;
  const width = hi - lo;
  if (!(width > 0) || width <= 1e-9 * Math.max(1, Math.abs(hi))) return null;
  let point = lo + width / 2;
  if (at !== undefined && Number.isFinite(at)) point = Math.min(hi - 0.1 * width, Math.max(lo + 0.1 * width, at));
  if (!(point > lo) || !(point < hi)) return null;
  return [{ lo, hi: point }, { lo: point, hi }];
}

export interface SearchOptions<P> {
  /** The root nodes: one `null` interval for a request with no spatial dimension, else disjoint weight intervals covering the active range. */
  roots: readonly (SearchInterval | null)[];
  evaluate(node: SearchNode): Promise<NodeEvaluation<P>>;
  /** Absolute tolerance on the objective: a node within it of the incumbent is fathomed, a gap within it is certified. */
  tolerance: number;
  /** Most `evaluate` calls (outer spatial calls, never native MIP nodes). */
  maxNodes: number;
  now(): number;
  /** Absolute deadline on the `now` clock. */
  deadline: number;
}

export interface SearchResult<P> {
  incumbent: Candidate<P> | null;
  /** `evaluate` calls made. */
  nodes: number;
  /** Composed global upper bound: `Infinity` when some live node has no proved bound, `-Infinity` when nothing is left and nothing was found. */
  upperBound: number;
  /** `upperBound - incumbent.score` (never negative), `null` without an incumbent. */
  gap: number | null;
  /** The search finished: no live node and no stop (search completion only, not proof). */
  completed: boolean;
  /** The factual cause of the stop, `null` when the search completed. */
  stopReason: string | null;
  /** The search completed and every node was proved empty: the request has no build (the caller applies confirmation policy). */
  empty: boolean;
  /** `completed` and an incumbent whose gap is within the tolerance. */
  certified: boolean;
}

const byBoundThenLight = (a: SearchNode, b: SearchNode): number => {
  if (a.bound !== b.bound) return a.bound > b.bound ? -1 : 1;
  const alo = a.interval?.lo ?? 0;
  const blo = b.interval?.lo ?? 0;
  return alo !== blo ? alo - blo : a.id - b.id;
};

export async function runSpatialSearch<P>(options: SearchOptions<P>): Promise<SearchResult<P>> {
  const { tolerance } = options;
  let nextId = 0;
  const live: SearchNode[] = options.roots.map(interval => ({ id: nextId++, interval, bound: Infinity }));
  let incumbent: Candidate<P> | null = null;
  let fathomed = -Infinity;
  let nodes = 0;
  let stopReason: string | null = null;

  const fathomWithinTolerance = (): void => {
    if (incumbent === null) return;
    const limit = incumbent.score + tolerance;
    for (let k = live.length - 1; k >= 0; k--) {
      if (live[k].bound <= limit) {
        fathomed = Math.max(fathomed, live[k].bound);
        live.splice(k, 1);
      }
    }
  };

  while (true) {
    fathomWithinTolerance();
    if (live.length === 0) break;
    live.sort(byBoundThenLight);
    if (options.now() >= options.deadline) { stopReason = PUBLIC_REASONS.timeLimitReached; break; }
    if (nodes >= options.maxNodes) { stopReason = PUBLIC_REASONS.nodeLimitReached; break; }
    const node = live.shift() as SearchNode;
    const evaluation = await options.evaluate(node);
    nodes++;
    if (evaluation.candidate !== null && (incumbent === null || evaluation.candidate.score > incumbent.score)) incumbent = evaluation.candidate;
    const bound = nodeUpperBound(node.bound, evaluation.upperBound);
    if (evaluation.verdict === 'infeasible') continue;
    if (evaluation.verdict === 'unresolved' || evaluation.verdict === 'failed') {
      live.push({ id: node.id, interval: node.interval, bound });
      stopReason = evaluation.reason ?? (evaluation.verdict === 'failed' ? PUBLIC_REASONS.independentBuildValidationFailed : PUBLIC_REASONS.timeLimitReached);
      break;
    }
    // solved
    if (evaluation.exact) {
      fathomed = Math.max(fathomed, bound);
      continue;
    }
    if (incumbent !== null && bound <= incumbent.score + tolerance) {
      fathomed = Math.max(fathomed, bound);
      continue;
    }
    const parts = node.interval === null ? null : splitInterval(node.interval, evaluation.splitAt);
    if (parts === null) {
      live.push({ id: node.id, interval: node.interval, bound });
      stopReason = INTERVAL_RESOLUTION_REASON;
      break;
    }
    live.push({ id: nextId++, interval: parts[0], bound }, { id: nextId++, interval: parts[1], bound });
  }

  const upperBound = combineUpperBounds({ incumbent: incumbent?.score ?? -Infinity, live: live.map(n => n.bound), fathomed });
  const completed = stopReason === null;
  const gap = incumbent === null ? null : Math.max(0, upperBound - incumbent.score);
  return {
    incumbent,
    nodes,
    upperBound,
    gap,
    completed,
    stopReason,
    empty: completed && incumbent === null && fathomed === -Infinity,
    certified: completed && gap !== null && gap <= tolerance,
  };
}
