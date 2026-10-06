// Gates A, B and C of the Fast count/edge model against the Stage 1 oracle, at the level of FEASIBLE PROJECTIONS (research task: is Fast an exact
// reformulation of the physical domain when the active template graph is acyclic? docs/research/acyclic-fast-exactness.md).
//
// The 2.4c evidence compared optima. These gates are stronger. For one fixture and request, with pi_sel(B) = (base, installed multiset):
//
//   Gate C  Fast has no feasible point exactly when the oracle's feasible set is empty;
//   Gate A  SET EQUALITY of projections, both directions, by two independent procedures:
//             completeness  the Fast model pinned (base, n_t) to EACH oracle projection is feasible;
//             soundness     the feasible (base, n_t) points of the Fast model are ENUMERATED with exact integer no-good cuts over the projection
//                           columns until HiGHS reports infeasible; every point decodes (`decodeFast`) to a rooted tree the oracle's reference
//                           validator accepts, whose projection is the point itself, and lies in the oracle's feasible set; the enumeration
//                           ends with exactly as many points as the oracle has projections;
//   Gate B  POINTWISE objective parity: the best Fast objective over the arrangements (edge counts, whole lots) of every projection equals the
//           oracle's exact score of it; hence the maximum and the full maximizer set agree (a near-tie below the solver tolerance is reported
//           as unresolvable, never as a tie).
//
// Fast is never given TrueErgo or Prevent Overswing (Precise-only), so those cases are out of scope. A case whose ACTIVE template graph (the graph
// `specializeFast` builds, after the domain masks) is cyclic is out of scope too: it is reported, and optionally still run for information.
//
// Differential helper: may import production code (reference/independenceScan.ts); no non-differential file may import this one.

import {
  codeUnitCompare, eq, inspectBuild, projectBuild, projectionKey, resolveFixture, resolveRequest, runOracle, sub, toNumber, validateReference,
  type BaseChoice, type EnumerateOptions, type OracleResult, type ReferenceBuild, type ReferenceFixture, type ReferenceRequest,
} from '../oracle/index';
import {
  appendCuts, buildTemplateGraph, decodeFast, preparePhysicalWeapon, prepareSubproblemDomain, specializeCount, specializeFast,
  type FastModel, type IntegerNoGood, type SpecializeRequest, type SubproblemDomain, type PhysicalBlueprint,
} from '../../src/solver/physical';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import type { SolveParams } from '../../src/solver/types';
import { productionLookup, subproblemRequestOf } from './blueprint.differential';
import { detectUnsupported, mapRequest } from './toProduction.differential';
import { GATE_OPTIONS, objectiveDirections, parseProjectionKey, seedOf, solveText as primarySolve, specializeRequestOf, type Solve } from './lpGates.differential';

// ---------------------------------------------------------------------------------------------
// Solver: the primary setting, with a second opinion on every Infeasible
// ---------------------------------------------------------------------------------------------

/**
 * HiGHS 1.15.1 with presolve OFF (the pinned native build the production Fast path uses) reported a FEASIBLE cut-enumeration model of the
 * research gates "Infeasible" (seed 1032 of the adversarial family; the same model plus a pin on a point it should contain is Optimal). A false
 * Infeasible is the known defect mode of this build (tests/physical/solverDefects/), so the gates never take an Infeasible from one setting:
 * it is cross-checked under other settings and ANY feasible answer wins (a feasible point is decoded and validated by the oracle's validator,
 * so a false feasible cannot slip through).
 */
interface NativeLike {
  getNativeHighs(): {
    solveStructured(lp: string, options?: Record<string, number | boolean | string>): Promise<{
      modelStatus: { name: string };
      objectiveValue: number | null;
      colNames: readonly string[] | null;
      colValues: Float64Array | null;
      readStatus: 'ok' | 'warning';
    }>;
  };
  MODEL_STATUS_TEXT: Readonly<Record<string, string>>;
}
const NATIVE_MODULE = '../../src/solver/native/index.ts';
let nativeApi: NativeLike | null = null;
async function nativeOf(): Promise<NativeLike> {
  nativeApi ??= (await import(NATIVE_MODULE)) as NativeLike;
  return nativeApi;
}

/** Second opinions keep the strict tolerances (a looser one admits near-boundary points the exact arithmetic rejects) and vary the search only. */
const SECOND_OPINIONS: readonly Record<string, number | boolean | string>[] = [
  { ...GATE_OPTIONS, presolve: 'choose' },
  { ...GATE_OPTIONS, random_seed: 11, mip_heuristic_effort: 0.3 },
  { ...GATE_OPTIONS, presolve: 'choose', random_seed: 5, mip_heuristic_effort: 0 },
];

export const checkedSolverStats = { solves: 0, infeasibleChecked: 0, overridden: 0 };

export async function solveText(lp: string): Promise<Solve> {
  checkedSolverStats.solves++;
  const first = await primarySolve(lp);
  if (first.status !== 'Infeasible') return first;
  checkedSolverStats.infeasibleChecked++;
  const api = await nativeOf();
  for (const options of SECOND_OPINIONS) {
    const result = await api.getNativeHighs().solveStructured(lp, options).catch(() => null);
    if (result === null || result.colNames === null || result.colValues === null) continue;
    const status = api.MODEL_STATUS_TEXT[result.modelStatus.name] ?? result.modelStatus.name;
    if (status !== 'Optimal') continue;
    const values: Record<string, number> = {};
    result.colNames.forEach((name, k) => { values[name] = (result.colValues as Float64Array)[k]; });
    checkedSolverStats.overridden++;
    return { status, objective: result.objectiveValue ?? Number.NaN, values, readStatus: result.readStatus };
  }
  return first;
}

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export type Verdict = { status: 'pass' | 'fail' | 'n/a'; detail: string };
const pass = (detail: string): Verdict => ({ status: 'pass', detail });
const fail = (detail: string): Verdict => ({ status: 'fail', detail });
const na = (detail: string): Verdict => ({ status: 'n/a', detail });

