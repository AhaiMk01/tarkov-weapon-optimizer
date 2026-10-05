// How a result is shown (src/components/common/resultView.ts, failureView.ts; ADR 0013 sections 5 and 6, Phase 2.8): the status / certificate /
// qualification -> authority mapping (an approximate or feasible result is never shown as proved), the reason -> i18n key mapping over the CLOSED set,
// retry advice only from a factual limit reason, nullable bounds, toasts and the classification of a rejected request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OptimizationMetadata, OptimizeResponse } from '../../src/api/client';
import { PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import { CancellationError, SolverError } from '../../src/solver/runtimeErrors';
import { classifyFailure } from '../../src/components/common/failureView';
import {
  adviceKey, allReasonKeys, authorityOf, authorityOfStep, boundsViewOf, levelOf, qualifierKey, qualifiersOf, reasonKey, reasonViewOf, resultViewOf, toastOf,
} from '../../src/components/common/resultView';
import type { AuthorityInput } from '../../src/components/common/resultView';

type Status = OptimizeResponse['status'];
type Cert = OptimizeResponse['physical_certificate'];

const input = (over: Partial<AuthorityInput> = {}): AuthorityInput => ({
  status: 'optimal', physical_certificate: 'certified_optimal', model_qualification: 'exact', moa_qualification: null, precision_resolved: 'precise', ...over,
});

const STATUSES: Status[] = ['optimal', 'feasible', 'incomplete', 'infeasible', 'error'];
const CERTS: Cert[] = ['certified_optimal', 'approximate_optimal', 'feasible', 'certified_infeasible', 'none'];
const MODELS: AuthorityInput['model_qualification'][] = ['exact', 'approximate', null];
const MOAS: AuthorityInput['moa_qualification'][] = ['provisional_model', null];
const PRECISIONS: AuthorityInput['precision_resolved'][] = ['precise', 'fast', null];

// ---------------------------------------------------------------------------------------------
// Authority: the rows of the ADR 0013 section 6 table
// ---------------------------------------------------------------------------------------------

test('a Precise MOA-independent certified optimum is the only result shown as a proved optimum', () => {
  const a = authorityOf(input());
  assert.equal(a.level, 'certified_optimal');
  assert.equal(a.proved, true);
  assert.equal(a.hasBuild, true);
  assert.equal(a.tone, 'success');
  assert.deepEqual(a.qualifiers, []);
  assert.equal(a.titleKey, 'results.authority_certified_optimal');
});

test('a Fast optimum is approximate and says it ran on the Fast model, including Fast TrueErgo / Prevent Overswing (same fields)', () => {
  const a = authorityOf(input({ physical_certificate: 'approximate_optimal', model_qualification: 'approximate', precision_resolved: 'fast' }));
  assert.equal(a.level, 'approximate_optimal');
  assert.equal(a.proved, false);
  assert.equal(a.tone, 'info');
  assert.deepEqual(a.qualifiers, ['fast_model']);
});

test('a Precise MOA-dependent optimum is approximate with the provisional MOA caveat, not the Fast one', () => {
  const a = authorityOf(input({ physical_certificate: 'approximate_optimal', moa_qualification: 'provisional_model' }));
  assert.equal(a.level, 'approximate_optimal');
  assert.equal(a.proved, false);
  assert.deepEqual(a.qualifiers, ['provisional_moa']);
});

test('a Fast MOA-dependent optimum carries both caveats', () => {
  const a = authorityOf(input({ physical_certificate: 'approximate_optimal', model_qualification: 'approximate', precision_resolved: 'fast', moa_qualification: 'provisional_model' }));
  assert.deepEqual(a.qualifiers, ['fast_model', 'provisional_moa']);
  assert.equal(a.proved, false);
});

test('feasible: a verified build with no proof; incomplete: no verified build; both are warnings that never read as proved', () => {
  const feasible = authorityOf(input({ status: 'feasible', physical_certificate: 'feasible' }));
  assert.deepEqual([feasible.level, feasible.proved, feasible.hasBuild, feasible.tone], ['feasible', false, true, 'warning']);
  const incomplete = authorityOf(input({ status: 'incomplete', physical_certificate: 'none' }));
  assert.deepEqual([incomplete.level, incomplete.proved, incomplete.hasBuild, incomplete.tone], ['incomplete', false, false, 'warning']);
});

test('proved emptiness needs status infeasible AND the certificate; Fast and provisional emptiness are incomplete, with their caveats', () => {
  const proved = authorityOf(input({ status: 'infeasible', physical_certificate: 'certified_infeasible' }));
  assert.deepEqual([proved.level, proved.proved, proved.hasBuild, proved.tone], ['certified_infeasible', true, false, 'error']);
  const unproved = authorityOf(input({ status: 'infeasible', physical_certificate: 'none' }));
  assert.equal(unproved.level, 'incomplete', 'an emptiness without its certificate claims nothing');
  assert.equal(unproved.proved, false);
  const fast = authorityOf(input({ status: 'incomplete', physical_certificate: 'none', model_qualification: 'approximate', precision_resolved: 'fast' }));
  assert.deepEqual([fast.level, fast.qualifiers], ['incomplete', ['fast_model']]);
  const moa = authorityOf(input({ status: 'incomplete', physical_certificate: 'none', moa_qualification: 'provisional_model' }));
  assert.deepEqual([moa.level, moa.qualifiers], ['incomplete', ['provisional_moa']]);
});

test('error is an error', () => {
  const a = authorityOf(input({ status: 'error', physical_certificate: 'none', precision_resolved: null, model_qualification: null }));
  assert.deepEqual([a.level, a.tone, a.hasBuild, a.proved], ['error', 'error', false, false]);
});

test('an inconsistent record is never promoted: a status that claims more than its certificate and qualifications support is downgraded', () => {
  for (const over of [
    { physical_certificate: 'none' as Cert },
    { physical_certificate: 'approximate_optimal' as Cert },
    { physical_certificate: 'feasible' as Cert },
    { model_qualification: 'approximate' as const },
    { precision_resolved: 'fast' as const },
    { moa_qualification: 'provisional_model' as const },
  ]) {
    const a = authorityOf(input(over));
    assert.equal(a.level, 'approximate_optimal', JSON.stringify(over));
    assert.equal(a.proved, false, JSON.stringify(over));
  }
});

test('exhaustive over every status, certificate, qualification and resolved mode: "proved" implies every proof field says so, and a build is shown iff the status publishes one', () => {
  let count = 0;
  for (const status of STATUSES) for (const physical_certificate of CERTS) for (const model_qualification of MODELS) for (const moa_qualification of MOAS) for (const precision_resolved of PRECISIONS) {
    count++;
    const r: AuthorityInput = { status, physical_certificate, model_qualification, moa_qualification, precision_resolved };
    const a = authorityOf(r);
    const label = JSON.stringify(r);
    assert.equal(a.hasBuild, status === 'optimal' || status === 'feasible', label);
    if (a.proved) {
      const provedOptimum = status === 'optimal' && physical_certificate === 'certified_optimal' && model_qualification !== 'approximate' && precision_resolved !== 'fast' && moa_qualification === null;
      const provedEmpty = status === 'infeasible' && physical_certificate === 'certified_infeasible';
      assert.ok(provedOptimum || provedEmpty, `proved without proof fields: ${label}`);
    }
    // A Fast or provisional-MOA result always names its model.
    if (model_qualification === 'approximate' || precision_resolved === 'fast') assert.ok(a.qualifiers.includes('fast_model'), label);
    if (moa_qualification === 'provisional_model') assert.ok(a.qualifiers.includes('provisional_moa'), label);
    assert.equal(levelOf(r), a.level, label);
    assert.deepEqual(authorityOfStep(r), a, 'a step row maps the same way');
  }
  assert.equal(count, STATUSES.length * CERTS.length * MODELS.length * MOAS.length * PRECISIONS.length);
});

test('qualifiers: only the model facts, in a stable order', () => {
  assert.deepEqual(qualifiersOf({ model_qualification: null, moa_qualification: null, precision_resolved: null }), []);
  assert.deepEqual(qualifiersOf({ model_qualification: 'exact', moa_qualification: null, precision_resolved: 'precise' }), []);
  assert.equal(qualifierKey('fast_model'), 'results.qualifier_fast_model');
  assert.equal(qualifierKey('provisional_moa'), 'results.qualifier_provisional_moa');
});

// ---------------------------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------------------------

test('every public reason maps to its own i18n key, keyed by the reason constant', () => {
  const names = Object.keys(PUBLIC_REASONS) as (keyof typeof PUBLIC_REASONS)[];
  assert.equal(names.length, 12, 'the closed set has twelve reasons');
  const keys = new Set<string>();
  for (const name of names) {
    const view = reasonViewOf(PUBLIC_REASONS[name]);
    assert.ok(view !== null, name);
    assert.equal(view.name, name);
    assert.equal(view.key, `reasons.${name}`, 'one key per constant');
    assert.equal(view.key, reasonKey(name));
    assert.equal(view.text, PUBLIC_REASONS[name]);
    assert.notEqual(view.kind, 'unknown');
    keys.add(view.key as string);
  }
  assert.equal(keys.size, names.length, 'no two reasons share a key');
  for (const key of keys) assert.ok(allReasonKeys().includes(key));
});

test('retry advice comes only from the three factual limit reasons, never from anything else', () => {
  const withAdvice = Object.entries(PUBLIC_REASONS).filter(([name]) => reasonViewOf(PUBLIC_REASONS[name as keyof typeof PUBLIC_REASONS])?.adviceKey !== null).map(([name]) => name);
  assert.deepEqual(withAdvice.sort(), ['nativeSolutionLimitReached', 'nodeLimitReached', 'timeLimitReached']);
  assert.equal(reasonViewOf(PUBLIC_REASONS.timeLimitReached)?.adviceKey, adviceKey('timeLimitReached'));
  assert.equal(reasonViewOf(PUBLIC_REASONS.timeLimitReached)?.adviceKey, 'reasons.advice_timeLimitReached');
  for (const reason of [PUBLIC_REASONS.requiredProofPrerequisiteUnavailable, PUBLIC_REASONS.queueTimeoutBeforeDispatch, PUBLIC_REASONS.cancelledByUser, PUBLIC_REASONS.approximateModelInfeasible]) {
    assert.equal(reasonViewOf(reason)?.adviceKey, null, reason);
  }
  assert.equal(allReasonKeys().length, 12 + 3, 'twelve messages and three advice lines');
});

test('"limit" termination alone never produces timeout advice: only the factual reason does', () => {
  const limit: OptimizationMetadata = { lower_bound: null, upper_bound: null, absolute_gap: null, tolerance: 1e-5, nodes: 0, termination: 'limit' };
  const base = { ...input({ status: 'incomplete', physical_certificate: 'none' }), optimization: limit };
  const noReason = resultViewOf(base);
  assert.equal(noReason.reason, null, 'no reason, no advice, whatever the termination says');
  const prerequisite = resultViewOf({ ...base, reason: PUBLIC_REASONS.requiredProofPrerequisiteUnavailable });
  assert.equal(prerequisite.reason?.adviceKey, null, 'an unavailable prerequisite is not a timeout');
  const timed = resultViewOf({ ...base, reason: PUBLIC_REASONS.timeLimitReached });
  assert.equal(timed.reason?.adviceKey, 'reasons.advice_timeLimitReached');
  const solution = resultViewOf({ ...base, reason: PUBLIC_REASONS.nativeSolutionLimitReached });
  assert.equal(solution.reason?.adviceKey, 'reasons.advice_nativeSolutionLimitReached', 'a native solution limit has its own advice, not the timeout one');
});

test('Cancelled by user is a cancel, not an error: informational whatever the level, and no failure toast', () => {
  const base = { ...input({ status: 'feasible', physical_certificate: 'feasible' }), optimization: { lower_bound: 1, upper_bound: null, absolute_gap: null, tolerance: 1e-5, nodes: 1, termination: 'limit' } as OptimizationMetadata };
  const cancelled = resultViewOf({ ...base, reason: PUBLIC_REASONS.cancelledByUser });
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.tone, 'info');
  assert.equal(cancelled.reason?.kind, 'cancel');
  assert.equal(cancelled.reason?.adviceKey, null);
  assert.equal(cancelled.authority.level, 'feasible', 'the retained build keeps its own authority');
  assert.deepEqual(toastOf(cancelled, 'optimize'), { type: 'info', key: 'toast.cancelled', reason: null });
  const timed = resultViewOf({ ...base, reason: PUBLIC_REASONS.timeLimitReached });
  assert.equal(timed.cancelled, false);
  assert.equal(timed.tone, 'warning');
});

