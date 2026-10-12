// The Fast model text and metadata (src/solver/physical/specializeFast.ts): strict LP text that HiGHS reads back as written, template-sized columns,
// the per-template acquisition modes and the exact reductions behind them, presence columns, the refusal of a cyclic part graph, the conflict
// clique cover, and the refusals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildItemLookup } from '../../src/solver/dataService';
import {
  cliqueCover, integerNoGood, nonDominatedLots, PhysicalModelError, preparePhysicalWeapon, prepareSubproblemDomain, specializeFast,
  type FastModel, type SpecializeRequest, type SubproblemRequest,
} from '../../src/solver/physical';
import type { ItemLookup } from '../../src/solver/types';
import { barter, flea, gun, gunWith, lookupOf, mod, modWith, slot, trader, WEAPON } from './lpFixtures';
import { assertReadbackMatches, assertTextIsStrict } from './lpHarness';

function fast(lookup: ItemLookup, request: SpecializeRequest & SubproblemRequest = {}): FastModel {
  const blueprint = preparePhysicalWeapon(lookup, WEAPON);
  const domain = prepareSubproblemDomain(blueprint, lookup, request);
  const model = specializeFast(blueprint, domain, request);
  assertTextIsStrict(model.lp());
  return model;
}

const hasRow = (model: FastModel, name: string): boolean => new RegExp(`^ {2}${name}:`, 'm').test(model.lpBase);

test('the text is strict, safe-named, and HiGHS reads back exactly what it states, with and without cuts', async () => {
  const lookup = lookupOf(
    gunWith(WEAPON, { ergo: 3, coi: 5, slots: [slot('s1', ['a', 'b'], true), slot('s2', ['a'])], presets: [{ id: 'P', items: [{ itemId: 'a', count: 2 }] }] }),
    ['a', modWith('a', { ergo: 4, coi: 2, accuracy: 3, offers: [trader('prapor', 1, 100), barter('mechanic', 1, 250, false, 3)], conflictsItems: ['b'] })],
    ['b', modWith('b', { ergo: 6, offers: [flea(300)], conflictsSlots: ['s2'] })],
  );
  const model = fast(lookup, { maxMOA: 50, maxPrice: 9000, minErgonomics: 1, maxWeight: 5, maxRecoilV: 120, minMagCapacity: 1, ergoWeight: 1, recoilWeight: 1, priceWeight: 1 });
  await assertReadbackMatches(model.lp());
  const cut = integerNoGood('ng', model.decision, Object.fromEntries(model.decision.map(d => [d.name, 0])));
  assert.ok(cut);
  await assertReadbackMatches(model.lp([cut]));
});

test('columns: n_t per active template, e per candidate edge, one base per accessible base; the model is template-sized', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('m', ['host']), slot('t', ['a', 'b'])], presets: [{ id: 'P', items: [{ itemId: 'a', count: 1 }] }] }),
    ['host', mod('host', { slots: [slot('rail', ['a', 'b'])] })],
    ['a', mod('a')],
    ['b', mod('b')],
  );
  const model = fast(lookup);
  assert.equal(model.graph.edgeCount, 5, 'm>host, t>a, t>b, rail>a, rail>b');
  assert.equal(model.edges.length, 5);
  assert.ok(model.edges.every(e => /^e_\d+_\d+$/.test(e.column)));
  assert.equal(model.count(0), null, 'the receiver has no count column');
  assert.ok([1, 2, 3].every(t => model.count(t) === `n_${t}`));
  assert.equal(model.decision.length, 5 + 2, 'five edges and two bases (naked, preset P)');
  assert.deepEqual(model.decision.map(d => d.lo), new Array(7).fill(0));
  assert.equal(model.stats.columns < 60, true);
});

