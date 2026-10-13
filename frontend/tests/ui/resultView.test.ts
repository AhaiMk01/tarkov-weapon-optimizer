// How a result is shown (src/components/common/resultView.ts, failureView.ts; ADR 0013 sections 5 and 6, Phase 2.8 / 2.8b): the status / certificate /
// qualification -> authority mapping (an approximate or feasible result is never shown as proved), the reason -> i18n key mapping over the CLOSED set,
// retry advice only from a factual limit reason, nullable bounds, the PLAIN DEFAULT HEADLINE (a badge for a normal result, one sentence for a result
// that is off; "Best build" only for a proved optimum), the Details view that keeps the full information, toasts and the classification of a rejected
// request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OptimizationMetadata, OptimizeResponse } from '../../src/api/client';
import { PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import { CancellationError, SolverError } from '../../src/solver/runtimeErrors';
import { classifyFailure } from '../../src/components/common/failureView';
import {
  BADGE_KEY, NOTICE_IDS, adviceKey, allReasonKeys, authorityOf, authorityOfStep, boundsViewOf, headlineOf, levelOf, metaOf, noticeKey, noticeOf, qualifierKey, qualifiersOf,
  reasonKey, reasonViewOf, resultViewOf, toastOf,
} from '../../src/components/common/resultView';
import type { AuthorityInput, NoticeId } from '../../src/components/common/resultView';

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
  assert.deepEqual(toastOf(cancelled, 'optimize'), { type: 'info', key: 'notice.cancelled_build' });
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

test('the toast says what the headline says: "complete" only of a proved optimum, a plain sentence for a result that is off, never an essay', () => {
  const view = (over: Partial<AuthorityInput>, reason?: string) => resultViewOf({
    ...input(over), optimization: { lower_bound: null, upper_bound: null, absolute_gap: null, tolerance: 1e-5, nodes: 0, termination: 'limit' }, ...(reason === undefined ? {} : { reason }),
  });
  assert.deepEqual(toastOf(view({}), 'optimize'), { type: 'success', key: 'toast.optimize_success' });
  assert.deepEqual(toastOf(view({}), 'gunsmith'), { type: 'success', key: 'toast.gunsmith_success' });
  const fast = view({ physical_certificate: 'approximate_optimal', model_qualification: 'approximate', precision_resolved: 'fast' });
  assert.deepEqual(toastOf(fast, 'optimize'), { type: 'info', key: 'results.build_found' }, 'a Fast optimum is "Build found", never "complete"');
  assert.deepEqual(toastOf(view({ status: 'feasible', physical_certificate: 'feasible' }, PUBLIC_REASONS.timeLimitReached), 'optimize'), { type: 'warning', key: 'notice.feasible_time' });
  assert.deepEqual(toastOf(view({ status: 'incomplete', physical_certificate: 'none' }, PUBLIC_REASONS.approximateModelInfeasible), 'optimize'), { type: 'warning', key: 'notice.fast_empty' });
  assert.deepEqual(toastOf(view({ status: 'infeasible', physical_certificate: 'certified_infeasible' }), 'optimize'), { type: 'error', key: 'notice.infeasible' });
  assert.deepEqual(toastOf(view({ status: 'infeasible', physical_certificate: 'certified_infeasible' }), 'gunsmith'), { type: 'error', key: 'notice.infeasible' });
  assert.deepEqual(toastOf(view({ status: 'error', physical_certificate: 'none' }), 'optimize'), { type: 'error', key: 'notice.error' });
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

// ---------------------------------------------------------------------------------------------
// The plain default headline (owner decision 2026-10-05: plain by default, details on demand)
// ---------------------------------------------------------------------------------------------

const REASONS = Object.values(PUBLIC_REASONS) as string[];
/** Every reason a response can carry: none, each of the closed set, and a diagnostic outside it (an Explore E row). */
const REASON_CASES: (string | undefined)[] = [undefined, ...REASONS, 'HiGHS native call failed during solve: out of memory'];
const LIMIT_META: OptimizationMetadata = { lower_bound: null, upper_bound: null, absolute_gap: null, tolerance: 1e-5, nodes: 0, termination: 'limit' };
const viewOf = (over: Partial<AuthorityInput>, reason?: string) =>
  resultViewOf({ ...input(over), optimization: LIMIT_META, ...(reason === undefined ? {} : { reason }) });

test('a normal result has a badge and no sentence: "Best build" for a proved optimum, "Build found" for every other optimum', () => {
  const proved = viewOf({});
  assert.deepEqual(proved.headline, { kind: 'badge', id: 'best', key: 'results.best_build', tone: 'success', retry: false });
  for (const over of [
    { physical_certificate: 'approximate_optimal' as Cert, model_qualification: 'approximate' as const, precision_resolved: 'fast' as const }, // Fast
    { physical_certificate: 'approximate_optimal' as Cert, model_qualification: 'approximate' as const, precision_resolved: 'fast' as const, moa_qualification: 'provisional_model' as const }, // Fast + MOA
    { physical_certificate: 'approximate_optimal' as Cert, moa_qualification: 'provisional_model' as const }, // Precise but MOA-dependent
    { physical_certificate: 'none' as Cert }, // an inconsistent record is downgraded, never promoted
  ]) {
    const found = viewOf(over);
    assert.deepEqual(found.headline, { kind: 'badge', id: 'found', key: 'results.build_found', tone: 'info', retry: false }, JSON.stringify(over));
  }
  assert.deepEqual(BADGE_KEY, { best: 'results.best_build', found: 'results.build_found' });
});

test('every status / certificate / qualification / mode / reason maps to exactly one default message; "Best build" only for a proved optimum', () => {
  let count = 0;
  let best = 0;
  for (const status of STATUSES) for (const physical_certificate of CERTS) for (const model_qualification of MODELS) for (const moa_qualification of MOAS) for (const precision_resolved of PRECISIONS) {
    for (const reason of REASON_CASES) {
      count++;
      const r: AuthorityInput = { status, physical_certificate, model_qualification, moa_qualification, precision_resolved };
      const view = viewOf(r, reason);
      const label = `${JSON.stringify(r)} ${reason}`;
      const { headline, authority } = view;
      const cancelled = reason === PUBLIC_REASONS.cancelledByUser;
      // Exactly one tier: a badge (normal result) or a sentence (off), never both and never neither; one i18n key each, from the closed sets.
      assert.ok(headline.kind === 'badge' || headline.kind === 'notice', label);
      if (headline.kind === 'badge') {
        assert.ok(headline.id === 'best' || headline.id === 'found', label);
        assert.equal(headline.key, BADGE_KEY[headline.id], label);
        assert.equal(headline.retry, false, label);
        // A badge is for an optimum only, and never for a cancel.
        assert.equal(status, 'optimal', label);
        assert.equal(cancelled, false, label);
        assert.equal(headline.id === 'best', authority.level === 'certified_optimal', label);
      } else {
        assert.ok((NOTICE_IDS as readonly string[]).includes(headline.id), label);
        assert.equal(headline.key, noticeKey(headline.id as NoticeId), label);
      }
      assert.equal(view.tone, headline.tone, label);
      // "Best" is said only of a proved optimum: every proof field says so, and the request was not cancelled.
      const provedOptimum = status === 'optimal' && physical_certificate === 'certified_optimal' && model_qualification !== 'approximate' && precision_resolved !== 'fast' && moa_qualification === null;
      assert.equal(headline.id === 'best', provedOptimum && !cancelled, label);
      if (headline.id === 'best') best++;
      // Nothing that is not an optimum has a badge; nothing that is an optimum and not cancelled has a sentence.
      assert.equal(headline.kind === 'badge', status === 'optimal' && !cancelled, label);
      // A cancel always says it was cancelled, and a retained build is not described as anything more than what was found.
      if (cancelled) assert.equal(headline.id, authority.hasBuild ? 'cancelled_build' : 'cancelled_none', label);
      // "No build meets these constraints" needs a certified emptiness.
      assert.equal(headline.id === 'infeasible', authority.level === 'certified_infeasible' && !cancelled, label);
      // Retry advice is attached to a sentence only.
      if (headline.retry) assert.equal(headline.kind, 'notice', label);
    }
  }
  assert.equal(count, STATUSES.length * CERTS.length * MODELS.length * MOAS.length * PRECISIONS.length * REASON_CASES.length);
  assert.ok(best > 0, 'some record is a proved optimum');
});

test('the sentence of a result that is off, by level and reason (a table; retry only where running it again can help)', () => {
  const T = PUBLIC_REASONS;
  const feasible = { status: 'feasible' as Status, physical_certificate: 'feasible' as Cert };
  const incomplete = { status: 'incomplete' as Status, physical_certificate: 'none' as Cert };
  const rows: [Partial<AuthorityInput>, string | undefined, NoticeId, boolean][] = [
    // feasible: a verified build without a proof
    [feasible, T.timeLimitReached, 'feasible_time', true],
    [feasible, T.nodeLimitReached, 'feasible_limit', true],
    [feasible, T.nativeSolutionLimitReached, 'feasible_limit', true],
    [feasible, undefined, 'feasible_other', false],
    [feasible, T.requiredProofPrerequisiteUnavailable, 'feasible_other', false],
    [feasible, T.independentBuildValidationFailed, 'feasible_other', false],
    [feasible, 'some diagnostic outside the closed set', 'feasible_other', false],
    [feasible, T.cancelledByUser, 'cancelled_build', false],
    // incomplete: no verified build, and no proof that none exists
    [incomplete, T.timeLimitReached, 'none_time', true],
    [incomplete, T.nodeLimitReached, 'none_limit', true],
    [incomplete, T.nativeSolutionLimitReached, 'none_limit', true],
    [incomplete, undefined, 'none_other', false],
    [incomplete, T.requiredProofPrerequisiteUnavailable, 'none_other', false],
    [incomplete, T.independentBuildValidationFailed, 'none_other', false],
    [incomplete, 'some diagnostic outside the closed set', 'none_other', false],
    [incomplete, T.approximateModelInfeasible, 'fast_empty', false],
    [incomplete, T.fastProvisionalMoaModelInfeasible, 'fast_empty', false],
    [incomplete, T.provisionalMoaModelInfeasible, 'moa_empty', false],
    [incomplete, T.invalidOwnedItems, 'invalid_owned', false],
    [incomplete, T.invalidExploreSchedule, 'invalid_schedule', false],
    [incomplete, T.queueTimeoutBeforeDispatch, 'queue_timeout', true],
    [incomplete, T.cancelledByUser, 'cancelled_none', false],
    // an emptiness without its certificate claims nothing: it is "no build", never "none exists"
    [{ status: 'infeasible', physical_certificate: 'none' }, T.approximateModelInfeasible, 'fast_empty', false],
    [{ status: 'infeasible', physical_certificate: 'none' }, undefined, 'none_other', false],
    // proved emptiness, and errors
    [{ status: 'infeasible', physical_certificate: 'certified_infeasible' }, undefined, 'infeasible', false],
    [{ status: 'infeasible', physical_certificate: 'certified_infeasible' }, T.cancelledByUser, 'cancelled_none', false],
    [{ status: 'error', physical_certificate: 'none' }, undefined, 'error', true],
    [{ status: 'error', physical_certificate: 'none' }, 'diagnostic text', 'error', true],
  ];
  for (const [over, reason, id, retry] of rows) {
    const h = viewOf(over, reason).headline;
    assert.deepEqual([h.kind, h.id, h.retry], ['notice', id, retry], `${JSON.stringify(over)} ${reason}`);
  }
  // `noticeOf` is the sentence alone: null for a normal result, and the same sentence `headlineOf` gives.
  assert.equal(noticeOf(authorityOf(input()), null), null);
  assert.equal(noticeOf(authorityOf(input({ physical_certificate: 'approximate_optimal' })), null), null);
  assert.equal(noticeOf({ level: 'feasible', hasBuild: true }, reasonViewOf(T.timeLimitReached))?.id, 'feasible_time');
  assert.equal(headlineOf(authorityOf(input()), null).id, 'best');
  // Every sentence is reachable: each notice id appears in the table above.
  const reached = new Set(rows.map(r => r[2]));
  assert.deepEqual([...NOTICE_IDS].filter(id => !reached.has(id)), []);
});

test('a cancel wins over everything: it is informational, says what the user did, and never calls the build anything more than what was found', () => {
  const cancelled = (over: Partial<AuthorityInput>) => viewOf(over, PUBLIC_REASONS.cancelledByUser);
  const withBuild = cancelled({ status: 'feasible', physical_certificate: 'feasible' });
  assert.deepEqual([withBuild.headline.id, withBuild.headline.tone, withBuild.headline.retry, withBuild.cancelled], ['cancelled_build', 'info', false, true]);
  const none = cancelled({ status: 'incomplete', physical_certificate: 'none' });
  assert.deepEqual([none.headline.id, none.headline.tone], ['cancelled_none', 'info']);
  // Even an inconsistent record that claims a proved optimum together with a cancel is not shown as "Best build".
  assert.equal(cancelled({}).headline.id, 'cancelled_build');
});

test('the quiet facts: whole milliseconds, and the mode the request ran in (auto resolves per request)', () => {
  assert.deepEqual(metaOf({ solve_time_ms: 366.7, precision_request: 'auto', precision_resolved: 'fast' }), { ms: 367, request: 'auto', mode: 'fast' });
  assert.deepEqual(metaOf({ solve_time_ms: 12, precision_request: 'precise', precision_resolved: 'precise' }), { ms: 12, request: 'precise', mode: 'precise' });
  assert.deepEqual(metaOf({ solve_time_ms: 0, precision_request: 'fast', precision_resolved: null }), { ms: null, request: 'fast', mode: null }, 'a zero time is not shown');
  assert.deepEqual(metaOf({ solve_time_ms: Number.NaN }), { ms: null, request: null, mode: null });
  assert.deepEqual(metaOf({}), { ms: null, request: null, mode: null });
  assert.deepEqual(viewOf({}).meta, { ms: null, request: null, mode: 'precise' });
});

test('Details keeps the full information the default view leaves out: authority wording, model notes, reason with advice, bounds ("unknown", never 0)', () => {
  const r: AuthorityInput & { reason: string; optimization: OptimizationMetadata } = {
    ...input({ status: 'feasible', physical_certificate: 'feasible', model_qualification: 'approximate', precision_resolved: 'fast', moa_qualification: 'provisional_model' }),
    reason: PUBLIC_REASONS.timeLimitReached,
    optimization: { lower_bound: 12.3456789, upper_bound: null, absolute_gap: null, tolerance: 1e-5, nodes: 4, termination: 'limit' },
  };
  const view = resultViewOf(r);
  // The default message is one plain sentence ...
  assert.deepEqual([view.headline.kind, view.headline.id, view.headline.key], ['notice', 'feasible_time', 'notice.feasible_time']);
  // ... and the rest is all still there for the Details panel.
  assert.equal(view.authority.titleKey, 'results.authority_feasible');
  assert.deepEqual(view.authority.qualifiers, ['fast_model', 'provisional_moa']);
  assert.equal(view.reason?.key, 'reasons.timeLimitReached');
  assert.equal(view.reason?.adviceKey, 'reasons.advice_timeLimitReached');
  assert.equal(view.reason?.text, PUBLIC_REASONS.timeLimitReached);
  assert.deepEqual([view.bounds.lower, view.bounds.upper, view.bounds.gap, view.bounds.anyKnown], ['12.346', null, null, true]);
  // A proved optimum has its authority wording in Details too, even though its default view is just the badge.
  const proved = viewOf({});
  assert.equal(proved.authority.titleKey, 'results.authority_certified_optimal');
  assert.equal(proved.authority.proved, true);
});