test('a reason outside the closed set (an Explore E-row diagnostic) is shown as it is, with no key and a neutral kind', () => {
  const view = reasonViewOf('HiGHS native call failed during solve: out of memory');
  assert.deepEqual(view, { text: 'HiGHS native call failed during solve: out of memory', name: null, key: null, kind: 'unknown', adviceKey: null, cancelled: false });
  assert.equal(reasonViewOf(undefined), null);
  assert.equal(reasonViewOf(null), null);
  assert.equal(reasonViewOf(''), null);
  // A near miss is not a public reason: matching is by exact text.
  assert.equal(reasonViewOf('time limit reached')?.key, null);
});

// ---------------------------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------------------------

test('nullable bounds are guarded: an unknown bound is null, a known zero is formatted, and non-finite numbers are unknown', () => {
  const unknown = boundsViewOf({ lower_bound: null, upper_bound: null, absolute_gap: null, tolerance: 1e-5 });
  assert.deepEqual(unknown, { lower: null, upper: null, gap: null, tolerance: '0.0000100', anyKnown: false });
  const partial = boundsViewOf({ lower_bound: 12.3456789, upper_bound: null, absolute_gap: null, tolerance: 1e-5 });
  assert.deepEqual([partial.lower, partial.upper, partial.gap, partial.anyKnown], ['12.346', null, null, true]);
  const zero = boundsViewOf({ lower_bound: 0, upper_bound: 0, absolute_gap: 0, tolerance: 1e-5 });
  assert.deepEqual([zero.lower, zero.upper, zero.gap, zero.anyKnown], ['0.0000', '0.0000', '0.00', true], 'a known zero is not "unknown"');
  const bad = boundsViewOf({ lower_bound: Infinity, upper_bound: NaN, absolute_gap: -Infinity, tolerance: Number.NaN });
  assert.deepEqual([bad.lower, bad.upper, bad.gap, bad.tolerance, bad.anyKnown], [null, null, null, null, false]);
  assert.equal(boundsViewOf(null).anyKnown, false);
  assert.equal(boundsViewOf(undefined).lower, null);
});

