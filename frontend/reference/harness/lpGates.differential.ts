// Model-level gates of the physical LP (Stage 2, phase 2.4b-2) against the Stage 1 oracle.
//
// For one ledger case this builds blueprint -> domain -> `specializeLP`, solves the emitted text with the Node `highs` package, decodes
// with `decodeSolution` and checks the three gates of ADR 0010 section 3 on the case's exhaustive fixture:
//
//   Gate C  the model is infeasible exactly when the oracle's feasible set is empty;
//   Gate B  the optimal objective equals the oracle's exact maximum within the case tolerance; the decoded build is accepted by the reference
//           validator and its projection is a maximizer; EVERY oracle maximizer projection is attainable (the model pinned to that projection
//           is feasible at the maximum);
//   Gate A  completeness: every oracle feasible projection is model-feasible when pinned; soundness: under several deterministic
//           pseudo-random objective directions every decoded projection is oracle-feasible and validator-accepted.
//
// TED and Prevent Overswing (phase 2.4b-3 owns the spatial search) are gated EXACTLY without the search: the model is exact on a singleton
// weight node, so the structural weights the fixture can take (the distinct total weights of every enumerated tree, feasible or not) are
// enumerated as singleton nodes, each solved exactly, and the answer is the union over nodes. The nodes come from the oracle's structural
// builds, which is test-side knowledge a solver does not have.
//
// Differential helper: may import production code (reference/independenceScan.ts); no non-differential file may import this one.

import {
  add, enumerateBuilds, fromBinary64, inspectBuild, mul, parseQ, projectBuild, projectionKey, resolveFixture, resolveRequest, roundHalfUp, runOracle,
  toNumber, validateReference, ZERO,
  type BaseChoice, type ReferenceBuild, type ReferenceFixture, type ReferenceRequest,
} from '../oracle/index';
import {
  decodeSolution, preparePhysicalWeapon, prepareSubproblemDomain, specializeLP,
  type DecodedBuild, type SpatialNode, type SpecializedModel, type SpecializeRequest,
} from '../../src/solver/physical';
import type { ItemLookup, OfferInfo } from '../../src/solver/types';
import type { LedgerCase } from '../ledger/index';
import { detectUnsupported } from './toProduction.differential';
import { productionLookup, subproblemRequestOf, type ProductionPhysical } from './blueprint.differential';

// ---------------------------------------------------------------------------------------------
// HiGHS: the pinned native build (Phase 2.3), full-precision primals
// ---------------------------------------------------------------------------------------------

/**
 * The slice of `src/solver/native` the gates use. It is declared here and the module is loaded through a non-literal specifier because
 * tsconfig.reference.json has no DOM lib and the native loader needs the `WebAssembly` types (the same device as
 * reference/source/extractors.differential.test.ts uses for dataService.ts): tsc does not follow the import, the runtime loads the real module.
 */
interface ExpectedLike {
  sense: 'min' | 'max';
  columns: { name: string }[];
  rows: { name: string }[];
}
interface NativeApi {
  getNativeHighs(): {
    solveStructured(lp: string, options?: Record<string, number | boolean | string>): Promise<{
      modelStatus: { name: string };
      objectiveValue: number | null;
      colNames: readonly string[] | null;
      colValues: Float64Array | null;
      readStatus: 'ok' | 'warning';
    }>;
  };
  readbackModel(lp: string, options?: Record<string, number | boolean | string>): Promise<{ readStatus: 'ok' | 'warning'; readMessages: readonly string[] }>;
  parseLpText(text: string): ExpectedLike;
  compareReadback(expected: ExpectedLike, readback: unknown): { ok: boolean; counts: Record<string, number>; differences: readonly unknown[] };
  MODEL_STATUS_TEXT: Readonly<Record<string, string>>;
}
const NATIVE_MODULE = '../../src/solver/native/index.ts';
let nativeApi: NativeApi | null = null;
async function native(): Promise<NativeApi> {
  nativeApi ??= (await import(NATIVE_MODULE)) as NativeApi;
  return nativeApi;
}

