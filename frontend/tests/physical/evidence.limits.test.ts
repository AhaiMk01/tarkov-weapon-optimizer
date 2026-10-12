// Stage 3 evidence, item 5 (ADR 0013 section 4B "completed/limited native runs", section 6, docs/stage3/native-evidence.md): a native run stopped by a time
// limit, a node limit or `mip_max_improving_sols` is reported with the right status and reason and never backs a certificate; a completed run certifies.
// Native level on the pinned build, then production Precise (and Fast) on a real pinned gun and on a fixture, with the stop injected on the real solver.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getNativeHighs, type HighsOptions } from '../../src/solver/native';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { nativeSolve, nativeSolveOptions, type SolveFn } from '../../src/solver/physical/nativeSolve';
import { PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import { solveFast } from '../../src/solver/physical/solveFast';
import { solvePrecise, type PreciseContext, type PreciseResult } from '../../src/solver/physical/solvePrecise';
import type { SolveParams } from '../../src/solver/types';
import { knapsackLp } from '../native/fixtures';
import { loadPinned, pinnedSkip } from '../native/evidence/pinned';
import { gun, lookupOf, mod, slot, trader, WEAPON } from './lpFixtures';

test('item 5, native: a node limit (mip_max_nodes = 0) stops with SolutionLimit, an infinite dual bound and no primal; a time limit stops with TimeLimit; neither is Optimal, and the same model without limits is Optimal', async () => {
  const native = getNativeHighs();
  const lp = knapsackLp(120, 7);
  const nodes = await native.solveStructured(lp, { ...nativeSolveOptions(1e-9), presolve: 'off', mip_max_nodes: 0 });
  assert.deepEqual(nodes.modelStatus, { code: 16, name: 'SolutionLimit' });
  assert.equal(nodes.effectiveOptions.mip_max_nodes, 0);
  assert.equal(nodes.mipDualBound, Infinity, 'no bound was proved: an infinite bound, not a fabricated finite one');
  assert.equal(nodes.colValues, null);
  const time = await native.solveStructured(lp, { ...nativeSolveOptions(1e-9), presolve: 'off', time_limit: 1e-4 });
  assert.deepEqual(time.modelStatus, { code: 13, name: 'TimeLimit' });
  const sols = await native.solveStructured(lp, { ...nativeSolveOptions(1e-9), presolve: 'off', mip_max_improving_sols: 1 });
  assert.deepEqual(sols.modelStatus, { code: 16, name: 'SolutionLimit' });
  const done = await native.solveStructured(lp, { ...nativeSolveOptions(1e-9), presolve: 'off' });
  assert.equal(done.modelStatus.name, 'Optimal');
  assert.ok((sols.objectiveValue as number) <= (done.objectiveValue as number));
  assert.ok((sols.mipDualBound as number) >= (done.objectiveValue as number) - 1e-9, 'a stopped run keeps a valid bound');
});

/** The real pinned solver with extra native options forced on every call (a stop the caller cannot request). */
const forcing = (extra: HighsOptions): SolveFn & { statuses: string[] } => {
  const statuses: string[] = [];
  const solve = async (lp: string, options: HighsOptions, extras?: Parameters<SolveFn>[2]) => {
    const result = await nativeSolve(lp, { ...options, ...extra }, extras);
    statuses.push(result.modelStatus.name);
    return result;
  };
  return Object.assign(solve, { statuses });
};

/** The dichotomy of a stopped run: no certificate, the stop's own reason, termination `limit`, any published bound still at least the true optimum. */
function assertStopped(label: string, r: PreciseResult, reason: string, optimum: number): void {
  assert.ok(r.kind === 'build' || r.kind === 'incomplete', `${label}: ${r.kind} (a stopped run is never a proof of emptiness)`);
  if (r.kind === 'build') assert.equal(r.certified, false, `${label}: certified after a limit stop`);
  assert.notEqual(r.outcome.status, 'optimal', label);
  assert.notEqual(r.outcome.physical_certificate, 'certified_optimal', label);
  assert.equal(r.outcome.reason, reason, label);
  assert.equal(r.outcome.termination, 'limit', label);
  assert.equal(r.summary.completed, false, label);
  const upper = r.summary.bounds.upper;
  if (upper !== null) assert.ok(upper >= optimum - 1e-9 * Math.max(1, Math.abs(optimum)), `${label}: bound ${upper} below the optimum ${optimum}`);
  if (r.kind === 'build') assert.ok(r.best.score <= optimum + 1e-9 * Math.max(1, Math.abs(optimum)), label);
}

async function limitMatrix(t: { diagnostic: (s: string) => void }, label: string, params: SolveParams, edgeIntegrality?: PreciseContext['edgeIntegrality']): Promise<void> {
  const base = { params, edgeIntegrality } as const;
  const done = await solvePrecise({ ...base, deadline: performance.now() + 120_000 });
  assert.equal(done.kind, 'build', `${label}: completed run`);
  if (done.kind !== 'build') return;
  assert.equal(done.certified, true, `${label}: a completed run certifies`);
  assert.equal(done.outcome.termination, 'optimal');
  assert.equal(done.outcome.physical_certificate, 'certified_optimal');
  assert.equal(done.summary.completed, true);
  const optimum = done.best.score;

  const solsSpy = forcing({});
  const sols = await solvePrecise({ ...base, deadline: performance.now() + 120_000, nativeStop: { mip_max_improving_sols: 1 }, solve: solsSpy });
  assert.ok(solsSpy.statuses.every(s => s === 'SolutionLimit' || s === 'Optimal'), `${label}: ${solsSpy.statuses.join(',')}`);
  if (solsSpy.statuses.every(s => s === 'Optimal')) {
    // HiGHS proved the first improving solution optimal at the root (observed on MP5): the native run COMPLETED, so a certificate is legitimate
    assert.equal(sols.kind, 'build');
    if (sols.kind === 'build') assert.equal(sols.best.score, optimum, `${label}: the completed run is the same optimum`);
    t.diagnostic(`${label}: mip_max_improving_sols=1 completed with Optimal on every solve (${solsSpy.statuses.join(',')}); certified ${String(sols.kind === 'build' && sols.certified)}`);
  } else {
    assertStopped(`${label} mip_max_improving_sols=1`, sols, PUBLIC_REASONS.nativeSolutionLimitReached, optimum);
  }

  const nodeLimit = forcing({ mip_max_nodes: 0 });
  const nodes = await solvePrecise({ ...base, deadline: performance.now() + 120_000, solve: nodeLimit });
  assert.ok(nodeLimit.statuses.every(s => s === 'SolutionLimit' || s === 'Optimal'), `${label}: ${nodeLimit.statuses.join(',')}`);
  if (nodeLimit.statuses.includes('Optimal')) {
    // a root LP that is already integral finishes inside the node budget: that run completed and may certify
    t.diagnostic(`${label}: mip_max_nodes=0 still finished at the root (${nodeLimit.statuses.join(',')})`);
  } else {
    assertStopped(`${label} mip_max_nodes=0`, nodes, PUBLIC_REASONS.nativeSolutionLimitReached, optimum);
  }

  const timeLimit = forcing({ time_limit: 1e-4 });
  const timed = await solvePrecise({ ...base, deadline: performance.now() + 120_000, solve: timeLimit });
  assert.ok(timeLimit.statuses.length > 0 && timeLimit.statuses.every(s => s === 'TimeLimit'), `${label}: ${timeLimit.statuses.join(',')}`);
  assertStopped(`${label} time_limit`, timed, PUBLIC_REASONS.timeLimitReached, optimum);
  t.diagnostic(`${label}: completed certified ${optimum}; solution limit -> ${sols.kind}; node limit -> ${nodes.kind} (${nodeLimit.statuses.join(',')}); time limit -> ${timed.kind}`);
}

/** A fixture whose MIP is not decided at the root: three slots of interacting parts under a price cap. */
const knapsackWorld = (): SolveParams => {
  const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
  const lookup = lookupOf(
    gun(WEAPON, { weight: 1, ergo: 0, slots: [slot('s0', ids.slice(0, 4)), slot('s1', ids.slice(4, 8)), slot('s2', ids.slice(8))] }),
    ...ids.map((id, i): [string, ReturnType<typeof mod>] => [id, mod(id, { weight: 0.1, ergo: 3 + ((i * 7) % 11), offers: [trader('prapor', 1, 1000 + ((i * 3779) % 9000))] })]),
  );
  return { weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup), ergoWeight: 1, recoilWeight: 0, priceWeight: 0, maxPrice: 20000, objectiveTolerance: 1e-9 };
};

