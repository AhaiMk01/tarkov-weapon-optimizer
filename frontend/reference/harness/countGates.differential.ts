// Formal Gates A, B and C (ADR 0010 section 3, ADR 0013 section 7) on PRODUCTION Precise: the certified count model exactly as `solvePrecise` builds and
// solves it (Stage 3, workstream 3.1), against the Stage 1 oracle on exhaustive fixtures.
//
// What "exactly as production" means here, item by item (src/solver/physical/solvePrecise.ts):
//   - inputs: the case is mapped by `toProduction` (the mapping the end-to-end ledger harness uses) into `SolveParams`; the blueprint comes from production's
//     own memo `getPhysicalBlueprint(lookup, weaponId, params.physicalOptions)`, the domain from `prepareSubproblemDomain(blueprint, lookup, params)`, and the
//     model from `specializeCount(blueprint, domain, params, node)` with production's default options (certified, MOA dominance rows `auto`, repeats allowed,
//     Lemma 1 asserted on the domain). The gates read `params` itself, so a request field the gates forgot cannot differ from production;
//   - native solve: `solveWithPresolvePolicy` with `nativeSolveOptions(resolveTolerance(params.objectiveTolerance))` (presolve off, mip_rel_gap 0, integrality
//     1e-7, primal and dual feasibility 1e-9, decision 5b) plus the `random_seed` of `PRECISE_RANDOM_SEEDS`, readback requested, and every solve assessed
//     with production's `assessNativeResult` (readback equal, allowances dominating, declared tolerances): an unqualified solve is a failing cell;
//   - second opinion (decision 5a): a verdict a gate relies on (the model's optimum, an infeasibility, the maximizer exclusion) is settled like production
//     settles a node: seed 0 and seed 11, a third seed 29 on a disagreement, and only two agreeing qualified verdicts settle it;
//   - decode with production's `decodeFast`, validate with BOTH the reference validator (`validateReference`, the oracle's) and the production validator
//     (`preparePhysicalValidator(..., requirePathInstanceIds: true)`, as solvePrecise prepares it); the two must agree on every decoded build;
//   - gate-side cross-check (never a production setting): a verdict the production seeds settle as Infeasible, or leave unsettled, is solved once more with
//     presolve on and the same strict tolerances; when that finds a point BOTH validators accept, the verdict was a native defect (a false Infeasible
//     the second opinion misses, or a SolveError production raises as SolverError). The gates then judge the model by that point and record the defect in
//     the `native` cell, which also fails on any unqualified production solve. Two such defects are kept with minimal reproductions as TODO tests in
//     countGates.nativeDefects.differential.test.ts. Three qualified Optimal verdicts whose bounds disagree beyond the tolerance (production withholds the
//     certificate, decision 5a/5b) are counted, not failed;
//   - rejected points: as production does, a decoded point a validator rejects is cut out with production's `integerNoGood` over `model.decision` and the
//     node solved again (at most `MAX_REJECTIONS_PER_NODE`). The gates accept such a cut only when the rejection is a request cap missed by at most the
//     solver tolerance (`isToleranceBoundary`, the numerical layer); any other rejection of an integer point is a soundness failure of the model.
//
// Relaxed-first edges (`PRECISE_EDGE_INTEGRALITY` = 'relaxed-first'). Production solves every node first with the slot-edge counts continuous
// (`CountModel.lpRelaxedEdges()`) and uses the answer when the edges come out integral; it falls back to the integer text otherwise. The gates therefore
// judge BOTH texts wherever production can take an answer from the relaxed one:
//   - Gate C: an Infeasible relaxed text ends the node in production (`confirm(...)` on the relaxed text), so a settled relaxed infeasibility must imply an
//     empty oracle set; a relaxed solve with integral edges must decode to an oracle-feasible build;
//   - Gate B: an integral relaxed optimum is published as the node's optimum, so it must equal the oracle maximum and decode to a maximizer (the same checks
//     as the integer text); a fractional relaxed optimum is only a bound, so it must be at least the oracle maximum (a valid relaxation);
//   - Gate A soundness: every integral relaxed point under every objective direction is decoded and judged like an integer point.
//   Gate A completeness and the pinned Gate B checks are run on the integer text only, and that suffices: the relaxed text has the same rows with the edge
//   columns' integrality dropped, so every point of the integer text is a point of the relaxed one (a pinned projection feasible in the integer text is
//   feasible in the relaxed text), and the relaxed text is never the one production certifies a SPECIFIC projection from without integral edges.
//
// The gates on one fixture, with pi_sel(B) = (chosen base, installed multiset):
//   Gate C  the model is infeasible (every node settled infeasible, or proved empty by the domain or a contradiction row) exactly when the oracle's feasible
//           set is empty;
//   Gate A  completeness: the integer text pinned (base and every template count) to EACH oracle feasible projection is feasible (a feasible pin is a
//           model point with that projection; an Infeasible pin gets the second and third seed before it counts, and a feasible answer of any seed wins);
//           soundness: under several deterministic objective directions (the three pure axes and pseudo-random mixes) every decoded point of both texts is
//           accepted by both validators, projects to the point's own counts, and lies in the oracle's feasible set;
//   Gate B  the settled optimum of the model equals the oracle's exact maximum within the case tolerance, the decoded optimum is a maximizer, and the
//           maximizer SET is equal (ADR 0013 section 7: "every maximizing projected tie ... with suitable exact exclusion/no-good constraints or a complete
//           equivalent method"). The argument that the two checks below are that complete method:
//             (B1, oracle maximizers are model maximizers) every oracle maximizer projection is pinned; a pinned model whose optimum equals the maximum has
//                  a point of that projection at the maximum, so every oracle tie is attainable by the model at the maximum;
//             (B2, model maximizers are oracle maximizers) the model with the floor row `total_obj >= max - slack` and an exact projection no-good for
//                  EVERY oracle maximizer (the one-hot encoding of `projectionEncoding`: one literal per base and count column, so it removes exactly that
//                  projection and nothing else) must be settled infeasible. Any point it still has is decoded: a validated point whose exact oracle score
//                  is within the case tolerance of the maximum is a near tie the tolerance cannot separate (reported), anything else fails the gate.
//           B1 and B2 together say: the set of projections the model attains at its maximum equals the oracle's maximizer set, which is the equality the ADR
//           asks for. Enumerating the model optima one by one with no-goods is the same statement, done in the other order.
//
// TED and Prevent Overswing: as in the occurrence gates (lpGates.differential.ts), the model is exact on a singleton weight node (a constant penalty
// line, `constant_exact`), so the distinct total weights of every enumerated rooted build (feasible or not) are solved as singleton nodes and the answer
// is the union over nodes. The nodes are test-side knowledge (the oracle's structural builds), not something production's spatial search knows.
//
// Precision (decision 5b). The native integrality tolerance is 1e-7, so a solver objective can sit off the exact score of its own point by (the objective
// sensitivity of a column) x 1e-7. Objective comparisons are made at the case tolerance (`runtimeTolerance.absolute` plus 1e-9 relative, as the
// occurrence gates); a delta above it but within `PRECISION_RELATIVE` x max(1, |value|) is NOT passed silently: the cell gets the status `precision`
// with its delta, and the test compares the set of such cells with an explicit list. Anything larger fails.
//
// Cyclic part graphs (decision 2d as amended): such a case is not gated; it is checked as REFUSED: `partGraphIsAcyclic` is false, `specializeCount` throws
// CYCLIC_PART_GRAPH, `partGraphRefusal` returns the public reason and `solvePrecise` returns `incomplete` with that reason without a native solve.
//
// Differential helper: may import production code (reference/independenceScan.ts); no non-differential file may import this one.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  eq, projectBuild, projectionKey, runOracle, sub, toNumber, validateReference,
  type EnumerateOptions, type OracleResult, type ReferenceBuild, type ReferenceFixture, type ReferenceRequest,
} from '../oracle/index';
import {
  appendCuts, columnValuesFromStructured, decodeFast, integerNoGood, partGraphIsAcyclic, PhysicalModelError, preparePhysicalValidator, prepareSubproblemDomain,
  specializeCount,
  type CountModel, type IntegerNoGood, type PhysicalBlueprint, type PhysicalBuild, type PhysicalValidator, type SpatialNode, type SubproblemDomain,
} from '../../src/solver/physical';
import type { ItemLookup, PhysicalClassifiers, SolveParams } from '../../src/solver/types';
import type { RuntimeTolerance } from '../ledger/types';
import { detectUnsupported, toProduction } from './toProduction.differential';
import { fastPinRows, isToleranceBoundary, projectionEncoding, readPoint, withRows } from './acyclicFast.differential';
import { objectiveDirections, parseProjectionKey, seedOf, structuralWeights, type Weights } from './lpGates.differential';