// ---------------------------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------------------------

test('one toast per authority level: "complete" is said only of a proved optimum', () => {
  const view = (over: Partial<AuthorityInput>, reason?: string) => resultViewOf({
    ...input(over), optimization: { lower_bound: null, upper_bound: null, absolute_gap: null, tolerance: 1e-5, nodes: 0, termination: 'limit' }, ...(reason === undefined ? {} : { reason }),
  });
  assert.deepEqual(toastOf(view({}), 'optimize'), { type: 'success', key: 'toast.optimize_success', reason: null });
  assert.deepEqual(toastOf(view({}), 'gunsmith'), { type: 'success', key: 'toast.gunsmith_success', reason: null });
  assert.equal(toastOf(view({ physical_certificate: 'approximate_optimal', model_qualification: 'approximate', precision_resolved: 'fast' }), 'optimize').key, 'toast.optimize_approximate');
  assert.equal(toastOf(view({ physical_certificate: 'approximate_optimal', model_qualification: 'approximate', precision_resolved: 'fast' }), 'optimize').type, 'info');
  assert.equal(toastOf(view({ status: 'feasible', physical_certificate: 'feasible' }, PUBLIC_REASONS.timeLimitReached), 'optimize').key, 'toast.optimize_feasible');
  assert.equal(toastOf(view({ status: 'incomplete', physical_certificate: 'none' }, PUBLIC_REASONS.approximateModelInfeasible), 'optimize').key, 'toast.optimize_incomplete');
  assert.equal(toastOf(view({ status: 'infeasible', physical_certificate: 'certified_infeasible' }), 'optimize').key, 'toast.optimize_infeasible');
  assert.equal(toastOf(view({ status: 'infeasible', physical_certificate: 'certified_infeasible' }), 'gunsmith').key, 'toast.gunsmith_infeasible');
  assert.equal(toastOf(view({ status: 'error', physical_certificate: 'none' }), 'optimize').key, 'toast.optimize_failed');
  assert.equal(toastOf(view({ status: 'feasible', physical_certificate: 'feasible' }, PUBLIC_REASONS.timeLimitReached), 'optimize').reason?.name, 'timeLimitReached');
});

