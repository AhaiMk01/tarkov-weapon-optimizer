// Subproblem-domain masks (ADR 0012 Tier 2, ADR 0002, ADR 0008, ADR 0013 section 4A): filters, availability, accessible bases,
// fixed point over impossible owners and rootedness, stable masks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  InactiveReason, PhysicalModelError, prepareSubproblemDomain, preparePhysicalWeapon,
  type PhysicalBlueprint, type SubproblemDomain, type SubproblemRequest,
} from '../../src/solver/physical';
import type { ItemLookup } from '../../src/solver/types';
import { barter, flea, gun, lookupOf, mod, slot, trader, WEAPON } from './fixtures';

function prepare(lookup: ItemLookup, request: SubproblemRequest = {}): { bp: PhysicalBlueprint; domain: SubproblemDomain } {
  const bp = preparePhysicalWeapon(lookup, WEAPON);
  return { bp, domain: prepareSubproblemDomain(bp, lookup, request) };
}

const idOf = (bp: PhysicalBlueprint, instanceId: string): number => {
  const v = bp.occurrenceByInstanceId(instanceId);
  assert.ok(v >= 0, `no occurrence ${instanceId}`);
  return v;
};

/** Instance ids of every active item occurrence, in occurrence order. */
const activeIds = (bp: PhysicalBlueprint, domain: SubproblemDomain): string[] => {
  const out: string[] = [];
  for (let v = 1; v < bp.occurrenceCount; v++) if (domain.occActive[v]) out.push(bp.instanceId(v));
  return out;
};

const reasonOf = (bp: PhysicalBlueprint, domain: SubproblemDomain, instanceId: string): number => domain.occInactiveReason[idOf(bp, instanceId)];

// ---------------------------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------------------------

test('excluding an item masks every occurrence of its template and leaves the indexes untouched', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('a', ['m1', 'm2']), slot('b', ['m1'])] }),
    ['m1', mod('m1')],
    ['m2', mod('m2')],
  );
  const { bp, domain } = prepare(lookup, { excludeItems: ['m1'] });
  assert.equal(domain.occActive.length, bp.occurrenceCount, 'masks are over the blueprint indexes, never compacted');
  assert.deepEqual(activeIds(bp, domain), ['weapon_0/a:m2']);
  assert.equal(reasonOf(bp, domain, 'weapon_0/a:m1'), InactiveReason.USER_EXCLUDED);
  assert.equal(reasonOf(bp, domain, 'weapon_0/b:m1'), InactiveReason.USER_EXCLUDED);
  assert.equal(domain.empty, false);
  assert.equal(domain.templateActiveCount[bp.templateIndexOf('m1')], 0);
  assert.equal(domain.templateActiveCount[bp.templateIndexOf('m2')], 1);
});

test('category exclusion matches the whole category chain, own category or any ancestor', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s', ['own', 'viaParent', 'viaRoot', 'other'])] }),
    ['own', mod('own', { categories: ['leaf', 'branch', 'root'] })],
    ['viaParent', mod('viaParent', { categories: ['sibling', 'branch', 'root'] })],
    ['viaRoot', mod('viaRoot', { categories: ['cousin', 'twig', 'root'] })],
    ['other', mod('other', { categories: ['elsewhere', 'trunk'] })],
  );
  const active = (excludeCategories: string[]) => {
    const { bp, domain } = prepare(lookup, { excludeCategories });
    return activeIds(bp, domain).map(id => id.split(':')[1]);
  };
  assert.deepEqual(active(['leaf']), ['viaParent', 'viaRoot', 'other'], 'own category');
  assert.deepEqual(active(['branch']), ['viaRoot', 'other'], 'a parent category bans every descendant');
  assert.deepEqual(active(['root']), ['other'], 'the root category');
  assert.deepEqual(active(['unrelated']), ['own', 'viaParent', 'viaRoot', 'other']);
});

// ---------------------------------------------------------------------------------------------
// Availability: legal standalone offers
// ---------------------------------------------------------------------------------------------

const offersOf = (domain: SubproblemDomain, bp: PhysicalBlueprint, id: string): number[] => [...domain.templates[bp.templateIndexOf(id)].standaloneOffers];

