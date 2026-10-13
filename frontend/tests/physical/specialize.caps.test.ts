// Request rows: includes (item and category chain), excludes through the masks, and every hard cap at its boundary
// (ADR 0003 principle 4, ADR 0009 principle 4, ADR 0013 4C; INTERPRETATIONS 5, 7, 8, 12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gun, gunWith, lookupOf, mod, modWith, slot, WEAPON } from './lpFixtures';
import { solve } from './lpHarness';

const close = (actual: number, expected: number, tolerance = 1e-9): void =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
const count = (build: { installed: ReadonlyMap<string, number> } | null, id: string): number => build?.installed.get(id) ?? 0;
const ergo = { ergoWeight: 1, recoilWeight: 0 } as const;

test('include_items installs the template at least once, even against the objective; a repeated entry still means once', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { ergo: 10, slots: [slot('s', ['a', 'b'])] }),
    ['a', mod('a', { ergo: 1 })],
    ['b', mod('b', { ergo: 5 })],
  );
  const free = await solve(lookup, WEAPON, ergo);
  assert.equal(count(free.build, 'b'), 1);
  const forced = await solve(lookup, WEAPON, { ...ergo, includeItems: ['a', 'a'] });
  close(forced.solution.objective, 11);
  assert.equal(count(forced.build, 'a'), 1);
});

test('an include with no active occurrence is a contradiction row: excluded, unknown and receiver ids all prove the model empty', async () => {
  const lookup = lookupOf(gun(WEAPON, { slots: [slot('s', ['a'])] }), ['a', mod('a', { ergo: 1 })]);
  for (const [label, request] of [
    ['excluded', { excludeItems: ['a'], includeItems: ['a'] }],
    ['unknown', { includeItems: ['nothing'] }],
    ['receiver', { includeItems: [WEAPON] }],
  ] as const) {
    const { model, solution } = await solve(lookup, WEAPON, { ...ergo, ...request });
    assert.equal(model.provedEmpty?.source, 'request', label);
    assert.equal(model.contradictions[0].family, 'include_item', label);
    assert.equal(solution.status, 'Infeasible', label);
  }
});

test('category filters match the whole chain: an ancestor category excludes, includes and satisfies groups (AND over groups, OR inside)', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { ergo: 0, slots: [slot('s1', ['x', 'y']), slot('s2', ['x', 'y'])] }),
    ['x', mod('x', { ergo: 1, categories: ['muzzle', 'device'] })],
    ['y', mod('y', { ergo: 5, categories: ['grip', 'furniture'] })],
  );
  const base = await solve(lookup, WEAPON, ergo);
  assert.equal(count(base.build, 'y'), 2);
  // `device` is only an ancestor of x's own category: the exclusion still bans x (it would not have been picked anyway), the include forces it.
  const included = await solve(lookup, WEAPON, { ...ergo, includeCategories: [['device']] });
  assert.equal(count(included.build, 'x'), 1);
  assert.equal(count(included.build, 'y'), 1);
  const excluded = await solve(lookup, WEAPON, { ...ergo, excludeCategories: ['furniture'] });
  assert.equal(count(excluded.build, 'y'), 0);
  assert.equal(count(excluded.build, 'x'), 2);
  const groups = await solve(lookup, WEAPON, { ...ergo, includeCategories: [['device', 'nothing'], ['furniture']] });
  assert.equal(count(groups.build, 'x'), 1);
  assert.equal(count(groups.build, 'y'), 1);
  const empty = await solve(lookup, WEAPON, { ...ergo, includeCategories: [['nothing']] });
  assert.equal(empty.model.provedEmpty?.source, 'request');
  assert.equal(empty.solution.status, 'Infeasible');
});

/** `a` is the only part the objective would skip: it costs recoil, so the cap is what installs or forbids it. */
const capFixture = (a: Parameters<typeof modWith>[1], weapon: Parameters<typeof gunWith>[1] = {}) => lookupOf(
  gunWith(WEAPON, { weight: 1, slots: [slot('s', ['a'])], ...weapon }),
  ['a', modWith('a', a)],
);

test('min_ergonomics reads the first clamp: a raw 120 is displayed as 100, so 100 is met and 101 is not', async () => {
  const lookup = capFixture({ ergo: 0 }, { ergo: 110 });
  const met = await solve(lookup, WEAPON, { ...ergo, minErgonomics: 100 });
  assert.equal(met.solution.status, 'Optimal');
  const unmet = await solve(lookup, WEAPON, { ...ergo, minErgonomics: 101 });
  assert.equal(unmet.solution.status, 'Infeasible');
});

