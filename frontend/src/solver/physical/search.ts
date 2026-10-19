/**
 * Spatial branch and bound over total weight, and the proof frame of its bounds (ADR 0007 sections 4 and 6, ADR 0010 sections 1 and 2,
 * ADR 0013 section 4C, Phases 2.4b-3b and 2.5).
 *
 * TrueErgo and Prevent Overswing subtract the weight penalty q(W) = max(0, 100 - 300 / W), which is zero up to 3 kg and concave above it.
 * The count model (`specializeCount`, `specializeFast`) models q on a weight node by a verified lower envelope (exact up to 3 kg or at a single weight, a secant otherwise), so a
 * node's optimum is an UPPER bound of the best exactly-scored build of that node, and a decoded build re-scored exactly is an incumbent. This
 * module is the search over nodes, pure: it knows nothing about HiGHS, LP text or builds. A caller supplies `evaluate(node)`.
 *
 * The proof frame. Every number in this module is in the objective frame of the ORACLE (`scale` 1, `offset` 0; a model whose objective chain
 * was multiplied by a power of two converts back exactly before it gets here). Bounds are carried as EXACT rationals (`Bound`: a rational, or
 * `null` for UNKNOWN), and only enclosed by doubles when they are reported, so the certificate is decided on the true gap and never on a
 * representational ulp (at an objective of 9e6 one ulp is 1.9e-9, larger than a 1e-9 tolerance).
 *   - {@link nodeBound} is the ONE place a node's upper bound is computed from what was proved about it: a QUALIFIED native dual bound
 *     (`BoundEvidence`: the parsed model verified, the native tolerances declared, nothing withheld) plus the proved objective frame error, and
 *     the tighter of that and the parent's bound. Evidence that is not qualified proves nothing: the parent's bound stands, which at a root is
 *     unknown (`Infinity` as a double, `null` on the wire), never a finite guess;
 *   - {@link joinBounds} is the ONE place bounds are composed into the global upper bound: the incumbent's exact score, every live node, and
 *     every node closed WITHOUT a proof of emptiness (exactness or tolerance), all in the same frame. Nodes proved empty contribute nothing.
 *     An unknown bound makes the composition unknown, so no finite sibling and no time-limit primal can hide it;
 *   - a node is created with the tighter of its inherited bound and the caller's a-priori bound (`SearchOptions.aprioriBound`, owner decision
 *     2026-10-18 amending G1): a bound proved by exact arithmetic on the objective's structure, with no solve. A node it puts within the
 *     tolerance of the incumbent is fathomed before it is evaluated (or handed to `lookahead`), and that bound joins `fathomed`;
 *   - a `split` evaluation (owner decision F1, 2026-10-12, extended 2026-10-13) only splits its node: its evidence is ignored, its children inherit
 *     the node's own bound, and nothing is pruned, so a verdict the caller did not settle never enters a bound; a verified build it carries is a
 *     witness like any other (it updates the incumbent before the split);
 *   - the lower bound reported is the DOWNWARD enclosure of the verified incumbent's exact score, the incumbent's part of the upper bound its
 *     exact score (the upward enclosure when reported);
 *   - the tolerance is tested against the exact gap `UB - score` (fathoming a node, certifying the search), never a floating difference.
 *
 * Termination. Two facts, kept apart (ADR 0013 section 6):
 *   - `completed`: the search ran to its logical end with every node settled by a proof (no live node, no stop). Emptiness is read from it.
 *   - `finished`: the EXECUTED search finished, which is what `optimization.termination` reports. It is search completion only, never proof
 *     authority: a search whose last node's native solve ran to completion and whose proof or candidate was then withheld (an exact node, no
 *     other live node) is finished but not completed, and a stop on the clock, the node cap or an unsplittable interval is neither.
 * `certified` additionally needs the justified gap within the tolerance, which an unknown bound never has. A search that stopped before
 * finishing always has a live node whose bound exceeds the incumbent by more than the tolerance (nodes within it are fathomed before any limit
 * is checked).
 */

import { attachCompletion } from '../runtimeErrors';
import type { RuntimeGuard } from '../runtimeGuard';
import { ratCmp, ratFromDouble, ratSub, type Rat } from './exact';
import { upperBoundExact, type BoundEvidence } from './proof';
import { INTERVAL_RESOLUTION_REASON, PUBLIC_REASONS } from './reasons';
import { ratRoundUp } from './rational';

/** A closed weight interval in kilograms, or `null` for the single root of a request that has no spatial dimension. */
export interface SearchInterval {
  lo: number;
  hi: number;
}

