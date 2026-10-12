// Gates A, B and C of the CERTIFIABLE count model of Precise (`specializeCount`, Phase 2.10, decision 2e) against the Stage 1 oracle, at the level of FEASIBLE
// PROJECTIONS. It is the harness of the Fast exactness research (acyclicFast.differential.ts) pointed at the model built through the proof layer, so the same
// gates, the same enumeration and pinning, and the same populations judge it:
//
//   - the ledger (every non-todo case whose active graph is acyclic),
//   - seeded random acyclic worlds (the lpFuzz generator),
//   - the adversarial generator of the research (seven profiles), now WITHOUT the exception the plain Fast model needed: the MOA family (several barrels, accuracy
//     sum above 100 percent points, cap below zero) must equal the oracle, because the certified rows state "the largest centre of impact binds",
//   - the minimal MOA counterexample, in both regimes of the dominance terms,
//   - real-gun slices of the pinned raw documents.
//
// Eligibility is part of the run: `specializeCount` verifies Lemma 1 on the data (the candidate templates of every active occurrence's slot equal the graph's union
// set), so a case whose graph passes the acyclicity gate but breaks the lemma throws and fails here.
//
// Sizes: the defaults finish in a few minutes. COUNT_MODEL_LONG=1 runs the long campaign (about an hour); COUNT_MODEL_SEED shifts the seeds. Run alone:
// cd frontend && npx tsx --test reference/harness/countModel.differential.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEDGER } from '../ledger/index';
import type { ReferenceFixture, ReferenceRequest } from '../oracle/index';
import { generateCase } from './lpFuzz.differential';
import { adversarialCase, Dice, drawRequest, type AdversarialOptions } from './acyclicFastWorlds.differential';
import { pinnedGunIds, realSlice } from './acyclicFastRealSlices.differential';
import { addToTally, checkedSolverStats, formatTally, newTally, runFastExactness, type FastExactness, type Tally } from './acyclicFast.differential';

const LONG = process.env.COUNT_MODEL_LONG === '1';
const SEED = Number(process.env.COUNT_MODEL_SEED ?? 0);
const size = (small: number, long: number): number => (LONG ? long : small);
const summary = (t: { diagnostic: (message: string) => void }, label: string, tally: Tally): void => t.diagnostic(formatTally(label, tally));

test('ledger: every case with an acyclic active graph equals the oracle on the certified count model (A, B, C)', { timeout: 20 * 60_000 }, async t => {
  const tally = newTally();
  const failures: string[] = [];
  for (const c of LEDGER) {
    if (c.todo !== undefined) continue;
    const r = await runFastExactness(c.id, c.fixture, c.request, { certified: true });
    addToTally(tally, r);
    if (r.mismatches.length > 0) failures.push(`${c.id}: ${r.mismatches[0].slice(0, 220)}`);
  }
  summary(t, 'ledger (certified count model)', tally);
  t.diagnostic(`solver: ${JSON.stringify(checkedSolverStats)}`);
  assert.deepEqual(failures, [], `${failures.length} ledger case(s) differ`);
  assert.ok(tally.gated >= 120, `${tally.gated} ledger cases were gated`);
});

test('random acyclic worlds (lpFuzz): projections, objective and emptiness equal the oracle on the certified count model', { timeout: 120 * 60_000 }, async t => {
  const cases = size(60, 1500);
  const tally = newTally();
  const failures: string[] = [];
  for (let k = 0; k < cases; k++) {
    const seed = 20261004 + SEED + k;
    const fuzz = generateCase(seed);
    const request: ReferenceRequest = { ...fuzz.request, use_true_ergo: false, prevent_overswing: false };
    const r = await runFastExactness(`fuzz-${seed}`, fuzz.fixture, request, { certified: true });
    addToTally(tally, r);
    if (r.mismatches.length > 0) failures.push(`seed ${seed}: ${r.mismatches[0].slice(0, 220)}`);
  }
  summary(t, `lpFuzz (${cases} seeds from ${20261004 + SEED})`, tally);
  assert.deepEqual(failures, [], `${failures.length} random case(s) differ`);
  // lpFuzz often draws a part graph with a cycle (a back edge), which is now refused as unsupported data (decision 2d as amended) and skipped here.
  assert.ok(tally.gated >= cases / 3, `${tally.gated} of ${cases} cases were gated`);
});

