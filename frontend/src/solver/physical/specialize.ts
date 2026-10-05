/**
 * Exact Precise LP specialization over the physical blueprint (ADR 0003, 0007, 0008, 0009, 0010 section 2, ADR 0013 sections 4A and 4C).
 *
 * `specializeLP(blueprint, domain, request, node?)` emits the occurrence-level MIP of one request over the ACTIVE occurrences of a
 * prepared domain, as CPLEX-LP text plus the column map and the row/objective metadata a decoder and a proof layer need. Nothing
 * here prunes, reduces or rounds: every coefficient is a shortest round-trip `String(n)` of a binary64 input leaf, a small
 * declared integer constant, the declared constant K = 1000000/29089 (= 100/2.9089), or a documented product of those, and every
 * auxiliary column has a finite domain derived from the active raw bounds. Outward rounding of coefficients, allowances and
 * proofs is Phase 2.5; reductions (presence substitution, clamp regimes, axis deletion) are Stage 4.
 *
 * Variables (all columns finite):
 *   x_v          binary, one per active item occurrence v (the receiver, occurrence 0, has no column: it is always present)
 *   base_b       binary, one per accessible base of the domain
 *   y_t          [0,1], template presence, only for templates in a template-conflict pair
 *   u_t          integer, the epigraph surrogate of the paid deficit of a template with a legal standalone offer
 *   lot_t_k      integer, whole lots bought of the k-th legal standalone offer of template t
 *   raw_ergo, capped_ergo, weight, rec_mod, acc_total, price_axis, gear_ergo, eff_ergo, ted, ergo_axis, rec_axis, tch_t, total_obj
 *                continuous auxiliaries; ergo_axis = fE = 10 x (ergonomics | TED), rec_axis = fR = 1000 x recoil modifier sum,
 *                price_axis = fP = RUB spend (the exact wallet)
 *
 * The objective value of the LP is the oracle score in the oracle frame (ADR 0010 section 2): `scale` 1, `offset` 0.
 *
 * Coefficient provenance (what Phase 2.5 must enclose):
 *   - statistic rows (raw_ergo_def, rec_mod_def, weight_def, acc_def): the template's binary64 leaf, unscaled; the receiver's value is the
 *     right-hand side. The frames are separate one-coefficient rows (`rec_axis = 1000 rec_mod`, `ergo_axis = 10 x`), so no leaf is multiplied.
 *   - clamp rows: M = ceil(max(|lo|, |hi|, 100) + 100) from the ACTIVE raw bounds, and the cap 100; the gear row carries the factor
 *     max(0, 1 + modifier).
 *   - recoil caps: `naked x rec_mod <= cap - naked` (no division, any sign of naked); MOA rows: `coi x (10000/29089)` on the accuracy sum,
 *     `coi x K` in the right-hand side and `M_b = max(0, max over the accuracy range of c_b (1 - A/100) - L)`.
 *   - objective: weighted `e / 10`, `-r`, `-p / 1000`; Tchebycheff `0.01 c_a` with `c_a = w_a / (sum max(range, 1))`, the deviation rows
 *     `c_a (z_a - f_a)`; see `ObjectiveMeta.coefficients`.
 *   - TED: the node's penalty line (closed-form secant, see spatial.ts), a node being rows on `weight`, not a tightened column bound.
 *
 * Text hygiene (the native readback of Phase 2.3 checks it, see tests/physical/lpHarness.ts): every name matches [A-Za-z_][A-Za-z0-9_]*
 * (never a `-` before a digit), the first line is exactly `Maximize`, and no matrix entry is at or below HiGHS's small_matrix_value (a positive
 * Big-M is floored at MIN_BIG_M for that reason).
 *
 * Solver note (see tests/physical/solverDefects.test.ts): the retired npm `highs` 1.8.0 returned wrong answers and aborted on models of this
 * family. The pinned native build (HiGHS 1.15.1) solves that corpus, but with PRESOLVE ON it still reports some feasible models 'Infeasible' (a
 * 6-row model is kept as a fixture; about 15 pinned-projection solves in 2 x 1,500 random cases); with presolve off it agrees with the reference
 * oracle everywhere tried. An 'Infeasible' answer must therefore not be certified from a presolved solve alone (Phase 2.7).
 */

import type { IdealPoint } from '../types';
import type { PhysicalBlueprint } from './blueprint';
import { computeActiveBounds, type ActiveBounds } from './bounds';
import type { SubproblemDomain, SupplyClass } from './domain';
import { PhysicalModelError } from './errors';
import { LpWriter, mergeTerms, type ColumnDeclaration, type RowSense } from './lpText';
import { iAdd, iScale, nextUp, outward, sumEnclosure, type Interval } from './numeric';
import { lineRange, penaltyLineIsValid, secantOfPenalty, type NodePenalty, type PenaltyLine } from './spatial';

// ---------------------------------------------------------------------------------------------
// Declared constants (ADR 0010 section 2, ADR 0007)
// ---------------------------------------------------------------------------------------------

/** fE = ERGO_SCALE x ergonomics (or TED). */
export const ERGO_SCALE = 10;
/** fR = RECOIL_SCALE x summed recoil modifier. */
export const RECOIL_SCALE = 1000;
/** Tchebycheff augmentation weight, one hundredth. */
export const AUGMENTATION = 0.01;
/** Both ergonomics clamps run over [0, ERGO_CLAMP_MAX]. */
export const ERGO_CLAMP_MAX = 100;
/** MOA per unit of centre of impact, K = 100 / 2.9089 = 1000000 / 29089 (one correctly rounded division of two exact integers). */
export const MOA_K = 1000000 / 29089;
/** Floor of a positive Big-M: well above HiGHS's `small_matrix_value` (1e-9), so the coefficient survives the read. */
export const MIN_BIG_M = 1e-6;
/** K / 100 = 10000 / 29089, the coefficient scale of the accuracy sum in a MOA row. */
export const MOA_K_OVER_100 = 10000 / 29089;

// ---------------------------------------------------------------------------------------------
// Request, node
// ---------------------------------------------------------------------------------------------

/**
 * The request fields `specializeLP` reads, named as `SolveParams` names them. Filters (excludes) and the market, owned stock and
 * receiver bans are NOT here: they are already decided by the domain masks. `maxMOA` is the provisional MOA cap (ADR 0006).
 */
export interface SpecializeRequest {
  maxPrice?: number | null;
  minErgonomics?: number | null;
  maxRecoilV?: number | null;
  maxRecoilSum?: number | null;
  minMagCapacity?: number | null;
  minSightingRange?: number | null;
  maxWeight?: number | null;
  maxMOA?: number | null;
  includeItems?: readonly string[] | null;
  includeCategories?: readonly (readonly string[])[] | null;
  ergoWeight?: number | null;
  recoilWeight?: number | null;
  priceWeight?: number | null;
  useTrueErgo?: boolean;
  useTchebycheff?: boolean;
  /** The payoff table the Tchebycheff objective is measured against: an input (INTERPRETATIONS.md choices 9 and 17). */
  idealPoint?: IdealPoint | null;
  preventOverswing?: boolean;
  equipErgoModifier?: number | null;
}

/**
 * One node of the spatial search over total weight (ADR 0007 section 6): the closed interval enforced on the weight column and,
 * optionally, the lower envelope of the weight penalty to use on it (otherwise `secantOfPenalty` derives it). The loop that picks
 * nodes is Phase 2.4b-3. Only requests that read TED (TrueErgo or Prevent Overswing) have a use for a node; others ignore it.
 */
