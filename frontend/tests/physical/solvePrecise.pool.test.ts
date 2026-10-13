// Precise on a solve pool (docs/stage3/parallel-pool.md; src/solver/physical/speculativeSolves.ts): the pipeline is unchanged and the pool only computes
// solves early, so EVERY result must equal the sequential one, whatever order the lanes finish in. Tested with fake lanes that run the given solve after
// random delays (seeded, so a failure reproduces), many lanes and every speculation setting, on:
//   - the scripted defect solvers of the second-opinion tests (a lying first, second or third seed, three disagreeing seeds, a timed-out or unqualified
//     second opinion, an infeasibility against a found point, inconclusive seeds, a limit-stopped first opinion): concurrent opinions settle as
//     sequential ones;
//   - seeded TrueErgo / Prevent Overswing worlds (spatial search with prefetched nodes);
// plus: pool size 1 is the direct path, a cancel or the deadline backstop terminates the in-flight solves (ADR 0013 section 6 precedence), and the early
// solves of a request never outlive it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HighsOptions, NativeResult, SolveExtras } from '../../src/solver/native';
import { AbandonedSolveError } from '../../src/solver/native/pool';
import type { SolveLanes, SolveTicket } from '../../src/solver/native/pool';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { fixedGuard } from '../../src/solver/runtimeGuard';
import type { ItemLookup, SolveParams } from '../../src/solver/types';
import { preparePhysicalWeapon } from '../../src/solver/physical';
import { nativeSolve } from '../../src/solver/physical/nativeSolve';
import type { SolveFn } from '../../src/solver/physical/nativeSolve';
import { PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import { PRECISE_RANDOM_SEEDS, PRECISE_SPECULATION, solvePrecise } from '../../src/solver/physical/solvePrecise';
import type { PreciseContext, PreciseResult, Speculation } from '../../src/solver/physical/solvePrecise';
import { DEADLINE_GRACE_MS } from '../../src/solver/physical/speculativeSolves';
import { gun, lookupOf, mod, slot, WEAPON } from './lpFixtures';
import { randomTedWorld, rng } from './randomWorlds';

const [FIRST, SECOND, THIRD] = PRECISE_RANDOM_SEEDS;
const FAR = (): number => performance.now() + 120_000;

// ---------------------------------------------------------------------------------------------
// Fake lanes
// ---------------------------------------------------------------------------------------------

interface FakeLanes extends SolveLanes {
  started: number;
  abandoned: number;
  maxInFlight: number;
  inFlight: () => number;
}

/** `size` lanes that run `solve` after a random delay (and hold the answer another random delay), finishing in a random order. Seeded. */
function fakeLanes(solve: SolveFn, size: number, seed: number, maxDelayMs = 6): FakeLanes {
  const rand = rng(seed);
  const delay = (): Promise<void> => new Promise(resolve => setTimeout(resolve, Math.floor(rand() * maxDelayMs)));
  const running = new Set<object>();
  const lanes: FakeLanes = {
    size, started: 0, abandoned: 0, maxInFlight: 0,
    inFlight: () => running.size,
    start(lpText: string, options: HighsOptions, extras: SolveExtras): SolveTicket {
      lanes.started++;
      const token = {};
      running.add(token);
      lanes.maxInFlight = Math.max(lanes.maxInFlight, running.size);
      let abandon: () => void = () => undefined;
      const result = new Promise<NativeResult>((resolve, reject) => {
        let gone = false;
        abandon = () => { if (!gone) { gone = true; running.delete(token); lanes.abandoned++; reject(new AbandonedSolveError()); } };
        void (async () => {
          await delay();
          if (gone) return;
          try {
            const r = await solve(lpText, options, extras);
            await delay();
            if (!gone) { gone = true; running.delete(token); resolve(r); }
          } catch (error) {
            if (!gone) { gone = true; running.delete(token); reject(error); }
          }
        })();
      });
      result.catch(() => undefined);
      return { result, abandon: () => abandon(), promote: () => undefined };
    },
  };
  return lanes;
}

// ---------------------------------------------------------------------------------------------
// What must be equal
// ---------------------------------------------------------------------------------------------

/** Everything the sequential run decides: verdict, certificate, score, bounds, the build itself, the node count and every deterministic counter. */
function answer(r: PreciseResult): string {
  const { readbackMs: _r, secondOpinionMs: _s, pool: _p, ...counters } = r.summary.telemetry;
  return JSON.stringify({
    kind: r.kind, outcome: r.outcome,
    certified: r.kind === 'build' ? r.certified : null,
    score: r.kind === 'build' ? r.best.score : null,
    build: r.kind === 'build' ? r.best.build : null,
    stats: r.kind === 'build' ? r.best.stats : null,
    bounds: r.summary.bounds, nodes: r.summary.nodes, completed: r.summary.completed, counters,
  });
}

const SETTINGS: { speculation: Speculation; prefetchNodes: number; size: number }[] = [
  { speculation: 'always', prefetchNodes: 0, size: 2 },
  { speculation: 'always', prefetchNodes: 1, size: 3 },
  { speculation: 'unsplittable', prefetchNodes: 2, size: 4 },
  { speculation: 'off', prefetchNodes: 3, size: 3 },
];

/** Solve `context` sequentially and on fake lanes under every setting (two delay seeds each): every answer must be the sequential one. */
async function samePooled(label: string, context: Omit<PreciseContext, 'deadline' | 'lanes'>, solve: SolveFn = nativeSolve): Promise<PreciseResult> {
  const sequential = await solvePrecise({ ...context, deadline: FAR(), solve, lanes: null });
  const expected = answer(sequential);
  for (const setting of SETTINGS) {
    for (const seed of [1, 2]) {
      const lanes = fakeLanes(solve, setting.size, seed * 7919 + setting.size);
      const pooled = await solvePrecise({ ...context, deadline: FAR(), solve, lanes, speculation: setting.speculation, prefetchNodes: setting.prefetchNodes });
      assert.equal(answer(pooled), expected, `${label}: ${JSON.stringify(setting)} delay seed ${seed}`);
      assert.equal(lanes.inFlight(), 0, `${label}: nothing started early outlives the request`);
      const pool = pooled.summary.telemetry.pool;
      if (pooled.summary.telemetry.nativeSolves === 0) continue; // decided before any solve (an empty domain): the pool was never needed
      assert.ok(pool !== undefined && pool.lanes === setting.size, `${label}: the pool telemetry is reported`);
      assert.equal(pool.used + pool.direct, pooled.summary.telemetry.nativeSolves, `${label}: every solve the pipeline read was either early or direct`);
    }
  }
  return sequential;
}

// ---------------------------------------------------------------------------------------------
// Fixtures and scripted solvers (as in solvePrecise.secondOpinion.test.ts)
// ---------------------------------------------------------------------------------------------

const choice = (parts: { id: string; ergo: number }[]): ItemLookup => lookupOf(
  gun(WEAPON, { weight: 1, ergo: 0, slots: [slot('choice', parts.map(p => p.id), true)] }),
  ...parts.map(p => [p.id, mod(p.id, { weight: 0, ergo: p.ergo })] as [string, ReturnType<typeof mod>]),
);
const paramsOf = (lookup: ItemLookup, extra: Partial<SolveParams> = {}): SolveParams => ({
  weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup), ergoWeight: 1, recoilWeight: 0, priceWeight: 0, ...extra,
});
const countColumn = (lookup: ItemLookup, id: string): string => `n_${preparePhysicalWeapon(lookup, WEAPON).templateIndexOf(id)}`;
const withRows = (lp: string, rows: string[]): string => {
  const at = lp.indexOf('\nBounds\n');
  return `${lp.slice(0, at)}\n${rows.map(r => `  ${r}`).join('\n')}${lp.slice(at)}`;
};
const lyingOn = (lies: Record<number, string[]>): SolveFn => async (lp, options, extras) => {
  const real = await nativeSolve(lp, options, extras);
  const rows = lies[Number(options.random_seed ?? 0)];
  if (rows === undefined) return real;
  const wrong = await nativeSolve(withRows(lp, rows), options);
  return { ...real, colValues: wrong.colValues, objectiveValue: wrong.objectiveValue, mipDualBound: wrong.mipDualBound };
};
const statusOn = (seed: number, status: { code: number; name: string }, keepPrimal: boolean): SolveFn => async (lp, options, extras) => {
  const real = await nativeSolve(lp, options, extras);
  if (Number(options.random_seed ?? 0) !== seed) return real;
  return { ...real, modelStatus: status, ...(keepPrimal ? {} : { colValues: null, objectiveValue: null, mipDualBound: null }) } as unknown as NativeResult;
};
const inconclusiveOn = (seeds: readonly number[]): SolveFn => async (lp, options, extras) => {
  const real = await nativeSolve(lp, options, extras);
  if (!seeds.includes(Number(options.random_seed))) return real;
  return { ...real, modelStatus: { code: 4, name: 'SolveError' }, colValues: null, objectiveValue: null, mipDualBound: null } as unknown as NativeResult;
};

