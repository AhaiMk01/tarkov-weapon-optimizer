// Deterministic behavioural regressions (Stage 3 workstream 3.6b; ADR 0013 section 7: "deterministic behavioral regressions"). The same request gives the
// same build, status and certificate
//
//   - across repeated runs: a fresh state (a newly mapped lookup, so nothing memoized on it), the same lookup again (warm blueprint and model caches),
//     and through the worker runtime a fresh runtime against one reused runtime (warm data, compatibility-map and endpoint caches);
//   - across the second-opinion seeds when a certificate is issued: the three `random_seed` values of production Precise (0, 11, 29) are permuted, so
//     a different seed decides first and confirms second; status, certificate and the certified score must not move (a tie may pick another of the
//     maximizers; then the score is the same and the build is reported, and a ledger case with a single maximizer must give the same build);
//   - across native pool sizes (docs/stage3/parallel-pool.md): pool size 1 (the in-thread instance) and 3 (worker_threads lanes with early second
//     opinions and prefetched nodes) give the same response bit for bit, the build included (ledger Precise; MP5, SR-25, M4A1 and AKMS TrueErgo).
//
// On every Stage 1 ledger case in scope (Precise and Fast; the cyclic ones are out of scope) and on pinned real guns (MP5, SR-25 and M4A1 plain; MP5 TrueErgo; MP5 Sweet Spot for the endpoint cache).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { OptimizeResponse } from '../../src/api/client';
import type { LoadedState } from '../../src/solver/dataService';
import { buildItemLookup } from '../../src/solver/dataService';
import { solve } from '../../src/solver/solver';
import { DEFAULT_TRADER_LEVELS } from '../../src/solver/types';
import type { ItemLookup } from '../../src/solver/types';
import { createWorkerRuntime } from '../../src/solver/workerRuntime';
import type { WorkerOutMessage } from '../../src/solver/workerProtocol';
import { LEDGER } from '../../reference/ledger/index';
import type { LedgerCase } from '../../reference/ledger/index';
import { OUT_OF_SCOPE_CASES } from '../../reference/harness/scoreboard';
import { toProduction } from '../../reference/harness/toProduction.differential';
import { withNative } from '../runtime/operationsMatrix.harness';
import { configureNativePool, shutdownNativePool } from '../../src/solver/native/pool';
import type { NativeHook } from '../runtime/operationsMatrix.harness';

// ---------------------------------------------------------------------------------------------------------------------------
// What must be identical
// ---------------------------------------------------------------------------------------------------------------------------

/** Everything a repeated run must reproduce bit for bit: the public envelope, the build and its proof. Timing is excluded. */
function fingerprint(r: OptimizeResponse): string {
  return JSON.stringify({
    status: r.status, certificate: r.physical_certificate, reason: r.reason ?? null,
    precision: [r.precision_request, r.precision_resolved, r.model_qualification, r.moa_qualification],
    preset: r.selected_preset?.id ?? null, items: r.selected_item_ids, placements: r.slot_pairs,
    objective: r.objective_value, optimization: r.optimization, stats: r.final_stats ?? null, ideal: r.ideal_point ?? null,
  });
}

/** What the seed permutation must not move: the public verdict and the certified score. */
const verdictOf = (r: OptimizeResponse) => ({ status: r.status, certificate: r.physical_certificate, reason: r.reason ?? null, resolved: r.precision_resolved });
const buildOf = (r: OptimizeResponse): string => JSON.stringify({ preset: r.selected_preset?.id ?? null, placements: r.slot_pairs });
/** The projection the ledger's maximizers are written in (ADR 0013 section 7 Gate A): the chosen base and the installed multiset, not the tree ids. */
const projectionOf = (r: OptimizeResponse): string => JSON.stringify({ preset: r.selected_preset?.id ?? null, items: [...r.selected_item_ids].sort() });
/**
 * Below this request tolerance a certificate may be withheld by one seed and issued by another (owner decision 5b): the native integrality tolerance is
 * 1e-7, so a solve may report a bound about 1e-7 high, and the second opinion keeps the LARGEST qualified bound of all its solves. Conservative (a lost
 * certificate, never a wrong one); measured here, not assumed.
 */
