// Is the Fast count/edge model an exact reformulation of the physical domain when the active template graph is acyclic?
// (research: docs/research/acyclic-fast-exactness.md). Gates A, B and C against the independent oracle, at the level of FEASIBLE PROJECTIONS (see
// acyclicFast.differential.ts): set equality of projections in both directions, pointwise objective parity (hence the exact maximum and the full
// maximizer set), and equality of emptiness.
//
// Populations: every ledger case, seeded random acyclic worlds (lpFuzz), an ADVERSARIAL generator aimed at the families where a count model could differ
// from the per-occurrence domain (acyclicFastWorlds.differential.ts), and real-gun slices (acyclicFastRealSlices.differential.ts).
//
// The suite found ONE deviation: with several barrel templates installable together, an accuracy sum above 100 percent points and a MOA cap below zero, the
// `moa_rep` rows demand the cap of EVERY installed barrel while the oracle uses only the largest centre of impact. The test pins it with a minimal fixture,
// shows that every adversarial failure is that family and nothing else, and shows that relaxing each barrel row by the larger-COI barrels (a text rewrite
// of the research run, `moaDominanceFix`) restores equality on every one of them.
//
// Sizes: the defaults finish in a few minutes. ACYCLIC_FAST_LONG=1 runs the long campaigns quoted in the report (about an hour); ACYCLIC_FAST_SEED shifts
// the seeds. Run alone: cd frontend && npx tsx --test reference/harness/acyclicFast.differential.test.ts
// Sharding (long campaign on every core): ACYCLIC_FAST_SHARDS=n ACYCLIC_FAST_SHARD=i runs every n-th case of each population (round robin); the fixed tests run in
// shard 0 only. ACYCLIC_FAST_PROGRESS=<file> appends one line per case, ACYCLIC_FAST_RESULTS=<file> one JSON line per test with the shard's tallies, which
// a merge sums (the node test runner buffers a file's output until it ends, so these files are the only live view of a long run).
// Work stealing: with ACYCLIC_FAST_CLAIM_DIR=<dir> a case runs in the first process that claims it (an exclusive create of <dir>/<population>-<k>), restricted
// to the residues k mod ACYCLIC_FAST_SHARDS listed in ACYCLIC_FAST_SHARD_SET (default all); populations of very uneven case cost then balance over the processes.
import { test } from 'node:test';
import { appendFileSync, closeSync, openSync } from 'node:fs';
import assert from 'node:assert/strict';
import { LEDGER } from '../ledger/index';
import type { ReferenceFixture, ReferenceItem, ReferenceRequest } from '../oracle/index';
import { generateCase } from './lpFuzz.differential';
import { adversarialCase, Dice, drawRequest, type AdversarialOptions } from './acyclicFastWorlds.differential';
import { pinnedGunIds, realSlice } from './acyclicFastRealSlices.differential';
import {
  addToTally, checkedSolverStats, formatTally, moaDominanceFix, newTally, runFastExactness, solveText,
  type FastExactness, type FastExactnessOptions, type Tally,
} from './acyclicFast.differential';

const LONG = process.env.ACYCLIC_FAST_LONG === '1';
const SEED = Number(process.env.ACYCLIC_FAST_SEED ?? 0);
const size = (small: number, long: number): number => (LONG ? long : small);
const SHARDS = Number(process.env.ACYCLIC_FAST_SHARDS ?? 1);
const SHARD = Number(process.env.ACYCLIC_FAST_SHARD ?? 0);
/** Whether case k of a population belongs to this process: round robin over the shards, or the first process to claim it (work stealing). */
const mine = (population: string, k: number): boolean => {
  const claimDir = process.env.ACYCLIC_FAST_CLAIM_DIR;
  if (claimDir === undefined) return k % SHARDS === SHARD;
  const set = process.env.ACYCLIC_FAST_SHARD_SET;
  if (set !== undefined && !set.split(',').map(Number).includes(k % SHARDS)) return false;
  try {
    closeSync(openSync(`${claimDir}/${population}-${k}`, 'wx'));
    return true;
  } catch {
    return false;
  }
};
/** Fixed tests (ledger, counterexamples) run once, in shard 0. */
const fixedSkip: false | string = SHARD === 0 ? false : 'fixed tests run in shard 0';
const progress = (population: string, k: number, r: FastExactness): void => {
  const file = process.env.ACYCLIC_FAST_PROGRESS;
  if (file !== undefined) appendFileSync(file, `${population} ${k} ${r.skipped ?? (r.mismatches.length > 0 ? 'MISMATCH' : 'ok')}\n`);
};
const record = (testName: string, data: Record<string, unknown>): void => {
  const file = process.env.ACYCLIC_FAST_RESULTS;
  if (file !== undefined) appendFileSync(file, `${JSON.stringify({ test: testName, shard: SHARD, shards: SHARDS, solver: checkedSolverStats, ...data })}\n`);
};

