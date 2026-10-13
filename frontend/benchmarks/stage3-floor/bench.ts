// Stage 3 workstream 3.7: one job of the MOA floor measurement (ADR 0013 section 7). A job is one frozen case and one repetition, run in a FRESH
// node process: the request is sent cold, then the identical request is sent warm to the same worker runtime.
//
//   npx tsx benchmarks/stage3-floor/bench.ts --case <id> --rep <n> --out <job .jsonl file> [--cases cases.json]   (normally spawned by driver.ts)
//
// The path is the worker's: `createWorkerRuntime` receives a `computeMOAFloor` message whose epoch deadline is stamped exactly as the client stamps it
// (`now + resolveTimeLimit(time_limit_ms, DEFAULT_FLOOR_TIME_LIMIT_MS)`), with its default data loader (`ensureDataLoaded`, seeded from the pinned
// snapshot through `seedDataCache`), its own validation, guard and `domainParams`. Two seams are used, both for observation only:
//   - `deps.runMoaFloor` runs `runMoaFloorDetailed` (the function production's `runMoaFloor` returns `.response` of) on the worker's own `baseParams`
//     and guard, with production's `publishSnapshot`, so the trace (each query, trial count, stop cause) is kept;
//   - `deps.query` of that call is production's `preciseFloorQuery` body verbatim (guard check, `floorQueryParams`, `solvePrecise` with
//     `MOA_FLOOR_NATIVE_STOP` and `stopAtFirstWitness: true`, `floorQueryResultOf`) with the native solve wrapped by a recorder, so the per-query
//     `PreciseResult` telemetry (rejected candidates, nodes) and every native call (options in effect, stop code, duration) are captured. A source
//     check below refuses to run if production's query body changes.
// Every witness of every query, and the response witness, is re-validated with the production validator (`validatePhysicalBuild`).
import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { MOAFloorRequest, MOAFloorResponse } from '../../src/api/client';
import { seedDataCache } from '../../src/solver/dataService';
import {
  floorQueryParams, floorQueryResultOf, MOA_FLOOR_BRACKET_TOLERANCE, MOA_FLOOR_DEFAULT_TIME_LIMIT_MS, MOA_FLOOR_MAX_TRIALS, MOA_FLOOR_NATIVE_STOP,
  runMoaFloorDetailed,
} from '../../src/solver/moaFloor';
import type { FloorQuery, FloorQueryResult, MoaFloorRequest, MoaFloorRun } from '../../src/solver/moaFloor';
import { nativeSolve } from '../../src/solver/physical/nativeSolve';
import type { SolveFn } from '../../src/solver/physical/nativeSolve';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import type { PreciseResult } from '../../src/solver/physical/solvePrecise';
import { validatePhysicalBuild } from '../../src/solver/physical';
import { PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import { epochNow } from '../../src/solver/requestGuard';
import { guardStop } from '../../src/solver/runtimeGuard';
import type { SolveParams } from '../../src/solver/types';
import { createWorkerRuntime } from '../../src/solver/workerRuntime';
import type { FloorRunInput } from '../../src/solver/workerRuntime';
import { DEFAULT_FLOOR_TIME_LIMIT_MS, resolveTimeLimit } from '../../src/solver/workerProtocol';
import type { WorkerOutMessage } from '../../src/solver/workerProtocol';

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

const argv = process.argv.slice(2);
const arg = (name: string, fallback?: string): string => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
};
const caseId = arg('case');
const rep = Number(arg('rep'));
const outFile = arg('out');
/** The frozen case file, next to this script: cases.json (primary) or cases-addendum.json (the declared post-hoc addendum). */
const casesFile = arg('cases', 'cases.json');

// ---------------------------------------------------------------------------------------------
// Frozen identities: refuse to measure anything else
// ---------------------------------------------------------------------------------------------

