// Seam: toFixture.ts offers -- trader offers, the synthesized flea offer and barters of the mapped fixture.
//
// Expected values are read off the pinned raw documents by hand (cited per test) or recomputed by the
// independent reference reader (referenceBarterOffer); they are never taken from the bridge's own output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  barterRequirementTotal, cheapestCover, fromBinary64, legalOffers, q, resolveFixture, resolveRequest, sub,
  type ReferenceFixture, type ReferenceItem, type ReferenceRequest,
} from '../oracle/index';
import { loadPinnedWorld } from '../source/pinnedWorld';
import { indexBartersByOfferedItem } from '../source/rawReader';
import { referenceBarterOffer } from '../source/referenceRules';
import { fixtureForWeapon } from './toFixture';

const { world } = loadPinnedWorld('en');
const bartersByItem = indexBartersByOfferedItem(world.barters);

const M4A1 = '5447a9cd4bdc2dbd208b4567';
const AK74N = '5644bd2b4bdc2d3b4c8b4572';
const MOUNT_0155 = '688b54a11cef2a61d005273b';
const BRAVO4 = '57adff4f24597737f373b6e6'; // SIG Sauer Bravo4 4x30 scope
const PMAG_D60 = '59c1383d86f774290a37e0ca'; // noFlea, no trader offer, one fractional (25.02) ref barter
const EOTECH_EXPS3_TAN = '558022b54bdc2dac148b458d'; // EOTech EXPS3-0 tan: one fractional (7.52) ref barter, no integer one
const HENSOLDT = '56ea70acd2720b844b8b4594'; // Hensoldt FF 4-16x56 scope: skier L3 barter for 5 USEC dogtags
const DOGTAG_USEC = '59f32c3b86f77472a31742f0';
const MTS255 = '60db29ce99594040e04c4a27'; // MTS-255-12 shotgun; its revolver cylinder reaches 12/70 RIP ammunition
const RIP_AMMO = '5c0d591486f7744c505b416f'; // 12/70 RIP: a barter offers 5 rounds per craft

const itemOf = (fixture: ReferenceFixture, id: string): ReferenceItem => {
  const found = fixture.items.find(i => i.id === id);
  assert.ok(found, `item ${id} is in the fixture`);
  return found;
};

const offersOf = (fixture: ReferenceFixture, id: string) => {
  const resolved = resolveFixture(fixture).items.get(id);
  assert.ok(resolved, `item ${id} resolves`);
  return resolved.offers;
};

test('trader offers use priceRUB (the converted price), minTraderLevel and the trader normalizedName', () => {
  // items.json: the plate's only trader offer is { trader: peacekeeper, currency: USD, price: 20, priceRUB: 3461, minTraderLevel: 3 }.
  const plate = itemOf(fixtureForWeapon(world, M4A1).fixture, MOUNT_0155);
  assert.deepEqual(world.items.get(MOUNT_0155)?.buyFromTrader.map(o => [o.currency, o.price]), [['USD', 20]]);
  assert.deepEqual(plate.offers?.filter(o => o.kind === 'trader'), [{ kind: 'trader', trader: 'peacekeeper', level: 3, price: 3461 }]);
});

test('flea offer: avg24hPrice || lastLowPrice, gated by the raw minLevelForFlea', () => {
  const { fixture } = fixtureForWeapon(world, M4A1);
  // Bravo4: avg24hPrice 43091, lastLowPrice 27900, minLevelForFlea 25 -> the flea price is the average, the gate is 25.
  assert.deepEqual(itemOf(fixture, BRAVO4).offers?.filter(o => o.kind === 'flea'), [{ kind: 'flea', price: 43091, minPlayerLevel: 25 }]);
  // Plate: avg24hPrice = lastLowPrice = 33000, minLevelForFlea 0.
  assert.deepEqual(itemOf(fixture, MOUNT_0155).offers?.filter(o => o.kind === 'flea'), [{ kind: 'flea', price: 33000, minPlayerLevel: 0 }]);
});

test('a noFlea item with no trader offer gets no flea offer (and no invented one)', () => {
  const pmag = itemOf(fixtureForWeapon(world, M4A1).fixture, PMAG_D60);
  assert.equal(world.items.get(PMAG_D60)?.noFlea, true);
  assert.deepEqual(pmag.offers?.filter(o => o.kind !== 'barter'), []);
});