test('the production default speculates every second opinion', () => {
  assert.equal(PRECISE_SPECULATION, 'always');
});

test('pool size 1 is the direct path: no early solve, no pool telemetry, the same answer', async () => {
  const lookup = choice([{ id: 'a', ergo: 10 }, { id: 'b', ergo: 25 }]);
  const direct = await solvePrecise({ params: paramsOf(lookup), deadline: FAR(), lanes: null });
  const lanes = fakeLanes(nativeSolve, 1, 5);
  const one = await solvePrecise({ params: paramsOf(lookup), deadline: FAR(), lanes });
  assert.equal(lanes.started, 0, 'a one-lane pool is not used');
  assert.equal(one.summary.telemetry.pool, undefined);
  assert.equal(answer(one), answer(direct));
});

test('concurrent opinions settle as sequential ones: the scripted defect solvers of decision 5a give the same answers on every pool setting', async () => {
  const two = choice([{ id: 'a', ergo: 10 }, { id: 'b', ergo: 25 }]);
  const three = choice([{ id: 'a', ergo: 10 }, { id: 'b', ergo: 25 }, { id: 'c', ergo: 17 }]);
  const b2 = countColumn(two, 'b');
  const b3 = countColumn(three, 'b');
  const c3 = countColumn(three, 'c');
  const timeLimit = { code: 13, name: 'TimeLimit' };
  const cases: [string, SolveParams, SolveFn][] = [
    ['honest', paramsOf(two), nativeSolve],
    ['a lie on the first seed (third breaks the tie)', paramsOf(two), lyingOn({ [FIRST]: [`lie_b: ${b2} = 0`] })],
    ['a lie on the second seed', paramsOf(two), lyingOn({ [SECOND]: [`lie_b: ${b2} = 0`] })],
    ['a lie on the third seed only', paramsOf(two), lyingOn({ [THIRD]: [`lie_b: ${b2} = 0`] })],
    ['three disagreeing seeds', paramsOf(three), lyingOn({ [FIRST]: [`lie_b: ${b3} = 0`, `lie_c: ${c3} = 0`], [THIRD]: [`lie_b: ${b3} = 0`] })],
    ['a timed-out second opinion', paramsOf(two), statusOn(SECOND, timeLimit, false)],
    ['an infeasible request with a timed-out second opinion', paramsOf(choice([{ id: 'a', ergo: 10 }]), { maxPrice: 10 }), statusOn(SECOND, timeLimit, false)],
    ['an infeasible request, honest', paramsOf(choice([{ id: 'a', ergo: 10 }]), { maxPrice: 10 }), nativeSolve],
    ['inconclusive first two seeds', paramsOf(two), inconclusiveOn([PRECISE_RANDOM_SEEDS[0], PRECISE_RANDOM_SEEDS[1]])],
    ['every seed inconclusive', paramsOf(two), inconclusiveOn([...PRECISE_RANDOM_SEEDS])],
    ['inconclusive second seed only', paramsOf(two), inconclusiveOn([SECOND])],
    ['a limit-stopped first opinion with its point (G1)', paramsOf(two), statusOn(FIRST, timeLimit, true)],
  ];
  for (const [label, params, solve] of cases) {
    for (const edgeIntegrality of ['relaxed-first', 'integer'] as const) await samePooled(`${label} (${edgeIntegrality})`, { params, edgeIntegrality }, solve);
  }
});

