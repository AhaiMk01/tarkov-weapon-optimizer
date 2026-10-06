/**
 * The Fast (approximate) model on the physical domain (Phase 2.4c, ADR 0013 sections 6 and 7, ADR 0010 sections 1 and 3).
 *
 * `specializeFast(blueprint, domain, request)` emits ONE mixed-integer program of template-level counts as CPLEX-LP text. It reads exactly the
 * domain Precise reads (`SubproblemDomain`: the same active occurrences, accessible bases with no free base, count-bearing preset supply, owned
 * stock, supply caps, exact whole-lot offers) and the same request (every cap, the MOA rows, the weighted or augmented Tchebycheff objective in
 * the oracle frame); only PLACEMENT is approximated. The model has a few thousand columns on every pinned gun (M4A1: 588 templates, 5,569
 * candidate edges), not one per occurrence (151,479).
 *
 * SINGLE COPY (owner decision 2c, `SpecializeRequest.singleCopy`). With the option on, every template's copy bound is capped at one
 * (`copies[t] = min(copies[t], 1)`): the model then allows at most ONE installed copy of each template, so every count and edge column is
 * binary and a template that could repeat needs no presence column. Everything else is unchanged: self-conflicts, supply caps, a preset with
 * several copies of supply (one copy installed, the rest unused), owned stock and whole lots all read the capped bound. The cap is a restriction
 * of the count model (a physical build that repeats a part is not a point of it), so it can lose a build, never invent one. Default off here.
 *
 * Decision columns (all integer, finite):
 *   n_t         copies of item template t installed (binary when at most one copy can exist)
 *   e_s_c       copies of template c installed directly in a slot of raw id s, over all copies of the slot's owner (binary when <= 1)
 *   base_b      the accessible base b (binary)
 * Auxiliary columns: z_t presence of a template that can repeat and takes part in a conflict or MOA row (binary, linked to n_t both ways),
 * lot_t_k whole lots bought of a non-dominated legal offer (integer), f_s_c connectivity flow on a cyclic graph (continuous), and the same
 * statistic, frame, clamp and objective columns as the Precise model (raw_ergo, capped_ergo, rec_mod, rec_axis, price_axis, weight, acc_total,
 * ergo_axis, tch_t, total_obj).
 *
 * Rows (what a count model can state exactly):
 *   in_t        n_t = sum of the edges that install t: every copy has exactly one parent slot
 *   slot_s      sum_c e_s_c <= n_owner (the physical slots of a raw id are the slots of the owner's copies, one child each); = n_owner when
 *               the slot is required, = 1 for a required receiver slot
 *   conflicts   linked presence: sum of z over a clique of pairwise-conflicting templates <= 1 (every conflict pair is in a clique); a self-conflicting template has at most one copy (a column bound);
 *               a slot blocker c: occupancy of each blocked raw slot id + U z_c <= U (occupancy counted over every copy of the owner, the
 *               blocker's own host slot included, exactly as the validator and the reference count it)
 *   includes, caps, MOA, supply caps, deficit cover, wallet, magazine and sighting minimums, recoil caps without division: as in `specializeLP`,
 *               with n_t in place of the sum over the occurrences of t
 *
 * Acquisition. Per template: a capped template (no standalone offer) is limited by preset plus owned supply; a standalone template covers
 * its paid deficit max(0, n_t - preset supply - owned) with whole lots at the exact minimum cost. Two exact reductions keep the model small:
 * an offer that another offer matches or beats in both lot size and price is dropped (the minimum whole-lot cover of every deficit is unchanged),
 * and a template with no supply and one unit-lot offer (or at most one copy) is priced as a linear term on n_t. The deficit surrogate of
 * `specializeLP` is substituted into the cover row (`sum size_k lot_k - n_t + sum q_b base_b >= -owned`: lots are nonnegative, so a negative
 * deficit costs nothing, which is what the surrogate's own lower bound said).
 *
 * What is approximate (and why a witness is still never trusted):
 *   1. NO ANCESTOR-REPETITION RULE. Counts cannot say "a template never recurs on one root-to-leaf path". On an acyclic template graph, which is
 *      every one of the 172 pinned guns, a template cannot be its own descendant, so the rule is vacuous there; on a cyclic graph a point can
 *      repeat a template under itself and the decoder cannot place it.
 *   2. CONNECTIVITY ONLY BY FLOW, ONLY WHERE A CYCLE EXISTS. On an acyclic graph every installed copy is rooted by induction on the topological
 *      order (a copy needs a parent copy of a template above it). On a cyclic graph a cycle of parts could hold each other with no rooted
 *      chain, so the templates on or below a cycle carry a single-commodity flow from the receiver (one unit per installed copy); the flow
 *      proves template-level reachability, not path-level legality.
 *   3. SLOT CONFLICTS ARE AGGREGATE. The blocked slots are all slots of a raw id across the build; this is exact (the rule is global), not an
 *      approximation, but it is stated per raw id and not per physical slot.
 * The model is a relaxation of the physical problem in placement (every physical build is a model point with the same objective), but nothing
 * here claims that every model point is a physical build: the solver decodes a rooted occurrence tree from the counts, the exact physical
 * validator judges it, and a point it rejects is cut out and the model re-solved (`solveFast.ts`).
 *
 * TrueErgo and Prevent Overswing (Phase 2.6b, owner decision 2b). A request that reads TED is specialized on a WEIGHT NODE, exactly as `specializeLP`
 * does for the Precise model, and the same spatial search over total weight (`search.ts`) runs on top of it (`solveFast.ts`). The rows are the
 * Precise ones, on the count model's columns:
 *   gear_ergo, eff_ergo   gear_ergo = f x capped_ergo with f = max(0, 1 + modifier) built exactly (`gearFactor`, two neighbouring inequalities when f is
 *                         not representable), then the second clamp eff_ergo = clamp(gear_ergo, 0, 100) (the general three-regime clamp, prefix c2)
 *   node rows             the closed weight interval [lo, hi] of the node as rows on the `weight` column (the column keeps the active domain)
 *   ted, ted_def          ted = eff_ergo - (slope x weight + intercept), the line being the node's verified lower envelope of the weight penalty
 *                         q(W) = max(0, 100 - 300 / W) (`secantOfPenalty`: exact up to 3 kg or at a single weight, the chord on a concave piece, the zero line
 *                         across the 3 kg knee; the intercept is the largest double that keeps the emitted line at or below the exact chord at both ends)
 *   lim_overswing         ted >= 0 under Prevent Overswing
 *   ergo_frame            fE = 10 x ted under TrueErgo (else 10 x capped_ergo, as before)
 * `weight` is the exact aggregate of the template counts (weight_def: the receiver plus the sum of n_t x weight_t), which is what makes the node
 * restriction a row on counts and the spatial search transfer node by node. Every auxiliary of these rows has a finite enclosed domain (the gear and
 * clamp ranges, the ted enclosure of eff minus the line's range on the node); there is no Big-M literal beyond the clamp's, computed from those ranges.
 * A node whose line is a secant or the knee relaxation is an UPPER bound of the best exactly scored build of the node (the line lies below q), and a
 * build the model returns there may overswing exactly: the validator decides, and the search refines the node (`solveFast.ts`). Like every Fast bound,
 * the bound is the bound of the APPROXIMATE model (the rows are plain doubles, no proof frame): it orders and fathoms the search, it never certifies.
 */