const SEED_SENSITIVE_TOLERANCE = 1e-7;

const SEEDS = [0, 11, 29] as const;
/** The native `random_seed` mapped through `perm`: production asks for SEEDS[k], the solve uses perm[k]. */
const permuted = (perm: readonly number[]): NativeHook => async (call, real) => {
  if (Number.isNaN(call.seed)) return real();
  const k = SEEDS.indexOf(call.seed as (typeof SEEDS)[number]);
  assert.ok(k >= 0, `unexpected seed ${call.seed}`);
  call.options.random_seed = perm[k];
  return real();
};
const PERMUTATIONS = [[11, 29, 0], [29, 0, 11]] as const;
/** No hook: the native solve as production calls it. */
const honest: NativeHook = async (_call, real) => real();

// ---------------------------------------------------------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------------------------------------------------------

/** The ledger cases production supports: the cyclic ones are out of scope (owner decision 2026-10-12; production throws an internal error on them). */
const IN_SCOPE = LEDGER.filter(c => !Object.hasOwn(OUT_OF_SCOPE_CASES, c.id));

const inputsOf = (c: LedgerCase, precise: boolean) =>
  toProduction(c.fixture, c.request, { preciseMode: precise, timeLimitMs: 20_000, objectiveTolerance: c.runtimeTolerance.absolute });

interface LedgerRow { id: string; mode: 'precise' | 'fast'; certified: boolean; status: string; seedBuildChanged: boolean; uniqueMaximizer: boolean }
const ledgerRows: LedgerRow[] = [];

test('ledger: every case gives the same response on a fresh state, on warm caches and on a second fresh state, in both modes', { timeout: 900_000 }, async () => {
  const problems: string[] = [];
  for (const c of IN_SCOPE) {
    for (const precise of [true, false]) {
      const first = inputsOf(c, precise);
      if (first.unsupported.length > 0) { problems.push(`${c.id}: unsupported ${first.unsupported.map(u => u.feature).join(',')}`); continue; }
      const fresh = await withNative(honest, () => solve(first.params));
      const warm = await withNative(honest, () => solve({ ...first.params }));
      const again = await withNative(honest, () => solve(inputsOf(c, precise).params));
      const mode = precise ? 'precise' : 'fast';
      if (fingerprint(warm) !== fingerprint(fresh)) problems.push(`${c.id} ${mode}: warm caches changed the response`);
      if (fingerprint(again) !== fingerprint(fresh)) problems.push(`${c.id} ${mode}: a second fresh state changed the response`);
      ledgerRows.push({
        id: c.id, mode, certified: fresh.physical_certificate === 'certified_optimal' || fresh.physical_certificate === 'certified_infeasible',
        status: fresh.status, seedBuildChanged: false, uniqueMaximizer: c.expected.maximizers.length === 1,
      });
    }
  }
  assert.deepEqual(problems, [], `${problems.length} problem(s)`);
  assert.equal(ledgerRows.length, IN_SCOPE.length * 2);
});

