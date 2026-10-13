// Real-data oracle cases (Stage 1): the bridge turns pinned raw documents into micro-domains and the exact-rational
// oracle enumerates them exhaustively. Every expectation below is DERIVED BY HAND from the raw documents (the item
// weights, slot allowlists, offers and preset counts cited in comments) or from Python `fractions.Fraction` over the
// raw binary64 values; none is a snapshot of oracle output.
//
//   (a) the 0.0155 kg ELCAN mounting plate: its exact binary64 weight is visible in exact weight statistics and
//       decides a max_weight boundary by exactly 2^-54 kg
//   (b) a real preset with a count-2 mod component: two copies install at 0 RUB marginal cost, a third is paid once
//   (c) a real self-conflicting item: the copy cap holds (hybrid: a real parent gains a hypothetical second slot)
//   (d) a real weapon whose naked receiver is locked by trader_levels while a preset base stays accessible
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enumerateBuilds, q, runOracle, toString, validateReference,
  type AcceptedBuild, type BaseChoice, type ReferenceFixture, type ReferenceRequest,
} from '../oracle/index';
import { loadPinnedWorld } from '../source/pinnedWorld';
import { fixtureForWeapon } from './toFixture';
import { sliceFixture } from './slice';

const { world } = loadPinnedWorld('en');

const itemCount = (b: AcceptedBuild, itemId: string) => b.build.placements.filter(p => p.itemId === itemId).length;
const sortedBy = <T>(xs: T[], key: (x: T) => number) => [...xs].sort((a, b) => key(a) - key(b));

// =============================================================================================================
// (a) the 0.0155 kg plate, exact weight statistics
// =============================================================================================================
// Receiver: Colt M4A1 (5447a9cd...), weight 0.75. Micro-domain = the mods of the real default factory preset
// 5af08cf8... (a valid, conflict-free build) minus its optional parts, plus the ELCAN SpecterDR scope and its plate.
//   required chain (every one is a member of that preset):
//     grip 55d4b996 (0.08)  upper receiver 55d355e6 (0.27)  barrel 55d3632e 14.5in (0.509)  gas block 5ae30e79 (0.15)
//     handguard 5ae30db8 (0.193)  buffer tube 5649be88 (0.162)  charging handle 55d44fd1 (0.035)
//   optional: ELCAN scope 57ac965c (0.64) in the upper receiver's mod_scope, plate 688b54a1 (0.0155) in the scope's mod_mount.
// Raw weights are the JSON tokens above; their binary64 values are not the decimals, so exact sums differ from decimal sums.
const M4A1 = '5447a9cd4bdc2dbd208b4567';
const PLATE = '688b54a11cef2a61d005273b';
const SCOPE = '57ac965c24597706be5f975c';
const M4A1_SKELETON = [
  '55d4b9964bdc2d1d4e8b456e', '55d355e64bdc2d962f8b4569', '55d3632e4bdc2d972f8b4569', '5ae30e795acfc408fb139a0b',
  '5ae30db85acfc408fb139a05', '5649be884bdc2d79388b4577', '55d44fd14bdc2d962f8b456e',
];

function plateDomain(): ReferenceFixture {
  const { fixture } = sliceFixture(fixtureForWeapon(world, M4A1).fixture, { keepItemIds: [...M4A1_SKELETON, SCOPE, PLATE], keepPresetIds: [] });
  return fixture;
}

