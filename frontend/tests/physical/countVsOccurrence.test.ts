// Differential gate of production Precise against the occurrence model (Phase 2.10, milestones 1 and 2): on seeded acyclic worlds the CERTIFIED optimum of
// production Precise (the count model built through the proof layer, with its second opinion) equals the occurrence model's certified optimum, emptiness agrees,
// every decoded build validates, both certify, and each model's proved upper bound covers the other's score. The occurrence model left production with owner
// decision 2d as amended; it is the exact model validated against the independent oracle elsewhere (reference/harness/lpGates), so it is the yardstick here.
// `countModel.differential.test.ts` judges the count model against the oracle itself. The comparison itself is `countCompare.ts`.
//
// Populations: plain worlds (weights, Tchebycheff, caps, MOA, includes, owned stock, presets with counts, whole-lot barters, conflicts of all three kinds,
// self-caps, required slots), TrueErgo / Prevent Overswing worlds near the 3 kg knee (the spatial search over weight on both models), and MOA worlds built for the
// one family the plain count rows get wrong: several barrels of different centre of impact, accuracy above 100 percent points, a cap below zero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { solveFast } from '../../src/solver/physical/solveFast';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import type { SolveParams } from '../../src/solver/types';
import { compareModels, moaWorld, NOISE_SAFE_TOLERANCE, type Tally } from './countCompare';
import { WEAPON } from './lpFixtures';
import { randomTedWorld, randomWorld } from './randomWorlds';

test('plain acyclic worlds: the count model certifies the occurrence model optimum, or both are empty (300 seeded worlds)', { timeout: 900_000 }, async t => {
  const tally: Tally = {};
  for (let seed = 1; seed <= 300; seed++) await compareModels(`seed ${seed}`, randomWorld(seed, false), NOISE_SAFE_TOLERANCE, tally);
  t.diagnostic(JSON.stringify(tally));
  assert.ok((tally.equal ?? 0) >= 100, `most worlds are nonempty: ${JSON.stringify(tally)}`);
});

test('TrueErgo and Prevent Overswing: the weight search on the count model certifies the occurrence model optimum, or both are empty (150 seeded worlds)', { timeout: 1_800_000 }, async t => {
  const tally: Tally = {};
  for (let seed = 1; seed <= 150; seed++) await compareModels(`ted seed ${seed}`, randomTedWorld(seed, false), NOISE_SAFE_TOLERANCE, tally);
  t.diagnostic(JSON.stringify(tally));
  assert.ok((tally.equal ?? 0) >= 50, `many worlds are nonempty: ${JSON.stringify(tally)}`);
});

test('the MOA family (several barrels, accuracy above 100 percent points, negative cap): the count model and the occurrence model both state the largest-COI rule (200 seeded worlds)', { timeout: 900_000 }, async t => {
  const tally: Tally = {};
  let family = 0;
  let fastLoses = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const world = moaWorld(seed);
    if (!(await compareModels(`moa seed ${seed}`, world, NOISE_SAFE_TOLERANCE, tally)).moaFamily) continue;
    family++;
    // The generator is sharp: the PLAIN per-barrel rows (the Fast model, repeats allowed) lose a physical build on some of these worlds, the certified rows do not.
    const params: SolveParams = { ...world.params, objectiveTolerance: NOISE_SAFE_TOLERANCE, allowRepeatedParts: true };
    const exact = await solvePrecise({ params, deadline: performance.now() + 120_000 });
    const fast = await solveFast({ params, deadline: performance.now() + 120_000, presolve: 'off' });
    if (exact.kind === 'build' && (fast.kind !== 'build' || fast.best.score < exact.best.score - 1e-6 * Math.max(1, Math.abs(exact.best.score)))) fastLoses++;
    if (exact.kind === 'empty') assert.notEqual(fast.kind, 'build', `moa seed ${seed}: Fast published a build for an empty request`);
  }
  t.diagnostic(`${JSON.stringify(tally)}; worlds in the family: ${family}; worlds where the plain Fast rows lose the optimum or every build: ${fastLoses}`);
  assert.ok(family >= 20, `the generator reaches the family: ${family} of 200`);
  assert.ok((tally['equal (MOA family)'] ?? 0) >= 5, `nonempty family worlds are compared: ${JSON.stringify(tally)}`);
  assert.ok(fastLoses >= 1, 'the family is real: the plain rows differ from the exact optimum somewhere');
});

test('a request the count model proves empty by a constant row reports empty without a native solve', async () => {
  const world = randomWorld(7, false);
  const params: SolveParams = { ...world.params, includeItems: ['not_an_item'], objectiveTolerance: 1e-9, compatibilityMap: buildCompatibilityMap(WEAPON, world.lookup) };
  const count = await solvePrecise({ params, deadline: performance.now() + 60_000 });
  assert.equal(count.kind, 'empty');
  assert.equal(count.summary.telemetry.nativeSolves, 0);
});