test('the naked receiver gets trader offers only by default; flea and barters are opt-in', () => {
  // items.json: M4A1 buyFromTrader = mechanic L3 priceRUB 22997; flea avg24hPrice 58973, minLevelForFlea 25.
  assert.deepEqual(fixtureForWeapon(world, M4A1).fixture.weapons[0].offers, [{ kind: 'trader', trader: 'mechanic', level: 3, price: 22997 }]);
  assert.deepEqual(
    fixtureForWeapon(world, M4A1, { weaponOfferKinds: ['trader', 'flea'] }).fixture.weapons[0].offers,
    [{ kind: 'trader', trader: 'mechanic', level: 3, price: 22997 }, { kind: 'flea', price: 58973, minPlayerLevel: 25 }],
  );
  assert.deepEqual(fixtureForWeapon(world, M4A1, { weaponOfferKinds: [] }).fixture.weapons[0].offers, []);
});

test('a barter keeps trader, level, ingredient valuation inputs, offeredCount and the dogtag flag', () => {
  // barters.json 6abb6e13...: skier L3, 5 x dogtag-usec -> 1 x Hensoldt scope.
  const barters = itemOf(fixtureForWeapon(world, M4A1).fixture, HENSOLDT).offers?.filter(o => o.kind === 'barter');
  // items.json: dogtag-usec has avg24hPrice null and basePrice 900, so only basePrice is a valuation input
  // (the oracle values the ingredient avg24hPrice ?? basePrice ?? 0 = 900; lot 5 x 900 = 4500).
  const dogtag = world.items.get(DOGTAG_USEC);
  assert.equal(dogtag?.normalizedName, 'dogtag-usec');
  assert.equal(dogtag?.avg24hPrice, null);
  assert.deepEqual(barters?.[0], {
    kind: 'barter',
    trader: 'skier',
    level: 3,
    requirements: [{ itemId: DOGTAG_USEC, count: 5, basePrice: 900 }],
    offeredCount: 1,
    requiresDogtag: true,
  });
});

test('offeredCount > 1 survives and the oracle buys the lot whole: one unit costs the whole lot, six units two lots', () => {
  // barters.json: skier L2 (task-gated) gives 5 x 12/70 RIP for 1 x T-Shaped Plug.
  // T-Shaped Plug: avg24hPrice 23962 (basePrice 2481) -> lot total 23962 (avg ?? base), lot price 23962 for 5 units.
  // Whole-lot rule (interpretation 1): a deficit of 1 or 5 costs one lot, 23962; a deficit of 6 needs ceil(6/5) = 2 lots, 47924.
  const { fixture } = fixtureForWeapon(world, MTS255);
  const barter = itemOf(fixture, RIP_AMMO).offers?.find(o => o.kind === 'barter');
  assert.ok(barter && barter.kind === 'barter');
  assert.equal(barter.offeredCount, 5);
  assert.equal(barter.requirements[0].avg24hPrice, 23962);
  const request: ReferenceRequest = { weapon_id: MTS255, barter_available: true, flea_available: false, trader_levels: { skier: 4, jaeger: 0 } };
  const fromBarter = legalOffers(offersOf(fixture, RIP_AMMO), resolveRequest(fixture, request)).find(o => o.kind === 'barter');
  assert.deepEqual(fromBarter?.lotPrice, q(23962));
  assert.equal(fromBarter?.offeredCount, 5);
  assert.ok(fromBarter);
  assert.deepEqual([1, 5, 6].map(d => cheapestCover([fromBarter], d)?.cost), [q(23962), q(23962), q(47924)]);
});

test('every mapped barter, fractional counts included, prices exactly like the reference reader says (lot = floor(total + 1/2)), offeredCount carried', () => {
  for (const gunId of [M4A1, MTS255, AK74N]) {
    const { fixture } = fixtureForWeapon(world, gunId);
    const request = resolveRequest(fixture, {
      weapon_id: gunId, barter_available: true, flea_available: false,
      trader_levels: { prapor: 4, skier: 4, peacekeeper: 4, mechanic: 4, jaeger: 4, ref: 4 },
    });
    let checked = 0;
    let fractionalChecked = 0;
    for (const item of fixture.items) {
      const expected = (bartersByItem.get(item.id) ?? [])
        .map(b => ({ b, offer: referenceBarterOffer(world, b) }))
        .filter(x => x.offer !== null);
      fractionalChecked += expected.filter(x => x.b.requirements.some(r => !Number.isInteger(r.count))).length;
      const lots = legalOffers(offersOf(fixture, item.id), request).filter(o => o.kind === 'barter');
      assert.deepEqual(
        lots.map(o => o.lotPrice),
        expected.map(x => q(BigInt(x.offer?.priceRUB ?? -1))),
        `barter lots of ${world.items.get(item.id)?.normalizedName}`,
      );
      assert.deepEqual(lots.map(o => o.offeredCount), expected.map(x => x.b.offered.count));
      checked += lots.length;
    }
    assert.ok(checked > 0, `${gunId}: at least one barter was compared`);
    if (gunId === M4A1) assert.equal(fractionalChecked, 42, 'the 42 fractional-count barters of the M4A1 closure items are compared too');
  }
});