test('trader offers are legal by loyalty level; level 0 disables a trader; a missing trader defaults to level 4', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s', ['m'])] }),
    ['m', mod('m', { offers: [trader('prapor', 3, 300), trader('skier', 1, 100), trader('ragman', 4, 400), trader('ragman', 5, 500)] })],
  );
  const legal = (traderLevels: Record<string, number> | null) => {
    const { bp, domain } = prepare(lookup, { traderLevels });
    return offersOf(domain, bp, 'm');
  };
  assert.deepEqual(legal({ prapor: 3, skier: 1 }), [0, 1, 2], 'exactly the required levels; ragman is absent and defaults to 4');
  assert.deepEqual(legal({ prapor: 2, skier: 4 }), [1, 2]);
  assert.deepEqual(legal({ prapor: 4, skier: 0 }), [0, 2], 'level 0 disables the trader, level-1 offer included');
  assert.deepEqual(legal(null), [0, 1, 2], 'no levels at all: every trader defaults to 4');
  assert.deepEqual(legal({ ragman: 0 }), [0, 1], 'a disabled trader outside the default set');
});

test('flea offers are gated by the flea flag and, per offer, by the player level', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s', ['m'])] }),
    ['m', mod('m', { offers: [flea(500), trader('prapor', 1, 900)], fleaMinLevel: 20 })],
  );
  const legal = (request: SubproblemRequest) => {
    const { bp, domain } = prepare(lookup, request);
    return offersOf(domain, bp, 'm');
  };
  assert.deepEqual(legal({}), [0, 1], 'flea on by default, no player level means no flea gating');
  assert.deepEqual(legal({ fleaAvailable: false }), [1]);
  assert.deepEqual(legal({ playerLevel: 19 }), [1]);
  assert.deepEqual(legal({ playerLevel: 20 }), [0, 1]);
  assert.deepEqual(legal({ playerLevel: 15, fleaAvailable: false }), [1]);
});

test('barters need the barter flag; dogtag barters can be excluded; trader level gates them like cash offers', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s', ['m'])] }),
    ['m', mod('m', { offers: [barter('ref', 2, 700), barter('prapor', 1, 650, true), trader('skier', 1, 800)] })],
  );
  const legal = (request: SubproblemRequest) => {
    const { bp, domain } = prepare(lookup, request);
    return offersOf(domain, bp, 'm');
  };
  assert.deepEqual(legal({}), [2], 'barters are off by default');
  assert.deepEqual(legal({ barterAvailable: true }), [0, 1, 2]);
  assert.deepEqual(legal({ barterAvailable: true, barterExcludeDogtags: true }), [0, 2]);
  assert.deepEqual(legal({ barterAvailable: true, traderLevels: { ref: 1 } }), [1, 2], 'the level-2 barter is out of reach');
  assert.deepEqual(legal({ barterAvailable: true, traderLevels: { ref: 0 } }), [1, 2], 'a disabled trader takes its barters with it');
});

test('a stored price of zero or less is not an offer, a barter that prices to 0 is', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s', ['m'])] }),
    ['m', mod('m', { offers: [trader('prapor', 1, 0), flea(-5), barter('prapor', 1, 0)] })],
  );
  const { bp, domain } = prepare(lookup, { barterAvailable: true });
  assert.deepEqual(offersOf(domain, bp, 'm'), [2]);
  assert.equal(domain.templates[bp.templateIndexOf('m')].cheapestPrice, 0, 'a legal zero-price barter keeps its offer');
});

test('the cheapest legal price is reported, never a stand-in', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s', ['m', 'free'])] }),
    ['m', mod('m', { offers: [trader('prapor', 1, 900), flea(400), trader('skier', 1, 600)] })],
    ['free', mod('free', { offers: [] })],
  );
  const { bp, domain } = prepare(lookup, { fleaAvailable: false });
  assert.equal(domain.templates[bp.templateIndexOf('m')].cheapestPrice, 600);
  assert.equal(domain.templates[bp.templateIndexOf('free')].cheapestPrice, null);
});

// ---------------------------------------------------------------------------------------------
// Availability: preset supply, owned stock, caps instead of drops
// ---------------------------------------------------------------------------------------------