/**
 * Failures of a case that the suite attributes to the documented MOA family (negative cap, several barrels; the accuracy sum above 100 is required too, but
 * the generator's `accuracy-sum-can-pass-100` tag counts each item once and misses sums that pass 100 only through several copies, e.g. seed 700298:
 * 45 + 4 x 45 - 30 = 195). The attribution is checked, not assumed: the caller requires the dominance fix to repair the case, and the fix only relaxes
 * the per-barrel MOA rows, which is a no-op whenever the accuracy sum stays at or below 100.
 */
const isMoaFamily = (features: readonly string[]): boolean => ['moa-negative-cap', 'moa-several-barrels'].every(f => features.includes(f));

const summary = (t: { diagnostic: (message: string) => void }, label: string, tally: Tally): void => t.diagnostic(formatTally(label, tally));

// =============================================================================================================
// 1. The ledger
// =============================================================================================================

test('ledger: every case in scope that Fast accepts equals the oracle (A, B, C, and the production solveFast path); the cyclic cases are out of scope', { skip: fixedSkip, timeout: 20 * 60_000 }, async t => {
  const tally = newTally();
  const outOfScope: string[] = [];
  const failures: string[] = [];
  for (const c of LEDGER) {
    if (c.todo !== undefined) continue;
    const r = await runFastExactness(c.id, c.fixture, c.request, { productionPath: true });
    if (r.skipped === 'cyclic_part_graph') {
      outOfScope.push(c.id);
      continue;
    }
    addToTally(tally, r);
    if (r.mismatches.length > 0) failures.push(`${c.id}: ${r.mismatches[0].slice(0, 220)}`);
  }
  summary(t, 'ledger (in scope)', tally);
  record('ledger', { tally, outOfScope, failures });
  t.diagnostic(`ledger cases out of scope (cyclic part data): ${outOfScope.join('; ') || 'none'}`);
  t.diagnostic(`solver: ${JSON.stringify(checkedSolverStats)}`);
  assert.deepEqual(failures, [], `${failures.length} ledger case(s) differ`);
  assert.ok(tally.gated >= 120, `${tally.gated} ledger cases were gated`);
});

// =============================================================================================================
// 2. Random acyclic worlds (the lpFuzz generator, TED off)
// =============================================================================================================

test('random acyclic worlds (lpFuzz): projections, objective and emptiness equal the oracle', { timeout: 120 * 60_000 }, async t => {
  const cases = size(60, 1500);
  const tally = newTally();
  const failures: string[] = [];
  let shardCases = 0;
  for (let k = 0; k < cases; k++) {
    if (!mine('fuzz', k)) continue;
    shardCases++;
    const seed = 20261004 + SEED + k;
    const fuzz = generateCase(seed);
    const request: ReferenceRequest = { ...fuzz.request, use_true_ergo: false, prevent_overswing: false };
    const r = await runFastExactness(`fuzz-${seed}`, fuzz.fixture, request);
    progress('fuzz', k, r);
    addToTally(tally, r);
    if (r.mismatches.length > 0) failures.push(`seed ${seed}: ${r.mismatches[0].slice(0, 220)}`);
  }
  summary(t, `lpFuzz (${cases} seeds from ${20261004 + SEED}, shard ${SHARD}/${SHARDS})`, tally);
  record('fuzz', { cases, tally, failures });
  assert.deepEqual(failures, [], `${failures.length} random case(s) differ`);
  // lpFuzz often draws a part graph with a cycle (a back edge): out of scope (cyclic part data, production throws an internal error), skipped here.
  assert.ok(tally.gated >= shardCases / 3, `${tally.gated} of ${shardCases} cases were gated`);
});