/**
 * An upper bound of the best score of a region: an exact rational, or `null` when none was proved (UNKNOWN). `undefined` marks "nothing here"
 * in {@link joinBounds}.
 */
export type Bound = Rat | null;
export type MaybeBound = Bound | undefined;

/** The double a bound is reported as: the smallest double at least it, `Infinity` when unknown, `-Infinity` when there is nothing. */
export function boundToNumber(bound: MaybeBound): number {
  if (bound === undefined) return -Infinity;
  if (bound === null) return Infinity;
  try {
    return ratRoundUp(bound);
  } catch {
    return Infinity;
  }
}

const boundOfNumber = (value: number): MaybeBound => (value === -Infinity ? undefined : Number.isFinite(value) ? ratFromDouble(value) : null);

export interface SearchNode {
  /** Monotonic creation number, for deterministic tie-breaks and traces. */
  readonly id: number;
  readonly interval: SearchInterval | null;
  /** Proved upper bound of the best score in this node as a double (the smallest double at least it); `Infinity` until one is proved. */
  readonly bound: number;
  /**
   * The exact score of the incumbent when the node is handed out, `null` without one. A hint for the evaluator only: Precise uses it to tell a
   * first opinion that would only split the node from one whose bound would fathom it (owner decision F1, 2026-10-12, extended 2026-10-13,
   * `solvePrecise.ts`).
   */
  readonly incumbentExact: Rat | null;
}

export interface Candidate<P> {
  /** The exact score of the verified build in the oracle's objective frame, rounded to nearest (what is shown). */
  score: number;
  /** The largest double at most the exact score: the proof lower bound. Default `score`. */
  scoreLower?: number;
  /** The smallest double at least the exact score: the incumbent's part of the upper bound as a double. Default `score`. */
  scoreUpper?: number;
  /** The exact score. Default: the exact value of the double `score`. */
  scoreExact?: Rat;
  payload: P;
}

export const candidateLower = (c: Candidate<unknown>): number => c.scoreLower ?? c.score;
export const candidateUpper = (c: Candidate<unknown>): number => c.scoreUpper ?? c.score;
export const candidateExact = (c: Candidate<unknown>): Rat => c.scoreExact ?? ratFromDouble(c.score);

export type NodeVerdict =
  /** No build lies in the node: a proof of emptiness (confirmed, never a presolve claim alone). */
  | 'infeasible'
  /** The node model was solved to optimality. */
  | 'solved'
  /** The node was not resolved: a limit, or an unconfirmable infeasibility verdict. Stops the search. */
  | 'unresolved'
  /** A candidate failed decoding or independent validation for a reason the relaxation cannot explain. Stops the search. */
  | 'failed'
  /**
   * The node is split at `splitAt` and nothing else (owner decision F1, 2026-10-12, extended 2026-10-13): nothing is pruned and NO bound is taken
   * from the evaluation (its `evidence` is ignored); both children inherit the node's own bound. A verified build it carries (`candidate`) is a
   * witness and updates the incumbent like any other. Splitting discards no region, so it needs no settled verdict. Only an inexact node with an
   * interval can be split; an interval too narrow to split stops the search as an unsplittable `solved` node does (Precise never asks for that
   * under its 2026-10-13 rule, which requires a splittable interval).
   */
  | 'split';

export interface NodeEvaluation<P> {
  verdict: NodeVerdict;
  /**
   * What was proved about the node's best score: a native dual bound, whether the solve was qualified, and the frame error to add. `null` when
   * the node has no native bound (it was proved empty without a solve, or nothing was reported). Unqualified evidence proves nothing.
   */
  evidence: BoundEvidence | null;
  /** A verified build, whatever the verdict: a limit stop can still hold a valid incumbent. */
  candidate: Candidate<P> | null;
  /** The node model is exact: a `solved` node needs no split. */
  exact: boolean;
  /** Total weight of the node optimum: the preferred split point of a non-exact node. */
  splitAt?: number;
  /** The factual stop cause of an `unresolved` or `failed` verdict. */
  reason?: string;
  /**
   * The node's own native search ran to completion although its proof or candidate was withheld: an Optimal solve of an EXACT node (a
   * withheld bound, a rejected build) or an infeasibility verdict that could not be qualified. With no other live node the executed search is
   * then finished (`SearchResult.finished`). A limit stop, and any node that still needs splitting, is never finished.
   */
  finished?: boolean;
}

/**
 * The ONE place a node's upper bound is computed: the tighter of the parent's bound and what the node's own evidence proves. Unqualified or
 * missing evidence leaves the parent's bound (unknown at a root).
 */
