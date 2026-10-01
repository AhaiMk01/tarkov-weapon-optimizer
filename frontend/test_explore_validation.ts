import assert from 'node:assert/strict';
import { validateExplorePoint } from './benchmarks/exploreValidation.ts';
import { planReuseWork } from './benchmarks/reusePlan.ts';
import { choiceFixture } from './test_solver_fixtures.ts';
import type { ExplorePoint } from './src/api/client.ts';
import type { BenchmarkCase } from './benchmarks/types.ts';

const fixture = choiceFixture([{ id: 'A', weight: 3, ergo: 20 }]);
const lookup = fixture.itemLookup;

function point(overrides: Partial<ExplorePoint> = {}): ExplorePoint {
  return {
    ergo: 20,
    recoil_pct: 0,
    recoil_v: 100,
    recoil_h: 100,
    price: 1100,
    selected_items: [{ id: 'A', name: 'A', price: 100, source: 'mechanic', ergonomics: 20, recoil_modifier: 0 }],
    selected_preset: { id: 'gun', name: 'Receiver', price: 1000, source: 'mechanic', items: [] },
    slot_pairs: [['choice', 'A']],
    status: 'optimal',
    ...overrides,
  };
}

const faithful = validateExplorePoint({ weapon_id: 'gun' }, point(), lookup);
assert.deepEqual(faithful, [], `faithful point should validate, got ${faithful.join('; ')}`);

const limitErrors = validateExplorePoint({ weapon_id: 'gun', min_ergonomics: 99 }, point(), lookup);
assert.ok(limitErrors.some(error => error.includes('Minimum ergonomics not met')), `original minimum must be enforced, got ${limitErrors.join('; ')}`);

const lied = validateExplorePoint({ weapon_id: 'gun' }, point({ ergo: 95, recoil_v: 1, recoil_h: 1 }), lookup);
assert.ok(lied.some(error => error.startsWith('Ergonomics:')), `emitted ergonomics must be checked, got ${lied.join('; ')}`);
assert.ok(lied.some(error => error.startsWith('Vertical recoil:')), `emitted recoil must be checked, got ${lied.join('; ')}`);
assert.ok(!lied.some(error => error.includes('Minimum ergonomics')), 'a display lie is not a hard-limit failure');

const fractional = choiceFixture([{ id: 'A', weight: 3, ergo: 30.04, recoil: 100.04 }]);
const rounded = validateExplorePoint({ weapon_id: 'gun' }, {
  ...point(),
  ergo: 30,
  recoil_v: 100,
  recoil_h: 100,
  selected_items: [{ id: 'A', name: 'A', price: 100, source: 'mechanic', ergonomics: 30.04, recoil_modifier: 0.0004 }],
}, fractional.itemLookup);
assert.deepEqual(rounded, [], `half-step display rounding must be accepted, got ${rounded.join('; ')}`);

const tooFar = validateExplorePoint({ weapon_id: 'gun' }, point({ ergo: 20.06 }), lookup);
assert.ok(tooFar.some(error => error.startsWith('Ergonomics:')), 'rounding beyond half a display step is a mismatch');

const uncertified = validateExplorePoint({ weapon_id: 'gun' }, point({ status: 'incomplete' }), lookup);
assert.ok(uncertified.some(error => /No returned build/.test(error)), 'missing a feasible status is not rewritten to optimal');

const seq = (id: string): BenchmarkCase => ({ id, kind: 'optimize', description: '', request: { weapon_id: 'gun' } });
const plan = planReuseWork([seq('sparse-explore'), seq('sparse-sweet-seq-1'), seq('dense-restricted'), seq('sparse-sweet-seq-2')]);
assert.deepEqual(plan.map(item => item.kind === 'sequence' ? item.id : item.caseItem.id), ['sparse-explore', 'sparse-sweet-seq', 'dense-restricted']);

console.log('explore point validation passed');