/** Why a case is not gated. */
export type SkipKind = 'unsupported' | 'ted' | 'oracle_incomplete' | 'cyclic_active_graph' | 'solver_failure';

/**
 * The production Fast pipeline (`solveFast`: model, native solve, decode, exact validation, cut loop), loaded at run time through a non-literal specifier
 * (it reaches the native loader, which does not typecheck under tsconfig.reference.json: no DOM lib).
 */
interface FastRun {
  kind: 'empty' | 'build' | 'incomplete';
  best?: { score: number; build: { base: { kind: 'naked' } | { kind: 'preset'; presetId: string }; placements: readonly { parentInstanceId: string; slotId: string; childInstanceId: string; itemId: string }[] } };
  optimal?: boolean;
  summary: { rejectedPoints: number; nativeSolves: number; acyclic: boolean };
}
const FAST_MODULE = '../../src/solver/physical/solveFast.ts';
let solveFastFn: ((context: { params: SolveParams; deadline: number; presolve?: 'off' | 'choose' }) => Promise<FastRun>) | undefined;
async function loadSolveFast(): Promise<NonNullable<typeof solveFastFn>> {
  solveFastFn ??= ((await import(FAST_MODULE)) as { solveFast: NonNullable<typeof solveFastFn> }).solveFast;
  return solveFastFn;
}

export interface FastExactnessOptions {
  /**
   * Rewrites the Fast model's LP text before every solve (research on a candidate fix: the production text is never changed). The gates then judge the
   * REWRITTEN model against the oracle. The pinned and enumerated points are cut and decoded as usual.
   */
  lpTransform?: (lpBase: string, model: FastModel) => string;
  /** Also run the production `solveFast` pipeline and compare its answer (kind, optimum, projection) with the oracle's. Ignored for a certified model. */
  productionPath?: boolean;
  /**
   * Judge the CERTIFIABLE count model of Precise (`specializeCount`: built through the proof layer, MOA larger-centre-of-impact rows, eligibility verified on the
   * data, repeats always allowed) instead of the plain Fast model. Its text must equal the oracle without any `lpTransform`, the MOA family included.
   */
  certified?: boolean;
  /** Enumerate Fast's feasible projections completely when the oracle has at most this many; above it, random directions sample instead. */
  maxEnumerate?: number;
  /** Cap on the oracle projections pinned for completeness (all of them when at most this many; every maximizer is always pinned). */
  maxPinned?: number;
  /** Random objective directions used when the enumeration is not complete. */
  randomDirections?: number;
  /** Oracle enumeration caps. */
  oracle?: EnumerateOptions;
  /** Run the gates on a case whose active graph is cyclic (the result is informational, never an exactness claim). */
  includeCyclic?: boolean;
  /** Relative tolerance of the pointwise objective comparison. */
  tolerance?: number;
}

export interface FastExactness {
  id: string;
  skipped: SkipKind | null;
  skipDetail: string;
  /** The ACTIVE template graph is acyclic (`buildTemplateGraph`, after the domain masks). */
  acyclic: boolean;
  /** Request-independent: the whole closure is acyclic (no ancestor edge was ever pruned). */
  closureAcyclic: boolean;
  oracleProjections: number;
  oracleEmpty: boolean;
  fastEmpty: boolean | null;
  /** Fast projections found by the enumeration (before it stopped). */
  fastProjections: number;
  enumerationComplete: boolean;
  /** Fast points decoded and validated by the oracle's reference validator. */
  decodedValidated: number;
  /**
   * Fast points outside the oracle's set whose ONLY violation is a request cap missed by at most BOUNDARY_TOLERANCE (relative): the solver's feasibility
   * tolerance admits them and exact arithmetic does not. That is the numerical layer (the production decoder, exact validator and cut handle it), not a
   * model mismatch; they are counted here and never silently dropped.
   */
  boundaryPoints: number;
  /** The production `solveFast` pipeline against the oracle (kind, exact optimum, a maximizing projection); `n/a` unless requested. */
  productionPath: Verdict;
  /** Points the production pipeline's validator or decoder rejected and cut. */
  productionRejected: number;
  pinnedChecked: number;
  solves: number;
  /** Largest relative pointwise objective difference observed. */
  maxObjectiveDelta: number;
  gateC: Verdict;
  gateAComplete: Verdict;
  gateASound: Verdict;
  gateASetEquality: Verdict;
  gateBPointwise: Verdict;
  gateBMaximizers: Verdict;
  /** Everything that disagreed, in the order found. */
  mismatches: string[];
}

const blankResult = (id: string): FastExactness => ({
  id, skipped: null, skipDetail: '', acyclic: false, closureAcyclic: false, oracleProjections: 0, oracleEmpty: false, fastEmpty: null,
  fastProjections: 0, enumerationComplete: false, decodedValidated: 0, boundaryPoints: 0, productionPath: na('not run'), productionRejected: 0, pinnedChecked: 0, solves: 0, maxObjectiveDelta: 0,
  gateC: na('not run'), gateAComplete: na('not run'), gateASound: na('not run'), gateASetEquality: na('not run'),
  gateBPointwise: na('not run'), gateBMaximizers: na('not run'), mismatches: [],
});