/**
 * Tight tolerances: the emitted text carries exact coefficients and the gates compare at 1e-9. The gates solve on the PINNED native build
 * (HiGHS 1.15.1, `src/solver/native`) with PRESOLVE OFF. Neither HiGHS is a sound reference solver with presolve on: the npm `highs` 1.8.0 the
 * gates were first written against gave wrong 'Optimal' values, false 'Infeasible' and WASM aborts, and the pinned 1.15.1 still reports a feasible
 * 6-row model 'Infeasible' with ALL default options (tests/physical/solverDefects.test.ts keeps the models; in the 2 x 1,500 random cases about
 * 15 pinned-projection solves hit it). The gates validate the MODEL against the oracle, so they use the setting that adds no errors of its own;
 * LP_GATE_PRESOLVE=choose reruns them with presolve on. What the production solve path must do about an Infeasible answer is for Phase 2.7.
 */
export const GATE_OPTIONS: Record<string, number | boolean | string> = {
  mip_rel_gap: 0,
  mip_abs_gap: 1e-9,
  mip_feasibility_tolerance: 1e-9,
  primal_feasibility_tolerance: 1e-9,
  dual_feasibility_tolerance: 1e-9,
  time_limit: 60,
  presolve: process.env.LP_GATE_PRESOLVE ?? 'off',
};

export interface Solve {
  /** HiGHS's model status text: `Optimal`, `Infeasible`, ... */
  status: string;
  /** NaN when HiGHS holds no primal solution. */
  objective: number;
  /** Full-precision column values by name (empty without a primal solution). */
  values: Record<string, number>;
  /** `warning`: HiGHS adjusted the model while reading it (dropped small entries, infinite bounds). */
  readStatus: 'ok' | 'warning';
}

/** Statuses that say HiGHS itself failed (not that the model is infeasible, unbounded or out of time): worth one more try with another setting. */
const FAILURE_STATUSES = new Set(['NotSet', 'LoadError', 'ModelError', 'PresolveError', 'SolveError', 'PostsolveError', 'Unknown']);

/** Settings tried, in order, after the primary one failed explicitly; an answer is never second-guessed, only a failure is retried. */
const FALLBACK_OPTIONS: readonly Record<string, number | boolean | string>[] = [
  { ...GATE_OPTIONS, presolve: 'choose' },
  { ...GATE_OPTIONS, mip_feasibility_tolerance: 1e-8 },
];

/** How many solves needed a fallback setting after an explicit HiGHS failure (reported by the tests). */
export const solverStats = { solves: 0, fallbacks: 0 };

export async function solveText(lp: string): Promise<Solve> {
  const api = await native();
  solverStats.solves++;
  let result = await api.getNativeHighs().solveStructured(lp, GATE_OPTIONS).catch((e: unknown) => e as Error);
  for (const options of FALLBACK_OPTIONS) {
    const failed = result instanceof Error || FAILURE_STATUSES.has(result.modelStatus.name);
    if (!failed) break;
    solverStats.fallbacks++;
    result = await api.getNativeHighs().solveStructured(lp, options).catch((e: unknown) => e as Error);
  }
  if (result instanceof Error) throw result;
  const values: Record<string, number> = {};
  if (result.colNames !== null && result.colValues !== null) result.colNames.forEach((name, k) => { values[name] = (result.colValues as Float64Array)[k]; });
  return {
    status: api.MODEL_STATUS_TEXT[result.modelStatus.name] ?? result.modelStatus.name,
    objective: result.objectiveValue ?? Number.NaN,
    values,
    readStatus: result.readStatus,
  };
}

/** Names HiGHS's LP reader tokenizes as one name: a letter or underscore, then letters, digits and underscores (never a `-` before a digit). */
const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Round-trip of an emitted model through both readers: `parseLpText` (strict, HiGHS-independent: it throws outside the supported subset)
 * and the model HiGHS actually read back, compared coefficient by coefficient, bound by bound, integrality by integrality. Returns the
 * problems; an empty list means HiGHS solves the model the text says (no dropped coefficient, no infinite bound, no tokenizer surprise).
 */
