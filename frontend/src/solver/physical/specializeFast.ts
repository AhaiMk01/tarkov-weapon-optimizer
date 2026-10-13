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
 * CERTIFIED MODE (Phase 2.10, owner decision 2e, `FastModelOptions.certified`, entry `specializeCount.ts`). The same count model, built through the proof layer, is
 * the model Precise solves (every gun has an acyclic part graph): the rows below are unchanged (they are integers and binary64 leaves), and the constructed ones are exactly
 * those of the occurrence model `specializeLP` (test-only since decision 2d was amended: tests/physical/occurrence; recoil caps, MOA rows, objective, gear factor, weight-penalty secant: exact rationals, outward padding, `FastModel.proof`), plus the MOA
 * larger-centre-of-impact terms that make the model state the oracle's rule. It is never single-copy, and it leaves the text of
 * the plain Fast model (this file's default) byte for byte as it was. See `specializeCount.ts` for what makes it exact and what a certificate rests on.
 *
 * Decision columns (all integer, finite):
 *   n_t         copies of item template t installed (binary when at most one copy can exist)
 *   e_s_c       copies of template c installed directly in a slot of raw id s, over all copies of the slot's owner (binary when <= 1)
 *   base_b      the accessible base b (binary)
 * Auxiliary columns: z_t presence of a template that can repeat and takes part in a conflict or MOA row (binary, linked to n_t both ways),
 * lot_t_k whole lots bought of a non-dominated legal offer (integer), and the same
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
 * Acyclic part graphs only (owner decision 2026-10-12: no gun has a cyclic one; the blueprint builder throws an internal `CYCLIC_PART_GRAPH` error
 * on a cycle). On an acyclic graph:
 *   1. NO ANCESTOR-REPETITION RULE is needed. Counts cannot say "a template never recurs on one root-to-leaf path", but a template cannot be its
 *      own descendant, so the rule is vacuous.
 *   2. ROOTEDNESS IS DERIVED. Every installed copy is rooted by induction on the topological order (a copy needs a parent copy of a template
 *      above it), so no connectivity row is needed.
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
import {
  EMPTY_MODEL_PROOF, differenceEnclosure, gearEnclosure, gearFactor, moaFallbackRow, moaReplacementRow, paddedRhs, planObjective, ratEnclosure, rowProof,
  tchebycheffCoefficients,
  type GearFactor, type ModelProof, type ObjectivePlan, type PaddedRhs, type RowProof, type SecantProof,
} from './proof';
import { RAT_ZERO, ratAdd, ratFromDouble, ratMax, ratMul, ratSub, ratToNumber, type Rat } from './exact';
import { ratAbs, ratMagnitude, ratRoundUp } from './rational';
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

/**
 * The read-through precondition (count-model proof section 3.3, review GAP 8a): `range / 2^k` must be EXACT, endpoint by endpoint, or the scaled
 * column's domain could exclude a build's value (an underflow below about 2^-1022 loses bits). Checked by the round trip `scaled * 2^k === range`;
 * a failure is an internal error (`INEXACT_READ_THROUGH`), never a silent bound. Exported for tests.
 */
export function readThroughRange(range: Interval, factor: number, column: string): Interval {
  const scaled: Interval = { lo: range.lo / factor, hi: range.hi / factor };
  if (!(scaled.lo * factor === range.lo && scaled.hi * factor === range.hi)) {
    throw new PhysicalModelError('INEXACT_READ_THROUGH', `The read-through of ${column} by ${factor} is not exact on [${range.lo}, ${range.hi}]`, { column, factor, lo: range.lo, hi: range.hi });
  }
  return scaled;
}

/** `value * 2^k`, asserted exact by the round trip (no overflow, no underflow): the objective coefficient of a read-through column. Exported for tests. */
export function exactPowerOfTwoProduct(value: number, factor: number, column: string): number {
  const product = value * factor;
  if (!(Number.isFinite(product) && product / factor === value)) {
    throw new PhysicalModelError('INEXACT_READ_THROUGH', `The read-through coefficient of ${column} (${value} x ${factor}) is not exact`, { column, factor, value });
  }
  return product;
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
  /**
   * The model was built through the proof layer (`FastModelOptions.certified`, the certifiable count model of Precise, decision 2e). Then `proof` and
   * `rowFamilies` are set; otherwise both are null and the rows are plain doubles (the Fast model).
   */
  readonly certified: boolean;
  /** The exact-rational construction record `assessNativeResult` and the bound evidence read: padded rows, the objective's frame error, the gear factor, the secant. Null unless certified. */
  readonly proof: ModelProof | null;
  /** Rows, vacuous rows and proved construction error per row family. Null unless certified. */
  readonly rowFamilies: readonly CountRowFamilyRecord[] | null;
  /**
   * How the MOA barrel rows were stated (certified models; null without a MOA cap or when not certified): `dominance` adds the larger-centre-of-impact terms
   * (the cap binds only the installed barrel with the largest centre of impact, as the oracle states it), `plain` is the per-barrel row of the Fast model,
   * which is exactly equivalent to it whenever the accuracy sum cannot pass 100 percent points or the cap is not negative (see `emitMoaCertified`).
   */
  readonly moaRows: 'plain' | 'dominance' | null;
}

/** Options of {@link specializeFast} that are not part of the request. */
export interface FastModelOptions {
  /**
   * Build the model through the proof layer, for a certificate (decision 2e, Phase 2.10): every constructed coefficient is built in exact rationals with
   * directed outward rounding (`proof.ts`), the recoil caps, the MOA rows (with the larger-centre-of-impact terms) and the objective are the rows of
   * `specializeLP`, every auxiliary column has a finite enclosed domain, and the model carries its `proof`. Multiple copies of a part are always allowed
   * (`singleCopy` is ignored, as in the Precise model). Default false: the plain Fast model, whose text this option leaves untouched.
   */
  certified?: boolean;
  /**
   * Certified models only. `auto` (default) states the larger-centre-of-impact terms exactly when the plain per-barrel rows could differ from the oracle's
   * rule (a negative cap and an accuracy sum that can pass 100 percent points); `always` states them on every MOA model (tests: the two must agree).
   */
  moaDominance?: 'auto' | 'always';
}

export type CountRowFamilyId =
  | 'base_choice'
  | 'parentage'
  | 'slot'
  | 'required_occupancy'
  | 'presence_link'
  | 'template_conflict'
  | 'slot_conflict'
  | 'include_item'
  | 'include_category'
  | 'supply_cap'
  | 'lot_cover'
  | 'wallet'
  | 'stat_definition'
  | 'first_clamp'
  | 'gear_clamp'
  | 'ted'
  | 'cap_price'
  | 'cap_ergonomics'
  | 'cap_recoil'
  | 'cap_magazine_sighting'
  | 'cap_weight'
  | 'moa'
  | 'objective'
  | 'contradiction';

export interface CountRowFamilyRecord {
  id: CountRowFamilyId;
  /** Row-name pattern of the family. */
  prefix: string;
  adr: string;
  description: string;
  /** Rows written. */
  count: number;
  /** Rows proven constant-true over the model's own domains and therefore not written. */
  vacuous: number;
  /** Proved upper bound of the construction error of the family's constructed coefficients, in the family's own units (0 when every coefficient is a binary64 leaf or a small integer). */
  constructionError: number;
  /** The largest outward padding the family's emitted right-hand sides carry beyond their exact targets. */
  allowance: number;
}

/** The row families of the count model, matched by row name (the first match wins). */
const COUNT_FAMILIES: readonly { id: CountRowFamilyId; test: RegExp; prefix: string; adr: string; description: string }[] = [
  { id: 'base_choice', test: /^base_sum$/, prefix: 'base_sum', adr: 'ADR 0002 principle 2', description: 'exactly one accessible base; an empty base set is a contradiction, never a free fallback' },
  { id: 'parentage', test: /^in_\d+$/, prefix: 'in_<t>', adr: 'research 5.1', description: 'n_t = the edges that install t: every installed copy has exactly one parent slot' },
  { id: 'required_occupancy', test: /^req_\d+$/, prefix: 'req_<s>', adr: 'ADR 0003 principle 3; research 5.1', description: 'required occupancy: root slot = 1, mod-owned slot = n_owner' },
  { id: 'slot', test: /^slot_\d+$/, prefix: 'slot_<s>', adr: 'ADR 0003 principle 3; research 5.1', description: 'slot capacity: occupancy(raw slot id) <= n_owner (root: <= 1), one child per physical slot' },
  { id: 'presence_link', test: /^z(up|lo)_\d+$/, prefix: 'zup_<t>, zlo_<t>', adr: 'ADR 0003 principle 4', description: 'presence z_t = [n_t >= 1] of a template that can repeat and takes part in a conflict or MOA row' },
  { id: 'template_conflict', test: /^tconf_\d+$/, prefix: 'tconf_<k>', adr: 'ADR 0003 principle 4; research 5.3', description: 'linked presence exclusion over a clique of pairwise-conflicting templates; copies of A stay legal without B' },
  { id: 'slot_conflict', test: /^sconf_\d+_\d+$/, prefix: 'sconf_<t>_<s>', adr: 'ADR 0003 principle 4; INTERPRETATIONS 11, 14; research 5.5', description: 'a present blocker empties every physical slot of a blocked raw slot id, its own slot included' },
  { id: 'include_item', test: /^incl_/, prefix: 'incl_<t>', adr: 'ADR 0003 principle 4; INTERPRETATIONS 12', description: 'an included template is installed at least once' },
  { id: 'include_category', test: /^catreq_\d+$/, prefix: 'catreq_<g>', adr: 'ADR 0003 principle 4; INTERPRETATIONS 5', description: 'each include group needs an installed template whose category chain meets the group' },
  { id: 'supply_cap', test: /^supcap_\d+$/, prefix: 'supcap_<t>', adr: 'ADR 0002 principle 8; ADR 0008 principle 5', description: 'a template with no legal standalone offer: n_t <= preset supply of the chosen base + owned stock' },
  { id: 'lot_cover', test: /^cover_\d+$/, prefix: 'cover_<t>', adr: 'ADR 0009 principle 1; INTERPRETATIONS 1; research 5.8', description: 'whole lots cover the paid deficit n_t - preset supply - owned' },
  { id: 'wallet', test: /^price_def$/, prefix: 'price_def', adr: 'ADR 0009 principle 3', description: 'the exact wallet: price_axis = base price + whole-lot purchase cost' },
  { id: 'stat_definition', test: /^(raw_ergo_def|rec_mod_def|rec_axis_def|weight_def|acc_def|ergo_frame)$/, prefix: 'raw_ergo_def, weight_def, rec_mod_def, rec_axis_def, acc_def, ergo_frame', adr: 'ADR 0003 principle 5; ADR 0010 section 2', description: 'statistics summed over the template counts and the objective frames' },
  { id: 'first_clamp', test: /^c1_/, prefix: 'c1_*', adr: 'ADR 0007 principle 5', description: 'the displayed ergonomics: clamp(raw ergonomics, 0, 100), the general three-regime disjunction' },
  { id: 'gear_clamp', test: /^(gear_def|c2_)/, prefix: 'gear_def*, c2_*', adr: 'ADR 0007 principle 5', description: 'the gear factor and the second clamp, the general three-regime disjunction' },
  { id: 'ted', test: /^(node_|ted_def$|lim_overswing$)/, prefix: 'node_*, ted_def, lim_overswing', adr: 'ADR 0007 principle 6', description: 'the weight node as rows, TED = eff - weight penalty on it (a lower envelope of q), and TED >= 0 when overswing is prevented' },
  { id: 'cap_price', test: /^lim_price$/, prefix: 'lim_price', adr: 'ADR 0009 principle 3', description: 'max_price on the real spend' },
  { id: 'cap_ergonomics', test: /^lim_min_ergo$/, prefix: 'lim_min_ergo', adr: 'INTERPRETATIONS 8', description: 'min_ergonomics on the first clamp' },
  { id: 'cap_recoil', test: /^lim_recoil_(v|sum)$/, prefix: 'lim_recoil_v, lim_recoil_sum', adr: 'ADR 0009 principle 4; ADR 0013 4C', description: 'final recoil caps as naked x modifier <= cap - naked, padded by the coefficient deficit' },
  { id: 'cap_magazine_sighting', test: /^lim_(mag|sight)$/, prefix: 'lim_mag, lim_sight', adr: 'INTERPRETATIONS 7', description: 'a magazine or sighting minimum is met by the receiver or by an installed template (maximum, not sum)' },
  { id: 'cap_weight', test: /^lim_weight$/, prefix: 'lim_weight', adr: 'ADR 0010 section 4 item 4', description: 'max_weight on the total weight' },
  { id: 'moa', test: /^moa_/, prefix: 'moa_rep_<t>, moa_fallback', adr: 'ADR 0007 principles 1 to 3; ADR 0006; research 5.7', description: 'exact Big-M replacement rows of the barrel with the largest centre of impact, and the intrinsic fallback row' },
  { id: 'objective', test: /^(obj_def|tch_[erp]|ergo_n_def|rec_n_def|price_n_def)$/, prefix: 'obj_def, tch_<a>, *_n_def', adr: 'ADR 0010 section 2', description: 'the weighted score or the augmented Tchebycheff score over the three frames' },
  { id: 'contradiction', test: /^contra_\d+$/, prefix: 'contra_<k>', adr: 'ADR 0003 principle 3', description: 'a row with no variables that is false: the model is infeasible by construction' },
];

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
  /** At most one copy of every template (the copy bound of each template is capped at 1). Never set on a certified model. */
  singleCopy: boolean;
  /** Built through the proof layer (`FastModelOptions.certified`). */
  certified: boolean;
  moaDominance: 'auto' | 'always';
}