const PROFILES: { name: string; options: AdversarialOptions; cases: [number, number] }[] = [
  { name: 'baseline', options: {}, cases: [14, 600] },
  { name: 'dense multi-copy', options: { dense: true }, cases: [14, 600] },
  { name: 'back edges (any)', options: { backEdges: 'any' }, cases: [14, 600] },
  { name: 'back edges (dominated: closure cyclic, active graph acyclic)', options: { backEdges: 'dominated' }, cases: [14, 600] },
  { name: 'back edges (required slots)', options: { backEdges: 'required' }, cases: [14, 600] },
  { name: 'MOA, several barrels', options: { moa: true }, cases: [14, 600] },
  // The family the plain Fast rows get wrong: 65 of 600 cases in the research run. More cases by default, so the family is hit.
  { name: 'MOA, accuracy sum above 100', options: { moa: true, bigAccuracy: true }, cases: [90, 600] },
];

test('adversarial worlds: EVERY case equals the oracle on the certified count model, the MOA family included', { timeout: 240 * 60_000 }, async t => {
  const failures: string[] = [];
  const all = newTally();
  let moaDominance = 0;
  for (const [p, profile] of PROFILES.entries()) {
    const tally = newTally();
    const cases = size(...profile.cases);
    for (let k = 0; k < cases; k++) {
      const seed = 100_000 * (p + 1) + SEED + k;
      const world = adversarialCase(seed, profile.options);
      const r: FastExactness = await runFastExactness(`adv-${seed}`, world.fixture, world.request, { certified: true });
      addToTally(tally, r);
      addToTally(all, r);
      if (r.skipped === null && world.features.includes('moa-negative-cap') && world.features.includes('moa-several-barrels')) moaDominance++;
      if (r.mismatches.length > 0) failures.push(`seed ${seed} (${profile.name}) [${world.features.join(',')}]: ${r.mismatches[0].slice(0, 220)}`);
    }
    summary(t, profile.name, tally);
  }
  t.diagnostic(`all adversarial cases: ${formatTally('total', all)}`);
  t.diagnostic(`gated cases in the MOA family (negative cap, several barrels): ${moaDominance}`);
  t.diagnostic(`solver: ${JSON.stringify(checkedSolverStats)}`);
  assert.deepEqual(failures, [], `${failures.length} adversarial case(s) differ`);
});

/**
 * Two optional root slots, two barrels (the research fixture). b1 (centre of impact 1, accuracy +120) and b2 (0.5, accuracy 0) installed together have an
 * accuracy sum of 120 percent points; the oracle's effective centre of impact is the LARGEST one, so MOA = 1 x (1 - 1.2) x K = -6.88 and {b1, b2} meets a cap of -5.
 */
const moaFixture = (accuracyB1: number, withB2 = true): ReferenceFixture => ({
  schemaVersion: 1,
  weapons: [{
    id: 'gun', weightKg: 1, ergonomics: 50, recoilVertical: 100, recoilHorizontal: 50, centerOfImpact: 0,
    slots: [{ id: 'g0', allowedItemIds: ['b1'] }, ...(withB2 ? [{ id: 'g1', allowedItemIds: ['b2'] }] : [])],
    offers: [{ kind: 'trader', trader: 'prapor', level: 1, price: 1000 }],
  }],
  items: [
    { id: 'b1', centerOfImpact: 1, accuracyModifier: accuracyB1, offers: [{ kind: 'trader', trader: 'prapor', level: 1, price: 100 }] },
    ...(withB2 ? [{ id: 'b2', centerOfImpact: 0.5, accuracyModifier: 0, offers: [{ kind: 'trader' as const, trader: 'prapor', level: 1, price: 100 }] }] : []),
  ],
});

