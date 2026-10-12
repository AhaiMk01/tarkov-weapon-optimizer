// Seeded random worlds, Fast against the occurrence model (Phase 2.4c; Phase 2.10 milestone 2). The yardstick is the occurrence-level Precise model, which
// left production with owner decision 2d as amended and stays in the tests as the independent cross-check (tests/physical/occurrence/; validated against
// the oracle elsewhere):
//  - on an ACYCLIC part graph (a template is never its own descendant) the count model is exact in placement, so Fast must return the same exact
//    optimum, or be empty exactly when the occurrence model is;
//  - a world whose part graph has a CYCLE is unsupported data: Fast and Precise both refuse it before any solve (`Unsupported data: cyclic part
//    graph`), with no build and no proof.
// Every request feature the Fast rows state is drawn at random: weights, Tchebycheff, caps, MOA, includes and excludes, owned stock, presets with
// counts, whole-lot barters, flea, trader levels, conflicts of all three kinds, self-caps and required slots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partGraphIsAcyclic, preparePhysicalWeapon, validatePhysicalBuild } from '../../src/solver/physical';
import { PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import { solveFast } from '../../src/solver/physical/solveFast';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import type { SolveParams } from '../../src/solver/types';
import { solveOccurrence } from './occurrence/solveOccurrence';
import { randomTedWorld, randomWorld } from './randomWorlds';

const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));

/** A world whose part graph has a cycle: Fast and Precise both refuse it as unsupported data, before any solve. */
async function assertRefused(label: string, params: SolveParams): Promise<void> {
  const deadline = performance.now() + 60_000;
  const precise = await solvePrecise({ params, deadline });
  const fast = await solveFast({ params: { ...params, allowRepeatedParts: true }, deadline, presolve: 'off' });
  for (const [mode, result] of [['Precise', precise], ['Fast', fast]] as const) {
    assert.equal(result.kind, 'incomplete', `${label}: ${mode} ${result.kind}`);
    assert.equal(result.outcome.reason, PUBLIC_REASONS.unsupportedCyclicPartGraph, `${label}: ${mode}`);
    assert.equal(result.outcome.status, 'incomplete', `${label}: ${mode}`);
    assert.equal(result.outcome.physical_certificate, 'none', `${label}: ${mode}`);
    assert.equal(result.outcome.precision_resolved, null, `${label}: ${mode} resolved nothing`);
  }
  assert.equal(precise.summary.telemetry.nativeSolves, 0, `${label}: Precise solved nothing`);
  assert.equal(fast.summary.nativeSolves, 0, `${label}: Fast solved nothing`);
}

const cyclicGraph = (params: SolveParams): boolean => !partGraphIsAcyclic(preparePhysicalWeapon(params.itemLookup, params.weaponId));

async function compare(seed: number, cyclic: boolean): Promise<{ outcome: string }> {
  const { params } = randomWorld(seed, cyclic);
  const label = `seed ${seed} (${cyclic ? 'cyclic generator' : 'acyclic'})`;
  if (cyclicGraph(params)) {
    await assertRefused(label, params);
    return { outcome: 'refused' };
  }
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
  // Whatever Fast publishes is a valid physical build, and on an acyclic graph it is the exact optimum.
  const verdict = validatePhysicalBuild(params.itemLookup, params, fast.best.build, { requirePathInstanceIds: true });
  assert.equal(verdict.ok, true, `${label}: ${JSON.stringify(verdict.violations)}`);
  assert.ok(close(fast.best.score, exact), `${label}: Fast ${fast.best.score} against the exact optimum ${exact}`);
  return { outcome: 'equal' };
}

test('acyclic worlds: Fast equals the exact optimum, or is empty exactly when Precise is (150 seeded cases)', { timeout: 600_000 }, async t => {
  const tally = new Map<string, number>();
  for (let seed = 1; seed <= 150; seed++) {
    const { outcome } = await compare(seed, false);
    tally.set(outcome, (tally.get(outcome) ?? 0) + 1);
  }
  t.diagnostic(JSON.stringify([...tally]));
  assert.ok((tally.get('equal') ?? 0) >= 50, `most cases are nonempty: ${JSON.stringify([...tally])}`);
});