// =============================================================================================================
// 3. Adversarial worlds
// =============================================================================================================

/**
 * `seedIndex` fixes each profile's seed range (100_000 x (seedIndex + 1)): indices 2 to 4 belonged to the back-edge (cyclic closure) profiles, removed with
 * cyclic part data (owner decision 2026-10-12: out of scope), so every remaining profile draws the same worlds as before.
 */
const PROFILES: { name: string; options: AdversarialOptions; seedIndex: number }[] = [
  { name: 'baseline', options: {}, seedIndex: 0 },
  { name: 'dense multi-copy', options: { dense: true }, seedIndex: 1 },
  { name: 'MOA, several barrels', options: { moa: true }, seedIndex: 5 },
  { name: 'MOA, accuracy sum above 100', options: { moa: true, bigAccuracy: true }, seedIndex: 6 },
];

test('adversarial worlds: every case equals the oracle, except the documented MOA family, which the dominance fix repairs', { timeout: 240 * 60_000 }, async t => {
  const perProfile = size(14, 600);
  const features = new Map<string, number>();
  const failures: string[] = [];
  let moaDeviations = 0;
  let moaRepaired = 0;
  const all = newTally();
  const profiles: Record<string, Tally> = {};
  for (const [p, profile] of PROFILES.entries()) {
    const tally = newTally();
    profiles[profile.name] = tally;
    for (let k = 0; k < perProfile; k++) {
      if (!mine('adv', p * perProfile + k)) continue;
      const seed = 100_000 * (profile.seedIndex + 1) + SEED + k;
      const world = adversarialCase(seed, profile.options);
      const r: FastExactness = await runFastExactness(`adv-${seed}`, world.fixture, world.request);
      progress('adv', p * perProfile + k, r);
      addToTally(tally, r);
      addToTally(all, r);
      if (r.skipped === null) for (const f of world.features) features.set(f, (features.get(f) ?? 0) + 1);
      if (r.mismatches.length === 0) continue;
      if (profile.options.bigAccuracy === true && isMoaFamily(world.features)) {
        moaDeviations++;
        const repaired = await runFastExactness(`adv-${seed}-fixed`, world.fixture, world.request, { lpTransform: moaDominanceFix });
        if (repaired.mismatches.length === 0) moaRepaired++;
        else failures.push(`seed ${seed} (${profile.name}): the dominance fix does not repair ${repaired.mismatches[0].slice(0, 160)}`);
      } else failures.push(`seed ${seed} (${profile.name}) [${world.features.join(',')}]: ${r.mismatches[0].slice(0, 220)}`);
    }
    summary(t, profile.name, tally);
  }
  t.diagnostic(`all adversarial cases: ${formatTally('total', all)}`);
  t.diagnostic(`structural features among the gated cases: ${JSON.stringify([...features].sort())}`);
  t.diagnostic(`documented MOA deviations: ${moaDeviations}, repaired by the dominance fix: ${moaRepaired}`);
  record('adv', { perProfile, profiles, all, features: Object.fromEntries(features), moaDeviations, moaRepaired, failures });
  t.diagnostic(`solver: ${JSON.stringify(checkedSolverStats)} (an Infeasible of the primary setting is cross-checked; "overridden" counts false Infeasible verdicts)`);
  assert.deepEqual(failures, [], `${failures.length} adversarial case(s) differ outside the documented family`);
  assert.equal(moaRepaired, moaDeviations);
});

