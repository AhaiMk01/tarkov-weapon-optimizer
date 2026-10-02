import assert from 'node:assert/strict';
import { classifySample } from './benchmarks/report.ts';
import type { Sample } from './benchmarks/types.ts';
import type { OptimizeResponse } from './src/api/client.ts';

function createSample(response: Partial<OptimizeResponse>): Sample {
  return {
    schemaVersion: 1,
    sequence: 1,
    caseId: 'test-case',
    variant: 'candidate',
    repetition: 1,
    warmup: false,
    request: {
      id: 'test-case',
      kind: 'optimize',
      request: { weapon_id: 'test_gun', use_true_ergo: true },
    },
    startedAt: new Date().toISOString(),
    coldLoadMs: null,
    elapsedMs: 100,
    deadlineMs: 60000,
    outcome: 'response',
    response: response as OptimizeResponse,
    validation: { checked: true, errors: [] },
    pageErrors: [],
    memory: { scope: 'page-js-heap-excludes-worker-wasm', before: null, after: null },
  };
}

// Slice 1.1: Nullable bounds must evaluate gap: undefined and certified: false
{
  const sample = createSample({
    selected_items: [],
    status: 'optimal',
    precision_resolved: 'precise',
    optimization: {
      lower_bound: null as unknown as number,
      upper_bound: null as unknown as number,
      absolute_gap: null as unknown as number,
      tolerance: 1e-5,
      nodes: 1,
      termination: 'optimal',
    },
  });

  const classification = classifySample(sample);
  console.log('Result:', classification);
  assert.equal(
    classification.gap,
    undefined,
    `Nullable bounds must not coerce to 0; expected gap to be undefined, got ${classification.gap}`
  );
  assert.equal(
    classification.certified,
    false,
    'Nullable bounds must not be certified'
  );
}

console.log('Slice 1.1 passed');

// Slice 1.2: Explore sweeps with curve_status: 'partial' must not evaluate completedCurve: true
{
  const exploreSample: Sample = {
    schemaVersion: 1,
    sequence: 2,
    caseId: 'sparse-explore',
    variant: 'candidate',
    repetition: 1,
    warmup: false,
    request: {
      id: 'sparse-explore',
      kind: 'explore',
      description: 'Explore test',
      request: { weapon_id: 'test_gun', ignore: 'price' } as any,
    },
    startedAt: new Date().toISOString(),
    coldLoadMs: null,
    elapsedMs: 500,
    deadlineMs: 60000,
    outcome: 'response',
    response: {
      curve_status: 'partial',
      points: [{ ergo: 20, recoil_pct: 0, recoil_v: 100, recoil_h: 100, price: 1000, selected_items: [], status: 'optimal', solve_time_ms: 10 }],
      total_solve_time_ms: 100,
      precision_resolved: 'precise',
    } as any,
    validation: { checked: true, errors: [] },
    pageErrors: [],
    memory: { scope: 'page-js-heap-excludes-worker-wasm', before: null, after: null },
  };

  const classification = classifySample(exploreSample);
  assert.equal(
    classification.completedCurve,
    false,
    `Explore curve with curve_status 'partial' must not be marked completedCurve: true; got ${classification.completedCurve}`
  );

  // And verify curve_status: 'complete' DOES evaluate completedCurve: true
  (exploreSample.response as any).curve_status = 'complete';
  const completeClassification = classifySample(exploreSample);
  assert.equal(
    completeClassification.completedCurve,
    true,
    'Explore curve with curve_status complete must be marked completedCurve: true'
  );
}
console.log('Slice 1.2 passed');

// Slice 1.3: Fast mode solves must not be certified
{
  const fastSample = createSample({
    selected_items: [],
    status: 'optimal',
    precision_resolved: 'fast',
    physical_certificate: 'approximate_optimal',
    optimization: {
      lower_bound: 100,
      upper_bound: 100,
      absolute_gap: 0,
      tolerance: 1e-5,
      nodes: 1,
      termination: 'optimal',
    },
  });

  const classification = classifySample(fastSample);
  assert.equal(
    classification.certified,
    false,
    `Fast mode solve must never be certified: true; got ${classification.certified}`
  );
  assert.equal(
    classification.certificateModel,
    'fast',
    `Expected certificateModel to be 'fast', got ${classification.certificateModel}`
  );
}
console.log('Slice 1.3 passed');

// Slice 1.4: Precise solves with clean validation and gap <= tolerance must be certified
{
  const preciseSample = createSample({
    selected_items: [],
    status: 'optimal',
    precision_resolved: 'precise',
    physical_certificate: 'certified_optimal',
    optimization: {
      lower_bound: 100,
      upper_bound: 100 + 1e-6,
      absolute_gap: 1e-6,
      tolerance: 1e-5,
      nodes: 5,
      termination: 'optimal',
    },
  });

  const classification = classifySample(preciseSample);
  assert.equal(
    classification.certified,
    true,
    `Precise solve with clean validation and gap <= tolerance must be certified: true; got ${classification.certified}`
  );
  assert.equal(
    classification.certificateModel,
    'precise',
    `Expected certificateModel to be 'precise', got ${classification.certificateModel}`
  );
  assert.ok(
    classification.gap != null && Math.abs(classification.gap - 1e-6) < 1e-9,
    `Expected gap to be ~1e-6, got ${classification.gap}`
  );
}
console.log('Slice 1.4 passed');