import type { PhysicalBlueprint } from './blueprint';
import { computeActiveBounds, type ActiveBounds } from './bounds';
import type { AccessibleBase, SubproblemDomain } from './domain';
import { PhysicalModelError } from './errors';
import { appendCuts, type DecisionColumn, type IntegerNoGood } from './fastCut';
import { LpWriter, mergeTerms, type RowSense } from './lpText';
import { iAdd, iScale, nextUp, sumEnclosure, type Interval } from './numeric';
import { differenceEnclosure, gearEnclosure, gearFactor } from './proof';
import { lineEnclosure, secantOfPenalty, type NodePenalty, type PenaltyLine } from './spatial';
import {
  AUGMENTATION, ERGO_CLAMP_MAX, ERGO_SCALE, MOA_K, RECOIL_SCALE, checkedNodePenalty,
  type ModelStats, type ObjectiveCoefficient, type ObjectiveMeta, type ProvedEmpty, type SpatialMeta, type SpatialNode, type SpecializeRequest,
} from './specialize';
import { buildTemplateGraph, type TemplateGraph, type TemplateSlot } from './templateGraph';
import type { IdealPoint } from '../types';

// ---------------------------------------------------------------------------------------------
// Constants of the Fast rows
// ---------------------------------------------------------------------------------------------

/** K / 100 = 10000 / 29089, the coefficient scale of the accuracy sum in a MOA row (K = `MOA_K`, the nearest double of 1000000 / 29089). */
const MOA_K_OVER_100 = 10000 / 29089;
/** Floor of a positive Big-M: well above HiGHS's `small_matrix_value`, so the coefficient survives the read. Any larger M is just as valid. */
const MIN_BIG_M = 1e-6;
/**
 * HiGHS drops a matrix entry of magnitude at most the first and rejects one at least the second: its defaults, which `native/options.ts` writes
 * out on every handle (that file is not imported here: this module is pure and must not pull the WebAssembly surface into the barrel).
 */
const HIGHS_SMALL_MATRIX_VALUE = 1e-9;
const HIGHS_LARGE_MATRIX_VALUE = 1e15;

// ---------------------------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------------------------

/** One candidate edge of the model: copies of `child` installed in the slots of raw id `slot.slotId`. */
export interface FastEdge {
  readonly column: string;
  readonly slot: TemplateSlot;
  readonly child: number;
  /** Largest value the column can take. */
  readonly max: number;
}

/** How the paid deficit of one template is modelled. */
export type FastSupplyMode =
  /** No standalone offer: copies are limited by preset plus owned supply. */
  | 'capped'
  /** Priced as a linear term on n_t (no supply, one unit-lot offer or at most one copy). */
  | 'linear'
  /** Whole lots bought against the deficit `n_t - preset supply - owned`. */
  | 'lots'
  /** Owned stock alone covers every possible copy: nothing is ever bought. */
  | 'covered';

export interface FastTemplatePlan {
  readonly template: number;
  readonly templateId: string;
  readonly mode: FastSupplyMode;
  readonly maxCopies: number;
  readonly owned: number;
  /** The non-dominated legal offers, ascending by price and strictly increasing in lot size. */
  readonly lots: readonly { offerIndex: number; source: string; lotSize: number; price: number; maxLots: number }[];
  /** RUB per copy in `linear` mode. */
  readonly unitPrice: number | null;
}

export interface FastModel {
  readonly version: 1;
  readonly blueprint: PhysicalBlueprint;
  readonly domain: SubproblemDomain;
  readonly graph: TemplateGraph;
  /** CPLEX-LP text without cuts. For an empty domain, a one-row infeasible model. */
  readonly lpBase: string;
  readonly provedEmpty: ProvedEmpty | null;
  /** The model text with the cuts of a rejected-point loop spliced in. */
  lp(cuts?: readonly IntegerNoGood[]): string;
  /**
   * The same model with every slot-edge count `e_s_c` continuous over its domain (counts, bases, lots and presence stay integer): a relaxation.
   * Once the template counts are integer, the slot assignment is a flow over the template graph, and its optimum came out integral on every pinned
   * gun, so `solveFast` tries this text first and falls back to {@link lp} when an edge is fractional or the point is rejected.
   */
  lpRelaxedEdges(): string;
  readonly edges: readonly FastEdge[];
  /** Name of the template-count column of an active template, or null. */
  count(t: number): string | null;
  /** Name of the column of accessible base b. */
  base(b: number): string;
  /** The integer decision columns (every edge and every base) with their domains: the points a cut excludes. */
  readonly decision: readonly DecisionColumn[];
  readonly plans: ReadonlyMap<number, FastTemplatePlan>;
  readonly objective: ObjectiveMeta;
  readonly activeBounds: ActiveBounds | null;
  /** Set when the request reads TED: the weight interval enforced on the node and the penalty line used on it. */
  readonly spatial: SpatialMeta | null;
  /**
   * True when every model point is exactly as good as its physical build: false only for a TED request on a node whose penalty line is a relaxation
   * (a secant or the knee line: the objective is then an UPPER bound and `prevent_overswing` is relaxed); the spatial search tightens it.
   */
  readonly exact: boolean;
  /** At most one copy of each template (`SpecializeRequest.singleCopy`): the model is restricted, no build that repeats a part is a point of it. */
  readonly singleCopy: boolean;
  readonly notes: readonly string[];
  /** A written coefficient is at or below HiGHS's `small_matrix_value` (it would be dropped on read) or at or above `large_matrix_value`. */
  readonly matrixFilterRisk: boolean;
  readonly stats: ModelStats;
}

// ---------------------------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------------------------

interface ResolvedFast {
  maxPrice: number | null;
  minErgonomics: number | null;
  maxRecoilV: number | null;
  maxRecoilSum: number | null;
  minMagCapacity: number | null;
  minSightingRange: number | null;
  maxWeight: number | null;
  maxMoa: number | null;
  includeItems: readonly string[];
  includeCategories: readonly (readonly string[])[];
  e: number;
  r: number;
  p: number;
  tchebycheff: IdealPoint | null;
  useTrueErgo: boolean;
  preventOverswing: boolean;
  /** The equipment ergonomics modifier as given (the factor max(0, 1 + modifier) is built exactly by `gearFactor`). */
  gearModifier: number;
  /** At most one copy of every template (the copy bound of each template is capped at 1). */
  singleCopy: boolean;
}

function finite(value: number | null | undefined, name: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new PhysicalModelError('INVALID_REQUEST', `${name} is not a finite number`, { name });
  return value;
}

