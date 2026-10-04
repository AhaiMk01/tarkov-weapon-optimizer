// Seam: toFixture.ts offers -- trader offers, the synthesized flea offer and barters of the mapped fixture.
//
// Expected values are read off the pinned raw documents by hand (cited per test) or recomputed by the
// independent reference reader (referenceBarterOffer); they are never taken from the bridge's own output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  legalOffers, q, resolveFixture, resolveRequest,
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

test('offeredCount > 1 survives and the oracle prices per unit as the rounded lot / offeredCount', () => {
  // barters.json: skier L2 (task-gated) gives 5 x 12/70 RIP for 1 x T-Shaped Plug.
  // T-Shaped Plug: avg24hPrice 23962 (basePrice 2481) -> lot total 23962 (avg ?? base), lot price 23962, unit 23962/5.
  const { fixture } = fixtureForWeapon(world, MTS255);
  const barter = itemOf(fixture, RIP_AMMO).offers?.find(o => o.kind === 'barter');
  assert.ok(barter && barter.kind === 'barter');
  assert.equal(barter.offeredCount, 5);
  assert.equal(barter.requirements[0].avg24hPrice, 23962);
  const request: ReferenceRequest = { weapon_id: MTS255, barter_available: true, flea_available: false, trader_levels: { skier: 4, jaeger: 0 } };
  const fromBarter = legalOffers(offersOf(fixture, RIP_AMMO), resolveRequest(fixture, request)).find(o => o.kind === 'barter');
  assert.deepEqual(fromBarter?.lotPrice, q(23962));
  assert.deepEqual(fromBarter?.unitPrice, q(23962, 5));
});

test('every mapped barter prices exactly like the reference reader says (lot = floor(total + 1/2)), offeredCount carried', () => {
  for (const gunId of [M4A1, MTS255, AK74N]) {
    const { fixture } = fixtureForWeapon(world, gunId);
    const request = resolveRequest(fixture, {
      weapon_id: gunId, barter_available: true, flea_available: false,
      trader_levels: { prapor: 4, skier: 4, peacekeeper: 4, mechanic: 4, jaeger: 4, ref: 4 },
    });
    let checked = 0;
    for (const item of fixture.items) {
      const expected = (bartersByItem.get(item.id) ?? [])
        .filter(b => b.requirements.every(r => Number.isInteger(r.count)))
        .map(b => ({ b, offer: referenceBarterOffer(world, b) }))
        .filter(x => x.offer !== null);
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

test('fractional-count barters are omitted by default with a provenance record, and kept verbatim with the include option', () => {
  // barters.json lists two barters for the PMAG D-60 magazine, in this order:
  //   6abb6df4...: ref L4, 25.02 x gp-coin (avg24hPrice null, basePrice 7500)  <- fractional count
  //   6abb6e34...: peacekeeper L4, 3 x gas-mask-air-filter (avg 45322, base 10039), task-gated  <- integer count
  const omitted = fixtureForWeapon(world, M4A1);
  const kept = fixtureForWeapon(world, M4A1, { fractionalBarters: 'include' });
  const fractional = (bartersByItem.get(PMAG_D60) ?? []).filter(b => b.requirements.some(r => !Number.isInteger(r.count)));
  assert.deepEqual(fractional.map(b => b.id), ['6abb6df4ba8a04ed5c06ac893']);
  assert.deepEqual(
    itemOf(omitted.fixture, PMAG_D60).offers,
    [{
      kind: 'barter', trader: 'peacekeeper', level: 4, offeredCount: 1,
      requirements: [{ itemId: '590c595c86f7747884343ad7', count: 3, avg24hPrice: 45322, basePrice: 10039 }],
    }],
  );
  assert.deepEqual(
    omitted.provenance.omitted.filter(o => o.subjectId === PMAG_D60),
    [{ kind: 'barter', barterId: '6abb6df4ba8a04ed5c06ac893', subjectId: PMAG_D60, reason: 'fractional-ingredient-count', ingredientCounts: [25.02] }],
  );
  const barters = itemOf(kept.fixture, PMAG_D60).offers?.filter(o => o.kind === 'barter');
  assert.equal(barters?.length, 2);
  assert.deepEqual(barters?.[0], {
    kind: 'barter', trader: 'ref', level: 4, offeredCount: 1,
    requirements: [{ itemId: '5d235b4d86f7742e017bc88a', count: 25.02, basePrice: 7500 }],
  });
  assert.equal(kept.provenance.omitted.length, 0);
});

test('task-gated offers are mapped as available and counted in provenance', () => {
  const { fixture, provenance } = fixtureForWeapon(world, MTS255);
  let rawGatedBarters = 0;
  let rawGatedTrader = 0;
  for (const item of fixture.items) {
    rawGatedBarters += (bartersByItem.get(item.id) ?? []).filter(b => b.taskUnlock !== null && b.requirements.every(r => Number.isInteger(r.count))).length;
    rawGatedTrader += (world.items.get(item.id)?.buyFromTrader ?? []).filter(o => o.taskUnlock !== null).length;
  }
  assert.ok(rawGatedBarters > 0);
  assert.equal(provenance.taskGated.filter(t => t.kind === 'barter').length, rawGatedBarters);
  assert.equal(provenance.taskGated.filter(t => t.kind === 'trader').length, rawGatedTrader);
  // barters.json 6abb6e15...: skier L2, taskUnlock 669fa39c64ea11e84c0642a6, offers the 12/70 RIP ammunition.
  assert.ok(provenance.taskGated.some(t => t.kind === 'barter' && t.subjectId === RIP_AMMO && t.trader === 'skier' && t.level === 2 && t.taskUnlock === '669fa39c64ea11e84c0642a6'));
});