// ---------------------------------------------------------------------------------------------
// Production modules that reach the native loader (loaded at run time, see lpGates.differential.ts for why)
// ---------------------------------------------------------------------------------------------

interface NativeResultLike {
  modelStatus: { name: string };
  objectiveValue: number | null;
  mipDualBound: number | null;
  colNames: readonly string[] | null;
  colValues: Float64Array | null;
  colIndexByName: ReadonlyMap<string, number>;
}
type PolicyOutcomeLike =
  | { kind: 'solved'; result: NativeResultLike; presolveRescue: boolean; presolved: boolean }
  | { kind: 'infeasible'; first: NativeResultLike; confirmation: NativeResultLike | null }
  | { kind: 'unresolved'; cause: string; first: NativeResultLike | null; detail: string };
interface NativeSolveModule {
  nativeSolveOptions(tau: number): Record<string, number | boolean | string>;
  solveWithPresolvePolicy(lpText: string, context: { options: Record<string, number | boolean | string>; deadline: number; includeReadback?: boolean }): Promise<PolicyOutcomeLike>;
  NATIVE_FEASIBILITY_TOLERANCE: number;
  PRECISE_PRESOLVE: string;
}
interface NativeProofModule {
  assessNativeResult(input: { lpText: string; proof: CountModel['proof'] }, result: NativeResultLike): { qualified: boolean; reasons: readonly string[] };
}
interface PreciseRunLike {
  kind: 'empty' | 'build' | 'incomplete';
  reason?: string;
  summary: { telemetry: { nativeSolves: number } };
}
interface SolvePreciseModule {
  getPhysicalBlueprint(lookup: ItemLookup, weaponId: string, classifiers?: PhysicalClassifiers): PhysicalBlueprint;
  partGraphRefusal(params: Pick<SolveParams, 'itemLookup' | 'weaponId' | 'physicalOptions'>): string | null;
  resolveTolerance(requested: number | undefined): number;
  solvePrecise(context: { params: SolveParams; deadline: number }): Promise<PreciseRunLike>;
  PRECISE_RANDOM_SEEDS: readonly number[];
  PRECISE_EDGE_INTEGRALITY: 'relaxed-first' | 'integer';
  MAX_REJECTIONS_PER_NODE: number;
}
const NATIVE_MODULE = '../../src/solver/native/index.ts';
const NATIVE_SOLVE_MODULE = '../../src/solver/physical/nativeSolve.ts';
const NATIVE_PROOF_MODULE = '../../src/solver/physical/nativeProof.ts';
const SOLVE_PRECISE_MODULE = '../../src/solver/physical/solvePrecise.ts';
interface Production {
  native: NativeSolveModule;
  proof: NativeProofModule;
  precise: SolvePreciseModule;
}
let production: Production | null = null;
async function load(): Promise<Production> {
  production ??= {
    native: (await import(NATIVE_SOLVE_MODULE)) as NativeSolveModule,
    proof: (await import(NATIVE_PROOF_MODULE)) as NativeProofModule,
    precise: (await import(SOLVE_PRECISE_MODULE)) as SolvePreciseModule,
  };
  return production;
}

/** The public reason production refuses a cyclic part graph with (`PUBLIC_REASONS.unsupportedCyclicPartGraph`). */
export const CYCLIC_REFUSAL = 'Unsupported data: cyclic part graph';

/** A solver objective off the exact value by more than the case tolerance but within this (relative to max(1, |value|)) is a `precision` cell (decision 5b). */
export const PRECISION_RELATIVE = 1e-6;

/** Native time limit per solve. Ledger and seeded models solve in milliseconds; a stop is reported, never taken as a verdict. */
const SOLVE_SECONDS = 60;

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export type GateStatus = 'pass' | 'fail' | 'n/a' | 'precision';
export interface Verdict {
  status: GateStatus;
  detail: string;
}
const pass = (detail: string): Verdict => ({ status: 'pass', detail });
const fail = (detail: string): Verdict => ({ status: 'fail', detail });
const na = (detail: string): Verdict => ({ status: 'n/a', detail });
const precisionCell = (detail: string): Verdict => ({ status: 'precision', detail });

export const COUNT_GATES = [
  'gateC', 'gateBObjective', 'gateBBuild', 'gateBPinned', 'gateBExclusion', 'gateAComplete', 'gateASound', 'relaxedFirst', 'validators', 'native',
] as const;
export type CountGateName = (typeof COUNT_GATES)[number];

export type Scope = 'gated' | 'refused' | 'skipped';

export interface CountCaseGates extends Record<CountGateName, Verdict> {
  id: string;
  family: number;
  scope: Scope;
  /** Why the case is not gated (skipped), or the refusal check's verdict (refused). */
  scopeDetail: string;
  /** The refusal check of a cyclic case: pass when every production entry point refuses it as unsupported data. */
  refusal: Verdict;
  oracleProjections: number;
  oracleEmpty: boolean;
  /** Singleton weight nodes of a TED case (0 otherwise). */
  nodes: number;
  /** Native solves spent. */
  solves: number;
  /** Infeasible pins or verdicts that a later seed overturned with a validated point (a solver defect, not a model one). */
  seedOverrides: number;
  /** Points rejected as tolerance boundaries and cut out, as production does. */
  boundaryCuts: number;
  /** Relaxed-first solves whose edges came out fractional (production then falls back to the integer text). */
  relaxedFractional: number;
  relaxedSolves: number;
  /** Largest |solver objective - exact value| seen over the optimum, pinned maximizers and decoded points. */
  maxObjectiveDelta: number;
  /** Verdicts left unsettled by three qualified Optimal solves whose bounds disagree beyond the tolerance (production withholds the certificate). */
  boundDisagreements: number;
  /** Largest proved MIP gap (dual bound - primal) of a settled optimal solve. */
  maxDualGap: number;
  /** Decoded builds both validators judged. */
  validated: number;
  /** Pinned oracle projections checked. */
  pinned: number;
}

const blank = (id: string, family: number): CountCaseGates => ({
  id, family, scope: 'gated', scopeDetail: '', refusal: na('acyclic'), oracleProjections: 0, oracleEmpty: false, nodes: 0, solves: 0, seedOverrides: 0,
  boundaryCuts: 0, relaxedFractional: 0, relaxedSolves: 0, boundDisagreements: 0, maxObjectiveDelta: 0, maxDualGap: 0, validated: 0, pinned: 0,
  gateC: na('not run'), gateBObjective: na('not run'), gateBBuild: na('not run'), gateBPinned: na('not run'), gateBExclusion: na('not run'),
  gateAComplete: na('not run'), gateASound: na('not run'), relaxedFirst: na('not run'), validators: na('not run'), native: na('not run'),
});

/** Mapping features the production inputs cannot carry (the list the occurrence gates skip on). */
const SKIPPING_FEATURES = ['flea_player_level_on_base', 'flea_offers_distinct_player_levels', 'non_canonical_trader_name', 'weapon_magazine_capacity'];

