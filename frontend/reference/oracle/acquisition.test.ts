import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReferenceFixture, ReferenceRequest } from './domain';
import type { ReferenceBuild } from './build';
import { resolveFixture, resolveRequest } from './resolve';
import { acquire, accessibleBases, barterRequirementTotal, cheapestLegalOffer, legalOffers, standaloneOffer } from './acquisition';
import { q, toString } from './q';

const fixture: ReferenceFixture = {
  schemaVersion: 1,
  items: [
    { id: 'grip', offers: [{ kind: 'trader', trader: 'prapor', level: 1, price: 500 }, { kind: 'flea', minPlayerLevel: 10, price: 400 }] },
    { id: 'mag', offers: [{ kind: 'trader', trader: 'skier', level: 2, price: 900 }] },
    { id: 'rare' },
    { id: 'zero', offers: [{ kind: 'trader', trader: 'prapor', level: 1, price: 0 }, { kind: 'flea', price: 0 }] },
    {
      id: 'trade',
      offers: [{ kind: 'barter', trader: 'mechanic', level: 2, requirements: [{ count: 2, avg24hPrice: 1000 }, { count: 1, avg24hPrice: null, basePrice: 250 }] }],
    },
  ],
  weapons: [{ id: 'gun', offers: [{ kind: 'trader', trader: 'prapor', level: 2, price: 10000 }] }],
  presets: [{
    id: 'p1',
    weaponId: 'gun',
    components: [{ itemId: 'grip', count: 2 }, { itemId: 'mag', count: 1 }],
    offers: [{ kind: 'trader', trader: 'skier', level: 1, price: 25000 }],
  }],
};
const rf = resolveFixture(fixture);
const req = (r: Partial<ReferenceRequest> = {}) => resolveRequest(fixture, { weapon_id: 'gun', ...r });
const items = (base: ReferenceBuild['base'], ...ids: [string, string][]): ReferenceBuild => ({
  base,
  placements: ids.map(([itemId, instanceId]) => ({
    parentInstanceId: 'weapon_0', slotId: `slot-${instanceId}`, childInstanceId: instanceId, itemId,
  })),
});

/** A one-item fixture whose only item is a single barter, for valuation tests. */
function barterFixture(requirements: { count: number; avg24hPrice?: number | null; basePrice?: number | null }[], offeredCount?: number) {
  const f: ReferenceFixture = {
    ...fixture,
    presets: [],
    items: [{ id: 'b', offers: [{ kind: 'barter', trader: 'prapor', level: 1, requirements, offeredCount }] }],
  };
  const resolved = resolveFixture(f);
  const request = resolveRequest(f, { weapon_id: 'gun', barter_available: true });
  const offer = resolved.items.get('b')!.offers[0];
  return { f, resolved, request, offer };
}

test('accessible bases: naked needs a legal offer; presets need their own legal offer; order is deterministic', () => {
  assert.deepEqual(accessibleBases(rf, req()), [{ kind: 'naked' }, { kind: 'preset', presetId: 'p1' }]);
  assert.deepEqual(accessibleBases(rf, req({ trader_levels: { prapor: 1 } })), [{ kind: 'preset', presetId: 'p1' }]);
  assert.deepEqual(accessibleBases(rf, req({ trader_levels: { prapor: 0, skier: 0 } })), []);
});

test('owning the receiver id never grants a base', () => {
  assert.deepEqual(accessibleBases(rf, req({ trader_levels: { prapor: 0, skier: 0 }, owned_items: ['gun', 'p1'] })), []);
});

test('trader loyalty gating: level below the offer fails, level at the offer passes, 0 disables', () => {
  const grip = rf.items.get('grip')!.offers;
  assert.equal(legalOffers(grip, req({ trader_levels: { prapor: 0 }, flea_available: false })).length, 0);
  assert.equal(legalOffers(grip, req({ trader_levels: { prapor: 1 }, flea_available: false })).length, 1);
  assert.equal(legalOffers(rf.items.get('mag')!.offers, req({ trader_levels: { skier: 1 } })).length, 0);
  assert.equal(legalOffers(rf.items.get('mag')!.offers, req({ trader_levels: { skier: 2 } })).length, 1);
});