test('seeded TrueErgo / Prevent Overswing worlds: the spatial search with early second opinions and prefetched nodes returns the sequential answer', { timeout: 600_000 }, async t => {
  let nodes = 0;
  for (let k = 1; k <= 60; k++) {
    const world = randomTedWorld(k);
    const sequential = await samePooled(`ted world ${k}`, { params: { ...world.params, objectiveTolerance: 1e-6 } });
    nodes += sequential.summary.nodes;
  }
  t.diagnostic(`${nodes} spatial nodes over 60 worlds`);
  assert.ok(nodes > 90, 'the worlds exercise multi-node searches');
});

test('a cancel while pool solves run terminates every in-flight solve; the request reports the cancel with what it had (section 6 precedence)', async () => {
  const lookup = choice([{ id: 'a', ergo: 10 }, { id: 'b', ergo: 25 }]);
  // Lanes whose solves never finish on their own: only an abandonment ends them.
  const tickets: { abandoned: boolean }[] = [];
  const hanging: SolveLanes = {
    size: 3,
    start: () => {
      const state = { abandoned: false };
      tickets.push(state);
      let abandon: () => void = () => undefined;
      const result = new Promise<NativeResult>((_, reject) => { abandon = () => { state.abandoned = true; reject(new AbandonedSolveError()); }; });
      result.catch(() => undefined);
      return { result, abandon: () => abandon(), promote: () => undefined };
    },
  };
  let cancelled = false;
  const guard = fixedGuard(performance.now() + 60_000, { cancelled: () => cancelled });
  setTimeout(() => { cancelled = true; }, 60);
  const started = performance.now();
  const result = await solvePrecise({ params: paramsOf(lookup), guard, lanes: hanging });
  assert.ok(performance.now() - started < 5_000, 'the cancel is observed while the solves run');
  assert.equal(result.kind, 'incomplete');
  assert.equal(result.outcome.reason, PUBLIC_REASONS.cancelledByUser);
  assert.ok(tickets.length >= 2, 'the first opinion and its early second opinion were running');
  assert.ok(tickets.every(s => s.abandoned), 'every in-flight solve was terminated');
});

