// Seeded random worlds, Fast against Precise (Phase 2.4c). Precise is the exact occurrence-level model (validated against the independent oracle
// elsewhere), so it is the yardstick here:
//  - on an ACYCLIC template graph (a template is never its own descendant) the count model is exact in placement, so Fast must return the same
//    exact optimum, or be empty exactly when Precise is;
//  - on a CYCLIC graph Fast is an approximation: whatever it publishes is a valid physical build (the validator is the gate), it never beats the
//    exact optimum, and it is never a build when Precise proves the request empty.
// Every request feature the Fast rows state is drawn at random: weights, Tchebycheff, caps, MOA, includes and excludes, owned stock, presets with
// counts, whole-lot barters, flea, trader levels, conflicts of all three kinds, self-caps and required slots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePhysicalBuild } from '../../src/solver/physical';
import { solveFast } from '../../src/solver/physical/solveFast';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import { randomTedWorld, randomWorld } from './randomWorlds';

const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));

async function compare(seed: number, cyclic: boolean): Promise<{ outcome: string }> {
  const { params } = randomWorld(seed, cyclic);
  const deadline = performance.now() + 60_000;
  const precise = await solvePrecise({ params, deadline });
  // Presolve off, the setting the exactness claim is measured with: HiGHS presolve ON returns a wrong Optimal on seed 123 (fastPresolve.test.ts).
  const fast = await solveFast({ params: { ...params, allowRepeatedParts: true }, deadline, presolve: 'off' });
  const label = `seed ${seed} (${cyclic ? 'cyclic' : 'acyclic'})`;
  if (precise.kind === 'incomplete') return { outcome: 'precise incomplete' };
  if (precise.kind === 'empty') {
    assert.notEqual(fast.kind, 'build', `${label}: Fast published a build for a request Precise proves empty`);
    return { outcome: 'empty' };
  }
  const exact = precise.best.score;
  if (fast.kind === 'build') {
    // Whatever Fast publishes is a valid physical build and never beats the exact optimum.
    const verdict = validatePhysicalBuild(params.itemLookup, params, fast.best.build, { requirePathInstanceIds: true });
    assert.equal(verdict.ok, true, `${label}: ${JSON.stringify(verdict.violations)}`);
    assert.ok(fast.best.score <= exact + 1e-6 * Math.max(1, Math.abs(exact)), `${label}: Fast ${fast.best.score} beats the exact optimum ${exact}`);
    if (!cyclic || fast.summary.acyclic) assert.ok(close(fast.best.score, exact), `${label}: Fast ${fast.best.score} against the exact optimum ${exact}`);
    return { outcome: close(fast.best.score, exact) ? 'equal' : 'below' };
  }
  // No Fast build although Precise has one: only a cyclic graph may do that (the approximation), never an acyclic one.
  assert.equal(cyclic, true, `${label}: Precise found a build and Fast returned ${fast.kind}`);
  assert.equal(fast.summary.acyclic, false, `${label}: an acyclic graph must decode`);
  return { outcome: `fast ${fast.kind}` };
}

test('acyclic worlds: Fast equals the exact optimum, or is empty exactly when Precise is (150 seeded cases)', { timeout: 600_000 }, async t => {
  const tally = new Map<string, number>();
  for (let seed = 1; seed <= 150; seed++) {
    const { outcome } = await compare(seed, false);
    tally.set(outcome, (tally.get(outcome) ?? 0) + 1);
  }
  t.diagnostic(JSON.stringify([...tally]));
  assert.ok((tally.get('equal') ?? 0) >= 50, `most cases are nonempty: ${JSON.stringify([...tally])}`);
  assert.equal(tally.get('below') ?? 0, 0);
});

/**
 * TrueErgo and Prevent Overswing (Phase 2.6b): the Fast weight search against the Precise one on seeded worlds with weights near the 3 kg knee, an equipment
 * modifier and at least one TED flag. Both run at the default tolerance, which is the most either may sit below the exact optimum.
 */
const TED_SLACK = 2e-5;
const near = (a: number, b: number): boolean => Math.abs(a - b) <= TED_SLACK + 1e-9 * Math.abs(b);