function stockLookup(presetOffers = [trader('prapor', 1, 1000)]) {
  return lookupOf(
    gun(WEAPON, {
      slots: [slot('s', ['bought', 'stocked'])],
      presets: [{ id: 'p1', items: [{ itemId: 'stocked', count: 2 }, { itemId: 'bought', count: 1 }], offers: presetOffers }],
    }),
    ['bought', mod('bought', { offers: [trader('prapor', 1, 100)] })],
    ['stocked', mod('stocked', { offers: [] })], // no standalone offer at all
  );
}

test('an item with no legal standalone offer is capped by preset and owned supply, not dropped', () => {
  const { bp, domain } = prepare(stockLookup());
  const stocked = domain.templates[bp.templateIndexOf('stocked')];
  assert.equal(stocked.supply, 'capped');
  assert.deepEqual(stocked.standaloneOffers, []);
  assert.deepEqual(stocked.presetSupply, [{ base: 1, quantity: 2 }], 'preset p1 is base 1; the naked receiver is base 0');
  assert.equal(stocked.cheapestPrice, null, 'never priced by a stand-in');
  assert.equal(domain.occActive[idOf(bp, 'weapon_0/s:stocked')], 1);
  assert.equal(domain.templates[bp.templateIndexOf('bought')].supply, 'standalone');
  assert.deepEqual(domain.templates[bp.templateIndexOf('bought')].presetSupply, [{ base: 1, quantity: 1 }]);
});

test('without preset or owned supply a standalone-inaccessible item can never be installed and is masked', () => {
  const { bp, domain } = prepare(stockLookup([])); // p1 has no offer: not an accessible base
  const stocked = domain.templates[bp.templateIndexOf('stocked')];
  assert.equal(stocked.supply, 'none');
  assert.deepEqual(stocked.presetSupply, []);
  const v = idOf(bp, 'weapon_0/s:stocked');
  assert.equal(domain.occActive[v], 0);
  assert.equal(domain.occInactiveReason[v], InactiveReason.NO_SUPPLY);
  assert.deepEqual(domain.bases.map(b => b.kind), ['naked'], 'an inaccessible preset supplies nothing');
});

test('owned stock keeps a standalone-inaccessible item alive, counted as a multiset, and never grants a base', () => {
  const { bp, domain } = prepare(stockLookup([]), { ownedItems: ['stocked', 'unrelated', 'stocked', 'stocked'] });
  const stocked = domain.templates[bp.templateIndexOf('stocked')];
  assert.equal(stocked.owned, 3);
  assert.equal(stocked.supply, 'capped');
  assert.equal(domain.occActive[idOf(bp, 'weapon_0/s:stocked')], 1);
  assert.equal(domain.ownedItems.get('unrelated'), 1, 'ids outside the universe stay in the retained multiset');
  assert.deepEqual(domain.bases.map(b => b.kind), ['naked']);
});

test('preset supply counts only presets with a legal offer', () => {
  const lookup = stockLookup([trader('prapor', 3, 1000)]);
  const low = prepare(lookup, { traderLevels: { prapor: 2 } });
  assert.deepEqual(low.domain.bases.map(b => b.kind), ['naked'], 'prapor level 2 cannot open the level-3 preset');
  assert.equal(low.domain.templates[low.bp.templateIndexOf('stocked')].supply, 'none');
  const high = prepare(lookup, { traderLevels: { prapor: 3 } });
  assert.deepEqual(high.domain.bases.map(b => b.kind), ['naked', 'preset']);
  assert.equal(high.domain.templates[high.bp.templateIndexOf('stocked')].supply, 'capped');
});

test('a preset that supplies an item never forces the preset: a legal standalone offer keeps the item unbounded', () => {
  const { bp, domain } = prepare(stockLookup());
  assert.equal(domain.templates[bp.templateIndexOf('bought')].supply, 'standalone');
  assert.deepEqual(domain.bases.map(b => b.kind), ['naked', 'preset'], 'the naked receiver stays an accessible base');
});

// ---------------------------------------------------------------------------------------------
// Accessible bases
// ---------------------------------------------------------------------------------------------