export interface CountGateOptions {
  /** Pseudo-random objective directions on top of the three pure axes. */
  randomDirections?: number;
  /** Cap on weight nodes of one TED case; beyond it the case is skipped (reported). */
  maxNodes?: number;
  /** Cap on the oracle projections pinned for completeness (every maximizer is always pinned); default all. */
  maxPinned?: number;
  /** Oracle enumeration caps. */
  oracle?: EnumerateOptions;
  /** Ledger todo marker: the case is skipped. */
  todo?: string;
}

// ---------------------------------------------------------------------------------------------
// One native solve, as production makes it
// ---------------------------------------------------------------------------------------------

type Status = 'Optimal' | 'Infeasible' | 'Stopped';

interface Solved {
  status: Status;
  rawStatus: string;
  objective: number;
  dualBound: number | null;
  values: Record<string, number>;
  qualified: boolean;
  reasons: readonly string[];
}

interface Context {
  prod: Production;
  model: CountModel;
  tolerance: number;
  counters: CountCaseGates;
  unqualified: string[];
  /** Native calls that raised (production's SolverError: the request would fail). */
  nativeErrors: string[];
  /**
   * Verdicts production's seeds settle as Infeasible (or leave unsettled) on a text that HAS a point both validators accept: found by the gates' cross-check
   * solve (presolve on, the same strict tolerances) and confirmed by decoding and validating its point. A native defect production's second opinion misses.
   */
  falseInfeasible: string[];
}

/** Gate-side cross-check of an Infeasible or unsettled verdict: the same text and tolerances with presolve on (never a production setting). */
async function crossCheck(ctx: Context, lpText: string): Promise<Solved | null> {
  ctx.counters.solves++;
  const nativeModule = (await import(NATIVE_MODULE)) as { getNativeHighs(): { solveStructured(lp: string, options: Record<string, number | boolean | string>): Promise<NativeResultLike> } };
  try {
    const result = await nativeModule.getNativeHighs().solveStructured(lpText, { ...ctx.prod.native.nativeSolveOptions(ctx.tolerance), presolve: 'choose', time_limit: SOLVE_SECONDS, random_seed: 0 });
    if (result.modelStatus.name !== 'Optimal') return null;
    return {
      status: 'Optimal', rawStatus: 'Optimal (gate cross-check, presolve on)', objective: result.objectiveValue ?? Number.NaN, dualBound: result.mipDualBound,
      values: columnValuesFromStructured(result.colNames, result.colValues), qualified: true, reasons: [],
    };
  } catch {
    return null;
  }
}

async function solveOnce(ctx: Context, model: CountModel, lpText: string, seed: number): Promise<Solved> {
  const { native, proof } = ctx.prod;
  ctx.counters.solves++;
  let outcome: PolicyOutcomeLike;
  try {
    outcome = await native.solveWithPresolvePolicy(lpText, {
      options: { ...native.nativeSolveOptions(ctx.tolerance), random_seed: seed },
      deadline: performance.now() + SOLVE_SECONDS * 1000,
      includeReadback: true,
    });
  } catch (error) {
    // Production raises a typed SolverError here and the request fails: recorded as a failing cell, with the text kept for diagnosis.
    const message = error instanceof Error ? error.message : String(error);
    ctx.nativeErrors.push(`seed ${seed}: ${message.slice(0, 160)}`);
    if (process.env.COUNT_GATES_DUMP) writeFileSync(join(process.env.COUNT_GATES_DUMP, `native-error-${ctx.counters.id}-${ctx.counters.solves}-seed${seed}.lp`), lpText);
    return { status: 'Stopped', rawStatus: `native error (${message.slice(0, 80)})`, objective: Number.NaN, dualBound: null, values: {}, qualified: false, reasons: [message] };
  }
  if (outcome.kind === 'unresolved') return { status: 'Stopped', rawStatus: `unresolved (${outcome.cause}: ${outcome.detail})`, objective: Number.NaN, dualBound: null, values: {}, qualified: false, reasons: [outcome.detail] };
  const result = outcome.kind === 'solved' ? outcome.result : (outcome.confirmation ?? outcome.first);
  const assessment = proof.assessNativeResult({ lpText, proof: model.proof }, result);
  if (!assessment.qualified) ctx.unqualified.push(assessment.reasons.join('; ').slice(0, 200));
  const status: Status = outcome.kind === 'infeasible' ? 'Infeasible' : result.modelStatus.name === 'Optimal' ? 'Optimal' : 'Stopped';
  return {
    status,
    rawStatus: result.modelStatus.name,
    objective: result.objectiveValue ?? Number.NaN,
    dualBound: result.mipDualBound,
    values: status === 'Optimal' ? columnValuesFromStructured(result.colNames, result.colValues) : {},
    qualified: assessment.qualified,
    reasons: assessment.reasons,
  };
}

/** Two verdicts agree as production's `opinionsAgree` asks (both Infeasible, or both Optimal with bounds within the tolerance). */
function agree(a: Solved, b: Solved, tolerance: number): boolean {
  if (!a.qualified || !b.qualified || a.status !== b.status || a.status === 'Stopped') return false;
  if (a.status === 'Infeasible') return true;
  const ua = a.dualBound ?? a.objective;
  const ub = b.dualBound ?? b.objective;
  return Math.abs(ua - ub) <= Math.max(tolerance, 1e-12);
}

interface Settled {
  verdict: 'optimal' | 'infeasible' | 'unsettled';
  solves: Solved[];
  /** The first solve that agrees (its point is the one decoded). */
  first: Solved;
  detail: string;
}

/** Settle a verdict like production settles a node (decision 5a): seeds 0 and 11, a third seed on a disagreement; two agreeing verdicts settle it. */
async function settle(ctx: Context, model: CountModel, lpText: string, accepts?: (solve: Solved) => boolean): Promise<Settled> {
  const settled = await settleSeeds(ctx, model, lpText);
  if (settled.verdict === 'optimal') return settled;
  if (settled.verdict === 'unsettled' && settled.solves.every(x => x.qualified && x.status === 'Optimal')) {
    // Three qualified Optimal verdicts whose bounds are pairwise further apart than the request tolerance: production withholds the certificate
    // (decision 5a; with integrality 1e-7 and a 1e-9 tolerance this is decision 5b's stated cost). The model is feasible; the best point is judged.
    ctx.counters.boundDisagreements++;
    const best = settled.solves.reduce((a, b) => (b.objective > a.objective ? b : a));
    return { verdict: 'optimal', solves: settled.solves, first: best, detail: `bounds disagree: ${settled.solves.map(x => x.dualBound ?? x.objective).join(', ')}` };
  }
  if (accepts === undefined) return settled;
  // An Infeasible (or unsettled) verdict is cross-checked; a cross-check point both validators accept proves the text feasible.
  const check = await crossCheck(ctx, lpText);
  if (check === null || !accepts(check)) return settled;
  ctx.falseInfeasible.push(`${settled.verdict} under seeds ${settled.solves.map(x => x.rawStatus).join('/')}, feasible (validated point, objective ${check.objective})`);
  if (process.env.COUNT_GATES_DUMP) writeFileSync(join(process.env.COUNT_GATES_DUMP, `false-infeasible-${ctx.counters.id}-${ctx.counters.solves}.lp`), lpText);
  return { verdict: 'optimal', solves: [...settled.solves, check], first: check, detail: `production seeds said ${settled.verdict}; the gate cross-check found a validated point` };
}

