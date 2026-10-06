// One copy of each part in Fast (owner decision 2c): the model option `singleCopy` of `specializeFast`, and the solve default of `solveFast` / `solve`
// (`allowRepeatedParts`, default false). The single-copy model is a RESTRICTION of the count model: every template's copy bound is capped at one, so
// counts and edges are binary; what it cannot express (a build that repeats a part) is lost, never invented. Precise ignores the option.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { preparePhysicalWeapon, prepareSubproblemDomain, specializeFast } from '../../src/solver/physical';
import type { FastModel, SpecializeRequest, SubproblemRequest } from '../../src/solver/physical';
import { solveFast } from '../../src/solver/physical/solveFast';
import type { FastResult } from '../../src/solver/physical/solveFast';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import { solve } from '../../src/solver/solver';
import type { ItemLookup, SolveParams } from '../../src/solver/types';
import { barter, flea, gun, lookupOf, mod, slot, trader, WEAPON } from './lpFixtures';
import { assertReadbackMatches, assertTextIsStrict } from './lpHarness';

const FAR = (): number => performance.now() + 120_000;

const paramsOf = (lookup: ItemLookup, extra: Partial<SolveParams> = {}): SolveParams => ({
  weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup),
  ergoWeight: 1, recoilWeight: 0, priceWeight: 0, fleaAvailable: true, ...extra,
});

function model(lookup: ItemLookup, request: SpecializeRequest & SubproblemRequest = {}): FastModel {
  const blueprint = preparePhysicalWeapon(lookup, WEAPON);
  const domain = prepareSubproblemDomain(blueprint, lookup, request);
  const built = specializeFast(blueprint, domain, request);
  assertTextIsStrict(built.lp());
  return built;
}

const installed = (r: FastResult): string[] => {
  assert.equal(r.kind, 'build', JSON.stringify(r.kind === 'build' ? '' : r));
  return (r as Extract<FastResult, { kind: 'build' }>).best.build.placements.map(p => p.itemId).sort();
};
const sortedIds = (r: { selected_item_ids: string[] }): string[] => [...r.selected_item_ids].sort();
const spendOf = (r: FastResult): number => (r as Extract<FastResult, { kind: 'build' }>).best.stats.spend;

/** Two slots that both take `a` (ergonomics 10) or `b` (ergonomics 4): the count optimum is `a` twice (20), the single-copy optimum `a` and `b` (14). */
const twoSlots = (): ItemLookup => lookupOf(
  gun(WEAPON, { slots: [slot('s1', ['a', 'b']), slot('s2', ['a', 'b'])] }),
  ['a', mod('a', { ergo: 10 })],
  ['b', mod('b', { ergo: 4 })],
);

/** A host that fits three root slots and carries its own slot for `a`: both `host` and `a` can repeat (three copies), `rep` also takes part in a conflict. */
const repeatable = (): ItemLookup => lookupOf(
  gun(WEAPON, { slots: [slot('m1', ['host']), slot('m2', ['host']), slot('m3', ['host', 'rep'])] }),
  ['host', mod('host', { slots: [slot('r', ['a', 'rep', 'other'])] })],
  ['a', mod('a', { ergo: 1 })],
  ['rep', mod('rep', { conflictsItems: ['other'] })],
  ['other', mod('other')],
);

// ---------------------------------------------------------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------------------------------------------------------

test('single copy: every copy bound is one, so every count and edge column is binary and no presence column exists', async () => {
  const wide = model(repeatable());
  const idx = (m: FastModel, id: string): number => m.blueprint.templateIndexOf(id);
  assert.equal(wide.singleCopy, false, 'the model function defaults to the full count model');
  assert.ok(wide.graph.maxCopies[idx(wide, 'host')] > 1 && wide.graph.maxCopies[idx(wide, 'a')] > 1, 'the full model lets host and a repeat');
  assert.ok(wide.edges.some(e => e.max > 1) && wide.decision.some(d => d.hi > 1), 'an edge below a repeating host is an integer column');
  assert.ok(wide.stats.integers > 0);
  assert.ok(wide.lpBase.includes(` z_${idx(wide, 'rep')}`), 'a repeatable conflict participant carries a presence column');

  const single = model(repeatable(), { singleCopy: true });
  assert.equal(single.singleCopy, true);
  assert.equal(Math.max(...single.graph.maxCopies), 1, 'no template can have a second copy');
  assert.deepEqual([...single.graph.maxCopies].filter(c => c > 0).length, [...wide.graph.maxCopies].filter(c => c > 0).length, 'the same templates stay active');
  assert.equal(single.graph.edgeCount, wide.graph.edgeCount, 'the same slots and edges');
  assert.ok(single.edges.every(e => e.max === 1), 'every edge is binary');
  assert.ok(single.decision.every(d => d.lo === 0 && d.hi === 1), 'every decision column is binary');
  assert.equal(single.stats.integers, 0, 'no general-integer column is left');
  assert.ok(!/ z_\d+/.test(single.lpBase), 'a template that can no longer repeat needs no presence column');
  assert.ok(!/^ {2}zup_/m.test(single.lpBase));
  assert.ok(single.notes.some(n => /single copy/.test(n)), 'the model says it is restricted');
  assert.ok(single.stats.columns < wide.stats.columns, 'the restricted model is smaller');
  await assertReadbackMatches(single.lp());
});

