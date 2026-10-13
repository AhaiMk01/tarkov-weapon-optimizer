/**
 * TEST-ONLY: the occurrence-level Precise model, the independent cross-check of the count model (owner decision 2d as amended, 2026-10-12;
 * Phase 2.10). It left production when Precise moved to the count model; nothing under `src/` imports it.
 *
 * Exact Precise LP specialization over the physical blueprint (ADR 0003, 0007, 0008, 0009, 0010 section 2, ADR 0013 sections 4A and 4C).
 *
 * `specializeLP(blueprint, domain, request, node?)` emits the occurrence-level MIP of one request over the ACTIVE occurrences of a
 * prepared domain, as CPLEX-LP text plus the column map and the row/objective metadata a decoder and a proof layer need. Nothing
 * here prunes or reduces: every coefficient is a shortest round-trip `String(n)` of a binary64 input leaf, a small declared integer
 * constant, or a CONSTRUCTED value (the declared constant K = 1000000/29089 = 100/2.9089, a weight over 10, a secant, a normalization
 * quotient, a cap minus a recoil) whose exact rational target, directed rounding and proved construction error are recorded by
 * `proof.ts` on `SpecializedModel.proof`; a constructed row is padded outward by the exact need, never a nominal margin, and every auxiliary
 * column has a finite domain enclosing every physical value. Reductions (presence substitution, clamp regimes, axis deletion) are Stage 4.
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
 * Coefficient provenance and proof (Phase 2.5; `proof.ts` holds the exact-rational arithmetic, `ModelProof` the record):
 *   - statistic rows (raw_ergo_def, rec_mod_def, weight_def, acc_def): the template's binary64 leaf, unscaled; the receiver's value is the
 *     right-hand side. The frames are separate one-coefficient rows (`rec_axis = 1000 rec_mod`, `ergo_axis = 10 x`), so no leaf is multiplied.
 *     Construction error 0: the leaf IS the model.
 *   - clamp rows: M = ceil(max(|lo|, |hi|, 100) + 100) from the ACTIVE raw bounds (an integer, any larger M is as valid) and the cap 100.
 *   - gear: the factor f = max(0, 1 + modifier) in exact rationals; an unrepresentable f is emitted as the two inequalities
 *     `low x capped <= gear <= high x capped` with the neighbouring doubles (the first clamp is never negative), a representable one as the
 *     equality.
 *   - recoil caps: `naked x rec_mod <= cap - naked` (no division, any sign of naked), the right-hand side the smallest double at least the
 *     exact `cap - naked` (the sum cap pads by its coefficient deficit too).
 *   - MOA rows: `c_b/100` on the accuracy sum is the nearest double of coi x 10000/29089, the right-hand side `c_b - L - M_b` is padded
 *     downward by the coefficient deficit, `M_b = max(0, max over the accuracy range of c_b (1 - A/100) - L)` is the smallest double at least
 *     the exact need (raised to a surviving size when positive). The oracle prices the installed barrel of the LARGEST centre of impact; the per-barrel
 *     row states the cap for every installed barrel, the same rule when MOA is nondecreasing in the centre of impact. When a negative cap and an accuracy
 *     sum above 100 percent points can meet, each row also carries `+ M_b` on every installed barrel of a strictly larger centre of impact (Phase 2.10).
 *   - objective: weighted `e / 10`, `-r`, `-p / 1000`; Tchebycheff `0.01 c_a` with `c_a = w_a / (sum max(range, 1))`, the deviation rows
 *     `c_a (z_a - f_a)` padded; the coefficients' construction error times the axis magnitudes is `ObjectivePlan.frameError`; an axis whose
 *     coefficient would be filtered is read through `column_n = column / 2^k` (exact; `ObjectivePlan.axisScales`).
 *   - TED: the node's penalty line (a verified lower envelope, see spatial.ts), a node being rows on `weight`, not a tightened column bound.
 *
 * Text hygiene (the native readback of Phase 2.3 checks it, see tests/physical/lpHarness.ts): every name matches [A-Za-z_][A-Za-z0-9_]*
 * (never a `-` before a digit), the first line is exactly `Maximize`, and no matrix entry is at or below HiGHS's small_matrix_value (a positive
 * Big-M is raised to MIN_SURVIVING_COEFFICIENT and a tiny objective axis coefficient is scaled by a power of two, both in `proof.ts`).
 *
 * Solver note (see tests/physical/solverDefects.test.ts): the retired npm `highs` 1.8.0 returned wrong answers and aborted on models of this
 * family. The pinned native build (HiGHS 1.15.1) solves that corpus, but with PRESOLVE ON it still reports some feasible models 'Infeasible' (a
 * 6-row model is kept as a fixture; about 15 pinned-projection solves in 2 x 1,500 random cases); with presolve off it agrees with the reference
 * oracle everywhere tried. An 'Infeasible' answer is therefore never taken from a presolved solve alone: the solve path confirms it with presolve off
 * (nativeSolve.ts, Phase 2.4b-3b).
 */