export interface SpatialNode {
  weightMin: number;
  weightMax: number;
  penalty?: PenaltyLine;
}

// ---------------------------------------------------------------------------------------------
// Model description
// ---------------------------------------------------------------------------------------------

export type RowFamilyId =
  | 'base_choice'
  | 'slot'
  | 'required_occupancy'
  | 'required_empty'
  | 'presence_upper'
  | 'presence_lower'
  | 'template_conflict'
  | 'self_conflict'
  | 'slot_conflict'
  | 'include_item'
  | 'include_category'
  | 'supply_cap'
  | 'deficit_surrogate'
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

export interface RowFamilyRecord {
  id: RowFamilyId;
  /** Row-name prefix; the suffix says what the row is keyed by. */
  prefix: string;
  keyedBy: string;
  /** The normative source of the rows. */
  adr: string;
  description: string;
  /** Rows written. */
  count: number;
  /** Rows proven constant-true over the model's own domains and therefore not written. */
  vacuous: number;
}

const FAMILIES: readonly Omit<RowFamilyRecord, 'count' | 'vacuous'>[] = [
  { id: 'base_choice', prefix: 'base_sum', keyedBy: '-', adr: 'ADR 0002 principle 2; ADR 0013 4A emit 1', description: 'exactly one accessible base; an empty base set is a domain contradiction, never a free fallback' },
  { id: 'slot', prefix: 'slot_<s>', keyedBy: 'physical slot', adr: 'ADR 0003 principle 3', description: 'slot mutex and parent activation: occupancy(s) <= x_owner (root: <= 1); the mutex is implied by activation for mod-owned slots' },
  { id: 'required_occupancy', prefix: 'req_<s>', keyedBy: 'physical slot', adr: 'ADR 0003 principle 3; ADR 0013 4A emit 2', description: 'required occupancy: root slot = 1, mod-owned slot = x_owner' },
  { id: 'required_empty', prefix: 'reqempty_<s>', keyedBy: 'physical slot', adr: 'ADR 0003 principle 3', description: 'a required slot no active candidate can fill forces its owner off (x_owner = 0)' },
  { id: 'presence_upper', prefix: 'ylink_<v>', keyedBy: 'occurrence', adr: 'ADR 0003 principle 4', description: 'template presence y_A >= x_u for every active occurrence of A' },
  { id: 'presence_lower', prefix: 'ysum_<t>', keyedBy: 'template', adr: 'ADR 0003 principle 4', description: 'template presence y_A <= sum of the occurrences of A' },
  { id: 'template_conflict', prefix: 'tconf_<k>', keyedBy: 'conflict pair', adr: 'ADR 0003 principle 4; ADR 0013 4A emit 3', description: 'linked presence exclusion y_A + y_B <= 1; copies of A stay legal without B' },
  { id: 'self_conflict', prefix: 'self_<t>', keyedBy: 'template', adr: 'ADR 0003 principle 4', description: 'a self-conflicting template has at most one installed copy' },
  { id: 'slot_conflict', prefix: 'sconf_<v>_<s>', keyedBy: 'blocker occurrence and blocked physical slot', adr: 'ADR 0003 principle 4; INTERPRETATIONS 11, 14', description: 'x_u + occupancy(s) <= 1 for every physical slot of a blocked template slot id, the blocker\'s own slot included' },
  { id: 'include_item', prefix: 'incl_<t>', keyedBy: 'template', adr: 'ADR 0003 principle 4; INTERPRETATIONS 12', description: 'an included template is installed at least once' },
  { id: 'include_category', prefix: 'catreq_<g>', keyedBy: 'include group', adr: 'ADR 0003 principle 4; INTERPRETATIONS 5', description: 'each include group needs an installed occurrence whose category chain meets the group (outer AND, inner OR)' },
  { id: 'supply_cap', prefix: 'supcap_<t>', keyedBy: 'template', adr: 'ADR 0002 principle 8; ADR 0008 principle 5; ADR 0009 principle 3', description: 'a template with no legal standalone offer: installed <= preset supply of the chosen base + owned stock' },
  { id: 'deficit_surrogate', prefix: 'sur_<t>', keyedBy: 'template', adr: 'ADR 0009 principle 1 and 2; ADR 0013 4A emit 5', description: 'u_t >= installed_t - preset supply - owned, u_t >= 0, integer with a proved finite domain' },
  { id: 'lot_cover', prefix: 'cover_<t>', keyedBy: 'template', adr: 'INTERPRETATIONS 1', description: 'whole lots cover the surrogate: sum lots x lot size >= u_t' },
  { id: 'wallet', prefix: 'price_def', keyedBy: '-', adr: 'ADR 0009 principle 3; ADR 0013 4A emit 5', description: 'the exact wallet: price_axis = base price + whole-lot purchase cost' },
  { id: 'stat_definition', prefix: 'raw_ergo_def, weight_def, rec_mod_def, rec_axis_def, acc_def, ergo_frame', keyedBy: 'statistic', adr: 'ADR 0003 principle 5; ADR 0010 section 2', description: 'statistics summed over installed occurrences, once each, and the objective frames' },
  { id: 'first_clamp', prefix: 'c1_*', keyedBy: '-', adr: 'ADR 0007 principle 5', description: 'the displayed ergonomics: clamp(raw ergonomics, 0, 100), the general three-regime disjunction with M from the active raw bounds' },
  { id: 'gear_clamp', prefix: 'gear_def, c2_*', keyedBy: '-', adr: 'ADR 0007 principle 5', description: 'the gear factor and the second clamp: eff = clamp(factor x displayed, 0, 100), the general three-regime disjunction' },
  { id: 'ted', prefix: 'node_*, ted_def, lim_overswing', keyedBy: '-', adr: 'ADR 0007 principle 6; ADR 0010 section 4 item 12', description: 'the weight node as rows, TED = eff - weight penalty on it (a lower envelope of q), and TED >= 0 when overswing is prevented' },
  { id: 'cap_price', prefix: 'lim_price', keyedBy: '-', adr: 'ADR 0009 principle 3', description: 'max_price on the real spend' },
  { id: 'cap_ergonomics', prefix: 'lim_min_ergo', keyedBy: '-', adr: 'INTERPRETATIONS 8', description: 'min_ergonomics on the first clamp' },
  { id: 'cap_recoil', prefix: 'lim_recoil_v, lim_recoil_sum', keyedBy: '-', adr: 'ADR 0009 principle 4; ADR 0013 4C', description: 'final recoil caps written as naked x modifier <= cap - naked, so a nonpositive naked recoil is never dropped' },
  { id: 'cap_magazine_sighting', prefix: 'lim_mag, lim_sight', keyedBy: '-', adr: 'INTERPRETATIONS 7', description: 'a magazine or sighting minimum is met by the receiver or by an installed occurrence (maximum, not sum)' },
  { id: 'cap_weight', prefix: 'lim_weight', keyedBy: '-', adr: 'ADR 0010 section 4 item 4', description: 'max_weight on the total weight' },
  { id: 'moa', prefix: 'moa_rep_<v>, moa_fallback', keyedBy: 'barrel occurrence', adr: 'ADR 0007 principles 1 to 3; ADR 0006', description: 'exact Big-M replacement rows with M_b = max(0, MOA_b^max - L) derived from the active accuracy bound, and the intrinsic fallback row' },
  { id: 'objective', prefix: 'obj_def, tch_<a>', keyedBy: 'axis', adr: 'ADR 0010 section 2', description: 'the weighted score or the augmented Tchebycheff score over the three frames' },
  { id: 'contradiction', prefix: 'contra_<k>', keyedBy: 'contradiction', adr: 'ADR 0003 principle 3; ADR 0002 principle 5', description: 'a row with no variables that is false: `zero_col >= 1` on a column fixed at 0, so the model is infeasible by construction' },
];

