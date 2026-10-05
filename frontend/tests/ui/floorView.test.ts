// How the MOA floor is shown and used (src/components/common/floorView.ts; ADR 0013 sections 5 and 6, Phase 2.8): the four statuses (proved, witnessed,
// unresolved, infeasible), always as a PROVISIONAL-model result; the slider minimum driven by display_floor (two decimals, never below the achieved
// floor), never an invented 0; a withheld display value; the retained floor of a failed request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MOAFloorResponse } from '../../src/api/client';
import { floorViewOf, isFloorResponse, moaSliderRange, retainedFloorOf, usableDisplayFloor } from '../../src/components/common/floorView';
import { PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import { CancellationError, SolverError } from '../../src/solver/runtimeErrors';

const floor = (over: Partial<MOAFloorResponse> = {}): MOAFloorResponse => ({
  status: 'model_proved', moa_qualification: 'provisional_model', floor: 1.2345, display_floor: 1.24, proved_lower_bound: 1.23, solve_time_ms: 10, ...over,
});

test('a proved floor shows the display floor, drives the slider minimum, and is a provisional-model result', () => {
  const view = floorViewOf(floor());
  assert.deepEqual([view.kind, view.tone, view.titleKey, view.display, view.sliderMin, view.provisional], ['proved', 'success', 'moa_floor.proved', '1.24', 1.24, true]);
  assert.equal(view.provedLower, '1.23');
});

test('a witnessed floor says the minimum is NOT proved, still gives the safe display value, and shows the proved lower end only when there is one', () => {
  const witnessed = floorViewOf(floor({ status: 'model_witnessed', proved_lower_bound: null, reason: PUBLIC_REASONS.timeLimitReached }));
  assert.deepEqual([witnessed.kind, witnessed.tone, witnessed.titleKey, witnessed.display, witnessed.sliderMin], ['witnessed', 'warning', 'moa_floor.witnessed', '1.24', 1.24]);
  assert.equal(witnessed.provedLower, null, 'an unknown lower end is null, not 0');
  assert.equal(witnessed.reason?.adviceKey, 'reasons.advice_timeLimitReached');
  assert.equal(floorViewOf(floor({ status: 'model_witnessed', proved_lower_bound: 0.5 })).provedLower, '0.50');
});

test('an unresolved floor has no number and no slider value: nothing is invented, not even a 0', () => {
  const view = floorViewOf(floor({ status: 'unresolved', floor: null, display_floor: null, proved_lower_bound: null }));
  assert.deepEqual([view.kind, view.display, view.sliderMin, view.provedLower], ['unresolved', null, null, null]);
});

test('an infeasible request has no MOA floor at all: no number, an error tone, and still provisional', () => {
  const view = floorViewOf(floor({ status: 'model_infeasible', floor: null, display_floor: null, proved_lower_bound: null }));
  assert.deepEqual([view.kind, view.tone, view.display, view.sliderMin, view.provisional], ['infeasible', 'error', null, null, true]);
});

test('a display value that is withheld (null), non-finite, or below the achieved floor never drives the slider; the raw witness stays the truth', () => {
  assert.equal(floorViewOf(floor({ display_floor: null })).sliderMin, null);
  assert.equal(floorViewOf(floor({ display_floor: null })).display, null);
  assert.equal(usableDisplayFloor({ display_floor: Number.NaN, floor: 1 }), null);
  assert.equal(usableDisplayFloor({ display_floor: Infinity, floor: 1 }), null);
  assert.equal(usableDisplayFloor({ display_floor: 1.2, floor: 1.2345 }), null, 'below the achieved floor: refused');
  assert.equal(usableDisplayFloor({ display_floor: 1.24, floor: 1.2345 }), 1.24);
  assert.equal(usableDisplayFloor({ display_floor: 1.2345, floor: 1.2345 }), 1.2345, 'equal to the achieved floor is allowed');
});

test('zero and negative floors are real (the provisional model is signed): they drive the slider as they are', () => {
  assert.equal(floorViewOf(floor({ floor: 0, display_floor: 0 })).sliderMin, 0);
  assert.equal(floorViewOf(floor({ floor: 0, display_floor: 0 })).display, '0.00');
  assert.equal(floorViewOf(floor({ floor: -1.5, display_floor: -1.5, proved_lower_bound: -1.52 })).sliderMin, -1.5);
  assert.equal(floorViewOf(floor({ floor: -1.5, display_floor: -1.5, proved_lower_bound: -1.52 })).provedLower, '-1.52');
});

test('a cancelled floor is informational, not an error, and it does not narrow the MOA control: its best witness is only an upper bound', () => {
  const view = floorViewOf(floor({ status: 'model_witnessed', proved_lower_bound: null, reason: PUBLIC_REASONS.cancelledByUser }));
  assert.equal(view.tone, 'info');
  assert.equal(view.reason?.cancelled, true);
  assert.equal(view.reason?.adviceKey, null);
  assert.equal(view.interrupted, true);
  assert.equal(view.sliderMin, null, 'a search the user stopped must not raise the lower end of the control');
  assert.equal(view.display, '1.24', 'the best witnessed value is still shown as such');
  // A proved floor survives a late cancel (its bracket proof is complete), so it stays a success and keeps driving the control.
  const late = floorViewOf(floor({ reason: PUBLIC_REASONS.cancelledByUser }));
  assert.deepEqual([late.tone, late.interrupted, late.sliderMin], ['success', false, 1.24]);
  // A time limit is not a cancel: the witnessed floor is the best result the search had and it drives the control.
  const timed = floorViewOf(floor({ status: 'model_witnessed', proved_lower_bound: 1.1, reason: PUBLIC_REASONS.timeLimitReached }));
  assert.deepEqual([timed.interrupted, timed.sliderMin], [false, 1.24]);
});

test('the state a failed request retained is shown as interrupted: it never drives the control, even without a cancel reason', () => {
  const retained = floor({ status: 'model_witnessed', proved_lower_bound: null });
  const view = floorViewOf(retained, { interrupted: true });
  assert.deepEqual([view.kind, view.interrupted, view.sliderMin, view.display], ['witnessed', true, null, '1.24']);
  assert.equal(floorViewOf(retained).sliderMin, 1.24, 'the same state from a finished request does drive it');
  // A retained state that is already proved keeps its proof (the bracket was complete before the failure).
  assert.deepEqual([floorViewOf(floor(), { interrupted: true }).interrupted, floorViewOf(floor(), { interrupted: true }).sliderMin], [false, 1.24]);
});

test('the slider range: the floor IS the lower end (no rounding that could move it); the estimate is rounded up; the upper end never falls below the lower one', () => {
  assert.deepEqual(moaSliderRange(1.24, 0.4836, 3.021), { min: 1.24, max: 3.03 });
  // 1.23 * 100 is 123.00000000000001: a ceiling of the floor would move it to 1.24, so a floor is never passed through one.
  assert.equal(moaSliderRange(1.23, 0.4, 3).min, 1.23);
  assert.deepEqual(moaSliderRange(null, 0.4836, 3.021), { min: 0.49, max: 3.03 }, 'the estimate rounds UP so the leftmost position stays feasible');
  assert.deepEqual(moaSliderRange(5, 0.4, 3), { min: 5, max: 5 }, 'a floor above the estimated top lifts the top');
  assert.deepEqual(moaSliderRange(0, 0.4, 3), { min: 0, max: 3 }, 'a real zero floor is a zero floor');
  assert.deepEqual(moaSliderRange(-1.5, 0.4, 3), { min: -1.5, max: 3 });
});

test('the floor a failed request retained is read back from a SolverError\'s completion metadata or a CancellationError\'s snapshot', () => {
  const retained = floor({ status: 'model_witnessed', proved_lower_bound: null });
  const solver = new SolverError('solve', new Error('wasm trap'), true, { nodes: 0, termination: 'limit', witness: true, lower_bound: null, upper_bound: null, absolute_gap: null, floor: retained });
  assert.deepEqual(retainedFloorOf(solver), retained);
  assert.deepEqual(retainedFloorOf(new CancellationError('Cancelled by user', retained)), retained);
  assert.equal(retainedFloorOf(new CancellationError()), null);
  assert.equal(retainedFloorOf(new SolverError('solve', new Error('x'))), null);
  assert.equal(retainedFloorOf(new CancellationError('Cancelled by user', { launched: 1 })), null, 'a snapshot of another operation is not a floor');
  assert.equal(retainedFloorOf(new Error('plain')), null);
  assert.equal(retainedFloorOf(null), null);
  assert.equal(isFloorResponse(retained), true);
  assert.equal(isFloorResponse({ status: 'model_proved' }), false, 'a floor is always provisional');
  assert.equal(isFloorResponse({ status: 'something', moa_qualification: 'provisional_model' }), false);
});
