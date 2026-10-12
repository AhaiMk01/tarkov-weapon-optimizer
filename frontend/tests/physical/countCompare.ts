// Shared by the count-versus-occurrence gate (countVsOccurrence.test.ts) and the long campaigns run from scratch scripts: the test-only occurrence model
// (occurrence/solveOccurrence.ts, the independent cross-check) and production Precise (solvePrecise: the certified count model with its second opinion) on one
// seeded world, compared on kind, certificate, optimum, bounds and validity. It asserts, so a campaign catches the failing seed.
import assert from 'node:assert/strict';
import { assertCountModelApplies, computeActiveBounds, preparePhysicalWeapon, prepareSubproblemDomain, validatePhysicalBuild } from '../../src/solver/physical';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import type { GunLookupEntry, ModLookupEntry, SolveParams } from '../../src/solver/types';
import { solveOccurrence } from './occurrence/solveOccurrence';
import { WEAPON } from './lpFixtures';
import { randomWorld, rng, type World } from './randomWorlds';

export const near = (a: number, b: number, tolerance: number): boolean => Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b));

/**
 * The objective tolerance of the gates. 1e-9 sits AT the native noise: HiGHS may end a solve on a point that uses its 1e-9 primal tolerance in a clamp row
 * (`capped_ergo = raw_ergo + 5e-10`, worth 1e-9 of objective at an ergonomics weight of 2), which lifts the native dual bound, and so the proved gap, to 1.0e-9.
 * And production Precise solves with an integrality tolerance of 1e-7 (owner decision 5b), which lifts a dual bound by up to about 1e-7 on about 1% of solves
 * (seed 8 of the plain worlds: a gap of 1.0e-7), so a request below that tolerance can stay uncertified. A tolerance a decade above both tests the models.
 */
export const NOISE_SAFE_TOLERANCE = 1e-6;

/** A world with the MOA family: large accuracy modifiers, barrels of distinct centres of impact, a negative cap. */
export function moaWorld(seed: number): World {
  const world = randomWorld(seed, false);
  const rand = rng(Math.imul(seed, 2654435761) + 977);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
  const chance = (p: number): boolean => rand() < p;
  for (const id of world.ids) {
    const entry = world.lookup[id] as ModLookupEntry;
    entry.stats.center_of_impact = chance(0.55) ? pick([0.25, 0.5, 1, 2]) : 0;
    entry.stats.accuracy_modifier = chance(0.6) ? pick([45, 60, 35, -10, 20, 0]) : 0;
    entry.stats.ergonomics = pick([-4, 0, 3, 8, 12]);
  }
  (world.lookup[WEAPON] as GunLookupEntry).stats.center_of_impact = pick([0, 0.5, 6]);
  world.params.maxMOA = pick([-0.5, -3, -5, -9, -15, -30]);
  world.params.ergoWeight = pick([1, 2]);
  world.params.recoilWeight = pick([0, 1]);
  return world;
}

export interface Tally {
  [outcome: string]: number;
}

export async function compareModels(label: string, world: World, tolerance: number, tally: Tally): Promise<{ moaFamily: boolean }> {
  const params: SolveParams = { ...world.params, objectiveTolerance: tolerance };
  const blueprint = preparePhysicalWeapon(params.itemLookup, WEAPON);
  const domain = prepareSubproblemDomain(blueprint, params.itemLookup, params);
  const precise = await solveOccurrence({ params, deadline: performance.now() + 120_000 });
  const count = await solvePrecise({ params, deadline: performance.now() + 120_000 });
  let moaFamily = false;
  if (!domain.empty && params.maxMOA != null && params.maxMOA < 0) {
    const barrelCois = new Set<number>();
    for (let t = 1; t < blueprint.templateCount; t++) if (domain.templateActiveCount[t] > 0 && blueprint.templateCenterOfImpact[t] > 0) barrelCois.add(blueprint.templateCenterOfImpact[t]);
    moaFamily = barrelCois.size > 1 && computeActiveBounds(blueprint, domain).accuracy.hi > 100;
  }
  const bump = (key: string): void => { tally[key] = (tally[key] ?? 0) + 1; };
  if (domain.empty) {
    assert.equal(count.kind, 'empty', `${label}: the domain is empty`);
    assert.equal(precise.kind, 'empty', label);
    bump('empty domain');
    return { moaFamily };
  }
  assert.ok(assertCountModelApplies(blueprint, domain).slotsChecked >= 0, `${label}: an acyclic world passes the count-model assertion`);
  assert.notEqual(precise.kind, 'incomplete', `${label}: the occurrence model finishes`);
  assert.notEqual(count.kind, 'incomplete', `${label}: the count model finishes${count.kind === 'incomplete' ? ` (${count.reason})` : ''}`);
  assert.equal(count.summary.telemetry.unqualifiedSolves, 0, `${label}: every count solve is qualified (${count.summary.telemetry.unqualifiedReasons.join(' | ')})`);
  assert.equal(count.summary.telemetry.unsettledDisagreements, 0, `${label}: every second opinion settled`);
  tally.disagreements = (tally.disagreements ?? 0) + count.summary.telemetry.disagreements;
  assert.equal(precise.summary.telemetry.unqualifiedSolves, 0, `${label}: every occurrence solve is qualified`);
  if (precise.kind === 'empty') {
    assert.equal(count.kind, 'empty', `${label}: the occurrence model proves the request empty`);
    bump(moaFamily ? 'empty (MOA family)' : 'empty');
    return { moaFamily };
  }
  assert.equal(precise.kind, 'build', label);
  assert.equal(count.kind, 'build', `${label}: the occurrence model has a build (${precise.best.score}) and the count model returned ${count.kind}`);
  if (count.kind !== 'build' || precise.kind !== 'build') return { moaFamily };
  assert.equal(precise.certified, true, `${label}: the occurrence model certifies`);
  assert.equal(count.certified, true, `${label}: the count model certifies (${count.reason ?? 'no reason'})`);
  assert.ok(near(count.best.score, precise.best.score, 3 * tolerance), `${label}: count ${count.best.score} against occurrence ${precise.best.score}`);
  const verdict = validatePhysicalBuild(params.itemLookup, params, count.best.build, { requirePathInstanceIds: true });
  assert.equal(verdict.ok, true, `${label}: ${JSON.stringify(verdict.violations)}`);
  // each model's proved upper bound covers the other's verified score
  assert.ok(count.summary.bounds.upper !== null && count.summary.bounds.upper >= precise.best.score - 3 * tolerance * Math.max(1, Math.abs(precise.best.score)), `${label}: count bound ${count.summary.bounds.upper} vs occurrence score ${precise.best.score}`);
  assert.ok(precise.summary.bounds.upper !== null && precise.summary.bounds.upper >= count.best.score - 3 * tolerance * Math.max(1, Math.abs(count.best.score)), `${label}: occurrence bound vs count score`);
  bump(moaFamily ? 'equal (MOA family)' : 'equal');
  return { moaFamily };
}