async function settleSeeds(ctx: Context, model: CountModel, lpText: string): Promise<Settled> {
  const seeds = ctx.prod.precise.PRECISE_RANDOM_SEEDS;
  const solves = [await solveOnce(ctx, model, lpText, seeds[0])];
  solves.push(await solveOnce(ctx, model, lpText, seeds[1]));
  if (!agree(solves[0], solves[1], ctx.tolerance)) solves.push(await solveOnce(ctx, model, lpText, seeds[2]));
  for (let i = 0; i < solves.length; i++) {
    for (let j = i + 1; j < solves.length; j++) {
      if (agree(solves[i], solves[j], ctx.tolerance)) {
        return { verdict: solves[i].status === 'Optimal' ? 'optimal' : 'infeasible', solves, first: solves[i], detail: `${solves.length} seed(s)` };
      }
    }
  }
  return { verdict: 'unsettled', solves, first: solves[0], detail: `no two of ${solves.length} solves agree: ${solves.map(s => `${s.rawStatus}${s.qualified ? '' : ' (unqualified)'} ${s.objective}`).join(', ')}` };
}

// ---------------------------------------------------------------------------------------------
// Judging one point
// ---------------------------------------------------------------------------------------------

interface CaseWorld {
  fixture: ReferenceFixture;
  request: ReferenceRequest;
  oracle: OracleResult;
  feasibleKeys: ReadonlySet<string>;
  oracleScore: ReadonlyMap<string, number>;
  validator: PhysicalValidator;
}

type PointJudgement =
  | { kind: 'accepted'; key: string; score: number; build: ReferenceBuild }
  | { kind: 'boundary'; key: string }
  | { kind: 'rejected'; key: string; detail: string };

const toReferenceBuild = (build: PhysicalBuild): ReferenceBuild => ({
  base: build.base.kind === 'naked' ? { kind: 'naked' } : { kind: 'preset', presetId: build.base.presetId },
  placements: build.placements.map(p => ({ parentInstanceId: p.parentInstanceId, slotId: p.slotId, childInstanceId: p.childInstanceId, itemId: p.itemId })),
});

/**
 * Decode an integer point with production's `decodeFast`, validate it with BOTH validators, and place it against the oracle. `validatorIssues` collects
 * disagreements of the two validators. A point both validators reject only for a cap missed within the solver tolerance is a `boundary`.
 */
function judgePoint(ctx: Context, world: CaseWorld, model: CountModel, values: Readonly<Record<string, number>>, objective: number, validatorIssues: string[]): PointJudgement {
  let pointKey: string;
  try {
    pointKey = readPoint(model, values, objective).key;
  } catch (e) {
    return { kind: 'rejected', key: '?', detail: `the point does not read as an integer projection: ${e instanceof Error ? e.message : String(e)}` };
  }
  let decoded: ReturnType<typeof decodeFast>;
  try {
    decoded = decodeFast(model, values);
  } catch (e) {
    if (e instanceof PhysicalModelError) return { kind: 'rejected', key: pointKey, detail: `decodeFast threw ${e.code}: ${e.message}` };
    throw e;
  }
  if (!decoded.ok) return { kind: 'rejected', key: pointKey, detail: `decodeFast: ${decoded.reason}` };
  const build = toReferenceBuild(decoded.build);
  const reference = validateReference(world.fixture, world.request, build);
  const productionVerdict = world.validator.validate(decoded.build);
  ctx.counters.validated++;
  if (reference.ok !== productionVerdict.ok) {
    validatorIssues.push(`${pointKey}: reference ${reference.ok ? 'accepts' : `rejects (${reference.violations.map(v => v.code).join(',')})`}, production ${productionVerdict.ok ? 'accepts' : `rejects (${productionVerdict.violations.map(v => v.code).join(',')})`}`);
  }
  if (!reference.ok || !productionVerdict.ok) {
    if (isToleranceBoundary(world.fixture, world.request, build)) return { kind: 'boundary', key: pointKey };
    return { kind: 'rejected', key: pointKey, detail: `validators reject the decoded build: reference ${reference.violations.map(v => `${v.code}(${v.detail})`).slice(0, 2).join(', ') || 'ok'}; production ${productionVerdict.violations.map(v => v.code).slice(0, 3).join(', ') || 'ok'}` };
  }
  const key = projectionKey(projectBuild(build));
  if (key !== pointKey) return { kind: 'rejected', key: pointKey, detail: `the decoded build projects to ${key}, not to the point's counts` };
  if (!world.feasibleKeys.has(key)) return { kind: 'rejected', key, detail: 'both validators accept it but it is not an oracle feasible projection' };
  return { kind: 'accepted', key, score: world.oracleScore.get(key) as number, build };
}

/** Is every slot-edge column of the point integral at production's tolerance (`judge` in solvePrecise.ts)? */
function edgesIntegral(ctx: Context, model: CountModel, values: Readonly<Record<string, number>>): boolean {
  const tol = ctx.prod.native.NATIVE_FEASIBILITY_TOLERANCE;
  return model.edges.every(edge => {
    const v = values[edge.column];
    return typeof v === 'number' && Math.abs(v - Math.round(v)) <= tol;
  });
}

interface Answer {
  settled: Settled;
  /** The accepted point after production's cut loop, or null. */
  accepted: Extract<PointJudgement, { kind: 'accepted' }> | null;
  /** Solver objective of the accepted point. */
  objective: number;
  problems: string[];
}

/**
 * Solve the integer text of a node as production's node loop does (settled verdict, decode, validate, boundary cuts), returning the settled verdict
 * and the accepted point. Non-boundary rejections are reported in `problems` and cut, so the loop can continue to the valid builds beside them.
 */
async function solveInteger(ctx: Context, world: CaseWorld, model: CountModel, extraRows: readonly string[], validatorIssues: string[]): Promise<Answer> {
  const cuts: IntegerNoGood[] = [];
  const problems: string[] = [];
  const base = extraRows.length > 0 ? withRows(model.lpBase, extraRows) : model.lpBase;
  for (let round = 0; ; round++) {
    const settled = await settle(ctx, model, appendCuts(base, cuts), s => judgePoint(ctx, world, model, s.values, s.objective, []).kind === 'accepted');
    if (settled.verdict !== 'optimal') return { settled, accepted: null, objective: Number.NaN, problems };
    const judgement = judgePoint(ctx, world, model, settled.first.values, settled.first.objective, validatorIssues);
    if (judgement.kind === 'accepted') return { settled, accepted: judgement, objective: settled.first.objective, problems };
    if (judgement.kind === 'boundary') ctx.counters.boundaryCuts++;
    else problems.push(judgement.detail);
    const cut = round < ctx.prod.precise.MAX_REJECTIONS_PER_NODE ? integerNoGood(`gate_nogood_${round}`, model.decision, settled.first.values) : null;
    if (cut === null) return { settled, accepted: null, objective: Number.NaN, problems: [...problems, 'the rejection limit was reached'] };
    cuts.push(cut);
  }
}

// ---------------------------------------------------------------------------------------------
// The gates of one case
// ---------------------------------------------------------------------------------------------

const isTed = (request: ReferenceRequest): boolean => request.use_true_ergo === true || request.prevent_overswing === true;

/** The refusal check of a cyclic part graph: every production entry point refuses it as unsupported data, nothing is solved. */
async function refusalCheck(prod: Production, blueprint: PhysicalBlueprint, params: SolveParams, domain: SubproblemDomain): Promise<Verdict> {
  const problems: string[] = [];
  if (partGraphIsAcyclic(blueprint)) problems.push('partGraphIsAcyclic is true');
  if (!domain.empty) {
    try {
      specializeCount(blueprint, domain, params);
      problems.push('specializeCount built a model');
    } catch (e) {
      if (!(e instanceof PhysicalModelError) || e.code !== 'CYCLIC_PART_GRAPH') problems.push(`specializeCount threw ${e instanceof PhysicalModelError ? e.code : String(e)}`);
    }
  }
  const refusal = prod.precise.partGraphRefusal(params);
  if (refusal !== CYCLIC_REFUSAL) problems.push(`partGraphRefusal returned ${JSON.stringify(refusal)}`);
  const run = await prod.precise.solvePrecise({ params, deadline: performance.now() + 60_000 });
  if (run.kind !== 'incomplete' || run.reason !== CYCLIC_REFUSAL || run.summary.telemetry.nativeSolves !== 0) {
    problems.push(`solvePrecise returned ${run.kind} (${run.reason ?? 'no reason'}) after ${run.summary.telemetry.nativeSolves} native solve(s)`);
  }
  return problems.length === 0 ? pass(`refused (${domain.empty ? 'empty domain; ' : 'CYCLIC_PART_GRAPH from specializeCount; '}partGraphRefusal and solvePrecise give "${CYCLIC_REFUSAL}", 0 solves)`) : fail(problems.join('; '));
}