test('dogtag flags agree with the English-name rule over every barter of the pinned capture', () => {
  // Production flags a dogtag ingredient by the translated NAME (language dependent); the bridge uses the
  // language-independent normalizedName. On the English capture the two must agree barter by barter.
  const nameFlag = (itemId: string) => /dogtag/i.test(world.translateItemKey(world.items.get(itemId)?.nameKey ?? ''));
  const slugFlag = (itemId: string) => /dogtag/i.test(world.items.get(itemId)?.normalizedName ?? '');
  for (const barter of world.barters) {
    for (const r of barter.requirements) assert.equal(slugFlag(r.itemId), nameFlag(r.itemId), r.itemId);
  }
  // and the bridge raises the flag on the barter that really has a dogtag ingredient
  const flagged = itemOf(fixtureForWeapon(world, M4A1).fixture, HENSOLDT).offers?.filter(o => o.kind === 'barter' && o.requiresDogtag === true);
  assert.equal(flagged?.length, 1);
});

test('fractional-count barters are mapped verbatim by default; no barter is omitted and nothing is recorded as omitted', () => {
  // barters.json lists two barters for the PMAG D-60 magazine, in this order:
  //   6abb6df4...: ref L4, 25.02 x gp-coin (avg24hPrice null, basePrice 7500)  <- fractional count
  //   6abb6e34...: peacekeeper L4, 3 x gas-mask-air-filter (avg 45322, base 10039), task-gated  <- integer count
  const { fixture, provenance } = fixtureForWeapon(world, M4A1);
  const fractional = (bartersByItem.get(PMAG_D60) ?? []).filter(b => b.requirements.some(r => !Number.isInteger(r.count)));
  assert.deepEqual(fractional.map(b => b.id), ['6abb6df4ba8a04ed5c06ac893']);
  const barters = itemOf(fixture, PMAG_D60).offers?.filter(o => o.kind === 'barter');
  assert.deepEqual(barters, [
    {
      kind: 'barter', trader: 'ref', level: 4, offeredCount: 1,
      requirements: [{ itemId: '5d235b4d86f7742e017bc88a', count: 25.02, basePrice: 7500 }],
    },
    {
      kind: 'barter', trader: 'peacekeeper', level: 4, offeredCount: 1,
      requirements: [{ itemId: '590c595c86f7747884343ad7', count: 3, avg24hPrice: 45322, basePrice: 10039 }],
    },
  ]);
  assert.equal('omitted' in provenance, false, 'the bridge no longer has an omission channel');
});

test('every raw barter of every mapped subject is mapped: nothing is left out, fractional counts included', () => {
  const { fixture } = fixtureForWeapon(world, M4A1);
  const subjects = [...fixture.items, ...(fixture.presets ?? [])];
  let rawFractional = 0;
  for (const subject of subjects) {
    const raw = bartersByItem.get(subject.id) ?? [];
    assert.equal(subject.offers?.filter(o => o.kind === 'barter').length ?? 0, raw.length, `barter count of ${subject.id}`);
    rawFractional += raw.filter(b => b.requirements.some(r => !Number.isInteger(r.count))).length;
  }
  assert.equal(rawFractional, 45, '42 fractional-count barters offer M4A1 closure items and 3 offer its presets');
});