test('the naked receiver is a base only with a legal trader offer; owned stock never grants one; there is no free fallback', () => {
  const noOffer = lookupOf(gun(WEAPON, { offers: [], slots: [slot('s', ['m'])] }), ['m', mod('m')]);
  const { domain } = prepare(noOffer, { ownedItems: [WEAPON, 'm'] });
  assert.equal(domain.empty, true);
  assert.deepEqual(domain.bases, []);
  assert.deepEqual(domain.contradictions.map(c => c.code), ['NO_ACCESSIBLE_BASE']);
});

test('a disabled or too-low trader leaves the receiver without a base', () => {
  const lookup = lookupOf(gun(WEAPON, { offers: [trader('mechanic', 3, 5000)], slots: [slot('s', ['m'])] }), ['m', mod('m')]);
  assert.equal(prepare(lookup, { traderLevels: { mechanic: 2 } }).domain.empty, true);
  assert.equal(prepare(lookup, { traderLevels: { mechanic: 0 } }).domain.empty, true);
  const ok = prepare(lookup, { traderLevels: { mechanic: 3 } });
  assert.equal(ok.domain.empty, false);
  assert.deepEqual(ok.domain.bases.map(b => [b.kind, b.cheapestPrice]), [['naked', 5000]]);
});

test('a preset alone can be the accessible base; the naked receiver is then not a base', () => {
  const lookup = lookupOf(
    gun(WEAPON, { offers: [], slots: [slot('s', ['m'])], presets: [{ id: 'p1', items: [{ itemId: 'm', count: 1 }], offers: [flea(7000), trader('prapor', 4, 9000)] }] }),
    ['m', mod('m', { offers: [] })],
  );
  const { bp, domain } = prepare(lookup);
  assert.equal(domain.empty, false);
  assert.equal(domain.bases.length, 1);
  const base = domain.bases[0];
  assert.equal(base.kind, 'preset');
  assert.equal(base.kind === 'preset' ? base.presetId : '', 'p1');
  assert.equal(base.cheapestPrice, 7000);
  assert.deepEqual(base.offerIndexes, [0, 1]);
  assert.equal(domain.occActive[idOf(bp, 'weapon_0/s:m')], 1, 'the preset supplies the item');
});

// ---------------------------------------------------------------------------------------------
// Fixed point
// ---------------------------------------------------------------------------------------------

test('a required mod slot with no surviving candidate deactivates its owner; an alternative path to the same template survives', () => {
  // p1 needs 'bad' (excluded) and is impossible. p2 is fine. 'shared' is allowed under the receiver and under p2.
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('r', ['p1', 'p2', 'shared'])] }),
    ['p1', mod('p1', { slots: [slot('need1', ['bad'], true), slot('opt1', ['shared'])] })],
    ['p2', mod('p2', { slots: [slot('opt2', ['shared'])] })],
    ['bad', mod('bad')],
    ['shared', mod('shared')],
  );
  const { bp, domain } = prepare(lookup, { excludeItems: ['bad'] });
  assert.equal(domain.empty, false);
  assert.equal(reasonOf(bp, domain, 'weapon_0/r:p1'), InactiveReason.IMPOSSIBLE_OWNER);
  assert.equal(reasonOf(bp, domain, 'weapon_0/r:p1/need1:bad'), InactiveReason.USER_EXCLUDED);
  assert.equal(reasonOf(bp, domain, 'weapon_0/r:p1/opt1:shared'), InactiveReason.UNREACHABLE, 'its parent can never be installed');
  assert.deepEqual(activeIds(bp, domain), ['weapon_0/r:p2', 'weapon_0/r:shared', 'weapon_0/r:p2/opt2:shared']);
  assert.equal(domain.templateActiveCount[bp.templateIndexOf('shared')], 2, 'the template survives through its alternative parents');
});