function compareObjective(value: number, expected: number, caseSlack: number): { status: GateStatus; delta: number } {
  const delta = Math.abs(value - expected);
  if (delta <= caseSlack) return { status: 'pass', delta };
  if (delta <= PRECISION_RELATIVE * Math.max(1, Math.abs(expected))) return { status: 'precision', delta };
  return { status: 'fail', delta };
}

/** Projection no-goods for the oracle's maximizer projections that are points of the model (one literal per base and count column). */
function maximizerExclusion(model: CountModel, keys: readonly string[]): IntegerNoGood[] {
  const encoding = projectionEncoding(model);
  const out: IntegerNoGood[] = [encoding.setup];
  keys.forEach((key, k) => {
    const projection = parseProjectionKey(key);
    const values: Record<string, number> = {};
    const baseIndex = model.domain.bases.findIndex(b => (projection.base.kind === 'naked' ? b.kind === 'naked' : b.kind === 'preset' && b.presetId === (projection.base as { presetId: string }).presetId));
    if (baseIndex < 0) return; // not a point of the model: nothing to exclude (B1 reports it)
    model.domain.bases.forEach((_, b) => { values[model.base(b)] = b === baseIndex ? 1 : 0; });
    for (const itemId of projection.counts.keys()) if (model.blueprint.templateIndexOf(itemId) < 0) return;
    for (let t = 1; t < model.blueprint.templateCount; t++) {
      const column = model.count(t);
      const want = projection.counts.get(model.blueprint.templateIds[t]) ?? 0;
      if (column === null) {
        if (want > 0) return;
        continue;
      }
      if (want > model.graph.maxCopies[t]) return;
      values[column] = want;
    }
    out.push(encoding.cutFor(`gate_excl_${k}`, values));
  });
  return out;
}

export interface CaseInput {
  id: string;
  family: number;
  fixture: ReferenceFixture;
  request: ReferenceRequest;
  tolerance: Pick<RuntimeTolerance, 'absolute' | 'kind' | 'resolvableAtTolerance'>;
}