function resolveFastRequest(request: SpecializeRequest): ResolvedFast {
  const weight = (value: number | null | undefined, fallback: number, name: string): number => Math.max(0, finite(value, name) ?? fallback);
  let tchebycheff: IdealPoint | null = null;
  if (request.useTchebycheff === true) {
    const ideal = request.idealPoint;
    if (!ideal) throw new PhysicalModelError('INVALID_REQUEST', 'use_tchebycheff requires an ideal point (INTERPRETATIONS.md choice 9)', { name: 'idealPoint' });
    for (const key of ['zE', 'nadE', 'zR', 'nadR', 'zP', 'nadP'] as const) finite(ideal[key], `idealPoint.${key}`);
    tchebycheff = { ...ideal };
  }
  return {
    maxPrice: finite(request.maxPrice, 'maxPrice'),
    minErgonomics: finite(request.minErgonomics, 'minErgonomics'),
    maxRecoilV: finite(request.maxRecoilV, 'maxRecoilV'),
    maxRecoilSum: finite(request.maxRecoilSum, 'maxRecoilSum'),
    minMagCapacity: finite(request.minMagCapacity, 'minMagCapacity'),
    minSightingRange: finite(request.minSightingRange, 'minSightingRange'),
    maxWeight: finite(request.maxWeight, 'maxWeight'),
    maxMoa: finite(request.maxMOA, 'maxMOA'),
    includeItems: [...new Set(request.includeItems ?? [])],
    includeCategories: (request.includeCategories ?? []).map(group => [...group]),
    e: weight(request.ergoWeight, 1, 'ergoWeight'),
    r: weight(request.recoilWeight, 1, 'recoilWeight'),
    p: weight(request.priceWeight, 0, 'priceWeight'),
    tchebycheff,
    useTrueErgo: request.useTrueErgo === true,
    preventOverswing: request.preventOverswing === true,
    gearModifier: finite(request.equipErgoModifier, 'equipErgoModifier') ?? 0,
    singleCopy: request.singleCopy === true,
  };
}

const clampErgo = (x: number): number => Math.min(ERGO_CLAMP_MAX, Math.max(0, x));

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

const countName = (t: number): string => `n_${t}`;
const edgeName = (rawIdx: number, child: number): string => `e_${rawIdx}_${child}`;
const baseName = (b: number): string => `base_${b}`;
const presenceName = (t: number): string => `z_${t}`;
const lotName = (t: number, k: number): string => `lot_${t}_${k}`;
const flowName = (rawIdx: number, child: number): string => `f_${rawIdx}_${child}`;

/** Offers that no other offer beats on both lot size and price, ascending by price with strictly increasing size (ties keep the earlier offer). */
export function nonDominatedLots<T extends { index: number; price: number; lotSize: number }>(offers: readonly T[]): T[] {
  const sorted = [...offers].sort((a, b) => a.price - b.price || b.lotSize - a.lotSize || a.index - b.index);
  const kept: T[] = [];
  let largest = 0;
  for (const offer of sorted) {
    if (offer.lotSize > largest) {
      kept.push(offer);
      largest = offer.lotSize;
    }
  }
  return kept;
}

/**
 * A greedy cover of the conflict pairs (flat `[a0, b0, a1, b1, ...]`, both sides active) by cliques of the conflict graph: every pair lies in at least one
 * returned clique and every clique is a set of templates that pairwise conflict. Deterministic: pairs are taken in the blueprint's order, each seeded clique
 * grows by the common neighbour that covers the most pairs not covered yet (ties: the lowest index).
 */
export function cliqueCover(pairs: ArrayLike<number>, active: ArrayLike<number>): number[][] {
  const neighbours = new Map<number, Set<number>>();
  const link = (a: number, b: number): void => {
    let set = neighbours.get(a);
    if (!set) neighbours.set(a, (set = new Set()));
    set.add(b);
  };
  const uncovered = new Set<string>();
  const key = (a: number, b: number): string => (a < b ? `${a},${b}` : `${b},${a}`);
  const order: [number, number][] = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const a = pairs[i];
    const b = pairs[i + 1];
    if (!active[a] || !active[b] || a === b) continue; // a pair with an absent side excludes nothing
    link(a, b);
    link(b, a);
    if (!uncovered.has(key(a, b))) {
      uncovered.add(key(a, b));
      order.push([a, b]);
    }
  }
  const cliques: number[][] = [];
  for (const [a, b] of order) {
    if (!uncovered.has(key(a, b))) continue;
    const clique = [a, b];
    let candidates = [...(neighbours.get(a) as Set<number>)].filter(x => x !== b && (neighbours.get(b) as Set<number>).has(x)).sort((x, y) => x - y);
    while (candidates.length > 0) {
      let best = candidates[0];
      let bestScore = -1;
      for (const x of candidates) {
        let score = 0;
        for (const member of clique) if (uncovered.has(key(x, member))) score++;
        if (score > bestScore) {
          bestScore = score;
          best = x;
        }
      }
      clique.push(best);
      candidates = candidates.filter(x => x !== best && (neighbours.get(best) as Set<number>).has(x));
    }
    for (let i = 0; i < clique.length; i++) for (let j = i + 1; j < clique.length; j++) uncovered.delete(key(clique[i], clique[j]));
    cliques.push(clique);
  }
  return cliques;
}

// ---------------------------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------------------------

class FastSpecializer {
  readonly w = new LpWriter();
  readonly notes: string[] = [];
  readonly plans = new Map<number, FastTemplatePlan>();
  readonly edges: FastEdge[] = [];
  readonly decision: DecisionColumn[] = [];
  readonly contradictionDetails: string[] = [];
  private zeroColumn = false;
  private readonly presence = new Map<number, string>();
  /** The linear price coefficient of each template priced as `unitPrice` x n_t. */
  private readonly linearPrices: [number, number][] = [];
  private readonly lotPrices: { column: string; price: number }[] = [];
  /** Edge columns of a slot, by slot index. */
  private readonly edgeColumns: { child: number; column: string; max: number }[][];
  private readonly edgeByKey = new Map<string, FastEdge>();
  /** The weight interval the node leaves on the active weight domain (the whole domain without a node). */
  weightInterval: Interval = { lo: 0, hi: 0 };
  /** The weight-penalty line of a TED request on this node. */
  penalty: NodePenalty | { line: PenaltyLine; kind: 'supplied'; exact: boolean } | null = null;
  /** The column the ergonomics axis is read from: the first clamp, or TED. */
  ergoColumn: 'capped_ergo' | 'ted' = 'capped_ergo';

  readonly bp: PhysicalBlueprint;
  readonly domain: SubproblemDomain;
  readonly graph: TemplateGraph;
  readonly req: ResolvedFast;
  readonly bounds: ActiveBounds;
  readonly node: SpatialNode | undefined;

  constructor(bp: PhysicalBlueprint, domain: SubproblemDomain, graph: TemplateGraph, req: ResolvedFast, bounds: ActiveBounds, node: SpatialNode | undefined) {
    this.bp = bp;
    this.domain = domain;
    this.graph = graph;
    this.req = req;
    this.bounds = bounds;
    this.node = node;
    this.edgeColumns = graph.slots.map(() => []);
  }

  private get copies(): Int32Array {
    return this.graph.maxCopies;
  }

  /** Write a row; a row with no variables is a constant statement: dropped when true, a contradiction row when false. */
  emit(name: string, terms: Iterable<readonly [string, number]>, sense: RowSense, rhs: number, detail: string): void {
    const merged = mergeTerms(terms);
    if (merged.names.length === 0) {
      const holds = sense === '<=' ? 0 <= rhs : sense === '>=' ? 0 >= rhs : rhs === 0;
      if (!holds) this.contradict(name, detail);
      return;
    }
    this.w.addMerged(name, merged, sense, rhs);
  }