/** A statement that is false for every build, proven while the model was written. */
export interface ModelContradiction {
  family: RowFamilyId;
  row: string;
  detail: string;
}

/** The request or the domain is already proved empty: no solve is needed, and the LP text is infeasible by construction. */
export interface ProvedEmpty {
  /** `domain` when the prepared domain itself is empty; `request` when a constant row of the request is false. */
  source: 'domain' | 'request';
  reasons: readonly string[];
}

export interface TemplateLot {
  /** Index into the template's `ModStats.offers`. */
  offerIndex: number;
  source: string;
  lotSize: number;
  /** RUB for one whole lot. */
  price: number;
  /** Upper bound of the lot column: ceil(surrogate bound / lot size). */
  maxLots: number;
}

export interface TemplatePlan {
  template: number;
  templateId: string;
  supply: Exclude<SupplyClass, 'receiver' | 'none'>;
  /** Active occurrences of the template. */
  activeInstances: number;
  /** Proved upper bound on the installed copies (active instances, or 1 under a self-conflict). */
  maxInstalled: number;
  owned: number;
  presetSupply: readonly { base: number; quantity: number }[];
  /** Upper bound of u_t; null for a capped template (its paid deficit is zero by the supply cap). */
  surrogateMax: number | null;
  lots: readonly TemplateLot[];
}

export interface AuxiliaryColumn extends ColumnDeclaration {
  role: string;
}

export interface ObjectiveCoefficient {
  column: string;
  value: number;
  formula: string;
}

export interface ObjectiveMeta {
  sense: 'maximize';
  column: 'total_obj';
  kind: 'weighted' | 'tchebycheff';
  /** fE = ergoScale x (ergonomics | TED), fR = recoilScale x summed recoil modifier, fP = RUB spend. */
  frame: { ergoScale: number; recoilScale: number; priceScale: number };
  ergoSource: 'capped_ergo' | 'ted';
  weights: { e: number; r: number; p: number };
  /** The oracle score equals `scale` x (LP objective) + `offset`. */
  toOracle: { scale: 1; offset: 0 };
  coefficients: readonly ObjectiveCoefficient[];
  tchebycheff: null | {
    ideal: IdealPoint;
    ce: number;
    cr: number;
    cp: number;
    /** Axes with a positive weight. */
    active: readonly ('e' | 'r' | 'p')[];
  };
}

export interface SpatialMeta {
  /** The interval enforced on the weight column (the node clipped to the active weight domain). */
  weightMin: number;
  weightMax: number;
  penalty: NodePenalty | { line: PenaltyLine; kind: 'supplied'; exact: boolean };
}

/** HiGHS drops a matrix entry of magnitude at most this when it reads a model (its default `small_matrix_value`; `src/solver/native/options.ts`). */
export const HIGHS_SMALL_MATRIX_VALUE = 1e-9;
/** HiGHS rejects a matrix entry of magnitude at least this (its default `large_matrix_value`). */
export const HIGHS_LARGE_MATRIX_VALUE = 1e15;

export interface ModelStats {
  /** Smallest and largest magnitude of a written matrix coefficient. */
  minAbsCoefficient: number;
  maxAbsCoefficient: number;
  columns: number;
  rows: number;
  nonzeros: number;
  binaries: number;
  integers: number;
  continuous: number;
  lpChars: number;
}

/** Names of the columns of the model. */
export interface ModelColumns {
  /** Decision column of an active item occurrence, or null. */
  occurrence(v: number): string | null;
  /** Decision column of the b-th accessible base of the domain. */
  base(b: number): string;
  presence(t: number): string | null;
  surrogate(t: number): string | null;
  lot(t: number, k: number): string | null;
  /** Active item occurrences with a decision column, ascending. */
  readonly activeOccurrences: Int32Array;
  /** Names of the auxiliary columns the model holds, by role. */
  readonly aux: Readonly<Record<string, string>>;
}

export interface SpecializedModel {
  readonly version: 1;
  readonly blueprint: PhysicalBlueprint;
  readonly domain: SubproblemDomain;
  /** CPLEX-LP text. For an empty domain, a one-row infeasible model. */
  readonly lp: string;
  readonly provedEmpty: ProvedEmpty | null;
  readonly contradictions: readonly ModelContradiction[];
  readonly columns: ModelColumns;
  readonly templatePlans: ReadonlyMap<number, TemplatePlan>;
  /** Declarations (kind and finite domain) of every column except the per-occurrence decision columns. */
  readonly auxiliaries: readonly AuxiliaryColumn[];
  readonly rowFamilies: readonly RowFamilyRecord[];
  readonly objective: ObjectiveMeta;
  /** Raw ranges of the active occurrences the auxiliary domains come from; null for an empty domain. */
  readonly activeBounds: ActiveBounds | null;
  /** Set when the request reads TED. */
  readonly spatial: SpatialMeta | null;
  /**
   * True when every physical build of the request is feasible exactly when it is model-feasible, with exactly its score as
   * objective value. False only for a TED request on a node interval whose weight penalty line is a relaxation (the objective is
   * then an UPPER bound and `prevent_overswing` is relaxed); the spatial search tightens it.
   */
  readonly exact: boolean;
  readonly notes: readonly string[];
  /**
   * True when a written matrix coefficient is at or below HiGHS's `small_matrix_value` (it would be silently DROPPED on read, so HiGHS would
   * solve a different model; a very wide price normalization in a Tchebycheff request does this) or at or above `large_matrix_value` (the
   * read fails). The text is still emitted unchanged: a legal rescaling with complete error evidence is Phase 2.5, and Phase 2.7 reads the
   * model back and compares it with the text before it trusts a solve.
   */
  readonly matrixFilterRisk: boolean;
  readonly stats: ModelStats;
}

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

const xName = (v: number): string => `x_${v}`;
const baseName = (b: number): string => `base_${b}`;
const presenceName = (t: number): string => `y_${t}`;
const surrogateName = (t: number): string => `u_${t}`;
const lotName = (t: number, k: number): string => `lot_${t}_${k}`;

// ---------------------------------------------------------------------------------------------
// Request resolution
// ---------------------------------------------------------------------------------------------

interface ResolvedRequest {
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
  useTrueErgo: boolean;
  tchebycheff: IdealPoint | null;
  preventOverswing: boolean;
  gearFactor: number;
}

function number_(value: number | null | undefined, name: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new PhysicalModelError('INVALID_REQUEST', `${name} is not a finite number`, { name });
  return value;
}