test('ledger: across the second-opinion seed permutations a certified Precise answer keeps its status, certificate and score (decision 5b losses listed); a unique maximizer keeps its projection', { timeout: 900_000 }, async t => {
  const problems: string[] = [];
  const lost: string[] = [];
  let certified = 0;
  let tieBuildsMoved = 0;
  let treesMoved = 0;
  for (const c of IN_SCOPE) {
    const base = await withNative(honest, () => solve(inputsOf(c, true).params));
    if (base.physical_certificate !== 'certified_optimal' && base.physical_certificate !== 'certified_infeasible') continue;
    certified++;
    for (const perm of PERMUTATIONS) {
      const r = await withNative(permuted(perm), () => solve(inputsOf(c, true).params));
      const label = `${c.id} seeds ${perm.join('/')}`;
      if (JSON.stringify(verdictOf(r)) !== JSON.stringify(verdictOf(base))) {
        // The only admissible change: a certified optimum whose certificate another seed order withholds, at a tolerance below the 5b effect, with the
        // same verified build kept (feasible / feasible, the prerequisite reason). Anything else, above all a different certified claim, is a failure.
        const withheldOnly = base.status === 'optimal' && r.status === 'feasible' && r.physical_certificate === 'feasible'
          && r.reason === 'Required proof prerequisite unavailable' && base.optimization.tolerance < SEED_SENSITIVE_TOLERANCE && r.objective_value === base.objective_value;
        if (withheldOnly) lost.push(`${label} (tolerance ${base.optimization.tolerance})`);
        else problems.push(`${label}: ${JSON.stringify(verdictOf(base))} -> ${JSON.stringify(verdictOf(r))}`);
        continue;
      }
      if (base.objective_value === null) { if (r.objective_value !== null) problems.push(`${label}: an emptiness gained an objective`); continue; }
      const tolerance = base.optimization.tolerance;
      if (r.objective_value === null || Math.abs(r.objective_value - base.objective_value) > tolerance) problems.push(`${label}: certified score ${base.objective_value} -> ${String(r.objective_value)}`);
      if (buildOf(r) !== buildOf(base)) treesMoved++;
      if (projectionOf(r) !== projectionOf(base)) {
        const row = ledgerRows.find(x => x.id === c.id && x.mode === 'precise');
        if (row) row.seedBuildChanged = true;
        // A single exact maximizer must be found again, unless the ledger itself says the runtime tolerance cannot separate it from the runner-up
        // (`resolvableAtTolerance: false`: any build within the tolerance is a correct certified optimum).
        if (c.expected.maximizers.length === 1 && c.runtimeTolerance.resolvableAtTolerance) problems.push(`${label}: the single maximizer's projection moved`);
        else tieBuildsMoved++;
      }
    }
  }
  t.diagnostic(`${certified} certified Precise ledger answers x ${PERMUTATIONS.length} seed permutations; ${tieBuildsMoved} tie answer(s) picked another maximizer; ${treesMoved} answer(s) placed the same parts in another legal tree`);
  t.diagnostic(`certificates withheld under another seed order (decision 5b, tolerance < ${SEED_SENSITIVE_TOLERANCE}): ${lost.join(', ') || 'none'}`);
  assert.deepEqual(problems, [], `${problems.length} problem(s)`);
  assert.ok(certified >= 100, `only ${certified} certified answers`);
  // Pinned so a change shows: exactly these two cases, both at the 1e-9 runtime tolerance, under both permutations that put seed 29 among the deciding solves.
  assert.deepEqual([...new Set(lost.map(l => l.split(' ')[0]))].sort(), ['F01-legal-alternative-placement', 'F13-reduction-counterexample-multi-copy-capacity']);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Pinned real guns through the worker runtime
// ---------------------------------------------------------------------------------------------------------------------------

const SNAPSHOT_PATH = fileURLToPath(new URL('../../benchmarks/snapshot.json', import.meta.url));
const SNAPSHOT_SHA256 = '219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c';
const skip = existsSync(SNAPSHOT_PATH) ? false : 'frontend/benchmarks/snapshot.json is not restored (ADR 0013 section 1)';

let snapshot: { guns: unknown[]; mods: unknown[] } | null = null;
const freshLookup = (): ItemLookup => {
  if (snapshot === null) {
    const bytes = readFileSync(SNAPSHOT_PATH);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), SNAPSHOT_SHA256, 'the snapshot must be the pinned artifact');
    snapshot = JSON.parse(bytes.toString('utf8')) as { guns: unknown[]; mods: unknown[] };
  }
  return buildItemLookup(snapshot.guns as never, snapshot.mods as never);
};