function finite(value: number | null | undefined, name: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new PhysicalModelError('INVALID_REQUEST', `${name} is not a finite number`, { name });
  return value;
}

function resolveFastRequest(request: SpecializeRequest, options: FastModelOptions): ResolvedFast {
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
    // A certified model allows every repeat, as the Precise model does: a restriction is no outer relaxation of the physical problem.
    singleCopy: options.certified !== true && request.singleCopy === true,
    certified: options.certified === true,
    moaDominance: options.moaDominance ?? 'auto',
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

/** The family of a row by its name; a name no family claims is a construction fault (the accounting must cover every row). */
export function familyOfRow(name: string): CountRowFamilyId {
  for (const family of COUNT_FAMILIES) if (family.test.test(name)) return family.id;
  throw new PhysicalModelError('DOMAIN_INCONSISTENT', `The count model wrote the row ${name}, which belongs to no row family`, { row: name });
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
  // --- certified mode: what the proof layer records (all unused, and empty, in the plain Fast model) ---
  /** Every constructed row with its padded right-hand side (`proof.ts`). */
  readonly rowProofs: RowProof[] = [];
  /** Why a proof input failed at construction (an axis whose objective coefficient no power-of-two scale can lift above the filter), or null. */
  withheld: string | null = null;
  objectivePlan: ObjectivePlan | null = null;
  gear: GearFactor | null = null;
  secantProof: SecantProof | null = null;
  moaRows: 'plain' | 'dominance' | null = null;
  /** Names of every row written, and of every row dropped as constant-true, for the row-family accounting. */
  private readonly rowNames: string[] = [];
  private readonly vacuousNames: string[] = [];
  /** Construction error and allowance a family carries beyond its padded rows (the objective's frame error, the secant's shift, the gear neighbours). */
  private readonly extraFamilyError = new Map<CountRowFamilyId, { constructionError: number; allowance: number }>();

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
      else if (this.req.certified) this.vacuousNames.push(name);
      return;
    }
    this.w.addMerged(name, merged, sense, rhs);
    if (this.req.certified) this.rowNames.push(name);
  }

  /**
   * Certified mode: write a CONSTRUCTED row with its padded right-hand side and keep the proof record of it (only when the row is actually written),
   * as `specializeLP` does: the emitted row is an outer relaxation of the exact target row.
   */
  private emitPadded(name: string, terms: Iterable<readonly [string, number]>, relation: '>=' | '<=', padded: PaddedRhs, detail: string): void {
    const before = this.rowNames.length;
    this.emit(name, terms, relation, padded.emitted, detail);
    if (this.rowNames.length > before) this.rowProofs.push(rowProof(name, familyOfRow(name), relation, padded));
  }

  private contradict(row: string, detail: string): void {
    if (!this.zeroColumn) {
      this.w.addColumn('zero_col', 'continuous', 0, 0);
      this.zeroColumn = true;
    }
    const name = `contra_${this.contradictionDetails.length}`;
    this.w.addRow(name, [['zero_col', 1]], '>=', 1);
    if (this.req.certified) this.rowNames.push(name);
    this.contradictionDetails.push(`${row}: ${detail}`);
  }

  private noteFamilyError(id: CountRowFamilyId, constructionError: number, allowance = constructionError): void {
    const before = this.extraFamilyError.get(id) ?? { constructionError: 0, allowance: 0 };
    this.extraFamilyError.set(id, { constructionError: Math.max(before.constructionError, constructionError), allowance: Math.max(before.allowance, allowance) });
  }

  /** The row-family accounting of a certified model: rows and vacuous rows by name, the padded rows' proved errors, and the extra errors noted while building. */
  familyRecords(): CountRowFamilyRecord[] {
    const records = COUNT_FAMILIES.map(f => ({ id: f.id, prefix: f.prefix, adr: f.adr, description: f.description, count: 0, vacuous: 0, constructionError: 0, allowance: 0 }));
    const byId = new Map(records.map(r => [r.id, r]));
    for (const name of this.rowNames) (byId.get(familyOfRow(name)) as CountRowFamilyRecord).count++;
    for (const name of this.vacuousNames) (byId.get(familyOfRow(name)) as CountRowFamilyRecord).vacuous++;
    for (const row of this.rowProofs) {
      const record = byId.get(row.family as CountRowFamilyId) as CountRowFamilyRecord;
      record.constructionError = Math.max(record.constructionError, row.coefficientError);
      record.allowance = Math.max(record.allowance, row.allowance);
    }
    for (const [id, extra] of this.extraFamilyError) {
      const record = byId.get(id) as CountRowFamilyRecord;
      record.constructionError = Math.max(record.constructionError, extra.constructionError);
      record.allowance = Math.max(record.allowance, extra.allowance);
    }
    return records;
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
      if (this.req.certified) this.gear = factor;
      if (factor.low === factor.high) {
        this.emit('gear_def', [['gear_ergo', 1], ['capped_ergo', -factor.low]], '=', 0, 'gear factor');
      } else {
        this.emit('gear_def_lo', [['gear_ergo', 1], ['capped_ergo', -factor.low]], '>=', 0, 'gear factor (lower neighbour)');
        this.emit('gear_def_hi', [['gear_ergo', 1], ['capped_ergo', -factor.high]], '<=', 0, 'gear factor (upper neighbour)');
        // The two neighbouring doubles enclose the exact factor: the gap times the largest displayed ergonomics is the construction error of the pair.
        if (this.req.certified) this.noteFamilyError('gear_clamp', ratRoundUp(ratMul(ratSub(ratFromDouble(factor.high), ratFromDouble(factor.low)), ratFromDouble(capped.hi))));
      }
      this.emitClamp('c2', 'gear_ergo', 'eff_ergo', gear, ERGO_CLAMP_MAX);
      const { lo, hi } = this.weightInterval;
      if (lo <= hi) {
        const penalty = this.node?.penalty ? checkedNodePenalty(lo, hi, this.node.penalty) : secantOfPenalty(lo, hi);
        this.penalty = penalty;
        if (this.req.certified) {
          // The secant's shift (how far below the exact chord the emitted line sits, in points) is the construction error of the TED rows.
          const shift = 'shift' in penalty ? penalty.shift : 0;
          this.secantProof = { kind: penalty.kind, weightMin: lo, weightMax: hi, line: penalty.line, shift, objectiveUnits: null, exact: penalty.exact };
          this.noteFamilyError('ted', shift);
        }
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
    if (req.certified) {
      // The coefficient is the leaf itself (vertical) or the nearest double of the exact sum (sum cap); the right-hand side is the smallest double at least
      // the exact cap - naked plus the coefficient deficit times the modifier range, so no build the exact cap admits is cut (`paddedRhs`, as `specializeLP`).
      const recoilMagnitude = ratMagnitude(this.bounds.recoil.lo, this.bounds.recoil.hi);
      if (req.maxRecoilV !== null) {
        const padded = paddedRhs('<=', ratSub(ratFromDouble(req.maxRecoilV), ratFromDouble(nakedV)), [{ target: ratFromDouble(nakedV), emitted: nakedV, magnitude: recoilMagnitude }]);
        this.emitPadded('lim_recoil_v', [['rec_mod', nakedV]], '<=', padded, `max vertical recoil ${req.maxRecoilV}`);
      }
      if (req.maxRecoilSum !== null) {
        const total = ratAdd(ratFromDouble(nakedV), ratFromDouble(nakedH));
        const coefficient = ratToNumber(total);
        const padded = paddedRhs('<=', ratSub(ratFromDouble(req.maxRecoilSum), total), [{ target: total, emitted: coefficient, magnitude: recoilMagnitude }]);
        this.emitPadded('lim_recoil_sum', [['rec_mod', coefficient]], '<=', padded, `max recoil sum ${req.maxRecoilSum}`);
      }
    } else {
      if (req.maxRecoilV !== null) this.emit('lim_recoil_v', [['rec_mod', nakedV]], '<=', req.maxRecoilV - nakedV, `max vertical recoil ${req.maxRecoilV}`);
      if (req.maxRecoilSum !== null) this.emit('lim_recoil_sum', [['rec_mod', nakedV + nakedH]], '<=', req.maxRecoilSum - (nakedV + nakedH), `max recoil sum ${req.maxRecoilSum}`);
    }
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

  /**
   * The MOA rows of a certified model: the rows of `specializeLP` (the exact Big-M and padded right-hand side of `proof.ts`) on the template presence
   * columns, with the larger-centre-of-impact terms (research section 5.7).
   *
   * The oracle prices MOA with the installed barrel of the LARGEST positive centre of impact, MOA = coi (1 - A / 100) K for the accuracy sum A. The plain
   * Fast row of barrel t states the cap for EVERY installed barrel (`z_t = 1` implies `c_t (1 - A / 100) <= L`). The two rules agree whenever MOA is
   * nondecreasing in the centre of impact, which holds for A <= 100 (the factor 1 - A / 100 is nonnegative); for A > 100 the factor is negative, MOA falls
   * as the centre of impact grows, and a cap L < 0 can be missed by a smaller barrel that the oracle never prices while the largest meets it (for
   * L >= 0 every barrel's MOA is at most 0, so every plain row holds and nothing differs). The plain row then loses a physical build.
   *
   * The dominance row relaxes the row of barrel t by M_t for every installed barrel with a STRICTLY larger centre of impact:
   *   (c_t / 100) A - M_t z_t + M_t sum_{b: coi_b > coi_t} z_b  >=  c_t - L - M_t,
   * so it binds exactly when t is present and no larger barrel is (barrels of equal centre of impact bind together, as the oracle's maximum does).
   * M_t is the proof layer's exact need (at least c_t (1 - A / 100) - L over the active accuracy range), so a present larger barrel makes the row
   * non-binding, and padding is unchanged (only nonnegative terms are added). It states the oracle's rule exactly. `auto` writes the terms only when the plain
   * rows can differ from it: a negative cap, an accuracy sum whose ACTIVE upper bound (counted per copy, `computeActiveBounds`) passes 100, and barrels of
   * different centres of impact. Everywhere else the plain rows are exactly equivalent (above), so the rows are the same text as the occurrence model's.
   */
  private emitMoaCertified(): void {
    const { bp, req, bounds, graph } = this;
    const limit = req.maxMoa as number;
    const a = bounds.accuracy;
    const barrels: number[] = [];
    for (let t = 1; t < graph.templateCount; t++) if (graph.active[t] && bp.templateCenterOfImpact[t] > 0) barrels.push(t);
    const coi = (t: number): number => bp.templateCenterOfImpact[t];
    const intrinsic = coi(0);
    const different = new Set(barrels.map(coi)).size > 1;
    const dominance = different && (req.moaDominance === 'always' || (limit < 0 && a.hi > 100));
    this.moaRows = dominance ? 'dominance' : 'plain';
    for (const t of barrels) {
      const plan = moaReplacementRow(coi(t), limit, a);
      const terms: [string, number][] = [['acc_total', plan.coefficient], [this.presenceOf(t), -plan.bigM]];
      if (dominance) for (const b of barrels) if (coi(b) > coi(t)) terms.push([this.presenceOf(b), plan.bigM]);
      this.emitPadded(`moa_rep_${t}`, terms, '>=', plan.rhs, `MOA of barrel ${bp.templateIds[t]}`);
    }
    // (c0/100) A + M_fb sum_b z_b >= c0 - L; with no barrel the sum is empty and the row is the unconditional intrinsic one.
    const fallback = moaFallbackRow(intrinsic, limit, a, barrels.length > 0);
    this.emitPadded(
      'moa_fallback', [['acc_total', fallback.coefficient], ...barrels.map(t => [this.presenceOf(t), fallback.bigM] as [string, number])], '>=', fallback.rhs,
      `intrinsic MOA ${intrinsic * MOA_K} exceeds the cap ${limit}`,
    );
  }

  private emitMoa(): void {
    const { bp, req, bounds, graph } = this;
    if (req.maxMoa === null) return;
    if (req.certified) {
      this.emitMoaCertified();
      return;
    }
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

  /**
   * The objective of a certified model: the weighted or augmented Tchebycheff score of `specializeLP`, constructed in exact rationals (`planObjective`):
   * the emitted coefficients, the proved frame error, the exact ranges of the deviation columns, the padded deviation rows and the power-of-two read-through of
   * an axis whose coefficient HiGHS would filter. The LP objective is the oracle's own score (`scale` 1, `offset` 0).
   */
  private emitObjectiveCertified(ranges: { ergoAxis: Interval; recAxis: Interval; priceAxis: Interval }): ObjectiveMeta {
    const { req } = this;
    const { e, r, p } = req;
    const coefficients: ObjectiveCoefficient[] = [];
    const plan = planObjective({ e, r, p }, req.tchebycheff, { ergo: ranges.ergoAxis, rec: ranges.recAxis, price: ranges.priceAxis });
    this.objectivePlan = plan;
    if (plan.withheld !== null) this.withheld = plan.withheld;
    type AxisColumn = 'ergo_axis' | 'rec_axis' | 'price_axis';
    const axisRange: Record<AxisColumn, Interval> = { ergo_axis: ranges.ergoAxis, rec_axis: ranges.recAxis, price_axis: ranges.priceAxis };
    const nameN: Record<AxisColumn, string> = { ergo_axis: 'ergo_n', rec_axis: 'rec_n', price_axis: 'price_n' };
    // An axis whose objective coefficient HiGHS would filter is read through `column_n = column / 2^k` (exact): the link row is `column - 2^k column_n = 0`, the
    // objective rows carry `c 2^k` on `column_n`, and the objective itself stays in the oracle's units.
    const readThrough: Record<AxisColumn, { column: string; range: Interval; factor: number }> = {
      ergo_axis: { column: 'ergo_axis', range: ranges.ergoAxis, factor: 1 },
      rec_axis: { column: 'rec_axis', range: ranges.recAxis, factor: 1 },
      price_axis: { column: 'price_axis', range: ranges.priceAxis, factor: 1 },
    };
    for (const scale of plan.axisScales) {
      if (scale.exponent === 0 || scale.withheld !== null) continue;
      const name = nameN[scale.column];
      const range = axisRange[scale.column];
      // dividing by a power of two is exact unless it underflows, so the enclosure of the scaled column is the scaled enclosure: asserted, not assumed
      const scaled = readThroughRange(range, scale.factor, scale.column);
      this.declareAux(name, scaled.lo, scaled.hi);
      this.emit(`${name}_def`, [[scale.column, 1], [name, -scale.factor]], '=', 0, `${name} definition`);
      readThrough[scale.column] = { column: name, range: scaled, factor: scale.factor };
    }
    const formulas: Record<AxisColumn, string> = req.tchebycheff
      ? { ergo_axis: 'AUGMENTATION c_e', rec_axis: '-AUGMENTATION c_r', price_axis: '-AUGMENTATION c_p' }
      : { ergo_axis: 'e / ERGO_SCALE', rec_axis: '-r', price_axis: '-p / SCALE' };
    const terms: [string, number][] = [['total_obj', 1]];
    let objective: Interval | null = null;
    for (const t of plan.terms) {
      const through = readThrough[t.column];
      const value = exactPowerOfTwoProduct(t.emitted, through.factor, t.column); // an exact product: a power of two (asserted)
      terms.push([through.column, -value]);
      coefficients.push({ column: through.column, value, formula: formulas[t.column] });
      const part = iScale(value, through.range);
      objective = objective === null ? part : iAdd(objective, part);
    }
    let tch: ObjectiveMeta['tchebycheff'] = null;
    if (req.tchebycheff) {
      const ideal = req.tchebycheff;
      const { ce, cr, cp } = tchebycheffCoefficients({ e, r, p }, ideal);
      const active: ('e' | 'r' | 'p')[] = [];
      if (e > 0) active.push('e');
      if (r > 0) active.push('r');
      if (p > 0) active.push('p');
      tch = { ideal, ce: ratToNumber(ce), cr: ratToNumber(cr), cp: ratToNumber(cp), active };
      // t >= every active deviation d_a: d_e = c_e (zE - fE), d_r = c_r (fR - zR), d_p = c_p (fP - zP)
      const lows: Rat[] = [];
      const highs: Rat[] = [];
      const rows: { name: string; terms: [string, number][]; padded: PaddedRhs }[] = [];
      for (const d of plan.deviations) {
        const column: AxisColumn = d.axis === 'e' ? 'ergo_axis' : d.axis === 'r' ? 'rec_axis' : 'price_axis';
        const sign = d.axis === 'e' ? 1 : -1;
        const range = axisRange[column];
        const z = ratFromDouble(d.ideal);
        const lo = ratFromDouble(range.lo);
        const hi = ratFromDouble(range.hi);
        // the deviation's real range from the exact coefficient: c (zE - fE) falls with fE, c (fR - zR) and c (fP - zP) rise with it
        if (d.axis === 'e') {
          lows.push(ratMul(d.target, ratSub(z, hi)));
          highs.push(ratMul(d.target, ratSub(z, lo)));
        } else {
          lows.push(ratMul(d.target, ratSub(lo, z)));
          highs.push(ratMul(d.target, ratSub(hi, z)));
        }
        // c_a column_n 2^k = c_a column: the padded right-hand side is the same, in the oracle's units
        const through = readThrough[column];
        rows.push({ name: `tch_${d.axis}`, terms: [['tch_t', 1], [through.column, sign * d.emitted * through.factor]], padded: d.rhs });
      }
      const largest = (values: readonly Rat[]): Rat => values.reduce((x, y) => ratMax(x, y));
      const tRange: Interval = plan.deviations.length === 0 ? { lo: 0, hi: 0 } : ratEnclosure(largest(lows), largest(highs));
      this.declareAux('tch_t', tRange.lo, tRange.hi);
      for (const row of rows) this.emitPadded(row.name, row.terms, '>=', row.padded, row.name);
      terms.push(['tch_t', 1]);
      coefficients.push({ column: 'tch_t', value: -1, formula: '-1' });
      objective = iAdd(objective as Interval, { lo: -tRange.hi, hi: -tRange.lo });
    }
    const total = objective as Interval;
    this.declareAux('total_obj', total.lo, total.hi);
    this.emit('obj_def', terms, '=', 0, 'objective definition');
    this.w.setObjective('total_obj');
    this.noteFamilyError('objective', plan.frameError);
    if (this.secantProof !== null) {
      // The secant's shift in TED points, carried through the actual coefficients on TED: the weighted e (= 10 x e/10), or Tchebycheff's 10 c_e (0.01 + the
      // deviation's 1) when ergonomics is active. A shift is an objective effect only when TED is the ergonomics axis.
      const termE = plan.terms.find(t => t.column === 'ergo_axis');
      let gain = RAT_ZERO;
      if (this.ergoColumn === 'ted' && termE) {
        gain = ratMul(ratFromDouble(ERGO_SCALE), ratAbs(termE.target));
        const deviation = plan.deviations.find(d => d.axis === 'e');
        if (deviation) gain = ratAdd(gain, ratMul(ratFromDouble(ERGO_SCALE), deviation.target));
      }
      this.secantProof.objectiveUnits = ratRoundUp(ratMul(ratFromDouble(this.secantProof.shift), gain));
    }
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

  private emitObjective(ranges: { ergoAxis: Interval; recAxis: Interval; priceAxis: Interval }): ObjectiveMeta {
    if (this.req.certified) return this.emitObjectiveCertified(ranges);
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
    const ranges = this.emitStatistics(priceUpper);
    this.emitCaps();
    this.emitMoa();
    return this.emitObjective(ranges);
  }
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

function emptyModel(blueprint: PhysicalBlueprint, domain: SubproblemDomain, singleCopy: boolean, certified: boolean): FastModel {
  const reasons = domain.contradictions.map(c => (c.code === 'NO_ACCESSIBLE_BASE' ? 'no accessible base' : `root required slot ${c.rawSlotId} has no active candidate`));
  const lp = ['Maximize', '  obj: total_obj', 'Subject To', '  empty_domain: zero_col >= 1', 'Bounds', '  total_obj = 0', '  zero_col = 0', 'End'].join('\n');
  const graph: TemplateGraph = {
    templateCount: blueprint.templateCount,
    active: new Uint8Array(blueprint.templateCount),
    slots: [],
    slotsOf: [],
    slotsHolding: [],
    edgeCount: 0,
    topological: new Int32Array(0),
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
    certified,
    proof: certified ? EMPTY_MODEL_PROOF : null,
    rowFamilies: certified ? COUNT_FAMILIES.map(f => ({ id: f.id, prefix: f.prefix, adr: f.adr, description: f.description, count: f.id === 'contradiction' ? 1 : 0, vacuous: 0, constructionError: 0, allowance: 0 })) : null,
    moaRows: null,
  };
}

/** What a domain determines about its Fast model whatever the request or the weight node: the template graph and the active ranges. */
const structureMemo = new WeakMap<SubproblemDomain, { graph: TemplateGraph; bounds: ActiveBounds; single?: TemplateGraph }>();

function structureEntry(blueprint: PhysicalBlueprint, domain: SubproblemDomain): { graph: TemplateGraph; bounds: ActiveBounds; single?: TemplateGraph } {
  let structure = structureMemo.get(domain);
  if (structure === undefined) {
    structure = { graph: buildTemplateGraph(blueprint, domain), bounds: computeActiveBounds(blueprint, domain) };
    structureMemo.set(domain, structure);
  }
  return structure;
}

/** The template graph and active ranges of a non-empty domain, computed once per (immutable) domain and shared by every model and node built from it. */
export function templateStructureOf(blueprint: PhysicalBlueprint, domain: SubproblemDomain): { graph: TemplateGraph; bounds: ActiveBounds } {
  const { graph, bounds } = structureEntry(blueprint, domain);
  return { graph, bounds };
}

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
 * @param options `certified` builds the model through the proof layer (see {@link FastModelOptions}); the default is the plain Fast model.
 */
export function specializeFast(
  blueprint: PhysicalBlueprint, domain: SubproblemDomain, request: SpecializeRequest = {}, node?: SpatialNode, options: FastModelOptions = {},
): FastModel {
  if (domain.blueprint !== blueprint) {
    throw new PhysicalModelError('FOREIGN_DOMAIN', `The domain was not prepared from the blueprint of ${blueprint.weaponId}`, { weaponId: blueprint.weaponId });
  }
  const resolved = resolveFastRequest(request, options);
  if (node) {
    finite(node.weightMin, 'node.weightMin');
    finite(node.weightMax, 'node.weightMax');
  }
  if (domain.empty) return emptyModel(blueprint, domain, resolved.singleCopy, resolved.certified);

  const structure = structureEntry(blueprint, domain);
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
    certified: resolved.certified,
    proof: resolved.certified
      ? {
        version: 1,
        rows: specializer.rowProofs,
        objective: specializer.objectivePlan,
        gear: specializer.gear === null ? null : { target: specializer.gear.target, low: specializer.gear.low, high: specializer.gear.high },
        secant: specializer.secantProof,
        withheld: specializer.withheld,
      }
      : null,
    rowFamilies: resolved.certified ? specializer.familyRecords() : null,
    moaRows: specializer.moaRows,
  };
}
