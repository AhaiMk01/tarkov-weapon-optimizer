// The MOA floor search (src/solver/moaFloor.ts, ADR 0013 section 6 "MOA floor") with an injected query: every status, discovery then bisection, the
// 14-trial cap, zero and negative caps, stalled and nonfinite thresholds, native optimal versus solution-limit witnesses, cancel and deadline between
// trials, a completed proof surviving a late cancel, and the display floor. A differential section replays the finite-domain checker of ADR 0013
// section 9 (the planning-only reference of the floor state machine) against the production loop cap by cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WitnessBuild } from '../../src/api/client';
import {
  bracketWithinTolerance, displayFloorOf, MOA_FLOOR_MAX_TRIALS, runMoaFloor, runMoaFloorDetailed,
} from '../../src/solver/moaFloor';
import type { FloorNativeStop, FloorQuery, FloorQueryResult, FloorWitness, MoaFloorRequest } from '../../src/solver/moaFloor';
import { ratFromDouble, ratString } from '../../src/solver/physical/exact';
import { outwardGridCeil } from '../../src/solver/physical/display';
import { PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import type { RuntimeGuard } from '../../src/solver/runtimeGuard';
import { gunWith, lookupOf, WEAPON } from '../physical/lpFixtures';

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

const request = (extra: Partial<MoaFloorRequest> = {}): MoaFloorRequest => {
  const itemLookup = lookupOf(gunWith(WEAPON, {}));
  return { weaponId: WEAPON, itemLookup, compatibilityMap: { reachable_items: {}, slot_items: {}, item_to_slots: {}, slot_owner: {} }, ...extra };
};

interface Harness {
  guard: RuntimeGuard;
  state: { cancelled: boolean; yields: number; time: number; onYield: (n: number) => void };
}

/** A guard on a fake clock with a flag-backed cancel and a counted macrotask yield. */
function harness(deadline = 1_000_000): Harness {
  const state = { cancelled: false, yields: 0, time: 0, onYield: (_n: number): void => undefined };
  const guard: RuntimeGuard = {
    deadline,
    now: () => state.time,
    cancelled: () => state.cancelled,
    yieldMacrotask: async () => { state.yields++; state.onYield(state.yields); },
  };
  return { guard, state };
}

const witnessBuild = (moa: number): WitnessBuild => ({
  achieved_moa: moa,
  base: { kind: 'naked' },
  selected_items: [],
  selected_item_ids: [],
  slot_pairs: [],
  scope: {
    weapon_id: WEAPON, precision_resolved: 'precise', model_qualification: 'exact', moa_qualification: 'provisional_model', max_moa: null,
    acquisition: { trader_levels: null, flea_available: true, barter_available: false, barter_exclude_dogtags: false, player_level: null },
    feasibility: {
      max_price: null, min_ergonomics: null, max_recoil_v: null, max_recoil_sum: null, min_mag_capacity: null, min_sighting_range: null, max_weight: null,
      include_items: null, exclude_items: null, include_categories: null, exclude_categories: null, prevent_overswing: false, equip_ergo_modifier: null,
    },
    inventory: { owned_items: [] },
  },
});

const witnessAt = (moa: number, nativeStop: FloorNativeStop = 'optimal'): FloorQueryResult => {
  const w: FloorWitness = { moaExact: ratString(ratFromDouble(moa)), achievedMoa: moa, build: witnessBuild(moa), nativeStop };
  return { kind: 'witness', witness: w };
};
const EMPTY: FloorQueryResult = { kind: 'empty', qualified: true, reason: PUBLIC_REASONS.provisionalMoaModelInfeasible };

interface Point { id: string; moa: number; allowed?: boolean }

/** The finite-domain truth of the ADR checker: the seed is the first allowed point, a trial returns the first allowed point at most its cap. */
function domainQuery(points: Point[], caps: (number | null)[], wrap?: (n: number, result: FloorQueryResult) => FloorQueryResult): FloorQuery {
  const domain = points.filter(p => p.allowed !== false);
  return async cap => {
    caps.push(cap);
    const found = cap === null ? domain[0] : domain.find(p => p.moa <= cap);
    const result = found === undefined ? EMPTY : witnessAt(found.moa);
    return wrap ? wrap(caps.length - 1, result) : result;
  };
}

// ---------------------------------------------------------------------------------------------
// The ADR 0013 section 9 reference (planning-only finite-domain checker), kept verbatim in logic
// ---------------------------------------------------------------------------------------------

interface RefOptions { interruptAt?: number | null; unresolvedAt?: number | null }

function reference(points: Point[], { interruptAt = null, unresolvedAt = null }: RefOptions = {}) {
  const TOL = 0.02;
  const domain = points.filter(p => p.allowed !== false);
  const seed = domain[0];
  if (!seed) return { status: 'model_infeasible', hi: null as number | null, lo: null as number | null, trials: 0, caps: [] as number[] };
  let hi = seed.moa;
  let lo: number | null = null;
  let d = Math.max(1, Math.abs(hi) / 2);
  let trials = 0;
  const caps: number[] = [];
  while (trials < 14 && (lo === null || hi - lo > TOL)) {
    if (interruptAt === trials) break;
    const cap: number = lo === null ? hi - d : lo + (hi - lo) / 2;
    if (!Number.isFinite(cap) || cap >= hi || (lo !== null && cap <= lo)) break;
    trials++;
    caps.push(cap);
    if (unresolvedAt === trials) break;
    const witness = domain.find(p => p.moa <= cap);
    if (witness) {
      if (!(witness.moa < hi)) break;
      hi = witness.moa;
      if (lo === null) d *= 2;
    } else lo = cap;
  }
  return { status: lo !== null && hi - lo <= TOL ? 'model_proved' : 'model_witnessed', hi, lo, trials, caps };
}

const points: Point[] = [{ id: 'wide', moa: 9 }, { id: 'medium', moa: 3 }, { id: 'accurate', moa: 1.25 }];
const permuted: Point[] = [points[1], points[0], points[2]];
const zeroDomain: Point[] = [{ id: 'wide', moa: 1 }, { id: 'zero', moa: 0 }];
const negativeDomain: Point[] = [{ id: 'wide', moa: 5 }, { id: 'signed', moa: -1.5 }];
const scopedDomain: Point[] = [{ id: 'excluded', moa: 0.125, allowed: false }, { id: 'legal', moa: 3 }, { id: 'accurate', moa: 1.5 }];

async function runDomain(domain: Point[], options: { interruptAt?: number; unresolvedAt?: number } = {}) {
  const caps: (number | null)[] = [];
  const h = harness();
  let trialNumber = 0;
  const base = domainQuery(domain, caps);
  const query: FloorQuery = async (cap, guard) => {
    if (cap !== null) trialNumber++;
    if (options.unresolvedAt !== undefined && cap !== null && trialNumber === options.unresolvedAt) {
      caps.push(cap);
      return { kind: 'stopped', reason: PUBLIC_REASONS.requiredProofPrerequisiteUnavailable };
    }
    return base(cap, guard);
  };
  if (options.interruptAt !== undefined) {
    // The ADR checker interrupts BEFORE trial `interruptAt` (0-based count of trials done): cancel arrives across the yield before that trial.
    h.state.onYield = n => { if (n === options.interruptAt! + 1) h.state.cancelled = true; };
  }
  const run = await runMoaFloorDetailed(request(), h.guard, { query });
  return { run, caps, h };
}

// ---------------------------------------------------------------------------------------------
// Differential against the ADR checker
// ---------------------------------------------------------------------------------------------

test('the production search replays the ADR 0013 section 9 checker cap by cap: both witness orders, zero, negative and excluded-source domains', async () => {
  for (const [name, domain] of [['points', points], ['permuted', permuted], ['zero', zeroDomain], ['negative', negativeDomain], ['scoped', scopedDomain]] as const) {
    const expected = reference(domain);
    const { run, caps } = await runDomain(domain);
    assert.deepEqual(caps.slice(1), expected.caps, `${name}: the same threshold sequence (the seed is the first query, with no cap)`);
    assert.equal(caps[0], null, `${name}: the seed carries no cap`);
    assert.equal(run.response.status, expected.status, name);
    assert.equal(run.response.floor, expected.hi, name);
    assert.equal(run.response.proved_lower_bound, expected.lo, name);
    assert.equal(run.trials, expected.trials, name);
  }
});

test('the documented ADR observations: hi 1.25 in 10 trials under both witness orders, zero and signed brackets, the legal minimum of the excluded-source case', async () => {
  const a = await runDomain(points);
  const b = await runDomain(permuted);
  assert.equal(a.run.response.floor, 1.25);
  assert.equal(b.run.response.floor, 1.25);
  assert.equal(a.run.trials, 10);
  assert.equal(b.run.trials, 10);
  assert.equal(a.run.response.proved_lower_bound, 1.234375);
  assert.equal(b.run.response.proved_lower_bound, 1.23828125);
  const zero = await runDomain(zeroDomain);
  assert.equal(zero.run.response.proved_lower_bound, -0.015625);
  assert.equal(zero.run.response.floor, 0);
  assert.equal(zero.run.trials, 9);
  const negative = await runDomain(negativeDomain);
  assert.equal(negative.run.response.floor, -1.5);
  assert.equal(negative.run.response.proved_lower_bound, -1.51953125);
  assert.equal(negative.run.trials, 10);
  const scoped = await runDomain(scopedDomain);
  assert.equal(scoped.run.response.floor, 1.5, 'the excluded source point is not in the domain');
  assert.equal(scoped.run.response.status, 'model_proved');
});

test('interruption before a trial and an unresolved trial retain the upper-bound witness with no invented lower bound (ADR checker)', async () => {
  const interrupted = await runDomain(points, { interruptAt: 0 });
  const refInterrupted = reference(points, { interruptAt: 0 });
  assert.equal(interrupted.run.response.status, 'model_witnessed');
  assert.equal(interrupted.run.response.floor, refInterrupted.hi);
  assert.equal(interrupted.run.response.floor, 9);
  assert.equal(interrupted.run.response.proved_lower_bound, null);
  assert.equal(interrupted.run.response.reason, PUBLIC_REASONS.cancelledByUser);
  assert.equal(interrupted.run.ended, 'cancelled');

  const unresolved = await runDomain(points, { unresolvedAt: 2 });
  const refUnresolved = reference(points, { unresolvedAt: 2 });
  assert.equal(unresolved.run.response.status, 'model_witnessed');
  assert.equal(unresolved.run.response.floor, refUnresolved.hi);
  assert.equal(unresolved.run.response.floor, 3);
  assert.equal(unresolved.run.response.proved_lower_bound, null);
  assert.equal(unresolved.run.response.reason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  assert.equal(unresolved.run.trials, 2);
});

// ---------------------------------------------------------------------------------------------
// Discovery, bisection, the trial cap
// ---------------------------------------------------------------------------------------------

test('discovery doubles d after each verified feasible probe, a qualified emptiness sets lo and switches to bisection, hi only moves to achieved values', async () => {
  const { run, caps } = await runDomain(points);
  // seed 9: d = max(1, 4.5) = 4.5, probe 4.5 -> witness 3 (hi = 3, not 4.5), d = 9, probe 3 - 9 = -6 -> empty (lo = -6), then bisection.
  assert.deepEqual(caps.slice(0, 5), [null, 4.5, -6, -1.5, 0.75]);
  assert.deepEqual(run.trace.map(e => e.step).slice(0, 4), ['seed', 'discovery', 'discovery', 'bisection']);
  assert.equal(run.trace[1].result, 'witness');
  assert.equal(run.trace[1].achieved_moa, 3, 'hi drops to the achieved MOA, never to the trial number 4.5');
  assert.equal(run.trace[2].result, 'empty');
  assert.equal(caps[3], -6 + (3 - -6) / 2, 'bisection t = lo + (hi - lo) / 2');
  // Only qualified emptiness raised lo, and only witnesses lowered hi: lo never decreases, hi never increases.
  let lo = -Infinity;
  let hi = Infinity;
  for (const e of run.trace) {
    if (e.result === 'empty') { assert.ok((e.cap as number) > lo); lo = e.cap as number; }
    if (e.result === 'witness') { assert.ok((e.achieved_moa as number) < hi); hi = e.achieved_moa as number; }
  }
});

test('at most 14 threshold trials: a wide gap ends as model_witnessed with the proved lo, the seed is not a trial', async () => {
  const wide: Point[] = [{ id: 'seed', moa: 1_000_000 }, { id: 'best', moa: 0.5 }];
  const { run, caps } = await runDomain(wide);
  assert.equal(run.trials, MOA_FLOOR_MAX_TRIALS);
  assert.equal(caps.length, MOA_FLOOR_MAX_TRIALS + 1, 'one seed query plus 14 trial queries');
  assert.equal(run.ended, 'trial_cap');
  assert.equal(run.response.status, 'model_witnessed');
  assert.equal(run.response.floor, 0.5);
  assert.ok(run.response.proved_lower_bound !== null, 'a lower bound was actually proved before the cap');
  assert.equal(run.response.reason, undefined, 'the trial cap is not an interruption: the status says the minimum is not proved');
  assert.deepEqual(run.response.witness?.achieved_moa, 0.5);
});

test('model_witnessed also needs no lo at all: an immediate stop after the seed keeps the seed as the upper-bound witness', async () => {
  const caps: (number | null)[] = [];
  const base = domainQuery(points, caps);
  const query: FloorQuery = async (cap, g) => (cap === null ? base(cap, g) : { kind: 'stopped', reason: PUBLIC_REASONS.timeLimitReached });
  const run = await runMoaFloorDetailed(request(), harness().guard, { query });
  assert.equal(run.response.status, 'model_witnessed');
  assert.equal(run.response.floor, 9);
  assert.equal(run.response.proved_lower_bound, null);
  assert.equal(run.response.reason, PUBLIC_REASONS.timeLimitReached);
});

// ---------------------------------------------------------------------------------------------
// Zero and negative caps
// ---------------------------------------------------------------------------------------------

test('zero and negative finite caps are queried as numbers, never dropped as falsy or clamped', async () => {
  const { caps } = await runDomain(zeroDomain);
  assert.ok(caps.includes(0), 'a zero cap is a cap');
  assert.ok(caps.some(c => c !== null && c < 0), 'negative caps are queried');
  assert.ok(caps.slice(1).every(c => typeof c === 'number' && Number.isFinite(c)), 'every trial threshold is a finite number; only the seed is null');
  const negative = await runDomain(negativeDomain);
  assert.ok(negative.caps.slice(1).some(c => c !== null && c < 0));
  assert.equal(negative.run.response.floor, -1.5, 'a negative achieved MOA is a result');
  assert.equal(negative.run.response.display_floor, -1.5);
});

// ---------------------------------------------------------------------------------------------
// Every status
// ---------------------------------------------------------------------------------------------

test('model_proved needs a full witness and a bracket within 0.02: the exact difference of the two doubles', () => {
  assert.equal(bracketWithinTolerance(1, 1.015625), true);
  assert.equal(bracketWithinTolerance(1, 1.03125), false);
  assert.equal(bracketWithinTolerance(-0.0078125, 0.0078125), true, 'a signed bracket');
  assert.equal(bracketWithinTolerance(1, 1.02), false, '1.02 - 1 is 0.0199999999999999 in doubles but the doubles differ from the decimals: decided exactly');
  assert.equal(bracketWithinTolerance(NaN, 1), false);
  assert.equal(bracketWithinTolerance(0, Infinity), false);
});

test('unresolved: a seed that is stopped, cancelled, out of time, or unqualified resolves nothing', async () => {
  const stopped = (reason: string): FloorQuery => async () => ({ kind: 'stopped', reason });
  for (const reason of [PUBLIC_REASONS.timeLimitReached, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable, PUBLIC_REASONS.independentBuildValidationFailed, PUBLIC_REASONS.nativeSolutionLimitReached]) {
    const r = await runMoaFloor(request(), harness().guard, { query: stopped(reason) });
    assert.equal(r.status, 'unresolved');
    assert.equal(r.floor, null);
    assert.equal(r.display_floor, null);
    assert.equal(r.proved_lower_bound, null);
    assert.equal(r.witness, undefined);
    assert.equal(r.reason, reason);
    assert.equal(r.moa_qualification, 'provisional_model');
  }
  // An unqualified emptiness (a Fast or unverified verdict) is not model infeasibility.
  const unqualified = await runMoaFloor(request(), harness().guard, { query: async () => ({ kind: 'empty', qualified: false }) });
  assert.equal(unqualified.status, 'unresolved');
  assert.equal(unqualified.reason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  // Before any query: a guard that already says stop launches nothing.
  const done = harness(0);
  let queried = false;
  const r = await runMoaFloor(request(), done.guard, { query: async () => { queried = true; return witnessAt(1); } });
  assert.equal(queried, false);
  assert.equal(r.status, 'unresolved');
  assert.equal(r.reason, PUBLIC_REASONS.timeLimitReached);
  const cancelled = harness();
  cancelled.state.cancelled = true;
  assert.equal((await runMoaFloor(request(), cancelled.guard, { query: async () => witnessAt(1) })).reason, PUBLIC_REASONS.cancelledByUser);
  // Cancel and the deadline together: cancel first.
  const both = harness(0);
  both.state.cancelled = true;
  assert.equal((await runMoaFloor(request(), both.guard, { query: async () => witnessAt(1) })).reason, PUBLIC_REASONS.cancelledByUser);
});

test('model_infeasible: only a QUALIFIED seed emptiness, and nothing is searched after it', async () => {
  const caps: (number | null)[] = [];
  const r = await runMoaFloor(request(), harness().guard, { query: async cap => { caps.push(cap); return { kind: 'empty', qualified: true }; } });
  assert.equal(r.status, 'model_infeasible');
  assert.equal(r.floor, null);
  assert.equal(r.display_floor, null);
  assert.equal(r.proved_lower_bound, null);
  assert.equal(r.witness, undefined);
  assert.equal(r.moa_qualification, 'provisional_model');
  assert.deepEqual(caps, [null]);
});

test('an invalid stash is the pre-model floor envelope and launches no query', async () => {
  let queried = false;
  const r = await runMoaFloor(request({ ownedItems: ['a', ''] }), harness().guard, { query: async () => { queried = true; return witnessAt(1); } });
  assert.equal(queried, false);
  assert.equal(r.status, 'unresolved');
  assert.equal(r.reason, PUBLIC_REASONS.invalidOwnedItems);
  assert.equal(r.floor, null);
  assert.equal(r.witness, undefined);
});

// ---------------------------------------------------------------------------------------------
// Stalled and nonfinite thresholds, evidence checks
// ---------------------------------------------------------------------------------------------

test('a nonfinite threshold stops the search without a trial and keeps the best witness', async () => {
  // d doubles with each verified feasible probe: 5e307, then 1e308, then 2e308 = Infinity, so the next threshold is -Infinity.
  const overflow: Point[] = [{ id: 's', moa: 1e308 }, { id: 'a', moa: 4e307 }, { id: 'b', moa: -7e307 }];
  const { run, caps } = await runDomain(overflow);
  assert.equal(run.ended, 'threshold');
  assert.equal(run.response.status, 'model_witnessed');
  assert.equal(run.response.floor, -7e307);
  assert.equal(run.response.proved_lower_bound, null);
  assert.equal(run.response.reason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  assert.equal(run.trials, 2, 'the nonfinite threshold was never queried');
  assert.ok(caps.slice(1).every(c => Number.isFinite(c as number)));
  assert.equal(run.response.display_floor, null, 'beyond the safe magnitude the display is withheld while the raw witness stays');
  assert.ok(run.response.witness);
});

test('a stalled threshold (lo and hi adjacent doubles wider than 0.02) stops instead of re-querying a bound', async () => {
  // Near 1.5e14 the spacing of doubles is 0.03125: after the seed 3e14 the probe 1.5e14 is empty, and bisection narrows to one ulp (> 0.02).
  const high: Point[] = [{ id: 'seed', moa: 3e14 }, { id: 'best', moa: 150000000000000.5 }];
  const { run } = await runDomain(high);
  assert.equal(run.ended, 'threshold');
  assert.equal(run.response.status, 'model_witnessed');
  assert.equal(run.response.floor, 150000000000000.5);
  assert.equal(run.response.proved_lower_bound, 150000000000000.5 - 0.03125, 'lo is the double just below hi');
  assert.ok(!bracketWithinTolerance(150000000000000.5 - 0.03125, 150000000000000.5), 'one ulp, 0.03125 > 0.02');
  assert.equal(run.response.reason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  assert.ok(run.trials <= MOA_FLOOR_MAX_TRIALS);
});

test('a witness that does not improve hi stops the search and keeps the earlier witness', async () => {
  let n = 0;
  const query: FloorQuery = async cap => (cap === null ? witnessAt(9) : (++n, witnessAt(9)));
  const run = await runMoaFloorDetailed(request(), harness().guard, { query });
  assert.equal(run.ended, 'no_progress');
  assert.equal(run.response.status, 'model_witnessed');
  assert.equal(run.response.floor, 9);
  assert.equal(n, 1);
});

test('a witness at or below a proved lo contradicts it: the build is kept, the lower bound is not claimed', async () => {
  let trial = 0;
  const query: FloorQuery = async cap => {
    if (cap === null) return witnessAt(9);
    trial++;
    return trial === 1 ? { kind: 'empty', qualified: true } : witnessAt(cap - 100);
  };
  const run = await runMoaFloorDetailed(request(), harness().guard, { query });
  assert.equal(run.response.status, 'model_witnessed');
  assert.equal(run.response.proved_lower_bound, null);
  assert.equal(run.response.floor, 9, 'the contradicting witness is not adopted either');
  assert.equal(run.response.reason, PUBLIC_REASONS.independentBuildValidationFailed);
});

test('an unqualified emptiness at a trial stops without raising lo', async () => {
  const query: FloorQuery = async cap => (cap === null ? witnessAt(9) : { kind: 'empty', qualified: false });
  const run = await runMoaFloorDetailed(request(), harness().guard, { query });
  assert.equal(run.ended, 'unqualified_empty');
  assert.equal(run.response.status, 'model_witnessed');
  assert.equal(run.response.proved_lower_bound, null);
  assert.equal(run.response.reason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  assert.equal(run.trace[1].result, 'unqualified_empty');
});

// ---------------------------------------------------------------------------------------------
// Native completion versus solution limit
// ---------------------------------------------------------------------------------------------

test('a native solution-limit witness and a native optimal witness both lower hi; neither a solution limit nor a missing witness raises lo', async () => {
  const stops: FloorNativeStop[] = ['solution_limit', 'optimal', 'other', 'solution_limit'];
  const caps: (number | null)[] = [];
  let k = 0;
  const base = domainQuery(points, caps);
  const query: FloorQuery = async (cap, g) => {
    const result = await base(cap, g);
    if (result.kind !== 'witness') return result;
    const stop = stops[k++ % stops.length];
    return { kind: 'witness', witness: { ...result.witness, nativeStop: stop } };
  };
  const run = await runMoaFloorDetailed(request(), harness().guard, { query });
  assert.equal(run.response.status, 'model_proved');
  assert.equal(run.response.floor, 1.25);
  const witnessStops = run.trace.filter(e => e.result === 'witness').map(e => e.nativeStop);
  assert.deepEqual(witnessStops, ['solution_limit', 'optimal', 'other'], 'the seed and the two trial witnesses');

  // A solution limit WITHOUT a witness (a rejected candidate) stops the search and proves nothing.
  const noWitness: FloorQuery = async cap => (cap === null ? witnessAt(9) : { kind: 'stopped', reason: PUBLIC_REASONS.nativeSolutionLimitReached });
  const stopped = await runMoaFloorDetailed(request(), harness().guard, { query: noWitness });
  assert.equal(stopped.response.status, 'model_witnessed');
  assert.equal(stopped.response.proved_lower_bound, null);
  assert.equal(stopped.response.reason, PUBLIC_REASONS.nativeSolutionLimitReached, 'a solution limit is not reported as a timeout');
  // A time-limit stop after a lo was proved keeps that lo and does not raise it.
  let t = 0;
  const timed: FloorQuery = async cap => {
    if (cap === null) return witnessAt(9);
    return ++t === 1 ? witnessAt(3) : t === 2 ? EMPTY : { kind: 'stopped', reason: PUBLIC_REASONS.timeLimitReached };
  };
  const afterLo = await runMoaFloorDetailed(request(), harness().guard, { query: timed });
  assert.equal(afterLo.response.proved_lower_bound, -6, 'the lo proved by the qualified emptiness, unchanged by the later time limit');
  assert.equal(afterLo.response.reason, PUBLIC_REASONS.timeLimitReached);
});

test('a stop reason is reconciled with the guard: validation and prerequisite failures outrank a coincident clock, a pure interrupt prefers cancel', async () => {
  const h = harness();
  const query: FloorQuery = async cap => {
    if (cap === null) return witnessAt(9);
    h.state.cancelled = true;
    return { kind: 'stopped', reason: PUBLIC_REASONS.timeLimitReached };
  };
  const cancelFirst = await runMoaFloor(request(), h.guard, { query });
  assert.equal(cancelFirst.reason, PUBLIC_REASONS.cancelledByUser);
  const g = harness();
  const invalid: FloorQuery = async cap => {
    if (cap === null) return witnessAt(9);
    g.state.cancelled = true;
    return { kind: 'stopped', reason: PUBLIC_REASONS.independentBuildValidationFailed };
  };
  assert.equal((await runMoaFloor(request(), g.guard, { query: invalid })).reason, PUBLIC_REASONS.independentBuildValidationFailed);
});

// ---------------------------------------------------------------------------------------------
// Guard: cancel and deadline between trials, late cancel
// ---------------------------------------------------------------------------------------------

test('a macrotask yield separates trials, and a cancel dispatched across it stops the search keeping the witness and the proved lo', async () => {
  const h = harness();
  // Cancel lands across the yield before the 4th trial: the seed and 3 trials (witness, empty, empty) have completed.
  h.state.onYield = n => { if (n === 4) h.state.cancelled = true; };
  const caps: (number | null)[] = [];
  const run = await runMoaFloorDetailed(request(), h.guard, { query: domainQuery(points, caps) });
  assert.equal(run.trials, 3);
  assert.equal(run.response.status, 'model_witnessed');
  assert.equal(run.response.floor, 3);
  assert.equal(run.response.proved_lower_bound, -1.5, 'the lo proved so far is retained');
  assert.equal(run.response.reason, PUBLIC_REASONS.cancelledByUser);
  assert.equal(run.ended, 'cancelled');
  assert.equal(h.state.yields, 4, 'one yield before each trial, the last one before the stop');
});

test('the deadline between trials stops the search with the time-limit reason, state retained', async () => {
  const h = harness(100);
  const caps: (number | null)[] = [];
  const base = domainQuery(points, caps);
  const query: FloorQuery = async (cap, g) => {
    h.state.time += 40; // every query costs 40 ms: the seed (40), trial 1 (80), trial 2 (120 >= 100)
    return base(cap, g);
  };
  const run = await runMoaFloorDetailed(request(), h.guard, { query });
  assert.equal(run.ended, 'deadline');
  assert.equal(run.trials, 2);
  assert.equal(run.response.status, 'model_witnessed');
  assert.equal(run.response.floor, 3);
  assert.equal(run.response.proved_lower_bound, -6);
  assert.equal(run.response.reason, PUBLIC_REASONS.timeLimitReached);
});

test('a completed bracket proof survives a cancel and a passed deadline that arrive with the last trial', async () => {
  const h = harness(100);
  const caps: (number | null)[] = [];
  const base = domainQuery(points, caps);
  const query: FloorQuery = async (cap, g) => {
    const result = await base(cap, g);
    if (caps.length === 11) { h.state.cancelled = true; h.state.time = 1000; } // the 10th trial completes the bracket
    return result;
  };
  const run = await runMoaFloorDetailed(request(), h.guard, { query });
  assert.equal(run.trials, 10);
  assert.equal(run.ended, 'proved');
  assert.equal(run.response.status, 'model_proved', 'a late cancel never downgrades a completed proof');
  assert.equal(run.response.floor, 1.25);
  assert.equal(run.response.reason, undefined);
  // The same cancel one trial earlier leaves an unproved bracket.
  const h2 = harness(100);
  const caps2: (number | null)[] = [];
  const base2 = domainQuery(points, caps2);
  const early = await runMoaFloorDetailed(request(), h2.guard, {
    query: async (cap, g) => { const result = await base2(cap, g); if (caps2.length === 10) h2.state.cancelled = true; return result; },
  });
  assert.equal(early.response.status, 'model_witnessed');
  assert.equal(early.trials, 9);
});

// ---------------------------------------------------------------------------------------------
// display_floor
// ---------------------------------------------------------------------------------------------

test('display_floor is the smallest 2-decimal value at least hi, and null where it cannot be established', () => {
  assert.equal(displayFloorOf(1.25), 1.25);
  assert.equal(displayFloorOf(0.48342), 0.49);
  assert.equal(displayFloorOf(0.043000000000000003), 0.05, 'the naive ceil of hi x 100 is 4.3, which reads back as 0.043: the search is by the parsed value');
  assert.equal(displayFloorOf(0), 0);
  assert.equal(displayFloorOf(-0.014), -0.01);
  assert.equal(displayFloorOf(-1.5), -1.5);
  for (const hi of [0.1, 0.07, 1.005, 2.675, 0.48342, 33.333333333333336, -0.001, 17.19]) {
    const shown = displayFloorOf(hi) as number;
    assert.ok(shown >= hi, `${hi} -> ${shown}`);
    assert.ok(shown - hi < 0.0100001);
    assert.ok((outwardGridCeil(hi, shown, 0.01) as number) >= hi, 'a cap submitted on the offset grid anchored at the display floor is never below hi');
  }
  for (const bad of [NaN, Infinity, -Infinity, 1e15, -1e15, Number.MAX_VALUE]) assert.equal(displayFloorOf(bad), null, String(bad));
});

test('display_floor is null for a huge witness while the raw floor and the witness stay', async () => {
  const query: FloorQuery = async cap => (cap === null ? witnessAt(1e15) : { kind: 'stopped', reason: PUBLIC_REASONS.timeLimitReached });
  const r = await runMoaFloor(request(), harness().guard, { query });
  assert.equal(r.status, 'model_witnessed');
  assert.equal(r.floor, 1e15);
  assert.equal(r.display_floor, null);
  assert.equal(r.witness?.achieved_moa, 1e15);
});

test('a proved floor carries floor = achieved raw hi, display_floor at least hi, proved_lower_bound = lo and the witness of hi', async () => {
  const { run } = await runDomain(points);
  const r = run.response;
  assert.equal(r.status, 'model_proved');
  assert.equal(r.floor, 1.25);
  assert.equal(r.display_floor, 1.25);
  assert.equal(r.proved_lower_bound, 1.234375);
  assert.equal(r.witness?.achieved_moa, 1.25);
  assert.equal(r.moa_qualification, 'provisional_model');
  assert.equal(r.reason, undefined);
});
