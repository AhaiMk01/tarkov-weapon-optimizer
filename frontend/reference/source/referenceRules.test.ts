// Seam: referenceRules.ts -- the documented source-to-offer rules, written independently:
//   * synthesized flea offer (skipped for noFlea or an absent/zero lastLowPrice;
//     priced avg24hPrice || lastLowPrice)                           [CLAUDE.md Data Source, tarkov-api]
//   * barter valuation avg24hPrice ?? basePrice ?? 0, exact in Q    [ADR 0010 §2, §5]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SourceError, readRawWorld } from './rawReader';
import type { RefItem } from './rawReader';
import { item, texts } from './syntheticDocs';
import {
  decodeBinary64,
  referenceBarterOffer,
  referenceBarterTotal,
  referenceFleaOffer,
  roundHalfUp,
} from './referenceRules';

function refItem(over: Record<string, unknown>): RefItem {
  const world = readRawWorld(texts([item('X', over)]));
  const found = world.items.get('X');
  assert.ok(found);
  return found;
}

test('decodeBinary64 yields the exact integer ratio of a finite binary64 leaf', () => {
  assert.deepEqual(decodeBinary64(0.5), { num: 1n, den: 2n });
  assert.deepEqual(decodeBinary64(3), { num: 3n, den: 1n });
  assert.deepEqual(decodeBinary64(0), { num: 0n, den: 1n });
  assert.deepEqual(decodeBinary64(-2.5), { num: -5n, den: 2n });
  // 0.35 = 3152519739159347/9007199254740992 (ADR 0010 §2)
  assert.deepEqual(decodeBinary64(0.35), { num: 3152519739159347n, den: 9007199254740992n });
  assert.deepEqual(decodeBinary64(5e-324), { num: 1n, den: 1n << 1074n });
  assert.deepEqual(decodeBinary64(2 ** 60), { num: 1n << 60n, den: 1n });
  assert.throws(() => decodeBinary64(Number.NaN));
  assert.throws(() => decodeBinary64(Number.POSITIVE_INFINITY));
});

test('roundHalfUp is floor(x + 1/2) on exact ratios', () => {
  assert.equal(roundHalfUp({ num: 3n, den: 2n }), 2n);
  assert.equal(roundHalfUp({ num: 5n, den: 2n }), 3n);
  assert.equal(roundHalfUp({ num: 7n, den: 4n }), 2n);
  assert.equal(roundHalfUp({ num: 1n, den: 4n }), 0n);
  assert.equal(roundHalfUp({ num: 0n, den: 1n }), 0n);
  assert.equal(roundHalfUp({ num: 9n, den: 1n }), 9n);
});

test('referenceFleaOffer follows the documented synthesis rule', () => {
  assert.equal(referenceFleaOffer(refItem({ lastLowPrice: null, avg24hPrice: 10 })), null);
  assert.equal(referenceFleaOffer(refItem({ lastLowPrice: 0, avg24hPrice: 10 })), null);
  assert.equal(referenceFleaOffer(refItem({ types: ['mods', 'noFlea'], lastLowPrice: 5, avg24hPrice: 10 })), null);
  assert.deepEqual(referenceFleaOffer(refItem({ lastLowPrice: 5, avg24hPrice: 10 })), { priceRUB: 10 });
  // `||`, not `??`: a zero or absent average falls back to the last low price.
  assert.deepEqual(referenceFleaOffer(refItem({ lastLowPrice: 5, avg24hPrice: 0 })), { priceRUB: 5 });
  assert.deepEqual(referenceFleaOffer(refItem({ lastLowPrice: 5, avg24hPrice: null })), { priceRUB: 5 });
});

function barterWorld(requirements: Array<{ item: string; count: number }>) {
  const bartersText = JSON.stringify({
    data: [{ id: 'b', trader: 't1', minTraderLevel: 2, taskUnlock: null, requiredItems: requirements, offeredItem: { item: 'OUT', count: 1 } }],
  });
  const world = readRawWorld(texts([
    item('OUT'),
    item('avgZero', { avg24hPrice: 0, basePrice: 100 }),
    item('avgNullBase', { avg24hPrice: null, basePrice: 100 }),
    item('bothNull', { avg24hPrice: null, basePrice: null }),
    item('avg7', { avg24hPrice: 7, basePrice: 1 }),
    item('p3', { avg24hPrice: 3 }),
    item('p5', { avg24hPrice: 5 }),
  ], { barters: bartersText }));
  return { world, barter: world.barters[0] };
}

test('barter valuation is avg24hPrice ?? basePrice ?? 0 (a zero average does NOT fall through)', () => {
  const { world, barter } = barterWorld([
    { item: 'avgZero', count: 2 }, { item: 'avgNullBase', count: 3 }, { item: 'bothNull', count: 9 }, { item: 'avg7', count: 1 },
  ]);
  // 2*0 + 3*100 + 9*0 + 1*7 = 307
  assert.deepEqual(referenceBarterTotal(world, barter), { num: 307n, den: 1n });
  assert.equal(referenceBarterOffer(world, barter)?.priceRUB, 307);
});

test('barter totals are exact in Q: 0.7 x 5 is just below 3.5 and rounds to 3, not to float 3.5 -> 4', () => {
  const { world, barter } = barterWorld([{ item: 'avg7', count: 0.5 }, { item: 'p5', count: 0.7 }]);
  // 7*0.5 = 3.5 exactly; 5*0.7 = 3.49999999999999977795539507497 exactly; total = 6.99999999999999977795...
  assert.equal(referenceBarterOffer(world, barter)?.priceRUB, 7);
  const half = barterWorld([{ item: 'p5', count: 0.7 }]);
  assert.equal(Math.round(0.7 * 5), 4, 'float arithmetic rounds the same total up');
  assert.equal(referenceBarterOffer(half.world, half.barter)?.priceRUB, 3, 'exact arithmetic rounds it down');
});

test('a barter whose exact total is not positive is not an offer', () => {
  const { world, barter } = barterWorld([{ item: 'avgZero', count: 4 }, { item: 'bothNull', count: 1 }]);
  assert.equal(referenceBarterOffer(world, barter), null);
});

test('a barter requirement naming an unresolved item is a source error, not a free ingredient', () => {
  const { world, barter } = barterWorld([{ item: 'ghost', count: 1 }]);
  assert.throws(
    () => referenceBarterTotal(world, barter),
    (error: unknown) => error instanceof SourceError && /ghost/.test(error.message),
  );
});