test('single copy keeps self-conflicts, preset supply, owned stock and whole lots exact', () => {
  const lookup = lookupOf(
    gun(WEAPON, {
      slots: [slot('s1', ['p', 'o', 'lot', 'self']), slot('s2', ['p', 'o', 'lot', 'self']), slot('s3', ['p', 'o', 'lot', 'self'])],
      presets: [{ id: 'P', items: [{ itemId: 'p', count: 2 }] }],
    }),
    ['p', mod('p', { ergo: 1 })],
    ['o', mod('o', { ergo: 1 })],
    ['lot', mod('lot', { ergo: 1, offers: [barter('mechanic', 1, 500, false, 3)] })],
    ['self', mod('self', { ergo: 1, conflictsItems: ['self'] })],
  );
  const single = model(lookup, { singleCopy: true, ownedItems: ['o', 'o'], barterAvailable: true });
  const plan = (id: string) => single.plans.get(single.blueprint.templateIndexOf(id));
  assert.equal(plan('o')?.mode, 'covered', 'two owned copies cover the one possible copy: nothing is ever bought');
  assert.equal(plan('p')?.mode, 'lots', 'preset supply of two still makes the deficit nonlinear (one copy installed, one unused)');
  assert.equal(plan('lot')?.mode, 'linear', 'one copy of a lot of three costs the whole lot: a linear term at the cheapest price');
  assert.equal(plan('lot')?.unitPrice, 500);
  assert.equal(single.graph.maxCopies[single.blueprint.templateIndexOf('self')], 1);
  assert.ok(!/ z_\d+/.test(single.lpBase));
});

test('single copy is read from the request only by the Fast model: Precise and the plain Fast text are unchanged', () => {
  const lookup = twoSlots();
  const plain = model(lookup);
  const explicitOff = model(lookup, { singleCopy: false });
  assert.equal(explicitOff.lpBase, plain.lpBase, 'false is the default, byte for byte');
  assert.equal(explicitOff.singleCopy, false);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Solve: the default is one copy; allowRepeatedParts restores the count model
// ---------------------------------------------------------------------------------------------------------------------------

test('a world whose optimum needs two copies: one copy by default returns the best single-copy build; repeats allowed return the two-copy optimum', async () => {
  const lookup = twoSlots();
  const single = await solveFast({ params: paramsOf(lookup), deadline: FAR() });
  assert.deepEqual(installed(single), ['a', 'b'], 'a once (10) plus b (4) beats nothing better without a second a');
  assert.equal(single.summary.singleCopy, true);
  assert.equal((single as Extract<FastResult, { kind: 'build' }>).best.stats.ergonomics, 14);
  assert.equal((single as Extract<FastResult, { kind: 'build' }>).optimal, true, 'optimal for the one-copy model');

  const explicitOff = await solveFast({ params: paramsOf(lookup, { allowRepeatedParts: false }), deadline: FAR() });
  assert.deepEqual(installed(explicitOff), ['a', 'b']);

  const repeats = await solveFast({ params: paramsOf(lookup, { allowRepeatedParts: true }), deadline: FAR() });
  assert.deepEqual(installed(repeats), ['a', 'a']);
  assert.equal(repeats.summary.singleCopy, false);
  assert.equal((repeats as Extract<FastResult, { kind: 'build' }>).best.stats.ergonomics, 20);
  assert.ok(repeats.summary.columns >= single.summary.columns, 'the restricted model is not larger');
});

test('a world where every build needs a repeated part is a Fast emptiness with one copy and a build with repeats allowed; Precise always builds', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('r1', ['a'], true), slot('r2', ['a'], true)] }),
    ['a', mod('a', { ergo: 3 })],
  );
  const single = await solveFast({ params: paramsOf(lookup), deadline: FAR() });
  assert.equal(single.kind, 'empty');
  assert.equal(single.kind === 'empty' && single.source, 'native', 'the approximate model has no point: never a proof');
  assert.equal(single.outcome.status, 'incomplete');
  assert.equal(single.outcome.reason, 'Approximate model infeasible');
  assert.equal(single.outcome.physical_certificate, 'none');

  const repeats = await solveFast({ params: paramsOf(lookup, { allowRepeatedParts: true }), deadline: FAR() });
  assert.deepEqual(installed(repeats), ['a', 'a']);

  for (const allowRepeatedParts of [false, true, undefined]) {
    const precise = await solvePrecise({ params: paramsOf(lookup, { allowRepeatedParts }), deadline: FAR() });
    assert.equal(precise.kind, 'build', `Precise ignores allowRepeatedParts: ${String(allowRepeatedParts)}`);
    assert.deepEqual(precise.kind === 'build' && precise.best.build.placements.map(p => p.itemId).sort(), ['a', 'a']);
  }

  // The same through the public response: an incomplete Fast answer that says it ran one copy, never "infeasible".
  const response = await solve(paramsOf(lookup, { preciseMode: false }));
  assert.equal(response.status, 'incomplete');
  assert.equal(response.reason, 'Approximate model infeasible');
  assert.equal(response.precision_resolved, 'fast');
  assert.equal(response.single_copy, true);
  const widened = await solve(paramsOf(lookup, { preciseMode: false, allowRepeatedParts: true }));
  assert.equal(widened.status, 'optimal');
  assert.deepEqual(sortedIds(widened), ['a', 'a']);
  assert.ok(!('single_copy' in widened));
});

