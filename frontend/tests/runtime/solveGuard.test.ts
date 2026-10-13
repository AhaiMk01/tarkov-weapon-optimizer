// `solve` under a request-epoch guard on hand-built lookups and the pinned native build (ADR 0013 sections 4D and 6, Phase 2.7a): cancel and
// deadline between stages and nodes, the retained witness, precedence, no native work without time, the typed native failure and the qualification of
// the payoff table the endpoint cache admits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { configurePayoff, solve, solveRequest } from '../../src/solver/solver';
import type { ItemLookup, SolveParams } from '../../src/solver/types';
import type { RuntimeGuard } from '../../src/solver/runtimeGuard';
import { yieldMacrotask } from '../../src/solver/runtimeGuard';
import { endpointsQualifyForCache } from '../../src/solver/endpointCache';
import { SolverError } from '../../src/solver/native/errors';
import { completionOf } from '../../src/solver/runtimeErrors';
import { nativeSolve } from '../../src/solver/physical/nativeSolve';
import type { SolveFn } from '../../src/solver/physical/nativeSolve';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import { solveFast } from '../../src/solver/physical/solveFast';
import { gun, lookupOf, mod, slot, trader, WEAPON } from '../physical/lpFixtures';

const paramsOf = (lookup: ItemLookup, extra: Partial<SolveParams> = {}): SolveParams => ({
  weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup),
  ergoWeight: 1, recoilWeight: 0, priceWeight: 0, fleaAvailable: true, preciseMode: true, ...extra,
});

/** A guard the test drives: `cancelAfterYields` and `expireAfterYields` flip the cancel flag and the clock when that many yields happened. */
function drivenGuard(options: { cancelAfterYields?: number; expireAfterYields?: number; deadline?: number } = {}): RuntimeGuard & { yields: number } {
  const deadline = options.deadline ?? 1e9;
  let t = 0;
  const guard = {
    yields: 0,
    deadline,
    now: (): number => t,
    cancelled: (): boolean => options.cancelAfterYields !== undefined && guard.yields >= options.cancelAfterYields,
    yieldMacrotask: async (): Promise<void> => {
      guard.yields++;
      if (options.expireAfterYields !== undefined && guard.yields >= options.expireAfterYields) t = deadline + 1;
      await yieldMacrotask();
    },
  };
  return guard;
}

/** Three exclusive choices of weight 1, 2 and 3 on a 1 kg receiver: a TED request splits at 3 kg into two roots, the first holding the 'b' witness. */
const choice = (): ItemLookup => lookupOf(
  gun(WEAPON, { weight: 1, slots: [slot('choice', ['a', 'b', 'c'], true)] }),
  ['a', mod('a', { weight: 1, ergo: 20 })], ['b', mod('b', { weight: 2, ergo: 30 })], ['c', mod('c', { weight: 3, ergo: 41 })],
);

const ted = (guard: RuntimeGuard, extra: Partial<SolveParams> = {}): SolveParams => paramsOf(choice(), { ergoWeight: 100, useTrueErgo: true, guard, ...extra });