// ---------------------------------------------------------------------------------------------
// Rejected requests
// ---------------------------------------------------------------------------------------------

test('a CancellationError is a cancel carrying its retained snapshot; a SolverError is an error carrying what the search had established', () => {
  const snapshot = { launched: 2 };
  const cancelled = classifyFailure(new CancellationError('Cancelled by user', snapshot));
  assert.deepEqual(cancelled, { kind: 'cancelled', reason: 'Cancelled by user', snapshot });
  assert.deepEqual(classifyFailure(new CancellationError()), { kind: 'cancelled', reason: 'Cancelled by user', snapshot: null });

  const solver = new SolverError('solve', new Error('out of memory'), true, {
    nodes: 3, termination: 'limit', witness: true, lower_bound: 5, upper_bound: null, absolute_gap: null,
  });
  const failure = classifyFailure(solver);
  assert.equal(failure.kind, 'solver');
  if (failure.kind !== 'solver') return;
  assert.equal(failure.phase, 'solve');
  assert.equal(failure.corrupted, true);
  assert.match(failure.message, /out of memory/);
  assert.equal(failure.completion?.witness, true);
  assert.deepEqual([failure.bounds?.lower, failure.bounds?.upper, failure.bounds?.gap], ['5.0000', null, null], 'unknown bounds stay unknown');

  const noCompletion = classifyFailure(new SolverError('load', 'boom'));
  assert.equal(noCompletion.kind === 'solver' && noCompletion.bounds, null);

  assert.deepEqual(classifyFailure(new Error('network down')), { kind: 'unknown', message: 'network down' });
  assert.deepEqual(classifyFailure('plain string'), { kind: 'unknown', message: 'plain string' });
});