  private contradict(row: string, detail: string): void {
    if (!this.zeroColumn) {
      this.w.addColumn('zero_col', 'continuous', 0, 0);
      this.zeroColumn = true;
    }
    this.w.addRow(`contra_${this.contradictionDetails.length}`, [['zero_col', 1]], '>=', 1);
    this.contradictionDetails.push(`${row}: ${detail}`);
  }

  private integerColumn(name: string, hi: number): void {
    this.w.addColumn(name, hi === 1 ? 'binary' : 'integer', 0, hi, false);
    this.decision.push({ name, lo: 0, hi });
  }

  // --- columns --------------------------------------------------------------------------------

  private declareDecisionColumns(): void {
    const { domain, graph } = this;
    for (let b = 0; b < domain.bases.length; b++) {
      this.w.addColumn(baseName(b), 'binary', 0, 1);
      this.decision.push({ name: baseName(b), lo: 0, hi: 1 });
    }
    for (let t = 1; t < graph.templateCount; t++) {
      if (!graph.active[t]) continue;
      this.w.addColumn(countName(t), this.copies[t] === 1 ? 'binary' : 'integer', 0, this.copies[t], false);
    }
    for (const slot of graph.slots) {
      const ownerCopies = this.copies[slot.owner];
      for (const child of slot.candidates) {
        const max = Math.min(ownerCopies, this.copies[child]);
        const column = edgeName(slot.rawIdx, child);
        this.integerColumn(column, max);
        const edge: FastEdge = { column, slot, child, max };
        this.edges.push(edge);
        this.edgeColumns[slot.index].push({ child, column, max });
        this.edgeByKey.set(`${slot.index}:${child}`, edge);
      }
    }
  }

  /** The column that is 1 exactly when at least one copy of t is installed: n_t itself when at most one copy can exist, else a linked binary. */
  private presenceOf(t: number): string {
    if (this.copies[t] === 1) return countName(t);
    let name = this.presence.get(t);
    if (name === undefined) {
      name = presenceName(t);
      this.presence.set(t, name);
      this.w.addColumn(name, 'binary', 0, 1);
      // n_t <= U z_t  and  z_t <= n_t
      this.emit(`zup_${t}`, [[countName(t), 1], [name, -this.copies[t]]], '<=', 0, `presence of ${this.bp.templateIds[t]}`);
      this.emit(`zlo_${t}`, [[name, 1], [countName(t), -1]], '<=', 0, `presence of ${this.bp.templateIds[t]}`);
    }
    return name;
  }

  // --- supply and wallet ----------------------------------------------------------------------

  private presetTerms(t: number, sign: number): [string, number][] {
    return this.domain.templates[t].presetSupply.map(({ base, quantity }) => [baseName(base), sign * quantity] as [string, number]);
  }

  /** Plan and emit the supply rows of every active template; returns the upper bound of the spend. */
  private emitSupply(): number {
    const { bp, domain, graph } = this;
    let priceUpper = Math.max(0, ...domain.bases.map(base => base.cheapestPrice));
    let priceTerms = domain.bases.length;
    for (let t = 1; t < graph.templateCount; t++) {
      if (!graph.active[t]) continue;
      const acquisition = domain.templates[t];
      if (acquisition.supply !== 'standalone' && acquisition.supply !== 'capped') {
        throw new PhysicalModelError('DOMAIN_INCONSISTENT', `Template ${bp.templateIds[t]} has active occurrences but supply '${acquisition.supply}'`, { template: t });
      }
      const maxCopies = this.copies[t];
      const base: Omit<FastTemplatePlan, 'mode' | 'lots' | 'unitPrice'> = { template: t, templateId: bp.templateIds[t], maxCopies, owned: acquisition.owned };
      if (acquisition.supply === 'capped') {
        // n_t <= sum_b q_bt base_b + owned: a template with no legal standalone offer is never bought (ADR 0002 principle 8).
        this.emit(`supcap_${t}`, [[countName(t), 1], ...this.presetTerms(t, -1)], '<=', acquisition.owned, `supply cap of ${bp.templateIds[t]}`);
        this.plans.set(t, { ...base, mode: 'capped', lots: [], unitPrice: null });
        continue;
      }
      const lots = nonDominatedLots(acquisition.standaloneLots);
      const surrogateMax = Math.max(0, maxCopies - acquisition.owned);
      if (surrogateMax === 0) {
        this.plans.set(t, { ...base, mode: 'covered', lots: [], unitPrice: null });
        continue;
      }
      const supplied = acquisition.presetSupply.length > 0 || acquisition.owned > 0;
      const unitLot = lots.length === 1 && lots[0].lotSize === 1;
      if (!supplied && (unitLot || maxCopies === 1)) {
        // The cheapest legal lot covers one unit, so a single copy costs the cheapest price; unit lots cost price per copy.
        const unitPrice = lots[0].price;
        this.linearPrices.push([t, unitPrice]);
        priceUpper += unitPrice * maxCopies;
        priceTerms++;
        this.plans.set(t, { ...base, mode: 'linear', lots: lots.map(l => ({ offerIndex: l.index, source: l.source, lotSize: l.lotSize, price: l.price, maxLots: maxCopies })), unitPrice });
        continue;
      }
      const planned = lots.map(l => ({ offerIndex: l.index, source: l.source, lotSize: l.lotSize, price: l.price, maxLots: Math.ceil(surrogateMax / l.lotSize) }));
      planned.forEach((lot, k) => {
        this.w.addColumn(lotName(t, k), 'integer', 0, lot.maxLots);
        this.lotPrices.push({ column: lotName(t, k), price: lot.price });
        priceUpper += lot.price * lot.maxLots;
        priceTerms++;
      });
      // whole lots cover the deficit: sum_k size_k lot_k >= n_t - sum_b q_bt base_b - owned
      const cover: [string, number][] = planned.map((lot, k) => [lotName(t, k), lot.lotSize] as [string, number]);
      cover.push([countName(t), -1], ...this.presetTerms(t, 1));
      this.emit(`cover_${t}`, cover, '>=', -acquisition.owned, `lot cover of ${bp.templateIds[t]}`);
      this.plans.set(t, { ...base, mode: 'lots', lots: planned, unitPrice: null });
    }
    return sumEnclosure(0, priceUpper, priceTerms, priceUpper).hi;
  }

  // --- structure ------------------------------------------------------------------------------

  private emitBase(): void {
    this.emit('base_sum', this.domain.bases.map((_, b) => [baseName(b), 1] as [string, number]), '=', 1, 'no accessible base');
  }

