// The Fast pipeline (src/solver/physical/solveFast.ts: template-count model -> decode -> exact validation -> cuts) on hand-built lookups and the
// pinned native build. Every published build is judged by the exact validator; the model optimum equals the Precise optimum (every part graph is acyclic).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { DEFAULT_TRADER_LEVELS } from '../../src/solver/types';
import type { ItemLookup, SolveParams } from '../../src/solver/types';
import { nativeSolve } from '../../src/solver/physical/nativeSolve';
import type { SolveFn } from '../../src/solver/physical/nativeSolve';
import { solveFast, MAX_FAST_REJECTIONS } from '../../src/solver/physical/solveFast';
import type { FastResult } from '../../src/solver/physical/solveFast';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import { validatePhysicalBuild } from '../../src/solver/physical';
import { barter, flea, gun, gunWith, lookupOf, mod, modWith, slot, trader, WEAPON } from './lpFixtures';
import { overfillEdges } from './tamper';

const paramsOf = (lookup: ItemLookup, extra: Partial<SolveParams> = {}): SolveParams => ({
  weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup),
  ergoWeight: 1, recoilWeight: 0, priceWeight: 0, fleaAvailable: true, allowRepeatedParts: true, ...extra,
});

const FAR = (): number => performance.now() + 120_000;

const built = (r: FastResult) => {
  assert.equal(r.kind, 'build', JSON.stringify(r.kind === 'build' ? '' : r));
  return r as Extract<FastResult, { kind: 'build' }>;
};
const installed = (r: FastResult): string[] => built(r).best.build.placements.map(p => p.itemId).sort();
const slots = (r: FastResult): string[] => built(r).best.build.placements.map(p => `${p.parentInstanceId}/${p.slotId}:${p.itemId}`).sort();

/** The exact validator accepts the published build of a result, from scratch. */
function assertValid(params: SolveParams, r: FastResult): void {
  const { best } = built(r);
  const verdict = validatePhysicalBuild(params.itemLookup, params, best.build, { requirePathInstanceIds: true });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.violations));
}

/** Fast and Precise on one request: the same kind, and on a build the same exact score. Returns the Fast result. */
async function agree(params: SolveParams): Promise<FastResult> {
  const fast = await solveFast({ params, deadline: FAR() });
  const precise = await solvePrecise({ params, deadline: FAR() });
  if (precise.kind === 'empty') {
    assert.equal(fast.kind, 'empty', `Precise is empty but Fast is ${fast.kind}`);
  } else {
    assert.equal(precise.kind, 'build');
    const exact = precise.kind === 'build' ? precise.best.score : Number.NaN;
    assert.equal(fast.kind, 'build', `Precise has a build but Fast is ${fast.kind}`);
    assert.ok(Math.abs(built(fast).best.score - exact) <= 1e-6 * Math.max(1, Math.abs(exact)), `Fast ${built(fast).best.score} against the exact optimum ${exact}`);
    assertValid(params, fast);
  }
  return fast;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Placement the legacy single-copy model could not express
// ---------------------------------------------------------------------------------------------------------------------------

test('multi-copy siblings: one template fills every slot that takes it, each copy is its own path-derived instance', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['a']), slot('s2', ['a']), slot('s3', ['a'])] }),
    ['a', mod('a', { ergo: 10, weight: 0.1 })],
  );
  const params = paramsOf(lookup);
  const fast = await agree(params);
  assert.deepEqual(installed(fast), ['a', 'a', 'a']);
  assert.deepEqual(slots(fast), ['weapon_0/s1:a', 'weapon_0/s2:a', 'weapon_0/s3:a']);
  assert.equal(built(fast).best.stats.spend, 5300, 'three copies at 100 RUB each');
  assert.equal(built(fast).optimal, true);
});

test('copies below a host: the host is installed once, its two sibling slots each take the part; the same part also fits a root slot', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('mount', ['host']), slot('top', ['a'])] }),
    ['host', mod('host', { weight: 0.5, slots: [slot('left', ['a']), slot('right', ['a'])] })],
    ['a', mod('a', { ergo: 6 })],
  );
  const fast = await agree(paramsOf(lookup));
  assert.deepEqual(installed(fast), ['a', 'a', 'a', 'host']);
  assert.deepEqual(slots(fast), ['weapon_0/mount:host', 'weapon_0/mount:host/left:a', 'weapon_0/mount:host/right:a', 'weapon_0/top:a']);
});

