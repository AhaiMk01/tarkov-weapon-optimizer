// Runs production's `solve()` on one ledger case and grades the result against the reference on four separate
// dimensions, so partial progress shows (README.md in this directory defines them):
//
//   buildValid       the returned build, mapped back to a ReferenceBuild, is accepted by the reference validator
//                    (for an empty case: production returns no build);
//   scoreOptimal     the oracle's exact score of that build equals the exact maximum and its projection is a maximizer;
//   emptiness        production reports infeasibility exactly when the oracle's feasible set is empty;
//   outcomeContract  the response carries the admitted public outcome of ADR 0013 section 6 for the resolved mode.
//
// Grading is pure (`gradeOutcome`, `decodeBuild`): it takes an outcome (a response, a crash or an unsupported
// mapping), so the comparison itself is tested without production. Running production is the thin impure part
// (`runProduction`, `gradeCase`).
//
// Differential helper: may import production code (reference/independenceScan.ts); no non-differential file
// may import this one.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import type { SolveParams } from '../../src/solver/types';
import type { LedgerCase } from '../ledger/index';
import {
  childInstanceId, fromBinary64, inspectBuild, parseQ, projectBuild, projectionKey, resolveFixture, resolveRequest, ROOT_INSTANCE_ID,
  scoreBuild, sub, abs, le, eq, toNumber, validateReference,
  type BaseChoice, type Placement, type ReferenceBuild, type ReferenceFixture, type ReferenceRequest, type ReferenceSlot, type Violation,
} from '../oracle/index';
import { DIMENSIONS, MODES, type CaseScore, type DimensionResult, type DimensionResults, type ModeName } from './scoreboard';
import { toProduction, type ProductionInputs, type UnsupportedFeature } from './toProduction.differential';

// ---------------------------------------------------------------------------------------------
// Production's response, as far as the harness reads it
// ---------------------------------------------------------------------------------------------

/**
 * The slice of production's OptimizeResponse the harness reads. It is declared here, not imported, because
 * `api/client.ts` (where the real type lives) does not typecheck under tsconfig.reference.json (no DOM lib).
 * Fields production does not return today (certificate, qualifications, resolved precision, ...) are read from
 * the open index signature, so a missing field is a recorded finding, not a type error.
 */
export interface ProductionResponse {
  status: string;
  reason?: string;
  selected_items?: { id: string }[];
  selected_preset?: { id: string };
  /** `[slotId, itemId][]` today; `Placement[]` once ADR 0013 section 5 lands. Both are decoded. */
  slot_pairs?: unknown;
  [field: string]: unknown;
}

export type ProductionOutcome =
  | { kind: 'unsupported'; unsupported: UnsupportedFeature[] }
  | { kind: 'threw'; message: string }
  | { kind: 'response'; response: ProductionResponse };

const BUILD_STATUSES = ['optimal', 'feasible'];

/** True when production published a build (an optimal or feasible witness). */
export const returnsBuild = (response: ProductionResponse): boolean => BUILD_STATUSES.includes(response.status);

// ---------------------------------------------------------------------------------------------
// Decoding a response into a ReferenceBuild
// ---------------------------------------------------------------------------------------------

export interface DecodedBuild {
  build: ReferenceBuild;
  /** Ways the response was inconsistent or could not be mapped faithfully; any entry makes the build invalid. */
  issues: string[];
}

/** Parent instance id used for a placement whose parent could not be found, so the reference validator rejects it. */
export const UNRESOLVED_PARENT = 'unresolved-parent';
const MISSING_PRESET = '<no selected_preset>';

type Pair = { slotId: string; itemId: string; placement?: Placement };