export const GATE_NAMES = ['gateC', 'gateAComplete', 'gateASound', 'gateASetEquality', 'gateBPointwise', 'gateBMaximizers', 'productionPath'] as const;

/** Mapping features the production inputs cannot carry (the same list the Precise gates skip on). */
const SKIPPING_FEATURES = ['flea_player_level_on_base', 'flea_offers_distinct_player_levels', 'non_canonical_trader_name', 'weapon_magazine_capacity'];

// ---------------------------------------------------------------------------------------------
// Projections of Fast points
// ---------------------------------------------------------------------------------------------

export interface FastPoint {
  key: string;
  baseIndex: number;
  base: BaseChoice;
  counts: Map<string, number>;
  /** Solver objective at this point (the best arrangement of the projection among the points the cuts left). */
  objective: number;
}

const roundRead = (value: number | undefined, name: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`column ${name} is missing from the solution`);
  const r = Math.round(value);
  if (Math.abs(value - r) > 1e-6) throw new Error(`column ${name} is not an integer: ${value}`);
  return r;
};

export function readPoint(model: FastModel, values: Readonly<Record<string, number>>, objective: number): FastPoint {
  const { domain, blueprint } = model;
  let baseIndex = -1;
  for (let b = 0; b < domain.bases.length; b++) {
    if (roundRead(values[model.base(b)], model.base(b)) === 1) {
      if (baseIndex >= 0) throw new Error('more than one base selected');
      baseIndex = b;
    }
  }
  if (baseIndex < 0) throw new Error('no base selected');
  const chosen = domain.bases[baseIndex];
  const base: BaseChoice = chosen.kind === 'naked' ? { kind: 'naked' } : { kind: 'preset', presetId: chosen.presetId };
  const counts = new Map<string, number>();
  for (let t = 1; t < blueprint.templateCount; t++) {
    const column = model.count(t);
    if (column === null) continue;
    const n = roundRead(values[column], column);
    if (n > 0) counts.set(blueprint.templateIds[t], n);
  }
  const items = [...counts.entries()].sort((a, b) => codeUnitCompare(a[0], b[0])).map(([itemId, count]) => ({ itemId, count }));
  return { key: projectionKey({ base, items }), baseIndex, base, counts, objective };
}

/**
 * An exact, compact encoding of the PROJECTION columns (the bases and every template count) for no-good cuts. The production `integerNoGood`
 * excludes one integer point with two binaries per interior column, which makes the cut model slow after a few dozen points; here every count
 * column n_t with a range above one gets a one-hot expansion y_{t,v} (n_t = sum v y_{t,v}, sum_v y_{t,v} = 1) declared once, so a cut is a plain
 * binary no-good with one literal per column. The expansion adds columns and rows that only restate n_t, so it removes no point of the model.
 */
export interface ProjectionEncoding {
  /** Rows and binaries to splice in once. */
  setup: IntegerNoGood;
  /** The no-good that excludes the projection read from `values`. */
  cutFor(name: string, values: Readonly<Record<string, number>>): IntegerNoGood;
}

export function projectionEncoding(model: FastModel): ProjectionEncoding {
  const rows: string[] = [];
  const binaries: string[] = [];
  const wide: { t: number; column: string; hi: number }[] = [];
  const narrow: string[] = [];
  for (let b = 0; b < model.domain.bases.length; b++) narrow.push(model.base(b));
  for (let t = 1; t < model.blueprint.templateCount; t++) {
    const column = model.count(t);
    if (column === null) continue;
    const hi = model.graph.maxCopies[t];
    if (hi <= 1) narrow.push(column);
    else wide.push({ t, column, hi });
  }
  const yName = (t: number, v: number): string => `yv_${t}_${v}`;
  for (const { t, column, hi } of wide) {
    const link: string[] = [column];
    const one: string[] = [];
    for (let v = 0; v <= hi; v++) {
      binaries.push(yName(t, v));
      one.push(yName(t, v));
      if (v > 0) link.push(`- ${v} ${yName(t, v)}`);
    }
    rows.push(`  ylink_${t}: ${link.join(' ')} = 0`);
    rows.push(`  yone_${t}: ${one.join(' + ')} = 1`);
  }
  return {
    setup: { row: rows.join('\n'), binaries },
    cutFor(name, values) {
      const positive: string[] = [];
      const negative: string[] = [];
      for (const column of narrow) (roundRead(values[column], column) === 1 ? positive : negative).push(column);
      for (const { t, column } of wide) positive.push(yName(t, roundRead(values[column], column)));
      const terms = [...positive.map((c, i) => (i === 0 ? c : `+ ${c}`)), ...negative.map(c => `- ${c}`)];
      return { row: `  ${name}: ${terms.join(' ')} <= ${positive.length - 1}`, binaries: [] };
    },
  };
}

/** Add rows in front of the Bounds section of an emitted model text. */
export function withRows(lp: string, rows: readonly string[]): string {
  const at = lp.indexOf('\nBounds\n');
  if (at < 0) throw new Error('model text has no Bounds section');
  return `${lp.slice(0, at)}\n${rows.map(r => `  ${r}`).join('\n')}${lp.slice(at)}`;
}