  private emitStructure(): void {
    const { graph } = this;
    // in_t: every installed copy has exactly one parent slot.
    for (let t = 1; t < graph.templateCount; t++) {
      if (!graph.active[t]) continue;
      const terms: [string, number][] = [[countName(t), 1]];
      for (const slot of graph.slotsHolding[t]) terms.push([(this.edgeByKey.get(`${slot.index}:${t}`) as FastEdge).column, -1]);
      this.emit(`in_${t}`, terms, '=', 0, `parentage of ${this.bp.templateIds[t]}`);
    }
    // slot_s: one child per physical slot; required occupancy.
    for (const slot of graph.slots) {
      const occupancy = this.edgeColumns[slot.index].map(({ column }) => [column, 1] as [string, number]);
      if (slot.owner === 0) {
        if (slot.required) this.emit(`req_${slot.index}`, occupancy, '=', 1, `required root slot ${slot.slotId}`);
        else if (occupancy.length > 1) this.emit(`slot_${slot.index}`, occupancy, '<=', 1, `root slot ${slot.slotId}`);
      } else {
        this.emit(slot.required ? `req_${slot.index}` : `slot_${slot.index}`, [...occupancy, [countName(slot.owner), -1]], slot.required ? '=' : '<=', 0, `slot ${slot.slotId}`);
      }
    }
  }

  /** The most copies any slot of raw id `slot` can hold: one per copy of its owner, and no more than its edges can supply. */
  private occupancyBound(slot: TemplateSlot): number {
    let sum = 0;
    for (const { max } of this.edgeColumns[slot.index]) sum += max;
    return Math.min(this.copies[slot.owner], sum);
  }

  private emitConflicts(): void {
    const { bp, graph } = this;
    // Template conflicts by presence. The pairs are covered by cliques of the conflict graph (a set of templates that pairwise conflict: at most one is
    // present), written as one row each: the same feasible set as one row per pair, a tighter LP, and about 40% faster on the M4A1 family.
    cliqueCover(bp.templateConflictPairs, graph.active).forEach((clique, k) => {
      this.emit(`tconf_${k}`, clique.map(t => [this.presenceOf(t), 1] as [string, number]), '<=', 1, `conflict clique ${clique.map(t => bp.templateIds[t]).join('/')}`);
    });
    const slotByRaw = new Map<number, TemplateSlot>();
    for (const slot of graph.slots) slotByRaw.set(slot.rawIdx, slot);
    for (let t = 1; t < graph.templateCount; t++) {
      if (!graph.active[t]) continue;
      for (const raw of bp.slotConflictsOf(t)) {
        const slot = slotByRaw.get(raw);
        if (!slot) continue; // no active candidate can occupy a slot of that id
        const bound = this.occupancyBound(slot);
        const occupancy = this.edgeColumns[slot.index].map(({ column }) => [column, 1] as [string, number]);
        // occupancy(raw id) + U z_t <= U, U the most the id can hold: z_t = 1 forces every physical slot of that id empty, the blocker's own included.
        this.emit(`sconf_${t}_${slot.index}`, [...occupancy, [this.presenceOf(t), bound]], '<=', bound, `slot conflict ${bp.templateIds[t]}/${slot.slotId}`);
      }
    }
  }

  private emitIncludes(): void {
    const { bp, graph } = this;
    this.req.includeItems.forEach((id, k) => {
      const t = bp.templateIndexOf(id);
      const terms: [string, number][] = t > 0 && graph.active[t] ? [[countName(t), 1]] : [];
      this.emit(t > 0 ? `incl_${t}` : `incl_unknown_${k}`, terms, '>=', 1, `included item ${id} has no active occurrence`);
    });
    this.req.includeCategories.forEach((group, g) => {
      const terms: [string, number][] = [];
      for (let t = 1; t < graph.templateCount; t++) {
        if (graph.active[t] && bp.templateCategoryChain[t].some(category => group.includes(category))) terms.push([countName(t), 1]);
      }
      this.emit(`catreq_${g}`, terms, '>=', 1, `include group ${g} [${group.join(', ')}] matches no active occurrence`);
    });
  }

  /** Single-commodity flow from the receiver over the templates on or below a cycle: one unit per installed copy, so no cycle floats free. */
  private emitConnectivity(): void {
    const { graph } = this;
    if (graph.acyclic) return;
    let capacity = 0;
    for (let t = 1; t < graph.templateCount; t++) if (graph.region[t]) capacity += this.copies[t];
    const incoming = new Map<number, [string, number][]>();
    const outgoing = new Map<number, [string, number][]>();
    for (const slot of graph.slots) {
      for (const { child, column } of this.edgeColumns[slot.index]) {
        if (!graph.region[child]) continue;
        const flow = flowName(slot.rawIdx, child);
        this.w.addColumn(flow, 'continuous', 0, capacity);
        this.emit(`fl_${slot.index}_${child}`, [[flow, 1], [column, -capacity]], '<=', 0, `flow link ${flow}`);
        (incoming.get(child) ?? incoming.set(child, []).get(child)!).push([flow, 1]);
        if (graph.region[slot.owner]) (outgoing.get(slot.owner) ?? outgoing.set(slot.owner, []).get(slot.owner)!).push([flow, -1]);
      }
    }
    for (let t = 1; t < graph.templateCount; t++) {
      if (!graph.region[t]) continue;
      // inflow - outflow = n_t: every copy absorbs one unit that came from the receiver.
      this.emit(`fc_${t}`, [...(incoming.get(t) ?? []), ...(outgoing.get(t) ?? []), [countName(t), -1]], '=', 0, `flow conservation of ${this.bp.templateIds[t]}`);
    }
    this.notes.push('the template graph has a cycle: the templates on or below it carry a connectivity flow, and a point may still repeat a template under itself (rejected when decoded)');
  }

  // --- statistics -----------------------------------------------------------------------------

  private declareAux(name: string, lo: number, hi: number): void {
    this.w.addColumn(name, 'continuous', lo, hi);
  }

  private statTerms(values: Readonly<Float64Array>, sign: number): [string, number][] {
    const terms: [string, number][] = [];
    for (let t = 1; t < this.graph.templateCount; t++) {
      if (!this.graph.active[t] || values[t] === 0) continue;
      terms.push([countName(t), sign * values[t]]);
    }
    return terms;
  }

  /** The general three-regime clamp of `source` into `target` over [0, cap]: exact for any sign of the source. */
  private emitClamp(prefix: string, source: string, target: string, src: Interval, cap: number): void {
    const m = Math.ceil(nextUp(Math.max(Math.abs(src.lo), Math.abs(src.hi), cap) + cap));
    const low = `${prefix}_low`;
    const mid = `${prefix}_mid`;
    const high = `${prefix}_high`;
    for (const name of [low, mid, high]) this.w.addColumn(name, 'binary', 0, 1);
    const row = (suffix: string, terms: [string, number][], sense: RowSense, rhs: number): void => this.emit(`${prefix}_${suffix}`, terms, sense, rhs, `clamp ${prefix}`);
    row('regime', [[low, 1], [mid, 1], [high, 1]], '=', 1);
    row('lo', [[source, 1], [low, m]], '<=', m);
    row('hi', [[source, 1], [high, -m]], '>=', cap - m);
    row('midlo', [[source, 1], [mid, -m]], '>=', -m);
    row('midhi', [[source, 1], [mid, m]], '<=', cap + m);
    row('zero', [[target, 1], [low, cap]], '<=', cap);
    row('full', [[target, 1], [high, -cap]], '>=', 0);
    row('eqlo', [[target, 1], [source, -1], [mid, -m]], '>=', -m);
    row('eqhi', [[target, 1], [source, -1], [mid, m]], '<=', m);
  }