test('(a) three builds, and the exact weights carry the plate as its exact binary64 value', () => {
  const fixture = plateDomain();
  const result = runOracle(fixture, { weapon_id: M4A1 });
  // naked base only (presets dropped); the scope is optional and the plate hangs below it: none / scope / scope + plate.
  assert.equal(result.complete, true);
  assert.equal(result.builds.length, 3);
  const [none, scope, full] = sortedBy(result.builds, b => b.build.placements.length);
  assert.deepEqual([none, scope, full].map(b => b.build.placements.length), [7, 8, 9]);
  assert.equal(itemCount(full, PLATE), 1);
  assert.equal(itemCount(scope, PLATE), 0);

  // Python: sum(Fraction(x) for x in (0.75, 0.08, 0.27, 0.509, 0.15, 0.193, 0.162, 0.035))
  assert.deepEqual(none.stats.weight, { n: 154851769587507137n, d: 72057594037927936n });
  // ... + Fraction(0.64)
  assert.deepEqual(scope.stats.weight, { n: 200968629771781017n, d: 72057594037927936n });
  // ... + Fraction(0.0155): 50521380619842225 / 2^54
  assert.deepEqual(full.stats.weight, { n: 50521380619842225n, d: 18014398509481984n });
  // The marginal weight of the plate is exactly Fraction(0.0155) = 1116892707587883 / 2^56, not 31/2000.
  // full - scope = (50521380619842225 x 4 - 200968629771781017) / 2^56 = 1116892707587883 / 2^56
  assert.equal(full.stats.weight.n * 4n - scope.stats.weight.n, 1116892707587883n);
  assert.notDeepEqual(full.stats.weight, { n: 5609n, d: 2000n }); // the decimal sum 2.8045 = 5609/2000 is not the exact total
});

test('(a) max_weight 2.8045 rejects the plate build by exactly 2^-54 kg: exact arithmetic, not decimal', () => {
  const fixture = plateDomain();
  // Python: Fraction(50521380619842225, 2**54) - Fraction(2.8045) == Fraction(1, 2**54)  (> 0): the full build is over the cap.
  // Decimal arithmetic would call 2.8045 <= 2.8045 and accept it.
  const capped = runOracle(fixture, { weapon_id: M4A1, max_weight: 2.8045 });
  assert.deepEqual(sortedBy(capped.builds, b => b.build.placements.length).map(b => b.build.placements.length), [7, 8]);
  const unconstrained = runOracle(fixture, { weapon_id: M4A1 });
  const full = unconstrained.builds.find(b => itemCount(b, PLATE) === 1);
  assert.ok(full);
  const verdict = validateReference(fixture, { weapon_id: M4A1, max_weight: 2.8045 }, full.build);
  assert.deepEqual(verdict.violations.map(v => v.code), ['MAX_WEIGHT_EXCEEDED']);
  // Python: Fraction(200968629771781017, 2**56) - Fraction(2.789) == -7/2**56 (< 0): the scope-only build fits under 2.789 ...
  const scopeCap = runOracle(fixture, { weapon_id: M4A1, max_weight: 2.789 });
  assert.deepEqual(sortedBy(scopeCap.builds, b => b.build.placements.length).map(b => b.build.placements.length), [7, 8]);
  // ... and one binary64 step above the exact total of the plate build admits it again.
  assert.equal(runOracle(fixture, { weapon_id: M4A1, max_weight: 2.8045000000000004 }).builds.length, 3);
});

// =============================================================================================================
// (b) multi-copy preset supply: two free copies, a third paid
// =============================================================================================================
// Receiver SV-98 (55801eed...). Real preset 629766c1...: components include "cnc-guns-keymod-2-inch-rail"
// 623c2f65... with count 2. Offers read from items.json:
//   preset: jaeger L3 priceRUB 111746; flea avg24hPrice = lastLowPrice = 99999, minLevelForFlea 20
//   rail:   jaeger L3 priceRUB 1322 (RUB); flea 25000, minLevelForFlea 0
//   the SV-98 itself has no trader offer, so the naked receiver is never accessible.
// Micro-domain: chassis 623b2e9d (required mod_stock) -> grip 623c3be0 (required in the chassis) and the keymod handguard
// 623c3c1f; the handguard has three slots mod_mount_000/001/002, each allowing the 2-inch rail. All four are preset
// components (chassis 1, grip 1, handguard 1, rail 2).
const SV98 = '55801eed4bdc2d89578b4588';
const SV98_PRESET = '629766c15c9e3c392f7c2db0';
const RAIL = '623c2f652febb22c2777d8d7';
const SV98_KEEP = ['623b2e9d11c3296b440d1638', '623c3be0484b5003161840dc', '623c3c1f37b4b31470357737', RAIL];