const MP5 = '5926bb2186f7744b1c6c6e60';
const SR25 = '5df8ce05b11454561e39243b';
const M4A1 = '5447a9cd4bdc2dbd208b4567';
const COMMON = { trader_levels: DEFAULT_TRADER_LEVELS, player_level: 60, flea_available: true, ergo_weight: 1, recoil_weight: 1, price_weight: 0, precise_mode: 'precise' };
const PINNED: { name: string; request: Record<string, unknown> }[] = [
  { name: 'MP5 plain', request: { weapon_id: MP5, ...COMMON } },
  { name: 'SR-25 plain', request: { weapon_id: SR25, ...COMMON } },
  { name: 'M4A1 plain', request: { weapon_id: M4A1, ...COMMON } },
  { name: 'MP5 TrueErgo', request: { weapon_id: MP5, ...COMMON, use_true_ergo: true } },
  { name: 'MP5 Sweet Spot (endpoint cache)', request: { weapon_id: MP5, ...COMMON, use_tchebycheff: true, price_weight: 1 } },
  { name: 'MP5 Fast', request: { weapon_id: MP5, ...COMMON, precise_mode: 'fast' } },
];

/** A runtime over one loaded lookup; `optimize` sends one request and returns its result. */
function pinnedRuntime(lookup: ItemLookup) {
  const posted: WorkerOutMessage[] = [];
  const state: LoadedState = { guns: [], mods: [], itemLookup: lookup, loadedAt: 0, generation: 1 };
  const runtime = createWorkerRuntime({ post: m => { posted.push(m); }, loadData: async () => state });
  let id = 0;
  return async (request: Record<string, unknown>): Promise<OptimizeResponse> => {
    const mine = ++id;
    runtime.receive({ type: 'optimize', id: mine, payload: { request: request as never, lang: 'en', gameMode: 'regular', deadline: performance.timeOrigin + performance.now() + 120_000 } });
    await runtime.idle();
    const m = posted.filter(p => p.id === mine && p.type !== 'snapshot');
    assert.equal(m.length, 1);
    assert.equal(m[0].type, 'result', JSON.stringify(m[0].payload));
    return m[0].payload as OptimizeResponse;
  };
}

test('pinned guns: a fresh runtime, the same runtime again (warm caches) and a second fresh runtime give the same build, status and certificate', { skip, timeout: 900_000 }, async t => {
  const coldA = pinnedRuntime(freshLookup());
  const coldB = pinnedRuntime(freshLookup());
  const problems: string[] = [];
  for (const { name, request } of PINNED) {
    const fresh = await withNative(honest, () => coldA(request));
    const warm = await withNative(honest, () => coldA(request));
    const second = await withNative(honest, () => coldB(request));
    t.diagnostic(`${name}: ${fresh.status} / ${fresh.physical_certificate}, ${fresh.selected_item_ids.length} parts, objective ${fresh.objective_value}${fresh.endpoint_cache ? `, endpoint cache ${fresh.endpoint_cache} then ${warm.endpoint_cache}` : ''}`);
    if (fresh.status !== 'optimal') problems.push(`${name}: not optimal (${fresh.status} ${fresh.reason ?? ''})`);
    if (fingerprint(warm) !== fingerprint(fresh)) problems.push(`${name}: warm caches changed the response`);
    if (fingerprint(second) !== fingerprint(fresh)) problems.push(`${name}: a second fresh runtime changed the response`);
    if (request.use_tchebycheff === true) {
      assert.equal(fresh.endpoint_cache, 'miss', name);
      assert.equal(warm.endpoint_cache, 'hit', `${name}: the warm request reused the certified payoff table`);
    }
  }
  assert.deepEqual(problems, []);
});