test('acquisition modes: capped, linear (unit lot, or one copy at the cheapest price), lots (supply or lot size), covered by stock; dominated offers are dropped', () => {
  const lookup = lookupOf(
    gun(WEAPON, {
      slots: [slot('s1', ['unit', 'multi', 'once', 'owned', 'capped']), slot('s2', ['unit', 'multi', 'owned', 'capped']), slot('s3', ['unit', 'multi', 'owned']), slot('s4', ['presetpart'])],
      presets: [{ id: 'P', items: [{ itemId: 'presetpart', count: 1 }, { itemId: 'capped', count: 1 }] }],
    }),
    // two unit offers: only the cheaper survives, and it is priced as a linear term (no supply, unit lot)
    ['unit', mod('unit', { offers: [trader('prapor', 1, 300), flea(250), trader('skier', 1, 400)] })],
    // a lot of three at 500 and a unit at 300: neither dominates the other, several copies fit: whole lots
    ['multi', mod('multi', { offers: [trader('prapor', 1, 300), barter('mechanic', 1, 500, false, 3)] })],
    // fits one slot only (one copy at most): the cheapest price covers the single unit, a linear term, even with a lot offer present
    ['once', mod('once', { offers: [barter('mechanic', 1, 200, false, 2), trader('prapor', 1, 300)] })],
    ['owned', mod('owned')],
    ['capped', mod('capped', { offers: [] })],
    ['presetpart', mod('presetpart')],
  );
  const model = fast(lookup, { ownedItems: ['owned', 'owned', 'owned'], barterAvailable: true });
  const plan = (id: string) => model.plans.get(model.blueprint.templateIndexOf(id));
  assert.equal(plan('unit')?.mode, 'linear');
  assert.equal(plan('unit')?.unitPrice, 250, 'the cheapest unit offer');
  assert.deepEqual(plan('unit')?.lots.map(l => [l.lotSize, l.price]), [[1, 250]], 'the 300 and 400 offers are dominated');
  assert.equal(plan('multi')?.mode, 'lots');
  assert.deepEqual(plan('multi')?.lots.map(l => [l.lotSize, l.price]), [[1, 300], [3, 500]]);
  assert.equal(plan('once')?.mode, 'linear', 'one copy at most');
  assert.equal(plan('once')?.unitPrice, 200, 'cheapest of the lot and the unit: one unit is covered by the lot of two');
  assert.equal(plan('owned')?.mode, 'covered', 'three owned copies cover the three slots');
  assert.equal(plan('capped')?.mode, 'capped');
  assert.equal(plan('presetpart')?.mode, 'lots', 'preset supply makes the deficit nonlinear');
  assert.ok(hasRow(model, `supcap_${model.blueprint.templateIndexOf('capped')}`));
  assert.ok(hasRow(model, `cover_${model.blueprint.templateIndexOf('multi')}`));
  assert.ok(!hasRow(model, `cover_${model.blueprint.templateIndexOf('unit')}`), 'a linear template has no cover row');
  assert.ok(!hasRow(model, `sur_${model.blueprint.templateIndexOf('multi')}`), 'the surrogate is substituted into the cover row');
});

test('nonDominatedLots keeps offers that no other offer matches or beats in both size and price, ascending in price', () => {
  const lots = [
    { index: 0, price: 300, lotSize: 1 }, { index: 1, price: 250, lotSize: 1 }, { index: 2, price: 500, lotSize: 3 },
    { index: 3, price: 600, lotSize: 2 }, { index: 4, price: 250, lotSize: 1 }, { index: 5, price: 900, lotSize: 3 }, { index: 6, price: 400, lotSize: 1 },
  ];
  assert.deepEqual(nonDominatedLots(lots).map(l => l.index), [1, 2], 'the earlier of two equal offers, then the lot of three');
  assert.deepEqual(nonDominatedLots([]), []);
});

test('presence: a template that can repeat and takes part in a conflict or MOA row gets a linked binary; a single-copy template uses its count', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['rep', 'single']), slot('s2', ['rep']), slot('s3', ['rep', 'other'])] }),
    ['rep', mod('rep', { conflictsItems: ['other'] })],
    ['single', mod('single', { conflictsItems: ['other'] })],
    ['other', mod('other')],
  );
  const model = fast(lookup);
  const idx = (id: string): number => model.blueprint.templateIndexOf(id);
  assert.equal(model.graph.maxCopies[idx('rep')], 3);
  assert.equal(model.graph.maxCopies[idx('single')], 1);
  assert.ok(model.lpBase.includes(` z_${idx('rep')}`), 'the repeating conflict participant has a presence column');
  assert.ok(hasRow(model, `zup_${idx('rep')}`) && hasRow(model, `zlo_${idx('rep')}`));
  assert.ok(!model.lpBase.includes(`z_${idx('single')}`), 'a single-copy template needs no presence column');
  assert.ok(!model.lpBase.includes(`z_${idx('other')}`));
  // without conflicts no presence column exists at all
  assert.ok(!/ z_\d+/.test(fast(lookupOf(gun(WEAPON, { slots: [slot('s', ['a', 'a'])] }), ['a', mod('a')])).lpBase));
});