function readPairs(raw: unknown, issues: string[]): Pair[] {
  if (raw === undefined || raw === null) {
    issues.push('response has no slot_pairs');
    return [];
  }
  if (!Array.isArray(raw)) {
    issues.push('slot_pairs is not a list');
    return [];
  }
  const pairs: Pair[] = [];
  raw.forEach((entry: unknown, index) => {
    if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') {
      pairs.push({ slotId: entry[0], itemId: entry[1] });
    } else if (typeof entry === 'object' && entry !== null) {
      const p = entry as Partial<Placement>;
      if (typeof p.parentInstanceId === 'string' && typeof p.slotId === 'string' && typeof p.childInstanceId === 'string' && typeof p.itemId === 'string') {
        pairs.push({ slotId: p.slotId, itemId: p.itemId, placement: { parentInstanceId: p.parentInstanceId, slotId: p.slotId, childInstanceId: p.childInstanceId, itemId: p.itemId } });
      } else issues.push(`slot_pairs[${index}] is neither [slotId, itemId] nor a Placement`);
    } else issues.push(`slot_pairs[${index}] is neither [slotId, itemId] nor a Placement`);
  });
  return pairs;
}

/**
 * Maps a build-bearing response back to a ReferenceBuild. A `[slotId, itemId]` pair does not name its parent, so it is
 * reconstructed from the fixture: the parent is the placed instance that declares that slot (the receiver first), taken
 * in the order production emitted the pairs (parents before children, resolved to a fixpoint). Anything that cannot be
 * placed still becomes a placement, with `UNRESOLVED_PARENT` as parent, so the reference validator rejects it with a
 * specific code instead of the harness hiding it. Placement objects (the section 5 transport) are used as given.
 */
export function decodeBuild(fixture: ReferenceFixture, request: ReferenceRequest, response: ProductionResponse): DecodedBuild {
  const issues: string[] = [];
  const weapon = fixture.weapons.find(w => w.id === request.weapon_id);
  const slotsOf = (itemId: string): readonly ReferenceSlot[] => {
    if (itemId === request.weapon_id) return weapon?.slots ?? [];
    return fixture.items.find(i => i.id === itemId)?.slots ?? [];
  };

  let base: BaseChoice;
  const presetId = response.selected_preset?.id;
  if (typeof presetId !== 'string') {
    issues.push('response has no selected_preset, so the base is unknown');
    base = { kind: 'preset', presetId: MISSING_PRESET };
  } else base = presetId === request.weapon_id ? { kind: 'naked' } : { kind: 'preset', presetId };

  const selected = (response.selected_items ?? []).map(i => i.id);
  const pairs = readPairs(response.slot_pairs, issues);
  const placements: Placement[] = [];

  const direct = pairs.filter(p => p.placement);
  for (const p of direct) placements.push(p.placement as Placement);

  // Legacy pairs: resolve parents against the instances placed so far.
  const instanceOf = new Map<string, string>([[request.weapon_id, ROOT_INSTANCE_ID]]);
  for (const p of placements) instanceOf.set(p.itemId, p.childInstanceId);
  const occupied = new Set<string>(placements.map(p => JSON.stringify([p.parentInstanceId, p.slotId])));
  let pending = pairs.filter(p => !p.placement);
  for (let progress = true; progress && pending.length > 0;) {
    progress = false;
    const stillPending: Pair[] = [];
    for (const pair of pending) {
      const owners = [...instanceOf.entries()].filter(([templateId]) => slotsOf(templateId).some(s => s.id === pair.slotId));
      const free = owners.filter(([, instance]) => !occupied.has(JSON.stringify([instance, pair.slotId])));
      const allowing = (list: typeof owners) => list.find(([templateId]) => slotsOf(templateId).find(s => s.id === pair.slotId)?.allowedItemIds.includes(pair.itemId));
      const chosen = allowing(free) ?? free[0] ?? allowing(owners) ?? owners[0];
      if (!chosen) {
        stillPending.push(pair);
        continue;
      }
      const parent = chosen[1];
      const child = childInstanceId(parent, pair.slotId, pair.itemId);
      placements.push({ parentInstanceId: parent, slotId: pair.slotId, childInstanceId: child, itemId: pair.itemId });
      occupied.add(JSON.stringify([parent, pair.slotId]));
      instanceOf.set(pair.itemId, child);
      progress = true;
    }
    pending = stillPending;
  }
  for (const pair of pending) {
    issues.push(`slot ${pair.slotId} (item ${pair.itemId}) has no placed owner`);
    placements.push({ parentInstanceId: UNRESOLVED_PARENT, slotId: pair.slotId, childInstanceId: childInstanceId(UNRESOLVED_PARENT, pair.slotId, pair.itemId), itemId: pair.itemId });
  }

  // selected_items and slot_pairs must describe the same installed multiset.
  const count = (ids: string[]) => ids.reduce((m, id) => m.set(id, (m.get(id) ?? 0) + 1), new Map<string, number>());
  const placed = count(placements.map(p => p.itemId));
  const listed = count(selected);
  for (const id of new Set([...placed.keys(), ...listed.keys()])) {
    if ((placed.get(id) ?? 0) !== (listed.get(id) ?? 0)) issues.push(`item ${id}: ${listed.get(id) ?? 0} in selected_items, ${placed.get(id) ?? 0} in slot_pairs`);
  }
  for (const [id, n] of listed) {
    // An item listed but never placed still takes part in the build, so the validator can reject it as unrooted.
    for (let k = placed.get(id) ?? 0; k < n; k++) {
      placements.push({ parentInstanceId: UNRESOLVED_PARENT, slotId: 'unplaced', childInstanceId: `${UNRESOLVED_PARENT}/unplaced:${id}#${k}`, itemId: id });
    }
  }
  return { build: { base, placements }, issues };
}

