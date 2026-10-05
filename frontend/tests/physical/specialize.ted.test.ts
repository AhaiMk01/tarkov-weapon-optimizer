// TED and Prevent Overswing on a weight node (ADR 0007 principle 6): per-interval rows, exactness on a singleton or a light interval,
// the secant relaxation elsewhere, the knee, and validation of a supplied penalty line. The loop over nodes is Phase 2.4b-3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PhysicalModelError, penaltyLineIsValid, secantOfPenalty, weightPenalty } from '../../src/solver/physical';
import { gun, lookupOf, mod, slot, WEAPON } from './lpFixtures';
import { prepare, solve } from './lpHarness';

const close = (actual: number, expected: number, tolerance = 1e-9): void =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
const count = (build: { installed: ReadonlyMap<string, number> } | null, id: string): number => build?.installed.get(id) ?? 0;
const ted = { ergoWeight: 1, recoilWeight: 0, useTrueErgo: true } as const;

test('the weight penalty q is zero up to 3 kg and 100 - 300 / W above it', () => {
  assert.equal(weightPenalty(2.5), 0);
  assert.equal(weightPenalty(3), 0);
  assert.equal(weightPenalty(4), 25);
  assert.equal(weightPenalty(6), 50);
});

test('secants: exact closed forms on a concave piece, the zero line across the knee, a constant on a singleton', () => {
  const chord = secantOfPenalty(4, 5);
  assert.equal(chord.kind, 'secant');
  assert.equal(chord.line.slope, 15);
  assert.equal(chord.line.intercept, -35);
  assert.equal(chord.exact, false);
  assert.deepEqual(secantOfPenalty(1, 3), { line: { slope: 0, intercept: 0 }, kind: 'zero_exact', exact: true });
  assert.equal(secantOfPenalty(2, 5).kind, 'knee_zero_relaxation');
  assert.deepEqual(secantOfPenalty(6, 6), { line: { slope: 0, intercept: 50 }, kind: 'constant_exact', exact: true });
  assert.equal(penaltyLineIsValid(4, 5, chord.line), true);
  assert.equal(penaltyLineIsValid(2, 5, chord.line), false, 'the chord of [4, 5] is above q at the knee of [2, 5]');
  assert.equal(penaltyLineIsValid(4, 5, { slope: 15, intercept: -34 }), false, 'a line above q at an endpoint is invalid');
});

/** Receiver 4 kg, ergonomics 50; part `a` adds 1 kg and 10 ergonomics, part `h` adds 0.5 kg and 10, part `n` is -2 kg and +50. */
const heavy = () => lookupOf(
  gun(WEAPON, { weight: 4, ergo: 50, slots: [slot('s', ['a'])] }),
  ['a', mod('a', { weight: 1, ergo: 10 })],
);

test('a light weapon (every build at most 3 kg) is exact with no node: TED is the effective ergonomics', async () => {
  const lookup = lookupOf(gun(WEAPON, { weight: 1, ergo: 50, slots: [slot('s', ['a'])] }), ['a', mod('a', { weight: 1, ergo: 10 })]);
  const { model, solution } = await solve(lookup, WEAPON, ted);
  assert.equal(model.exact, true);
  assert.equal(model.spatial?.penalty.kind, 'zero_exact');
  close(solution.objective, 60, 1e-7);
});

test('a singleton weight node is exact: it keeps only builds of that weight and charges q(W) as a constant', async () => {
  const at4 = await solve(heavy(), WEAPON, ted, { weightMin: 4, weightMax: 4 });
  assert.equal(at4.model.exact, true);
  assert.equal(at4.model.spatial?.penalty.kind, 'constant_exact');
  close(at4.solution.objective, 50 - 25, 1e-7); // the bare receiver: TED 50 - q(4) = 25
  assert.equal(count(at4.build, 'a'), 0);
  const at5 = await solve(heavy(), WEAPON, ted, { weightMin: 5, weightMax: 5 });
  close(at5.solution.objective, 60 - 40, 1e-7); // with a: TED 60 - q(5) = 20
  assert.equal(count(at5.build, 'a'), 1);
  const nowhere = await solve(heavy(), WEAPON, ted, { weightMin: 4.5, weightMax: 4.5 });
  assert.equal(nowhere.solution.status, 'Infeasible', 'no build weighs 4.5 kg');
});