export async function runCountGates(input: CaseInput, options: CountGateOptions = {}): Promise<CountCaseGates> {
  const { id, fixture, request } = input;
  const out = blank(id, input.family);
  const skip = (detail: string): CountCaseGates => ({ ...out, scope: 'skipped', scopeDetail: detail });
  if (options.todo !== undefined) return skip(`ledger todo: ${options.todo}`);
  const unsupported = detectUnsupported(fixture, request).filter(f => SKIPPING_FEATURES.includes(f.feature));
  if (unsupported.length > 0) return skip(`production inputs cannot carry it (${unsupported.map(f => f.feature).join(', ')})`);

  const prod = await load();
  const inputs = toProduction(fixture, request, { preciseMode: true, objectiveTolerance: input.tolerance.absolute });
  const params = inputs.params;
  const lookup = params.itemLookup;
  const blueprint = prod.precise.getPhysicalBlueprint(lookup, params.weaponId, params.physicalOptions);
  const domain = prepareSubproblemDomain(blueprint, lookup, params);

  if (!partGraphIsAcyclic(blueprint)) {
    const refusal = await refusalCheck(prod, blueprint, params, domain);
    return { ...out, scope: 'refused', scopeDetail: refusal.detail, refusal };
  }

  const oracle = runOracle(fixture, request, options.oracle ?? { maxBuilds: 60_000 });
  if (!oracle.complete) return skip('the oracle enumeration is incomplete');
  out.oracleProjections = oracle.projections.length;
  out.oracleEmpty = oracle.empty;

  const tolerance = prod.precise.resolveTolerance(params.objectiveTolerance);
  const optimum = oracle.maxScore === null ? null : toNumber(oracle.maxScore);
  const caseSlack = input.tolerance.absolute + 1e-9 * Math.max(1, Math.abs(optimum ?? 0));
  const nearCap = input.tolerance.kind === 'near_cap' && !input.tolerance.resolvableAtTolerance;
  const unresolvableGap = input.tolerance.kind === 'tiny_positive_gap' && !input.tolerance.resolvableAtTolerance;
  // The runner-up gap: below the precision limit a float comparison cannot separate a tie from a non-tie.
  let runnerUpGap = Number.POSITIVE_INFINITY;
  if (oracle.maxScore !== null) for (const p of oracle.projections) if (!eq(p.score, oracle.maxScore)) runnerUpGap = Math.min(runnerUpGap, toNumber(sub(oracle.maxScore, p.score)));
  const tieUnresolvable = optimum !== null && runnerUpGap <= PRECISION_RELATIVE * Math.max(1, Math.abs(optimum));

  const world: CaseWorld = {
    fixture, request, oracle,
    feasibleKeys: new Set(oracle.projectionKeys),
    oracleScore: new Map(oracle.projections.map(p => [p.key, toNumber(p.score)])),
    validator: preparePhysicalValidator(lookup, params, { isAmmo: params.physicalOptions?.isAmmo, categoryChainOf: params.physicalOptions?.categoryChainOf, requirePathInstanceIds: true }),
  };
  const maximizerKeys = new Set(oracle.maximizers);
  const validatorIssues: string[] = [];
  const unqualified: string[] = [];
  const nativeErrors: string[] = [];
  const falseInfeasible: string[] = [];

  // --- the empty domain: production answers `empty (domain)` without a model ---
  if (domain.empty) {
    out.gateC = oracle.empty ? pass('both empty (the domain is empty: no model is built, as in solvePrecise)') : fail(`the domain is empty but the oracle has ${oracle.projections.length} feasible projection(s)`);
    for (const g of ['gateBObjective', 'gateBBuild', 'gateBPinned', 'gateBExclusion', 'gateASound', 'relaxedFirst', 'validators', 'native'] as const) out[g] = na('empty domain');
    out.gateAComplete = oracle.empty ? na('empty') : fail('empty domain');
    return out;
  }

  // --- nodes ---
  const ted = isTed(request);
  let nodes: (SpatialNode | undefined)[] = [undefined];
  if (ted) {
    const weights = structuralWeights(fixture, request);
    if (weights.length > (options.maxNodes ?? 200)) return skip(`${weights.length} weight nodes (above the cap)`);
    nodes = weights.map(w => ({ weightMin: w, weightMax: w }));
    out.nodes = nodes.length;
  }
  const weightOf = new Map<string, number>();
  for (const accepted of oracle.builds) if (!weightOf.has(accepted.projectionKey)) weightOf.set(accepted.projectionKey, toNumber(accepted.stats.weight));
  const nodeOf = (key: string): SpatialNode | undefined => {
    if (!ted) return undefined;
    const w = weightOf.get(key);
    return w === undefined ? undefined : { weightMin: w, weightMax: w };
  };

  const modelFor = (p: SolveParams, node: SpatialNode | undefined): CountModel => specializeCount(blueprint, domain, p, node);
  const contextFor = (model: CountModel): Context => ({ prod, model, tolerance, counters: out, unqualified, nativeErrors, falseInfeasible });
  const relaxEdges = prod.precise.PRECISE_EDGE_INTEGRALITY === 'relaxed-first';

  // --- Gate C and Gate B (objective and build), integer and relaxed texts, the request as given ---
  interface NodeResult { node: SpatialNode | undefined; model: CountModel; answer: Answer | null; relaxed: Settled | null; provedEmpty: boolean }
  const nodeResults: NodeResult[] = [];
  const soundness: string[] = [];
  const relaxedProblems: string[] = [];
  const precisionNotes: string[] = [];
  for (const node of nodes) {
    const model = modelFor(params, node);
    if (!model.exact) return skip(`the model of node ${JSON.stringify(node)} is not exact (${model.spatial?.penalty.kind ?? 'no spatial meta'})`);
    if (model.provedEmpty !== null) {
      nodeResults.push({ node, model, answer: null, relaxed: null, provedEmpty: true });
      continue;
    }
    const ctx = contextFor(model);
    const answer = await solveInteger(ctx, world, model, [], validatorIssues);
    for (const p of answer.problems) soundness.push(`main${node ? ` node ${node.weightMin}` : ''}: ${p}`);
    let relaxed: Settled | null = null;
    if (relaxEdges && model.edges.length > 0) {
      out.relaxedSolves++;
      relaxed = await settle(ctx, model, model.lpRelaxedEdges(), s => edgesIntegral(ctx, model, s.values) && judgePoint(ctx, world, model, s.values, s.objective, []).kind === 'accepted');
      if (relaxed.verdict === 'optimal' && !edgesIntegral(ctx, model, relaxed.first.values)) out.relaxedFractional++;
    }
    nodeResults.push({ node, model, answer, relaxed, provedEmpty: false });
  }

  const unsettled = nodeResults.filter(n => n.answer !== null && n.answer.settled.verdict === 'unsettled');
  const modelEmpty = nodeResults.every(n => n.provedEmpty || n.answer?.settled.verdict === 'infeasible');
  const feasibleNodes = nodeResults.filter(n => n.answer !== null && n.answer.settled.verdict === 'optimal');
  // TED: the singleton nodes partition the build space by weight, so EVERY node is gated: a node settled infeasible must hold no oracle feasible build.
  const feasibleWeights = new Set(weightOf.values());
  const nodeConflicts = nodeResults.filter(n => n.node !== undefined && (n.provedEmpty || n.answer?.settled.verdict === 'infeasible') && feasibleWeights.has(n.node.weightMin));
  if (unsettled.length > 0) out.gateC = fail(`unsettled verdict: ${unsettled[0].answer?.settled.detail}`);
  else if (nodeConflicts.length > 0) out.gateC = fail(`${nodeConflicts.length} weight node(s) infeasible in the model hold oracle feasible builds (first: ${nodeConflicts[0].node?.weightMin} kg${nodeConflicts[0].provedEmpty ? ', proved empty by the text' : ''})`);
  else if (modelEmpty !== oracle.empty) out.gateC = fail(oracle.empty ? `the oracle is empty but the model is feasible (objective ${feasibleNodes[0]?.answer?.settled.first.objective})` : 'the model is infeasible but the oracle has feasible builds');
  else out.gateC = pass(oracle.empty ? `both empty (${nodeResults.filter(n => n.provedEmpty).length} node(s) proved empty by the text, the rest settled infeasible)` : `both nonempty (${feasibleNodes.length} of ${nodeResults.length} node(s) feasible)`);

  // --- Gate B objective and build ---
  if (oracle.empty || optimum === null) {
    out.gateBObjective = na('no optimum (empty)');
    out.gateBBuild = na('no optimum (empty)');
  } else if (nearCap) {
    out.gateBObjective = na('near-cap gap below the solver tolerance: exact-arithmetic only');
    out.gateBBuild = na('near-cap gap below the solver tolerance: exact-arithmetic only');
  } else {
    // Production publishes the best verified build over the nodes; its node's objective is the model's optimum.
    const best = feasibleNodes.reduce<NodeResult | null>((a, n) => (a === null || (n.answer as Answer).settled.first.objective > (a.answer as Answer).settled.first.objective ? n : a), null);
    if (best === null || best.answer === null) {
      out.gateBObjective = fail('no feasible node');
      out.gateBBuild = fail('no build');
    } else {
      const value = best.answer.settled.first.objective;
      const verdict = compareObjective(value, optimum, caseSlack);
      out.maxObjectiveDelta = Math.max(out.maxObjectiveDelta, verdict.delta);
      for (const s of best.answer.settled.solves) if (s.status === 'Optimal' && s.dualBound !== null) out.maxDualGap = Math.max(out.maxDualGap, s.dualBound - s.objective);
      const text = `model optimum ${value} vs oracle maximum ${optimum} (delta ${verdict.delta.toExponential(2)})`;
      out.gateBObjective = verdict.status === 'pass' ? pass(text) : verdict.status === 'precision' ? precisionCell(text) : fail(text);
      const accepted = best.answer.accepted;
      if (accepted === null) out.gateBBuild = fail(`the optimal point does not decode to a validated build: ${best.answer.problems.slice(0, 2).join(' | ')}`);
      else {
        const scoreDelta = Math.abs(accepted.score - optimum);
        if (maximizerKeys.has(accepted.key)) out.gateBBuild = pass('decoded, both validators accept it, the projection is an oracle maximizer');
        else if (unresolvableGap || tieUnresolvable) out.gateBBuild = na(`decoded projection is within the unresolvable gap (exact score ${scoreDelta.toExponential(2)} below the maximum)`);
        else out.gateBBuild = fail(`the decoded projection ${accepted.key} is not a maximizer (exact score ${accepted.score}, maximum ${optimum})`);
      }
    }
  }

  // --- relaxed-first: the answers production can take from the relaxed text ---
  let relaxedChecked = 0;
  for (const n of nodeResults) {
    if (n.relaxed === null) continue;
    relaxedChecked++;
    const r = n.relaxed;
    const where = n.node ? ` (node ${n.node.weightMin})` : '';
    if (r.verdict === 'unsettled') relaxedProblems.push(`unsettled${where}: ${r.detail}`);
    else if (r.verdict === 'infeasible') {
      if (n.answer?.settled.verdict !== 'infeasible') relaxedProblems.push(`the relaxed text is infeasible but the integer text is ${n.answer?.settled.verdict}${where}`);
    } else if (n.answer?.settled.verdict === 'infeasible' && edgesIntegral(contextFor(n.model), n.model, r.first.values)) {
      const j = judgePoint(contextFor(n.model), world, n.model, r.first.values, r.first.objective, validatorIssues);
      if (j.kind === 'accepted') relaxedProblems.push(`an integral relaxed point ${j.key} is oracle-feasible but the integer text is infeasible${where}`);
      else if (j.kind === 'boundary') out.boundaryCuts++;
    } else if (edgesIntegral(contextFor(n.model), n.model, r.first.values)) {
      // An integral relaxed optimum is what production publishes for the node: it must be as good as the integer optimum and decode to an oracle build.
      const j = judgePoint(contextFor(n.model), world, n.model, r.first.values, r.first.objective, validatorIssues);
      if (j.kind === 'rejected') relaxedProblems.push(`integral relaxed point${where}: ${j.detail}`);
      else if (j.kind === 'boundary') out.boundaryCuts++; // production falls back to the integer text
      else if (n.answer?.settled.verdict === 'optimal') {
        const c = compareObjective(r.first.objective, n.answer.settled.first.objective, caseSlack);
        if (c.status === 'fail') relaxedProblems.push(`integral relaxed optimum ${r.first.objective} != integer optimum ${n.answer.settled.first.objective}${where}`);
        else if (c.status === 'precision') precisionNotes.push(`relaxed vs integer optimum delta ${c.delta.toExponential(2)}${where}`);
        const nodeBest = (n.answer.accepted?.score ?? Number.NaN);
        if (Number.isFinite(nodeBest) && j.score < nodeBest - caseSlack && !(unresolvableGap || tieUnresolvable)) relaxedProblems.push(`integral relaxed point ${j.key} scores ${j.score} below the node optimum ${nodeBest}${where}`);
      }
    } else if (n.answer?.settled.verdict === 'optimal') {
      // A fractional relaxed optimum is only a bound: it must not be below the integer optimum.
      if (r.first.objective < n.answer.settled.first.objective - caseSlack - PRECISION_RELATIVE * Math.max(1, Math.abs(r.first.objective))) {
        relaxedProblems.push(`fractional relaxed bound ${r.first.objective} below the integer optimum ${n.answer.settled.first.objective}${where}`);
      }
    }
  }
  out.relaxedFirst = !relaxEdges ? na('production runs the integer text only') : relaxedChecked === 0 ? na('no slot edges (the relaxed text is the integer text)')
    : relaxedProblems.length === 0 ? pass(`${relaxedChecked} relaxed node solve(s) consistent (${out.relaxedFractional} fractional, production falls back)`) : fail(relaxedProblems.slice(0, 3).join(' | '));

  // --- Gate A completeness and Gate B pinned maximizers: pin oracle projections in the integer text ---
  const pinFailures: string[] = [];
  const maxFailures: string[] = [];
  const maxPrecision: string[] = [];
  const records = oracle.projections;
  const limit = options.maxPinned ?? Number.POSITIVE_INFINITY;
  const pinnedRecords = records.length <= limit ? records : (() => {
    const must = records.filter(r => maximizerKeys.has(r.key));
    const rest = records.filter(r => !maximizerKeys.has(r.key));
    const room = Math.max(0, limit - must.length);
    const chosen = new Set(must);
    for (let k = 0; k < room && rest.length > 0; k++) chosen.add(rest[Math.floor((k * rest.length) / room)]);
    return records.filter(r => chosen.has(r));
  })();
  for (const record of pinnedRecords) {
    const projection = parseProjectionKey(record.key);
    const model = modelFor(params, nodeOf(record.key));
    out.pinned++;
    if (model.provedEmpty !== null) {
      pinFailures.push(`${record.key}: the node model is proved empty (${model.provedEmpty.reasons.join('; ')})`);
      if (maximizerKeys.has(record.key)) maxFailures.push(`${record.key}: node proved empty`);
      continue;
    }
    const ctx = contextFor(model);
    const text = withRows(model.lpBase, fastPinRows(model, projection));
    const seeds = prod.precise.PRECISE_RANDOM_SEEDS;
    let solved = await solveOnce(ctx, model, text, seeds[0]);
    if (solved.status !== 'Optimal') {
      // A pin's Infeasible is a claim the gates rely on: other seeds first, and any feasible answer wins (a feasible point is checked below).
      for (const seed of seeds.slice(1)) {
        const again = await solveOnce(ctx, model, text, seed);
        if (again.status === 'Optimal') {
          out.seedOverrides++;
          solved = again;
          break;
        }
      }
    }
    if (solved.status !== 'Optimal') {
      const check = await crossCheck(ctx, text);
      if (check !== null && judgePoint(ctx, world, model, check.values, check.objective, []).kind === 'accepted') {
        falseInfeasible.push(`pin ${record.key}: ${solved.rawStatus} under every production seed, feasible (validated point)`);
        if (process.env.COUNT_GATES_DUMP) writeFileSync(join(process.env.COUNT_GATES_DUMP, `false-infeasible-pin-${id}-${out.solves}.lp`), text);
        solved = check;
      }
    }
    if (solved.status !== 'Optimal') {
      pinFailures.push(`${record.key}: the pinned model is ${solved.rawStatus} under every seed`);
      if (maximizerKeys.has(record.key)) maxFailures.push(`${record.key}: pinned ${solved.rawStatus}`);
      continue;
    }
    // The pinned point is a lift of the projection: it must decode to a build of exactly that projection.
    const j = judgePoint(ctx, world, model, solved.values, solved.objective, validatorIssues);
    if (j.kind === 'rejected') pinFailures.push(`${record.key}: the pinned point ${j.detail}`);
    else if (j.kind === 'boundary') out.boundaryCuts++;
    const exact = toNumber(record.score);
    const c = compareObjective(solved.objective, exact, input.tolerance.absolute + 1e-9 * Math.max(1, Math.abs(exact)));
    out.maxObjectiveDelta = Math.max(out.maxObjectiveDelta, c.delta);
    if (maximizerKeys.has(record.key)) {
      if (c.status === 'fail') maxFailures.push(`${record.key}: pinned objective ${solved.objective} != ${exact}`);
      else if (c.status === 'precision') maxPrecision.push(`${record.key}: pinned objective delta ${c.delta.toExponential(2)}`);
    } else if (c.status === 'fail') {
      // Pointwise parity: the projection fixes the oracle score, and the best arrangement of the pinned projection in the model must score exactly it.
      pinFailures.push(`${record.key}: pinned objective ${solved.objective} != the exact score ${exact}`);
    } else if (c.status === 'precision') precisionNotes.push(`${record.key}: pinned objective delta ${c.delta.toExponential(2)}`);
  }
  out.gateAComplete = nearCap ? na('near-cap gap below the solver tolerance: exact-arithmetic only')
    : pinFailures.length === 0 ? pass(`${pinnedRecords.length} of ${records.length} oracle projection(s) feasible when pinned`) : fail(pinFailures.slice(0, 3).join(' | '));
  out.gateBPinned = oracle.empty ? na('no optimum (empty)') : nearCap ? na('near-cap gap below the solver tolerance: exact-arithmetic only')
    : maxFailures.length > 0 ? fail(maxFailures.slice(0, 3).join(' | '))
      : maxPrecision.length > 0 ? precisionCell(maxPrecision.slice(0, 3).join(' | '))
        : pass(`${oracle.maximizers.length} maximizer(s) attainable at the maximum`);

  // --- Gate B exclusion: no model point at the maximum outside the oracle's maximizers ---
  if (oracle.empty || optimum === null) out.gateBExclusion = na('no optimum (empty)');
  else if (nearCap) out.gateBExclusion = na('near-cap gap below the solver tolerance: exact-arithmetic only');
  else if (unresolvableGap || tieUnresolvable) out.gateBExclusion = na(`runner-up gap ${runnerUpGap.toExponential(2)} below the solver precision: ties are not decided`);
  else {
    const excess: string[] = [];
    const nearTies: string[] = [];
    let settledInfeasible = 0;
    const floor = optimum - caseSlack;
    for (const n of nodeResults) {
      if (n.provedEmpty || n.answer?.settled.verdict !== 'optimal') continue;
      if (n.answer.settled.first.objective < floor - PRECISION_RELATIVE * Math.max(1, Math.abs(optimum))) continue; // the node cannot reach the maximum
      const ctx = contextFor(n.model);
      const exclusion = maximizerExclusion(n.model, oracle.maximizers);
      const extra: IntegerNoGood[] = [];
      for (let round = 0; round < 24; round++) {
        const text = appendCuts(withRows(n.model.lpBase, [`gate_floor: total_obj >= ${floor}`]), [...exclusion, ...extra]);
        const settled = await settle(ctx, n.model, text, s => judgePoint(ctx, world, n.model, s.values, s.objective, []).kind === 'accepted');
        if (settled.verdict === 'infeasible') {
          settledInfeasible++;
          break;
        }
        if (settled.verdict === 'unsettled') {
          excess.push(`unsettled exclusion solve: ${settled.detail}`);
          break;
        }
        const point = settled.first;
        const j = judgePoint(ctx, world, n.model, point.values, point.objective, validatorIssues);
        if (j.kind === 'accepted') {
          if (j.score >= optimum - caseSlack) nearTies.push(`${j.key} (exact score ${optimum - j.score} below the maximum)`);
          else {
            const c = compareObjective(point.objective, j.score, caseSlack);
            if (c.status === 'fail') excess.push(`${j.key}: model objective ${point.objective} at the maximum, exact score ${j.score}`);
            else if (c.status === 'precision') precisionNotes.push(`exclusion admitted ${j.key} by delta ${c.delta.toExponential(2)}`);
          }
        } else if (j.kind === 'boundary') out.boundaryCuts++;
        else excess.push(`${j.key}: ${j.detail}`);
        const cut = integerNoGood(`gate_excl_nogood_${round}`, n.model.decision, point.values);
        if (cut === null) break;
        extra.push(cut);
      }
    }
    out.gateBExclusion = excess.length > 0 ? fail(excess.slice(0, 3).join(' | '))
      : nearTies.length > 0 ? na(`near ties within the case tolerance: ${nearTies.slice(0, 2).join('; ')}`)
        : pass(`with every one of the ${oracle.maximizers.length} maximizer projection(s) excluded, ${settledInfeasible} node model(s) at the maximum are settled infeasible`);
  }

  // --- Gate A soundness: objective directions, integer and relaxed texts ---
  const directions: Weights[] = objectiveDirections(seedOf(id), options.randomDirections ?? 3);
  let decodedCount = 0;
  for (const w of directions) {
    const p: SolveParams = { ...params, ergoWeight: w.e, recoilWeight: w.r, priceWeight: w.p };
    for (const node of nodes) {
      const model = modelFor(p, node);
      if (model.provedEmpty !== null) continue;
      const ctx = contextFor(model);
      const answer = await solveInteger(ctx, world, model, [], validatorIssues);
      for (const problem of answer.problems) soundness.push(`direction ${JSON.stringify(w)}: ${problem}`);
      if (answer.accepted !== null) decodedCount++;
      if (relaxEdges && model.edges.length > 0) {
        out.relaxedSolves++;
        const r = await solveOnce(ctx, model, model.lpRelaxedEdges(), prod.precise.PRECISE_RANDOM_SEEDS[0]);
        if (r.status !== 'Optimal') continue;
        if (!edgesIntegral(ctx, model, r.values)) {
          out.relaxedFractional++;
          continue;
        }
        const j = judgePoint(ctx, world, model, r.values, r.objective, validatorIssues);
        if (j.kind === 'accepted') decodedCount++;
        else if (j.kind === 'boundary') out.boundaryCuts++;
        else soundness.push(`direction ${JSON.stringify(w)} relaxed: ${j.detail}`);
      }
    }
  }
  out.gateASound = nearCap ? na('near-cap gap below the solver tolerance: exact-arithmetic only')
    : soundness.length === 0 ? pass(`${decodedCount} decoded point(s) over ${directions.length} direction(s) and both texts are oracle-feasible and accepted by both validators`) : fail(soundness.slice(0, 3).join(' | '));
  out.validators = validatorIssues.length === 0 ? pass(`${out.validated} decoded build(s): the reference and production validators agree`) : fail(validatorIssues.slice(0, 3).join(' | '));
  out.native = nativeErrors.length + falseInfeasible.length + unqualified.length === 0 ? pass(`${out.solves} solve(s): no native error, no false Infeasible, every production solve qualified by assessNativeResult`)
    : fail(`${unqualified.length} unqualified solve(s); ${nativeErrors.length} native SolveError(s) raised as SolverError; ${falseInfeasible.length} Infeasible or unsettled verdict(s) overturned by a validated point${[...unqualified, ...nativeErrors, ...falseInfeasible].slice(0, 2).map(x => ` | ${x}`).join('')}`);
  if (precisionNotes.length > 0 && out.gateBObjective.status === 'pass') out.gateBObjective = { status: 'pass', detail: `${out.gateBObjective.detail}; notes: ${precisionNotes.slice(0, 2).join('; ')}` };
  return out;
}