function railDomain(): ReferenceFixture {
  return sliceFixture(fixtureForWeapon(world, SV98).fixture, { keepItemIds: SV98_KEEP, keepPresetIds: [SV98_PRESET] }).fixture;
}

const presetBase: BaseChoice = { kind: 'preset', presetId: SV98_PRESET };
const railsOf = (b: AcceptedBuild) => itemCount(b, RAIL);

test('(b) the preset is the only accessible base and nine rooted builds exist (no handguard; handguard with 0..3 rails)', () => {
  const fixture = railDomain();
  const request: ReferenceRequest = { weapon_id: SV98, flea_available: false };
  assert.deepEqual(enumerateBuilds(fixture, request).bases, [presetBase]);
  const result = runOracle(fixture, request);
  assert.equal(result.complete, true);
  // handguard absent: 1 build; present: each of three rail slots filled or empty = 2^3 = 8 builds; 9 in all.
  assert.equal(result.builds.length, 9);
  // rails 0: {no handguard, handguard+0}; rails 1: 3 slots; rails 2: 3 pairs; rails 3: 1
  const byRails = [0, 1, 2, 3].map(k => result.builds.filter(b => railsOf(b) === k).length);
  assert.deepEqual(byRails, [2, 3, 3, 1]);
  // five distinct projections: no handguard, and handguard with 0, 1, 2, 3 rails
  assert.equal(result.projectionKeys.length, 5);
});

test('(b) the first two rails cost nothing beyond the preset; the third is paid once at the rail offer (flea off)', () => {
  const fixture = railDomain();
  const result = runOracle(fixture, { weapon_id: SV98, flea_available: false });
  for (const b of result.builds) {
    // spend = preset 111746 + max(0, rails - 2) x 1322   (chassis, grip, handguard are preset supply, 1 each)
    const expected = 111746 + Math.max(0, railsOf(b) - 2) * 1322;
    assert.deepEqual(b.stats.spend, q(expected), `rails=${railsOf(b)}`);
    assert.equal(b.stats.acquisition.base.price?.n, 111746n);
  }
  const three = result.builds.find(b => railsOf(b) === 3);
  assert.ok(three);
  assert.deepEqual(three.stats.spend, q(113068)); // 111746 + 1322
  assert.deepEqual(three.stats.acquisition.deficits.get(RAIL), 1); // d = max(0, 3 - 2 - 0)
  const sources = three.stats.acquisition.occurrences.filter(o => o.itemId === RAIL).map(o => o.source.kind).sort();
  assert.deepEqual(sources, ['offer', 'preset', 'preset']);
  const two = result.builds.find(b => railsOf(b) === 2);
  assert.ok(two);
  assert.equal(two.stats.acquisition.deficits.has(RAIL), false);
});

test('(b) a budget between the two prices separates the third copy exactly', () => {
  const fixture = railDomain();
  const rails = (maxPrice: number) => runOracle(fixture, { weapon_id: SV98, flea_available: false, max_price: maxPrice }).builds.map(railsOf).sort();
  assert.deepEqual(rails(113068), [0, 0, 1, 1, 1, 2, 2, 2, 3]); // 111746 + 1322 = 113068 fits exactly
  assert.deepEqual(rails(113067), [0, 0, 1, 1, 1, 2, 2, 2]); // one ruble less: the third rail is out
  assert.equal(runOracle(fixture, { weapon_id: SV98, flea_available: false, max_price: 111745 }).empty, true); // below the preset itself
});