test('required slots: a required child is installed with its owner, a required root slot is always filled, and an owner that cannot be completed is not installed', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { ergo: 5, slots: [slot('mount', ['host'], true), slot('opt', ['z'])] }),
    ['host', mod('host', { ergo: -1, slots: [slot('need', ['x', 'y'], true)] })],
    ['x', mod('x', { ergo: 2 })],
    ['y', mod('y', { ergo: 9 })],
    ['z', mod('z', { ergo: 1, slots: [slot('deadend', ['w'], true)] })],
    ['w', mod('w', { ergo: 50, offers: [] })], // never obtainable: z's required slot cannot be filled, so z cannot be installed
  );
  const params = paramsOf(lookup);
  const fast = await agree(params);
  assert.deepEqual(installed(fast), ['host', 'y']);
  assert.equal(built(fast).best.stats.ergonomics, 5 - 1 + 9);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Conflicts and self-caps
// ---------------------------------------------------------------------------------------------------------------------------

test('template conflict: presence excludes the partner, yet copies of one side stay legal while the partner is absent', async () => {
  // `a` lists `b` as a conflict; only the first slot also takes `b`.
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['a', 'b']), slot('s2', ['a']), slot('s3', ['a'])] }),
    ['a', mod('a', { ergo: 10, conflictsItems: ['b'] })],
    ['b', mod('b', { ergo: 25 })],
  );
  const fast = await agree(paramsOf(lookup));
  assert.deepEqual(installed(fast), ['a', 'a', 'a'], 'three copies of a (30) beat b alone (25): b would forbid every a');
  const forced = await agree(paramsOf(lookup, { includeItems: ['b'] }));
  assert.deepEqual(installed(forced), ['b'], 'with b required no a may be installed');
});

test('self-conflict: a template that lists itself has at most one copy, however many slots take it', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['s', 'p']), slot('s2', ['s', 'p']), slot('s3', ['s'])] }),
    ['s', mod('s', { ergo: 10, conflictsItems: ['s'] })],
    ['p', mod('p', { ergo: 3 })],
  );
  const fast = await agree(paramsOf(lookup));
  assert.deepEqual(installed(fast), ['p', 'p', 's'], 'one s (10) in the slot only it fits, p (3) in the other two');
});

test('slot conflict: a blocker empties every physical slot of the blocked id, over all copies of the slot owner, its own host slot included', async () => {
  // Two copies of the host (both root slots), each with a `rail` slot that takes `laser` or `blocker`; `blocker` also fits the root `bridge` slot
  // and blocks the id `rail`. Installed anywhere it leaves every rail empty, so it can only sit at the bridge, and it is never installed in a rail
  // (its own host slot is a blocked slot).
  const lookup = (blockerErgo: number) => lookupOf(
    gun(WEAPON, { slots: [slot('m1', ['host']), slot('m2', ['host']), slot('bridge', ['blocker'])] }),
    ['host', mod('host', { ergo: 1, slots: [slot('rail', ['laser', 'blocker'])] })],
    ['laser', mod('laser', { ergo: 4 })],
    ['blocker', mod('blocker', { ergo: blockerErgo, conflictsSlots: ['rail'] })],
  );
  // blocker 9: bridge blocker (9) + two hosts with empty rails (2) = 11 beats two hosts with lasers (2 + 8 = 10).
  const worth = await agree(paramsOf(lookup(9)));
  assert.deepEqual(slots(worth), ['weapon_0/bridge:blocker', 'weapon_0/m1:host', 'weapon_0/m2:host']);
  // blocker 3: the lasers win and the blocker is never installed.
  const notWorth = await agree(paramsOf(lookup(3)));
  assert.deepEqual(installed(notWorth), ['host', 'host', 'laser', 'laser']);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Acquisition: preset supply, owned stock, whole lots, caps
// ---------------------------------------------------------------------------------------------------------------------------

const threeSlotsWithPreset = () => lookupOf(
  gun(WEAPON, { slots: [slot('s1', ['a']), slot('s2', ['a']), slot('s3', ['a'])], presets: [{ id: 'P', items: [{ itemId: 'a', count: 2 }] }] }),
  ['a', mod('a', { ergo: 10 })],
);

test('preset supply q = 2: two copies ride on the preset, a third is paid for exactly when it is worth its price', async () => {
  const pricey = paramsOf(threeSlotsWithPreset(), { priceWeight: 1000 });
  const strict = await agree(pricey);
  assert.deepEqual(installed(strict), ['a', 'a']);
  assert.deepEqual(built(strict).best.build.base, { kind: 'preset', presetId: 'P' });
  assert.equal(built(strict).best.stats.spend, 1000);
  assert.deepEqual(built(strict).best.stats.acquisition.occurrences.map(o => o.source), ['preset', 'preset']);
  const cheap = await agree(paramsOf(threeSlotsWithPreset(), { priceWeight: 1 }));
  assert.deepEqual(installed(cheap), ['a', 'a', 'a']);
  assert.equal(built(cheap).best.stats.spend, 1100);
  assert.deepEqual(built(cheap).best.stats.acquisition.occurrences.map(o => [o.source, o.price]), [['preset', 0], ['preset', 0], ['offer', 100]]);
});

test('owned stock is free supply: owned copies are never paid, and a part with no offer is capped by preset plus owned supply', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['a']), slot('s2', ['a']), slot('s3', ['a'])] }),
    ['a', mod('a', { ergo: 10 })],
  );
  const strict = await agree(paramsOf(lookup, { priceWeight: 1000, ownedItems: ['a', 'a'] }));
  assert.deepEqual(built(strict).best.stats.acquisition.occurrences.map(o => o.source), ['owned', 'owned']);
  assert.equal(built(strict).best.stats.spend, 5000);
  const capped = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['c']), slot('s2', ['c'])], presets: [{ id: 'P', items: [{ itemId: 'c', count: 1 }] }] }),
    ['c', mod('c', { ergo: 10, offers: [] })],
  );
  assert.deepEqual(installed(await agree(paramsOf(capped))), ['c'], 'the preset supplies one copy and nothing can be bought');
  assert.deepEqual(installed(await agree(paramsOf(capped, { ownedItems: ['c'] }))), ['c', 'c'], 'one preset copy plus one owned copy');
});

