// Seeded random worlds, Fast against the occurrence model (Phase 2.4c; Phase 2.10 milestone 2). The yardstick is the occurrence-level Precise model, which
// left production with owner decision 2d as amended and stays in the tests as the independent cross-check (tests/physical/occurrence/; validated against
// the oracle elsewhere):
// on an acyclic part graph (every gun's; a template is never its own descendant) the count model is exact in placement, so Fast must return the same
// exact optimum, or be empty exactly when the occurrence model is.
// Every request feature the Fast rows state is drawn at random: weights, Tchebycheff, caps, MOA, includes and excludes, owned stock, presets with
// counts, whole-lot barters, flea, trader levels, conflicts of all three kinds, self-caps and required slots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePhysicalBuild } from '../../src/solver/physical';
import { solveFast } from '../../src/solver/physical/solveFast';
import { solveOccurrence } from './occurrence/solveOccurrence';
import type { SolveParams } from '../../src/solver/types';
import { randomTedWorld, randomWorld } from './randomWorlds';

const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));

async function compare(seed: number): Promise<{ outcome: string }> {
  const { params } = randomWorld(seed);
  const label = `seed ${seed}`;
  const deadline = performance.now() + 60_000;
  const precise = await solveOccurrence({ params, deadline });
  // Presolve off, the setting the exactness claim is measured with: HiGHS presolve ON returns a wrong Optimal on seed 123 (fastPresolve.test.ts).
  const fast = await solveFast({ params: { ...params, allowRepeatedParts: true }, deadline, presolve: 'off' });
  if (precise.kind === 'incomplete') return { outcome: 'precise incomplete' };
  if (precise.kind === 'empty') {
    assert.notEqual(fast.kind, 'build', `${label}: Fast published a build for a request the occurrence model proves empty`);
    return { outcome: 'empty' };
  }
  const exact = precise.best.score;
  assert.equal(fast.kind, 'build', `${label}: the occurrence model found a build and Fast returned ${fast.kind}`);
  if (fast.kind !== 'build') return { outcome: 'fast without a build' };
  // Whatever Fast publishes is a valid physical build, and it is the exact optimum.
  const verdict = validatePhysicalBuild(params.itemLookup, params, fast.best.build, { requirePathInstanceIds: true });
  assert.equal(verdict.ok, true, `${label}: ${JSON.stringify(verdict.violations)}`);
  assert.ok(close(fast.best.score, exact), `${label}: Fast ${fast.best.score} against the exact optimum ${exact}`);
  return { outcome: 'equal' };
}

test('seeded worlds: Fast equals the exact optimum, or is empty exactly when Precise is (150 seeded cases)', { timeout: 600_000 }, async t => {
  const tally = new Map<string, number>();
  for (let seed = 1; seed <= 150; seed++) {
    const { outcome } = await compare(seed);
    tally.set(outcome, (tally.get(outcome) ?? 0) + 1);
  }
  t.diagnostic(JSON.stringify([...tally]));
  assert.ok((tally.get('equal') ?? 0) >= 50, `most cases are nonempty: ${JSON.stringify([...tally])}`);
});

/**
 * TrueErgo and Prevent Overswing (Phase 2.6b): the Fast weight search against the Precise one on seeded worlds with weights near the 3 kg knee, an equipment
 * modifier and at least one TED flag. The strict comparison runs Fast at an explicit 1e-5 (the capped native gap, as before the Fast TED default): both
 * then run at the shared default, which is the most either may sit below the exact optimum. A second Fast solve at the Fast TED default (owner decision
 * 2026-10-27) may sit at most that default below, computed here from the decided constants and the weights the objective reads.
 */