function resolveRequest(request: SpecializeRequest): ResolvedRequest {
  const weight = (value: number | null | undefined, fallback: number, name: string): number => Math.max(0, number_(value, name) ?? fallback);
  let tchebycheff: IdealPoint | null = null;
  if (request.useTchebycheff === true) {
    const ideal = request.idealPoint;
    if (!ideal) throw new PhysicalModelError('INVALID_REQUEST', 'use_tchebycheff requires an ideal point (INTERPRETATIONS.md choice 9)', { name: 'idealPoint' });
    for (const key of ['zE', 'nadE', 'zR', 'nadR', 'zP', 'nadP'] as const) number_(ideal[key], `idealPoint.${key}`);
    tchebycheff = { ...ideal };
  }
  return {
    maxPrice: number_(request.maxPrice, 'maxPrice'),
    minErgonomics: number_(request.minErgonomics, 'minErgonomics'),
    maxRecoilV: number_(request.maxRecoilV, 'maxRecoilV'),
    maxRecoilSum: number_(request.maxRecoilSum, 'maxRecoilSum'),
    minMagCapacity: number_(request.minMagCapacity, 'minMagCapacity'),
    minSightingRange: number_(request.minSightingRange, 'minSightingRange'),
    maxWeight: number_(request.maxWeight, 'maxWeight'),
    maxMoa: number_(request.maxMOA, 'maxMOA'),
    includeItems: [...new Set(request.includeItems ?? [])],
    includeCategories: (request.includeCategories ?? []).map(group => [...group]),
    e: weight(request.ergoWeight, 1, 'ergoWeight'),
    r: weight(request.recoilWeight, 1, 'recoilWeight'),
    p: weight(request.priceWeight, 0, 'priceWeight'),
    useTrueErgo: request.useTrueErgo === true,
    tchebycheff,
    preventOverswing: request.preventOverswing === true,
    gearFactor: Math.max(0, 1 + (number_(request.equipErgoModifier, 'equipErgoModifier') ?? 0)),
  };
}

const clampErgo = (x: number): number => Math.min(ERGO_CLAMP_MAX, Math.max(0, x));

// ---------------------------------------------------------------------------------------------
// The model builder
// ---------------------------------------------------------------------------------------------

class Specializer {
  readonly w = new LpWriter();
  readonly families = new Map<RowFamilyId, RowFamilyRecord>(FAMILIES.map(f => [f.id, { ...f, count: 0, vacuous: 0 }]));
  readonly contradictions: ModelContradiction[] = [];
  readonly notes: string[] = [];
  readonly templatePlans = new Map<number, TemplatePlan>();
  readonly aux: Record<string, string> = {};
  readonly activeInstances: Int32Array[];
  private zeroColumn = false;
  /** The weight interval the node leaves on the active weight domain (the whole domain without a node). */
  weightInterval: Interval = { lo: 0, hi: 0 };
  /** The weight-penalty line of a TED request. */
  penalty: NodePenalty | { line: PenaltyLine; kind: 'supplied'; exact: boolean } | null = null;
  /** The column the ergonomics axis is read from: the first clamp, or TED. */
  ergoColumn = 'capped_ergo';
  private activeList: Int32Array = new Int32Array(0);

  readonly bp: PhysicalBlueprint;
  readonly domain: SubproblemDomain;
  readonly req: ResolvedRequest;
  readonly bounds: ActiveBounds;
  readonly node: SpatialNode | undefined;

  constructor(bp: PhysicalBlueprint, domain: SubproblemDomain, req: ResolvedRequest, bounds: ActiveBounds, node: SpatialNode | undefined) {
    this.bp = bp;
    this.domain = domain;
    this.req = req;
    this.bounds = bounds;
    this.node = node;
    const T = bp.templateCount;
    this.activeInstances = new Array<Int32Array>(T);
    this.activeInstances[0] = new Int32Array(0);
    for (let t = 1; t < T; t++) this.activeInstances[t] = Int32Array.from(bp.instancesOf(t).filter(v => domain.occActive[v] === 1));
  }

  // --- rows ---------------------------------------------------------------------------------

  private family(id: RowFamilyId): RowFamilyRecord {
    return this.families.get(id) as RowFamilyRecord;
  }

  /** The `zero_col` column, fixed at 0, on which a false constant row is stated. */
  private contradict(family: RowFamilyId, row: string, detail: string): void {
    if (!this.zeroColumn) {
      this.w.addColumn('zero_col', 'continuous', 0, 0);
      this.zeroColumn = true;
    }
    const k = this.contradictions.length;
    this.w.addRow(`contra_${k}`, [['zero_col', 1]], '>=', 1);
    this.family('contradiction').count++;
    this.contradictions.push({ family, row, detail });
  }

  /**
   * Write a row; a row that merges to no variables is a constant statement: dropped when true, a contradiction row when false.
   */
  emit(family: RowFamilyId, name: string, terms: Iterable<readonly [string, number]>, sense: RowSense, rhs: number, detail: string): void {
    const record = this.family(family);
    const merged = mergeTerms(terms);
    if (merged.names.length === 0) {
      const holds = sense === '<=' ? 0 <= rhs : sense === '>=' ? 0 >= rhs : rhs === 0;
      if (holds) record.vacuous++;
      else this.contradict(family, name, detail);
      return;
    }
    this.w.addMerged(name, merged, sense, rhs);
    record.count++;
  }

  private occurrenceTerms(occurrences: Iterable<number>, coef = 1): [string, number][] {
    const terms: [string, number][] = [];
    for (const v of occurrences) terms.push([xName(v), coef]);
    return terms;
  }

  private presetTerms(t: number, sign: number): [string, number][] {
    return this.domain.templates[t].presetSupply.map(({ base, quantity }) => [baseName(base), sign * quantity] as [string, number]);
  }

  // --- columns ------------------------------------------------------------------------------

  private declareDecisionColumns(): void {
    const { bp, domain } = this;
    const active: number[] = [];
    for (let v = 1; v < bp.occurrenceCount; v++) {
      if (!domain.occActive[v]) continue;
      active.push(v);
      this.w.addColumn(xName(v), 'binary', 0, 1, false);
    }
    this.activeList = Int32Array.from(active);
    for (let b = 0; b < domain.bases.length; b++) this.w.addColumn(baseName(b), 'binary', 0, 1);
  }

  private declareAux(role: string, name: string, lo: number, hi: number, kind: 'continuous' | 'integer' | 'binary' = 'continuous'): void {
    this.aux[role] = name;
    this.w.addColumn(name, kind, lo, hi);
  }

  // --- supply and wallet --------------------------------------------------------------------