test('impossibility cascades up through required slots to the receiver', () => {
  const chain = lookupOf(
    gun(WEAPON, { slots: [slot('r', ['p'], true)] }),
    ['p', mod('p', { slots: [slot('rp', ['q'], true)] })],
    ['q', mod('q', { slots: [slot('rq', ['bad'], true)] })],
    ['bad', mod('bad')],
  );
  const { bp, domain } = prepare(chain, { excludeItems: ['bad'] });
  assert.equal(reasonOf(bp, domain, 'weapon_0/r:p/rp:q'), InactiveReason.IMPOSSIBLE_OWNER);
  assert.equal(reasonOf(bp, domain, 'weapon_0/r:p'), InactiveReason.IMPOSSIBLE_OWNER, 'p loses its only candidate for rp');
  assert.equal(domain.empty, true, 'the root required slot has no surviving candidate');
  assert.deepEqual(domain.contradictions.map(c => c.code), ['ROOT_REQUIRED_SLOT_EMPTY']);
  assert.deepEqual(activeIds(bp, domain), []);
  assert.equal(domain.occActive[0], 0);
  assert.equal(reasonOf(bp, domain, 'weapon_0/r:p/rp:q/rq:bad'), InactiveReason.USER_EXCLUDED);
});

test('an empty root required slot, in the source or after filtering, empties the domain with the slot named', () => {
  const sourceEmpty = prepare(lookupOf(gun(WEAPON, { slots: [slot('r', [], true), slot('o', ['m'])] }), ['m', mod('m')]));
  assert.equal(sourceEmpty.domain.empty, true);
  assert.deepEqual(sourceEmpty.domain.contradictions, [{ code: 'ROOT_REQUIRED_SLOT_EMPTY', slot: 0, rawSlotId: 'r' }]);
  assert.deepEqual(activeIds(sourceEmpty.bp, sourceEmpty.domain), []);

  const filtered = prepare(lookupOf(gun(WEAPON, { slots: [slot('r', ['m'], true)] }), ['m', mod('m')]), { excludeItems: ['m'] });
  assert.equal(filtered.domain.empty, true);
  assert.equal(filtered.domain.contradictions[0].code, 'ROOT_REQUIRED_SLOT_EMPTY');
});

test('an empty mod-owned required slot forces its owner off without emptying the domain', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('r', ['broken', 'fine'])] }),
    ['broken', mod('broken', { slots: [slot('needs', [], true)] })],
    ['fine', mod('fine')],
  );
  const { bp, domain } = prepare(lookup);
  assert.equal(domain.empty, false);
  assert.equal(reasonOf(bp, domain, 'weapon_0/r:broken'), InactiveReason.IMPOSSIBLE_OWNER);
  assert.deepEqual(activeIds(bp, domain), ['weapon_0/r:fine']);
});

test('an optional undecided parent is not an orphan: everything below an optional parent stays active', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('r', ['opt'])] }),
    ['opt', mod('opt', { slots: [slot('inner', ['leaf']), slot('innerReq', ['leaf2'], true)] })],
    ['leaf', mod('leaf')],
    ['leaf2', mod('leaf2')],
  );
  const { bp, domain } = prepare(lookup);
  assert.deepEqual(activeIds(bp, domain), ['weapon_0/r:opt', 'weapon_0/r:opt/inner:leaf', 'weapon_0/r:opt/innerReq:leaf2']);
});

test('a mod the receiver conflicts with is masked, and an owner that needs only such mods is impossible', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('r', ['owner', 'banned', 'listed'])], conflictsItems: ['listed'] }),
    ['owner', mod('owner', { slots: [slot('need', ['banned'], true)] })],
    ['banned', mod('banned', { conflictsItems: [WEAPON] })],
    ['listed', mod('listed')],
  );
  const { bp, domain } = prepare(lookup);
  assert.equal(reasonOf(bp, domain, 'weapon_0/r:banned'), InactiveReason.RECEIVER_CONFLICT);
  assert.equal(reasonOf(bp, domain, 'weapon_0/r:listed'), InactiveReason.RECEIVER_CONFLICT);
  assert.equal(reasonOf(bp, domain, 'weapon_0/r:owner'), InactiveReason.IMPOSSIBLE_OWNER);
  assert.deepEqual(activeIds(bp, domain), []);
  assert.equal(domain.empty, false, 'the root slot is optional');
});