test('preset supply, owned stock and whole lots with one copy: only one copy is installed, nothing extra is bought', async () => {
  // A preset that supplies two `a` and three slots for `a`: one copy rides on the preset, the second preset copy stays unused.
  const preset = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['a']), slot('s2', ['a']), slot('s3', ['a'])], presets: [{ id: 'P', items: [{ itemId: 'a', count: 2 }], offers: [trader('prapor', 1, 1000)] }] }),
    ['a', mod('a', { ergo: 5 })],
  );
  const onePreset = await solveFast({ params: paramsOf(preset), deadline: FAR() });
  assert.deepEqual(installed(onePreset), ['a']);
  assert.equal(spendOf(onePreset), 1000, 'the preset alone: no copy is bought');
  const manyPreset = await solveFast({ params: paramsOf(preset, { allowRepeatedParts: true }), deadline: FAR() });
  assert.deepEqual(installed(manyPreset), ['a', 'a', 'a'], 'two ride on the preset, the third is bought');

  // Owned stock of two: the one installed copy is owned, so nothing is paid beyond the base.
  const owned = lookupOf(gun(WEAPON, { slots: [slot('s1', ['a']), slot('s2', ['a'])] }), ['a', mod('a', { ergo: 5 })]);
  const stash = await solveFast({ params: paramsOf(owned, { ownedItems: ['a', 'a'] }), deadline: FAR() });
  assert.deepEqual(installed(stash), ['a']);
  assert.equal(spendOf(stash), 5000);
  assert.deepEqual(installed(await solveFast({ params: paramsOf(owned, { ownedItems: ['a', 'a'], allowRepeatedParts: true }), deadline: FAR() })), ['a', 'a']);

  // A lot of three is bought whole for the one copy that is installed.
  const lot = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['a']), slot('s2', ['a'])] }),
    ['a', mod('a', { ergo: 5, offers: [barter('mechanic', 1, 500, false, 3)] })],
  );
  const bought = await solveFast({ params: paramsOf(lot, { barterAvailable: true }), deadline: FAR() });
  assert.deepEqual(installed(bought), ['a']);
  assert.equal(spendOf(bought), 5500, 'the whole lot is paid for one copy');
});