test('pinned guns: across the second-opinion seed permutations every certificate, status and certified score is unchanged', { skip, timeout: 900_000 }, async t => {
  const optimize = pinnedRuntime(freshLookup());
  const problems: string[] = [];
  for (const { name, request } of PINNED) {
    if (request.precise_mode !== 'precise' || request.use_tchebycheff === true) continue; // the Sweet Spot table is cached; seeds are checked on a cold one
    const base = await withNative(honest, () => optimize(request));
    assert.equal(base.physical_certificate, 'certified_optimal', name);
    for (const perm of PERMUTATIONS) {
      const r = await withNative(permuted(perm), () => optimize(request));
      const label = `${name} seeds ${perm.join('/')}`;
      if (JSON.stringify(verdictOf(r)) !== JSON.stringify(verdictOf(base))) problems.push(`${label}: ${JSON.stringify(verdictOf(r))}`);
      if (r.objective_value === null || Math.abs(r.objective_value - (base.objective_value as number)) > base.optimization.tolerance) problems.push(`${label}: score ${base.objective_value} -> ${String(r.objective_value)}`);
      t.diagnostic(`${label}: ${r.status} / ${r.physical_certificate}, objective ${r.objective_value}, build ${buildOf(r) === buildOf(base) ? 'same' : projectionOf(r) === projectionOf(base) ? 'same parts in another legal tree' : 'another maximizer (equal certified score)'}`);
    }
  }
  assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------------------------------------------------------------------
// The native solve pool (docs/stage3/parallel-pool.md): pool sizes 1 and 3 give the same response bit for bit
// ---------------------------------------------------------------------------------------------------------------------------

const AKMS = '59ff346386f77477562ff5e2';
const POOL_SIZES = [1, 3] as const;

/** Run `body` with the shared native pool configured to `size` (1 = no pool, the in-thread instance), then restore the default. */
async function withPoolSize<T>(size: number, body: () => Promise<T>): Promise<T> {
  configureNativePool({ size });
  try {
    return await body();
  } finally {
    await shutdownNativePool();
    configureNativePool({});
  }
}

test('ledger: pool sizes 1 and 3 give the same Precise response bit for bit on every in-scope case', { timeout: 900_000 }, async t => {
  const problems: string[] = [];
  const responses = new Map<number, Map<string, string>>();
  for (const size of POOL_SIZES) {
    const bySize = new Map<string, string>();
    responses.set(size, bySize);
    await withPoolSize(size, async () => {
      for (const c of IN_SCOPE) {
        const inputs = inputsOf(c, true);
        if (inputs.unsupported.length > 0) continue;
        bySize.set(c.id, fingerprint(await solve(inputs.params)));
      }
    });
  }
  for (const [id, one] of responses.get(1) as Map<string, string>) {
    if ((responses.get(3) as Map<string, string>).get(id) !== one) problems.push(`${id}: pool size 3 changed the response`);
  }
  t.diagnostic(`${(responses.get(1) as Map<string, string>).size} ledger cases compared`);
  assert.deepEqual(problems, []);
  assert.ok((responses.get(1) as Map<string, string>).size >= 100);
});

test('pinned guns: pool sizes 1 and 3 give the same response bit for bit (MP5, SR-25, M4A1 and AKMS TrueErgo; MP5 plain and Sweet Spot)', { skip, timeout: 900_000 }, async t => {
  const requests: { name: string; request: Record<string, unknown> }[] = [
    ...PINNED.filter(p => p.request.precise_mode === 'precise'),
    { name: 'SR-25 TrueErgo', request: { weapon_id: SR25, ...COMMON, use_true_ergo: true } },
    { name: 'M4A1 TrueErgo', request: { weapon_id: M4A1, ...COMMON, use_true_ergo: true } },
    { name: 'AKMS TrueErgo', request: { weapon_id: AKMS, ...COMMON, use_true_ergo: true } },
    { name: 'M4A1 TrueErgo + Prevent Overswing', request: { weapon_id: M4A1, ...COMMON, use_true_ergo: true, prevent_overswing: true, equip_ergo_modifier: -0.3 } },
  ];
  const bySize = new Map<number, string[]>();
  for (const size of POOL_SIZES) {
    bySize.set(size, await withPoolSize(size, async () => {
      const optimize = pinnedRuntime(freshLookup());
      const out: string[] = [];
      for (const { name, request } of requests) {
        const r = await optimize(request);
        t.diagnostic(`pool ${size} ${name}: ${r.status} / ${r.physical_certificate}, objective ${r.objective_value}, ${r.solve_time_ms.toFixed(0)} ms`);
        out.push(fingerprint(r));
      }
      return out;
    }));
  }
  const problems = requests.filter((_, k) => (bySize.get(1) as string[])[k] !== (bySize.get(3) as string[])[k]).map(r => `${r.name}: pool size 3 changed the response`);
  assert.deepEqual(problems, []);
});
