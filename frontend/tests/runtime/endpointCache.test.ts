// The endpoint (payoff table) cache and its key (src/solver/endpointCache.ts, src/solver/reuseKey.ts; ADR 0013 section 4D, Phase 2.7a).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OptimizeRequest } from '../../src/api/client';
import { EndpointCache, endpointsQualifyForCache } from '../../src/solver/endpointCache';
import { canonicalizeOwnedItems, computeIdealPointCacheKey } from '../../src/solver/reuseKey';
import type { EndpointControls } from '../../src/solver/reuseKey';
import type { EndpointRecord, PayoffReport } from '../../src/solver/solver';

const certified = (i: number): EndpointRecord => ({
  weights: [[100, 0, 0], [0, 100, 0], [0, 0, 100]][i] as [number, number, number],
  status: 'optimal', physical_certificate: 'certified_optimal', precision_resolved: 'precise', model_qualification: 'exact', moa_qualification: null,
});
const payoff = (endpoints: EndpointRecord[] = [certified(0), certified(1), certified(2)]): PayoffReport => ({
  idealPoint: { zE: 1, nadE: 0, zR: -1, nadR: 0, zP: 2, nadP: 3 }, endpoints,
});

test('only exactly three optimal, certified, exact Precise MOA-independent endpoints qualify', () => {
  assert.equal(endpointsQualifyForCache([certified(0), certified(1), certified(2)]), true);
  assert.equal(endpointsQualifyForCache([certified(0), certified(1)]), false, 'a table needs all three endpoints');
  assert.equal(endpointsQualifyForCache([certified(0), certified(1), certified(2), certified(0)]), false);
  const bad: Partial<EndpointRecord>[] = [
    { status: 'feasible' },
    { physical_certificate: 'feasible' },
    { physical_certificate: 'approximate_optimal' },
    { precision_resolved: 'fast', model_qualification: 'approximate' },
    { model_qualification: 'approximate' },
    { moa_qualification: 'provisional_model' },
  ];
  for (const change of bad) {
    for (let at = 0; at < 3; at++) {
      const endpoints = [certified(0), certified(1), certified(2)];
      endpoints[at] = { ...endpoints[at], ...change };
      assert.equal(endpointsQualifyForCache(endpoints), false, `${JSON.stringify(change)} at endpoint ${at}`);
    }
  }
});

test('the cache stores only a qualified table, hands out a copy, and applies conservative tolerance eligibility', () => {
  const cache = new EndpointCache();
  assert.equal(cache.admit('k', payoff([certified(0), { ...certified(1), physical_certificate: 'feasible' }, certified(2)]), 1e-5), false);
  assert.equal(cache.size, 0);
  assert.equal(cache.lookup('k', 1e-5), undefined);

  assert.equal(cache.admit('k', payoff(), 1e-5), true);
  assert.deepEqual(cache.lookup('k', 1e-5), payoff().idealPoint);
  assert.deepEqual(cache.lookup('k', 1e-3), payoff().idealPoint, 'a looser request may reuse a finer table');
  assert.equal(cache.lookup('k', 1e-9), undefined, 'a finer request does not reuse a coarser table');
  assert.equal(cache.lookup('other', 1e-5), undefined);

  const report = payoff();
  cache.admit('copy', report, 1e-5);
  report.idealPoint.zE = 999;
  assert.equal(cache.lookup('copy', 1e-5)?.zE, 1, 'later edits of the caller object do not reach the cache');

  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.lookup('k', 1e-5), undefined);
});

const base: OptimizeRequest = { weapon_id: 'gun', ergo_weight: 1, recoil_weight: 1, price_weight: 0, use_tchebycheff: true, max_price: 1000, owned_items: ['a', 'b'] };
const controls: EndpointControls = { precisionResolved: 'precise', timeLimitMs: 60_000, maxSpatialNodes: 512, tolerance: 1e-5 };
const key = (req: Partial<OptimizeRequest>, c: EndpointControls = controls): string => computeIdealPointCacheKey('en', 'regular', { ...base, ...req }, c);

test('the stash is a multiset in the key: order does not matter, multiplicity does, and omitted equals []', () => {
  assert.deepEqual(canonicalizeOwnedItems(['b', 'a', 'b']), ['a', 'b', 'b']);
  assert.equal(canonicalizeOwnedItems([]), undefined);
  assert.equal(canonicalizeOwnedItems(undefined), undefined);
  const input = ['b', 'a'];
  canonicalizeOwnedItems(input);
  assert.deepEqual(input, ['b', 'a'], 'the input is not mutated');
  assert.equal(key({ owned_items: ['b', 'a'] }), key({ owned_items: ['a', 'b'] }));
  assert.notEqual(key({ owned_items: ['a', 'a', 'b'] }), key({ owned_items: ['a', 'b'] }));
  assert.equal(key({ owned_items: [] }), key({ owned_items: undefined }));
  assert.notEqual(key({ owned_items: [] }), key({ owned_items: ['a'] }));
});

test('the key follows the domain and the resolved controls, never the preference weights; a legacy call without controls still works', () => {
  assert.equal(key({ ergo_weight: 9, recoil_weight: 0.1, price_weight: 4 }), key({}), 'preference weights are not part of the table');
  assert.notEqual(key({ max_price: 2000 }), key({}));
  assert.notEqual(key({ flea_available: false }), key({}));
  assert.notEqual(key({}, { ...controls, timeLimitMs: 30_000 }), key({}), 'the resolved duration');
  assert.notEqual(key({}, { ...controls, maxSpatialNodes: 64 }), key({}));
  assert.notEqual(key({}, { ...controls, tolerance: 1e-9 }), key({}));
  assert.notEqual(key({}, { ...controls, precisionResolved: 'fast' }), key({}));
  // Neither a request id nor an absolute deadline can reach the key: there is no field for them.
  const fields = Object.keys(JSON.parse(key({})) as Record<string, unknown>);
  assert.ok(!fields.some(f => /deadline|request_id|^id$/i.test(f)), fields.join(','));
  assert.equal(typeof computeIdealPointCacheKey('en', 'regular', base), 'string');
});