export async function textIssues(model: SpecializedModel): Promise<string[]> {
  const issues: string[] = [];
  if (model.lp.split('\n', 1)[0] !== 'Maximize') issues.push('the text does not start with exactly `Maximize`');
  const api = await native();
  let expected: ExpectedLike;
  try {
    expected = api.parseLpText(model.lp);
  } catch (e) {
    return [...issues, `parseLpText: ${e instanceof Error ? e.message : String(e)}`];
  }
  for (const column of expected.columns) if (!SAFE_NAME.test(column.name)) issues.push(`column name ${column.name}`);
  for (const row of expected.rows) if (!SAFE_NAME.test(row.name)) issues.push(`row name ${row.name}`);
  if (expected.sense !== 'max') issues.push(`parsed sense ${expected.sense}`);
  const readback = await api.readbackModel(model.lp, GATE_OPTIONS);
  if (readback.readStatus !== 'ok') issues.push(`HiGHS read the model with warnings: ${readback.readMessages.join(' | ').slice(0, 200)}`);
  const comparison = api.compareReadback(expected, readback);
  if (!comparison.ok) issues.push(`HiGHS read a different model: ${JSON.stringify(comparison.counts)}; first ${JSON.stringify(comparison.differences[0])}`);
  return issues;
}

// ---------------------------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------------------------

/** The unsupported features that change what the production lookup or the receiver can say (see blueprint.differential.ts). */
const SKIPPING_FEATURES = ['flea_player_level_on_base', 'flea_offers_distinct_player_levels', 'non_canonical_trader_name', 'weapon_magazine_capacity'];

export function skipReasons(c: LedgerCase): string[] {
  return detectUnsupported(c.fixture, c.request).filter(f => SKIPPING_FEATURES.includes(f.feature)).map(f => `${f.feature}: ${f.detail}`);
}

export interface Weights {
  e: number;
  r: number;
  p: number;
}

/**
 * The production extractor prices a barter lot as `Math.round` of a binary64 SUM of count x unit price; the reference rounds the exact
 * total half up (INTERPRETATIONS.md choice 3). The two differ at an exact .5 boundary (`F09-fractional-barter-count-is-decoded-exactly`) and
 * that is a data-layer repair (Stage 2 numerics), not a property of the LP. So the gates hand the LP the exactly rounded lot price of each
 * barter, recomputed from the requirements the mapped offer carries, and test the model, not the extractor.
 */
export function exactBarterPrices(lookup: ItemLookup): void {
  const fix = (offers: OfferInfo[] | undefined): void => {
    for (const offer of offers ?? []) {
      if (!offer.source.startsWith('barter:') || !offer.barter_requirements) continue;
      let total = ZERO;
      for (const r of offer.barter_requirements) total = add(total, mul(fromBinary64(r.count), fromBinary64(r.unit_price)));
      offer.price = toNumber(roundHalfUp(total));
    }
  };
  const seen = new Set<object>();
  for (const entry of Object.values(lookup)) {
    fix(entry.stats.offers);
    if (entry.type !== 'gun') continue;
    for (const preset of [...entry.presets, ...entry.all_presets]) {
      if (seen.has(preset)) continue;
      seen.add(preset);
      fix(preset.offers);
    }
  }
}

/** Blueprint and domain from the production lookup of a case, with exactly rounded barter lot prices. */
export function preparePhysical(c: LedgerCase): ProductionPhysical {
  const lookup = productionLookup(c.fixture);
  exactBarterPrices(lookup);
  const blueprint = preparePhysicalWeapon(lookup, c.request.weapon_id);
  return { lookup, blueprint, domain: prepareSubproblemDomain(blueprint, lookup, subproblemRequestOf(c.request)) };
}

export function specializeRequestOf(request: ReferenceRequest, weights?: Weights): SpecializeRequest {
  return {
    maxPrice: request.max_price ?? null,
    minErgonomics: request.min_ergonomics ?? null,
    maxRecoilV: request.max_recoil_v ?? null,
    maxRecoilSum: request.max_recoil_sum ?? null,
    minMagCapacity: request.min_mag_capacity ?? null,
    minSightingRange: request.min_sighting_range ?? null,
    maxWeight: request.max_weight ?? null,
    maxMOA: request.max_moa ?? null,
    includeItems: request.include_items ?? null,
    includeCategories: request.include_categories ?? null,
    ergoWeight: weights ? weights.e : request.ergo_weight ?? null,
    recoilWeight: weights ? weights.r : request.recoil_weight ?? null,
    priceWeight: weights ? weights.p : request.price_weight ?? null,
    useTrueErgo: request.use_true_ergo,
    useTchebycheff: request.use_tchebycheff,
    idealPoint: request.ideal_point ?? null,
    preventOverswing: request.prevent_overswing,
    equipErgoModifier: request.equip_ergo_modifier ?? null,
  };
}

