// Sweet Spot's payoff table (src/solver/solver.ts `computePayoff`; docs/stage3/sweet-spot.md): the three endpoints run at the same time and give the
// sequential answer; errors keep the sequential precedence (the first failing endpoint in weight order); and a cancel during the endpoints stops the
// request with the cancel reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { OptimizeResponse } from '../../src/api/client';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { configurePayoff, solve, solveRequest } from '../../src/solver/solver';
import type { PayoffOptions } from '../../src/solver/solver';
import type { ItemLookup, SolveParams } from '../../src/solver/types';
import { fixedGuard } from '../../src/solver/runtimeGuard';
import { SolverError } from '../../src/solver/native/errors';
import { gun, lookupOf, mod, slot, trader, WEAPON } from '../physical/lpFixtures';

const paramsOf = (lookup: ItemLookup, extra: Partial<SolveParams> = {}): SolveParams => ({
  weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup),
  ergoWeight: 34, recoilWeight: 33, priceWeight: 33, fleaAvailable: true, preciseMode: true, useTchebycheff: true, ...extra,
});

/** Everything a response must reproduce (timing excluded). */
const fingerprint = (r: OptimizeResponse): string => JSON.stringify({
  status: r.status, certificate: r.physical_certificate, reason: r.reason ?? null,
  precision: [r.precision_request, r.precision_resolved, r.model_qualification, r.moa_qualification],
  preset: r.selected_preset?.id ?? null, placements: r.slot_pairs, objective: r.objective_value, optimization: r.optimization,
  stats: r.final_stats ?? null, ideal: r.ideal_point ?? null,
});