  private emitStatistics(priceUpper: number): { ergoAxis: Interval; recAxis: Interval; priceAxis: Interval } {
    const { bp, domain, req, bounds } = this;
    const rawErgo = bounds.ergonomics;
    const capped: Interval = { lo: clampErgo(rawErgo.lo), hi: clampErgo(rawErgo.hi) };
    const recMod = bounds.recoil;
    const recAxis = iScale(RECOIL_SCALE, recMod);
    const priceAxis: Interval = { lo: 0, hi: priceUpper };
    const tedMode = req.useTrueErgo || req.preventOverswing;
    const needWeight = tedMode || req.maxWeight !== null;

    this.declareAux('raw_ergo', rawErgo.lo, rawErgo.hi);
    this.declareAux('capped_ergo', capped.lo, capped.hi);
    this.declareAux('rec_mod', recMod.lo, recMod.hi);
    this.declareAux('rec_axis', recAxis.lo, recAxis.hi);
    this.declareAux('price_axis', priceAxis.lo, priceAxis.hi);
    if (needWeight) {
      // The column keeps the full active domain and a node is enforced by ROWS, as in the Precise model.
      const weight = bounds.weight;
      this.declareAux('weight', weight.lo, weight.hi);
      // A node is read by a request that reads TED only (a weight cap alone has no spatial dimension).
      const node = tedMode ? this.node : undefined;
      const lo = node ? Math.max(weight.lo, node.weightMin) : weight.lo;
      const hi = node ? Math.min(weight.hi, node.weightMax) : weight.hi;
      this.weightInterval = { lo, hi };
      if (node && lo > hi) {
        // The node does not meet the weights any build can have: no build lies in it.
        this.contradict('node', `the weight node [${node.weightMin}, ${node.weightMax}] is disjoint from the active weight range [${weight.lo}, ${weight.hi}]`);
      } else if (node) {
        if (node.weightMin === node.weightMax) {
          this.emit('node_fix', [['weight', 1]], '=', node.weightMin, 'weight node');
        } else {
          if (node.weightMin > weight.lo) this.emit('node_lo', [['weight', 1]], '>=', node.weightMin, 'weight node');
          if (node.weightMax < weight.hi) this.emit('node_hi', [['weight', 1]], '<=', node.weightMax, 'weight node');
        }
      }
    }
    if (req.maxMoa !== null) this.declareAux('acc_total', bounds.accuracy.lo, bounds.accuracy.hi);

    // The receiver's constant on the right-hand side, installed copies on the left.
    const stat = (name: string, terms: [string, number][], rhs: number): void => this.emit(name, terms, '=', rhs, name);
    stat('raw_ergo_def', [['raw_ergo', 1], ...this.statTerms(bp.templateErgonomics, -1)], bp.templateErgonomics[0]);
    stat('rec_mod_def', [['rec_mod', 1], ...this.statTerms(bp.templateRecoilModifier, -1)], 0);
    stat('rec_axis_def', [['rec_axis', 1], ['rec_mod', -RECOIL_SCALE]], 0);
    if (needWeight) stat('weight_def', [['weight', 1], ...this.statTerms(bp.templateWeight, -1)], bp.templateWeight[0]);
    if (req.maxMoa !== null) stat('acc_def', [['acc_total', 1], ...this.statTerms(bp.templateAccuracyModifier, -1)], 0);
    this.emitClamp('c1', 'raw_ergo', 'capped_ergo', rawErgo, ERGO_CLAMP_MAX);

    // gear factor, second clamp, TED (the rows of `specializeLP`, on the count model's columns)
    let ergoSource: Interval = capped;
    if (tedMode) {
      // f = max(0, 1 + modifier) is built exactly: a representable f is one equality, otherwise the two inequalities low x capped <= gear <= high x
      // capped (the first clamp is never negative), which enclose f x capped for the real f.
      const factor = gearFactor(req.gearModifier);
      const gear = gearEnclosure(factor, capped);
      const eff: Interval = { lo: clampErgo(gear.lo), hi: clampErgo(gear.hi) };
      this.declareAux('gear_ergo', gear.lo, gear.hi);
      this.declareAux('eff_ergo', eff.lo, eff.hi);
      if (factor.low === factor.high) {
        this.emit('gear_def', [['gear_ergo', 1], ['capped_ergo', -factor.low]], '=', 0, 'gear factor');
      } else {
        this.emit('gear_def_lo', [['gear_ergo', 1], ['capped_ergo', -factor.low]], '>=', 0, 'gear factor (lower neighbour)');
        this.emit('gear_def_hi', [['gear_ergo', 1], ['capped_ergo', -factor.high]], '<=', 0, 'gear factor (upper neighbour)');
      }
      this.emitClamp('c2', 'gear_ergo', 'eff_ergo', gear, ERGO_CLAMP_MAX);
      const { lo, hi } = this.weightInterval;
      if (lo <= hi) {
        const penalty = this.node?.penalty ? checkedNodePenalty(lo, hi, this.node.penalty) : secantOfPenalty(lo, hi);
        this.penalty = penalty;
        const ted = differenceEnclosure(eff, lineEnclosure(penalty.line, lo, hi));
        this.declareAux('ted', ted.lo, ted.hi);
        // ted = eff - (slope W + intercept)
        this.emit('ted_def', [['ted', 1], ['eff_ergo', -1], ['weight', penalty.line.slope]], '=', -penalty.line.intercept, 'TED definition');
        if (req.preventOverswing) this.emit('lim_overswing', [['ted', 1]], '>=', 0, 'prevent overswing');
        if (req.useTrueErgo) {
          ergoSource = ted;
          this.ergoColumn = 'ted';
        }
      } else {
        // The node is empty (its contradiction row is written): the column only has to exist with a finite domain.
        this.declareAux('ted', 0, 0);
        if (req.useTrueErgo) {
          ergoSource = { lo: 0, hi: 0 };
          this.ergoColumn = 'ted';
        }
      }
    }
    const ergoAxis = iScale(ERGO_SCALE, ergoSource);
    this.declareAux('ergo_axis', ergoAxis.lo, ergoAxis.hi);
    this.emit('ergo_frame', [['ergo_axis', 1], [this.ergoColumn, -ERGO_SCALE]], '=', 0, 'ergonomics frame');

    // The exact wallet: the cheapest legal base lot plus the whole-lot cost of every paid deficit.
    const wallet: [string, number][] = [['price_axis', 1]];
    domain.bases.forEach((base: AccessibleBase, b) => wallet.push([baseName(b), -base.cheapestPrice]));
    for (const [t, price] of this.linearPrices) wallet.push([countName(t), -price]);
    for (const { column, price } of this.lotPrices) wallet.push([column, -price]);
    this.emit('price_def', wallet, '=', 0, 'wallet');
    return { ergoAxis, recAxis, priceAxis };
  }