async function compareTed(seed: number, cyclic: boolean): Promise<{ outcome: string }> {
  const { params } = randomTedWorld(seed, cyclic);
  const precise = await solvePrecise({ params, deadline: performance.now() + 60_000 });
  const fast = await solveFast({ params: { ...params, allowRepeatedParts: true }, deadline: performance.now() + 60_000, presolve: 'off' });
  const label = `seed ${seed} (${cyclic ? 'cyclic' : 'acyclic'}, TrueErgo ${String(params.useTrueErgo)}, Prevent Overswing ${String(params.preventOverswing)})`;
  assert.equal(fast.summary.spatial, true, label);
  if (fast.kind === 'build') {
    // Whatever Fast publishes is a valid physical build, and under Prevent Overswing its exact TED is not negative.
    const verdict = validatePhysicalBuild(params.itemLookup, params, fast.best.build, { requirePathInstanceIds: true });
    assert.equal(verdict.ok, true, `${label}: ${JSON.stringify(verdict.violations)}`);
    if (params.preventOverswing) assert.ok(fast.best.stats.ted >= 0, `${label}: Fast published an overswinging build (TED ${fast.best.stats.ted})`);
    assert.equal(fast.outcome.physical_certificate === 'approximate_optimal' || fast.outcome.physical_certificate === 'feasible', true, label);
    assert.equal(fast.outcome.model_qualification, 'approximate', label);
  }
  if (precise.kind === 'incomplete') return { outcome: 'precise incomplete' };
  if (precise.kind === 'empty') {
    assert.notEqual(fast.kind, 'build', `${label}: Fast published a build for a request Precise proves empty`);
    return { outcome: 'empty' };
  }
  const exact = precise.best.score;
  if (fast.kind === 'build') {
    assert.ok(fast.best.score <= exact + TED_SLACK + 1e-9 * Math.abs(exact), `${label}: Fast ${fast.best.score} beats the exact optimum ${exact}`);
    if (!cyclic || fast.summary.acyclic) {
      assert.ok(near(fast.best.score, exact), `${label}: Fast ${fast.best.score} against the exact optimum ${exact}`);
      assert.equal(fast.optimal, true, `${label}: the search completed`);
    }
    return { outcome: near(fast.best.score, exact) ? 'equal' : 'below' };
  }
  assert.equal(cyclic, true, `${label}: Precise found a build and Fast returned ${fast.kind}`);
  assert.equal(fast.summary.acyclic, false, `${label}: an acyclic graph must decode`);
  return { outcome: `fast ${fast.kind}` };
}

test('TED, acyclic worlds: the Fast weight search equals the exact TED optimum, or is empty exactly when Precise is, and never overswings (200 seeded cases)', { timeout: 600_000 }, async t => {
  const tally = new Map<string, number>();
  for (let seed = 1; seed <= 200; seed++) {
    const { outcome } = await compareTed(seed, false);
    tally.set(outcome, (tally.get(outcome) ?? 0) + 1);
  }
  t.diagnostic(JSON.stringify([...tally]));
  assert.ok((tally.get('equal') ?? 0) >= 100, `most cases are nonempty: ${JSON.stringify([...tally])}`);
  assert.equal(tally.get('below') ?? 0, 0);
  assert.equal(tally.get('precise incomplete') ?? 0, 0);
});

test('TED, cyclic worlds: every published build is valid, never overswings and never beats the exact optimum (60 seeded cases)', { timeout: 600_000 }, async t => {
  const tally = new Map<string, number>();
  for (let seed = 1001; seed <= 1060; seed++) {
    const { outcome } = await compareTed(seed, true);
    tally.set(outcome, (tally.get(outcome) ?? 0) + 1);
  }
  t.diagnostic(JSON.stringify([...tally]));
  assert.ok((tally.get('equal') ?? 0) + (tally.get('below') ?? 0) >= 10, `some cases are nonempty: ${JSON.stringify([...tally])}`);
});

test('cyclic worlds: every published build is valid and never beats the exact optimum (60 seeded cases)', { timeout: 600_000 }, async t => {
  const tally = new Map<string, number>();
  for (let seed = 1001; seed <= 1060; seed++) {
    const { outcome } = await compare(seed, true);
    tally.set(outcome, (tally.get(outcome) ?? 0) + 1);
  }
  t.diagnostic(JSON.stringify([...tally]));
  assert.ok((tally.get('equal') ?? 0) + (tally.get('below') ?? 0) >= 10, `some cases are nonempty: ${JSON.stringify([...tally])}`);
});