test('a gun whose part graph has a cycle builds no model (unsupported data, owner decision 2d as amended); an acyclic one carries no connectivity row', () => {
  const cyclic = lookupOf(
    gun(WEAPON, { slots: [slot('s0', ['A']), slot('s1', ['B'])] }),
    ['A', mod('A', { slots: [slot('toB', ['B'])] })],
    ['B', mod('B', { slots: [slot('toA', ['A'])] })],
  );
  assert.throws(() => fast(cyclic), (e: unknown) => e instanceof PhysicalModelError && e.code === 'CYCLIC_PART_GRAPH');
  const acyclic = fast(lookupOf(gun(WEAPON, { slots: [slot('s0', ['A'])] }), ['A', mod('A')]));
  assert.ok(!/ f_\d+_\d+/.test(acyclic.lpBase) && !hasRow(acyclic, 'fc_1'));
});

test('the conflict clique cover covers every pair, with cliques of pairwise conflicting templates, deterministically', () => {
  // A triangle 1-2-3, a pendant edge 3-4, a pair with an inactive side, and a duplicate.
  const pairs = [1, 2, 1, 3, 2, 3, 3, 4, 4, 5, 3, 4];
  const active = [1, 1, 1, 1, 1, 0];
  const cliques = cliqueCover(pairs, active);
  assert.deepEqual(cliques, [[1, 2, 3], [3, 4]]);
  assert.deepEqual(cliqueCover(pairs, active), cliques);
  const covered = new Set(cliques.flatMap(c => c.flatMap((a, i) => c.slice(i + 1).map(b => `${Math.min(a, b)},${Math.max(a, b)}`))));
  for (const key of ['1,2', '1,3', '2,3', '3,4']) assert.ok(covered.has(key), key);
  assert.deepEqual(cliqueCover([], []), []);
  // a random graph: every active pair lies in a returned clique and every clique is complete
  const pairList: number[] = [];
  const edges = new Set<string>();
  let seed = 12345;
  const next = (): number => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  for (let i = 0; i < 120; i++) {
    const a = 1 + Math.floor(next() * 14);
    const b = 1 + Math.floor(next() * 14);
    if (a === b) continue;
    pairList.push(Math.min(a, b), Math.max(a, b));
    edges.add(`${Math.min(a, b)},${Math.max(a, b)}`);
  }
  const random = cliqueCover(pairList, new Array(16).fill(1));
  const cover = new Set<string>();
  for (const c of random) {
    for (let i = 0; i < c.length; i++) {
      for (let j = i + 1; j < c.length; j++) {
        const key = `${Math.min(c[i], c[j])},${Math.max(c[i], c[j])}`;
        assert.ok(edges.has(key), `clique member pair ${key} is a conflict`);
        cover.add(key);
      }
    }
  }
  assert.deepEqual([...cover].sort(), [...edges].sort());
});

test('refusals and degenerate inputs: a foreign domain, an empty domain, a non-finite cap or node or modifier', () => {
  const lookup = lookupOf(gun(WEAPON, { slots: [slot('s', ['a'])] }), ['a', mod('a')]);
  const blueprint = preparePhysicalWeapon(lookup, WEAPON);
  const domain = prepareSubproblemDomain(blueprint, lookup, {});
  // TrueErgo and Prevent Overswing are Fast rows now (specializeFast.ted.test.ts), not a refusal.
  assert.doesNotThrow(() => specializeFast(blueprint, domain, { useTrueErgo: true }));
  assert.doesNotThrow(() => specializeFast(blueprint, domain, { preventOverswing: true }));
  assert.throws(() => specializeFast(blueprint, domain, { useTrueErgo: true, equipErgoModifier: Number.NaN }), /not a finite number/);
  assert.throws(() => specializeFast(blueprint, domain, { useTrueErgo: true }, { weightMin: Number.NaN, weightMax: 1 }), /not a finite number/);
  assert.throws(() => specializeFast(blueprint, domain, { maxPrice: Number.NaN }), /not a finite number/);
  assert.throws(() => specializeFast(blueprint, domain, { useTchebycheff: true }), /ideal point/);
  const other = preparePhysicalWeapon(lookup, WEAPON);
  assert.throws(() => specializeFast(other, domain, {}), /was not prepared from the blueprint/);
  const noBase = lookupOf(gun(WEAPON, { offers: [], slots: [slot('s', ['a'])] }), ['a', mod('a')]);
  const bp = preparePhysicalWeapon(noBase, WEAPON);
  const empty = specializeFast(bp, prepareSubproblemDomain(bp, noBase, {}), {});
  assert.equal(empty.provedEmpty?.source, 'domain');
  assert.equal(empty.edges.length, 0);
  assert.equal(empty.lp(), empty.lpBase);
});