// ---------------------------------------------------------------------------------------------
// Tally
// ---------------------------------------------------------------------------------------------

export interface CountTally {
  cases: number;
  gated: number;
  refused: number;
  refusalFailures: string[];
  skipped: Record<string, number>;
  empty: number;
  nonEmpty: number;
  ted: number;
  solves: number;
  validated: number;
  pinned: number;
  boundaryCuts: number;
  seedOverrides: number;
  relaxedSolves: number;
  relaxedFractional: number;
  boundDisagreements: number;
  maxObjectiveDelta: number;
  maxDualGap: number;
  gate: Record<CountGateName, { pass: number; fail: number; na: number; precision: number }>;
  failures: { id: string; gate: string; detail: string }[];
  precision: { id: string; gate: string; detail: string }[];
}

export function newCountTally(): CountTally {
  const gate = Object.fromEntries(COUNT_GATES.map(g => [g, { pass: 0, fail: 0, na: 0, precision: 0 }])) as CountTally['gate'];
  return {
    cases: 0, gated: 0, refused: 0, refusalFailures: [], skipped: {}, empty: 0, nonEmpty: 0, ted: 0, solves: 0, validated: 0, pinned: 0, boundaryCuts: 0,
    seedOverrides: 0, relaxedSolves: 0, relaxedFractional: 0, boundDisagreements: 0, maxObjectiveDelta: 0, maxDualGap: 0, gate, failures: [], precision: [],
  };
}