  private emitCaps(): void {
    const { bp, req, graph } = this;
    if (req.maxPrice !== null) this.emit('lim_price', [['price_axis', 1]], '<=', req.maxPrice, `max price ${req.maxPrice} is below every spend`);
    if (req.minErgonomics !== null) this.emit('lim_min_ergo', [['capped_ergo', 1]], '>=', req.minErgonomics, `min ergonomics ${req.minErgonomics}`);
    // final recoil = naked x (1 + modifier sum) <= cap  <=>  naked x modifier <= cap - naked; no division, any sign of naked.
    const nakedV = bp.receiverRecoilVertical;
    const nakedH = bp.receiverRecoilHorizontal;
    if (req.maxRecoilV !== null) this.emit('lim_recoil_v', [['rec_mod', nakedV]], '<=', req.maxRecoilV - nakedV, `max vertical recoil ${req.maxRecoilV}`);
    if (req.maxRecoilSum !== null) this.emit('lim_recoil_sum', [['rec_mod', nakedV + nakedH]], '<=', req.maxRecoilSum - (nakedV + nakedH), `max recoil sum ${req.maxRecoilSum}`);
    const minimum = (name: string, limit: number | null, values: Readonly<Float64Array>, what: string): void => {
      if (limit === null || values[0] >= limit) return; // the receiver meets it
      const reaching: [string, number][] = [];
      for (let t = 1; t < graph.templateCount; t++) if (graph.active[t] && values[t] >= limit) reaching.push([countName(t), 1]);
      this.emit(name, reaching, '>=', 1, `no active template reaches the ${what} minimum ${limit}`);
    };
    minimum('lim_mag', req.minMagCapacity, bp.templateCapacity, 'magazine capacity');
    minimum('lim_sight', req.minSightingRange, bp.templateSightingRange, 'sighting range');
    if (req.maxWeight !== null) this.emit('lim_weight', [['weight', 1]], '<=', req.maxWeight, `max weight ${req.maxWeight}`);
  }

  private emitMoa(): void {
    const { bp, req, bounds, graph } = this;
    if (req.maxMoa === null) return;
    const limit = req.maxMoa;
    const a = bounds.accuracy;
    const up = (x: number): number => (x === 0 ? 0 : nextUp(x));
    const moaUpper = (c: number): number => up(Math.max(c * (1 - a.lo / 100), c * (1 - a.hi / 100)));
    const bigM = (c: number): number => {
      const m = Math.max(0, up(moaUpper(c) - limit));
      return m === 0 ? 0 : Math.max(m, MIN_BIG_M);
    };
    const barrels: number[] = [];
    for (let t = 1; t < graph.templateCount; t++) if (graph.active[t] && bp.templateCenterOfImpact[t] > 0) barrels.push(t);
    const intrinsic = bp.templateCenterOfImpact[0];
    const cBase = intrinsic * MOA_K;
    if (a.hi > 100 && barrels.length > 1) {
      this.notes.push('MOA rows assume an accuracy sum of at most 100 percent points when several barrels are installed (each installed barrel row binds; the oracle takes the largest COI)');
    }
    for (const t of barrels) {
      const coi = bp.templateCenterOfImpact[t];
      const c = coi * MOA_K;
      const m = bigM(c);
      // (c/100) A - M z_b >= c - L - M: an installed barrel replaces the intrinsic centre of impact.
      this.emit(`moa_rep_${t}`, [['acc_total', coi * MOA_K_OVER_100], [this.presenceOf(t), -m]], '>=', c - limit - m, `MOA of barrel ${bp.templateIds[t]}`);
    }
    const mFallback = barrels.length > 0 ? bigM(cBase) : 0;
    this.emit('moa_fallback', [['acc_total', intrinsic * MOA_K_OVER_100], ...barrels.map(t => [this.presenceOf(t), mFallback] as [string, number])], '>=', cBase - limit, `intrinsic MOA ${cBase} exceeds the cap ${limit}`);
  }

  private emitObjective(ranges: { ergoAxis: Interval; recAxis: Interval; priceAxis: Interval }): ObjectiveMeta {
    const { req } = this;
    const { e, r, p } = req;
    const coefficients: ObjectiveCoefficient[] = [];
    let objective: Interval;
    let tch: ObjectiveMeta['tchebycheff'] = null;
    const terms: [string, number][] = [['total_obj', 1]];
    const add = (column: string, value: number, formula: string, axis: Interval): Interval => {
      terms.push([column, -value]);
      coefficients.push({ column, value, formula });
      return iScale(value, axis);
    };
    if (!req.tchebycheff) {
      // score = (e / 10) fE - r fR - (p / 1000) fP
      objective = add('ergo_axis', e / ERGO_SCALE, 'e / ERGO_SCALE', ranges.ergoAxis);
      objective = iAdd(objective, add('rec_axis', -r, '-r', ranges.recAxis));
      objective = iAdd(objective, add('price_axis', -(p / RECOIL_SCALE), '-p / SCALE', ranges.priceAxis));
    } else {
      const { zE, nadE, zR, nadR, zP, nadP } = req.tchebycheff;
      const sum = e + r + p || 1;
      const ce = e / (sum * Math.max(zE - nadE, 1));
      const cr = r / (sum * Math.max(nadR - zR, 1));
      const cp = p / (sum * Math.max(nadP - zP, 1));
      const active: ('e' | 'r' | 'p')[] = [];
      if (e > 0) active.push('e');
      if (r > 0) active.push('r');
      if (p > 0) active.push('p');
      tch = { ideal: req.tchebycheff, ce, cr, cp, active };
      objective = add('ergo_axis', AUGMENTATION * ce, 'AUGMENTATION c_e', ranges.ergoAxis);
      objective = iAdd(objective, add('rec_axis', -(AUGMENTATION * cr), '-AUGMENTATION c_r', ranges.recAxis));
      objective = iAdd(objective, add('price_axis', -(AUGMENTATION * cp), '-AUGMENTATION c_p', ranges.priceAxis));
      // t >= every active deviation d_a: d_e = c_e (zE - fE), d_r = c_r (fR - zR), d_p = c_p (fP - zP)
      const deviations: { name: string; terms: [string, number][]; rhs: number; range: Interval }[] = [];
      if (e > 0) deviations.push({ name: 'tch_e', terms: [['tch_t', 1], ['ergo_axis', ce]], rhs: ce * zE, range: iScale(ce, { lo: zE - ranges.ergoAxis.hi, hi: zE - ranges.ergoAxis.lo }) });
      if (r > 0) deviations.push({ name: 'tch_r', terms: [['tch_t', 1], ['rec_axis', -cr]], rhs: -(cr * zR), range: iScale(cr, { lo: ranges.recAxis.lo - zR, hi: ranges.recAxis.hi - zR }) });
      if (p > 0) deviations.push({ name: 'tch_p', terms: [['tch_t', 1], ['price_axis', -cp]], rhs: -(cp * zP), range: iScale(cp, { lo: ranges.priceAxis.lo - zP, hi: ranges.priceAxis.hi - zP }) });
      const tRange: Interval = deviations.length === 0
        ? { lo: 0, hi: 0 }
        : { lo: Math.max(...deviations.map(d => d.range.lo)), hi: Math.max(...deviations.map(d => d.range.hi)) };
      this.declareAux('tch_t', tRange.lo, tRange.hi);
      terms.push(['tch_t', 1]);
      coefficients.push({ column: 'tch_t', value: -1, formula: '-1' });
      objective = iAdd(objective, { lo: -tRange.hi, hi: -tRange.lo });
      for (const d of deviations) this.emit(d.name, d.terms, '>=', d.rhs, d.name);
    }
    this.declareAux('total_obj', objective.lo, objective.hi);
    this.emit('obj_def', terms, '=', 0, 'objective definition');
    this.w.setObjective('total_obj');
    return {
      sense: 'maximize',
      column: 'total_obj',
      kind: req.tchebycheff ? 'tchebycheff' : 'weighted',
      frame: { ergoScale: ERGO_SCALE, recoilScale: RECOIL_SCALE, priceScale: 1 },
      ergoSource: this.ergoColumn,
      weights: { e, r, p },
      toOracle: { scale: 1, offset: 0 },
      coefficients,
      tchebycheff: tch,
    };
  }