test('MOA counterexample: the certified count model keeps the build {b1, b2} (accuracy 120, cap -5) the plain Fast rows lose, and equals the oracle in every neighbouring regime', { timeout: 120_000 }, async t => {
  const request: ReferenceRequest = { weapon_id: 'gun', max_moa: -5 };
  const certified = await runFastExactness('moa-minimal-certified', moaFixture(120), request, { certified: true });
  assert.equal(certified.oracleProjections, 2, 'the oracle accepts {b1} and {b1, b2}');
  assert.equal(certified.fastProjections, 2, 'the certified model accepts both');
  assert.deepEqual(certified.mismatches, []);
  t.diagnostic(`minimal counterexample: oracle ${certified.oracleProjections} projections, certified count model ${certified.fastProjections}`);
  for (const [label, fixture, req] of [
    ['cap above zero', moaFixture(120), { weapon_id: 'gun', max_moa: 5 }],
    ['cap at zero', moaFixture(120), { weapon_id: 'gun', max_moa: 0 }],
    ['cap between the two barrels', moaFixture(120), { weapon_id: 'gun', max_moa: -4 }],
    ['cap that only the larger barrel meets alone', moaFixture(120), { weapon_id: 'gun', max_moa: -6.5 }],
    ['cap that no build meets', moaFixture(120), { weapon_id: 'gun', max_moa: -7 }],
    ['accuracy sum at most 100', moaFixture(80), { weapon_id: 'gun', max_moa: -5 }],
    ['accuracy sum of exactly 100', moaFixture(100), { weapon_id: 'gun', max_moa: -5 }],
    ['one barrel', moaFixture(120, false), { weapon_id: 'gun', max_moa: -5 }],
    ['no cap', moaFixture(120), { weapon_id: 'gun' }],
  ] as [string, ReferenceFixture, ReferenceRequest][]) {
    const r = await runFastExactness(`moa-variant-${label}`, fixture, req, { certified: true });
    assert.deepEqual(r.mismatches, [], label);
  }
});

test('real-gun slices (pinned raw documents, oracle-enumerable): the certified count model equals the oracle', { timeout: 240 * 60_000 }, async t => {
  const guns = pinnedGunIds();
  const random = size(16, 300);
  const tally = newTally();
  const failures: string[] = [];
  let slices = 0;
  const run = async (label: string, gunId: string, sliceSeed: number, requestSeed: number, must: readonly string[]): Promise<void> => {
    const s = realSlice(gunId, sliceSeed, 30_000n, must);
    if (s === null) return;
    slices++;
    const { request } = drawRequest(new Dice(requestSeed), s.fixture, {});
    const r = await runFastExactness(label, s.fixture, request, { maxEnumerate: size(300, 2500), maxPinned: size(400, 2500), certified: true });
    addToTally(tally, r);
    if (r.mismatches.length > 0) failures.push(`${label}: ${r.mismatches[0].slice(0, 200)}`);
  };
  for (let k = 0; k < random; k++) {
    const gun = guns[(k * 7 + SEED) % guns.length];
    await run(`real-${gun.name}-${k}`, gun.id, 100 + SEED + k, 900 + SEED + k, []);
  }
  const blockers = ['63f4ba71f31d4a33b87bd046', '5dff772da3651922b360bf91'];
  for (let rep = 0; rep < size(2, 8); rep++) {
    for (const name of ['M4A1', 'AK-74N', 'SKS', 'MPX']) {
      const gun = guns.find(g => g.name === name);
      if (gun !== undefined) await run(`real-blocker-${name}-${rep}`, gun.id, 500 + SEED + rep * 13, 777 + SEED + rep, [blockers[rep % blockers.length]]);
    }
  }
  const sv98 = guns.find(g => g.name === 'SV-98');
  for (let rep = 0; sv98 !== undefined && rep < size(4, 20); rep++) await run(`real-rail-SV-98-${rep}`, sv98.id, 40 + SEED + rep, 31 + SEED + rep, ['623c2f652febb22c2777d8d7']);
  summary(t, `real slices (${slices} slices)`, tally);
  assert.deepEqual(failures, [], `${failures.length} real slice(s) differ`);
  assert.ok(tally.gated >= slices / 2);
});