test('the one-copy solve is never better than the count model and never invents a build: its score is at most the repeats-allowed score', async () => {
  const worlds: ItemLookup[] = [
    twoSlots(),
    lookupOf(
      gun(WEAPON, { slots: [slot('m1', ['host']), slot('m2', ['host'])] }),
      ['host', mod('host', { ergo: -1, slots: [slot('r', ['a', 'b'])] })],
      ['a', mod('a', { ergo: 6, offers: [flea(200)] })],
      ['b', mod('b', { ergo: 2 })],
    ),
  ];
  for (const lookup of worlds) {
    const single = await solveFast({ params: paramsOf(lookup, { priceWeight: 0.01 }), deadline: FAR() });
    const repeats = await solveFast({ params: paramsOf(lookup, { priceWeight: 0.01, allowRepeatedParts: true }), deadline: FAR() });
    assert.equal(single.kind, 'build');
    assert.equal(repeats.kind, 'build');
    if (single.kind === 'build' && repeats.kind === 'build') assert.ok(single.best.score <= repeats.best.score + 1e-9, `${single.best.score} <= ${repeats.best.score}`);
  }
});

// ---------------------------------------------------------------------------------------------------------------------------
// The public solve: what the response says, Precise unaffected, payoff endpoints
// ---------------------------------------------------------------------------------------------------------------------------

test('solve: the default Fast response says it ran one copy, a repeats-allowed or Precise response says nothing, and Precise is unaffected by the option', async () => {
  const lookup = twoSlots();
  const fast = await solve(paramsOf(lookup, { preciseMode: false }));
  assert.deepEqual(sortedIds(fast), ['a', 'b']);
  assert.equal(fast.single_copy, true);
  assert.equal(fast.precision_resolved, 'fast');

  const wide = await solve(paramsOf(lookup, { preciseMode: false, allowRepeatedParts: true }));
  assert.deepEqual(sortedIds(wide), ['a', 'a']);
  assert.ok(!('single_copy' in wide));

  // an absent preciseMode is Fast too
  const absent = await solve(paramsOf(lookup));
  assert.equal(absent.single_copy, true);

  const preciseBuilds: string[][] = [];
  for (const allowRepeatedParts of [undefined, false, true]) {
    const precise = await solve(paramsOf(lookup, { preciseMode: true, allowRepeatedParts }));
    assert.equal(precise.precision_resolved, 'precise');
    assert.ok(!('single_copy' in precise), 'Precise never claims one copy');
    preciseBuilds.push(sortedIds(precise));
  }
  assert.deepEqual(preciseBuilds, [['a', 'a'], ['a', 'a'], ['a', 'a']], 'Precise allows repeats whatever the option says');
});

test('Tchebycheff payoff endpoints solved in Fast use the same option: the ideal point moves with it, and is the one-copy table by default', async () => {
  const lookup = twoSlots();
  const request = { preciseMode: false, useTchebycheff: true, ergoWeight: 34, recoilWeight: 33, priceWeight: 33 } as const;
  const single = await solve(paramsOf(lookup, request));
  const wide = await solve(paramsOf(lookup, { ...request, allowRepeatedParts: true }));
  assert.ok(single.ideal_point && wide.ideal_point);
  // fE = 10 x ergonomics: the best single-copy ergonomics is 14 (a + b), the best repeated one 20 (a + a).
  assert.equal(wide.ideal_point.zE - single.ideal_point.zE, 60);
  assert.equal(single.single_copy, true);
  assert.ok(!('single_copy' in wide));
  // A Precise Tchebycheff request builds the same table whatever the option says.
  const preciseA = await solve(paramsOf(lookup, { ...request, preciseMode: true, allowRepeatedParts: false }));
  const preciseB = await solve(paramsOf(lookup, { ...request, preciseMode: true, allowRepeatedParts: true }));
  assert.deepEqual(preciseA.ideal_point, preciseB.ideal_point);
  assert.equal(preciseA.ideal_point?.zE, wide.ideal_point.zE);
});

test('a TrueErgo request in Fast reads the option too: the weight search runs on the one-copy model by default', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { weight: 1, slots: [slot('s1', ['a', 'b']), slot('s2', ['a', 'b'])] }),
    ['a', mod('a', { ergo: 10, weight: 0.1 })],
    ['b', mod('b', { ergo: 4, weight: 0.1 })],
  );
  const single = await solveFast({ params: paramsOf(lookup, { useTrueErgo: true, ergoWeight: 100 }), deadline: FAR() });
  assert.deepEqual(installed(single), ['a', 'b']);
  assert.equal(single.summary.spatial, true);
  const wide = await solveFast({ params: paramsOf(lookup, { useTrueErgo: true, ergoWeight: 100, allowRepeatedParts: true }), deadline: FAR() });
  assert.deepEqual(installed(wide), ['a', 'a']);
});