/** Rows that pin the base and every template count of the Fast model to a projection; an unattainable pin is a row no point satisfies. */
export function fastPinRows(model: FastModel, projection: { base: BaseChoice; counts: ReadonlyMap<string, number> }): string[] {
  const { blueprint, domain } = model;
  const rows: string[] = [];
  const baseIndex = domain.bases.findIndex(b => (projection.base.kind === 'naked' ? b.kind === 'naked' : b.kind === 'preset' && b.presetId === (projection.base as { presetId: string }).presetId));
  domain.bases.forEach((_, b) => rows.push(`pin_base_${b}: ${model.base(b)} = ${b === baseIndex ? 1 : 0}`));
  if (baseIndex < 0) rows.push('pin_no_base: 0 total_obj >= 1');
  for (let t = 1; t < blueprint.templateCount; t++) {
    const want = projection.counts.get(blueprint.templateIds[t]) ?? 0;
    const column = model.count(t);
    if (column === null) {
      if (want > 0) rows.push(`pin_impossible_${t}: 0 total_obj >= 1`);
      continue;
    }
    rows.push(`pin_t_${t}: ${column} = ${want}`);
  }
  for (const itemId of projection.counts.keys()) if (blueprint.templateIndexOf(itemId) < 0) rows.push(`pin_unknown_${itemId.replace(/\W/g, '_')}: 0 total_obj >= 1`);
  return rows;
}

const toReferenceBuild = (decoded: { build: { base: { kind: 'naked' } | { kind: 'preset'; presetId: string }; placements: readonly { parentInstanceId: string; slotId: string; childInstanceId: string; itemId: string }[] } }): ReferenceBuild => ({
  base: decoded.build.base.kind === 'naked' ? { kind: 'naked' } : { kind: 'preset', presetId: decoded.build.base.presetId },
  placements: decoded.build.placements.map(p => ({ ...p })),
});

// ---------------------------------------------------------------------------------------------
// The gates of one case
// ---------------------------------------------------------------------------------------------

export interface Prepared {
  blueprint: PhysicalBlueprint;
  domain: SubproblemDomain;
}

export function prepareFor(fixture: ReferenceFixture, request: ReferenceRequest): Prepared {
  const lookup = productionLookup(fixture);
  const blueprint = preparePhysicalWeapon(lookup, request.weapon_id);
  return { blueprint, domain: prepareSubproblemDomain(blueprint, lookup, subproblemRequestOf(request)) };
}

const sampleEvenly = <T>(items: readonly T[], required: (item: T) => boolean, limit: number): T[] => {
  if (items.length <= limit) return [...items];
  const must = items.filter(required);
  const rest = items.filter(i => !required(i));
  const room = Math.max(0, limit - must.length);
  const chosen = new Set<T>(must);
  for (let k = 0; k < room && rest.length > 0; k++) chosen.add(rest[Math.floor((k * rest.length) / room)]);
  return items.filter(i => chosen.has(i));
};

/**
 * A candidate fix for the one model deviation the gates found (see the report, section "MOA with several barrels"): `moa_rep_t` states "the MOA of barrel t is
 * within the cap" for EVERY installed barrel, while the oracle uses only the barrel with the LARGEST centre of impact. They agree when the accuracy sum is at
 * most 100 percent points (the MOA of a barrel then grows with its centre of impact), and disagree above it. The fix relaxes the row of barrel t by the presence
 * of every barrel whose centre of impact is strictly larger: its right-hand side is already padded by the big-M, so the relaxation adds +M on the presence
 * column of each dominating barrel. It rewrites the LP TEXT of the research run; no production file is touched.
 */
export function moaDominanceFix(lpBase: string, model: FastModel): string {
  const { blueprint, graph } = model;
  const presence = (t: number): string => (graph.maxCopies[t] === 1 ? `n_${t}` : `z_${t}`);
  const barrels: number[] = [];
  for (let t = 1; t < blueprint.templateCount; t++) if (graph.active[t] && blueprint.templateCenterOfImpact[t] > 0) barrels.push(t);
  return lpBase.replace(/^( {2}moa_rep_(\d+): )(.*?)( >= )(\S+)$/gm, (line, head: string, id: string, terms: string, ge: string, rhs: string) => {
    const t = Number(id);
    const own = new RegExp(`- (\\S+) ${presence(t)}(?= |$)`).exec(terms);
    if (own === null) return line;
    const bigM = own[1];
    const dominating = barrels.filter(b => blueprint.templateCenterOfImpact[b] > blueprint.templateCenterOfImpact[t]);
    if (dominating.length === 0) return line;
    return `${head}${terms}${dominating.map(b => ` + ${bigM} ${presence(b)}`).join('')}${ge}${rhs}`;
  });
}

/** Relative size below which a missed cap is attributed to the solver's feasibility tolerance. */
export const BOUNDARY_TOLERANCE = 1e-7;

/** The oracle's violation codes that state a request cap on one build statistic. */
const CAP_CODES = new Set([
  'MAX_PRICE_EXCEEDED', 'MIN_ERGONOMICS_NOT_MET', 'MAX_RECOIL_V_EXCEEDED', 'MAX_RECOIL_SUM_EXCEEDED', 'MIN_MAGAZINE_NOT_MET', 'MIN_SIGHTING_NOT_MET',
  'MAX_WEIGHT_EXCEEDED', 'MAX_MOA_EXCEEDED',
]);

