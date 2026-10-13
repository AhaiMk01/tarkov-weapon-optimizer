// Acquisition rows: preset supply, owned stock, supply caps, the integer deficit surrogate with whole lots, the exact wallet
// (ADR 0002, 0008, 0009; INTERPRETATIONS 1, 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barter, gun, lookupOf, mod, slot, trader, WEAPON } from './lpFixtures';
import { solve } from './lpHarness';

const close = (actual: number, expected: number, tolerance = 1e-9): void =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
const count = (build: { installed: ReadonlyMap<string, number> } | null, id: string): number => build?.installed.get(id) ?? 0;

/** Three sibling slots all taking `a` (+10 ergonomics, 100 RUB at Prapor); preset P (1000 RUB) supplies two copies of `a`. */
const threeSlotsWithPreset = () => lookupOf(
  gun(WEAPON, { ergo: 0, slots: [slot('s1', ['a']), slot('s2', ['a']), slot('s3', ['a'])], presets: [{ id: 'P', items: [{ itemId: 'a', count: 2 }] }] }),
  ['a', mod('a', { ergo: 10 })],
);

test('preset supply q = 2: two copies ride on the preset, a third copy is paid for exactly when it is worth its price', async () => {
  // score = ergo - spend (p = 1000): two free copies are worth it, a third at 100 RUB for +10 is not.
  const pricey = await solve(threeSlotsWithPreset(), WEAPON, { ergoWeight: 1, recoilWeight: 0, priceWeight: 1000 });
  assert.equal(pricey.solution.status, 'Optimal');
  close(pricey.solution.objective, 20 - 1000);
  assert.deepEqual(pricey.build?.base, { kind: 'preset', presetId: 'P', lookupIndex: 0 });
  assert.equal(count(pricey.build, 'a'), 2);
  assert.equal(pricey.build?.spend, 1000);
  assert.equal(pricey.build?.deficits.size, 0);
  assert.deepEqual(pricey.build?.acquisition.map(o => o.source), ['preset', 'preset']);

  // score = ergo - spend / 1000: the third copy (+10 for 0.1) is worth buying.
  const cheap = await solve(threeSlotsWithPreset(), WEAPON, { ergoWeight: 1, recoilWeight: 0, priceWeight: 1 });
  close(cheap.solution.objective, 30 - 1.1);
  assert.equal(count(cheap.build, 'a'), 3);
  assert.equal(cheap.build?.spend, 1100);
  assert.equal(cheap.build?.deficits.get('a'), 1);
  assert.deepEqual(cheap.build?.acquisition.map(o => [o.instanceId, o.source, o.price]), [
    ['weapon_0/s1:a', 'preset', 0],
    ['weapon_0/s2:a', 'preset', 0],
    ['weapon_0/s3:a', 'offer', 100],
  ]);
});

test('owned stock offsets spend: owned copies are free and fill the lowest instance ids, the rest is paid', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { ergo: 0, slots: [slot('s1', ['a']), slot('s2', ['a']), slot('s3', ['a'])] }),
    ['a', mod('a', { ergo: 10 })],
  );
  const owned = { ownedItems: ['a', 'a'] };
  // p = 1000: only the two owned copies are worth installing; the paid third is not.
  const strict = await solve(lookup, WEAPON, { ergoWeight: 1, recoilWeight: 0, priceWeight: 1000, ...owned });
  close(strict.solution.objective, 20 - 5000);
  assert.equal(strict.build?.spend, 5000);
  assert.deepEqual(strict.build?.acquisition.map(o => [o.source, o.price]), [['owned', 0], ['owned', 0]]);
  // p = 0: all three are installed; the third (highest instance id) is the paid one.
  const free = await solve(lookup, WEAPON, { ergoWeight: 1, recoilWeight: 0, ...owned });
  close(free.solution.objective, 30);
  assert.equal(free.build?.spend, 5100);
  assert.deepEqual(free.build?.acquisition.map(o => [o.instanceId, o.source, o.offerSource, o.price]), [
    ['weapon_0/s1:a', 'owned', null, 0],
    ['weapon_0/s2:a', 'owned', null, 0],
    ['weapon_0/s3:a', 'offer', 'prapor', 100],
  ]);
});

test('with a zero price weight the decoded spend is the exact deficit cost, never the LP surplus', async () => {
  const lookup = lookupOf(gun(WEAPON, { slots: [slot('s1', ['a'])] }), ['a', mod('a', { ergo: 4 })]);
  // Owned stock covers the one installed copy: the LP is indifferent to buying (price weight 0), the build costs only the base.
  const { build } = await solve(lookup, WEAPON, { ergoWeight: 1, recoilWeight: 0, priceWeight: 0, ownedItems: ['a'] });
  assert.equal(build?.spend, 5000);
  assert.deepEqual(build?.purchases, []);
});