test('a barter lot is bought whole: two units cost the lot of three, one unit is cheaper in cash, three units cost two lots of two', async () => {
  const lotOfThree = (n: number) => lookupOf(
    gun(WEAPON, { slots: Array.from({ length: n }, (_, i) => slot(`s${i + 1}`, ['a'])) }),
    ['a', mod('a', { ergo: 10, offers: [trader('prapor', 1, 200), barter('mechanic', 1, 300, false, 3)] })],
  );
  const market = { barterAvailable: true };
  const two = await agree(paramsOf(lotOfThree(2), { ...market, priceWeight: 1 }));
  assert.equal(built(two).best.stats.spend, 5300);
  const one = await agree(paramsOf(lotOfThree(1), { ...market, priceWeight: 1 }));
  assert.equal(built(one).best.stats.spend, 5200);
  const pairs = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['a']), slot('s2', ['a']), slot('s3', ['a'])] }),
    ['a', mod('a', { ergo: 5, offers: [barter('mechanic', 1, 600, false, 2)] })],
  );
  const three = await agree(paramsOf(pairs, { barterAvailable: true }));
  assert.equal(built(three).best.stats.spend, 5000 + 1200, 'three units need two lots of two');
  assert.deepEqual(built(three).best.stats.acquisition.occurrences.map(o => o.price), [600, 0, 600]);
});

test('every request cap holds at its boundary and fails one step beyond: price, weight, ergonomics, recoil, magazine, sighting', async () => {
  const lookup = lookupOf(
    gunWith(WEAPON, { ergo: 10, weight: 2, recoilV: 100, recoilH: 50, slots: [slot('s1', ['a', 'c']), slot('s2', ['b'])] }),
    ['a', modWith('a', { ergo: 20, recoil: 0.1, weight: 1, capacity: 10 })],
    ['c', modWith('c', { ergo: 5, recoil: -0.2, weight: 0.5, sighting: 50, capacity: 30 })],
    ['b', modWith('b', { ergo: 8, recoil: -0.1, weight: 0.25 })],
  );
  // Unconstrained, ergonomics alone: a and b.
  assert.deepEqual(installed(await agree(paramsOf(lookup))), ['a', 'b']);
  const boundaries: [Partial<SolveParams>, string[]][] = [
    [{ maxPrice: 5200 }, ['a', 'b']],
    [{ maxPrice: 5199 }, ['a']],
    [{ maxWeight: 3.25 }, ['a', 'b']],
    [{ maxWeight: 3.2 }, ['a']],
    [{ minErgonomics: 38 }, ['a', 'b']],
    [{ maxRecoilV: 100 }, ['a', 'b']],
    [{ maxRecoilV: 99 }, ['b', 'c']],
    [{ minMagCapacity: 30 }, ['b', 'c']],
    [{ minSightingRange: 50 }, ['b', 'c']],
  ];
  for (const [extra, expected] of boundaries) assert.deepEqual(installed(await agree(paramsOf(lookup, extra))), expected, JSON.stringify(extra));
  const impossible = await solveFast({ params: paramsOf(lookup, { minErgonomics: 99 }), deadline: FAR() });
  assert.equal(impossible.kind, 'empty', 'a cap nothing meets is model-infeasible');
  assert.equal(impossible.kind === 'empty' && impossible.source, 'native');
});