test('the deadline backstop: a pool solve still running past the deadline (plus the grace) is terminated and the request reports the time limit', async () => {
  const lookup = choice([{ id: 'a', ergo: 10 }, { id: 'b', ergo: 25 }]);
  const hanging: SolveLanes = {
    size: 2,
    start: () => {
      let abandon: () => void = () => undefined;
      const result = new Promise<NativeResult>((_, reject) => { abandon = () => reject(new AbandonedSolveError()); });
      result.catch(() => undefined);
      return { result, abandon: () => abandon(), promote: () => undefined };
    },
  };
  const started = performance.now();
  const result = await solvePrecise({ params: paramsOf(lookup), deadline: performance.now() + 100, lanes: hanging });
  const elapsed = performance.now() - started;
  assert.ok(elapsed >= 100 && elapsed < 100 + DEADLINE_GRACE_MS + 2_000, `stopped near the deadline plus the grace (${elapsed.toFixed(0)} ms)`);
  assert.equal(result.kind, 'incomplete');
  assert.equal(result.outcome.reason, PUBLIC_REASONS.timeLimitReached);
});

test('a typed native failure on a lane travels as it does in-thread (the search attaches what it had and throws the typed error)', async () => {
  const { SolverError } = await import('../../src/solver/native');
  const lookup = choice([{ id: 'a', ergo: 10 }, { id: 'b', ergo: 25 }]);
  const failing: SolveFn = async () => { throw new SolverError('solve', new Error('trap')); };
  const sequential = await solvePrecise({ params: paramsOf(lookup), deadline: FAR(), solve: failing, lanes: null }).then(() => null, (e: unknown) => e);
  const pooled = await solvePrecise({ params: paramsOf(lookup), deadline: FAR(), solve: failing, lanes: fakeLanes(failing, 3, 9) }).then(() => null, (e: unknown) => e);
  assert.ok(sequential instanceof SolverError && pooled instanceof SolverError);
  assert.equal((pooled as Error).message, (sequential as Error).message);
});