for (const preciseMode of [true, false]) {
  const mode = preciseMode ? 'Precise' : 'Fast';

  test(`${mode}: a request cancelled before its first stage stops with nothing prepared: incomplete, Cancelled by user, search never started`, async () => {
    const guard = drivenGuard({ cancelAfterYields: 0 });
    const response = await solve(ted(guard, { preciseMode }));
    assert.equal(response.status, 'incomplete');
    assert.equal(response.reason, 'Cancelled by user');
    assert.equal(response.physical_certificate, 'none');
    assert.equal(response.optimization.termination, 'limit');
    assert.equal(response.optimization.nodes, 0);
    assert.deepEqual(response.selected_items, []);
    assert.equal(guard.yields, 0, 'no stage ran');
  });

  test(`${mode}: a cancel between spatial nodes returns the retained witness with the cancel reason, and cancel outranks a coincident deadline`, async () => {
    // yield 1 precedes node 1, yield 2 precedes node 2: the cancel is observed there, after node 1 produced its verified build.
    const cancelled = await solve(ted(drivenGuard({ cancelAfterYields: 2 }), { preciseMode }));
    assert.equal(cancelled.status, 'feasible');
    assert.equal(cancelled.reason, 'Cancelled by user');
    assert.equal(cancelled.physical_certificate, 'feasible');
    assert.equal(cancelled.optimization.termination, 'limit');
    assert.equal(cancelled.optimization.nodes, 1);
    assert.deepEqual(cancelled.selected_item_ids, ['b']);
    assert.ok(cancelled.optimization.lower_bound !== null, 'the witness keeps its lower bound');
    assert.equal(cancelled.optimization.upper_bound, null);

    const expired = await solve(ted(drivenGuard({ expireAfterYields: 2 }), { preciseMode }));
    assert.equal(expired.status, 'feasible');
    assert.equal(expired.reason, 'Time limit reached');
    assert.deepEqual(expired.selected_item_ids, ['b']);

    const both = await solve(ted(drivenGuard({ cancelAfterYields: 2, expireAfterYields: 2 }), { preciseMode }));
    assert.equal(both.reason, 'Cancelled by user', 'cancel is checked before the deadline');
    assert.deepEqual(both.selected_item_ids, ['b']);
  });

  test(`${mode}: a completed search is not downgraded by a cancel that arrives while its last native solve runs`, async () => {
    // A request with no spatial dimension is one node. The cancel flag is raised by the native call itself, i.e. after the last guard check: the
    // search has no live node left, so the flag is never consulted and the optimum stands.
    let flagged = false;
    const guard = { ...drivenGuard(), cancelled: (): boolean => flagged };
    const raise: SolveFn = (text, options, extras) => { flagged = true; return nativeSolve(text, options, extras); };
    const params = paramsOf(choice(), { ergoWeight: 100, guard, preciseMode });
    const result = preciseMode ? await solvePrecise({ params, guard, solve: raise }) : await solveFast({ params, guard, solve: raise });
    assert.equal(flagged, true);
    assert.equal(result.kind, 'build');
    assert.equal(result.outcome.status, 'optimal');
    assert.equal(result.outcome.reason, undefined);
    assert.equal(result.outcome.termination, 'optimal');
  });
}

test('a deadline already past stops a guarded solve before any native work, and a timeLimitMs can only narrow the guard', async () => {
  const past = await solve(paramsOf(choice(), { guard: drivenGuard({ deadline: 0 }) }));
  assert.equal(past.reason, 'Time limit reached');
  assert.equal(past.optimization.nodes, 0);
  // A sub-solve limit of 0 ms narrows a generous guard; a huge limit never extends a past one.
  const narrowed = await solve(paramsOf(choice(), { guard: drivenGuard(), timeLimitMs: 0 }));
  assert.equal(narrowed.reason, 'Time limit reached');
  const notExtended = await solve(paramsOf(choice(), { guard: drivenGuard({ deadline: 0 }), timeLimitMs: 1e9 }));
  assert.equal(notExtended.reason, 'Time limit reached');
});

test('sequential payoff endpoints (configurePayoff concurrent: false) are guarded and separated by macrotask yields; a cancel between endpoints stops before the next one', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { weight: 1, ergo: 0, slots: [slot('choice', ['p1', 'p2', 'p3'], true)] }),
    ['p1', mod('p1', { ergo: 50, recoil: 0, offers: [trader('prapor', 1, 100)] })],
    ['p2', mod('p2', { ergo: 10, recoil: -0.3, offers: [trader('prapor', 1, 100)] })],
    ['p3', mod('p3', { ergo: 0, recoil: 0, offers: [trader('prapor', 1, 10)] })],
  );
  configurePayoff({ concurrent: false });
  try {
  const full = drivenGuard();
  const done = await solve(paramsOf(lookup, { ergoWeight: 34, recoilWeight: 33, priceWeight: 33, useTchebycheff: true, guard: full }));
  assert.equal(done.status, 'optimal', done.reason);
  // Per endpoint: the search yield and the endpoint yield; then the search yield of the objective itself.
  assert.equal(full.yields, 3 * 2 + 1);

  // Yield 1 is endpoint 1's search, yield 2 the one after endpoint 1: the cancel is seen before endpoint 2 starts.
  const cut = drivenGuard({ cancelAfterYields: 2 });
  const response = await solve(paramsOf(lookup, { ergoWeight: 34, recoilWeight: 33, priceWeight: 33, useTchebycheff: true, guard: cut }));
  assert.equal(response.status, 'incomplete');
  assert.equal(response.reason, 'Cancelled by user');
  assert.equal(response.ideal_point, undefined, 'no table was used');
  assert.deepEqual(response.selected_items, []);
  assert.equal(cut.yields, 2, 'endpoint 2 never ran');
  } finally {
    configurePayoff({});
  }
});