  build(): ObjectiveMeta {
    if (this.req.singleCopy) this.notes.push('single copy: every template is capped at one installed copy (counts and edges are binary); a build that repeats a part is outside this model');
    this.declareDecisionColumns();
    const priceUpper = this.emitSupply();
    this.emitBase();
    this.emitStructure();
    this.emitConflicts();
    this.emitIncludes();
    this.emitConnectivity();
    const ranges = this.emitStatistics(priceUpper);
    this.emitCaps();
    this.emitMoa();
    return this.emitObjective(ranges);
  }
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

function emptyModel(blueprint: PhysicalBlueprint, domain: SubproblemDomain, singleCopy: boolean): FastModel {
  const reasons = domain.contradictions.map(c => (c.code === 'NO_ACCESSIBLE_BASE' ? 'no accessible base' : `root required slot ${c.rawSlotId} has no active candidate`));
  const lp = ['Maximize', '  obj: total_obj', 'Subject To', '  empty_domain: zero_col >= 1', 'Bounds', '  total_obj = 0', '  zero_col = 0', 'End'].join('\n');
  const graph: TemplateGraph = {
    templateCount: blueprint.templateCount,
    active: new Uint8Array(blueprint.templateCount),
    slots: [],
    slotsOf: [],
    slotsHolding: [],
    edgeCount: 0,
    acyclic: true,
    topological: new Int32Array(0),
    region: new Uint8Array(blueprint.templateCount),
    maxCopies: new Int32Array(blueprint.templateCount),
  };
  return {
    version: 1,
    blueprint,
    domain,
    graph,
    lpBase: lp,
    provedEmpty: { source: 'domain', reasons },
    lp: () => lp,
    lpRelaxedEdges: () => lp,
    edges: [],
    count: () => null,
    base: baseName,
    decision: [],
    plans: new Map(),
    objective: {
      sense: 'maximize', column: 'total_obj', kind: 'weighted', frame: { ergoScale: ERGO_SCALE, recoilScale: RECOIL_SCALE, priceScale: 1 }, ergoSource: 'capped_ergo',
      weights: { e: 0, r: 0, p: 0 }, toOracle: { scale: 1, offset: 0 }, coefficients: [], tchebycheff: null,
    },
    activeBounds: null,
    spatial: null,
    exact: true,
    singleCopy,
    notes: ['the domain is empty: no build exists, so the model is the one-row contradiction'],
    matrixFilterRisk: false,
    stats: { minAbsCoefficient: 1, maxAbsCoefficient: 1, columns: 2, rows: 1, nonzeros: 1, binaries: 0, integers: 0, continuous: 2, lpChars: lp.length },
  };
}

/** What a domain determines about its Fast model whatever the request or the weight node: the template graph and the active ranges. */
const structureMemo = new WeakMap<SubproblemDomain, { graph: TemplateGraph; bounds: ActiveBounds; single?: TemplateGraph }>();

/** The template graph with every copy bound capped at one: the same slots and edges, `maxCopies[t] = min(maxCopies[t], 1)`. */
function singleCopyGraph(graph: TemplateGraph): TemplateGraph {
  return { ...graph, maxCopies: graph.maxCopies.map(copies => Math.min(copies, 1)) };
}

/**
 * Specialize the Fast model of one request.
 *
 * @param node Optional weight node (see `SpatialNode`); read only by requests that use TED. Without one, a TED request is specialized on the whole
 *   active weight range, which is a relaxation unless every build weighs at most 3 kg. A domain is immutable, so its template graph and active ranges
 *   are computed once and shared by the nodes of a spatial search.
 */
export function specializeFast(blueprint: PhysicalBlueprint, domain: SubproblemDomain, request: SpecializeRequest = {}, node?: SpatialNode): FastModel {
  if (domain.blueprint !== blueprint) {
    throw new PhysicalModelError('FOREIGN_DOMAIN', `The domain was not prepared from the blueprint of ${blueprint.weaponId}`, { weaponId: blueprint.weaponId });
  }
  const resolved = resolveFastRequest(request);
  if (node) {
    finite(node.weightMin, 'node.weightMin');
    finite(node.weightMax, 'node.weightMax');
  }
  if (domain.empty) return emptyModel(blueprint, domain, resolved.singleCopy);

  let structure = structureMemo.get(domain);
  if (structure === undefined) {
    structure = { graph: buildTemplateGraph(blueprint, domain), bounds: computeActiveBounds(blueprint, domain) };
    structureMemo.set(domain, structure);
  }
  const { bounds } = structure;
  const graph = resolved.singleCopy ? (structure.single ??= singleCopyGraph(structure.graph)) : structure.graph;
  const specializer = new FastSpecializer(blueprint, domain, graph, resolved, bounds, node);
  const objective = specializer.build();
  const w = specializer.w;
  const lpBase = w.toString();
  let relaxedEdgesText: string | undefined;
  const proved = specializer.contradictionDetails.length > 0;
  const tedMode = resolved.useTrueErgo || resolved.preventOverswing;
  const penalty = specializer.penalty;
  return {
    version: 1,
    blueprint,
    domain,
    graph,
    lpBase,
    provedEmpty: proved ? { source: 'request', reasons: specializer.contradictionDetails } : null,
    lp: (cuts = []) => appendCuts(lpBase, cuts),
    lpRelaxedEdges: () => (relaxedEdgesText ??= w.toStringRelaxing(new Set(specializer.edges.map(edge => edge.column)))),
    edges: specializer.edges,
    count: t => (t > 0 && t < graph.templateCount && graph.active[t] ? countName(t) : null),
    base: baseName,
    decision: specializer.decision,
    plans: specializer.plans,
    objective,
    activeBounds: bounds,
    spatial: tedMode && penalty ? { weightMin: specializer.weightInterval.lo, weightMax: specializer.weightInterval.hi, penalty } : null,
    exact: tedMode && penalty ? penalty.exact : true,
    singleCopy: resolved.singleCopy,
    notes: specializer.notes,
    matrixFilterRisk: w.minAbsCoefficient <= HIGHS_SMALL_MATRIX_VALUE || w.maxAbsCoefficient >= HIGHS_LARGE_MATRIX_VALUE,
    stats: {
      minAbsCoefficient: w.minAbsCoefficient,
      maxAbsCoefficient: w.maxAbsCoefficient,
      columns: w.columnCount,
      rows: w.rowCount,
      nonzeros: w.nonzeros,
      binaries: w.binaryCount,
      integers: w.integerCount,
      continuous: w.columnCount - w.binaryCount - w.integerCount,
      lpChars: lpBase.length,
    },
  };
}