interface FrozenCase { id: string; group: string; weapon: string; intent: string; request: MOAFloorRequest }
interface Frozen {
  identities: {
    snapshot: { sha256: string };
    highs: { manifestSha256: string; artifacts: Record<string, { sha256: string }>; onDisk: Record<string, string> };
    toolchain: { node: string; tsx: string };
    source: { gitTip: string; srcTree: string };
  };
  policy: { timeLimitMs: number; maxTrials: number; bracketTolerance: number; nativeStop: Record<string, number> };
  cases: FrozenCase[];
}
const casesPath = here(`./${casesFile}`);
const casesSha256 = sha256(casesPath);
const frozen = JSON.parse(readFileSync(casesPath, 'utf8')) as Frozen;
const fail = (what: string): never => { throw new Error(`identity mismatch: ${what}`); };
const snapshotPath = here('../snapshot.json');
if (sha256(snapshotPath) !== frozen.identities.snapshot.sha256) fail('snapshot');
if (sha256(here('../../public/highs-build-manifest.json')) !== frozen.identities.highs.manifestSha256) fail('HiGHS manifest');
for (const name of ['highs.js', 'highs.wasm']) {
  const onDisk = sha256(here(`../../public/${name}`));
  if (onDisk !== frozen.identities.highs.artifacts[name].sha256 || onDisk !== frozen.identities.highs.onDisk[name]) fail(name);
}
if (process.version !== frozen.identities.toolchain.node) fail('node version');
// Production source identity: the frontend/src tree at the tip and a clean working copy of it (the tip itself may move with test-only commits).
const gitTip = execSync('git rev-parse HEAD', { encoding: 'utf8', cwd: here('../..') }).trim();
const srcTree = execSync('git rev-parse HEAD:frontend/src', { encoding: 'utf8', cwd: here('../..') }).trim();
if (srcTree !== frozen.identities.source.srcTree) fail('frontend/src tree');
if (execSync('git status --porcelain -- src', { encoding: 'utf8', cwd: here('../..') }).trim() !== '') fail('frontend/src has uncommitted changes');
// The production policy constants the cases were frozen against.
if (MOA_FLOOR_DEFAULT_TIME_LIMIT_MS !== frozen.policy.timeLimitMs || DEFAULT_FLOOR_TIME_LIMIT_MS !== frozen.policy.timeLimitMs) fail('floor budget');
if (MOA_FLOOR_MAX_TRIALS !== frozen.policy.maxTrials) fail('trial cap');
if (MOA_FLOOR_BRACKET_TOLERANCE !== frozen.policy.bracketTolerance) fail('bracket tolerance');
if (JSON.stringify({ ...MOA_FLOOR_NATIVE_STOP }) !== JSON.stringify(frozen.policy.nativeStop)) fail('native stop');
// Drift guard: the instrumented query below is production's `preciseFloorQuery` body; refuse to run if that body changed.
const floorSource = readFileSync(here('../../src/solver/moaFloor.ts'), 'utf8');
for (const line of [
  'const stop = guardStop(guard);',
  "if (stop !== null) return { kind: 'stopped', reason: stopReasonOf(stop) };",
  'const params = floorQueryParams(request, cap);',
  'const result = await solvePrecise({ params, guard, nativeStop: MOA_FLOOR_NATIVE_STOP, stopAtFirstWitness: true, ...(solve === undefined ? {} : { solve }) });',
  'return floorQueryResultOf(request, params, cap, result);',
  'return searchMoaFloor(input.baseParams, input.guard, { ...floorDeps, publishSnapshot: snapshot => input.publishSnapshot(snapshot) });',
]) {
  const source = line.startsWith('return searchMoaFloor') ? readFileSync(here('../../src/solver/workerRuntime.ts'), 'utf8') : floorSource;
  if (!source.includes(line)) fail(`production floor path changed (${line.slice(0, 60)}...)`);
}
const frozenCase = frozen.cases.find(c => c.id === caseId) ?? fail(`unknown case ${caseId}`);

// ---------------------------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------------------------

const OPTION_KEYS = ['mip_max_improving_sols', 'time_limit', 'presolve', 'random_seed', 'mip_rel_gap', 'mip_abs_gap', 'mip_feasibility_tolerance',
  'primal_feasibility_tolerance', 'dual_feasibility_tolerance'];