/** True when every violation of the build is a cap missed by at most the boundary tolerance (relative to the cap). */
export function isToleranceBoundary(fixture: ReferenceFixture, request: ReferenceRequest, build: ReferenceBuild): boolean {
  const { violations, stats } = inspectBuild(resolveFixture(fixture), resolveRequest(fixture, request), build);
  if (violations.length === 0 || stats === null) return false;
  if (!violations.every(v => CAP_CODES.has(v.code))) return false;
  const miss = (code: string): number => {
    const r = request;
    switch (code) {
      case 'MAX_PRICE_EXCEEDED': return toNumber(stats.spend) - (r.max_price as number);
      case 'MIN_ERGONOMICS_NOT_MET': return (r.min_ergonomics as number) - toNumber(stats.ergonomics);
      case 'MAX_RECOIL_V_EXCEEDED': return toNumber(stats.recoilVertical) - (r.max_recoil_v as number);
      case 'MAX_RECOIL_SUM_EXCEEDED': return toNumber(stats.recoilVertical) + toNumber(stats.recoilHorizontal) - (r.max_recoil_sum as number);
      case 'MIN_MAGAZINE_NOT_MET': return (r.min_mag_capacity as number) - toNumber(stats.magazineCapacity);
      case 'MIN_SIGHTING_NOT_MET': return (r.min_sighting_range as number) - toNumber(stats.sightingRange);
      case 'MAX_WEIGHT_EXCEEDED': return toNumber(stats.weight) - (r.max_weight as number);
      case 'MAX_MOA_EXCEEDED': return toNumber(stats.moa) - (r.max_moa as number);
      default: return Number.POSITIVE_INFINITY;
    }
  };
  const capOf = (code: string): number => {
    const r = request;
    const value = { MAX_PRICE_EXCEEDED: r.max_price, MIN_ERGONOMICS_NOT_MET: r.min_ergonomics, MAX_RECOIL_V_EXCEEDED: r.max_recoil_v, MAX_RECOIL_SUM_EXCEEDED: r.max_recoil_sum,
      MIN_MAGAZINE_NOT_MET: r.min_mag_capacity, MIN_SIGHTING_NOT_MET: r.min_sighting_range, MAX_WEIGHT_EXCEEDED: r.max_weight, MAX_MOA_EXCEEDED: r.max_moa }[code as 'MAX_PRICE_EXCEEDED'];
    return typeof value === 'number' ? value : 0;
  };
  return violations.every(v => miss(v.code) <= BOUNDARY_TOLERANCE * Math.max(1, Math.abs(capOf(v.code))));
}

