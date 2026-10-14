// specializeLP rows of ADR 0003: occurrence variables, slot mutex and activation, required occupancy, template/self/slot conflicts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gun, lookupOf, mod, slot, trader, WEAPON } from './lpFixtures';
import { prepare, solve, solveLp, withRows } from './lpHarness';

const ergoOnly = { ergoWeight: 1, recoilWeight: 0 } as const;
const close = (actual: number, expected: number, tolerance = 1e-9): void =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

const countOf = (build: { installed: ReadonlyMap<string, number> } | null, id: string): number => build?.installed.get(id) ?? 0;

test('two copies of A in sibling slots are legal when its conflict partner B is absent', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { ergo: 10, slots: [slot('s1', ['a']), slot('s2', ['a']), slot('s3', ['b'])] }),
    ['a', mod('a', { ergo: 3, conflictsItems: ['b'] })],
    ['b', mod('b', { ergo: 5 })],
  );
  const { solution, build } = await solve(lookup, WEAPON, ergoOnly);
  assert.equal(solution.status, 'Optimal');
  close(solution.objective, 16); // 10 + 3 + 3; a + a + b would be 21 but A and B conflict, and b alone is 15
  assert.equal(countOf(build, 'a'), 2);
  assert.equal(countOf(build, 'b'), 0);
});

test('A together with B is rejected: the stronger partner wins alone', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { ergo: 10, slots: [slot('s1', ['a']), slot('s2', ['a']), slot('s3', ['b'])] }),
    ['a', mod('a', { ergo: 3, conflictsItems: ['b'] })],
    ['b', mod('b', { ergo: 50 })],
  );
  const { solution, build } = await solve(lookup, WEAPON, ergoOnly);
  close(solution.objective, 60);
  assert.equal(countOf(build, 'a'), 0);
  assert.equal(countOf(build, 'b'), 1);
});

test('a template that lists itself as a conflict is capped at one installed copy', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { ergo: 10, slots: [slot('s1', ['a']), slot('s2', ['a'])] }),
    ['a', mod('a', { ergo: 4, conflictsItems: ['a'] })],
  );
  const { solution, build } = await solve(lookup, WEAPON, ergoOnly);
  close(solution.objective, 14);
  assert.equal(countOf(build, 'a'), 1);
});

test('a slot conflict blocks every physical occurrence of the slot id, so the blocker is worth more only when it beats them all', async () => {
  // holder sits in two gun slots, so its slot `t` has two physical occurrences; d fits in `t`; blocker forbids `t` everywhere.
  const build = (blockerErgo: number) => lookupOf(
    gun(WEAPON, { ergo: 10, slots: [slot('g1', ['holder']), slot('g2', ['holder']), slot('b1', ['blocker'])] }),
    ['holder', mod('holder', { slots: [slot('t', ['d'])] })],
    ['d', mod('d', { ergo: 20 })],
    ['blocker', mod('blocker', { ergo: blockerErgo, conflictsSlots: ['t'] })],
  );
  const weak = await solve(build(30), WEAPON, ergoOnly); // 2 x d = 40 beats the blocker's 30
  close(weak.solution.objective, 50);
  assert.equal(countOf(weak.build, 'd'), 2);
  assert.equal(countOf(weak.build, 'blocker'), 0);
  const strong = await solve(build(50), WEAPON, ergoOnly); // the blocker's 50 beats 2 x d = 40: both holders may stay, with no d
  close(strong.solution.objective, 60);
  assert.equal(countOf(strong.build, 'blocker'), 1);
  assert.equal(countOf(strong.build, 'd'), 0);
});

test('a slot conflict includes the blocker\'s own slot: an item that blocks its host slot can never be installed there', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { ergo: 10, slots: [slot('g', ['holder'])] }),
    ['holder', mod('holder', { slots: [slot('t', ['self', 'd'])] })],
    ['self', mod('self', { ergo: 100, conflictsSlots: ['t'] })],
    ['d', mod('d', { ergo: 1 })],
  );
  const { solution, build } = await solve(lookup, WEAPON, ergoOnly);
  close(solution.objective, 11);
  assert.equal(countOf(build, 'self'), 0);
  assert.equal(countOf(build, 'd'), 1);
});

test('an empty required mod slot forces its owner off while an alternative parent survives', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { ergo: 10, slots: [slot('g', ['p', 'q'])] }),
    ['p', mod('p', { ergo: 50, slots: [slot('r', [], true)] })], // p can never be built: its required slot has no candidate
    ['q', mod('q', { ergo: 5 })],
  );
  const { solution, build } = await solve(lookup, WEAPON, ergoOnly);
  assert.equal(solution.status, 'Optimal');
  close(solution.objective, 15);
  assert.equal(countOf(build, 'p'), 0);
  assert.equal(countOf(build, 'q'), 1);
});