/**
 * How the decoded acquisition (per-occurrence source and charge, exact spend) differs from the oracle's acquisition model on the same
 * build: the decoder must reproduce preset-first, owned-second, paid-last allocation in code-unit instanceId order and the exact whole-lot
 * spend. Empty when they agree.
 */
export function provenanceIssues(c: LedgerCase, decoded: DecodedBuild): string[] {
  const { stats } = inspectBuild(resolveFixture(c.fixture), resolveRequest(c.fixture, c.request), referenceBuildOf(decoded));
  if (!stats) return ['the oracle has no statistics for the decoded build'];
  const issues: string[] = [];
  const spend = toNumber(stats.spend);
  if (Math.abs(spend - decoded.spend) > 1e-9 * Math.max(1, Math.abs(spend))) issues.push(`spend ${decoded.spend} != oracle ${spend}`);
  const expected = stats.acquisition.occurrences;
  if (expected.length !== decoded.acquisition.length) return [...issues, `${decoded.acquisition.length} provenance records != ${expected.length}`];
  expected.forEach((o, i) => {
    const d = decoded.acquisition[i];
    if (o.instanceId !== d.instanceId) issues.push(`record ${i}: ${d.instanceId} != ${o.instanceId}`);
    else if (o.source.kind !== d.source) issues.push(`${o.instanceId}: source ${d.source} != ${o.source.kind}`);
    else if (Math.abs(toNumber(o.charged) - d.price) > 1e-9) issues.push(`${o.instanceId}: charge ${d.price} != ${toNumber(o.charged)}`);
    else if (o.source.kind === 'offer') {
      const via = o.source.offer.kind;
      const trader = o.source.offer.trader ?? '';
      const key = d.offerSource ?? '';
      const agrees = via === 'flea' ? key === 'fleaMarket' : via === 'barter' ? key === `barter:${trader}` : key === trader;
      if (!agrees) issues.push(`${o.instanceId}: offer ${key} != ${via} ${trader}`);
    }
  });
  return issues;
}

/** The reference build a decoded build denotes. */
export function referenceBuildOf(decoded: DecodedBuild): ReferenceBuild {
  const base: BaseChoice = decoded.base.kind === 'naked' ? { kind: 'naked' } : { kind: 'preset', presetId: decoded.base.presetId };
  return { base, placements: decoded.placements.map(p => ({ ...p })) };
}

export const projectionKeyOf = (decoded: DecodedBuild): string => projectionKey(projectBuild(referenceBuildOf(decoded)));

interface ParsedProjection {
  base: BaseChoice;
  counts: Map<string, number>;
}

export function parseProjectionKey(key: string): ParsedProjection {
  const [base, items] = JSON.parse(key) as [[string] | [string, string], [string, number][]];
  return {
    base: base[0] === 'naked' ? { kind: 'naked' } : { kind: 'preset', presetId: (base as [string, string])[1] },
    counts: new Map(items),
  };
}

// ---------------------------------------------------------------------------------------------
// Pseudo-random objective directions
// ---------------------------------------------------------------------------------------------

/** mulberry32: a small deterministic generator. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pure axes first, then deterministic pseudo-random directions (some axes zero, the price axis on the 1000 scale of its frame). */
export function objectiveDirections(seed: number, random: number): Weights[] {
  const next = prng(seed);
  const out: Weights[] = [{ e: 1, r: 0, p: 0 }, { e: 0, r: 1, p: 0 }, { e: 0, r: 0, p: 1000 }];
  for (let i = 0; i < random; i++) {
    const pick = (scale: number): number => (next() < 0.25 ? 0 : Math.round(next() * scale * 100) / 100);
    out.push({ e: pick(2), r: pick(2), p: pick(2000) });
  }
  return out;
}