export async function runFastExactness(id: string, fixture: ReferenceFixture, request: ReferenceRequest, options: FastExactnessOptions = {}): Promise<FastExactness> {
  const out = blankResult(id);
  const skip = (kind: SkipKind, detail: string): FastExactness => ({ ...out, skipped: kind, skipDetail: detail });
  if (request.use_true_ergo === true || request.prevent_overswing === true) return skip('ted', 'TrueErgo and Prevent Overswing are Precise-only');
  const unsupported = detectUnsupported(fixture, request).filter(f => SKIPPING_FEATURES.includes(f.feature));
  if (unsupported.length > 0) return skip('unsupported', unsupported.map(f => f.feature).join(', '));

  const oracle: OracleResult = runOracle(fixture, request, options.oracle ?? { maxBuilds: 60_000 });
  if (!oracle.complete) return skip('oracle_incomplete', 'the oracle enumeration hit its cap');
  out.oracleProjections = oracle.projections.length;
  out.oracleEmpty = oracle.empty;

  const { blueprint, domain } = prepareFor(fixture, request);
  out.closureAcyclic = blueprint.stats.prunedAncestorEdges === 0;
  if (!domain.empty) out.acyclic = buildTemplateGraph(blueprint, domain).acyclic;
  else out.acyclic = true; // an empty domain has no graph: nothing to be cyclic
  if (!out.acyclic && options.includeCyclic !== true) return skip('cyclic_active_graph', 'the active template graph has a cycle');

  const tolerance = options.tolerance ?? 1e-7;
  const requestFast = specializeRequestOf(request);
  const specialize = (req: SpecializeRequest): FastModel => (options.certified === true ? specializeCount(blueprint, domain, req) : specializeFast(blueprint, domain, req));
  const model = specialize(requestFast);
  const baseLp = options.lpTransform ? options.lpTransform(model.lpBase, model) : model.lpBase;
  const notes = out.mismatches;

  // --- Gate C -------------------------------------------------------------------------------------
  if (domain.empty || model.provedEmpty !== null) {
    out.fastEmpty = true;
    out.gateC = oracle.empty ? pass(`both empty (${domain.empty ? 'domain' : 'request'})`) : fail(`Fast is proved empty (${model.provedEmpty?.source}: ${model.provedEmpty?.reasons.join('; ')}) but the oracle has ${oracle.projections.length} feasible projection(s)`);
    if (!oracle.empty) notes.push(String(out.gateC.detail));
    out.gateAComplete = oracle.empty ? na('empty') : fail('Fast is empty');
    out.gateASound = na('empty');
    out.gateASetEquality = oracle.empty ? pass('both empty') : fail('Fast empty, oracle not');
    out.gateBPointwise = na('empty');
    out.gateBMaximizers = na('empty');
    return out;
  }

  // --- enumeration of Fast's feasible projections -------------------------------------------------
  const maxEnumerate = options.maxEnumerate ?? 400;
  const complete = oracle.projections.length <= maxEnumerate;
  const oracleScore = new Map(oracle.projections.map(p => [p.key, toNumber(p.score)]));
  const points: FastPoint[] = [];
  const outsiders: string[] = [];
  const boundaryKeys = new Set<string>();
  const undecodable: string[] = [];
  let decodedValidated = 0;
  let anomalies = 0;
  const encoding = projectionEncoding(model);
  const cuts: IntegerNoGood[] = [encoding.setup];
  const checkPoint = (point: FastPoint, values: Readonly<Record<string, number>>, label: string): void => {
    const inOracle = oracleScore.has(point.key);
    const decoded = decodeFast(model, values);
    if (!decoded.ok) {
      undecodable.push(`${label}: ${point.key} does not decode (${decoded.reason})`);
      return;
    }
    const build = toReferenceBuild(decoded);
    const verdict = validateReference(fixture, request, build);
    if (!verdict.ok) {
      if (!inOracle && isToleranceBoundary(fixture, request, build)) {
        out.boundaryPoints++;
        boundaryKeys.add(point.key);
        return;
      }
      undecodable.push(`${label}: ${point.key} decodes to a build the oracle validator rejects: ${verdict.violations.map(v => `${v.code}(${v.detail})`).slice(0, 3).join(', ')}`);
      return;
    }
    const key = projectionKey(projectBuild(build));
    if (key !== point.key) {
      undecodable.push(`${label}: the decoded build projects to ${key}, not ${point.key}`);
      return;
    }
    if (!inOracle) {
      outsiders.push(`${label}: ${point.key} is accepted by the validator but is not an oracle projection`);
      return;
    }
    decodedValidated++;
  };

  if (complete) {
    const limit = oracle.projections.length + 12;
    for (let k = 0; k <= limit; k++) {
      const solved = await solveText(appendCuts(baseLp, cuts));
      out.solves++;
      if (solved.status === 'Infeasible') {
        out.enumerationComplete = true;
        break;
      }
      if (solved.status !== 'Optimal') {
        anomalies++;
        notes.push(`enumeration solve ${k}: solver status ${solved.status}`);
        break;
      }
      const point = readPoint(model, solved.values, solved.objective);
      points.push(point);
      checkPoint(point, solved.values, `point ${k}`);
      cuts.push(encoding.cutFor(`ng${k}`, solved.values));
    }
  } else {
    // Too many projections to enumerate: deterministic random objective directions sample the vertices.
    const seen = new Set<string>();
    for (const weights of objectiveDirections(seedOf(id), options.randomDirections ?? 6)) {
      const m = specialize(specializeRequestOf(request, weights));
      const solved = await solveText(options.lpTransform ? options.lpTransform(m.lpBase, m) : m.lpBase);
      out.solves++;
      if (solved.status !== 'Optimal') {
        if (solved.status !== 'Infeasible') notes.push(`direction ${JSON.stringify(weights)}: solver status ${solved.status}`);
        continue;
      }
      const point = readPoint(m, solved.values, solved.objective);
      if (seen.has(point.key)) continue;
      seen.add(point.key);
      points.push(point);
      checkPoint(point, solved.values, `direction ${JSON.stringify(weights)}`);
    }
  }
  out.fastProjections = points.length;
  out.decodedValidated = decodedValidated;

  const firstSolveEmpty = points.length === 0 && out.enumerationComplete;
  out.fastEmpty = complete ? firstSolveEmpty : points.length === 0;

  // --- Gate C ---------------------------------------------------------------------------------------
  const onlyBoundary = points.length > 0 && points.every(p => boundaryKeys.has(p.key));
  if (anomalies > 0) out.gateC = fail('a solver anomaly stopped the enumeration');
  else if (oracle.empty && onlyBoundary) out.gateC = na(`the oracle is empty; every one of Fast's ${points.length} point(s) misses a cap by less than the solver tolerance`);
  else if (out.fastEmpty !== oracle.empty) {
    out.gateC = fail(oracle.empty ? `the oracle is empty but Fast has ${points.length} point(s)` : 'Fast is infeasible but the oracle has feasible projections');
    notes.push(String(out.gateC.detail));
  } else out.gateC = pass(oracle.empty ? 'both empty' : 'both nonempty');

  // --- Gate A soundness -----------------------------------------------------------------------------
  const unsound = [...outsiders, ...undecodable];
  out.gateASound = unsound.length === 0 ? pass(`${decodedValidated} Fast point(s) decoded to oracle-validated builds with the same projection${out.boundaryPoints > 0 ? `; ${out.boundaryPoints} more miss a cap by less than the solver tolerance` : ''}`) : fail(unsound.slice(0, 3).join(' | '));
  for (const m of unsound.slice(0, 5)) notes.push(`soundness: ${m}`);

  // --- Gate A completeness: pin every oracle projection ---------------------------------------------
  const maximizerKeys = new Set(oracle.maximizers);
  const pinned = sampleEvenly(oracle.projections, p => maximizerKeys.has(p.key), options.maxPinned ?? 400);
  const pinFailures: string[] = [];
  const pinnedValue = new Map<string, number>();
  for (const record of pinned) {
    const solved = await solveText(withRows(baseLp, fastPinRows(model, parseProjectionKey(record.key))));
    out.solves++;
    out.pinnedChecked++;
    if (solved.status !== 'Optimal') {
      pinFailures.push(`${record.key}: the pinned Fast model is ${solved.status}`);
      continue;
    }
    pinnedValue.set(record.key, solved.objective);
  }
  out.gateAComplete = pinFailures.length === 0 ? pass(`${pinned.length} of ${oracle.projections.length} oracle projection(s) are feasible when pinned in Fast`) : fail(pinFailures.slice(0, 3).join(' | '));
  for (const m of pinFailures.slice(0, 5)) notes.push(`completeness: ${m}`);

  // --- Gate A set equality (needs the complete enumeration) -------------------------------------------
  if (complete && out.enumerationComplete) {
    const fastKeys = new Set(points.map(p => p.key));
    const missing = oracle.projectionKeys.filter(k => !fastKeys.has(k));
    const extra = points.map(p => p.key).filter(k => !oracleScore.has(k) && !boundaryKeys.has(k));
    const dup = points.length - fastKeys.size;
    if (missing.length === 0 && extra.length === 0 && dup === 0) out.gateASetEquality = pass(`${points.length - boundaryKeys.size} = ${oracle.projections.length} projection(s), equal as sets${boundaryKeys.size > 0 ? ` (plus ${boundaryKeys.size} tolerance-boundary point(s))` : ''}`);
    else {
      out.gateASetEquality = fail(`${missing.length} oracle projection(s) never enumerated, ${extra.length} Fast projection(s) outside the oracle set, ${dup} duplicate(s)`);
      notes.push(`set equality: missing ${JSON.stringify(missing.slice(0, 2))}; extra ${JSON.stringify(extra.slice(0, 2))}`);
    }
  } else out.gateASetEquality = na(complete ? 'the enumeration did not finish' : `more than ${maxEnumerate} oracle projections: sampled by directions, pinned for completeness`);

  // --- Gate B pointwise: the best arrangement of every projection scores the oracle's exact score ---------
  const deltas: string[] = [];
  let worst = 0;
  const fastValue = new Map<string, number>();
  for (const [key, value] of pinnedValue) fastValue.set(key, value);
  for (const point of points) if (!fastValue.has(point.key) && oracleScore.has(point.key) && complete) fastValue.set(point.key, point.objective);
  for (const [key, value] of fastValue) {
    const expected = oracleScore.get(key);
    if (expected === undefined) continue;
    const delta = Math.abs(value - expected) / Math.max(1, Math.abs(expected));
    worst = Math.max(worst, delta);
    if (delta > tolerance) deltas.push(`${key}: Fast ${value} vs oracle ${expected}`);
  }
  out.maxObjectiveDelta = worst;
  out.gateBPointwise = deltas.length === 0 ? pass(`${fastValue.size} projection objective(s) equal the oracle score (max relative delta ${worst.toExponential(2)})`) : fail(deltas.slice(0, 3).join(' | '));
  for (const m of deltas.slice(0, 5)) notes.push(`objective: ${m}`);

  // --- Gate B maximum and maximizer set ------------------------------------------------------------------
  if (oracle.empty || oracle.maxScore === null) out.gateBMaximizers = na('empty');
  else {
    const best = toNumber(oracle.maxScore);
    // the runner-up gap decides whether a float comparison can separate tie from non-tie
    let gap = Infinity;
    for (const p of oracle.projections) {
      // the exact separation of the runner-up (doubles can round two distinct exact scores to one value)
      if (!eq(p.score, oracle.maxScore)) gap = Math.min(gap, toNumber(sub(oracle.maxScore, p.score)));
    }
    const slack = tolerance * Math.max(1, Math.abs(best));
    const fastBestKey = [...fastValue.entries()].reduce<[string, number] | null>((a, e) => (a === null || e[1] > a[1] ? e : a), null);
    if (fastBestKey === null) out.gateBMaximizers = fail('no Fast value to compare');
    else if (Math.abs(fastBestKey[1] - best) > slack) {
      out.gateBMaximizers = fail(`Fast maximum ${fastBestKey[1]} differs from the oracle maximum ${best}`);
      notes.push(String(out.gateBMaximizers.detail));
    } else if (gap <= 10 * slack) out.gateBMaximizers = na(`maximum equal; the runner-up gap ${gap.toExponential(2)} is below the float resolution, ties are not decided`);
    else {
      const fastMax = new Set([...fastValue.entries()].filter(([, v]) => v >= best - slack).map(([k]) => k));
      const sameSet = fastMax.size === maximizerKeys.size && [...maximizerKeys].every(k => fastMax.has(k));
      const coveredAll = pinned.length === oracle.projections.length;
      out.gateBMaximizers = sameSet ? pass(`maximum ${best}; ${maximizerKeys.size} maximizer(s) equal`) : coveredAll ? fail(`maximizer sets differ: oracle ${maximizerKeys.size}, Fast ${fastMax.size}`) : na('not every projection was valued');
      if (out.gateBMaximizers.status === 'fail') notes.push(String(out.gateBMaximizers.detail));
    }
  }
  if (options.productionPath === true && options.certified !== true) await productionPathGate(fixture, request, oracle, out, tolerance);
  return out;
}