/** Run `body` under payoff options, then restore production's. */
async function withPayoff<T>(options: Partial<PayoffOptions>, body: () => Promise<T>): Promise<T> {
  configurePayoff(options);
  try {
    return await body();
  } finally {
    configurePayoff({});
  }
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Three parts, each the best on one axis: p1 ergonomics (50), p2 recoil (-0.3), p3 price (10 RUB). */
const payoff = (): ItemLookup => lookupOf(
  gun(WEAPON, { weight: 1, ergo: 0, slots: [slot('choice', ['p1', 'p2', 'p3'], true)] }),
  ['p1', mod('p1', { ergo: 50, recoil: 0, offers: [trader('prapor', 1, 100)] })],
  ['p2', mod('p2', { ergo: 10, recoil: -0.3, offers: [trader('prapor', 1, 100)] })],
  ['p3', mod('p3', { ergo: 0, recoil: 0, offers: [trader('prapor', 1, 10)] })],
);

/**
 * A TED world with a unique optimum on every axis: a 2 kg receiver; p1 (ergonomics 50, 0.4 kg), p2 (recoil -0.3, 0.6 kg) and p3 (10 RUB, 1.5 kg, so
 * 3.5 kg: a weight penalty) in a required slot, and an optional q (ergonomics 5, 0.2 kg) that is worse on recoil and price, so it is in the
 * ergonomics endpoint only (the price endpoint's TED is negative).
 */
const tedWorld = (): ItemLookup => lookupOf(
  gun(WEAPON, { weight: 2, ergo: 0, slots: [slot('choice', ['p1', 'p2', 'p3'], true), slot('extra', ['q'])] }),
  ['p1', mod('p1', { ergo: 50, recoil: 0, weight: 0.4, offers: [trader('prapor', 1, 100)] })],
  ['p2', mod('p2', { ergo: 10, recoil: -0.3, weight: 0.6, offers: [trader('prapor', 1, 100)] })],
  ['p3', mod('p3', { ergo: 0, recoil: 0, weight: 1.5, offers: [trader('prapor', 1, 10)] })],
  ['q', mod('q', { ergo: 5, recoil: 0.01, weight: 0.2, offers: [trader('prapor', 1, 50)] })],
);

const REQUESTS: { name: string; params: () => SolveParams }[] = [
  { name: 'plain Precise', params: () => paramsOf(payoff()) },
  { name: 'plain Fast', params: () => paramsOf(payoff(), { preciseMode: false }) },
  { name: 'TrueErgo Precise', params: () => paramsOf(tedWorld(), { useTrueErgo: true, equipErgoModifier: -0.2 }) },
  { name: 'TrueErgo Fast', params: () => paramsOf(tedWorld(), { useTrueErgo: true, equipErgoModifier: -0.2, preciseMode: false }) },
  { name: 'TrueErgo + Prevent Overswing Precise', params: () => paramsOf(tedWorld(), { useTrueErgo: true, preventOverswing: true }) },
  { name: 'TrueErgo, empty (max price 5)', params: () => paramsOf(tedWorld(), { useTrueErgo: true, maxPrice: 5 }) },
];

test('concurrent endpoints give the sequential response bit for bit, whatever order they finish in (both models)', async () => {
  for (const { name, params } of REQUESTS) {
    const sequential = await withPayoff({ concurrent: false }, () => solveRequest(params()));
    const concurrent = await withPayoff({ concurrent: true }, () => solveRequest(params()));
    // the endpoints finishing in reverse weight order
    const reversed = await withPayoff({ concurrent: true, endpointWrapper: async (i, run) => { await sleep(10 * (2 - i)); await run(); } }, () => solveRequest(params()));
    const label = name;
    assert.equal(fingerprint(concurrent.response), fingerprint(sequential.response), label);
    assert.equal(fingerprint(reversed.response), fingerprint(sequential.response), `${label}, reversed`);
    assert.deepEqual(concurrent.payoff?.idealPoint, sequential.payoff?.idealPoint, label);
    assert.deepEqual(concurrent.payoff?.endpoints, sequential.payoff?.endpoints, label);
    assert.deepEqual(reversed.payoff?.endpoints, sequential.payoff?.endpoints, `${label}, reversed`);
  }
});

test('error precedence: the first failing endpoint in weight order is reported, as sequentially, even when a later one fails first', async () => {
  for (const concurrent of [true, false]) {
    // endpoint 1 throws after a delay, endpoint 2 throws at once: endpoint 1's error is the one reported
    const thrown = withPayoff({ concurrent, endpointWrapper: async (i, run) => {
      if (i === 1) { await sleep(30); throw new SolverError('solve', new Error('one')); }
      if (i === 2) throw new SolverError('solve', new Error('two'));
      await run();
    } }, () => solve(paramsOf(payoff())));
    await assert.rejects(thrown, (error: unknown) => error instanceof SolverError && /Error: one$/.test(error.message), `concurrent ${concurrent}`);

    // endpoint 0 stops on the node cap (a factual stop, reported as the request's reason), endpoint 2 throws earlier: the stop of endpoint 0 wins
    const stopped = await withPayoff({ concurrent, endpointWrapper: async (i, run) => {
      if (i === 2) throw new SolverError('solve', new Error('two'));
      await run();
    } }, () => solve(paramsOf(payoff(), { useTrueErgo: true, maxSpatialNodes: 0 })));
    assert.equal(stopped.status, 'incomplete');
    assert.equal(stopped.reason, 'Node limit reached', `concurrent ${concurrent}`);
    assert.equal(stopped.ideal_point, undefined);

    // an endpoint that proves the request empty proves it for every objective: the emptiness outcome of the first endpoint is returned
    const empty = await withPayoff({ concurrent }, () => solve(paramsOf(tedWorld(), { useTrueErgo: true, maxPrice: 5 })));
    assert.equal(empty.status, 'infeasible');
    assert.equal(empty.physical_certificate, 'certified_infeasible');
  }
});

test('once an endpoint has failed, the later endpoints are stopped (their answers could not be reported)', async () => {
  const seen: (boolean | null)[] = [null, null, null];
  const response = await withPayoff({ endpointWrapper: async (i, run) => {
    if (i === 0) throw new SolverError('solve', new Error('zero'));
    await sleep(20);
    const started = performance.now();
    await run();
    seen[i] = performance.now() - started < 1_000;
  } }, () => solve(paramsOf(tedWorld(), { useTrueErgo: true })).catch((error: unknown) => error));
  assert.ok(response instanceof SolverError);
  assert.deepEqual(seen.slice(1), [true, true], 'the later endpoints ran under a stopped guard and returned at once');
});

test('a cancel during the endpoints stops the request with the cancel reason, no table and no build', async () => {
  for (const concurrent of [true, false]) {
    let cancelled = false;
    const guard = fixedGuard(performance.now() + 60_000, { cancelled: () => cancelled });
    const response = await withPayoff({ concurrent, endpointWrapper: async (i, run) => {
      if (i === 0) { await run(); cancelled = true; return; }
      await sleep(10);
      await run();
    } }, () => solve(paramsOf(tedWorld(), { useTrueErgo: true, guard })));
    assert.equal(response.status, 'incomplete', `concurrent ${concurrent}`);
    assert.equal(response.reason, 'Cancelled by user');
    assert.equal(response.physical_certificate, 'none');
    assert.equal(response.ideal_point, undefined, 'no table was used');
    assert.deepEqual(response.selected_items, []);
  }
});

// ---------------------------------------------------------------------------------------------------------------------------
// Real guns on real pool workers
// ---------------------------------------------------------------------------------------------------------------------------

const SNAPSHOT_PATH = fileURLToPath(new URL('../../benchmarks/snapshot.json', import.meta.url));
const skip = existsSync(SNAPSHOT_PATH) ? false : 'frontend/benchmarks/snapshot.json is not restored (ADR 0013 section 1)';

test('real pool workers: a cancel during the endpoints of a slow Sweet Spot TrueErgo request is observed at once, and the pool serves the next request', { skip, timeout: 300_000 }, async t => {
  const { buildItemLookup } = await import('../../src/solver/dataService');
  const { acquireNativePool, configureNativePool, shutdownNativePool } = await import('../../src/solver/native/pool');
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as { guns: { id: string; shortName: string }[]; mods: unknown[] };
  const lookup = buildItemLookup(snapshot.guns as never, snapshot.mods as never);
  const idOf = (shortName: string): string => (snapshot.guns.find(g => g.shortName === shortName) as { id: string }).id;
  const isAmmo = (id: string): boolean => !Object.hasOwn(lookup, id);
  const request = (id: string, guard?: ReturnType<typeof fixedGuard>): SolveParams => ({
    weaponId: id, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(id, lookup), physicalOptions: { isAmmo },
    ergoWeight: 1, recoilWeight: 1, priceWeight: 0.1, fleaAvailable: true, playerLevel: 50, useTrueErgo: true, useTchebycheff: true, preciseMode: true,
    traderLevels: { prapor: 4, skier: 4, peacekeeper: 4, mechanic: 4, jaeger: 4, ref: 4 }, ...(guard === undefined ? {} : { guard }),
  });
  configureNativePool({ size: 3 });
  try {
    assert.ok(await acquireNativePool(), 'the worker_threads pool loaded');
    let cancelled = false;
    const guard = fixedGuard(performance.now() + 60_000, { cancelled: () => cancelled });
    setTimeout(() => { cancelled = true; }, 800);
    const started = performance.now();
    const response = await solve(request(idOf('AKMS'), guard));
    const elapsed = performance.now() - started;
    t.diagnostic(`cancelled after ${elapsed.toFixed(0)} ms (cancel at 800 ms)`);
    assert.ok(elapsed < 800 + 1_000, 'observed while the endpoint solves ran');
    assert.equal(response.status, 'incomplete');
    assert.equal(response.reason, 'Cancelled by user');
    assert.equal(response.ideal_point, undefined);
    const next = await solve(request(idOf('MP5')));
    assert.equal(next.status, 'optimal', next.reason);
  } finally {
    await shutdownNativePool();
    configureNativePool({});
  }
});
