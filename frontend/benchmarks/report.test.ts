import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifySample, summarize } from './report.ts';
import type { Sample } from './types.ts';

function sample(overrides: Partial<Sample> = {}): Sample {
  return {
    schemaVersion: 1, sequence: 0, caseId: 'case', variant: 'baseline', repetition: 0, warmup: false,
    request: { id: 'case', kind: 'optimize', description: '', request: { weapon_id: 'gun', precise_mode: 'precise' } },
    startedAt: '2026-01-01T00:00:00Z', coldLoadMs: 10, elapsedMs: 100, deadlineMs: 1000,
    outcome: 'response', validation: { checked: true, errors: [] }, pageErrors: [],
    memory: { scope: 'page-js-heap-excludes-worker-wasm', before: null, after: null },
    response: { status: 'optimal', selected_items: [], objective_value: 5, precision_resolved: 'precise',
      optimization: { lower_bound: 5, upper_bound: 5.000001, absolute_gap: 0.000001, tolerance: 0.00001, nodes: 1, termination: 'optimal' } },
    ...overrides,
  };
}
test('certified completion requires independent validation and consistent bounds', () => {
  assert.equal(classifySample(sample()).certified, true);
  assert.equal(classifySample(sample({ validation: { checked: false, errors: [] } })).certified, false);
  assert.equal(classifySample(sample({ validation: { checked: true, errors: ['conflict'] } })).certified, false);
  const result = sample();
  if (!result.response || !('optimization' in result.response) || !result.response.optimization) throw new Error('fixture');
  result.response.optimization.upper_bound = 6;
  assert.equal(classifySample(result).certified, false);
  result.response.optimization.upper_bound = Number.NaN;
  assert.equal(classifySample(result).certified, false);
});
test('printed optimality without a certificate is unknown, not certified', () => {
  assert.equal(classifySample(sample({ response: { status: 'optimal', selected_items: [], objective_value: 5 } })).certified, false);
});
test('Explore point statuses cannot establish complete-curve certification', () => {
  const s = sample({ request: { id: 'case', kind: 'explore', description: '', request: { weapon_id: 'gun', ignore: 'price', steps: 1 } }, response: { points: [] } });
  assert.equal(classifySample(s).certified, false);
  assert.equal(classifySample(s).certificateModel, 'unknown');
});
test('timeouts stay in denominator and never become completed deadline timings', () => {
  const s = summarize([sample(), sample({ repetition: 1, outcome: 'timeout', response: undefined, elapsedMs: 1000 })]);
  assert.equal(s.groups[0].samples, 2);
  assert.equal(s.groups[0].certified, 1);
  assert.equal(s.groups[0].completionRate, 0.5);
  assert.deepEqual(s.groups[0].certifiedLatenciesMs, [100]);
});
test('paired latency excludes uncompleted partners and warmups', () => {
  const s = summarize([sample(), sample({ variant: 'candidate', elapsedMs: 50 }),
    sample({ repetition: 1 }), sample({ repetition: 1, variant: 'candidate', outcome: 'timeout', response: undefined }),
    sample({ repetition: 2, warmup: true, elapsedMs: 1 })]);
  assert.deepEqual(s.pairs, [{ caseId: 'case', repetition: 0, baselineMs: 100, candidateMs: 50, speedup: 2 }]);
  assert.equal(s.groups.find(g => g.variant === 'baseline')?.samples, 2);
});
test('pairs are preserved across multiple sequential CLI runs without collision', () => {
  const r1 = [
    sample({ repetition: 1, elapsedMs: 100 }),
    sample({ repetition: 1, variant: 'candidate', elapsedMs: 50 }),
    sample({ repetition: 2, elapsedMs: 100 }),
    sample({ repetition: 2, variant: 'candidate', elapsedMs: 50 }),
  ];
  const r2 = [
    sample({ repetition: 1, elapsedMs: 120 }),
    sample({ repetition: 1, variant: 'candidate', elapsedMs: 60 }),
    sample({ repetition: 2, elapsedMs: 120 }),
    sample({ repetition: 2, variant: 'candidate', elapsedMs: 60 }),
    sample({ repetition: 3, elapsedMs: 120 }),
    sample({ repetition: 3, variant: 'candidate', elapsedMs: 60 }),
  ];
  const s = summarize([...r1, ...r2]);
  assert.equal(s.pairs.length, 5, 'All 5 pairs across the two runs must be preserved');
});