test('(b) flea prices and the flea player-level gate move the base price, never the marginal rail price', () => {
  const fixture = railDomain();
  const spendOf = (request: Partial<ReferenceRequest>, rails: number) =>
    runOracle(fixture, { weapon_id: SV98, ...request }).builds.find(b => railsOf(b) === rails)?.stats.spend;
  // flea on, no player level: preset base min(jaeger 111746, flea 99999) = 99999; third rail min(1322, 25000) = 1322
  assert.deepEqual(spendOf({}, 2), q(99999));
  assert.deepEqual(spendOf({}, 3), q(99999 + 1322));
  // the preset flea offer needs player level 20 (items.json minLevelForFlea): 19 -> trader price, 20 -> flea price
  assert.deepEqual(spendOf({ player_level: 19 }, 2), q(111746));
  assert.deepEqual(spendOf({ player_level: 20 }, 2), q(99999));
  // with jaeger disabled and flea off the preset has no legal offer at all: no base, no build, proved empty
  const locked = runOracle(fixture, { weapon_id: SV98, flea_available: false, trader_levels: { jaeger: 0 } });
  assert.equal(locked.empty, true);
});

// =============================================================================================================
// (c) a real self-conflicting item: the copy cap
// =============================================================================================================
// items.json: "ar-15-lead-star-arms-ravage-stock" 6984b82c... lists ITSELF among 55 conflictingItems (3 such items exist).
// It has no trader offer and is noFlea, so it is acquirable only from stock: owned_items: [S, S] makes two copies legal
// to HOLD, leaving the self-conflict as the only barrier to installing both. In the M4A1 closure it is allowed in
// exactly one slot (buffer tube 5649be88, mod_stock_003), and in the pinned capture NO real gun can seat two copies
// (proved below), so the cap is vacuous on real structure. The hybrid gives the real buffer tube a second slot that also
// allows the real item, to show the real self-conflict entry is what binds.
const STOCK = '6984b82c5aab442620032fe8';
const TUBE = '5649be884bdc2d79388b4577';
const STOCK_KEEP = [...M4A1_SKELETON, STOCK];
// (the skeleton above has no pairwise conflict: checked against items.json, S conflicts with 55 other stocks only)

function stockDomain(): ReferenceFixture {
  return sliceFixture(fixtureForWeapon(world, M4A1).fixture, { keepItemIds: STOCK_KEEP, keepPresetIds: [] }).fixture;
}

const owned2: ReferenceRequest = { weapon_id: M4A1, owned_items: [STOCK, STOCK] };

test('(c) real structure: the stock fits one slot, so the self-conflict listing is present but the cap cannot bind', () => {
  const fixture = stockDomain();
  assert.ok(fixture.items.find(i => i.id === STOCK)?.conflictingItemIds?.includes(STOCK));
  const result = runOracle(fixture, owned2);
  assert.equal(result.complete, true);
  // one optional slot, one candidate: stock absent or present = 2 builds, 2 projections
  assert.deepEqual(result.builds.map(b => itemCount(b, STOCK)).sort(), [0, 1]);
  assert.equal(result.projectionKeys.length, 2);
  // without stock in the stash the stock cannot be acquired at all (no offer): only the empty-slot build survives
  assert.deepEqual(runOracle(fixture, { weapon_id: M4A1 }).builds.map(b => itemCount(b, STOCK)), [0]);
});

function hybrid(selfConflict: boolean): ReferenceFixture {
  const fixture = structuredClone(stockDomain());
  const tube = fixture.items.find(i => i.id === TUBE);
  const stock = fixture.items.find(i => i.id === STOCK);
  assert.ok(tube?.slots && stock);
  tube.slots.push({ id: 'hybrid-second-stock-slot', allowedItemIds: [STOCK] }); // hypothetical: no real parent has one
  if (!selfConflict) stock.conflictingItemIds = (stock.conflictingItemIds ?? []).filter(id => id !== STOCK);
  return fixture;
}