async function productionPathGate(fixture: ReferenceFixture, request: ReferenceRequest, oracle: OracleResult, out: FastExactness, tolerance: number): Promise<void> {
  const lookup = productionLookup(fixture);
  // The full count model (repeats allowed): production's Fast default is one copy per part (owner decision 2c), which this gate does not describe.
  const params: SolveParams = { ...mapRequest(request), weaponId: request.weapon_id, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(request.weapon_id, lookup), allowRepeatedParts: true };
  const saved = { error: console.error, warn: console.warn, log: console.log };
  let run: FastRun;
  try {
    console.error = console.warn = console.log = () => {};
    run = await (await loadSolveFast())({ params, deadline: performance.now() + 120_000, presolve: 'off' });
  } catch (error) {
    out.productionPath = fail(`solveFast threw: ${error instanceof Error ? error.message : String(error)}`);
    out.mismatches.push(String(out.productionPath.detail));
    return;
  } finally {
    console.error = saved.error;
    console.warn = saved.warn;
    console.log = saved.log;
  }
  out.productionRejected = run.summary.rejectedPoints;
  if (oracle.empty) {
    out.productionPath = run.kind === 'build' ? (out.boundaryPoints > 0 ? na('the oracle is empty; Fast published a tolerance-boundary build, which the exact validator accepted') : fail('Fast published a build for a request the oracle proves empty')) : pass(`both empty (Fast: ${run.kind})`);
  } else if (run.kind !== 'build' || run.best === undefined) {
    out.productionPath = fail(`the oracle has ${oracle.projections.length} projection(s) and solveFast returned ${run.kind}`);
  } else {
    const best = toNumber(oracle.maxScore as NonNullable<typeof oracle.maxScore>);
    const build = toReferenceBuild({ build: run.best.build });
    const verdict = validateReference(fixture, request, build);
    const key = projectionKey(projectBuild(build));
    const slack = tolerance * Math.max(1, Math.abs(best));
    if (!verdict.ok) out.productionPath = fail(`the published build is rejected by the oracle validator: ${verdict.violations.map(v => v.code).join(', ')}`);
    else if (Math.abs(run.best.score - best) > slack) out.productionPath = fail(`Fast score ${run.best.score} differs from the oracle maximum ${best}`);
    else if (!(oracle.projections.find(p => p.key === key) !== undefined && Math.abs(toNumber((oracle.projections.find(p => p.key === key) as { score: Parameters<typeof toNumber>[0] }).score) - best) <= slack)) out.productionPath = fail(`the published projection ${key} is not a maximizer`);
    else out.productionPath = run.optimal === true ? pass(`optimal, score ${run.best.score}, ${run.summary.rejectedPoints} rejected point(s), ${run.summary.nativeSolves} native solve(s)`) : fail('the solve was not optimal');
  }
  if (out.productionPath.status === 'fail') out.mismatches.push(`production path: ${out.productionPath.detail}`);
}