/** A stable seed per case id, so a failure reproduces. */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------------------------------------------------------------------------------------------
// One solve
// ---------------------------------------------------------------------------------------------

export interface NodeSolve {
  node: SpatialNode | undefined;
  model: SpecializedModel;
  solve: Solve;
  decoded: DecodedBuild | null;
  /** Set when the solver claimed Optimal but the vector could not be decoded. */
  decodeError: string | null;
}

/** Add rows in front of the Bounds section of an emitted model. */
function withRows(lp: string, rows: readonly string[]): string {
  const at = lp.indexOf('\nBounds\n');
  if (at < 0) throw new Error('model text has no Bounds section');
  return `${lp.slice(0, at)}\n${rows.map(r => `  ${r}`).join('\n')}${lp.slice(at)}`;
}

/** Rows that pin the base and every template's installed copy count to a projection (a template the projection does not use is pinned to 0). */
function pinRows(model: SpecializedModel, projection: ParsedProjection): string[] {
  const { blueprint, domain } = model;
  const rows: string[] = [];
  const baseIndex = domain.bases.findIndex(b => (projection.base.kind === 'naked' ? b.kind === 'naked' : b.kind === 'preset' && b.presetId === projection.base.presetId));
  domain.bases.forEach((_, b) => rows.push(`pin_base_${b}: ${model.columns.base(b)} = ${b === baseIndex ? 1 : 0}`));
  if (baseIndex < 0) rows.push('pin_no_base: 0 total_obj >= 1');
  for (let t = 1; t < blueprint.templateCount; t++) {
    const columns: string[] = [];
    for (const v of blueprint.instancesOf(t)) {
      const column = model.columns.occurrence(v);
      if (column) columns.push(column);
    }
    const want = projection.counts.get(blueprint.templateIds[t]) ?? 0;
    if (columns.length === 0) {
      if (want > 0) rows.push(`pin_impossible_${t}: 0 total_obj >= 1`);
      continue;
    }
    rows.push(`pin_t_${t}: ${columns.join(' + ')} = ${want}`);
  }
  // A projection that names an item the blueprint has no template for cannot be attained.
  for (const itemId of projection.counts.keys()) if (blueprint.templateIndexOf(itemId) < 0) rows.push(`pin_unknown_${itemId.replace(/\W/g, '_')}: 0 total_obj >= 1`);
  return rows;
}

export async function solveNode(
  physical: ProductionPhysical, request: SpecializeRequest, node: SpatialNode | undefined, pin?: ParsedProjection,
): Promise<NodeSolve> {
  const model = specializeLP(physical.blueprint, physical.domain, request, node);
  const lp = pin ? withRows(model.lp, pinRows(model, pin)) : model.lp;
  const solved = await solveText(lp);
  let decoded: DecodedBuild | null = null;
  let decodeError: string | null = null;
  if (solved.status === 'Optimal' && model.provedEmpty?.source !== 'domain') {
    try {
      decoded = decodeSolution(model, solved.values);
    } catch (e) {
      decodeError = e instanceof Error ? e.message : String(e);
    }
  }
  return { node, model, solve: solved, decoded, decodeError };
}

// ---------------------------------------------------------------------------------------------
// Case gates
// ---------------------------------------------------------------------------------------------

export type GateStatus = 'pass' | 'fail' | 'n/a';

export interface GateVerdict {
  status: GateStatus;
  detail: string;
}

export interface CaseGates {
  id: string;
  family: number;
  /** Set when the whole case is not gated (reason). */
  notApplicable: string | null;
  gateC: GateVerdict;
  gateBObjective: GateVerdict;
  gateBBuild: GateVerdict;
  gateBMaximizers: GateVerdict;
  gateAComplete: GateVerdict;
  gateASound: GateVerdict;
  /** The emitted text parses strictly, uses safe names, and HiGHS reads exactly that model. */
  gateText: GateVerdict;
  /** Distinct weight nodes solved for a TED case (0 otherwise). */
  nodes: number;
  /** HiGHS solves spent. */
  solves: number;
}

const pass = (detail: string): GateVerdict => ({ status: 'pass', detail });
const fail = (detail: string): GateVerdict => ({ status: 'fail', detail });
const notApplicable = (detail: string): GateVerdict => ({ status: 'n/a', detail });