const TED_SLACK = 2e-5;
const near = (a: number, b: number): boolean => Math.abs(a - b) <= TED_SLACK + 1e-9 * Math.abs(b);
const fastTedDefault = (params: SolveParams): number => {
  if (params.useTchebycheff === true) return 1e-4;
  const weights = Math.max(0, params.ergoWeight ?? 1) + Math.max(0, params.recoilWeight ?? 1) + Math.max(0, params.priceWeight ?? 0);
  return Math.max(1e-5, 0.1 * weights);
};
const withinDefault = (fast: number, exact: number, tolerance: number): boolean => exact - fast <= tolerance + TED_SLACK + 1e-9 * Math.abs(exact)
  && fast - exact <= TED_SLACK + 1e-9 * Math.abs(exact);

async function compareTed(seed: number): Promise<{ outcome: string }> {
  const { params } = randomTedWorld(seed);
  const label = `seed ${seed} (TrueErgo ${String(params.useTrueErgo)}, Prevent Overswing ${String(params.preventOverswing)})`;
  const precise = await solveOccurrence({ params, deadline: performance.now() + 60_000 });
  const fast = await solveFast({ params: { ...params, allowRepeatedParts: true, objectiveTolerance: 1e-5 }, deadline: performance.now() + 60_000, presolve: 'off' });
  const loose = await solveFast({ params: { ...params, allowRepeatedParts: true, objectiveTolerance: undefined }, deadline: performance.now() + 60_000, presolve: 'off' });
  assert.equal(fast.summary.spatial, true, label);
  for (const result of [fast, loose]) {
    if (result.kind !== 'build') continue;
    // Whatever Fast publishes is a valid physical build, and under Prevent Overswing its exact TED is not negative.
    const verdict = validatePhysicalBuild(params.itemLookup, params, result.best.build, { requirePathInstanceIds: true });
    assert.equal(verdict.ok, true, `${label}: ${JSON.stringify(verdict.violations)}`);
    if (params.preventOverswing) assert.ok(result.best.stats.ted >= 0, `${label}: Fast published an overswinging build (TED ${result.best.stats.ted})`);
    assert.equal(result.outcome.physical_certificate === 'approximate_optimal' || result.outcome.physical_certificate === 'feasible', true, label);
    assert.equal(result.outcome.model_qualification, 'approximate', label);
  }
  if (precise.kind === 'incomplete') return { outcome: 'precise incomplete' };
  if (precise.kind === 'empty') {
    assert.notEqual(fast.kind, 'build', `${label}: Fast published a build for a request the occurrence model proves empty`);
    assert.notEqual(loose.kind, 'build', `${label}: Fast (Fast TED default) published a build for a request the occurrence model proves empty`);
    return { outcome: 'empty' };
  }
  const exact = precise.best.score;
  assert.equal(fast.kind, 'build', `${label}: the occurrence model found a build and Fast returned ${fast.kind}`);
  assert.equal(loose.kind, 'build', `${label}: the occurrence model found a build and Fast (Fast TED default) returned ${loose.kind}`);
  if (fast.kind !== 'build' || loose.kind !== 'build') return { outcome: 'fast without a build' };
  assert.ok(near(fast.best.score, exact), `${label}: Fast ${fast.best.score} against the exact optimum ${exact}`);
  assert.equal(fast.optimal, true, `${label}: the search completed`);
  const tolerance = fastTedDefault(params);
  assert.ok(withinDefault(loose.best.score, exact, tolerance), `${label}: Fast (Fast TED default) ${loose.best.score} against the exact optimum ${exact} (tolerance ${tolerance})`);
  assert.equal(loose.optimal, true, `${label}: the search at the Fast TED default completed`);
  return { outcome: 'equal' };
}

test('TED worlds: the Fast weight search equals the exact TED optimum, or is empty exactly when Precise is, and never overswings (200 seeded cases)', { timeout: 600_000 }, async t => {
  const tally = new Map<string, number>();
  for (let seed = 1; seed <= 200; seed++) {
    const { outcome } = await compareTed(seed);
    tally.set(outcome, (tally.get(outcome) ?? 0) + 1);
  }
  t.diagnostic(JSON.stringify([...tally]));
  assert.ok((tally.get('equal') ?? 0) >= 100, `most cases are nonempty: ${JSON.stringify([...tally])}`);
  assert.equal(tally.get('precise incomplete') ?? 0, 0);
});