/**
 * TrueErgo and Prevent Overswing (Phase 2.6b): the Fast weight search against the Precise one on seeded worlds with weights near the 3 kg knee, an equipment
 * modifier and at least one TED flag. Both run at the default tolerance, which is the most either may sit below the exact optimum.
 */
const TED_SLACK = 2e-5;
const near = (a: number, b: number): boolean => Math.abs(a - b) <= TED_SLACK + 1e-9 * Math.abs(b);

async function compareTed(seed: number, cyclic: boolean): Promise<{ outcome: string }> {
  const { params } = randomTedWorld(seed, cyclic);
  const label = `seed ${seed} (${cyclic ? 'cyclic generator' : 'acyclic'}, TrueErgo ${String(params.useTrueErgo)}, Prevent Overswing ${String(params.preventOverswing)})`;
  if (cyclicGraph(params)) {
    await assertRefused(label, params);
    return { outcome: 'refused' };
  }
  const precise = await solveOccurrence({ params, deadline: performance.now() + 60_000 });
  const fast = await solveFast({ params: { ...params, allowRepeatedParts: true }, deadline: performance.now() + 60_000, presolve: 'off' });
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
    assert.notEqual(fast.kind, 'build', `${label}: Fast published a build for a request the occurrence model proves empty`);
    return { outcome: 'empty' };
  }
  const exact = precise.best.score;
  assert.equal(fast.kind, 'build', `${label}: the occurrence model found a build and Fast returned ${fast.kind}`);
  if (fast.kind !== 'build') return { outcome: 'fast without a build' };
  assert.ok(near(fast.best.score, exact), `${label}: Fast ${fast.best.score} against the exact optimum ${exact}`);
  assert.equal(fast.optimal, true, `${label}: the search completed`);
  return { outcome: 'equal' };
}

test('TED, acyclic worlds: the Fast weight search equals the exact TED optimum, or is empty exactly when Precise is, and never overswings (200 seeded cases)', { timeout: 600_000 }, async t => {
  const tally = new Map<string, number>();
  for (let seed = 1; seed <= 200; seed++) {
    const { outcome } = await compareTed(seed, false);
    tally.set(outcome, (tally.get(outcome) ?? 0) + 1);
  }
  t.diagnostic(JSON.stringify([...tally]));
  assert.ok((tally.get('equal') ?? 0) >= 100, `most cases are nonempty: ${JSON.stringify([...tally])}`);
  assert.equal(tally.get('precise incomplete') ?? 0, 0);
});

test('TED, worlds from the cyclic generator: a world whose part graph has a cycle is refused by Fast and Precise as unsupported data; the others compare as acyclic (60 seeded cases)', { timeout: 600_000 }, async t => {
  const tally = new Map<string, number>();
  for (let seed = 1001; seed <= 1060; seed++) {
    const { outcome } = await compareTed(seed, true);
    tally.set(outcome, (tally.get(outcome) ?? 0) + 1);
  }
  t.diagnostic(JSON.stringify([...tally]));
  assert.ok((tally.get('refused') ?? 0) >= 20, `the generator reaches cyclic part graphs: ${JSON.stringify([...tally])}`);
});

test('worlds from the cyclic generator: a world whose part graph has a cycle is refused by Fast and Precise as unsupported data; the others compare as acyclic (60 seeded cases)', { timeout: 600_000 }, async t => {
  const tally = new Map<string, number>();
  for (let seed = 1001; seed <= 1060; seed++) {
    const { outcome } = await compare(seed, true);
    tally.set(outcome, (tally.get(outcome) ?? 0) + 1);
  }
  t.diagnostic(JSON.stringify([...tally]));
  assert.ok((tally.get('refused') ?? 0) >= 20, `the generator reaches cyclic part graphs: ${JSON.stringify([...tally])}`);
});