test('MOA under Fast: an installed barrel replaces the intrinsic centre of impact, with the same exact verdict as Precise', async () => {
  const lookup = lookupOf(
    gunWith(WEAPON, { ergo: 0, coi: 6, slots: [slot('barrel', ['wide', 'tight']), slot('muzzle', ['brake'])] }),
    ['wide', modWith('wide', { ergo: 10, coi: 4 })],
    ['tight', modWith('tight', { ergo: 2, coi: 0.5 })],
    ['brake', modWith('brake', { ergo: 3, accuracy: 4 })],
  );
  assert.deepEqual(installed(await agree(paramsOf(lookup))), ['brake', 'wide']);
  const capped = await agree(paramsOf(lookup, { maxMOA: 20 }));
  assert.deepEqual(installed(capped), ['brake', 'tight'], 'the wide barrel is over the cap, the tight one under it');
  assert.ok(built(capped).best.stats.moa <= 20);
  const none = await solveFast({ params: paramsOf(lookup, { maxMOA: 1 }), deadline: FAR() });
  assert.equal(none.kind, 'empty');
});

test('Tchebycheff against a given ideal point picks the same exact build as Precise, and a missing ideal point is an input error', async () => {
  const lookup = lookupOf(
    gunWith(WEAPON, { ergo: 0, slots: [slot('s1', ['a', 'b', 'c'])] }),
    ['a', modWith('a', { ergo: 20, recoil: 0.1 })],
    ['b', modWith('b', { ergo: 10, recoil: -0.05 })],
    ['c', modWith('c', { ergo: 2, recoil: -0.2, offers: [trader('prapor', 1, 10_000)] })],
  );
  const idealPoint = { zE: 200, nadE: 20, zR: -200, nadR: 100, zP: 5000, nadP: 15000 };
  const params = paramsOf(lookup, { useTchebycheff: true, idealPoint, ergoWeight: 1, recoilWeight: 1, priceWeight: 1 });
  const fast = await agree(params);
  assert.ok(Number.isFinite(built(fast).best.score));
  await assert.rejects(() => solveFast({ params: paramsOf(lookup, { useTchebycheff: true }), deadline: FAR() }), /ideal point/);
});

test('TrueErgo and Prevent Overswing run on the Fast model (the weight search of solveFast.ted.test.ts): they are neither refused nor ignored', async () => {
  const lookup = lookupOf(gun(WEAPON, { weight: 1, slots: [slot('s', ['a'])] }), ['a', mod('a', { ergo: 1, weight: 1 })]);
  for (const request of [{ useTrueErgo: true }, { preventOverswing: true }]) {
    const params = paramsOf(lookup, request);
    const result = await solveFast({ params, deadline: FAR() });
    assert.deepEqual(installed(result), ['a']);
    assert.equal(result.summary.spatial, true);
    assertValid(params, result);
  }
});

// ---------------------------------------------------------------------------------------------------------------------------
// Emptiness and the deadline
// ---------------------------------------------------------------------------------------------------------------------------

test('an empty domain and a false constant row are empty with no native call; native infeasibility is empty with source native', async () => {
  const noBase = lookupOf(gun(WEAPON, { offers: [], slots: [slot('s', ['a'])] }), ['a', mod('a')]);
  const calls: string[] = [];
  const spy: SolveFn = async (lp, options) => { calls.push('call'); return nativeSolve(lp, options); };
  const domain = await solveFast({ params: paramsOf(noBase), deadline: FAR(), solve: spy });
  assert.equal(domain.kind === 'empty' && domain.source, 'domain');
  const ghost = lookupOf(gun(WEAPON, { slots: [slot('s', ['a'])] }), ['a', mod('a')]);
  const request = await solveFast({ params: paramsOf(ghost, { includeItems: ['ghost'] }), deadline: FAR(), solve: spy });
  assert.equal(request.kind === 'empty' && request.source, 'request');
  assert.deepEqual(calls, [], 'neither needed the solver');
  const native = await solveFast({ params: paramsOf(ghost, { maxPrice: 10 }), deadline: FAR() });
  assert.equal(native.kind === 'empty' && native.source, 'native');
});