export function nodeBound(parent: Bound, evidence: BoundEvidence | null): Bound {
  return tighterBound(parent, upperBoundExact(evidence));
}

/** The smaller of two bounds, an unknown bound (`null`) the identity. */
const tighterBound = (a: Bound, b: Bound): Bound => (a === null ? b : b === null || ratCmp(a, b) <= 0 ? a : b);

/** {@link nodeBound} in doubles: `Infinity` is an unknown parent bound, and the result is the smallest double at least the exact bound. */
export function nodeUpperBound(parentBound: number, evidence: BoundEvidence | null): number {
  return boundToNumber(nodeBound(Number.isFinite(parentBound) ? ratFromDouble(parentBound) : null, evidence));
}

/**
 * The ONE place bounds are joined: the larger of two, `undefined` ("nothing here") the identity, and an unknown bound (`null`) absorbing,
 * because a region whose bound is unknown can hide any value.
 */
export function joinBounds(a: MaybeBound, b: MaybeBound): MaybeBound {
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (a === null || b === null) return null;
  return ratCmp(a, b) >= 0 ? a : b;
}

export interface BoundParts {
  /** The incumbent's score as a double bound, or `-Infinity` without one. */
  incumbent: number;
  /** Bounds of nodes still live (including a node whose evaluation was cut off); `Infinity` is unknown. */
  live: readonly number[];
  /** Largest bound among nodes closed without a proof of emptiness (exactness or tolerance), `-Infinity` when none. */
  fathomed: number;
}

/** The global upper bound composed from doubles: the largest of the incumbent, the live bounds and the fathomed bound (unknown dominates). */
export function combineUpperBounds(parts: BoundParts): number {
  let joined: MaybeBound = joinBounds(boundOfNumber(parts.incumbent), boundOfNumber(parts.fathomed));
  for (const bound of parts.live) joined = joinBounds(joined, boundOfNumber(bound));
  return boundToNumber(joined);
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
  /**
   * The request epoch (ADR 0013 section 4D). With it the search checks the cancel flag and the deadline before every node and yields a MACROTASK
   * between nodes, so an out-of-band cancel message is dispatched and observed at the next check (a microtask await would not deliver it). Its
   * clock and deadline must be the `now` and `deadline` above. Without it only the deadline is checked, as before.
   */
  guard?: RuntimeGuard;
  /**
   * End the search at the first verified build (the first-witness policy of a MOA floor query, ADR 0013 section 6): once an incumbent exists and
   * a node is still live, the search stops with the factual `Native solution limit reached` (a stop at the first improving solution, not a
   * timeout) and is NOT finished or certified. A search with no live node left has completed and is never downgraded by this flag.
   */
  stopAtFirstWitness?: boolean;
  /**
   * A hint, called just before a node is evaluated, with that node and the live nodes that remain in the order the search would take them now (best
   * first). Precise uses it to start the native solves of upcoming nodes early on a solve pool (`speculativeSolves.ts`). It must not change any
   * result: the search reads nothing back from it, and the order nodes are evaluated and committed in is the one below, whatever it does.
   */
  lookahead?(current: SearchNode, upcoming: readonly SearchNode[]): void;
  /**
   * An a-priori upper bound of the exact score of every build whose weight lies in the interval, proved without a solve (`aprioriScoreBound`), or `null`
   * when none is known. Every node created on an interval takes the tighter of its inherited bound and this one.
   */
  aprioriBound?(interval: SearchInterval): Bound;
}

export interface SearchResult<P> {
  incumbent: Candidate<P> | null;
  /** `evaluate` calls made. */
  nodes: number;
  /** Nodes fathomed by their a-priori bound without an evaluation: their inherited bound alone was not within the tolerance of the incumbent. */
  aprioriFathomed: number;
  /** The downward enclosure of the incumbent's exact score, `null` without an incumbent. */
  lowerBound: number | null;
  /** Composed global upper bound: `Infinity` when some live node has no proved bound, `-Infinity` when nothing is left and nothing was found. */
  upperBound: number;
  /** The exact composed upper bound: a rational, `null` when unknown, `undefined` when there is nothing (no live node, no incumbent, nothing closed). */
  upperBoundExact: MaybeBound;
  /** `UB - score` of the exact bound and the exact incumbent score, rounded up to a double (`Infinity` when the upper bound is unknown), `null` without an incumbent. */
  gap: number | null;
  /** Every node was settled by a proof: no live node and no stop. */
  completed: boolean;
  /** The executed search finished (search completion only, never proof authority): `completed`, or a finished last node whose proof was withheld. */
  finished: boolean;
  /** The factual cause of the stop, `null` when the search completed. */
  stopReason: string | null;
  /** The search completed and every node was proved empty: the request has no build (the caller applies confirmation policy). */
  empty: boolean;
  /** `completed` and an incumbent whose justified gap is within the tolerance. */
  certified: boolean;
}