// ---------------------------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------------------------

const result = (verdict: DimensionResult['verdict'], reason: string, key?: string): DimensionResult => ({ verdict, reason, ...(key === undefined ? {} : { key }) });
const pass = (reason: string) => result('pass', reason);
const fail = (reason: string, key?: string) => result('fail', reason, key);
const notApplicable = (reason: string) => result('n/a', reason);

/** True when the dimension has nothing to grade for this case and mode. */
function scoreOptimalNotApplicable(c: LedgerCase, mode: ModeName): string | null {
  if (mode === 'fast') return 'Fast optimizes an approximate model; exact optimality is graded on Precise only';
  if (c.expected.empty) return 'the case has no feasible build, so there is no optimum to reach';
  return null;
}

/** One uniform failure for every applicable dimension (unsupported mapping, production crash). */
function failAll(c: LedgerCase, mode: ModeName, reason: string, key: string): DimensionResults {
  const out = {} as DimensionResults;
  for (const d of DIMENSIONS) {
    out[d] = d === 'scoreOptimal' && scoreOptimalNotApplicable(c, mode) !== null ? notApplicable(scoreOptimalNotApplicable(c, mode) as string) : fail(reason, key);
  }
  return out;
}

const codesOf = (violations: Violation[]) => [...new Set(violations.map(v => v.code))].sort();

type Verdict3 = 'infeasible' | 'build' | 'undetermined';

function classify(response: ProductionResponse): Verdict3 {
  if (response.status === 'infeasible') return 'infeasible';
  if (returnsBuild(response)) return 'build';
  return 'undetermined';
}

function gradeEmptiness(c: LedgerCase, mode: ModeName, response: ProductionResponse): DimensionResult {
  const verdict = classify(response);
  const reasonText = response.reason ? `: ${response.reason}` : '';
  if (c.expected.empty) {
    if (verdict === 'infeasible') return pass('expected empty; production reported infeasible');
    const admitted = c.admitted[mode];
    if (response.status === 'incomplete' && admitted.status === 'incomplete' && admitted.reason !== null && response.reason === admitted.reason) {
      return pass(`expected empty; production reported the admitted empty outcome (incomplete, "${admitted.reason}")`);
    }
    if (verdict === 'build') return fail(`expected empty; production returned a build (status ${response.status})`, 'build returned for an empty case');
    return fail(`expected empty; production returned no verdict (status ${response.status}${reasonText})`, `no verdict (status ${response.status})`);
  }
  if (verdict === 'build') return pass('expected nonempty; production returned a build');
  if (verdict === 'infeasible') return fail(`expected nonempty; production reported infeasible${reasonText}`, 'false infeasibility');
  return fail(`expected nonempty; production returned no verdict (status ${response.status}${reasonText})`, `no verdict (status ${response.status})`);
}