test('a real fractional Ref barter maps its count verbatim and the oracle values it exactly (25.02 x gp-coin)', () => {
  // barters.json 6abb6df4...: ref L4, 25.02 x gp-coin for 1 x PMAG D-60. items.json: gp-coin avg24hPrice null, basePrice 7500.
  // Fraction(25.02) = 7042503917300613 / 2^48 (2^48 = 281474976710656); the double is slightly BELOW the decimal 25.02.
  //   total = 7500 x 7042503917300613 / 2^48 = 13204694844938649375 / 2^46 (7500 = 4 x 1875 cancels 2^2)
  //         = 187650 - 225 / 2^46 = 187650 - 225 / 70368744177664   (hand: 25.02 x 7500 = 187650 in decimal)
  //   lot = floor(total + 1/2) = 187650; with offeredCount 1 one unit costs the whole lot, 187650.
  const { fixture } = fixtureForWeapon(world, M4A1);
  const barter = itemOf(fixture, PMAG_D60).offers?.find(o => o.kind === 'barter' && o.trader === 'ref');
  assert.ok(barter && barter.kind === 'barter');
  assert.equal(barter.requirements[0].count, 25.02);
  assert.deepEqual(fromBinary64(barter.requirements[0].count), q(7042503917300613n, 281474976710656n));
  const resolved = offersOf(fixture, PMAG_D60).find(o => o.kind === 'barter' && o.trader === 'ref');
  assert.ok(resolved && resolved.kind === 'barter');
  assert.deepEqual(barterRequirementTotal(resolved), q(13204694844938649375n, 70368744177664n));
  assert.deepEqual(sub(q(187650), barterRequirementTotal(resolved)), q(225n, 70368744177664n));
  const request: ReferenceRequest = { weapon_id: M4A1, barter_available: true, flea_available: false, trader_levels: { ref: 4 } };
  const lot = legalOffers(offersOf(fixture, PMAG_D60), resolveRequest(fixture, request)).find(o => o.kind === 'barter' && o.trader === 'ref');
  assert.deepEqual(lot?.lotPrice, q(187650));
  assert.equal(lot?.offeredCount, 1);
  // the loyalty gate still applies to it: Ref level 3 does not unlock a level 4 barter
  const gated = resolveRequest(fixture, { ...request, trader_levels: { ref: 3 } });
  assert.equal(legalOffers(offersOf(fixture, PMAG_D60), gated).some(o => o.trader === 'ref'), false);
});

test('a second real fractional Ref barter, the only barter of its item: 7.52 x gp-coin for the EOTech EXPS3-0', () => {
  // barters.json 6abb6df8...: ref L3, 7.52 x gp-coin (basePrice 7500) for 1 x EOTech EXPS3-0 (tan).
  // Fraction(7.52) = 2116691824864133 / 2^48; total = 7500 x that = 3968797171620249375 / 2^46 = 56400 - 225 / 2^46; lot 56400.
  const { fixture } = fixtureForWeapon(world, M4A1);
  const item = itemOf(fixture, EOTECH_EXPS3_TAN);
  const barters = item.offers?.filter(o => o.kind === 'barter');
  assert.deepEqual(barters, [{
    kind: 'barter', trader: 'ref', level: 3, offeredCount: 1,
    requirements: [{ itemId: '5d235b4d86f7742e017bc88a', count: 7.52, basePrice: 7500 }],
  }]);
  const request = resolveRequest(fixture, { weapon_id: M4A1, barter_available: true, flea_available: false, trader_levels: { ref: 3 } });
  const resolved = offersOf(fixture, EOTECH_EXPS3_TAN).find(o => o.kind === 'barter');
  assert.ok(resolved && resolved.kind === 'barter');
  assert.deepEqual(barterRequirementTotal(resolved), q(3968797171620249375n, 70368744177664n));
  const lots = legalOffers(offersOf(fixture, EOTECH_EXPS3_TAN), request).filter(o => o.kind === 'barter');
  assert.deepEqual(lots.map(o => o.lotPrice), [q(56400)]);
});

test('task-gated offers are mapped as available and counted in provenance', () => {
  const { fixture, provenance } = fixtureForWeapon(world, MTS255);
  let rawGatedBarters = 0;
  let rawGatedTrader = 0;
  for (const item of fixture.items) {
    rawGatedBarters += (bartersByItem.get(item.id) ?? []).filter(b => b.taskUnlock !== null).length;
    rawGatedTrader += (world.items.get(item.id)?.buyFromTrader ?? []).filter(o => o.taskUnlock !== null).length;
  }
  assert.ok(rawGatedBarters > 0);
  assert.equal(provenance.taskGated.filter(t => t.kind === 'barter').length, rawGatedBarters);
  assert.equal(provenance.taskGated.filter(t => t.kind === 'trader').length, rawGatedTrader);
  // barters.json 6abb6e15...: skier L2, taskUnlock 669fa39c64ea11e84c0642a6, offers the 12/70 RIP ammunition.
  assert.ok(provenance.taskGated.some(t => t.kind === 'barter' && t.subjectId === RIP_AMMO && t.trader === 'skier' && t.level === 2 && t.taskUnlock === '669fa39c64ea11e84c0642a6'));
});
