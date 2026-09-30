import assert from 'node:assert/strict';
import { validateBuild } from './benchmarks/validateBuild.ts';
import { choiceFixture } from './test_solver_fixtures.ts';
import type { OptimizeResponse } from './src/api/client.ts';

const fixture = choiceFixture([{ id: 'A', weight: 3, ergo: 30 }]);
const valid: OptimizeResponse = {
  status: 'optimal', objective_value: 30000,
  selected_items: [{ id: 'A', name: 'A', price: 100, source: 'mechanic', ergonomics: 30, recoil_modifier: 0 }],
  selected_preset: { id: 'gun', name: 'Receiver', price: 1000, source: 'mechanic', items: [] },
  slot_pairs: [['choice', 'A']],
  final_stats: { ergonomics: 30, recoil_vertical: 100, recoil_horizontal: 100, total_price: 1100, total_weight: 3, true_ergo_delta: 30, overswing_pct: 0, moa: 0 },
};
assert.deepEqual(validateBuild({ weapon_id: 'gun' }, valid, fixture.itemLookup), []);
assert.ok(validateBuild({ weapon_id: 'gun' }, { ...valid, slot_pairs: [] }, fixture.itemLookup).some(e => /plac/i.test(e)), 'a selected but unplaced part is not a validated build');
console.log('Benchmark build placement validation passed');