test('(c) hybrid: with two slots and two owned copies the real self-conflict still caps the item at one copy', () => {
  const fixture = hybrid(true);
  const result = runOracle(fixture, owned2);
  // slots 003 and hybrid, each optional: 4 trees (none, 003, hybrid, both). Both = two copies = SELF_CONFLICT_COPY_CAP.
  assert.deepEqual(result.builds.map(b => itemCount(b, STOCK)).sort(), [0, 1, 1]);
  assert.equal(result.projectionKeys.length, 2); // stock x0 and stock x1
  const trees = enumerateBuilds(fixture, owned2).builds;
  assert.equal(trees.length, 4);
  const both = trees.find(b => b.placements.filter(p => p.itemId === STOCK).length === 2);
  assert.ok(both);
  assert.deepEqual(validateReference(fixture, owned2, both).violations.map(v => v.code), ['SELF_CONFLICT_COPY_CAP']);
});

test('(c) control: removing the self-conflict entry admits the second copy, so the entry is the binding constraint', () => {
  const fixture = hybrid(false);
  const result = runOracle(fixture, owned2);
  assert.deepEqual(result.builds.map(b => itemCount(b, STOCK)).sort(), [0, 1, 1, 2]);
  assert.equal(result.projectionKeys.length, 3);
  // and with a single owned copy the second is capped by stock, not by the self-conflict
  const single = runOracle(fixture, { weapon_id: M4A1, owned_items: [STOCK] });
  assert.deepEqual(single.builds.map(b => itemCount(b, STOCK)).sort(), [0, 1, 1]);
});

test('(c) no real gun of the pinned capture can seat two copies of any self-conflicting item (the cap is vacuous on real data)', () => {
  const selfConflicting = [...world.items.values()].filter(i => i.conflictingItemIds.includes(i.id)).map(i => i.id);
  assert.equal(selfConflicting.length, 3);
  const guns = [...world.items.values()].filter(i => i.types.includes('gun'));
  let reachableOnSomeGun = 0;
  for (const gun of guns) {
    const { fixture } = fixtureForWeapon(world, gun.id);
    const byId = new Map(fixture.items.map(i => [i.id, i]));
    for (const target of selfConflicting) {
      // most copies one rooted build can hold: sum over slots of the best single choice, recursing; templates never repeat
      // along a root path, and the closure is a DAG, so a per-template memo is exact.
      const memo = new Map<string, number>();
      const most = (slots: { allowedItemIds: string[] }[] | undefined, path: ReadonlySet<string>): number => {
        let total = 0;
        for (const slot of slots ?? []) {
          let best = 0;
          for (const id of slot.allowedItemIds) {
            if (path.has(id)) continue;
            let below = memo.get(id);
            if (below === undefined) {
              below = most(byId.get(id)?.slots, new Set([...path, id]));
              memo.set(id, below);
            }
            best = Math.max(best, (id === target ? 1 : 0) + below);
          }
          total += best;
        }
        return total;
      };
      const copies = most(fixture.weapons[0].slots, new Set([gun.id]));
      assert.ok(copies <= 1, `${gun.normalizedName} could seat ${copies} copies of ${target}`);
      if (copies === 1) reachableOnSomeGun++;
    }
  }
  assert.ok(reachableOnSomeGun > 0);
});

// =============================================================================================================
// (d) naked receiver locked by trader_levels, preset base accessible
// =============================================================================================================
// Receiver AK-74N (5644bd2b...). items.json: naked offer mechanic L2 priceRUB 28934. Preset 5841474424597759ba49be91:
// prapor L2 priceRUB 44791; flea avg24hPrice 43913 (lastLowPrice 28450 is ignored), minLevelForFlea 25.
// Micro-domain = the eight mods of that preset (gas tube -> required handguard; required pistol grip; optional muzzle
// brake, dust cover, rear sight, stock, magazine): 2^5 = 32 builds per base. Every kept item is a preset component.
const AK74N = '5644bd2b4bdc2d3b4c8b4572';
const AK_PRESET = '5841474424597759ba49be91';
const AK_KEEP = [
  '59c6633186f7740cf0493bb9', '5648b0744bdc2d363b8b4578', '5649aa744bdc2ded0b8b457e', '5649ad3f4bdc2df8348b4585',
  '5649af094bdc2df8348b4586', '5649b0544bdc2d1b2b8b458a', '5649b1c04bdc2d16268b457c', '564ca99c4bdc2d16268b4589',
];