  /** Plan the paid-deficit surrogate and whole lots (or the supply cap) of every template with active occurrences. */
  private planSupply(): { priceUpper: number; priceTerms: number } {
    const { bp, domain } = this;
    let priceUpper = Math.max(0, ...domain.bases.map(base => base.cheapestPrice));
    let priceTerms = domain.bases.length;
    for (let t = 1; t < bp.templateCount; t++) {
      const active = this.activeInstances[t].length;
      if (active === 0) continue;
      const acquisition = domain.templates[t];
      if (acquisition.supply !== 'standalone' && acquisition.supply !== 'capped') {
        throw new PhysicalModelError('DOMAIN_INCONSISTENT', `Template ${bp.templateIds[t]} has ${active} active occurrences but supply '${acquisition.supply}'`, { template: t });
      }
      const maxInstalled = bp.templateSelfConflict[t] === 1 ? Math.min(active, 1) : active;
      const plan: TemplatePlan = {
        template: t,
        templateId: bp.templateIds[t],
        supply: acquisition.supply,
        activeInstances: active,
        maxInstalled,
        owned: acquisition.owned,
        presetSupply: acquisition.presetSupply,
        surrogateMax: null,
        lots: [],
      };
      if (acquisition.supply === 'standalone') {
        const surrogateMax = Math.max(0, maxInstalled - acquisition.owned);
        const lots: TemplateLot[] = [];
        if (surrogateMax > 0) {
          for (const lot of acquisition.standaloneLots) {
            lots.push({ offerIndex: lot.index, source: lot.source, lotSize: lot.lotSize, price: lot.price, maxLots: Math.ceil(surrogateMax / lot.lotSize) });
          }
        }
        plan.surrogateMax = surrogateMax;
        plan.lots = lots;
        this.w.addColumn(surrogateName(t), 'integer', 0, surrogateMax);
        lots.forEach((lot, k) => {
          this.w.addColumn(lotName(t, k), 'integer', 0, lot.maxLots);
          priceUpper += lot.price * lot.maxLots;
          priceTerms++;
        });
      }
      this.templatePlans.set(t, plan);
    }
    return { priceUpper: sumEnclosure(0, priceUpper, priceTerms, priceUpper).hi, priceTerms };
  }

  private emitSupply(): void {
    const { bp } = this;
    for (const [t, plan] of this.templatePlans) {
      const instances = this.activeInstances[t];
      const installed = this.occurrenceTerms(instances);
      if (plan.supply === 'capped') {
        // installed <= sum_b q_bt base_b + owned: a template with no legal standalone offer is never bought (ADR 0002 principle 8).
        this.emit('supply_cap', `supcap_${t}`, [...installed, ...this.presetTerms(t, -1)], '<=', plan.owned, `supply cap of ${bp.templateIds[t]}`);
        continue;
      }
      // u_t >= installed - sum_b q_bt base_b - owned  <=>  u_t - installed + sum_b q_bt base_b >= -owned
      const surrogate: [string, number][] = [[surrogateName(t), 1], ...installed.map(([name]) => [name, -1] as [string, number]), ...this.presetTerms(t, 1)];
      this.emit('deficit_surrogate', `sur_${t}`, surrogate, '>=', -plan.owned, `surrogate of ${bp.templateIds[t]}`);
      if (plan.lots.length > 0) {
        // whole lots cover the surrogate: sum_k size_k lots_k - u_t >= 0
        const cover: [string, number][] = plan.lots.map((lot, k) => [lotName(t, k), lot.lotSize] as [string, number]);
        cover.push([surrogateName(t), -1]);
        this.emit('lot_cover', `cover_${t}`, cover, '>=', 0, `lot cover of ${bp.templateIds[t]}`);
      }
    }
  }

  // --- structure ----------------------------------------------------------------------------

  private emitBase(): void {
    const terms: [string, number][] = this.domain.bases.map((_, b) => [baseName(b), 1]);
    this.emit('base_choice', 'base_sum', terms, '=', 1, 'no accessible base');
  }

  private emitSlots(): void {
    const { bp, domain } = this;
    for (let s = 0; s < bp.slotCount; s++) {
      if (!domain.slotActive[s]) continue;
      const owner = bp.slotOwner(s);
      const candidates: number[] = [];
      for (let c = bp.candidateStart(s), end = c + bp.candidateCount(s); c < end; c++) if (domain.occActive[c]) candidates.push(c);
      const occupancy = this.occurrenceTerms(candidates);
      if (bp.slotRequired(s)) {
        if (owner === 0) {
          this.emit('required_occupancy', `req_${s}`, occupancy, '=', 1, `required root slot ${bp.rawSlotId(s)} has no active candidate`);
        } else if (occupancy.length === 0) {
          this.emit('required_empty', `reqempty_${s}`, [[xName(owner), 1]], '=', 0, `required slot ${s}`);
        } else {
          this.emit('required_occupancy', `req_${s}`, [...occupancy, [xName(owner), -1]], '=', 0, `required slot ${s}`);
        }
      } else if (occupancy.length > 0) {
        if (owner === 0) {
          if (occupancy.length > 1) this.emit('slot', `slot_${s}`, occupancy, '<=', 1, `slot ${s}`);
          else this.family('slot').vacuous++;
        } else {
          this.emit('slot', `slot_${s}`, [...occupancy, [xName(owner), -1]], '<=', 0, `slot ${s}`);
        }
      }
    }
  }

  private emitConflicts(): void {
    const { bp } = this;
    const pairs = bp.templateConflictPairs;
    const presence = new Set<number>();
    let k = 0;
    const needPresence = (t: number): void => {
      if (presence.has(t)) return;
      presence.add(t);
      this.w.addColumn(presenceName(t), 'continuous', 0, 1);
    };
    const pairRows: [number, number][] = [];
    for (let i = 0; i < pairs.length; i += 2) {
      const a = pairs[i];
      const b = pairs[i + 1];
      if (this.activeInstances[a].length === 0 || this.activeInstances[b].length === 0) continue; // a pair with an absent side excludes nothing
      needPresence(a);
      needPresence(b);
      pairRows.push([a, b]);
    }
    for (const [a, b] of pairRows) this.emit('template_conflict', `tconf_${k++}`, [[presenceName(a), 1], [presenceName(b), 1]], '<=', 1, `conflict pair ${bp.templateIds[a]}/${bp.templateIds[b]}`);
    for (const t of presence) {
      for (const v of this.activeInstances[t]) this.emit('presence_upper', `ylink_${v}`, [[xName(v), 1], [presenceName(t), -1]], '<=', 0, `presence of ${bp.templateIds[t]}`);
      this.emit('presence_lower', `ysum_${t}`, [[presenceName(t), 1], ...this.occurrenceTerms(this.activeInstances[t], -1)], '<=', 0, `presence of ${bp.templateIds[t]}`);
    }
    for (let t = 1; t < bp.templateCount; t++) {
      const instances = this.activeInstances[t];
      if (bp.templateSelfConflict[t] === 1 && instances.length >= 2) this.emit('self_conflict', `self_${t}`, this.occurrenceTerms(instances), '<=', 1, `self-conflict of ${bp.templateIds[t]}`);
      const blocked = bp.slotConflictsOf(t);
      if (blocked.length === 0 || instances.length === 0) continue;
      for (const v of instances) {
        for (const r of blocked) {
          for (const s of bp.physicalSlotsOfRawId(r)) {
            if (!this.domain.slotActive[s]) continue;
            const occupancy: number[] = [];
            for (let c = bp.candidateStart(s), end = c + bp.candidateCount(s); c < end; c++) if (this.domain.occActive[c]) occupancy.push(c);
            if (occupancy.length === 0) continue;
            this.emit('slot_conflict', `sconf_${v}_${s}`, [[xName(v), 1], ...this.occurrenceTerms(occupancy)], '<=', 1, `slot conflict ${v}/${s}`);
          }
        }
      }
    }
  }