export const DEFAULT_RANDOM_DIRECTIONS = 3;

/** Distinct total weights, as doubles, of every enumerated rooted build (feasible or not): the singleton nodes that partition the build space. */
function structuralWeights(fixture: ReferenceFixture, request: ReferenceRequest): number[] {
  const rf = resolveFixture(fixture);
  const rr = resolveRequest(fixture, request);
  const seen = new Map<string, number>();
  for (const build of enumerateBuilds(fixture, request).builds) {
    const { stats } = inspectBuild(rf, rr, build);
    if (stats) seen.set(`${stats.weight.n}/${stats.weight.d}`, toNumber(stats.weight));
  }
  return [...seen.values()].sort((a, b) => a - b);
}

const isTedRequest = (request: ReferenceRequest): boolean => request.use_true_ergo === true || request.prevent_overswing === true;

/** The weight of a projection, from the oracle's accepted builds. */
function projectionWeights(oracle: ReturnType<typeof runOracle>): Map<string, number> {
  const weights = new Map<string, number>();
  for (const accepted of oracle.builds) if (!weights.has(accepted.projectionKey)) weights.set(accepted.projectionKey, toNumber(accepted.stats.weight));
  return weights;
}

export interface GateOptions {
  randomDirections?: number;
  /** Cap on weight nodes of one TED case; beyond it the case is not gated. */
  maxNodes?: number;
  /**
   * Cap on the feasible projections pinned for completeness. Every maximizer is always pinned; the rest are an evenly spaced sample.
   * The ledger pins them all (default); the randomized cases sample.
   */
  maxPinned?: number;
}

/** All of `items` when there are at most `limit`, else the required ones plus an evenly spaced sample of the rest, in order. */
function sampleProjections<T extends { key: string }>(items: readonly T[], required: ReadonlySet<string>, limit: number): T[] {
  if (items.length <= limit) return [...items];
  const must = items.filter(i => required.has(i.key));
  const rest = items.filter(i => !required.has(i.key));
  const room = Math.max(0, limit - must.length);
  const chosen = new Set<T>(must);
  for (let k = 0; k < room && rest.length > 0; k++) chosen.add(rest[Math.floor((k * rest.length) / room)]);
  return items.filter(i => chosen.has(i));
}

