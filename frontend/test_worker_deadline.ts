import assert from 'node:assert/strict';
import path from 'node:path';
import { loadAndVerifySnapshot } from './benchmarks/snapshot.ts';
import { seedDataCache } from './src/solver/dataService.ts';

const posted: any[] = [];
(globalThis as any).self = {
  postMessage: (msg: any) => { posted.push(msg); },
};

await import('./src/solver/solver.worker.ts');
const onmessage = (globalThis as any).self.onmessage;
assert.ok(typeof onmessage === 'function', 'self.onmessage must be registered');

// 1. Seed data cache from frozen snapshot
const { snapshot } = loadAndVerifySnapshot(path.resolve('benchmarks'));
seedDataCache('en', 'regular', snapshot.guns as any, snapshot.mods as any);

// 2. Test clearCache message
posted.length = 0;
onmessage({ data: { type: 'clearCache', id: 1 } });
await new Promise(r => setTimeout(r, 20));
assert.equal(posted.length, 1);
assert.deepEqual(posted[0], { type: 'result', id: 1, payload: { cleared: true } });

// 3. Test shared deadline on Sweet Spot (M4A1 with use_tchebycheff)
// Send a request with a very tight deadline (e.g. 50ms)
// Before the fix, endpoints got 50ms, and then solve got another 50ms (budget reset).
// With the fix, deadline is established upfront; if endpoints take the budget or remaining <= 0,
// it stops honestly and elapsed time stays <= ~100ms (not 200ms+).
const m4a1Id = '5447a9cd4bdc2dbd208b4567';
posted.length = 0;
const t0 = performance.now();
onmessage({
  data: {
    type: 'optimize',
    id: 2,
    payload: {
      lang: 'en',
      gameMode: 'regular',
      request: {
        weapon_id: m4a1Id,
        ergo_weight: 1,
        recoil_weight: 1,
        price_weight: 0.5,
        use_true_ergo: true,
        use_tchebycheff: true,
        time_limit_ms: 100, // tight 100ms shared deadline
      },
    },
  },
});

// Wait for the worker to post response
while (posted.length === 0) {
  await new Promise(r => setTimeout(r, 20));
}
const elapsed = performance.now() - t0;
const resp = posted[0].payload;
console.log('Worker optimize response:', { status: resp.status, reason: resp.reason, elapsed: Math.round(elapsed), solve_time_ms: Math.round(resp.solve_time_ms) });

assert.ok(elapsed < 600, `Total elapsed time (${elapsed}ms) must not reset budget to full multiple times`);
assert.equal(resp.status, 'incomplete');
assert.ok(/time limit/i.test(resp.reason ?? ''), `Reason must reflect time limit: ${resp.reason}`);

// 4. Test zero deadline stops immediately before endpoint computation
posted.length = 0;
const tZero = performance.now();
onmessage({
  data: {
    type: 'optimize',
    id: 3,
    payload: {
      lang: 'en',
      gameMode: 'regular',
      request: {
        weapon_id: m4a1Id,
        use_true_ergo: true,
        use_tchebycheff: true,
        time_limit_ms: 0,
      },
    },
  },
});
while (posted.length === 0) {
  await new Promise(r => setTimeout(r, 10));
}
const elapsedZero = performance.now() - tZero;
const respZero = posted[0].payload;
assert.equal(respZero.status, 'incomplete');
assert.ok(respZero.reason.includes('Request time limit reached before endpoint computation'), respZero.reason);
assert.ok(elapsedZero < 50, `Zero deadline must return immediately, took ${elapsedZero}ms`);

console.log('Worker shared deadline assertions passed successfully');