  private emitIncludes(): void {
    const { bp } = this;
    this.req.includeItems.forEach((id, k) => {
      const t = bp.templateIndexOf(id);
      const instances = t > 0 ? this.activeInstances[t] : new Int32Array(0);
      this.emit('include_item', t > 0 ? `incl_${t}` : `incl_unknown_${k}`, this.occurrenceTerms(instances), '>=', 1, `included item ${id} has no active occurrence`);
    });
    this.req.includeCategories.forEach((group, g) => {
      const matching: number[] = [];
      for (let t = 1; t < bp.templateCount; t++) {
        if (this.activeInstances[t].length === 0) continue;
        if (bp.templateCategoryChain[t].some(category => group.includes(category))) matching.push(...this.activeInstances[t]);
      }
      this.emit('include_category', `catreq_${g}`, this.occurrenceTerms(matching), '>=', 1, `include group ${g} [${group.join(', ')}] matches no active occurrence`);
    });
  }

  // --- statistics ---------------------------------------------------------------------------

  private statTerms(values: Float64Array | Readonly<Float64Array>, sign: number): [string, number][] {
    const { bp } = this;
    const terms: [string, number][] = [];
    for (const v of this.activeList) {
      const value = values[bp.occTemplate[v]];
      if (value !== 0) terms.push([xName(v), sign * value]);
    }
    return terms;
  }

