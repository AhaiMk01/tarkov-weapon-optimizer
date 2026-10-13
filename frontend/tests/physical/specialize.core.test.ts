// specializeLP + decodeSolution, solved with Node highs: base choice, slots, the objective and the exact wallet (ADR 0003, 0009, 0013 4A).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gun, lookupOf, mod, slot, trader, WEAPON } from './lpFixtures';
import { solve } from './lpHarness';

const close = (actual: number, expected: number, tolerance = 1e-9): void =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

test('an optional mod that raises the objective is installed, and the decoded build carries instance ids and the exact spend', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { ergo: 10, slots: [slot('s', ['a'])] }),
    ['a', mod('a', { ergo: 5, offers: [trader('prapor', 1, 100)] })],
  );
  const { solution, build } = await solve(lookup, WEAPON, { ergoWeight: 1, recoilWeight: 0 });
  assert.equal(solution.status, 'Optimal');
  close(solution.objective, 15);
  assert.ok(build);
  assert.deepEqual(build.base, { kind: 'naked' });
  assert.deepEqual(build.placements, [{ parentInstanceId: 'weapon_0', slotId: 's', childInstanceId: 'weapon_0/s:a', itemId: 'a' }]);
  assert.equal(build.spend, 5100);
});