export function addCount(t: CountTally, r: CountCaseGates): void {
  t.cases++;
  t.solves += r.solves;
  if (r.scope === 'refused') {
    t.refused++;
    if (r.refusal.status !== 'pass') t.refusalFailures.push(`${r.id}: ${r.refusal.detail}`);
    return;
  }
  if (r.scope === 'skipped') {
    const key = r.scopeDetail.replace(/\(.*$/, '').trim();
    t.skipped[key] = (t.skipped[key] ?? 0) + 1;
    return;
  }
  t.gated++;
  if (r.oracleEmpty) t.empty++;
  else t.nonEmpty++;
  if (r.nodes > 0) t.ted++;
  t.validated += r.validated;
  t.pinned += r.pinned;
  t.boundaryCuts += r.boundaryCuts;
  t.seedOverrides += r.seedOverrides;
  t.relaxedSolves += r.relaxedSolves;
  t.relaxedFractional += r.relaxedFractional;
  t.boundDisagreements += r.boundDisagreements;
  t.maxObjectiveDelta = Math.max(t.maxObjectiveDelta, r.maxObjectiveDelta);
  t.maxDualGap = Math.max(t.maxDualGap, r.maxDualGap);
  for (const g of COUNT_GATES) {
    const v = r[g];
    if (v.status === 'pass') t.gate[g].pass++;
    else if (v.status === 'fail') {
      t.gate[g].fail++;
      t.failures.push({ id: r.id, gate: g, detail: v.detail });
    } else if (v.status === 'precision') {
      t.gate[g].precision++;
      t.precision.push({ id: r.id, gate: g, detail: v.detail });
    } else t.gate[g].na++;
  }
}

export function formatCountTally(label: string, t: CountTally): string {
  const gates = COUNT_GATES.map(g => `${g} ${t.gate[g].pass}/${t.gate[g].pass + t.gate[g].fail + t.gate[g].precision}${t.gate[g].precision > 0 ? ` (+${t.gate[g].precision} precision)` : ''}`).join(', ');
  const skipped = Object.entries(t.skipped).map(([k, n]) => `${k} x${n}`).join(', ') || 'none';
  return `${label}: ${t.cases} case(s), ${t.gated} gated (${t.nonEmpty} nonempty, ${t.empty} empty, ${t.ted} TED), ${t.refused} refused (cyclic, ${t.refused - t.refusalFailures.length} refused correctly), skipped: ${skipped}; `
    + `pinned ${t.pinned}, validated ${t.validated}, boundary cuts ${t.boundaryCuts}, seed overrides ${t.seedOverrides}, relaxed solves ${t.relaxedSolves} (${t.relaxedFractional} fractional), unsettled bound disagreements ${t.boundDisagreements}, `
    + `max objective delta ${t.maxObjectiveDelta.toExponential(2)}, max dual gap ${t.maxDualGap.toExponential(2)}; native solves ${t.solves}; passing gates: ${gates}`;
}