interface BuildCheck {
  decoded: DecodedBuild | null;
  violations: Violation[];
  /** True when there is a build, it decoded cleanly and the reference validator accepted it. */
  valid: boolean;
}

function checkBuild(c: LedgerCase, response: ProductionResponse): BuildCheck {
  if (!returnsBuild(response)) return { decoded: null, violations: [], valid: false };
  const decoded = decodeBuild(c.fixture, c.request, response);
  const { violations } = validateReference(c.fixture, c.request, decoded.build);
  return { decoded, violations, valid: decoded.issues.length === 0 && violations.length === 0 };
}

function gradeBuildValid(c: LedgerCase, response: ProductionResponse, check: BuildCheck): DimensionResult {
  if (c.expected.empty) {
    if (!check.decoded) return pass(`no build returned (status ${response.status}), as the case is empty`);
    return fail(`returned a build for an empty case${check.violations.length ? ` (reference validator: ${codesOf(check.violations).join(', ')})` : ''}`, 'build returned for an empty case');
  }
  if (!check.decoded) return fail(`no build returned (status ${response.status})`, `no build returned (status ${response.status})`);
  if (check.decoded.issues.length > 0) return fail(`response could not be decoded: ${check.decoded.issues.join('; ')}`, 'response could not be decoded');
  if (check.violations.length > 0) {
    const codes = codesOf(check.violations);
    return fail(`reference validator rejected the build: ${codes.join(', ')} (${check.violations.slice(0, 3).map(v => v.detail).join('; ')})`, `validator: ${codes.join(', ')}`);
  }
  return pass('the reference validator accepts the returned build');
}

function gradeScoreOptimal(c: LedgerCase, mode: ModeName, check: BuildCheck): DimensionResult {
  const na = scoreOptimalNotApplicable(c, mode);
  if (na !== null) return notApplicable(na);
  if (!check.valid || !check.decoded) return fail('no valid build to score', 'no valid build to score');
  const fixture = resolveFixture(c.fixture);
  const request = resolveRequest(c.fixture, c.request);
  const { stats } = inspectBuild(fixture, request, check.decoded.build);
  if (stats === null) return fail('the build has no computable statistics', 'no valid build to score');
  const score = scoreBuild(stats, request);
  const optimum = parseQ(c.expected.maxScore as string);
  const key = projectionKey(projectBuild(check.decoded.build));
  if (eq(score, optimum)) {
    return c.expected.maximizers.includes(key)
      ? pass(`exact score ${toNumber(score)} equals the optimum and the projection is a maximizer`)
      : fail('the score equals the optimum but the projection is not among the expected maximizers', 'projection not a maximizer');
  }
  const tolerance = c.runtimeTolerance;
  if (tolerance.kind === 'tiny_positive_gap' && !tolerance.resolvableAtTolerance && le(abs(sub(score, optimum)), fromBinary64(tolerance.absolute))) {
    return pass(`score ${toNumber(score)} is within the runtime tolerance ${tolerance.absolute} of the optimum ${toNumber(optimum)}; the gap ${tolerance.gap} is below it, so the two builds are not distinguishable at that tolerance`);
  }
  return fail(`score ${toNumber(score)} differs from the exact optimum ${toNumber(optimum)}`, 'score is not the optimum');
}

const isNull = (v: unknown) => v === null || v === undefined;