test('a deadline that has passed is incomplete with the time-limit reason', async () => {
  const lookup = lookupOf(gun(WEAPON, { slots: [slot('s', ['a'])] }), ['a', mod('a', { ergo: 1 })]);
  const result = await solveFast({ params: paramsOf(lookup), deadline: performance.now() - 1 });
  assert.equal(result.kind, 'incomplete');
  assert.equal(result.kind === 'incomplete' && result.reason, 'Time limit reached');
});

// ---------------------------------------------------------------------------------------------------------------------------
// Rejected points: the cut loop
// ---------------------------------------------------------------------------------------------------------------------------

/**
 * One slot, two candidates: A (20) and B (10). The tampered solver (`overfillEdges`) answers with both edges at 1, a count point the decoder cannot
 * place (two children in a slot of one copy): it is rejected and cut out, and the next point is the real optimum A.
 */
const rejectable = () => lookupOf(
  gun(WEAPON, { slots: [slot('s0', ['A', 'B'])] }),
  ['A', mod('A', { ergo: 20 })],
  ['B', mod('B', { ergo: 10 })],
);

test('rejection: a point the decoder cannot place is cut out, and the next best point is a valid build, the exact optimum', async () => {
  const params = paramsOf(rejectable());
  const result = await solveFast({ params, deadline: FAR(), solve: overfillEdges(1), edgeIntegrality: 'integer' });
  assert.ok(result.summary.rejectedPoints >= 1, 'the tampered point is not a physical build');
  assert.equal(result.kind, 'build');
  assertValid(params, result);
  const exact = await solvePrecise({ params, deadline: FAR() });
  assert.equal(exact.kind, 'build');
  const optimum = exact.kind === 'build' ? exact.best.score : Number.NaN;
  assert.equal(optimum, 20);
  assert.equal(built(result).best.score, optimum, 'the cut loop reaches the exact optimum here');
  assert.deepEqual(installed(result), ['A']);
});

test('when every candidate is rejected the request is incomplete, never a guess: a solver stuck on invalid points stops at the rejection limit', async () => {
  const params = paramsOf(rejectable());
  const result = await solveFast({ params, deadline: FAR(), solve: overfillEdges(), maxRejections: 3, edgeIntegrality: 'integer' });
  assert.equal(result.kind, 'incomplete');
  assert.equal(result.kind === 'incomplete' && result.reason, 'Independent build validation failed');
  assert.equal(result.summary.rejectedPoints, 3);
  assert.ok(MAX_FAST_REJECTIONS >= 16);
});

test('a limit stop with a primal solution that the validator accepts is a build with the stop reason, not an optimum', async () => {
  const lookup = lookupOf(gun(WEAPON, { slots: [slot('s', ['a'])] }), ['a', mod('a', { ergo: 4 })]);
  const limited: SolveFn = async (lp, options) => {
    const real = await nativeSolve(lp, options);
    return { ...real, modelStatus: { code: 13, name: 'TimeLimit' } } as unknown as Awaited<ReturnType<SolveFn>>;
  };
  const result = await solveFast({ params: paramsOf(lookup), deadline: FAR(), solve: limited });
  assert.equal(built(result).optimal, false);
  assert.equal(built(result).reason, 'Time limit reached');
  assert.deepEqual(installed(result), ['a']);
});

test('the first round runs with the Fast presolve setting and an infeasible verdict is confirmed with presolve off', async () => {
  const lookup = lookupOf(gun(WEAPON, { slots: [slot('s', ['a'])] }), ['a', mod('a', { ergo: 4 })]);
  const seen: boolean[] = [];
  const spy: SolveFn = (lp, options) => { seen.push(options.presolve === 'off'); return nativeSolve(lp, options); };
  await solveFast({ params: paramsOf(lookup, { maxPrice: 10 }), deadline: FAR(), solve: spy, presolve: 'choose' });
  assert.deepEqual(seen, [false, true]);
  seen.length = 0;
  await solveFast({ params: paramsOf(lookup, { maxPrice: 10 }), deadline: FAR(), solve: spy, presolve: 'off' });
  assert.deepEqual(seen, [true]);
});

test('flea and barter offers price a deficit like any other lot (the cheapest legal cover), and a disabled market leaves only cash', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['a'])] }),
    ['a', mod('a', { ergo: 9, offers: [trader('prapor', 4, 900), flea(400)] })],
  );
  const open = await agree(paramsOf(lookup, { priceWeight: 1 }));
  assert.equal(built(open).best.stats.spend, 5400);
  const closed = await agree(paramsOf(lookup, { priceWeight: 1, fleaAvailable: false, traderLevels: { ...DEFAULT_TRADER_LEVELS, prapor: 4 } }));
  assert.equal(built(closed).best.stats.spend, 5900);
});