  /** The general three-regime clamp of `source` into `target` over [0, cap] (ADR 0007 principle 5). `src` encloses the source column. */
  private emitClamp(family: RowFamilyId, prefix: string, source: string, target: string, src: Interval, cap: number): void {
    // Any M at least max(|lo|, |hi|, cap) + cap is valid; a whole number keeps the coefficients readable and the rows well scaled.
    const m = Math.ceil(nextUp(Math.max(Math.abs(src.lo), Math.abs(src.hi), cap) + cap));
    const low = `${prefix}_low`;
    const mid = `${prefix}_mid`;
    const high = `${prefix}_high`;
    for (const name of [low, mid, high]) this.w.addColumn(name, 'binary', 0, 1);
    const row = (suffix: string, terms: [string, number][], sense: RowSense, rhs: number): void => this.emit(family, `${prefix}_${suffix}`, terms, sense, rhs, `clamp ${prefix}`);
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

  /** Everything after the structure rows: statistics, clamps, TED, wallet, caps, MOA, objective. */
  private emitStatistics(priceUpper: number): { ergoAxis: Interval; recAxis: Interval; priceAxis: Interval } {
    const { bp, domain, req, bounds } = this;
    const rawErgo = bounds.ergonomics;
    const capped: Interval = { lo: clampErgo(rawErgo.lo), hi: clampErgo(rawErgo.hi) };
    const recMod = bounds.recoil;
    const recAxis = iScale(RECOIL_SCALE, recMod);
    const priceAxis: Interval = { lo: 0, hi: priceUpper };
    const tedMode = req.useTrueErgo || req.preventOverswing;
    const needWeight = tedMode || req.maxWeight !== null;

    // --- columns ---
    this.declareAux('rawErgo', 'raw_ergo', rawErgo.lo, rawErgo.hi);
    this.declareAux('cappedErgo', 'capped_ergo', capped.lo, capped.hi);
    this.declareAux('recMod', 'rec_mod', recMod.lo, recMod.hi);
    this.declareAux('recAxis', 'rec_axis', recAxis.lo, recAxis.hi);
    this.declareAux('priceAxis', 'price_axis', priceAxis.lo, priceAxis.hi);
    if (needWeight) {
      // The column keeps the full active domain. A node is enforced by ROWS, not by tightening the column: the retired npm HiGHS presolve
      // mishandled a tightened bound on a continuous column that an equality ties to binaries (it returned a point outside the bound
      // as Optimal, e.g. `weight = 4.5` with `weight - x = 4`, x binary); the same restriction written as rows was solved correctly.
      const weight = bounds.weight;
      this.declareAux('weight', 'weight', weight.lo, weight.hi);
      const lo = this.node ? Math.max(weight.lo, this.node.weightMin) : weight.lo;
      const hi = this.node ? Math.min(weight.hi, this.node.weightMax) : weight.hi;
      this.weightInterval = { lo, hi };
      if (this.node && lo > hi) {
        // The node does not meet the weights any build can have: no build lies in it.
        this.contradict('ted', 'node', `the weight node [${this.node.weightMin}, ${this.node.weightMax}] is disjoint from the active weight range [${weight.lo}, ${weight.hi}]`);
      } else if (this.node && tedMode) {
        if (this.node.weightMin === this.node.weightMax) {
          this.emit('ted', 'node_fix', [['weight', 1]], '=', this.node.weightMin, 'weight node');
        } else {
          if (this.node.weightMin > weight.lo) this.emit('ted', 'node_lo', [['weight', 1]], '>=', this.node.weightMin, 'weight node');
          if (this.node.weightMax < weight.hi) this.emit('ted', 'node_hi', [['weight', 1]], '<=', this.node.weightMax, 'weight node');
        }
      }
    }
    if (req.maxMoa !== null) this.declareAux('accTotal', 'acc_total', bounds.accuracy.lo, bounds.accuracy.hi);

    // --- statistic definitions: the receiver's constant on the right-hand side, installed occurrences on the left ---
    const stat = (name: string, terms: [string, number][], rhs: number): void => this.emit('stat_definition', name, terms, '=', rhs, name);
    stat('raw_ergo_def', [['raw_ergo', 1], ...this.statTerms(bp.templateErgonomics, -1)], bp.templateErgonomics[0]);
    stat('rec_mod_def', [['rec_mod', 1], ...this.statTerms(bp.templateRecoilModifier, -1)], 0);
    stat('rec_axis_def', [['rec_axis', 1], ['rec_mod', -RECOIL_SCALE]], 0);
    if (needWeight) stat('weight_def', [['weight', 1], ...this.statTerms(bp.templateWeight, -1)], bp.templateWeight[0]);
    if (req.maxMoa !== null) stat('acc_def', [['acc_total', 1], ...this.statTerms(bp.templateAccuracyModifier, -1)], 0);

    // --- the first clamp: displayed ergonomics ---
    this.emitClamp('first_clamp', 'c1', 'raw_ergo', 'capped_ergo', rawErgo, ERGO_CLAMP_MAX);

    // --- gear factor, second clamp, TED ---
    let ergoSource: Interval = capped;
    let ergoColumn = 'capped_ergo';
    if (tedMode) {
      const gear = iScale(req.gearFactor, capped);
      const eff: Interval = { lo: clampErgo(gear.lo), hi: clampErgo(gear.hi) };
      this.declareAux('gearErgo', 'gear_ergo', gear.lo, gear.hi);
      this.declareAux('effErgo', 'eff_ergo', eff.lo, eff.hi);
      this.emit('gear_clamp', 'gear_def', [['gear_ergo', 1], ['capped_ergo', -req.gearFactor]], '=', 0, 'gear factor');
      this.emitClamp('gear_clamp', 'c2', 'gear_ergo', 'eff_ergo', gear, ERGO_CLAMP_MAX);
      const { lo, hi } = this.weightInterval;
      if (lo <= hi) {
        const penalty = this.node?.penalty
          ? this.checkedPenalty(lo, hi, this.node.penalty)
          : secantOfPenalty(lo, hi);
        this.penalty = penalty;
        const q = lineRange(penalty.line, lo, hi);
        const qOut = outward(q);
        const ted: Interval = outward({ lo: eff.lo - qOut.hi, hi: eff.hi - qOut.lo });
        this.declareAux('ted', 'ted', ted.lo, ted.hi);
        // ted = eff - (slope W + intercept)
        this.emit('ted', 'ted_def', [['ted', 1], ['eff_ergo', -1], ['weight', penalty.line.slope]], '=', -penalty.line.intercept, 'TED definition');
        if (req.preventOverswing) this.emit('ted', 'lim_overswing', [['ted', 1]], '>=', 0, 'prevent overswing');
        if (req.useTrueErgo) {
          ergoSource = ted;
          ergoColumn = 'ted';
        }
      } else {
        this.declareAux('ted', 'ted', 0, 0);
        if (req.useTrueErgo) {
          ergoSource = { lo: 0, hi: 0 };
          ergoColumn = 'ted';
        }
      }
    }
    const ergoAxis = iScale(ERGO_SCALE, ergoSource);
    this.declareAux('ergoAxis', 'ergo_axis', ergoAxis.lo, ergoAxis.hi);
    this.emit('stat_definition', 'ergo_frame', [['ergo_axis', 1], [ergoColumn, -ERGO_SCALE]], '=', 0, 'ergonomics frame');
    this.ergoColumn = ergoColumn;

    // --- the exact wallet ---
    const wallet: [string, number][] = [['price_axis', 1]];
    domain.bases.forEach((base, b) => wallet.push([baseName(b), -base.cheapestPrice]));
    for (const [t, plan] of this.templatePlans) plan.lots.forEach((lot, k) => wallet.push([lotName(t, k), -lot.price]));
    this.emit('wallet', 'price_def', wallet, '=', 0, 'wallet');

    return { ergoAxis, recAxis, priceAxis };
  }

  private checkedPenalty(lo: number, hi: number, line: PenaltyLine): { line: PenaltyLine; kind: 'supplied'; exact: boolean } {
    if (!Number.isFinite(line.slope) || !Number.isFinite(line.intercept) || line.slope < 0 || !penaltyLineIsValid(lo, hi, line)) {
      throw new PhysicalModelError('INVALID_REQUEST', `The supplied weight-penalty line is not a lower envelope of q on [${lo}, ${hi}]`, { lo, hi, line });
    }
    const exact = hi <= 3 || lo === hi;
    return { line, kind: 'supplied', exact };
  }

  // --- caps ---------------------------------------------------------------------------------

  private emitCaps(): void {
    const { bp, req } = this;
    if (req.maxPrice !== null) this.emit('cap_price', 'lim_price', [['price_axis', 1]], '<=', req.maxPrice, `max price ${req.maxPrice} is below every spend`);
    if (req.minErgonomics !== null) this.emit('cap_ergonomics', 'lim_min_ergo', [['capped_ergo', 1]], '>=', req.minErgonomics, `min ergonomics ${req.minErgonomics}`);
    // final recoil = naked x (1 + modifier sum) <= cap  <=>  naked x modifier <= cap - naked; no division, any sign of naked.
    const nakedV = bp.receiverRecoilVertical;
    const nakedH = bp.receiverRecoilHorizontal;
    if (req.maxRecoilV !== null) this.emit('cap_recoil', 'lim_recoil_v', [['rec_mod', nakedV]], '<=', req.maxRecoilV - nakedV, `max vertical recoil ${req.maxRecoilV}`);
    if (req.maxRecoilSum !== null) this.emit('cap_recoil', 'lim_recoil_sum', [['rec_mod', nakedV + nakedH]], '<=', req.maxRecoilSum - (nakedV + nakedH), `max recoil sum ${req.maxRecoilSum}`);
    if (req.minMagCapacity !== null) this.emitMinimum('lim_mag', req.minMagCapacity, bp.templateCapacity, bp.templateCapacity[0], 'magazine capacity');
    if (req.minSightingRange !== null) this.emitMinimum('lim_sight', req.minSightingRange, bp.templateSightingRange, bp.templateSightingRange[0], 'sighting range');
    if (req.maxWeight !== null) this.emit('cap_weight', 'lim_weight', [['weight', 1]], '<=', req.maxWeight, `max weight ${req.maxWeight}`);
  }

  /** A minimum met by the receiver or by some installed occurrence reaching it (the maximum over receiver and items, INTERPRETATIONS 7). */
  private emitMinimum(name: string, minimum: number, values: Readonly<Float64Array>, receiver: number, what: string): void {
    const record = this.family('cap_magazine_sighting');
    if (receiver >= minimum) {
      record.vacuous++;
      return;
    }
    const reaching: number[] = [];
    for (const v of this.activeList) if (values[this.bp.occTemplate[v]] >= minimum) reaching.push(v);
    this.emit('cap_magazine_sighting', name, this.occurrenceTerms(reaching), '>=', 1, `no active occurrence reaches the ${what} minimum ${minimum}`);
  }

  // --- MOA ----------------------------------------------------------------------------------

  private emitMoa(): void {
    const { bp, req, bounds } = this;
    if (req.maxMoa === null) return;
    const limit = req.maxMoa;
    const a = bounds.accuracy;
    /** The largest MOA value c (1 - A/100) over the accuracy range: linear in A, so an endpoint. An exact zero stays zero (no denormal). */
    const up = (x: number): number => (x === 0 ? 0 : nextUp(x));
    const moaUpper = (c: number): number => up(Math.max(c * (1 - a.lo / 100), c * (1 - a.hi / 100)));
    /**
     * M = max(0, MOA^max - L), enclosed upward. A positive M below MIN_BIG_M is raised to it: any larger M is just as valid (the row is
     * non-binding when its barrel is absent), and HiGHS drops a matrix entry of magnitude at most 1e-9 when it reads the text, which
     * would silently delete the coefficient.
     */
    const bigM = (c: number): number => {
      const m = Math.max(0, up(moaUpper(c) - limit));
      return m === 0 ? 0 : Math.max(m, MIN_BIG_M);
    };
    const barrels: number[] = [];
    for (const v of this.activeList) if (bp.templateCenterOfImpact[bp.occTemplate[v]] > 0) barrels.push(v);
    const intrinsic = bp.templateCenterOfImpact[0];
    const cBase = intrinsic * MOA_K;
    if (a.hi > 100 && barrels.length > 1) {
      this.notes.push('MOA rows assume an accuracy sum of at most 100 percent points when several barrels are installed (each installed barrel row binds; the oracle takes the largest COI)');
    }
    for (const v of barrels) {
      const coi = bp.templateCenterOfImpact[bp.occTemplate[v]];
      const c = coi * MOA_K;
      const m = bigM(c);
      // (c/100) A - M x_b >= c - L - M
      this.emit('moa', `moa_rep_${v}`, [['acc_total', coi * MOA_K_OVER_100], [xName(v), -m]], '>=', c - limit - m, `MOA of barrel ${v}`);
    }
    const mFallback = barrels.length > 0 ? bigM(cBase) : 0;
    // (c0/100) A + M_fb sum_b x_b >= c0 - L; with no barrel the sum is empty and the row is the unconditional intrinsic one.
    this.emit('moa', 'moa_fallback', [['acc_total', intrinsic * MOA_K_OVER_100], ...this.occurrenceTerms(barrels, mFallback)], '>=', cBase - limit, `intrinsic MOA ${cBase} exceeds the cap ${limit}`);
  }

  // --- objective ----------------------------------------------------------------------------

  private emitObjective(ranges: { ergoAxis: Interval; recAxis: Interval; priceAxis: Interval }): ObjectiveMeta {
    const { req } = this;
    const { e, r, p } = req;
    const coefficients: ObjectiveCoefficient[] = [];
    const ergoSource: 'capped_ergo' | 'ted' = this.ergoColumn === 'ted' ? 'ted' : 'capped_ergo';
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
      this.declareAux('tch', 'tch_t', tRange.lo, tRange.hi);
      terms.push(['tch_t', 1]);
      coefficients.push({ column: 'tch_t', value: -1, formula: '-1' });
      objective = iAdd(objective, { lo: -tRange.hi, hi: -tRange.lo });
      for (const d of deviations) this.emit('objective', d.name, d.terms, '>=', d.rhs, d.name);
    }
    this.declareAux('totalObj', 'total_obj', objective.lo, objective.hi);
    this.emit('objective', 'obj_def', terms, '=', 0, 'objective definition');
    this.w.setObjective('total_obj');
    return {
      sense: 'maximize',
      column: 'total_obj',
      kind: req.tchebycheff ? 'tchebycheff' : 'weighted',
      frame: { ergoScale: ERGO_SCALE, recoilScale: RECOIL_SCALE, priceScale: 1 },
      ergoSource,
      weights: { e, r, p },
      toOracle: { scale: 1, offset: 0 },
      coefficients,
      tchebycheff: tch,
    };
  }