function gradeOutcomeContract(c: LedgerCase, mode: ModeName, response: ProductionResponse): DimensionResult {
  const admitted = c.admitted[mode];
  const optimization = (response.optimization ?? {}) as { termination?: unknown };
  const missing: string[] = [];
  const wrong: string[] = [];
  const detail: string[] = [];
  const compare = (field: string, expected: unknown, actual: unknown, nullable: boolean) => {
    const same = nullable && expected === null ? isNull(actual) : actual === expected;
    if (same) return;
    if (actual === undefined) missing.push(field);
    else wrong.push(field);
    detail.push(`${field}: expected ${JSON.stringify(expected)}, ${actual === undefined ? 'missing' : `got ${JSON.stringify(actual)}`}`);
  };
  compare('status', admitted.status, response.status, false);
  compare('physical_certificate', admitted.physical_certificate, response.physical_certificate, false);
  compare('model_qualification', admitted.model_qualification, response.model_qualification, false);
  compare('moa_qualification', admitted.moa_qualification, response.moa_qualification, false);
  compare('precision_resolved', mode, response.precision_resolved, false);
  // `reason` is a closed set (ADR 0013 section 6): the admitted reason when one is required, otherwise none at all.
  compare('reason', admitted.reason, response.reason, true);
  compare('termination', admitted.termination, optimization.termination, false);
  if (detail.length === 0) return pass(`response matches the admitted ${mode} outcome (${admitted.status} / ${admitted.physical_certificate})`);
  const parts: string[] = [];
  if (missing.length) parts.push(`missing ${missing.join(', ')}`);
  if (wrong.length) parts.push(`wrong ${wrong.join(', ')}`);
  return fail(detail.join('; '), `outcome: ${parts.join('; ')}`);
}

/** Grades one production outcome against one ledger case in one mode. Pure. */
export function gradeOutcome(c: LedgerCase, mode: ModeName, outcome: ProductionOutcome): DimensionResults {
  if (outcome.kind === 'unsupported') {
    const features = outcome.unsupported.map(u => u.feature);
    const details = outcome.unsupported.map(u => u.detail).join('; ');
    return failAll(c, mode, `unsupported: ${details}`, `unsupported: ${[...new Set(features)].join('+')}`);
  }
  if (outcome.kind === 'threw') {
    const firstLine = outcome.message.split('\n')[0];
    return failAll(c, mode, `production threw: ${firstLine}`, `production threw: ${firstLine.slice(0, 70)}`);
  }
  const response = outcome.response;
  const check = checkBuild(c, response);
  return {
    buildValid: gradeBuildValid(c, response, check),
    scoreOptimal: gradeScoreOptimal(c, mode, check),
    emptiness: gradeEmptiness(c, mode, response),
    outcomeContract: gradeOutcomeContract(c, mode, response),
  };
}

// ---------------------------------------------------------------------------------------------
// Running production
// ---------------------------------------------------------------------------------------------

// solver.ts imports dataService (IndexedDB) and the API client (Worker), neither of which typechecks under
// tsconfig.reference.json (no DOM lib), so it is loaded at run time through a non-literal specifier. The slice of
// its surface that is used is declared below.
const SOLVER_MODULE = '../../src/solver/solver.ts';
type Solve = (params: SolveParams) => Promise<ProductionResponse>;
let solveFn: Solve | undefined;

async function loadSolve(): Promise<Solve> {
  if (!solveFn) solveFn = ((await import(SOLVER_MODULE)) as { solve: Solve }).solve;
  return solveFn;
}

/** Runs production once. Console output of the solver is silenced; a throw becomes a `threw` outcome. */
export async function runProduction(params: SolveParams): Promise<ProductionOutcome> {
  const saved = { error: console.error, warn: console.warn, log: console.log };
  try {
    const solve = await loadSolve();
    console.error = console.warn = console.log = () => {};
    return { kind: 'response', response: await solve(params) };
  } catch (error) {
    return { kind: 'threw', message: error instanceof Error ? `${error.name}: ${error.message}` : `non-Error thrown: ${String(error)}` };
  } finally {
    console.error = saved.error;
    console.warn = saved.warn;
    console.log = saved.log;
  }
}