// =============================================================================================================
// 4. The one deviation: MOA with several barrels, accuracy sum above 100, cap below zero
// =============================================================================================================

/**
 * Two optional root slots, two barrels. b1 (centre of impact 1, accuracy +120) and b2 (0.5, accuracy 0) installed together have accuracy sum 120 percent
 * points and the oracle's effective centre of impact is the LARGEST one, 1: MOA = 1 x (1 - 1.2) x K = -6.88. Fast demands the cap of every barrel, and b2
 * alone would give 0.5 x (1 - 1.2) x K = -3.44.
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

test('MOA counterexample: Fast loses the build {b1, b2} (accuracy 120, cap -5); the larger-COI relaxation restores it; no other combination differs', { skip: fixedSkip, timeout: 120_000 }, async t => {
  const request: ReferenceRequest = { weapon_id: 'gun', max_moa: -5 };
  const plain = await runFastExactness('moa-minimal', moaFixture(120), request);
  assert.equal(plain.oracleProjections, 2, 'the oracle accepts {b1} and {b1, b2}');
  assert.equal(plain.fastProjections, 1, 'Fast accepts only {b1}');
  assert.equal(plain.gateASetEquality.status, 'fail');
  assert.equal(plain.gateAComplete.status, 'fail');
  t.diagnostic(`minimal counterexample: ${plain.gateAComplete.detail}`);
  const fixed = await runFastExactness('moa-minimal-fixed', moaFixture(120), request, { lpTransform: moaDominanceFix });
  assert.deepEqual(fixed.mismatches, []);
  // the family is exactly (cap below zero) x (accuracy sum can pass 100) x (two barrels installable together): remove any one and Fast equals the oracle
  for (const [label, fixture, req] of [
    ['cap above zero', moaFixture(120), { weapon_id: 'gun', max_moa: 5 }],
    ['cap at zero', moaFixture(120), { weapon_id: 'gun', max_moa: 0 }],
    ['accuracy sum at most 100', moaFixture(80), { weapon_id: 'gun', max_moa: -5 }],
    ['one barrel', moaFixture(120, false), { weapon_id: 'gun', max_moa: -5 }],
    ['no cap', moaFixture(120), { weapon_id: 'gun' }],
  ] as [string, ReferenceFixture, ReferenceRequest][]) {
    const r = await runFastExactness(`moa-variant-${label}`, fixture, req);
    assert.deepEqual(r.mismatches, [], label);
  }
});

// =============================================================================================================
// 5. ADR 0011 / issue #39: why the continuous-placement counterexample does not transfer to the integer count/edge model
// =============================================================================================================

test('#39: the two-triangle relaxation is real (LP feasible at 1/2, integer infeasible); the integer model agrees with the physical set', { skip: fixedSkip, timeout: 120_000 }, async t => {
  // Six optional root slots, all admitting T; slot-occupancy conflicts form two disjoint triangles; installed count of T fixed to 3.
  const triangles: [number, number][] = [[0, 1], [1, 2], [0, 2], [3, 4], [4, 5], [3, 5]];
  const rows = triangles.map(([a, b], i) => `  c${i}: p${a} + p${b} <= 1`);
  const columns = Array.from({ length: 6 }, (_, i) => `p${i}`);
  const text = (integer: boolean): string => ['Maximize', '  obj: p0', 'Subject To', ...rows, `  count: ${columns.join(' + ')} = 3`, 'Bounds', ...columns.map(c => `  0 <= ${c} <= 1`), ...(integer ? ['Binary', `  ${columns.join(' ')}`] : []), 'End'].join('\n');
  const relaxed = await solveText(text(false));
  const integral = await solveText(text(true));
  assert.equal(relaxed.status, 'Optimal', 'the continuous relaxation holds a point with count 3 (all six at 1/2)');
  assert.equal(integral.status, 'Infeasible', 'no integral occupancy has count 3: each triangle holds at most one');
  // the reproducer of the issue, by enumeration: zero count-3 witnesses, maximum integral count 2, and 1/2 satisfies every row
  const vectors = Array.from({ length: 64 }, (_, mask) => Array.from({ length: 6 }, (_, i) => (mask >> i) & 1));
  const feasible = vectors.filter(p => triangles.every(([a, b]) => p[a] + p[b] <= 1));
  assert.equal(feasible.filter(p => p.reduce((x, y) => x + y, 0) === 3).length, 0);
  assert.equal(Math.max(...feasible.map(p => p.reduce((x, y) => x + y, 0))), 2);
  assert.ok(triangles.every(() => 0.5 + 0.5 <= 1) && 6 * 0.5 === 3);
  t.diagnostic('relaxation: Optimal (p = 1/2 each, count 3); integer program: Infeasible; enumeration: 0 witnesses of count 3, maximum integral count 2');
});

const OFFER = [{ kind: 'trader' as const, trader: 'prapor', level: 1, price: 100 }];

test('#39 analogue in the physical domain: the closest realizable domain (one blocker template per slot) is exact in Fast, with and without count 3', { skip: fixedSkip, timeout: 300_000 }, async t => {
  // Slots r0..r5 each admit their own template A_i, whose conflicting_slot_ids name the other two slots of its triangle. A_i installed blocks those slots,
  // so the installed sets are the independent sets: the empty set, 6 singletons and 9 pairs (one per triangle). Count 3 is impossible.
  const blocks: Record<number, number[]> = { 0: [1, 2], 1: [0, 2], 2: [0, 1], 3: [4, 5], 4: [3, 5], 5: [3, 4] };
  const items: ReferenceItem[] = Array.from({ length: 6 }, (_, i) => ({
    id: `A${i}`, ergonomics: 10, conflictingSlotIds: blocks[i].map(j => `r${j}`), offers: OFFER,
  }));
  const fixture: ReferenceFixture = {
    schemaVersion: 1,
    weapons: [{ id: 'gun', ergonomics: 0, recoilVertical: 100, recoilHorizontal: 50, slots: items.map((_, i) => ({ id: `r${i}`, allowedItemIds: [`A${i}`] })), offers: [{ kind: 'trader', trader: 'prapor', level: 1, price: 1000 }] }],
    items,
  };
  const free = await runFastExactness('triangles-free', fixture, { weapon_id: 'gun' }, { productionPath: true });
  assert.equal(free.oracleProjections, 1 + 6 + 9);
  assert.deepEqual(free.mismatches, []);
  assert.equal(free.gateASetEquality.status, 'pass');
  // three installed parts means ergonomics at least 30: no physical build, and Fast is empty exactly when the oracle is
  const three = await runFastExactness('triangles-count-3', fixture, { weapon_id: 'gun', min_ergonomics: 30 }, { productionPath: true });
  assert.equal(three.oracleEmpty, true);
  assert.deepEqual(three.mismatches, []);
  assert.equal(three.gateC.status, 'pass');
  const two = await runFastExactness('triangles-count-2', fixture, { weapon_id: 'gun', min_ergonomics: 20 }, { productionPath: true });
  assert.equal(two.oracleProjections, 9);
  assert.deepEqual(two.mismatches, []);
  t.diagnostic('independent sets of two triangles: 16 projections equal; count 3 empty in both; count 2: 9 projections equal');
});

test('#39 analogue: six optional slots admitting ONE template T whose conflicting_slot_ids is any subset B of the slots: Fast equals the oracle for all 64 subsets', { skip: fixedSkip, timeout: 600_000 }, async t => {
  const tally = newTally();
  for (let mask = 0; mask < 64; mask++) {
    const blocked = Array.from({ length: 6 }, (_, i) => i).filter(i => (mask >> i) & 1).map(i => `r${i}`);
    const fixture: ReferenceFixture = {
      schemaVersion: 1,
      weapons: [{ id: 'gun', ergonomics: 0, recoilVertical: 100, recoilHorizontal: 50, slots: Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, allowedItemIds: ['T'] })), offers: [{ kind: 'trader', trader: 'prapor', level: 1, price: 1000 }] }],
      items: [{ id: 'T', ergonomics: 10, conflictingSlotIds: blocked, offers: OFFER }],
    };
    for (const request of [{ weapon_id: 'gun' }, { weapon_id: 'gun', min_ergonomics: 30 }] as ReferenceRequest[]) {
      addToTally(tally, await runFastExactness(`T-blocks-${mask}`, fixture, request));
    }
  }
  summary(t, 'one template, 64 blocked-slot subsets x 2 requests', tally);
  assert.deepEqual(tally.failures, []);
  assert.equal(tally.gated, 128);
});

// =============================================================================================================
// 6. Real-gun slices
// =============================================================================================================

test('real-gun slices (pinned raw documents, oracle-enumerable): Fast equals the oracle', { timeout: 240 * 60_000 }, async t => {
  const guns = pinnedGunIds();
  const random = size(16, 300);
  const tally = newTally();
  const failures: string[] = [];
  const kinds = { multiSlot: 0, slotConflict: 0, pairConflict: 0, presetCopies: 0 };
  let slices = 0;
  let index = -1;
  const run = async (label: string, gunId: string, sliceSeed: number, requestSeed: number, must: readonly string[], options: FastExactnessOptions): Promise<void> => {
    index++;
    if (!mine('real', index)) return;
    const s = realSlice(gunId, sliceSeed, 30_000n, must);
    if (s === null) return;
    slices++;
    if (s.multiSlot) kinds.multiSlot++;
    if (s.slotConflicts > 0) kinds.slotConflict++;
    if (s.pairConflicts > 0) kinds.pairConflict++;
    if (s.presetCopies) kinds.presetCopies++;
    const { request } = drawRequest(new Dice(requestSeed), s.fixture, {});
    const r = await runFastExactness(label, s.fixture, request, { maxEnumerate: size(300, 2500), maxPinned: size(400, 2500), ...options });
    progress('real', index, r);
    addToTally(tally, r);
    if (r.mismatches.length > 0) failures.push(`${label}: ${r.mismatches[0].slice(0, 200)}`);
  };
  for (let k = 0; k < random; k++) {
    const gun = guns[(k * 7 + SEED) % guns.length];
    await run(`real-${gun.name}-${k}`, gun.id, 100 + SEED + k, 900 + SEED + k, [], { productionPath: k % 2 === 0 });
  }
  // the two real slot blockers of the pinned capture (the only items with conflicting_slot_ids), live in slices of several guns
  const blockers = ['63f4ba71f31d4a33b87bd046', '5dff772da3651922b360bf91'];
  const targeted = ['M4A1', 'AK-74N', 'SKS', 'MPX'];
  for (let rep = 0; rep < size(2, 8); rep++) {
    for (const name of targeted) {
      const gun = guns.find(g => g.name === name);
      if (gun === undefined) continue;
      await run(`real-blocker-${name}-${rep}`, gun.id, 500 + SEED + rep * 13, 777 + SEED + rep, [blockers[rep % blockers.length]], { productionPath: true });
    }
  }
  // a real preset that supplies TWO copies of a rail (SV-98, preset 629766c1...): the rail fits three slots of one handguard, so copies, supply and
  // several slots of one owner meet in real data
  const sv98 = guns.find(g => g.name === 'SV-98');
  for (let rep = 0; sv98 !== undefined && rep < size(4, 20); rep++) {
    await run(`real-rail-SV-98-${rep}`, sv98.id, 40 + SEED + rep, 31 + SEED + rep, ['623c2f652febb22c2777d8d7'], { productionPath: true });
  }
  summary(t, `real slices (${slices} slices)`, tally);
  t.diagnostic(`slice structure: ${JSON.stringify(kinds)}`);
  record('real', { slices, tally, kinds, failures });
  assert.deepEqual(failures, [], `${failures.length} real slice(s) differ`);
  assert.ok(tally.gated >= slices / 2);
});