test('a secant node over a concave piece is an upper bound that equals q at its endpoints and lies below it between', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { weight: 4, ergo: 50, slots: [slot('s1', ['h']), slot('s2', ['g'])] }),
    ['h', mod('h', { weight: 0.5, ergo: 10 })],
    ['g', mod('g', { weight: 0.5, ergo: -30 })],
  );
  // Builds weigh 4, 4.5 (h or g) or 5 kg, so the chord of [4, 5], q ~ 15 W - 35, is used. At W = 4.5 it is 32.5 while q(4.5) = 33.33:
  // the model credits h with 60 - 32.5 = 27.5 where its true TED is 26.67, and no other build comes close (bare 25, g -10, h + g -10).
  const { model, solution, build } = await solve(lookup, WEAPON, ted, { weightMin: 4, weightMax: 5 });
  assert.equal(model.exact, false);
  assert.equal(model.spatial?.penalty.kind, 'secant');
  close(solution.objective, 60 - 32.5, 1e-7);
  assert.equal(count(build, 'h'), 1);
  assert.ok(solution.objective > 60 - weightPenalty(4.5), 'the relaxation never underestimates the true TED');
});

test('a node across the 3 kg knee relaxes to the zero penalty line', async () => {
  const lookup = lookupOf(gun(WEAPON, { weight: 2, ergo: 50, slots: [slot('s', ['a'])] }), ['a', mod('a', { weight: 2, ergo: 10 })]);
  const { model, solution } = await solve(lookup, WEAPON, ted); // active weights 2 .. 4: the root interval crosses 3 kg
  assert.equal(model.spatial?.penalty.kind, 'knee_zero_relaxation');
  assert.equal(model.exact, false);
  close(solution.objective, 60, 1e-7); // q credited as 0 at W = 4 (true TED is 35)
});

test('prevent overswing rows: TED >= 0 holds only in nodes where it can, and a node outside every weight is a contradiction', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { weight: 6, ergo: 10, slots: [slot('s', ['n'])] }),
    ['n', mod('n', { weight: -2, ergo: 50 })],
  );
  const request = { ergoWeight: 1, recoilWeight: 0, preventOverswing: true } as const;
  // bare receiver: W 6, TED = 10 - q(6) = -40 < 0; with n: W 4, TED = 60 - 25 = 35.
  const heavyNode = await solve(lookup, WEAPON, request, { weightMin: 6, weightMax: 6 });
  assert.equal(heavyNode.solution.status, 'Infeasible');
  const lightNode = await solve(lookup, WEAPON, request, { weightMin: 4, weightMax: 4 });
  assert.equal(lightNode.solution.status, 'Optimal');
  assert.equal(count(lightNode.build, 'n'), 1);
  const outside = await solve(lookup, WEAPON, request, { weightMin: 10, weightMax: 12 });
  assert.equal(outside.model.provedEmpty?.source, 'request');
  assert.equal(outside.solution.status, 'Infeasible');
});

test('an explicit penalty line is checked against q on the node and rejected when it is above', () => {
  const request = { ergoWeight: 1, recoilWeight: 0, useTrueErgo: true } as const;
  const node = { weightMin: 4, weightMax: 5 };
  assert.doesNotThrow(() => prepare(heavy(), WEAPON, request, { ...node, penalty: { slope: 15, intercept: -35.5 } }));
  assert.throws(() => prepare(heavy(), WEAPON, request, { ...node, penalty: { slope: 15, intercept: -34 } }), (e: unknown) => e instanceof PhysicalModelError && e.code === 'INVALID_REQUEST');
});

test('a node is ignored by a request that does not read TED', async () => {
  const { model, solution } = await solve(heavy(), WEAPON, { ergoWeight: 1, recoilWeight: 0 }, { weightMin: 100, weightMax: 200 });
  assert.equal(model.spatial, null);
  assert.equal(model.exact, true);
  close(solution.objective, 60, 1e-7);
});
