// The Optimize outcome classifier (src/solver/physical/outcome.ts, ADR 0013 section 6): one test per table row, one per precedence rule, and an
// exhaustive sweep of every combination of facts that checks the invariants no row may break. The classifier is pure: no native build is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyOptimize, invalidOwnedItemsOutcome, isMoaDependent, observationsOfReason, stopReason,
} from '../../src/solver/physical/outcome';
import type { OptimizeFacts, OptimizeOutcome, ResolvedMode, SearchEnd, StopObservations } from '../../src/solver/physical/outcome';
import { INTERVAL_RESOLUTION_REASON, PUBLIC_REASON_SET, PUBLIC_REASONS, reasonOfNativeLimit } from '../../src/solver/physical/reasons';

const facts = (partial: Partial<OptimizeFacts> & Pick<OptimizeFacts, 'end'>): OptimizeFacts => ({
  mode: 'precise', moaDependent: false, witness: partial.end === 'optimum', searchFinished: partial.end !== 'unproved', ...partial,
});

const R = PUBLIC_REASONS;

// ---------------------------------------------------------------------------------------------------------------------------
// The table: one row each
// ---------------------------------------------------------------------------------------------------------------------------

test('row 1: a qualified Precise MOA-independent optimum is optimal / certified_optimal, exact, MOA null, terminated optimal, no reason', () => {
  assert.deepEqual(classifyOptimize(facts({ end: 'optimum' })), {
    status: 'optimal', physical_certificate: 'certified_optimal', precision_resolved: 'precise', model_qualification: 'exact', moa_qualification: null, termination: 'optimal',
  });
});

test('row 2: a Fast optimum is optimal / approximate_optimal, approximate, MOA null, terminated optimal', () => {
  assert.deepEqual(classifyOptimize(facts({ end: 'optimum', mode: 'fast' })), {
    status: 'optimal', physical_certificate: 'approximate_optimal', precision_resolved: 'fast', model_qualification: 'approximate', moa_qualification: null, termination: 'optimal',
  });
});

test('row 2 (MOA): a Fast optimum under a MOA cap keeps the provisional-model qualification', () => {
  assert.deepEqual(classifyOptimize(facts({ end: 'optimum', mode: 'fast', moaDependent: true })), {
    status: 'optimal', physical_certificate: 'approximate_optimal', precision_resolved: 'fast', model_qualification: 'approximate', moa_qualification: 'provisional_model', termination: 'optimal',
  });
});

test('row 3: a qualified Precise MOA-dependent optimum is optimal / approximate_optimal, exact plus provisional_model, terminated optimal', () => {
  assert.deepEqual(classifyOptimize(facts({ end: 'optimum', moaDependent: true })), {
    status: 'optimal', physical_certificate: 'approximate_optimal', precision_resolved: 'precise', model_qualification: 'exact', moa_qualification: 'provisional_model', termination: 'optimal',
  });
});

test('row 4: proved Precise MOA-independent emptiness is infeasible / certified_infeasible, exact, MOA null, terminated optimal, no reason', () => {
  assert.deepEqual(classifyOptimize(facts({ end: 'empty' })), {
    status: 'infeasible', physical_certificate: 'certified_infeasible', precision_resolved: 'precise', model_qualification: 'exact', moa_qualification: null, termination: 'optimal',
  });
});

test('row 5: proved Precise provisional-model emptiness is incomplete / none with the provisional reason, and the internal proof still terminates optimal', () => {
  assert.deepEqual(classifyOptimize(facts({ end: 'empty', moaDependent: true })), {
    status: 'incomplete', physical_certificate: 'none', precision_resolved: 'precise', model_qualification: 'exact', moa_qualification: 'provisional_model', termination: 'optimal',
    reason: 'Provisional MOA model infeasible',
  });
});