interface NativeCall {
  query: number;
  startMs: number;
  wallMs: number;
  status?: string;
  statusCode?: number;
  primal?: string;
  objective?: number | null;
  dualBound?: number | null;
  nodes?: number | null;
  cols?: number;
  rows?: number;
  integers?: number;
  readMs?: number;
  runMs?: number;
  requested?: Record<string, unknown>;
  effective?: Record<string, unknown>;
  /** Objective as HiGHS parsed it: nonzero cost columns (count and up to 4 names) and the offset. */
  costNonzeros?: number | null;
  costColumns?: string[];
  objectiveOffset?: number | null;
  error?: string;
}

interface QueryRecord {
  index: number;
  cap: number | null;
  startMs: number;
  wallMs: number;
  launched: boolean;
  precise?: { kind: string; status?: string; termination?: string; reason?: string; certificate?: string; nodes?: number; spatial?: boolean; completed?: boolean };
  telemetry?: Record<string, number>;
  floor: { kind: string; qualified?: boolean; reason?: string; achievedMoa?: number; nativeStop?: string };
  validation?: { ok: boolean; violations: string[]; moaExactMatches: boolean; withinCap: boolean | null; moa: number | null; ted: number | null; weight: number | null };
  nativeCalls: number;
}

const TELEMETRY_KEYS = ['nativeSolves', 'rejectedCandidates', 'relaxedEdgeSolves', 'relaxedEdgeFallbacks', 'secondOpinions', 'thirdOpinions', 'disagreements',
  'unsettledDisagreements', 'inconclusiveSolves', 'extraSeedSolves', 'relaxationChecks', 'relaxationVetoes', 'relaxationRescues', 'unqualifiedSolves',
  'provedEmptyNodes', 'confirmedInfeasible', 'presolveRescues', 'boundShortfall', 'columns', 'rows'];

const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as { guns: unknown[]; mods: unknown[] };

// Production logs diagnostics to the console; keep the job log for this script's own lines.
const log = console.error.bind(console);
console.log = console.warn = console.info = console.debug = () => {};

async function measure(cache: 'cold' | 'warm', runtime: ReturnType<typeof createWorkerRuntime>, inbox: Map<number, WorkerOutMessage[]>, id: number,
  capture: { run: MoaFloorRun | null; baseParams: SolveParams | null; queries: QueryRecord[]; calls: NativeCall[]; t0: number }): Promise<Record<string, unknown>> {
  const request = JSON.parse(JSON.stringify(frozenCase.request)) as MOAFloorRequest;
  capture.run = null; capture.baseParams = null; capture.queries = []; capture.calls = [];
  const t0 = epochNow();
  capture.t0 = t0;
  const deadline = t0 + resolveTimeLimit(request.time_limit_ms, DEFAULT_FLOOR_TIME_LIMIT_MS);
  const done = new Promise<{ message: WorkerOutMessage; at: number }>(resolve => {
    const poll = (): void => {
      const messages = inbox.get(id) ?? [];
      const final = messages.find(m => m.type === 'result' || m.type === 'error');
      if (final !== undefined) resolve({ message: final, at: (final as WorkerOutMessage & { at: number }).at });
      else setTimeout(poll, 5);
    };
    poll();
  });
  runtime.receive({ type: 'computeMOAFloor', id, payload: { request, lang: 'en', gameMode: 'regular', deadline } });
  const { message, at } = await done;
  const endToEndMs = at - t0;
  const snapshots = (inbox.get(id) ?? []).filter(m => m.type === 'snapshot').length;
  // Set by the floor driver while the request ran (the control flow analysis cannot see that through the await).
  const baseParams = capture.baseParams as SolveParams | null;
  const line: Record<string, unknown> = {
    case: frozenCase.id, group: frozenCase.group, weapon: frozenCase.weapon, rep, cache, casesFile, casesSha256, gitTip,
    endToEndMs, deadlineOvershootMs: at - deadline, messageType: message.type, snapshots,
  };
  if (message.type === 'error') {
    line.status = 'error';
    line.error = JSON.stringify(message.payload).slice(0, 2000);
  } else {
    const response = message.payload as MOAFloorResponse;
    line.status = response.status;
    line.response = { ...response, witness: response.witness === undefined ? undefined : { achieved_moa: response.witness.achieved_moa, base: response.witness.base,
      selected_item_ids: response.witness.selected_item_ids, max_moa: response.witness.scope.max_moa } };
    // Re-validate the response witness under the cap it was found at (production validator, instance paths required).
    if (response.witness !== undefined && baseParams !== null) {
      const w = response.witness;
      const v = validatePhysicalBuild(baseParams.itemLookup, { ...baseParams, maxMOA: w.scope.max_moa }, { base: w.base, placements: w.slot_pairs },
        { requirePathInstanceIds: true });
      line.responseWitnessValidation = {
        ok: v.ok, violations: v.violations.map(x => JSON.stringify(x).slice(0, 300)), moa: v.stats?.moa ?? null, ted: v.stats?.ted ?? null,
        floorEnclosesMoa: v.stats !== null && response.floor !== null && response.floor >= v.stats.moa,
        displayAtLeastFloor: response.display_floor === null ? null : response.floor !== null && response.display_floor >= response.floor,
      };
    }
  }
  const run = capture.run as MoaFloorRun | null;
  if (run !== null) {
    line.trials = run.trials;
    line.ended = run.ended;
    line.trace = run.trace;
    const lo = run.response.proved_lower_bound;
    const hi = run.response.floor;
    line.bracketGap = lo !== null && hi !== null ? hi - lo : null;
  }
  if (baseParams !== null) {
    const { itemLookup: _l, compatibilityMap: _c, guard: _g, ...rest } = baseParams;
    void _l; void _c; void _g;
    line.baseParams = rest;
  }
  line.queries = capture.queries;
  line.nativeCalls = capture.calls;
  return line;
}

