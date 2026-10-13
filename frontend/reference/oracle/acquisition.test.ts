import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReferenceFixture, ReferenceOffer, ReferenceRequest } from './domain';
import type { ReferenceBuild } from './build';
import { resolveFixture, resolveRequest } from './resolve';
import {
  acquire, accessibleBases, barterRequirementTotal, cheapestCover, cheapestLegalOffer, legalOffers, standaloneOffers,
} from './acquisition';
import { add, fromBinary64, q, sub, toString, ZERO } from './q';

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
  assert.equal(toString(cheapestLegalOffer(grip, req())!.lotPrice), '400');
  assert.equal(cheapestLegalOffer(grip, req())!.kind, 'flea');
  assert.equal(toString(cheapestLegalOffer(grip, req({ player_level: 9 }))!.lotPrice), '500');
  assert.equal(toString(cheapestLegalOffer(grip, req({ player_level: 10 }))!.lotPrice), '400');
  assert.equal(toString(cheapestLegalOffer(grip, req({ flea_available: false }))!.lotPrice), '500');
  assert.equal(cheapestLegalOffer(grip, req({ flea_available: false, trader_levels: { prapor: 0 } })), null);
});

test('a stored zero price is not an offer', () => {
  assert.deepEqual(standaloneOffers(rf, req(), 'zero'), []);
  assert.deepEqual(standaloneOffers(rf, req(), 'rare'), []);
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
  assert.equal(toString(cheapestLegalOffer([offer], req({ barter_available: true }))!.lotPrice), '2250');
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

test('a fractional ingredient count is decoded exactly: 155.1 x 3 + 2 x 100', () => {
  // Fraction(155.1) in exact binary64 is 5457096110977843 / 2^45 (2^45 = 35184372088832), which is NOT the decimal 155.1:
  // 155.1 x 2^45 = 5457096110977843.2, so the nearest double sits slightly below 155.1.
  //   155.1 x 3          = 3 x 5457096110977843 / 2^45 = 16371288332933529 / 2^45
  //   2 x 100            = 200 = 200 x 2^45 / 2^45     = 7036874417766400 / 2^45
  //   total              = (16371288332933529 + 7036874417766400) / 2^45 = 23408162750699929 / 35184372088832 (odd numerator, so irreducible)
  //   total ~ 665.2999999999999..., so the lot rounds half up to floor(665.8) -> floor(total + 1/2) = 665.
  const { offer, request } = barterFixture([{ count: 155.1, avg24hPrice: 3 }, { count: 2, basePrice: 100 }]);
  if (offer.kind !== 'barter') throw new Error('fixture');
  assert.deepEqual(offer.requirements[0].count, fromBinary64(155.1));
  assert.deepEqual(offer.requirements[0].count, q(5457096110977843n, 35184372088832n));
  assert.deepEqual(barterRequirementTotal(offer), q(23408162750699929n, 35184372088832n));
  assert.deepEqual(cheapestLegalOffer([offer], request)!.lotPrice, q(665));
});

test('exact barter rounding with a fractional count: 155.1 x 5 is just below 775.5 and rounds down although doubles give 775.5', () => {
  // exact: 5 x 5457096110977843 / 2^45 = 27285480554889215 / 35184372088832, while 775.5 = 1551 x 2^44 / 2^45 = 27285480554889216 / 2^45.
  // The exact total is therefore 775.5 - 2^-45, strictly below the half, so floor(total + 1/2) = 775.
  // binary64 multiplication rounds that product up to exactly 775.5 and Math.round(775.5) = 776 (the wrong lot price).
  assert.equal(155.1 * 5, 775.5);
  assert.equal(Math.round(155.1 * 5), 776);
  const { offer, request } = barterFixture([{ count: 155.1, avg24hPrice: 5 }]);
  if (offer.kind !== 'barter') throw new Error('fixture');
  assert.deepEqual(barterRequirementTotal(offer), q(27285480554889215n, 35184372088832n));
  assert.deepEqual(sub(q(1551n, 2n), barterRequirementTotal(offer)), q(1n, 35184372088832n));
  const legal = cheapestLegalOffer([offer], request)!;
  assert.deepEqual(legal.lotPrice, q(775));
  assert.equal(legal.offeredCount, 1);
});

test('an exactly representable fractional total of exactly one half still rounds up (0.5 x 5 = 5/2 -> 3)', () => {
  const { offer, request } = barterFixture([{ count: 0.5, avg24hPrice: 5 }]);
  if (offer.kind !== 'barter') throw new Error('fixture');
  assert.deepEqual(barterRequirementTotal(offer), q(5, 2));
  assert.deepEqual(cheapestLegalOffer([offer], request)!.lotPrice, q(3));
});

test('a fractional count with offeredCount prices the whole lot exactly: round(155.1 x 5) = 775 for the lot of 4, and one unit costs 775', () => {
  // Lot total 5 x 5457096110977843 / 2^45 = 775.5 - 2^-45 rounds to 775 (see above). The lot delivers 4 units for 775;
  // it is never split into 775/4 per unit: one unit costs 775, four cost 775, five cost 2 x 775 = 1550.
  const { offer, request } = barterFixture([{ count: 155.1, avg24hPrice: 5 }], 4);
  const legal = cheapestLegalOffer([offer], request)!;
  assert.deepEqual(legal.lotPrice, q(775));
  assert.equal(legal.offeredCount, 4);
  assert.deepEqual([1, 4, 5].map(d => cheapestCover([legal], d)!.cost), [q(775), q(775), q(1550)]);
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

test('offered count is the number of units one lot delivers; the lot price stays whole', () => {
  const { offer, request } = barterFixture([{ count: 1, avg24hPrice: 100 }], 3);
  const legal = cheapestLegalOffer([offer], request)!;
  assert.deepEqual(legal.lotPrice, q(100));
  assert.equal(legal.offeredCount, 3);
  // ceil(d / 3) lots of 100: d = 1, 2, 3 -> 1 lot; 4, 6 -> 2 lots; 7 -> 3 lots.
  assert.deepEqual([1, 2, 3, 4, 6, 7].map(d => cheapestCover([legal], d)!.cost), [q(100), q(100), q(100), q(200), q(200), q(300)]);
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
  assert.deepEqual(res.purchases.map(p => [p.itemId, p.deficit, toString(p.cost)]), [['grip', 1, '400']]);
  assert.deepEqual(res.occurrences.map(o => toString(o.charged)), ['0', '0', '0', '400']);
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

test('a lot of 3 at 100 covers three occurrences for 100 and a fourth needs a second lot: 200 (not 400/3)', () => {
  const { resolved, request } = barterFixture([{ count: 1, avg24hPrice: 100 }], 3);
  const three = acquire(resolved, request, items({ kind: 'naked' }, ['b', 'a'], ['b', 'c'], ['b', 'd']));
  assert.deepEqual(three.modSpend, q(100));
  const four = acquire(resolved, request, items({ kind: 'naked' }, ['b', 'a'], ['b', 'c'], ['b', 'd'], ['b', 'e']));
  assert.deepEqual(four.modSpend, q(200));
});

// --- lot granularity (interpretation 1 of INTERPRETATIONS.md) ---------------------------------------------------------
//
// Offers are bought in whole lots. A trader or flea offer is a lot of one unit at its stored price; a barter delivers
// offeredCount units for its rounded lot price. The cost of covering a paid deficit d is the exact minimum, over
// nonnegative integer lot counts across all legal offers of the item, of sum(lots x lotPrice) subject to
// sum(lots x units) >= d; surplus units are unused. The base is one unit, so it costs the cheapest lot.

const cash = (price: number): ReferenceOffer => ({ kind: 'trader', trader: 'prapor', level: 1, price });
const lotOf = (price: number, offeredCount: number): ReferenceOffer => ({
  kind: 'barter', trader: 'prapor', level: 1, requirements: [{ count: 1, avg24hPrice: price }], offeredCount,
});

/** Item `b` sold only through `offers`; a request with barters on (flea off) so every listed offer is legal. */
function lotWorld(offers: ReferenceOffer[]) {
  const f: ReferenceFixture = { ...fixture, presets: [], items: [{ id: 'b', offers }] };
  const resolved = resolveFixture(f);
  const request = resolveRequest(f, { weapon_id: 'gun', barter_available: true, flea_available: false });
  return { f, resolved, request, legal: legalOffers(resolved.items.get('b')!.offers, request) };
}

/** n installed copies of `b` with instance ids i00 < i01 < ... in code-unit order. */
const copies = (n: number) => Array.from({ length: n }, (_, k) => ['b', `i${String(k).padStart(2, '0')}`] as [string, string]);

test('lot granularity: one unit out of a lot of 30 at P costs the whole lot P, not P/30', () => {
  const P = 3000;
  const { resolved, request, legal } = lotWorld([lotOf(P, 30)]);
  assert.deepEqual(legal.map(o => [o.lotPrice, o.offeredCount]), [[q(P), 30]]);
  assert.deepEqual(cheapestCover(legal, 1)!.cost, q(P));
  const res = acquire(resolved, request, items({ kind: 'naked' }, ...copies(1)));
  assert.deepEqual(res.modSpend, q(P));
  assert.equal(toString(res.spend), '13000', '10000 naked receiver + the whole lot');
  assert.deepEqual(res.purchases.map(p => ({ itemId: p.itemId, deficit: p.deficit, cost: p.cost, lots: p.lots.map(l => [l.offer.index, l.used]) })), [
    { itemId: 'b', deficit: 1, cost: q(P), lots: [[0, 1]] },
  ]);
  assert.deepEqual(res.occurrences[0].charged, q(P));
});

test('lot granularity: 31 units from lots of 30 cost two lots, 2P; the 29 surplus units are unused', () => {
  const P = 3000;
  const { resolved, request, legal } = lotWorld([lotOf(P, 30)]);
  assert.deepEqual(cheapestCover(legal, 30)!.cost, q(P));
  assert.deepEqual(cheapestCover(legal, 31)!.cost, q(2 * P));
  const res = acquire(resolved, request, items({ kind: 'naked' }, ...copies(31)));
  assert.deepEqual(res.modSpend, q(2 * P));
  assert.deepEqual(res.purchases[0].lots.map(l => l.used), [30, 1]);
  assert.equal(res.purchases[0].lots.reduce((n, l) => n + l.offer.offeredCount - l.used, 0), 29, 'surplus units');
  // The first occurrence taken from a lot is charged the lot price; the other 29 units of lot 1 ride on it.
  assert.deepEqual(res.occurrences.map(o => toString(o.charged)), Array.from({ length: 31 }, (_, k) => (k === 0 || k === 30 ? '3000' : '0')));
  assert.ok(res.occurrences.every(o => o.source.kind === 'offer' && o.source.offer.kind === 'barter'));
});

test('lot granularity: with a single-unit cash offer, 31 units are cheaper as one lot of 30 plus one single (P + 150) than 2P', () => {
  // Offers in list order: cash 150 (index 0), barter lot of 30 at 3000 (index 1).
  //   two lots 6000; 31 singles 4650; one lot + one single 3000 + 150 = 3150 (the minimum).
  const { resolved, request, legal } = lotWorld([cash(150), lotOf(3000, 30)]);
  const cover = cheapestCover(legal, 31)!;
  assert.deepEqual(cover.cost, q(3150));
  assert.deepEqual(cover.lots.map(l => l.kind), ['trader', 'barter']);
  assert.deepEqual(cheapestCover(legal, 29)!.cost, q(3000), '29 singles cost 4350: one lot of 30 (1 surplus unit) is cheaper');
  const res = acquire(resolved, request, items({ kind: 'naked' }, ...copies(31)));
  assert.deepEqual(res.modSpend, q(3150));
  // Lots are ordered by offer index: the single (index 0) takes the first paid occurrence, the lot of 30 the next 30.
  assert.deepEqual(res.occurrences.map(o => (o.source.kind === 'offer' ? o.source.offer.kind : o.source.kind)), ['trader', ...Array(30).fill('barter')]);
  assert.deepEqual(res.occurrences.map(o => toString(o.charged)), ['150', '3000', ...Array(29).fill('0')]);
});

test('lot granularity: a tie between lots and singles keeps the earlier offer in list order', () => {
  // 20 singles at 150 = 3000 = one lot of 30 at 3000: equal cost, so the earlier-listed offer is kept.
  const cashFirst = cheapestCover(lotWorld([cash(150), lotOf(3000, 30)]).legal, 20)!;
  assert.deepEqual(cashFirst.cost, q(3000));
  assert.deepEqual(cashFirst.lots.map(l => l.kind), Array(20).fill('trader'));
  const lotFirst = cheapestCover(lotWorld([lotOf(3000, 30), cash(150)]).legal, 20)!;
  assert.deepEqual(lotFirst.cost, q(3000));
  assert.deepEqual(lotFirst.lots.map(l => l.kind), ['barter']);
});

test('lot granularity: mixing lot sizes beats either pure choice (5 for 500 and 3 for 270, deficit 8)', () => {
  // pure lots of 5: ceil(8/5) = 2 lots = 1000; pure lots of 3: ceil(8/3) = 3 lots = 810; one of each = 8 units for 770.
  const { resolved, request, legal } = lotWorld([lotOf(500, 5), lotOf(270, 3)]);
  const cover = cheapestCover(legal, 8)!;
  assert.deepEqual(cover.cost, q(770));
  assert.deepEqual(cover.lots.map(l => [l.index, l.offeredCount]), [[0, 5], [1, 3]]);
  const res = acquire(resolved, request, items({ kind: 'naked' }, ...copies(8)));
  assert.deepEqual(res.modSpend, q(770));
  assert.deepEqual(res.occurrences.map(o => toString(o.charged)), ['500', '0', '0', '0', '0', '270', '0', '0']);
});

test('lot granularity: the cover equals an exhaustive search over lot counts on 300 deterministic instances', () => {
  let seed = 20261004;
  const next = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return Math.floor(seed / 65536) % n;
  };
  /** Independent minimum: try every lot count of every offer that could still matter. */
  const exhaustive = (offers: { price: number; units: number }[], k: number, remaining: number): number => {
    if (k === offers.length) return remaining <= 0 ? 0 : Infinity;
    const { price, units } = offers[k];
    let best = Infinity;
    for (let c = 0; c <= Math.ceil(Math.max(remaining, 0) / units); c++) best = Math.min(best, c * price + exhaustive(offers, k + 1, remaining - c * units));
    return best;
  };
  for (let t = 0; t < 300; t++) {
    const offers = Array.from({ length: 1 + next(3) }, () => ({ price: 1 + next(60), units: 1 + next(6) }));
    const deficit = next(14);
    const { resolved, request, legal } = lotWorld(offers.map(o => (o.units === 1 && next(2) === 0 ? cash(o.price) : lotOf(o.price, o.units))));
    const cover = cheapestCover(legal, deficit)!;
    const where = `${JSON.stringify(offers)} d=${deficit}`;
    assert.equal(toString(cover.cost), String(exhaustive(offers, 0, deficit)), where);
    assert.ok(cover.lots.reduce((n, l) => n + l.offeredCount, 0) >= deficit, `${where}: the lots cover the deficit`);
    assert.deepEqual(cover.cost, cover.lots.reduce((s, l) => add(s, l.lotPrice), ZERO), `${where}: cost is the sum of the lot prices`);
    // acquire agrees: the spend equals the cover and the per-occurrence charges add up to it.
    const res = acquire(resolved, request, items({ kind: 'naked' }, ...copies(deficit)));
    assert.deepEqual(res.modSpend, cover.cost, where);
    assert.deepEqual(res.occurrences.reduce((s, o) => add(s, o.charged), ZERO), cover.cost, `${where}: charges add up to the spend`);
    assert.ok(res.occurrences.every(o => o.source.kind === 'offer'), `${where}: every paid occurrence names a real offer`);
  }
});

test('lot granularity: no deficit costs nothing, no legal offer cannot cover a deficit, and a bad deficit is a programming error', () => {
  const { legal } = lotWorld([lotOf(100, 3)]);
  assert.deepEqual(cheapestCover(legal, 0), { cost: q(0), lots: [] });
  assert.equal(cheapestCover([], 2), null);
  assert.deepEqual(cheapestCover([], 0), { cost: q(0), lots: [] });
  assert.throws(() => cheapestCover(legal, -1), RangeError);
  assert.throws(() => cheapestCover(legal, 1.5), RangeError);
});

test('lot granularity: the base is one unit, so the cheapest LOT wins: a lot of 3 at 300 loses to cash at 200 although 300 / 3 < 200', () => {
  const f: ReferenceFixture = {
    ...fixture,
    items: [{ id: 'x' }],
    weapons: [{ id: 'gun', offers: [] }],
    presets: [{ id: 'p', weaponId: 'gun', components: [], offers: [lotOf(300, 3), cash(200)] }],
  };
  const resolved = resolveFixture(f);
  const request = resolveRequest(f, { weapon_id: 'gun', barter_available: true });
  const offer = cheapestLegalOffer(resolved.presets.get('p')!.offers, request)!;
  assert.equal(offer.kind, 'trader');
  assert.deepEqual(offer.lotPrice, q(200));
  const res = acquire(resolved, request, items({ kind: 'preset', presetId: 'p' }));
  assert.deepEqual(res.base.price, q(200));
  assert.deepEqual(res.spend, q(200));
});

test('lot granularity: a free lot (barter total rounding to 0) covers any deficit for nothing and keeps barter provenance', () => {
  const { resolved, request } = lotWorld([lotOf(0.25, 2)]);
  const res = acquire(resolved, request, items({ kind: 'naked' }, ...copies(5)));
  assert.deepEqual(res.modSpend, q(0));
  assert.deepEqual(res.purchases[0].lots.map(l => l.used), [2, 2, 1]);
  assert.ok(res.occurrences.every(o => o.source.kind === 'offer' && o.source.offer.kind === 'barter' && toString(o.charged) === '0'));
});