import type { IdealPoint } from '../../../src/solver/types';
import type { PhysicalBlueprint } from '../../../src/solver/physical/blueprint';
import { computeActiveBounds, type ActiveBounds } from '../../../src/solver/physical/bounds';
import type { SubproblemDomain, SupplyClass } from '../../../src/solver/physical/domain';
import { PhysicalModelError } from '../../../src/solver/physical/errors';
import { LpWriter, mergeTerms, type ColumnDeclaration, type RowSense } from '../../../src/solver/physical/lpText';
import { iAdd, iScale, nextUp, sumEnclosure, type Interval } from '../../../src/solver/physical/numeric';
import {
  EMPTY_MODEL_PROOF, HIGHS_LARGE_MATRIX_VALUE, HIGHS_SMALL_MATRIX_VALUE, differenceEnclosure, gearEnclosure, gearFactor, moaFallbackRow, moaReplacementRow,
  paddedRhs, planObjective, ratEnclosure, rowProof, tchebycheffCoefficients,
  type GearFactor, type ModelProof, type ObjectivePlan, type PaddedRhs, type RowProof, type SecantProof,
} from '../../../src/solver/physical/proof';
import { ratAbs, ratMagnitude, ratRoundUp } from '../../../src/solver/physical/rational';
import { RAT_ZERO, ratAdd, ratFromDouble, ratMax, ratMul, ratSub, ratToNumber, type Rat } from '../../../src/solver/physical/exact';
import { lineEnclosure, secantOfPenalty, type NodePenalty, type PenaltyLine } from '../../../src/solver/physical/spatial';
import {
  ERGO_CLAMP_MAX, ERGO_SCALE, MOA_K, RECOIL_SCALE, checkedNodePenalty,
  type ModelStats, type ObjectiveCoefficient, type ObjectiveMeta, type ProvedEmpty, type SpatialMeta, type SpatialNode, type SpecializeRequest,
} from '../../../src/solver/physical/specialize';

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
  /**
   * Proved upward bound of the construction error of the family's constructed coefficients, in the family's own units: the largest coefficient
   * deficit `sum |a'_i - a_i| B_i` of a padded row, the objective's frame error, the secant's shift in points. Zero for a family whose
   * coefficients are exact binary64 leaves and small integers (the leaf is the model).
   */
  constructionError: number;
  /** The largest outward padding the family's emitted right-hand sides carry beyond their exact targets (at least `constructionError` for a padded row). */
  allowance: number;
}

const FAMILIES: readonly Omit<RowFamilyRecord, 'count' | 'vacuous' | 'constructionError' | 'allowance'>[] = [
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
   * read fails). A tiny objective axis coefficient is scaled exactly (`proof.objective.axisScales`) so this stays false for it; anything else is emitted
   * unchanged, and the solve path reads the model back and compares it with the text before it trusts a solve (`nativeProof.ts`).
   */
  readonly matrixFilterRisk: boolean;
  /** The exact-rational construction record: padded rows, the objective's frame error, the gear factor, the secant, the objective scale. */
  readonly proof: ModelProof;
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
  /** The equipment ergonomics modifier as given (the factor max(0, 1 + modifier) is built exactly in `proof.ts`). */
  gearModifier: number;
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
    gearModifier: number_(request.equipErgoModifier, 'equipErgoModifier') ?? 0,
  };
}

const clampErgo = (x: number): number => Math.min(ERGO_CLAMP_MAX, Math.max(0, x));

// ---------------------------------------------------------------------------------------------
// The model builder
// ---------------------------------------------------------------------------------------------