test('min_ergonomics at its exact boundary forces the part that reaches it', async () => {
  const lookup = capFixture({ ergo: 5, recoil: 0.25 }, { ergo: 10, recoilV: 100, recoilH: 50 });
  const free = await solve(lookup, WEAPON, { ergoWeight: 0, recoilWeight: 1 });
  assert.equal(count(free.build, 'a'), 0);
  const forced = await solve(lookup, WEAPON, { ergoWeight: 0, recoilWeight: 1, minErgonomics: 15 });
  assert.equal(count(forced.build, 'a'), 1);
  const beyond = await solve(lookup, WEAPON, { ergoWeight: 0, recoilWeight: 1, minErgonomics: 15.5 });
  assert.equal(beyond.solution.status, 'Infeasible');
});

test('max_weight at the exact total admits the part, a hair below drops it', async () => {
  const lookup = capFixture({ ergo: 10, weight: 0.5 });
  const at = await solve(lookup, WEAPON, { ...ergo, maxWeight: 1.5 });
  assert.equal(count(at.build, 'a'), 1);
  const below = await solve(lookup, WEAPON, { ...ergo, maxWeight: 1.4375 });
  assert.equal(count(below.build, 'a'), 0);
});

test('final recoil caps are converted exactly: max_recoil_v and max_recoil_sum at their boundary', async () => {
  const lookup = capFixture({ ergo: 10, recoil: 0.25 }, { recoilV: 100, recoilH: 60 });
  const v = (cap: number) => solve(lookup, WEAPON, { ...ergo, maxRecoilV: cap });
  assert.equal(count((await v(125)).build, 'a'), 1, 'final vertical 100 x 1.25 = 125 meets a cap of 125');
  assert.equal(count((await v(124)).build, 'a'), 0);
  const sum = (cap: number) => solve(lookup, WEAPON, { ...ergo, maxRecoilSum: cap });
  assert.equal(count((await sum(200)).build, 'a'), 1, '(100 + 60) x 1.25 = 200');
  assert.equal(count((await sum(199)).build, 'a'), 0);
});

test('a recoil cap with a nonpositive naked recoil is never dropped', async () => {
  // naked vertical recoil 0: the final value is 0 whatever is installed, so a cap below 0 is a constant contradiction.
  const zero = capFixture({ ergo: 10, recoil: 0.25 }, { recoilV: 0, recoilH: 0 });
  const slack = await solve(zero, WEAPON, { ...ergo, maxRecoilV: 5 });
  assert.equal(slack.solution.status, 'Optimal');
  assert.equal(slack.model.rowFamilies.find(f => f.id === 'cap_recoil')?.vacuous, 1);
  const contradiction = await solve(zero, WEAPON, { ...ergo, maxRecoilV: -1 });
  assert.equal(contradiction.model.provedEmpty?.source, 'request');
  assert.equal(contradiction.solution.status, 'Infeasible');

  // naked vertical recoil -10: final = -10 (1 + m) <= -14 needs m >= 0.4, which only `a` (+0.5) provides.
  const negative = capFixture({ ergo: 0, recoil: 0.5 }, { recoilV: -10, recoilH: 0 });
  const free = await solve(negative, WEAPON, { ergoWeight: 0, recoilWeight: 1 });
  assert.equal(count(free.build, 'a'), 0);
  const capped = await solve(negative, WEAPON, { ergoWeight: 0, recoilWeight: 1, maxRecoilV: -14 });
  assert.equal(count(capped.build, 'a'), 1);
  const impossible = await solve(negative, WEAPON, { ergoWeight: 0, recoilWeight: 1, maxRecoilV: -16 });
  assert.equal(impossible.solution.status, 'Infeasible');
});

test('magazine and sighting minimums take the maximum over receiver and items, never a sum', async () => {
  const lookup = lookupOf(
    gunWith(WEAPON, { slots: [slot('s1', ['m1', 'm2']), slot('s2', ['m2', 'sight']) ], sighting: 100 }),
    ['m1', modWith('m1', { ergo: 0, capacity: 30 })],
    ['m2', modWith('m2', { ergo: 3, capacity: 20 })],
    ['sight', modWith('sight', { ergo: 0, sighting: 150 })],
  );
  const mag = (minimum: number) => solve(lookup, WEAPON, { ...ergo, minMagCapacity: minimum });
  const thirty = await mag(30);
  assert.equal(count(thirty.build, 'm1'), 1, 'only m1 reaches 30, two m2 (20 + 20) do not');
  const thirtyOne = await mag(31);
  assert.equal(thirtyOne.model.provedEmpty?.source, 'request');
  assert.equal(thirtyOne.solution.status, 'Infeasible');
  const sight = (minimum: number) => solve(lookup, WEAPON, { ...ergo, minSightingRange: minimum });
  const receiverMeets = await sight(100);
  assert.equal(receiverMeets.model.rowFamilies.find(f => f.id === 'cap_magazine_sighting')?.vacuous, 1);
  const needItem = await sight(150);
  assert.equal(count(needItem.build, 'sight'), 1);
  const none = await sight(151);
  assert.equal(none.solution.status, 'Infeasible');
});