test('row 6: Fast MOA-independent model emptiness is incomplete / none, approximate, MOA null, terminated optimal (the executed search completed)', () => {
  assert.deepEqual(classifyOptimize(facts({ end: 'empty', mode: 'fast' })), {
    status: 'incomplete', physical_certificate: 'none', precision_resolved: 'fast', model_qualification: 'approximate', moa_qualification: null, termination: 'optimal',
    reason: 'Approximate model infeasible',
  });
});

test('row 7: Fast provisional-model emptiness is incomplete / none with the Fast provisional reason, terminated optimal', () => {
  assert.deepEqual(classifyOptimize(facts({ end: 'empty', mode: 'fast', moaDependent: true })), {
    status: 'incomplete', physical_certificate: 'none', precision_resolved: 'fast', model_qualification: 'approximate', moa_qualification: 'provisional_model', termination: 'optimal',
    reason: 'Fast provisional MOA model infeasible',
  });
});

test('row 8: no qualified proof with a verified witness is feasible / feasible with the resolved qualifiers; termination follows search completion', () => {
  for (const mode of ['precise', 'fast'] as const) {
    for (const moaDependent of [false, true]) {
      for (const searchFinished of [false, true]) {
        const outcome = classifyOptimize(facts({ end: 'unproved', mode, moaDependent, witness: true, searchFinished, observed: { deadline: true } }));
        assert.deepEqual(outcome, {
          status: 'feasible', physical_certificate: 'feasible', precision_resolved: mode, model_qualification: mode === 'precise' ? 'exact' : 'approximate',
          moa_qualification: moaDependent ? 'provisional_model' : null, termination: searchFinished ? 'optimal' : 'limit', reason: 'Time limit reached',
        });
      }
    }
  }
});

test('row 9: no qualified proof and no verified witness is incomplete / none with the resolved qualifiers; termination follows search completion', () => {
  for (const mode of ['precise', 'fast'] as const) {
    for (const moaDependent of [false, true]) {
      for (const searchFinished of [false, true]) {
        const outcome = classifyOptimize(facts({ end: 'unproved', mode, moaDependent, witness: false, searchFinished, observed: { nodeLimit: true } }));
        assert.deepEqual(outcome, {
          status: 'incomplete', physical_certificate: 'none', precision_resolved: mode, model_qualification: mode === 'precise' ? 'exact' : 'approximate',
          moa_qualification: moaDependent ? 'provisional_model' : null, termination: searchFinished ? 'optimal' : 'limit', reason: 'Node limit reached',
        });
      }
    }
  }
});

test('row 10: an invalid owned_items list is incomplete / none, nothing resolved, the search never started (limit), with its reason', () => {
  assert.deepEqual(invalidOwnedItemsOutcome(false), {
    status: 'incomplete', physical_certificate: 'none', precision_resolved: null, model_qualification: null, moa_qualification: null, termination: 'limit',
    reason: 'Invalid owned_items format',
  });
  // The request still says it carries a MOA cap; the stash check runs no model either way.
  assert.equal(invalidOwnedItemsOutcome(true).moa_qualification, 'provisional_model');
});