/** The wire form of the bounds of a result: an unknown or unproved value is `null`, never `Infinity`, never zero. */
export function transportedBounds(result: Pick<SearchResult<unknown>, 'lowerBound' | 'upperBound' | 'gap'>): { lower: number | null; upper: number | null; gap: number | null } {
  return {
    lower: result.lowerBound,
    upper: Number.isFinite(result.upperBound) ? result.upperBound : null,
    gap: result.gap !== null && Number.isFinite(result.gap) ? result.gap : null,
  };
}

interface LiveNode {
  id: number;
  interval: SearchInterval | null;
  bound: Bound;
  /** The bound the node inherited (its parent's, unknown at a root), before the a-priori bound. */
  inherited: Bound;
  /** `bound` as a double for ordering and for the node handed to `evaluate`. */
  up: number;
}

const byBoundThenLight = (a: LiveNode, b: LiveNode): number => {
  if (a.up !== b.up) return a.up > b.up ? -1 : 1;
  const alo = a.interval?.lo ?? 0;
  const blo = b.interval?.lo ?? 0;
  return alo !== blo ? alo - blo : a.id - b.id;
};

export async function runSpatialSearch<P>(options: SearchOptions<P>): Promise<SearchResult<P>> {
  const tolerance = ratFromDouble(Math.max(0, options.tolerance));
  let nextId = 0;
  const liveNode = (interval: SearchInterval | null, inherited: Bound, id = nextId++): LiveNode => {
    const bound = interval === null || options.aprioriBound === undefined ? inherited : tighterBound(inherited, options.aprioriBound(interval));
    return { id, interval, bound, inherited, up: boundToNumber(bound) };
  };
  const live: LiveNode[] = options.roots.map(interval => liveNode(interval, null));
  let incumbent: Candidate<P> | null = null;
  let incumbentExact: Rat | null = null;
  /** The joined bound of every node closed without a proof of emptiness: `undefined` while there is none. */
  let fathomed: MaybeBound;
  let nodes = 0;
  let aprioriFathomed = 0;
  let stopReason: string | null = null;
  let finishedAtStop = false;

  /** Is a node with this upper bound within the tolerance of the incumbent? Decided on the EXACT gap, an unknown bound never is. */
  const withinTolerance = (bound: Bound): boolean => incumbentExact !== null && bound !== null && ratCmp(ratSub(bound, incumbentExact), tolerance) <= 0;

  const fathomWithinTolerance = (): void => {
    if (incumbent === null) return;
    for (let k = live.length - 1; k >= 0; k--) {
      if (withinTolerance(live[k].bound)) {
        if (!withinTolerance(live[k].inherited)) aprioriFathomed++;
        fathomed = joinBounds(fathomed, live[k].bound);
        live.splice(k, 1);
      }
    }
  };

  /** Pure interrupts a coincident cancel outranks (section 6 precedence: cancel, deadline, node limit, native solution limit). */
  const interrupts: ReadonlySet<string> = new Set<string>([PUBLIC_REASONS.timeLimitReached, PUBLIC_REASONS.nodeLimitReached, PUBLIC_REASONS.nativeSolutionLimitReached]);
  const withCancelPrecedence = (reason: string): string => (options.guard?.cancelled() === true && interrupts.has(reason) ? PUBLIC_REASONS.cancelledByUser : reason);

  /** The bounds the search would report if it stopped now: the incumbent's score, every closed node and every live node, in one frame. */
  const composeBounds = (): { upper: MaybeBound; lowerBound: number | null; gap: number | null } => {
    let upper: MaybeBound = joinBounds(incumbentExact === null ? undefined : incumbentExact, fathomed);
    for (const n of live) upper = joinBounds(upper, n.bound);
    const gapExact = incumbentExact !== null && upper !== undefined && upper !== null ? ratSub(upper, incumbentExact) : null;
    return {
      upper,
      lowerBound: incumbent === null ? null : candidateLower(incumbent),
      gap: incumbent === null ? null : gapExact === null ? Infinity : boundToNumber(gapExact),
    };
  };

  while (true) {
    fathomWithinTolerance();
    if (live.length === 0) break;
    if (options.stopAtFirstWitness === true && incumbent !== null) { stopReason = PUBLIC_REASONS.nativeSolutionLimitReached; break; }
    live.sort(byBoundThenLight);
    // A stage boundary: yield a MACROTASK, so an out-of-band cancel message is dispatched (a microtask await would not deliver it), then check
    // in the order of section 6: cancel, deadline, node limit. A completed proof (no live node, above) is never downgraded by any of them.
    if (options.guard !== undefined) await options.guard.yieldMacrotask();
    if (options.guard?.cancelled() === true) { stopReason = PUBLIC_REASONS.cancelledByUser; break; }
    if (options.now() >= options.deadline) { stopReason = PUBLIC_REASONS.timeLimitReached; break; }
    if (nodes >= options.maxNodes) { stopReason = PUBLIC_REASONS.nodeLimitReached; break; }
    const node = live.shift() as LiveNode;
    const handed: SearchNode = { id: node.id, interval: node.interval, bound: node.up, incumbentExact };
    options.lookahead?.(handed, live.map(n => ({ id: n.id, interval: n.interval, bound: n.up, incumbentExact })));
    let evaluation: NodeEvaluation<P>;
    try {
      evaluation = await options.evaluate(handed);
    } catch (error) {
      // A native failure ends the search: it travels as a typed error, with what the search had established BEFORE it (the failing node is
      // still live, so it counts toward the upper bound; it is not counted among the completed nodes).
      live.push(node);
      const state = composeBounds();
      const wire = transportedBounds({ lowerBound: state.lowerBound, upperBound: boundToNumber(state.upper), gap: state.gap });
      throw attachCompletion(error, {
        nodes, termination: 'limit', witness: incumbent !== null, lower_bound: wire.lower, upper_bound: wire.upper, absolute_gap: wire.gap,
      });
    }
    nodes++;
    if (evaluation.candidate !== null) {
      const exact = candidateExact(evaluation.candidate);
      if (incumbentExact === null || ratCmp(exact, incumbentExact) > 0) { incumbent = evaluation.candidate; incumbentExact = exact; }
    }
    if (evaluation.verdict === 'split') {
      // Owner decision F1: a split discards nothing (the two closed children cover the node), and it carries no bound: the children inherit the
      // node's OWN bound, never the evaluation's evidence, so an unsettled verdict can neither prune a region nor enter a published bound.
      const halves = node.interval === null ? null : splitInterval(node.interval, evaluation.splitAt);
      if (halves === null) {
        live.push(liveNode(node.interval, node.bound, node.id));
        stopReason = INTERVAL_RESOLUTION_REASON;
        break;
      }
      live.push(liveNode(halves[0], node.bound), liveNode(halves[1], node.bound));
      continue;
    }
    const bound = nodeBound(node.bound, evaluation.evidence);
    if (evaluation.verdict === 'infeasible') continue;
    if (evaluation.verdict === 'unresolved' || evaluation.verdict === 'failed') {
      finishedAtStop = evaluation.finished === true && live.length === 0;
      live.push(liveNode(node.interval, bound, node.id));
      stopReason = withCancelPrecedence(evaluation.reason ?? (evaluation.verdict === 'failed' ? PUBLIC_REASONS.independentBuildValidationFailed : PUBLIC_REASONS.timeLimitReached));
      break;
    }
    // solved
    if (evaluation.exact) {
      fathomed = joinBounds(fathomed, bound);
      continue;
    }
    if (withinTolerance(bound)) {
      fathomed = joinBounds(fathomed, bound);
      continue;
    }
    const parts = node.interval === null ? null : splitInterval(node.interval, evaluation.splitAt);
    if (parts === null) {
      live.push(liveNode(node.interval, bound, node.id));
      stopReason = INTERVAL_RESOLUTION_REASON;
      break;
    }
    live.push(liveNode(parts[0], bound), liveNode(parts[1], bound));
  }

  const { upper, lowerBound, gap } = composeBounds();
  const gapExact = incumbentExact !== null && upper !== undefined && upper !== null ? ratSub(upper, incumbentExact) : null;
  const completed = stopReason === null;
  return {
    incumbent,
    nodes,
    aprioriFathomed,
    lowerBound,
    upperBound: boundToNumber(upper),
    upperBoundExact: upper,
    gap,
    completed,
    finished: completed || finishedAtStop,
    stopReason,
    empty: completed && incumbent === null && fathomed === undefined,
    certified: completed && gapExact !== null && ratCmp(gapExact, tolerance) <= 0,
  };
}