test('item 5, Precise on a fixture: completed certifies; solution limit, node limit and time limit stop without a certificate and with their reasons (relaxed-first and integer edges)', async t => {
  await limitMatrix(t, 'fixture relaxed-first', knapsackWorld());
  await limitMatrix(t, 'fixture integer', knapsackWorld(), 'integer');
});

test('item 5, Precise on real pinned guns (MP5, SR-25): completed certifies; every native stop withholds the certificate with its reason', { skip: pinnedSkip, timeout: 900_000 }, async t => {
  const pinned = loadPinned();
  for (const name of ['MP5', 'SR-25']) {
    const id = pinned.gunsNamed(name)[0].id;
    const params: SolveParams = {
      weaponId: id, itemLookup: pinned.lookup, compatibilityMap: buildCompatibilityMap(id, pinned.lookup), physicalOptions: { isAmmo: pinned.isAmmo },
      ergoWeight: 1, recoilWeight: 1, priceWeight: 0.5, fleaAvailable: true, barterAvailable: false, barterExcludeDogtags: true, playerLevel: 50,
      traderLevels: { prapor: 4, skier: 4, peacekeeper: 4, mechanic: 4, jaeger: 4, ref: 4 }, equipErgoModifier: 0, objectiveTolerance: 1e-8,
    };
    await limitMatrix(t, name, params);
  }
});

test('item 5, Fast: a stopped native run is reported with its reason and is never optimal; Fast never carries a certificate even when completed', async () => {
  const params = knapsackWorld();
  const done = await solveFast({ params, deadline: performance.now() + 60_000 });
  assert.equal(done.kind, 'build');
  if (done.kind !== 'build') return;
  assert.equal(done.optimal, true);
  assert.notEqual(done.outcome.physical_certificate, 'certified_optimal', 'Fast is approximate');
  const timed = await solveFast({ params, deadline: performance.now() + 60_000, solve: forcing({ time_limit: 1e-4 }) });
  assert.ok(timed.kind === 'build' || timed.kind === 'incomplete');
  if (timed.kind === 'build') assert.equal(timed.optimal, false);
  assert.equal(timed.outcome.reason, PUBLIC_REASONS.timeLimitReached);
  assert.equal(timed.outcome.termination, 'limit');
  const sols = await solveFast({ params, deadline: performance.now() + 60_000, solve: forcing({ mip_max_improving_sols: 1 }) });
  if (sols.kind === 'build') assert.equal(sols.optimal, false);
  assert.equal(sols.outcome.reason, PUBLIC_REASONS.nativeSolutionLimitReached);
  assert.equal(sols.outcome.termination, 'limit');
});