test('the MOA cap decides dependence by presence, never truthiness: a cap of 0 or below is a cap, null and undefined are none', () => {
  assert.equal(isMoaDependent({ maxMOA: 0 }), true);
  assert.equal(isMoaDependent({ maxMOA: -1.5 }), true);
  assert.equal(isMoaDependent({ maxMOA: 12 }), true);
  assert.equal(isMoaDependent({ maxMOA: null }), false);
  assert.equal(isMoaDependent({}), false);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Reason precedence
// ---------------------------------------------------------------------------------------------------------------------------

const ALL: Required<StopObservations> = { cancelled: true, deadline: true, nodeLimit: true, nativeSolutionLimit: true, validationFailed: true, proofPrerequisiteUnavailable: true };
const without = (...names: (keyof StopObservations)[]): StopObservations => {
  const copy: StopObservations = { ...ALL };
  for (const n of names) delete copy[n];
  return copy;
};

test('precedence 1: a completed qualified proof wins and is never downgraded by any observed flag, with or without a witness', () => {
  assert.equal(classifyOptimize(facts({ end: 'optimum', observed: ALL })).reason, undefined);
  assert.equal(classifyOptimize(facts({ end: 'optimum', observed: ALL })).status, 'optimal');
  assert.equal(classifyOptimize(facts({ end: 'optimum', mode: 'fast', observed: ALL })).physical_certificate, 'approximate_optimal');
  assert.equal(classifyOptimize(facts({ end: 'empty', observed: ALL })).status, 'infeasible');
  assert.equal(classifyOptimize(facts({ end: 'empty', moaDependent: true, observed: ALL })).reason, R.provisionalMoaModelInfeasible);
  assert.equal(classifyOptimize(facts({ end: 'empty', mode: 'fast', observed: ALL })).reason, R.approximateModelInfeasible);
});

test('precedence 2: an observed validation failure outranks every coincident interrupt and the other proof failure', () => {
  assert.equal(stopReason(ALL), R.independentBuildValidationFailed);
  assert.equal(stopReason(without('proofPrerequisiteUnavailable')), R.independentBuildValidationFailed);
  for (const interrupt of ['cancelled', 'deadline', 'nodeLimit', 'nativeSolutionLimit'] as const) {
    assert.equal(stopReason({ validationFailed: true, [interrupt]: true }), R.independentBuildValidationFailed, interrupt);
  }
  // Through the classifier, with a retained witness: the witness still decides the status, the failure decides the reason.
  const outcome = classifyOptimize(facts({ end: 'unproved', witness: true, searchFinished: false, observed: { validationFailed: true, cancelled: true, deadline: true } }));
  assert.equal(outcome.status, 'feasible');
  assert.equal(outcome.physical_certificate, 'feasible');
  assert.equal(outcome.reason, R.independentBuildValidationFailed);
  assert.equal(outcome.termination, 'limit');
});

test('precedence 3: an observed proof-prerequisite failure outranks every coincident interrupt', () => {
  assert.equal(stopReason(without('validationFailed')), R.requiredProofPrerequisiteUnavailable);
  for (const interrupt of ['cancelled', 'deadline', 'nodeLimit', 'nativeSolutionLimit'] as const) {
    assert.equal(stopReason({ proofPrerequisiteUnavailable: true, [interrupt]: true }), R.requiredProofPrerequisiteUnavailable, interrupt);
  }
  const outcome = classifyOptimize(facts({ end: 'unproved', witness: false, searchFinished: false, observed: { proofPrerequisiteUnavailable: true, deadline: true } }));
  assert.equal(outcome.status, 'incomplete');
  assert.equal(outcome.reason, R.requiredProofPrerequisiteUnavailable);
});

test('precedence 4: pure simultaneous interrupts report cancel, then the deadline, then the node limit, then the native solution limit', () => {
  const interrupts: [keyof StopObservations, string][] = [
    ['cancelled', R.cancelledByUser], ['deadline', R.timeLimitReached], ['nodeLimit', R.nodeLimitReached], ['nativeSolutionLimit', R.nativeSolutionLimitReached],
  ];
  for (let i = 0; i < interrupts.length; i++) {
    // every interrupt from i down is observed: the first of them wins
    const observed: StopObservations = {};
    for (let j = i; j < interrupts.length; j++) observed[interrupts[j][0]] = true;
    assert.equal(stopReason(observed), interrupts[i][1], `from ${interrupts[i][0]}`);
  }
  assert.equal(stopReason({ cancelled: true, nativeSolutionLimit: true }), R.cancelledByUser);
  assert.equal(stopReason({ deadline: true, nodeLimit: true }), R.timeLimitReached);
  assert.equal(stopReason({ nodeLimit: true, nativeSolutionLimit: true }), R.nodeLimitReached);
  assert.equal(stopReason({ nativeSolutionLimit: true }), R.nativeSolutionLimitReached, 'a native solution limit is no timeout');
});

test('precedence 5: a stop with no observed cause is a proof prerequisite that is not available', () => {
  assert.equal(stopReason({}), R.requiredProofPrerequisiteUnavailable);
  assert.equal(stopReason(undefined), R.requiredProofPrerequisiteUnavailable);
  assert.equal(classifyOptimize(facts({ end: 'unproved', witness: true, searchFinished: true })).reason, R.requiredProofPrerequisiteUnavailable);
});

test('a finished search whose proof was then withheld terminates optimal and is no proof: feasible with the prerequisite reason', () => {
  const outcome = classifyOptimize(facts({ end: 'unproved', witness: true, searchFinished: true, observed: { proofPrerequisiteUnavailable: true } }));
  assert.equal(outcome.termination, 'optimal');
  assert.equal(outcome.status, 'feasible');
  assert.equal(outcome.physical_certificate, 'feasible');
});

test('an unfinished spatial search is limit even when a witness exists and a bound was proved elsewhere', () => {
  const outcome = classifyOptimize(facts({ end: 'unproved', witness: true, searchFinished: false, observed: { nodeLimit: true } }));
  assert.equal(outcome.termination, 'limit');
  assert.equal(outcome.reason, R.nodeLimitReached);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Reasons of stops
// ---------------------------------------------------------------------------------------------------------------------------

test('every internal stop reason maps to its own observation; the internal interval-resolution diagnostic is a proof prerequisite and never public', () => {
  assert.deepEqual(observationsOfReason(R.cancelledByUser), { cancelled: true });
  assert.deepEqual(observationsOfReason(R.timeLimitReached), { deadline: true });
  assert.deepEqual(observationsOfReason(R.nodeLimitReached), { nodeLimit: true });
  assert.deepEqual(observationsOfReason(R.nativeSolutionLimitReached), { nativeSolutionLimit: true });
  assert.deepEqual(observationsOfReason(R.independentBuildValidationFailed), { validationFailed: true });
  assert.deepEqual(observationsOfReason(R.requiredProofPrerequisiteUnavailable), { proofPrerequisiteUnavailable: true });
  assert.deepEqual(observationsOfReason(INTERVAL_RESOLUTION_REASON), { proofPrerequisiteUnavailable: true });
  assert.deepEqual(observationsOfReason(null), {});
  assert.deepEqual(observationsOfReason(undefined), {});
  // text outside the closed set can only mean the proof is not available
  assert.deepEqual(observationsOfReason('Iteration limit reached'), { proofPrerequisiteUnavailable: true });
  assert.equal(PUBLIC_REASON_SET.has(INTERVAL_RESOLUTION_REASON), false, 'the interval-resolution diagnostic is outside the closed set');
  const interval = classifyOptimize(facts({ end: 'unproved', witness: true, searchFinished: false, observed: observationsOfReason(INTERVAL_RESOLUTION_REASON) }));
  assert.equal(interval.reason, R.requiredProofPrerequisiteUnavailable);
  assert.equal(interval.termination, 'limit');
  assert.equal(interval.status, 'feasible');
});

test('native limit statuses: the time limit and the solution limit are the two pure native interrupts, every other limit is an unavailable proof', () => {
  assert.equal(reasonOfNativeLimit('TimeLimit'), R.timeLimitReached);
  assert.equal(reasonOfNativeLimit('SolutionLimit'), R.nativeSolutionLimitReached);
  for (const other of ['IterationLimit', 'ObjectiveBound', 'ObjectiveTarget', 'Interrupt', 'MemoryLimit', 'HighsInterrupt', 'Unknown', 'Optimal']) {
    assert.equal(reasonOfNativeLimit(other), R.requiredProofPrerequisiteUnavailable, other);
  }
});

// ---------------------------------------------------------------------------------------------------------------------------
// Consistency of the facts, and an exhaustive sweep
// ---------------------------------------------------------------------------------------------------------------------------

test('inconsistent facts are a programming error, not an outcome', () => {
  assert.throws(() => classifyOptimize({ mode: 'precise', moaDependent: false, end: 'optimum', witness: false, searchFinished: true }), /optimum needs a verified witness/);
  assert.throws(() => classifyOptimize({ mode: 'precise', moaDependent: false, end: 'optimum', witness: true, searchFinished: false }), /finished search/);
  assert.throws(() => classifyOptimize({ mode: 'fast', moaDependent: false, end: 'empty', witness: true, searchFinished: true }), /no witness/);
  assert.throws(() => classifyOptimize({ mode: 'fast', moaDependent: false, end: 'empty', witness: false, searchFinished: false }), /finished search/);
});

const FLAGS: (keyof StopObservations)[] = ['cancelled', 'deadline', 'nodeLimit', 'nativeSolutionLimit', 'validationFailed', 'proofPrerequisiteUnavailable'];

function* everyFacts(): Generator<OptimizeFacts> {
  for (const mode of ['precise', 'fast'] as ResolvedMode[]) {
    for (const moaDependent of [false, true]) {
      for (const end of ['optimum', 'empty', 'unproved'] as SearchEnd[]) {
        for (const witness of [false, true]) {
          for (const searchFinished of [false, true]) {
            if (end === 'optimum' && !(witness && searchFinished)) continue;
            if (end === 'empty' && (witness || !searchFinished)) continue;
            for (let mask = 0; mask < 1 << FLAGS.length; mask++) {
              const observed: StopObservations = {};
              FLAGS.forEach((flag, i) => { if (mask & (1 << i)) observed[flag] = true; });
              yield { mode, moaDependent, end, witness, searchFinished, observed };
            }
          }
        }
      }
    }
  }
}

test('every combination of facts: the closed reason set, the status/certificate pairing, the qualifiers and the termination invariants hold', () => {
  let combinations = 0;
  for (const f of everyFacts()) {
    combinations++;
    const o: OptimizeOutcome = classifyOptimize(f);
    const label = JSON.stringify(f);
    // the reason is absent exactly for the two proof rows, and otherwise in the closed set
    if (o.reason !== undefined) assert.ok(PUBLIC_REASON_SET.has(o.reason), `${label}: ${o.reason} is outside the closed set`);
    assert.equal(o.reason === undefined, o.status === 'optimal' || o.status === 'infeasible', label);
    // qualifiers follow the resolved mode and the request, never the outcome
    assert.equal(o.precision_resolved, f.mode, label);
    assert.equal(o.model_qualification, f.mode === 'precise' ? 'exact' : 'approximate', label);
    assert.equal(o.moa_qualification, f.moaDependent ? 'provisional_model' : null, label);
    // physical authority: certified_* only from Precise and MOA-independent; infeasible only from a Precise MOA-independent proof
    if (o.physical_certificate === 'certified_optimal' || o.physical_certificate === 'certified_infeasible') assert.ok(f.mode === 'precise' && !f.moaDependent, label);
    assert.equal(o.status === 'infeasible', o.physical_certificate === 'certified_infeasible', label);
    // status and certificate pairing
    const pairs: Record<string, string[]> = {
      optimal: ['certified_optimal', 'approximate_optimal'], feasible: ['feasible'], incomplete: ['none'], infeasible: ['certified_infeasible'],
    };
    assert.ok(pairs[o.status]?.includes(o.physical_certificate), `${label}: ${o.status} / ${o.physical_certificate}`);
    // a build is reported exactly when there is a witness
    assert.equal(o.status === 'optimal' || o.status === 'feasible', f.witness, label);
    assert.equal(o.status === 'feasible', f.witness && f.end === 'unproved', label);
    // termination is search completion only
    assert.equal(o.termination, f.searchFinished ? 'optimal' : 'limit', label);
    // a completed proof is independent of every observed flag
    if (f.end !== 'unproved') {
      const quiet = classifyOptimize({ ...f, observed: undefined });
      assert.deepEqual(o, quiet, `${label}: observed flags changed a completed proof`);
    }
  }
  assert.equal(combinations, 2 * 2 * 64 * (1 + 1 + 4), 'both modes, both MOA settings, 64 observation sets, and the 1 + 1 + 4 consistent (end, witness, finished) triples');
});