test('a request row that is constant and false is a contradiction row, not an LP: an included item with no active occurrence, a magazine nothing reaches', () => {
  const lookup = lookupOf(gun(WEAPON, { slots: [slot('s', ['a'])] }), ['a', mod('a')]);
  const ghost = fast(lookup, { includeItems: ['ghost'] });
  assert.equal(ghost.provedEmpty?.source, 'request');
  assert.match(ghost.provedEmpty?.reasons.join(' ') ?? '', /ghost/);
  const mag = fast(lookup, { minMagCapacity: 30 });
  assert.equal(mag.provedEmpty?.source, 'request');
  assert.equal(fast(lookup, {}).provedEmpty, null);
});

// ---- real data: the pinned capture -------------------------------------------------------------------------------------------

const SNAPSHOT_PATH = fileURLToPath(new URL('../../benchmarks/snapshot.json', import.meta.url));
const SNAPSHOT_SHA256 = '219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c';
const skip = existsSync(SNAPSHOT_PATH) ? false : 'frontend/benchmarks/snapshot.json is not restored (ADR 0013 section 1)';

test('real guns: the Fast text of the default, Tchebycheff, MOA and capped requests round-trips through the parser and HiGHS; M4A1 is template-sized', { skip, timeout: 300_000 }, async t => {
  const bytes = readFileSync(SNAPSHOT_PATH);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), SNAPSHOT_SHA256, 'the snapshot must be the pinned artifact');
  const snapshot = JSON.parse(bytes.toString('utf8')) as { guns: { id: string; shortName: string }[]; mods: Record<string, unknown>[] };
  const lookup = buildItemLookup(snapshot.guns as never, snapshot.mods as never);
  const isAmmo = (id: string): boolean => !Object.hasOwn(lookup, id);
  const variants: Record<string, SpecializeRequest & SubproblemRequest> = {
    default: {},
    tchebycheff: { useTchebycheff: true, idealPoint: { zE: 500, nadE: 100, zR: -300, nadR: 0, zP: 1000, nadP: 100000 } },
    capped: { maxMOA: 5, maxPrice: 300000, minMagCapacity: 20, maxRecoilV: 300, minSightingRange: 50, maxWeight: 6, minErgonomics: 20 },
    stash: { ownedItems: ['5447a9cd4bdc2dbd208b4567'], barterAvailable: true },
    trueErgo: { useTrueErgo: true, equipErgoModifier: -0.15 },
    overswing: { preventOverswing: true, maxWeight: 9 },
  };
  for (const name of ['MP5', 'M4A1', 'AK-74N']) {
    const entry = snapshot.guns.find(g => g.shortName === name);
    assert.ok(entry, name);
    const blueprint = preparePhysicalWeapon(lookup, entry.id, { isAmmo });
    for (const [variant, request] of Object.entries(variants)) {
      const domain = prepareSubproblemDomain(blueprint, lookup, request);
      const model = specializeFast(blueprint, domain, request);
      assert.equal(model.provedEmpty, null, `${name} ${variant}`);
      await assertReadbackMatches(model.lp());
      if (name === 'M4A1' && variant === 'default') {
        assert.ok(model.stats.columns < 8000, `M4A1: ${model.stats.columns} columns against ${blueprint.occurrenceCount - 1} occurrences`);
        assert.equal(model.graph.topological.length, model.graph.active.reduce((a, b) => a + b, 0), 'every active template is ordered (the graph is acyclic)');
        t.diagnostic(`M4A1 Fast model: ${model.stats.columns} columns (${model.stats.binaries} binary, ${model.stats.integers} integer), ${model.stats.rows} rows, ${model.stats.nonzeros} nonzeros, ${model.edges.length} edges`);
      }
    }
  }
});

test('a Fast LP never carries a legacy remnant: no 1000 Big-M literal, no rounded coefficient, no stand-in price, no x_-1', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['a', 'host']), slot('s2', ['a'])] }),
    ['a', mod('a', { ergo: 0.123456789, recoil: -0.0123456789, weight: 0.0123456789, offers: [trader('prapor', 1, 123)] })],
    ['host', mod('host', { slots: [slot('r', ['a'], true)], offers: [barter('mechanic', 1, 777)] })],
  );
  const text = fast(lookup, { barterAvailable: true, priceWeight: 1 }).lpBase;
  assert.doesNotMatch(text, /x_-/);
  assert.doesNotMatch(text, /50000000|100000000/, 'no unpurchasable stand-in price');
  assert.match(text, /0\.123456789/, 'full-precision coefficients, no toFixed(6)');
  assert.match(text, /0\.0123456789/);
});