function akDomain(): ReferenceFixture {
  return sliceFixture(fixtureForWeapon(world, AK74N).fixture, { keepItemIds: AK_KEEP, keepPresetIds: [AK_PRESET] }).fixture;
}

const akPreset: BaseChoice = { kind: 'preset', presetId: AK_PRESET };

test('(d) with the default trader levels both bases are accessible', () => {
  const bases = enumerateBuilds(akDomain(), { weapon_id: AK74N, flea_available: false }).bases;
  assert.deepEqual(bases, [{ kind: 'naked' }, akPreset]);
});

test('(d) mechanic disabled: only the preset base remains, every build uses it, at exactly the preset price', () => {
  const fixture = akDomain();
  const request: ReferenceRequest = { weapon_id: AK74N, flea_available: false, trader_levels: { mechanic: 0 } };
  assert.deepEqual(enumerateBuilds(fixture, request).bases, [akPreset]);
  const result = runOracle(fixture, request);
  assert.equal(result.complete, true);
  assert.equal(result.builds.length, 32);
  for (const b of result.builds) {
    assert.deepEqual(b.build.base, akPreset);
    // all kept items are preset components (count 1 each), so nothing is bought: spend = prapor L2 priceRUB
    assert.deepEqual(b.stats.spend, q(44791));
    assert.equal(b.stats.acquisition.modSpend.n, 0n);
  }
  assert.equal(new Set(result.projectionKeys.map(k => JSON.parse(k)[0][0])).size, 1);
});

test('(d) the budget view: a 40000 RUB cap is met only through the naked receiver, which the trader lock removes', () => {
  const fixture = akDomain();
  const cap = { weapon_id: AK74N, flea_available: false, max_price: 40000 };
  // mechanic open: the cheapest build is the naked receiver plus only the REQUIRED parts bought from traders:
  //   28934 (mechanic L2) + gas tube 2592 (mechanic L1) + handguard 1090 (prapor L1) + pistol grip 1088 (prapor L1) = 33704
  const open = runOracle(fixture, cap);
  assert.ok(open.builds.length > 0);
  assert.ok(open.builds.every(b => b.build.base.kind === 'naked')); // the preset costs 44791 > 40000
  assert.deepEqual(
    open.builds.map(b => b.stats.spend).reduce((lo, s) => (s.n * lo.d < lo.n * s.d ? s : lo)),
    q(33704),
  );
  // mechanic locked: the only base is the preset at 44791 > 40000, so the domain is proved empty
  const locked = runOracle(fixture, { ...cap, trader_levels: { mechanic: 0 } });
  assert.equal(locked.empty, true);
});

test('(d) the preset flea offer joins the price when the player level reaches 25 (the raw minLevelForFlea)', () => {
  const fixture = akDomain();
  const spend = (level: number | null): string => {
    const request: ReferenceRequest = { weapon_id: AK74N, trader_levels: { mechanic: 0 }, ...(level === null ? {} : { player_level: level }) };
    const prices = new Set(runOracle(fixture, request).builds.map(b => toString(b.stats.spend)));
    assert.equal(prices.size, 1); // every build is preset-supplied, so one price for all 32
    return [...prices][0];
  };
  assert.equal(spend(24), '44791'); // flea gated off (24 < 25): prapor L2
  assert.equal(spend(25), '43913'); // flea avg24hPrice 43913 < 44791
  assert.equal(spend(null), '43913'); // no player-level gating
  // projection identity: every accepted build keys to the preset base
  const keys = runOracle(fixture, { weapon_id: AK74N, trader_levels: { mechanic: 0 } }).projectionKeys;
  assert.ok(keys.every(k => k.startsWith(`[["preset","${AK_PRESET}"]`)));
  assert.equal(keys.length, 32);
});