test('concurrent payoff endpoints (production): one guard check before them, their own search yields, one yield after the table; a cancel during them stops the request', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { weight: 1, ergo: 0, slots: [slot('choice', ['p1', 'p2', 'p3'], true)] }),
    ['p1', mod('p1', { ergo: 50, recoil: 0, offers: [trader('prapor', 1, 100)] })],
    ['p2', mod('p2', { ergo: 10, recoil: -0.3, offers: [trader('prapor', 1, 100)] })],
    ['p3', mod('p3', { ergo: 0, recoil: 0, offers: [trader('prapor', 1, 10)] })],
  );
  const full = drivenGuard();
  const done = await solve(paramsOf(lookup, { ergoWeight: 34, recoilWeight: 33, priceWeight: 33, useTchebycheff: true, guard: full }));
  assert.equal(done.status, 'optimal', done.reason);
  // The three endpoint searches yield once each, the table once; then the search yield of the objective itself.
  assert.equal(full.yields, 3 + 1 + 1);

  // The cancel is seen inside the endpoints: every endpoint stops, the first one's cancel is reported and the objective never runs.
  const cut = drivenGuard({ cancelAfterYields: 2 });
  const response = await solve(paramsOf(lookup, { ergoWeight: 34, recoilWeight: 33, priceWeight: 33, useTchebycheff: true, guard: cut }));
  assert.equal(response.status, 'incomplete');
  assert.equal(response.reason, 'Cancelled by user');
  assert.equal(response.ideal_point, undefined, 'no table was used');
  assert.deepEqual(response.selected_items, []);
  assert.ok(cut.yields <= 3, `the objective's search never yielded (${cut.yields} yields)`);
});

test('only a qualified Precise MOA-independent table has certified endpoints: Fast, provisional-MOA and weighted requests are not admitted', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { weight: 1, ergo: 0, slots: [slot('choice', ['p1', 'p2', 'p3'], true)] }),
    ['p1', mod('p1', { ergo: 50, recoil: 0, offers: [trader('prapor', 1, 100)] })],
    ['p2', mod('p2', { ergo: 10, recoil: -0.3, offers: [trader('prapor', 1, 100)] })],
    ['p3', mod('p3', { ergo: 0, recoil: 0, offers: [trader('prapor', 1, 10)] })],
  );
  const tcheb = (extra: Partial<SolveParams>): SolveParams => paramsOf(lookup, { ergoWeight: 34, recoilWeight: 33, priceWeight: 33, useTchebycheff: true, ...extra });
  const precise = await solveRequest(tcheb({}));
  assert.ok(precise.payoff !== null);
  assert.equal(precise.payoff.endpoints.length, 3);
  assert.ok(precise.payoff.endpoints.every(e => e.physical_certificate === 'certified_optimal' && e.precision_resolved === 'precise' && e.moa_qualification === null));
  assert.equal(endpointsQualifyForCache(precise.payoff.endpoints), true);

  const fast = await solveRequest(tcheb({ preciseMode: false }));
  assert.ok(fast.payoff !== null);
  assert.ok(fast.payoff.endpoints.every(e => e.model_qualification === 'approximate'));
  assert.equal(endpointsQualifyForCache(fast.payoff.endpoints), false);

  const moa = await solveRequest(tcheb({ maxMOA: 1000 }));
  assert.ok(moa.payoff !== null);
  assert.ok(moa.payoff.endpoints.every(e => e.moa_qualification === 'provisional_model' && e.physical_certificate === 'approximate_optimal'));
  assert.equal(endpointsQualifyForCache(moa.payoff.endpoints), false);

  const supplied = await solveRequest(tcheb({ idealPoint: { zE: 500, nadE: 0, zR: -300, nadR: 0, zP: 5010, nadP: 5100 } }));
  assert.equal(supplied.payoff, null, 'a table that was supplied was not computed by this call');
  assert.equal((await solveRequest(paramsOf(lookup))).payoff, null, 'a weighted request has no table');
});