  // --- driver -------------------------------------------------------------------------------

  build(): ObjectiveMeta {
    this.declareDecisionColumns();
    const { priceUpper } = this.planSupply();
    // The conflict pass declares presence columns before any row uses them.
    this.emitBase();
    this.emitSlots();
    this.emitConflicts();
    this.emitIncludes();
    this.emitSupply();
    const ranges = this.emitStatistics(priceUpper);
    this.emitCaps();
    this.emitMoa();
    return this.emitObjective(ranges);
  }

  columns(): ModelColumns {
    const { domain } = this;
    const presence = new Set<number>();
    for (const declaration of this.w.declarations) if (declaration.name.startsWith('y_')) presence.add(Number(declaration.name.slice(2)));
    const aux = this.aux;
    const plans = this.templatePlans;
    const activeList = this.activeList;
    return {
      occurrence: v => (v > 0 && v < domain.occActive.length && domain.occActive[v] === 1 ? xName(v) : null),
      base: baseName,
      presence: t => (presence.has(t) ? presenceName(t) : null),
      surrogate: t => (plans.get(t)?.surrogateMax != null ? surrogateName(t) : null),
      lot: (t, k) => (k >= 0 && k < (plans.get(t)?.lots.length ?? 0) ? lotName(t, k) : null),
      activeOccurrences: activeList,
      aux,
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

function emptyObjective(): ObjectiveMeta {
  return {
    sense: 'maximize',
    column: 'total_obj',
    kind: 'weighted',
    frame: { ergoScale: ERGO_SCALE, recoilScale: RECOIL_SCALE, priceScale: 1 },
    ergoSource: 'capped_ergo',
    weights: { e: 0, r: 0, p: 0 },
    toOracle: { scale: 1, offset: 0 },
    coefficients: [],
    tchebycheff: null,
  };
}

function emptyModel(blueprint: PhysicalBlueprint, domain: SubproblemDomain): SpecializedModel {
  const reasons = domain.contradictions.map(c => (c.code === 'NO_ACCESSIBLE_BASE' ? 'no accessible base' : `root required slot ${c.rawSlotId} has no active candidate`));
  const lp = ['Maximize', '  obj: total_obj', 'Subject To', '  empty_domain: zero_col >= 1', 'Bounds', '  total_obj = 0', '  zero_col = 0', 'End'].join('\n');
  const none = (): null => null;
  const families = FAMILIES.map(f => ({ ...f, count: f.id === 'contradiction' ? 1 : 0, vacuous: 0 }));
  return {
    version: 1,
    blueprint,
    domain,
    lp,
    provedEmpty: { source: 'domain', reasons },
    contradictions: reasons.map(detail => ({ family: 'contradiction' as const, row: 'empty_domain', detail })),
    columns: {
      occurrence: none,
      base: baseName,
      presence: none,
      surrogate: none,
      lot: none,
      activeOccurrences: new Int32Array(0),
      aux: {},
    },
    templatePlans: new Map(),
    auxiliaries: [],
    rowFamilies: families,
    objective: emptyObjective(),
    activeBounds: null,
    spatial: null,
    exact: true,
    notes: ['the domain is empty: no build exists, so the model is the one-row contradiction'],
    matrixFilterRisk: false,
    stats: { minAbsCoefficient: 1, maxAbsCoefficient: 1, columns: 2, rows: 1, nonzeros: 1, binaries: 0, integers: 0, continuous: 2, lpChars: lp.length },
  };
}

/**
 * Specialize the physical LP of one request.
 *
 * @param node Optional weight node (see {@link SpatialNode}); read only by requests that use TED. Without one, a TED request is
 *   specialized on the whole active weight range, which is a relaxation unless every build weighs at most 3 kg.
 */
export function specializeLP(
  blueprint: PhysicalBlueprint,
  domain: SubproblemDomain,
  request: SpecializeRequest = {},
  node?: SpatialNode,
): SpecializedModel {
  if (domain.blueprint !== blueprint) {
    throw new PhysicalModelError('FOREIGN_DOMAIN', `The domain was not prepared from the blueprint of ${blueprint.weaponId}`, { weaponId: blueprint.weaponId });
  }
  const resolved = resolveRequest(request);
  if (node) {
    number_(node.weightMin, 'node.weightMin');
    number_(node.weightMax, 'node.weightMax');
  }
  if (domain.empty) return emptyModel(blueprint, domain);

  const bounds = computeActiveBounds(blueprint, domain);
  const specializer = new Specializer(blueprint, domain, resolved, bounds, node);
  const objective = specializer.build();

  const tedMode = resolved.useTrueErgo || resolved.preventOverswing;
  let spatial: SpatialMeta | null = null;
  let exact = true;
  if (tedMode && specializer.penalty) {
    spatial = { weightMin: specializer.weightInterval.lo, weightMax: specializer.weightInterval.hi, penalty: specializer.penalty };
    exact = specializer.penalty.exact;
  }
  const lp = specializer.w.toString();
  const w = specializer.w;
  const proved = specializer.contradictions.length > 0;
  const lpReasons = specializer.contradictions.map(c => c.detail);
  return {
    version: 1,
    blueprint,
    domain,
    lp,
    provedEmpty: proved ? { source: 'request', reasons: lpReasons } : null,
    contradictions: specializer.contradictions,
    columns: specializer.columns(),
    templatePlans: specializer.templatePlans,
    auxiliaries: w.declarations.map(d => ({ ...d, role: roleOf(d.name) })),
    rowFamilies: [...specializer.families.values()],
    objective,
    activeBounds: bounds,
    spatial,
    exact,
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
      lpChars: lp.length,
    },
  };
}

function roleOf(name: string): string {
  if (name.startsWith('base_')) return 'base choice';
  if (name.startsWith('y_')) return 'template presence';
  if (name.startsWith('u_')) return 'paid-deficit surrogate';
  if (name.startsWith('lot_')) return 'whole lots of one offer';
  if (/^c[12]_(low|mid|high)$/.test(name)) return 'clamp regime';
  return 'auxiliary statistic';
}