// ---------------------------------------------------------------------------------------------
// Tally
// ---------------------------------------------------------------------------------------------

export interface Tally {
  cases: number;
  gated: number;
  skipped: Record<string, number>;
  empty: number;
  nonEmpty: number;
  /** Cases whose closure has a cycle that the masks removed from the active graph. */
  closureCyclicActiveAcyclic: number;
  oracleProjections: number;
  fastProjections: number;
  decodedValidated: number;
  boundaryPoints: number;
  pinnedChecked: number;
  solves: number;
  maxObjectiveDelta: number;
  gate: Record<(typeof GATE_NAMES)[number], { pass: number; fail: number; na: number }>;
  failures: { id: string; gate: string; detail: string }[];
}

export function newTally(): Tally {
  const gate = Object.fromEntries(GATE_NAMES.map(g => [g, { pass: 0, fail: 0, na: 0 }])) as Tally['gate'];
  return {
    cases: 0, gated: 0, skipped: {}, empty: 0, nonEmpty: 0, closureCyclicActiveAcyclic: 0, oracleProjections: 0, fastProjections: 0,
    decodedValidated: 0, boundaryPoints: 0, pinnedChecked: 0, solves: 0, maxObjectiveDelta: 0, gate, failures: [],
  };
}

export function addToTally(tally: Tally, r: FastExactness): void {
  tally.cases++;
  tally.solves += r.solves;
  if (r.skipped !== null) {
    tally.skipped[r.skipped] = (tally.skipped[r.skipped] ?? 0) + 1;
    return;
  }
  tally.gated++;
  if (r.oracleEmpty) tally.empty++;
  else tally.nonEmpty++;
  if (!r.closureAcyclic && r.acyclic) tally.closureCyclicActiveAcyclic++;
  tally.oracleProjections += r.oracleProjections;
  tally.fastProjections += r.fastProjections;
  tally.decodedValidated += r.decodedValidated;
  tally.boundaryPoints += r.boundaryPoints;
  tally.pinnedChecked += r.pinnedChecked;
  tally.maxObjectiveDelta = Math.max(tally.maxObjectiveDelta, r.maxObjectiveDelta);
  for (const g of GATE_NAMES) {
    const verdict = r[g];
    if (verdict.status === 'pass') tally.gate[g].pass++;
    else if (verdict.status === 'fail') {
      tally.gate[g].fail++;
      tally.failures.push({ id: r.id, gate: g, detail: verdict.detail });
    } else tally.gate[g].na++;
  }
}

export function formatTally(label: string, tally: Tally): string {
  const gates = GATE_NAMES.map(g => `${g} ${tally.gate[g].pass}/${tally.gate[g].pass + tally.gate[g].fail}`).join(', ');
  const skipped = Object.entries(tally.skipped).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
  return `${label}: ${tally.cases} cases, ${tally.gated} gated (${tally.nonEmpty} nonempty, ${tally.empty} empty; ${tally.closureCyclicActiveAcyclic} with a cyclic closure but acyclic active graph), skipped: ${skipped}; `
    + `oracle projections ${tally.oracleProjections}, Fast points enumerated ${tally.fastProjections}, decoded and validated ${tally.decodedValidated} (+${tally.boundaryPoints} tolerance-boundary), pinned ${tally.pinnedChecked}; `
    + `max objective delta ${tally.maxObjectiveDelta.toExponential(2)}; HiGHS solves ${tally.solves}; ${gates}`;
}