test('the structurally impossible subtrees of the blueprint stay impossible under every request', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('r', ['broken'])] }),
    ['broken', mod('broken', { slots: [slot('needs', [], true), slot('opt', ['child'])] })],
    ['child', mod('child')],
  );
  const { bp, domain } = prepare(lookup);
  assert.equal(reasonOf(bp, domain, 'weapon_0/r:broken'), InactiveReason.IMPOSSIBLE_OWNER);
  assert.equal(reasonOf(bp, domain, 'weapon_0/r:broken/opt:child'), InactiveReason.UNREACHABLE);
});

// ---------------------------------------------------------------------------------------------
// Stability, immutability, input checks
// ---------------------------------------------------------------------------------------------

test('same inputs give the same masks, and the blueprint is never mutated', () => {
  const lookup = stockLookup();
  const bp = preparePhysicalWeapon(lookup, WEAPON);
  const snapshot = (b: PhysicalBlueprint) => JSON.stringify([
    b.templateIds, Array.from(b.occTemplate), Array.from(b.occParentSlot), Array.from(b.occSlotStart), Array.from(b.slotCandStart),
    Array.from(b.slotCandCount), Array.from(b.weightMin), Array.from(b.structurallyViable), b.presets.map(p => [p.id, [...p.supply]]),
  ]);
  const before = snapshot(bp);
  const request: SubproblemRequest = { excludeItems: ['bought'], ownedItems: ['stocked'] };
  const first = prepareSubproblemDomain(bp, lookup, request);
  const second = prepareSubproblemDomain(bp, lookup, request);
  assert.equal(snapshot(bp), before);
  assert.deepEqual(Array.from(first.occActive), Array.from(second.occActive));
  assert.deepEqual(Array.from(first.occInactiveReason), Array.from(second.occInactiveReason));
  assert.deepEqual(Array.from(first.slotActive), Array.from(second.slotActive));
  assert.notEqual(first.occActive, second.occActive, 'each preparation owns its masks');
  // A different request changes only the masks, not the blueprint.
  const third = prepareSubproblemDomain(bp, lookup, { excludeItems: ['stocked'] });
  assert.notDeepEqual(Array.from(third.occActive), Array.from(first.occActive));
  assert.equal(snapshot(bp), before);
});

test('slot masks follow their owner: a slot is active iff its owner occurrence is', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('r', ['p1', 'p2'])] }),
    ['p1', mod('p1', { slots: [slot('x', ['leaf'])] })],
    ['p2', mod('p2', { slots: [slot('y', ['leaf'])] })],
    ['leaf', mod('leaf')],
  );
  const { bp, domain } = prepare(lookup, { excludeItems: ['p1'] });
  for (let s = 0; s < bp.slotCount; s++) assert.equal(domain.slotActive[s], domain.occActive[bp.slotOwner(s)], `slot ${s}`);
});

test('invalid owned_items are rejected with a typed error before any mask is made', () => {
  const lookup = stockLookup();
  const bp = preparePhysicalWeapon(lookup, WEAPON);
  const bad = (ownedItems: unknown) =>
    assert.throws(
      () => prepareSubproblemDomain(bp, lookup, { ownedItems: ownedItems as string[] }),
      (e: unknown) => e instanceof PhysicalModelError && e.code === 'INVALID_OWNED_ITEMS',
    );
  bad('stocked');
  bad([''] as string[]);
  bad([1] as unknown as string[]);
  bad(new Array<string>(2)); // sparse: holes are not entries
  bad(new Array<string>(10001).fill('x'));
  assert.doesNotThrow(() => prepareSubproblemDomain(bp, lookup, { ownedItems: new Array<string>(10000).fill('x') }));
  assert.doesNotThrow(() => prepareSubproblemDomain(bp, lookup, { ownedItems: [] }));
  assert.doesNotThrow(() => prepareSubproblemDomain(bp, lookup, { ownedItems: null }));
});

test('a blueprint is refused with a lookup it was not prepared from', () => {
  const lookup = stockLookup();
  const bp = preparePhysicalWeapon(lookup, WEAPON);
  assert.throws(
    () => prepareSubproblemDomain(bp, stockLookup(), {}),
    (e: unknown) => e instanceof PhysicalModelError && e.code === 'FOREIGN_BLUEPRINT',
  );
});