test('a standalone-inaccessible item is capped by preset supply plus owned stock, never priced', async () => {
  const build = (ownedItems: string[] = []) => solve(
    lookupOf(
      gun(WEAPON, { slots: [slot('s1', ['c']), slot('s2', ['c'])], presets: [{ id: 'P', items: [{ itemId: 'c', count: 1 }] }] }),
      ['c', mod('c', { ergo: 10, offers: [] })],
    ),
    WEAPON,
    { ergoWeight: 1, recoilWeight: 0, ownedItems },
  );
  const noStock = await build();
  assert.equal(count(noStock.build, 'c'), 1, 'the preset supplies one copy');
  assert.deepEqual(noStock.build?.base, { kind: 'preset', presetId: 'P', lookupIndex: 0 });
  assert.equal(noStock.model.templatePlans.get(1)?.supply, 'capped');
  const withStock = await build(['c']);
  assert.equal(count(withStock.build, 'c'), 2, 'one preset copy plus one owned copy');
  assert.equal(withStock.build?.spend, 1000);
});

test('a lot of three is bought whole: two units cost the lot, one unit is cheaper in cash', async () => {
  const lookup = (slots: number) => lookupOf(
    gun(WEAPON, { ergo: 0, slots: Array.from({ length: slots }, (_, i) => slot(`s${i + 1}`, ['a'])) }),
    ['a', mod('a', { ergo: 10, offers: [trader('prapor', 1, 200), barter('mechanic', 1, 300, false, 3)] })],
  );
  const market = { ergoWeight: 1, recoilWeight: 0, barterAvailable: true };
  // Two units: cash is 400, one lot of three is 300 and delivers a spare unit.
  const two = await solve(lookup(2), WEAPON, market);
  assert.equal(two.build?.spend, 5300);
  assert.deepEqual(two.build?.purchases, [{ itemId: 'a', deficit: 2, cost: 300, lots: [{ offerIndex: 1, source: 'barter:mechanic', lotSize: 3, price: 300, used: 2 }] }]);
  assert.deepEqual(two.build?.acquisition.map(o => [o.source, o.offerSource, o.price]), [['offer', 'barter:mechanic', 300], ['offer', 'barter:mechanic', 0]]);
  // One unit: a cash offer at 200 undercuts the whole lot at 300.
  const one = await solve(lookup(1), WEAPON, market);
  assert.equal(one.build?.spend, 5200);
  assert.equal(one.build?.purchases[0].lots[0].source, 'prapor');
});

test('the wallet is hard: max_price at the exact spend admits the build, one RUB below drops the part, below the base is infeasible', async () => {
  const lookup = lookupOf(gun(WEAPON, { ergo: 0, slots: [slot('s1', ['a'])] }), ['a', mod('a', { ergo: 10 })]);
  const at = await solve(lookup, WEAPON, { ergoWeight: 1, recoilWeight: 0, maxPrice: 5100 });
  assert.equal(count(at.build, 'a'), 1);
  const below = await solve(lookup, WEAPON, { ergoWeight: 1, recoilWeight: 0, maxPrice: 5099 });
  assert.equal(count(below.build, 'a'), 0);
  assert.equal(below.build?.spend, 5000);
  const none = await solve(lookup, WEAPON, { ergoWeight: 1, recoilWeight: 0, maxPrice: 4999 });
  assert.equal(none.solution.status, 'Infeasible');
});

test('each template with a legal offer gets a bounded surrogate and lot columns; a capped one gets a supply row and no surrogate', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['a', 'c']), slot('s2', ['a', 'c'])], presets: [{ id: 'P', items: [{ itemId: 'c', count: 1 }] }] }),
    ['a', mod('a', { ergo: 1 })],
    ['c', mod('c', { ergo: 1, offers: [] })],
  );
  const { model } = await solve(lookup, WEAPON, { ownedItems: ['a'] });
  const a = model.templatePlans.get(1);
  assert.equal(a?.supply, 'standalone');
  assert.equal(a?.surrogateMax, 1, 'two active copies minus one owned');
  assert.equal(a?.lots[0].maxLots, 1);
  const c = model.templatePlans.get(2);
  assert.equal(c?.supply, 'capped');
  assert.equal(c?.surrogateMax, null);
  assert.equal(model.columns.surrogate(2), null);
  assert.ok(model.lp.includes('supcap_2'));
  assert.ok(!model.lp.includes('sur_2'));
});