class Specializer {
  readonly w = new LpWriter();
  readonly families = new Map<RowFamilyId, RowFamilyRecord>(FAMILIES.map(f => [f.id, { ...f, count: 0, vacuous: 0, constructionError: 0, allowance: 0 }]));
  /** Every constructed row with its padded right-hand side (`proof.ts`). */
  readonly rowProofs: RowProof[] = [];
  /** Why a proof input failed at construction, or null. */
  withheld: string | null = null;
  objectivePlan: ObjectivePlan | null = null;
  gear: GearFactor | null = null;
  secantProof: SecantProof | null = null;
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

  /** Write a CONSTRUCTED row with its padded right-hand side, and keep the proof record of it (only when the row is actually written). */
  emitPadded(family: RowFamilyId, name: string, terms: Iterable<readonly [string, number]>, relation: '>=' | '<=', padded: PaddedRhs, detail: string): void {
    const record = this.family(family);
    const before = record.count;
    this.emit(family, name, terms, relation, padded.emitted, detail);
    if (record.count > before) {
      this.rowProofs.push(rowProof(name, family, relation, padded));
      record.constructionError = Math.max(record.constructionError, padded.coefficientError);
      record.allowance = Math.max(record.allowance, padded.allowance);
    }
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
      // The factor f = max(0, 1 + modifier) is built exactly: a representable f is one equality, otherwise the two inequalities
      // low x capped <= gear <= high x capped (the first clamp is never negative), which enclose f x capped for the real f.
      const factor = gearFactor(req.gearModifier);
      this.gear = factor;
      const gear = gearEnclosure(factor, capped);
      const eff: Interval = { lo: clampErgo(gear.lo), hi: clampErgo(gear.hi) };
      this.declareAux('gearErgo', 'gear_ergo', gear.lo, gear.hi);
      this.declareAux('effErgo', 'eff_ergo', eff.lo, eff.hi);
      if (factor.low === factor.high) {
        this.emit('gear_clamp', 'gear_def', [['gear_ergo', 1], ['capped_ergo', -factor.low]], '=', 0, 'gear factor');
      } else {
        this.emit('gear_clamp', 'gear_def_lo', [['gear_ergo', 1], ['capped_ergo', -factor.low]], '>=', 0, 'gear factor (lower neighbour)');
        this.emit('gear_clamp', 'gear_def_hi', [['gear_ergo', 1], ['capped_ergo', -factor.high]], '<=', 0, 'gear factor (upper neighbour)');
        const record = this.family('gear_clamp');
        record.constructionError = Math.max(record.constructionError, ratRoundUp(ratMul(ratSub(ratFromDouble(factor.high), ratFromDouble(factor.low)), ratFromDouble(capped.hi))));
      }
      this.emitClamp('gear_clamp', 'c2', 'gear_ergo', 'eff_ergo', gear, ERGO_CLAMP_MAX);
      const { lo, hi } = this.weightInterval;
      if (lo <= hi) {
        const penalty = this.node?.penalty
          ? checkedNodePenalty(lo, hi, this.node.penalty)
          : secantOfPenalty(lo, hi);
        this.penalty = penalty;
        const ted = differenceEnclosure(eff, lineEnclosure(penalty.line, lo, hi));
        const shift = 'shift' in penalty ? penalty.shift : 0;
        this.secantProof = { kind: penalty.kind, weightMin: lo, weightMax: hi, line: penalty.line, shift, objectiveUnits: null, exact: penalty.exact };
        this.family('ted').constructionError = shift;
        this.family('ted').allowance = shift;
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

  // --- caps ---------------------------------------------------------------------------------

  private emitCaps(): void {
    const { bp, req } = this;
    if (req.maxPrice !== null) this.emit('cap_price', 'lim_price', [['price_axis', 1]], '<=', req.maxPrice, `max price ${req.maxPrice} is below every spend`);
    if (req.minErgonomics !== null) this.emit('cap_ergonomics', 'lim_min_ergo', [['capped_ergo', 1]], '>=', req.minErgonomics, `min ergonomics ${req.minErgonomics}`);
    // final recoil = naked x (1 + modifier sum) <= cap  <=>  naked x modifier <= cap - naked; no division, any sign of naked.
    const nakedV = bp.receiverRecoilVertical;
    const nakedH = bp.receiverRecoilHorizontal;
    const recoilMagnitude = ratMagnitude(this.bounds.recoil.lo, this.bounds.recoil.hi);
    if (req.maxRecoilV !== null) {
      // The coefficient is the leaf itself; only the right-hand side cap - naked is constructed, so it is the smallest double at least the exact value.
      const padded = paddedRhs('<=', ratSub(ratFromDouble(req.maxRecoilV), ratFromDouble(nakedV)), [{ target: ratFromDouble(nakedV), emitted: nakedV, magnitude: recoilMagnitude }]);
      this.emitPadded('cap_recoil', 'lim_recoil_v', [['rec_mod', nakedV]], '<=', padded, `max vertical recoil ${req.maxRecoilV}`);
    }
    if (req.maxRecoilSum !== null) {
      // The coefficient naked V + naked H is the nearest double of the exact sum: its deficit times the modifier range pads the right-hand side.
      const total = ratAdd(ratFromDouble(nakedV), ratFromDouble(nakedH));
      const coefficient = ratToNumber(total);
      const padded = paddedRhs('<=', ratSub(ratFromDouble(req.maxRecoilSum), total), [{ target: total, emitted: coefficient, magnitude: recoilMagnitude }]);
      this.emitPadded('cap_recoil', 'lim_recoil_sum', [['rec_mod', coefficient]], '<=', padded, `max recoil sum ${req.maxRecoilSum}`);
    }
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
    const barrels: number[] = [];
    for (const v of this.activeList) if (bp.templateCenterOfImpact[bp.occTemplate[v]] > 0) barrels.push(v);
    const intrinsic = bp.templateCenterOfImpact[0];
    const coiOf = (v: number): number => bp.templateCenterOfImpact[bp.occTemplate[v]];
    // The oracle prices MOA with the installed barrel of the LARGEST centre of impact. The per-barrel row below states the cap for EVERY installed barrel,
    // which is the same rule exactly when MOA is nondecreasing in the centre of impact (an accuracy sum of at most 100 percent points) or when no cap below
    // zero can be missed. With a negative cap and an accuracy sum that can pass 100 the two differ, so the row of barrel v is relaxed by M_v for every installed
    // barrel of a STRICTLY larger centre of impact (research section 5.7; the same terms as the count model, `specializeFast.ts` emitMoaCertified).
    const dominance = limit < 0 && a.hi > 100 && barrels.some(v => coiOf(v) !== coiOf(barrels[0]));
    for (const v of barrels) {
      const coi = coiOf(v);
      // (c/100) A - M x_b >= c - L - M: the coefficient is the nearest double of coi K/100, M the smallest double dominating the exact need,
      // and the right-hand side is padded by the exact coefficient deficit (proof.ts).
      const plan = moaReplacementRow(coi, limit, a);
      const terms: [string, number][] = [['acc_total', plan.coefficient], [xName(v), -plan.bigM]];
      if (dominance) for (const u of barrels) if (coiOf(u) > coi) terms.push([xName(u), plan.bigM]);
      this.emitPadded('moa', `moa_rep_${v}`, terms, '>=', plan.rhs, `MOA of barrel ${v}`);
    }
    // (c0/100) A + M_fb sum_b x_b >= c0 - L; with no barrel the sum is empty and the row is the unconditional intrinsic one.
    const fallback = moaFallbackRow(intrinsic, limit, a, barrels.length > 0);
    this.emitPadded(
      'moa', 'moa_fallback', [['acc_total', fallback.coefficient], ...this.occurrenceTerms(barrels, fallback.bigM)], '>=', fallback.rhs,
      `intrinsic MOA ${intrinsic * MOA_K} exceeds the cap ${limit}`,
    );
  }

  // --- objective ----------------------------------------------------------------------------

  private emitObjective(ranges: { ergoAxis: Interval; recAxis: Interval; priceAxis: Interval }): ObjectiveMeta {
    const { req } = this;
    const { e, r, p } = req;
    const coefficients: ObjectiveCoefficient[] = [];
    const ergoSource: 'capped_ergo' | 'ted' = this.ergoColumn === 'ted' ? 'ted' : 'capped_ergo';
    // The exact targets, the emitted doubles, the proved frame error and the per-axis power-of-two scales (proof.ts).
    const plan = planObjective({ e, r, p }, req.tchebycheff, { ergo: ranges.ergoAxis, rec: ranges.recAxis, price: ranges.priceAxis });
    this.objectivePlan = plan;
    if (plan.withheld !== null) this.withheld = plan.withheld;
    type AxisColumn = 'ergo_axis' | 'rec_axis' | 'price_axis';
    const axisRange: Record<AxisColumn, Interval> = { ergo_axis: ranges.ergoAxis, rec_axis: ranges.recAxis, price_axis: ranges.priceAxis };
    const nameN: Record<AxisColumn, [string, string]> = { ergo_axis: ['ergoN', 'ergo_n'], rec_axis: ['recN', 'rec_n'], price_axis: ['priceN', 'price_n'] };
    // An axis whose objective coefficient HiGHS would filter is read through `column_n = column / 2^k`: the link row is `column - 2^k column_n = 0`
    // (exact), the objective rows carry `c 2^k` on `column_n`, and the objective itself stays in the oracle's units.
    const readThrough: Record<AxisColumn, { column: string; range: Interval; factor: number }> = {
      ergo_axis: { column: 'ergo_axis', range: ranges.ergoAxis, factor: 1 },
      rec_axis: { column: 'rec_axis', range: ranges.recAxis, factor: 1 },
      price_axis: { column: 'price_axis', range: ranges.priceAxis, factor: 1 },
    };
    for (const scale of plan.axisScales) {
      if (scale.exponent === 0 || scale.withheld !== null) continue;
      const [role, name] = nameN[scale.column];
      const range = axisRange[scale.column];
      // dividing by a power of two is exact (no denormal at these magnitudes), so the enclosure of the scaled column is the scaled enclosure
      const scaled: Interval = { lo: range.lo / scale.factor, hi: range.hi / scale.factor };
      this.declareAux(role, name, scaled.lo, scaled.hi);
      this.emit('objective', `${name}_def`, [[scale.column, 1], [name, -scale.factor]], '=', 0, `${name} definition`);
      readThrough[scale.column] = { column: name, range: scaled, factor: scale.factor };
    }
    const formulas: Record<AxisColumn, string> = req.tchebycheff
      ? { ergo_axis: 'AUGMENTATION c_e', rec_axis: '-AUGMENTATION c_r', price_axis: '-AUGMENTATION c_p' }
      : { ergo_axis: 'e / ERGO_SCALE', rec_axis: '-r', price_axis: '-p / SCALE' };
    const terms: [string, number][] = [['total_obj', 1]];
    let objective: Interval | null = null;
    for (const t of plan.terms) {
      const through = readThrough[t.column];
      const value = t.emitted * through.factor; // an exact product: a power of two
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
      const tRange: Interval = plan.deviations.length === 0
        ? { lo: 0, hi: 0 }
        : ratEnclosure(largest(lows), largest(highs));
      this.declareAux('tch', 'tch_t', tRange.lo, tRange.hi);
      for (const row of rows) this.emitPadded('objective', row.name, row.terms, '>=', row.padded, row.name);
      terms.push(['tch_t', 1]);
      coefficients.push({ column: 'tch_t', value: -1, formula: '-1' });
      objective = iAdd(objective as Interval, { lo: -tRange.hi, hi: -tRange.lo });
    }
    const total = objective as Interval;
    this.declareAux('totalObj', 'total_obj', total.lo, total.hi);
    this.emit('objective', 'obj_def', terms, '=', 0, 'objective definition');
    this.w.setObjective('total_obj');
    const objectiveFamily = this.family('objective');
    objectiveFamily.constructionError = Math.max(objectiveFamily.constructionError, plan.frameError);
    if (this.secantProof !== null) {
      // The secant's shift in TED points, carried through the actual coefficients on TED: the weighted e (= 10 x e/10), or Tchebycheff's
      // 10 c_e (0.01 + the deviation's 1) when ergonomics is active. A shift is an objective effect only when TED is the ergonomics axis.
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
  const families = FAMILIES.map(f => ({ ...f, count: f.id === 'contradiction' ? 1 : 0, vacuous: 0, constructionError: 0, allowance: 0 }));
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
    proof: EMPTY_MODEL_PROOF,
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
    proof: {
      version: 1,
      rows: specializer.rowProofs,
      objective: specializer.objectivePlan,
      gear: specializer.gear === null ? null : { target: specializer.gear.target, low: specializer.gear.low, high: specializer.gear.high },
      secant: specializer.secantProof,
      withheld: specializer.withheld,
    },
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