async function main(): Promise<void> {
  const loadStarted = performance.now();
  seedDataCache('en', 'regular', snapshot.guns as never, snapshot.mods as never);
  const dataLoadMs = performance.now() - loadStarted;

  const capture = { run: null as MoaFloorRun | null, baseParams: null as SolveParams | null, queries: [] as QueryRecord[], calls: [] as NativeCall[], t0: 0 };
  let currentQuery = -1;
  let highsIdentity: { version: string; githash: string; runtimeId: number } | null = null;
  const recordingSolve: SolveFn = async (lpText, options, extras) => {
    const started = epochNow();
    const call: NativeCall = { query: currentQuery, startMs: started - capture.t0, wallMs: 0, requested: Object.fromEntries(Object.entries(options).filter(([k]) => OPTION_KEYS.includes(k))) };
    capture.calls.push(call);
    try {
      const r = await nativeSolve(lpText, options, extras);
      highsIdentity ??= { version: r.highsVersion, githash: r.githash, runtimeId: r.runtimeId };
      call.wallMs = epochNow() - started;
      call.status = r.modelStatus.name;
      call.statusCode = r.modelStatus.code;
      call.primal = r.primalSolutionStatus.name;
      call.objective = r.objectiveValue;
      call.dualBound = r.mipDualBound;
      call.nodes = r.mipNodeCount;
      call.cols = r.model.numCol;
      call.rows = r.model.numRow;
      call.integers = r.model.numInteger;
      call.readMs = r.wallMs.read;
      call.runMs = r.wallMs.run;
      call.effective = Object.fromEntries(Object.entries(r.effectiveOptions).filter(([k]) => OPTION_KEYS.includes(k)));
      if (r.readback !== null) {
        const nz: string[] = [];
        let count = 0;
        r.readback.colCost.forEach((c, j) => { if (c !== 0) { count++; if (nz.length < 4) nz.push(r.readback?.colNames[j] ?? String(j)); } });
        call.costNonzeros = count;
        call.costColumns = nz;
        call.objectiveOffset = r.readback.objectiveOffset;
      } else {
        call.costNonzeros = null;
        call.objectiveOffset = null;
      }
      return r;
    } catch (error) {
      call.wallMs = epochNow() - started;
      call.error = String(error).slice(0, 400);
      throw error;
    }
  };

  // Production's `preciseFloorQuery` body (see the header) with the recorder as the native solve and the result kept.
  const instrumentedQuery = (request: MoaFloorRequest): FloorQuery => async (cap, guard) => {
    const index = capture.queries.length;
    currentQuery = index;
    const startedAt = epochNow();
    const rec: QueryRecord = { index, cap, startMs: startedAt - capture.t0, wallMs: 0, launched: false, floor: { kind: 'stopped' }, nativeCalls: 0 };
    capture.queries.push(rec);
    const finishRecord = (result: FloorQueryResult): FloorQueryResult => {
      rec.wallMs = epochNow() - startedAt;
      rec.nativeCalls = capture.calls.filter(c => c.query === index).length;
      rec.floor = result.kind === 'witness'
        ? { kind: 'witness', achievedMoa: result.witness.achievedMoa, nativeStop: result.witness.nativeStop }
        : result.kind === 'empty' ? { kind: 'empty', qualified: result.qualified, ...(result.reason === undefined ? {} : { reason: result.reason }) }
          : { kind: 'stopped', reason: result.reason };
      return result;
    };
    const stop = guardStop(guard);
    if (stop !== null) return finishRecord({ kind: 'stopped', reason: stop === 'cancelled' ? PUBLIC_REASONS.cancelledByUser : PUBLIC_REASONS.timeLimitReached });
    const params = floorQueryParams(request, cap);
    rec.launched = true;
    const result: PreciseResult = await solvePrecise({ params, guard, nativeStop: MOA_FLOOR_NATIVE_STOP, stopAtFirstWitness: true, solve: recordingSolve });
    const { outcome, summary } = result;
    rec.precise = {
      kind: result.kind, status: outcome.status, termination: outcome.termination ?? undefined, reason: outcome.reason ?? undefined,
      certificate: outcome.physical_certificate ?? undefined, nodes: summary.nodes, spatial: summary.spatial, completed: summary.completed,
    };
    const t = summary.telemetry as unknown as Record<string, unknown>;
    rec.telemetry = Object.fromEntries(TELEMETRY_KEYS.filter(k => typeof t[k] === 'number').map(k => [k, t[k] as number]));
    const floorResult = floorQueryResultOf(request, params, cap, result);
    if (floorResult.kind === 'witness') {
      const w = floorResult.witness;
      const v = validatePhysicalBuild(params.itemLookup, params, { base: w.build.base, placements: w.build.slot_pairs }, { requirePathInstanceIds: true });
      rec.validation = {
        ok: v.ok, violations: v.violations.map(x => JSON.stringify(x).slice(0, 300)), moaExactMatches: v.stats?.exact.moa === w.moaExact,
        withinCap: cap === null ? null : v.stats !== null && v.stats.moa <= cap, moa: v.stats?.moa ?? null, ted: v.stats?.ted ?? null, weight: v.stats?.weight ?? null,
      };
    }
    return finishRecord(floorResult);
  };

  const inbox = new Map<number, WorkerOutMessage[]>();
  const runtime = createWorkerRuntime({
    post: message => {
      const stamped = { ...message, at: epochNow() } as WorkerOutMessage & { at: number };
      const list = inbox.get(message.id) ?? [];
      list.push(stamped);
      inbox.set(message.id, list);
    },
    runMoaFloor: async (input: FloorRunInput) => {
      capture.baseParams = input.baseParams;
      const run = await runMoaFloorDetailed(input.baseParams, input.guard, {
        query: instrumentedQuery(input.baseParams),
        publishSnapshot: s => input.publishSnapshot(s),
      });
      capture.run = run;
      return run.response;
    },
  });

  for (const [cache, id] of [['cold', 1], ['warm', 2]] as const) {
    let line: Record<string, unknown>;
    try {
      line = await measure(cache, runtime, inbox, id, capture);
    } catch (error) {
      line = { case: frozenCase.id, group: frozenCase.group, weapon: frozenCase.weapon, rep, cache, casesSha256, status: 'error', error: String(error).slice(0, 2000) };
    }
    line.dataLoadMs = dataLoadMs;
    line.highs = highsIdentity;
    appendFileSync(outFile, `${JSON.stringify(line)}\n`);
    log(`${frozenCase.id} rep ${rep} ${cache}: ${String(line.status)} ${Math.round(Number(line.endToEndMs ?? NaN))} ms trials ${String(line.trials)} ended ${String(line.ended)}`);
  }
}

main().then(() => process.exit(0), error => { log(error); process.exit(1); });