export interface GradedCase extends CaseScore {
  /** What production did per mode: `unsupported`, `threw` or the response status. */
  observed: Record<ModeName, string>;
  elapsedMs: Record<ModeName, number>;
}

export type Runner = (params: SolveParams) => Promise<ProductionOutcome>;

export interface GradeOptions {
  runner?: Runner;
  /** Request-wide deadline per production call. */
  timeLimitMs?: number;
}

async function outcomeFor(c: LedgerCase, mode: ModeName, options: GradeOptions): Promise<{ outcome: ProductionOutcome; unsupported: UnsupportedFeature[] }> {
  let inputs: ProductionInputs;
  try {
    inputs = toProduction(c.fixture, c.request, { preciseMode: mode === 'precise', timeLimitMs: options.timeLimitMs ?? 20_000, objectiveTolerance: c.runtimeTolerance.absolute });
  } catch (error) {
    return { outcome: { kind: 'threw', message: `mapping failed: ${error instanceof Error ? error.message : String(error)}` }, unsupported: [] };
  }
  if (inputs.unsupported.length > 0) return { outcome: { kind: 'unsupported', unsupported: inputs.unsupported }, unsupported: inputs.unsupported };
  return { outcome: await (options.runner ?? runProduction)(inputs.params), unsupported: [] };
}

/** Maps, runs (Precise primary, then Fast) and grades one ledger case. A case with an unsupported feature is not run. */
export async function gradeCase(c: LedgerCase, options: GradeOptions = {}): Promise<GradedCase> {
  const grades = {} as Record<ModeName, DimensionResults>;
  const observed = {} as Record<ModeName, string>;
  const elapsedMs = {} as Record<ModeName, number>;
  let unsupported: UnsupportedFeature[] = [];
  for (const mode of MODES) {
    const started = performance.now();
    const run = await outcomeFor(c, mode, options);
    const outcome = run.outcome;
    unsupported = unsupported.length ? unsupported : run.unsupported;
    grades[mode] = gradeOutcome(c, mode, outcome);
    observed[mode] = outcome.kind === 'response' ? outcome.response.status : outcome.kind;
    elapsedMs[mode] = performance.now() - started;
  }
  return {
    id: c.id,
    family: c.family,
    unsupported: [...new Set(unsupported.map(u => u.feature))],
    precise: grades.precise,
    fast: grades.fast,
    observed,
    elapsedMs,
  };
}

// ---------------------------------------------------------------------------------------------
// Production's Node HiGHS loader
// ---------------------------------------------------------------------------------------------

export interface LoaderProbe {
  /**
   * `custom`: `public/highs.js` and `public/highs.wasm` exist under the working directory, so solver.ts's Node path will
   * try them. `stock-fallback`: they do not, so solver.ts silently loads the stock `highs` npm package instead.
   * Either way a failure while evaluating the custom build is also swallowed and falls back to the stock package, which
   * this probe cannot observe.
   */
  path: 'custom' | 'stock-fallback';
  cwd: string;
  wasmSha256: string | null;
}

/** Mirrors the file check of solver.ts's `loadHiGHS` Node branch (it resolves `public/highs.*` against `process.cwd()`). */
export function probeNodeLoader(cwd: string = process.cwd()): LoaderProbe {
  const wasmPath = resolvePath(cwd, 'public/highs.wasm');
  const jsPath = resolvePath(cwd, 'public/highs.js');
  const custom = existsSync(wasmPath) && existsSync(jsPath);
  return { path: custom ? 'custom' : 'stock-fallback', cwd, wasmSha256: custom ? createHash('sha256').update(readFileSync(wasmPath)).digest('hex') : null };
}