test('flea: player level gate, availability flag, and cheapest wins over trader', () => {
  const grip = rf.items.get('grip')!.offers;
  assert.equal(toString(cheapestLegalOffer(grip, req())!.unitPrice), '400');
  assert.equal(cheapestLegalOffer(grip, req())!.kind, 'flea');
  assert.equal(toString(cheapestLegalOffer(grip, req({ player_level: 9 }))!.unitPrice), '500');
  assert.equal(toString(cheapestLegalOffer(grip, req({ player_level: 10 }))!.unitPrice), '400');
  assert.equal(toString(cheapestLegalOffer(grip, req({ flea_available: false }))!.unitPrice), '500');
  assert.equal(cheapestLegalOffer(grip, req({ flea_available: false, trader_levels: { prapor: 0 } })), null);
});

test('a stored zero price is not an offer', () => {
  assert.equal(standaloneOffer(rf, req(), 'zero'), null);
  assert.equal(standaloneOffer(rf, req(), 'rare'), null);
});

test('barter is off by default, needs its trader level, and honours the dogtag exclusion', () => {
  const trade = rf.items.get('trade')!.offers;
  assert.equal(legalOffers(trade, req()).length, 0);
  assert.equal(legalOffers(trade, req({ barter_available: true })).length, 1);
  assert.equal(legalOffers(trade, req({ barter_available: true, trader_levels: { mechanic: 1 } })).length, 0);
  assert.equal(legalOffers(trade, req({ barter_available: true, trader_levels: { mechanic: 0 } })).length, 0);
  const dog: ReferenceFixture = {
    ...fixture,
    presets: [],
    items: [{ id: 'd', offers: [{ kind: 'barter', trader: 'prapor', level: 1, requiresDogtag: true, requirements: [{ count: 1, basePrice: 10 }] }] }],
  };
  const dogs = resolveFixture(dog).items.get('d')!.offers;
  const rqd = (r: Partial<ReferenceRequest>) => resolveRequest(dog, { weapon_id: 'gun', barter_available: true, ...r });
  assert.equal(legalOffers(dogs, rqd({})).length, 1);
  assert.equal(legalOffers(dogs, rqd({ barter_exclude_dogtags: true })).length, 0);
});

test('barter requirements are valued avg24hPrice ?? basePrice ?? 0', () => {
  const offer = rf.items.get('trade')!.offers[0];
  if (offer.kind !== 'barter') throw new Error('fixture');
  // 2 x 1000 + 1 x 250 (avg null -> base) = 2250
  assert.equal(toString(barterRequirementTotal(offer)), '2250');
  assert.equal(toString(cheapestLegalOffer([offer], req({ barter_available: true }))!.unitPrice), '2250');
});

test('avg24hPrice of 0 is a value, not a missing price', () => {
  const { offer } = barterFixture([{ count: 1, avg24hPrice: 0, basePrice: 999 }, { count: 1, basePrice: 7 }]);
  if (offer.kind !== 'barter') throw new Error('fixture');
  assert.equal(toString(barterRequirementTotal(offer)), '7');
});

test('exact barter rounding: 0.1 + 2 x 0.7 is below 1.5 in exact binary64 arithmetic, so it rounds down', () => {
  // Double arithmetic gives 0.1 + 1.4 === 1.5 and Math.round(1.5) === 2; the exact total is just under 1.5.
  assert.equal(0.1 + 2 * 0.7, 1.5);
  const { offer, request } = barterFixture([{ count: 1, avg24hPrice: 0.1 }, { count: 2, avg24hPrice: 0.7 }]);
  if (offer.kind !== 'barter') throw new Error('fixture');
  const total = barterRequirementTotal(offer);
  assert.ok(total.n * 2n < 3n * total.d, 'exact total is strictly below 3/2');
  assert.equal(toString(cheapestLegalOffer([offer], request)!.lotPrice), '1');
});

test('exact half rounds up; a positive total that rounds to zero is a legal zero-cost barter; a zero total is no offer', () => {
  const lot = (avg: number) => {
    const { offer, request } = barterFixture([{ count: 1, avg24hPrice: avg }]);
    return cheapestLegalOffer([offer], request);
  };
  assert.equal(toString(lot(2.5)!.lotPrice), '3');
  assert.equal(toString(lot(0.25)!.lotPrice), '0');
  assert.equal(lot(0.25)!.kind, 'barter');
  assert.equal(lot(0), null);
});