test('a native solve is never started with no time left, and a positive allowance is at least one millisecond', async () => {
  const lookup = choice();
  const limits: number[] = [];
  let calls = 0;
  const spy: SolveFn = (text, options, extras) => {
    calls++;
    limits.push(options.time_limit as number);
    return nativeSolve(text, options, extras);
  };
  const noTime = await solvePrecise({ params: paramsOf(lookup), guard: drivenGuard({ deadline: 0 }), solve: spy });
  assert.equal(noTime.kind, 'incomplete');
  assert.equal(calls, 0, 'no native call without time');
  // 0.4 ms remain: positive time, so the solve starts, with the minimum allowance of 0.001 s.
  const guard = drivenGuard({ deadline: 0.4 });
  await solvePrecise({ params: paramsOf(lookup), guard, solve: spy });
  assert.ok(limits.length >= 1 && limits.every(limit => limit === 0.001), `every solve gets the minimum allowance: ${limits.join(', ')}`);
});

test('a native exception is a typed SolverError carrying the completion metadata captured before it, never a result', async () => {
  const lookup = choice();
  let calls = 0;
  const failing: SolveFn = (text, options, extras) => {
    calls++;
    if (calls === 3) throw new SolverError('solve', new Error('wasm trap')); // node 1 took two solves (its verdict and the second opinion)
    return nativeSolve(text, options, extras);
  };
  await assert.rejects(
    solvePrecise({ params: paramsOf(lookup, { ergoWeight: 100, useTrueErgo: true }), guard: drivenGuard(), solve: failing }),
    (error: unknown) => {
      assert.ok(error instanceof SolverError);
      assert.equal(error.phase, 'solve');
      const completion = completionOf(error);
      assert.ok(completion !== null);
      assert.equal(completion.nodes, 1);
      assert.equal(completion.witness, true, 'node 1 had produced a verified build');
      assert.equal(completion.termination, 'limit');
      assert.ok(completion.lower_bound !== null);
      return true;
    },
  );
  // A failure before any build: no witness, null bounds.
  await assert.rejects(
    solvePrecise({ params: paramsOf(lookup), guard: drivenGuard(), solve: () => { throw new SolverError('solve', new Error('out of memory')); } }),
    (error: unknown) => {
      assert.deepEqual(completionOf(error), { nodes: 0, termination: 'limit', witness: false, lower_bound: null, upper_bound: null, absolute_gap: null });
      return true;
    },
  );
});

test('the first-witness policy ends a Precise weight search at its first verified build, without a certificate, without calling it a timeout, with the real native stop (F2) and no bound (G1)', async () => {
  const lookup = choice();
  const params = paramsOf(lookup, { ergoWeight: 100, useTrueErgo: true });
  const first = await solvePrecise({ params, guard: drivenGuard(), stopAtFirstWitness: true });
  assert.equal(first.kind, 'build');
  if (first.kind !== 'build') return;
  assert.equal(first.certified, false);
  // The witness's solve completed natively (Optimal): the reason is the withheld certificate (no second opinion), never a native solution limit (F2).
  assert.equal(first.best.nativeStatus, 'Optimal');
  assert.equal(first.reason, 'Required proof prerequisite unavailable');
  assert.equal(first.summary.bounds.upper, null, 'G1: a single solve gives no published bound');
  assert.equal(first.summary.nodes, 1);
  assert.equal(first.outcome.status, 'feasible');
  const full = await solvePrecise({ params, guard: drivenGuard() });
  assert.equal(full.kind, 'build');
  if (full.kind === 'build') assert.equal(full.certified, true);
});