test('a pool worker that crashed twice on a solve is an inconclusive solve: the node moves on to the next seed, exactly as after a SolveError', async () => {
  const { PoolWorkerCrashError } = await import('../../src/solver/native/pool');
  const lookup = choice([{ id: 'a', ergo: 10 }, { id: 'b', ergo: 25 }]);
  const crashing: SolveFn = async (lp, options, extras) => {
    if (Number(options.random_seed) === FIRST) throw new PoolWorkerCrashError(new Error('worker died'));
    return nativeSolve(lp, options, extras);
  };
  const pooled = await solvePrecise({ params: paramsOf(lookup), deadline: FAR(), lanes: fakeLanes(crashing, 3, 13) });
  const sequential = await solvePrecise({ params: paramsOf(lookup), deadline: FAR(), solve: inconclusiveOn([FIRST]), lanes: null });
  assert.equal(answer(pooled), answer(sequential));
  assert.equal(pooled.kind, 'build');
  assert.ok(pooled.summary.telemetry.inconclusiveSolves >= 1);
});

test('real pool workers (worker_threads): a cancel during the solves of a slow TrueErgo gun terminates them at once; the pool is reused afterwards', { timeout: 300_000 }, async t => {
  const { existsSync, readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const snapshotPath = fileURLToPath(new URL('../../benchmarks/snapshot.json', import.meta.url));
  if (!existsSync(snapshotPath)) { t.skip('frontend/benchmarks/snapshot.json is not restored'); return; }
  const { buildItemLookup } = await import('../../src/solver/dataService');
  const { acquireNativePool, configureNativePool, nativePoolStats, shutdownNativePool } = await import('../../src/solver/native/pool');
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as { guns: { id: string; shortName: string }[]; mods: unknown[] };
  const lookup = buildItemLookup(snapshot.guns as never, snapshot.mods as never);
  const akms = snapshot.guns.find(g => g.shortName === 'AKMS') as { id: string };
  const isAmmo = (id: string): boolean => !Object.hasOwn(lookup, id);
  const params: SolveParams = {
    weaponId: akms.id, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(akms.id, lookup), physicalOptions: { isAmmo },
    ergoWeight: 1, recoilWeight: 1, priceWeight: 0.1, fleaAvailable: true, playerLevel: 50, useTrueErgo: true,
    traderLevels: { prapor: 4, skier: 4, peacekeeper: 4, mechanic: 4, jaeger: 4, ref: 4 },
  };
  configureNativePool({ size: 3 });
  try {
    assert.ok(await acquireNativePool(), 'the worker_threads pool loaded');
    let cancelled = false;
    const guard = fixedGuard(performance.now() + 60_000, { cancelled: () => cancelled });
    setTimeout(() => { cancelled = true; }, 1_500);
    const started = performance.now();
    const result = await solvePrecise({ params, guard });
    const elapsed = performance.now() - started;
    t.diagnostic(`cancelled after ${elapsed.toFixed(0)} ms (cancel at 1500 ms)`);
    assert.ok(elapsed < 1_500 + 1_000, 'observed while the solves ran, not after them');
    assert.equal(result.outcome.reason, PUBLIC_REASONS.cancelledByUser);
    const stats = await nativePoolStats();
    assert.ok(stats !== null && stats.abandonedRunning >= 1, 'the in-flight solves were terminated');
    // The pool (with its replaced workers) serves the next request.
    const next = await solvePrecise({ params: paramsOf(choice([{ id: 'a', ergo: 10 }, { id: 'b', ergo: 25 }])), deadline: FAR() });
    assert.equal(next.kind, 'build');
    assert.ok(next.summary.telemetry.pool !== undefined && next.summary.telemetry.pool.lanes === 3);
  } finally {
    await shutdownNativePool();
    configureNativePool({});
  }
});