test('offered count turns a lot price into an exact per-unit price', () => {
  const { offer, request } = barterFixture([{ count: 1, avg24hPrice: 100 }], 3);
  const legal = cheapestLegalOffer([offer], request)!;
  assert.deepEqual(legal.unitPrice, q(100, 3));
  assert.equal(legal.offeredCount, 3);
});

test('allocation: preset supply first, owned second, paid remainder, in instanceId code-unit order', () => {
  // 4 grips, preset supplies 2, owned 1, so exactly one is paid at the cheapest offer (flea 400)
  const build = items({ kind: 'preset', presetId: 'p1' }, ['grip', 'z'], ['grip', 'B'], ['grip', 'a'], ['grip', 'm']);
  const res = acquire(rf, req({ owned_items: ['grip'] }), build);
  assert.deepEqual(res.occurrences.map(o => [o.instanceId, o.source.kind]), [
    ['B', 'preset'], ['a', 'preset'], ['m', 'owned'], ['z', 'offer'],
  ]);
  assert.equal(res.deficits.get('grip'), 1);
  assert.equal(toString(res.modSpend), '400');
  assert.equal(toString(res.spend), '25400');
  assert.deepEqual(res.shortfalls, []);
});

test('mixed stock never over-allocates: authoritative deficit is max(0, installed - preset - owned)', () => {
  const surplus = acquire(rf, req({ owned_items: ['grip', 'grip', 'grip'] }), items({ kind: 'preset', presetId: 'p1' }, ['grip', 'i1']));
  assert.equal(surplus.deficits.get('grip') ?? 0, 0);
  assert.equal(toString(surplus.modSpend), '0');
  assert.equal(surplus.occurrences[0].source.kind, 'preset');
});

test('a preset count of 2 supplies two copies and the third is bought', () => {
  const res = acquire(rf, req(), items({ kind: 'preset', presetId: 'p1' }, ['grip', 'a'], ['grip', 'b'], ['grip', 'c']));
  assert.deepEqual(res.occurrences.map(o => o.source.kind), ['preset', 'preset', 'offer']);
  assert.equal(res.deficits.get('grip'), 1);
});

test('naked base: no preset supply, owned stock still counts, base price is the naked offer', () => {
  const res = acquire(rf, req({ owned_items: ['mag'] }), items({ kind: 'naked' }, ['mag', 'x'], ['grip', 'y']));
  assert.equal(toString(res.base.price!), '10000');
  assert.equal(res.occurrences.find(o => o.itemId === 'mag')!.source.kind, 'owned');
  assert.equal(toString(res.spend), '10400');
});

test('items without a standalone offer are capped by preset supply plus owned stock', () => {
  const two = acquire(rf, req({ owned_items: ['rare'] }), items({ kind: 'naked' }, ['rare', 'a'], ['rare', 'b']));
  assert.deepEqual(two.shortfalls, [{ itemId: 'rare', count: 1 }]);
  assert.equal(two.occurrences.filter(o => o.source.kind === 'unavailable').length, 1);
  const enough = acquire(rf, req({ owned_items: ['rare', 'rare'] }), items({ kind: 'naked' }, ['rare', 'a'], ['rare', 'b']));
  assert.deepEqual(enough.shortfalls, []);
});

test('legal zero-cost barter keeps vendor provenance and is never marked owned', () => {
  const { resolved, request } = barterFixture([{ count: 1, avg24hPrice: 0.25 }]);
  const res = acquire(resolved, request, items({ kind: 'naked' }, ['b', 'a']));
  const only = res.occurrences[0].source;
  assert.equal(only.kind, 'offer');
  assert.equal(only.kind === 'offer' && only.offer.kind, 'barter');
  assert.equal(toString(res.modSpend), '0');
});

test('inaccessible base is reported with null price and does not invent a free receiver', () => {
  const res = acquire(rf, req({ trader_levels: { prapor: 0 } }), items({ kind: 'naked' }));
  assert.equal(res.base.offer, null);
  assert.equal(res.base.price, null);
});

test('fractional per-unit prices stay exact in total spend', () => {
  const { resolved, request } = barterFixture([{ count: 1, avg24hPrice: 100 }], 3);
  const res = acquire(resolved, request, items({ kind: 'naked' }, ['b', 'a'], ['b', 'c'], ['b', 'd']));
  assert.deepEqual(res.modSpend, q(100));
});