export async function runGates(c: LedgerCase, options: GateOptions = {}): Promise<CaseGates> {
  const base: CaseGates = {
    id: c.id,
    family: c.family,
    notApplicable: null,
    gateC: notApplicable('not run'),
    gateBObjective: notApplicable('not run'),
    gateBBuild: notApplicable('not run'),
    gateBMaximizers: notApplicable('not run'),
    gateAComplete: notApplicable('not run'),
    gateASound: notApplicable('not run'),
    gateText: notApplicable('not run'),
    nodes: 0,
    solves: 0,
  };
  const skip = (reason: string): CaseGates => ({ ...base, notApplicable: reason });
  if (c.todo !== undefined) return skip(`ledger todo: ${c.todo}`);
  const skipped = skipReasons(c);
  if (skipped.length > 0) return skip(`production inputs cannot carry it (${skipped.join('; ')})`);

  const oracle = runOracle(c.fixture, c.request);
  if (!oracle.complete) return skip('the oracle enumeration is incomplete');
  const physical = preparePhysical(c);
  const ted = isTedRequest(c.request);
  const tolerance = c.runtimeTolerance;
  const nearCap = tolerance.kind === 'near_cap' && !tolerance.resolvableAtTolerance;
  let solves = 0;

  // --- nodes ---
  let nodes: (SpatialNode | undefined)[] = [undefined];
  if (ted) {
    const weights = structuralWeights(c.fixture, c.request);
    if (weights.length > (options.maxNodes ?? 200)) return skip(`spatial search is 2.4b-3 (${weights.length} weight nodes)`);
    nodes = weights.map(w => ({ weightMin: w, weightMax: w }));
  }

  const weightOf = projectionWeights(oracle);
  const nodeOf = (key: string): SpatialNode | undefined => {
    if (!ted) return undefined;
    const w = weightOf.get(key);
    return w === undefined ? undefined : { weightMin: w, weightMax: w };
  };

  const runAll = async (request: SpecializeRequest): Promise<NodeSolve[]> => {
    const out: NodeSolve[] = [];
    for (const node of nodes) {
      out.push(await solveNode(physical, request, node));
      solves++;
    }
    return out;
  };

  // --- Gate C and Gate B (objective, build) on the request as given ---
  const main = await runAll(specializeRequestOf(c.request));
  const feasibleNodes = main.filter(n => n.solve.status === 'Optimal');
  const odd = main.filter(n => n.solve.status !== 'Optimal' && n.solve.status !== 'Infeasible');
  const emptyConsistency = main.filter(n => n.model.provedEmpty !== null && n.solve.status !== 'Infeasible');
  const modelEmpty = main.every(n => n.model.provedEmpty !== null || n.solve.status === 'Infeasible');
  const textProblems: string[] = [];
  for (const n of main) for (const issue of await textIssues(n.model)) textProblems.push(issue);
  const gateText = textProblems.length === 0 ? pass(`${main.length} model text(s) round-trip through parseLpText and the HiGHS readback`) : fail(textProblems.slice(0, 3).join(' | '));
  let gateC: GateVerdict;
  if (odd.length > 0) gateC = fail(`solver status ${odd[0].solve.status}`);
  else if (emptyConsistency.length > 0) gateC = fail('a model proved empty is not infeasible as text');
  else if (modelEmpty !== oracle.empty) gateC = fail(oracle.empty ? `the oracle is empty but the model is feasible (${feasibleNodes[0]?.solve.objective})` : 'the model is infeasible but the oracle has feasible builds');
  else gateC = pass(oracle.empty ? 'both empty' : `both nonempty (${feasibleNodes.length} of ${main.length} node(s) feasible)`);

  let gateBObjective = notApplicable('no optimum (empty)');
  let gateBBuild = notApplicable('no optimum (empty)');
  const reference = c.expected.maxScore === null ? null : parseQ(c.expected.maxScore);
  const optimum = reference === null ? null : toNumber(reference);
  const maximizerKeys = new Set(oracle.maximizers);
  const feasibleKeys = new Set(oracle.projectionKeys);
  if (!oracle.empty && optimum !== null && !modelEmpty) {
    const best = feasibleNodes.reduce<NodeSolve | null>((a, n) => (a === null || n.solve.objective > a.solve.objective ? n : a), null);
    if (best === null) {
      gateBObjective = fail('no feasible node');
    } else {
      const slack = Math.max(tolerance.absolute, 0) + 1e-9 * Math.max(1, Math.abs(optimum));
      const delta = Math.abs(best.solve.objective - optimum);
      gateBObjective = delta <= slack ? pass(`objective ${best.solve.objective} = ${optimum} (delta ${delta.toExponential(2)})`) : fail(`objective ${best.solve.objective} differs from the oracle maximum ${optimum} by ${delta}`);
      if (best.decodeError !== null) {
        gateBBuild = fail(`the optimal vector does not decode: ${best.decodeError}`);
      } else if (best.decoded === null) {
        gateBBuild = fail('no decoded build');
      } else {
        const build = referenceBuildOf(best.decoded);
        const verdict = validateReference(c.fixture, c.request, build);
        const key = projectionKeyOf(best.decoded);
        const unresolvable = tolerance.kind === 'tiny_positive_gap' && !tolerance.resolvableAtTolerance;
        const provenance = verdict.ok ? provenanceIssues(c, best.decoded) : [];
        if (!verdict.ok) gateBBuild = fail(`the validator rejects the decoded build: ${verdict.violations.map(v => v.code).join(', ')}`);
        else if (provenance.length > 0) gateBBuild = fail(`the decoded acquisition differs from the oracle's: ${provenance.slice(0, 3).join('; ')}`);
        else if (maximizerKeys.has(key) || (unresolvable && feasibleKeys.has(key))) gateBBuild = pass(`validated; projection ${maximizerKeys.has(key) ? 'is a maximizer' : 'is within the unresolvable gap'}`);
        else gateBBuild = fail(`validated but the projection ${key} is not a maximizer`);
      }
    }
  } else if (!oracle.empty && modelEmpty) {
    gateBObjective = fail('the model is empty but the oracle has an optimum');
    gateBBuild = fail('no build');
  }

  // --- Gate A completeness and Gate B maximizer attainability: pin every oracle projection ---
  const failures: string[] = [];
  const maxFailures: string[] = [];
  const pinned = sampleProjections(oracle.projections, maximizerKeys, options.maxPinned ?? Number.POSITIVE_INFINITY);
  for (const record of pinned) {
    const projection = parseProjectionKey(record.key);
    const pinned = await solveNode(physical, specializeRequestOf(c.request), nodeOf(record.key), projection);
    solves++;
    if (pinned.solve.status !== 'Optimal') {
      failures.push(`${record.key}: pinned model is ${pinned.solve.status}`);
      if (maximizerKeys.has(record.key)) maxFailures.push(`${record.key}: pinned model is ${pinned.solve.status}`);
      continue;
    }
    if (maximizerKeys.has(record.key) && optimum !== null) {
      const slack = tolerance.absolute + 1e-9 * Math.max(1, Math.abs(optimum));
      if (Math.abs(pinned.solve.objective - optimum) > slack) maxFailures.push(`${record.key}: pinned objective ${pinned.solve.objective} != ${optimum}`);
    }
  }
  const gateAComplete = nearCap
    ? notApplicable('near-cap gap below the solver tolerance: exact-arithmetic only')
    : failures.length === 0 ? pass(`${pinned.length} of ${oracle.projections.length} feasible projection(s) pinned feasible`) : fail(failures.slice(0, 3).join(' | '));
  const gateBMaximizers = oracle.empty
    ? notApplicable('no optimum (empty)')
    : nearCap ? notApplicable('near-cap gap below the solver tolerance: exact-arithmetic only')
      : maxFailures.length === 0 ? pass(`${oracle.maximizers.length} maximizer(s) attainable at the maximum`) : fail(maxFailures.slice(0, 3).join(' | '));

  // --- Gate A soundness: random objective directions ---
  const directions = objectiveDirections(seedOf(c.id), options.randomDirections ?? DEFAULT_RANDOM_DIRECTIONS);
  const unsound: string[] = [];
  let decodedCount = 0;
  for (const weights of directions) {
    for (const solved of await runAll(specializeRequestOf(c.request, weights))) {
      if (solved.solve.status !== 'Optimal') continue;
      if (solved.decoded === null) {
        unsound.push(`direction ${JSON.stringify(weights)}: ${solved.decodeError ?? 'no decoded build'}`);
        continue;
      }
      decodedCount++;
      const key = projectionKeyOf(solved.decoded);
      const verdict = validateReference(c.fixture, c.request, referenceBuildOf(solved.decoded));
      if (!verdict.ok) unsound.push(`direction ${JSON.stringify(weights)}: validator ${verdict.violations.map(v => v.code).join(',')} on ${key}`);
      else if (!feasibleKeys.has(key)) unsound.push(`direction ${JSON.stringify(weights)}: ${key} is not in the oracle's feasible set`);
      else {
        const provenance = provenanceIssues(c, solved.decoded);
        if (provenance.length > 0) unsound.push(`direction ${JSON.stringify(weights)}: decoded acquisition differs from the oracle's: ${provenance.slice(0, 2).join('; ')}`);
      }
    }
  }
  const gateASound = nearCap
    ? notApplicable('near-cap gap below the solver tolerance: exact-arithmetic only')
    : unsound.length === 0 ? pass(`${decodedCount} decoded build(s) over ${directions.length} direction(s) are oracle-feasible`) : fail(unsound.slice(0, 3).join(' | '));

  return {
    ...base,
    gateC,
    gateBObjective: nearCap ? notApplicable('near-cap gap below the solver tolerance: exact-arithmetic only') : gateBObjective,
    gateBBuild: nearCap ? notApplicable('near-cap gap below the solver tolerance: exact-arithmetic only') : gateBBuild,
    gateBMaximizers,
    gateAComplete,
    gateASound,
    gateText,
    nodes: ted ? nodes.length : 0,
    solves,
  };
}