test('a required slot makes its owner bring a child', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { ergo: 10, slots: [slot('g', ['p'])] }),
    ['p', mod('p', { ergo: 2, slots: [slot('r', ['c'], true)] })],
    ['c', mod('c', { ergo: 3 })],
  );
  const { solution, build } = await solve(lookup, WEAPON, ergoOnly);
  close(solution.objective, 15); // p brings c: 10 + 2 + 3
  assert.deepEqual(build?.placements.map(p => p.childInstanceId), ['weapon_0/g:p', 'weapon_0/g:p/r:c']);
});

test('an empty required root slot proves the model empty, and the one-row text is infeasible', async () => {
  const lookup = lookupOf(gun(WEAPON, { slots: [slot('r', [], true)] }));
  const { model, solution } = await solve(lookup, WEAPON, ergoOnly);
  assert.equal(model.provedEmpty?.source, 'domain');
  assert.match(model.provedEmpty?.reasons[0] ?? '', /root required slot/);
  assert.equal(solution.status, 'Infeasible');
});

test('with no base to buy the owned receiver is the one base: the model is not empty', async () => {
  const lookup = lookupOf(gun(WEAPON, { offers: [], slots: [slot('s', ['a'])] }), ['a', mod('a', { ergo: 5 })]);
  const { model, solution } = await solve(lookup, WEAPON, ergoOnly);
  assert.equal(model.provedEmpty, null);
  assert.equal(solution.status, 'Optimal');
});

test('a required root slot whose only candidate is unavailable is empty because no candidate survives the masks', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('r', ['x'], true)] }),
    ['x', mod('x', { offers: [] })], // standalone-inaccessible and unowned: supply none
  );
  const { model, solution } = await solve(lookup, WEAPON, ergoOnly);
  assert.equal(model.provedEmpty?.source, 'domain');
  assert.equal(solution.status, 'Infeasible');
});

test('the emitted text writes shortest round-trip numbers and holds no free column', () => {
  const lookup = lookupOf(
    gun(WEAPON, { ergo: 10, slots: [slot('s', ['a'])] }),
    ['a', mod('a', { ergo: 0.1 + 0.2, weight: 0.0155, offers: [trader('prapor', 1, 100)] })],
  );
  const { model } = prepare(lookup, WEAPON, { ...ergoOnly, useTrueErgo: true });
  const words = model.lp.split(/[^A-Za-z_]+/);
  assert.ok(!words.includes('inf') && !words.includes('free'), 'every column has a finite domain');
  assert.ok(model.lp.includes(String(0.1 + 0.2)), 'the shortest round-trip digits of a leaf are written, not a rounded decimal');
  assert.ok(model.lp.includes('0.0155'), 'a fractional weight keeps its digits');
});

test('the self-conflict cap is its own row: a preset that supplies two copies still installs only one', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { ergo: 10, slots: [slot('s1', ['a']), slot('s2', ['a'])], presets: [{ id: 'P', items: [{ itemId: 'a', count: 2 }] }] }),
    ['a', mod('a', { ergo: 4, conflictsItems: ['a'] })],
  );
  const { solution, build, model } = await solve(lookup, WEAPON, ergoOnly);
  close(solution.objective, 14);
  assert.equal(countOf(build, 'a'), 1);
  assert.equal(model.rowFamilies.find(f => f.id === 'self_conflict')?.count, 1);
});

test('the template presence column is exactly the presence indicator, in both directions of its linking', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['a']), slot('s2', ['a']), slot('s3', ['b'])] }),
    ['a', mod('a', { ergo: 3, conflictsItems: ['b'] })],
    ['b', mod('b', { ergo: 5 })],
  );
  const { model } = prepare(lookup, WEAPON, ergoOnly);
  const y = model.columns.presence(1);
  assert.ok(y, 'a template in a conflict pair has a presence column');
  const a1 = model.columns.occurrence(model.blueprint.occurrenceByInstanceId('weapon_0/s1:a')) as string;
  const a2 = model.columns.occurrence(model.blueprint.occurrenceByInstanceId('weapon_0/s2:a')) as string;
  const none = withRows(model.lp, [`pin_a1: ${a1} = 0`, `pin_a2: ${a2} = 0`, `pin_y: ${y} >= 1`]);
  assert.equal((await solveLp(none)).status, 'Infeasible', 'y_A <= the sum of the occurrences of A');
  const one = withRows(model.lp, [`pin_a1: ${a1} = 1`, `pin_y: ${y} <= 0.5`]);
  assert.equal((await solveLp(one)).status, 'Infeasible', 'x_u <= y_A for every occurrence of A');
  const both = withRows(model.lp, [`pin_a1: ${a1} = 1`, `pin_a2: ${a2} = 1`]);
  const solved = await solveLp(both);
  assert.equal(solved.status, 'Optimal');
  close(solved.values[y], 1);
});
