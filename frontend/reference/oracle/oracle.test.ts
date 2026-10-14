import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReferenceFixture, ReferenceItem, ReferenceRequest, ReferenceSlot, ReferenceWeapon } from './domain';
import { childInstanceId, projectBuild, projectionKey, type Placement, type ReferenceBuild } from './build';
import { runOracle } from './oracle';
import { validateReference } from './validate';
import { eq, q, toString } from './q';

const trader = (price = 100) => [{ kind: 'trader' as const, trader: 'prapor', level: 1, price }];
const slot = (id: string, allowedItemIds: string[], required = false): ReferenceSlot => ({ id, allowedItemIds, required });
function fixtureOf(items: ReferenceItem[], weapon: Partial<ReferenceWeapon> = {}, extra: Partial<ReferenceFixture> = {}): ReferenceFixture {
  return {
    schemaVersion: 1,
    items: items.map(i => ({ offers: trader(), ...i })),
    weapons: [{ id: 'gun', offers: trader(1000), ...weapon }],
    ...extra,
  };
}
const run = (f: ReferenceFixture, r: Partial<ReferenceRequest> = {}, options = {}) => runOracle(f, { weapon_id: 'gun', ...r }, options);
const itemsOf = (key: string) => (JSON.parse(key) as [unknown, [string, number][]])[1].map(([id, n]) => `${id}${n > 1 ? `x${n}` : ''}`).join('+');
const baseOf = (key: string) => (JSON.parse(key) as [string[], unknown])[0].join(':');
const labels = (keys: string[]) => keys.map(k => `${baseOf(k)}|${itemsOf(k)}`);

test('two optional slots A and B: four feasible projections, the full build wins on ergonomics', () => {
  const f = fixtureOf([{ id: 'a', ergonomics: 3 }, { id: 'b', ergonomics: 2 }], { slots: [slot('s1', ['a']), slot('s2', ['b'])] });
  const r = run(f, { recoil_weight: 0 }, {});
  assert.equal(r.complete, true);
  assert.equal(r.empty, false);
  assert.deepEqual(labels(r.projectionKeys).sort(), ['naked|', 'naked|a', 'naked|a+b', 'naked|b']);
  assert.deepEqual(labels(r.maximizers), ['naked|a+b']);
  assert.deepEqual(r.maxScore, q(5)); // (e/10) x 10 x (0 + 3 + 2) with e = 1
});

test('maxScore is exactly the best projection score and every accepted build is validator-accepted', () => {
  const f = fixtureOf([{ id: 'a', ergonomics: 3 }, { id: 'b', ergonomics: 2 }], { ergonomics: 40, slots: [slot('s1', ['a']), slot('s2', ['b'])] });
  const r = run(f, { ergo_weight: 1, recoil_weight: 0 });
  // score = (e/10) fE = ergonomics (weight 1): 40 + 3 + 2 = 45
  assert.deepEqual(r.maxScore, q(45));
  for (const accepted of r.builds) {
    assert.equal(validateReference(f, { weapon_id: 'gun', ergo_weight: 1, recoil_weight: 0 }, accepted.build).ok, true);
  }
});

test('multi-copy: two grips in distinct slots beat one', () => {
  const f = fixtureOf([{ id: 'grip', ergonomics: 3 }], { slots: [slot('s1', ['grip']), slot('s2', ['grip'])] });
  const r = run(f, { recoil_weight: 0 });
  assert.deepEqual(labels(r.maximizers), ['naked|gripx2']);
  assert.equal(r.projectionKeys.length, 3); // none, one grip, two grips
  assert.equal(r.builds.length, 4); // one grip can sit in s1 or s2: two physical placements, one projection
});

test('alternative parents give distinct physical builds with the same projection', () => {
  const f = fixtureOf(
    [{ id: 'p1', slots: [slot('c', ['x'])] }, { id: 'p2', slots: [slot('c', ['x'])] }, { id: 'x', ergonomics: 4 }],
    { slots: [slot('s', ['p1', 'p2'])] },
  );
  const r = run(f, { recoil_weight: 0 });
  const withX = r.builds.filter(b => b.build.placements.some(p => p.itemId === 'x'));
  assert.equal(withX.length, 2);
  assert.equal(new Set(withX.map(b => b.projectionKey)).size, 2); // via p1 vs via p2: different multisets
  const f2 = fixtureOf(
    [{ id: 'p', slots: [slot('c', ['x'])] }, { id: 'x', ergonomics: 4 }],
    { slots: [slot('s1', ['p']), slot('s2', ['p'])] },
  );
  const r2 = run(f2, { recoil_weight: 0 });
  assert.ok(r2.builds.length > r2.projectionKeys.length);
});

test('a required mod slot forces its owner off while the alternative path survives', () => {
  const f = fixtureOf(
    [{ id: 'owner', ergonomics: 10, slots: [slot('need', ['gone'], true)] }, { id: 'gone' }, { id: 'alt', ergonomics: 1 }],
    { slots: [slot('s', ['owner', 'alt'])] },
    {},
  );
  const r = run(f, { exclude_items: ['gone'], recoil_weight: 0 });
  assert.deepEqual(labels(r.projectionKeys).sort(), ['naked|', 'naked|alt']);
  assert.deepEqual(labels(r.maximizers), ['naked|alt']);
});

test('template conflicts remove the combined projection; self-conflicts cap copies', () => {
  const f = fixtureOf(
    [{ id: 'a', ergonomics: 3, conflictingItemIds: ['b'] }, { id: 'b', ergonomics: 4 }, { id: 'c', ergonomics: 2, conflictingItemIds: ['c'] }],
    { slots: [slot('s1', ['a', 'b']), slot('s2', ['a', 'b']), slot('s3', ['c']), slot('s4', ['c'])] },
  );
  const r = run(f, { recoil_weight: 0 });
  const keys = labels(r.projectionKeys);
  assert.ok(!keys.some(k => k.includes('a+b')));
  assert.ok(keys.includes('naked|ax2'));
  assert.ok(keys.includes('naked|bx2'));
  assert.ok(!keys.some(k => k.includes('cx2')));
});

test('slot conflict makes the blocked physical slot unusable but keeps alternatives', () => {
  const f = fixtureOf(
    [{ id: 'blocker', ergonomics: 1, conflictingSlotIds: ['rail'] }, { id: 'host', slots: [slot('rail', ['x'])] }, { id: 'x', ergonomics: 9 }],
    { slots: [slot('s1', ['blocker']), slot('s2', ['host'])] },
  );
  const r = run(f, { recoil_weight: 0 });
  const keys = labels(r.projectionKeys);
  assert.ok(keys.includes('naked|host+x'));
  assert.ok(keys.includes('naked|blocker+host')); // rail empty
  assert.ok(!keys.includes('naked|blocker+host+x'));
  assert.deepEqual(labels(r.maximizers), ['naked|host+x']);
});

test('inclusion and ban requests shrink the feasible set exactly', () => {
  const f = fixtureOf([{ id: 'a', categories: ['c1'] }, { id: 'b', categories: ['c2'] }], { slots: [slot('s1', ['a']), slot('s2', ['b'])] });
  assert.deepEqual(labels(run(f, { include_items: ['a'] }).projectionKeys).sort(), ['naked|a', 'naked|a+b']);
  assert.deepEqual(labels(run(f, { include_categories: [['c2']], exclude_items: ['a'] }).projectionKeys), ['naked|b']);
  assert.equal(run(f, { include_items: ['a'], exclude_items: ['a'] }).empty, true);
});

test('empty is proved only by a complete enumeration', () => {
  const f = fixtureOf([{ id: 'a' }], { slots: [slot('s', [], true)] });
  const r = run(f);
  assert.equal(r.empty, true);
  assert.equal(r.complete, true);
  assert.equal(r.maxScore, null);
  assert.deepEqual(r.maximizers, []);
  // an incomplete search that found nothing proves nothing
  const big = fixtureOf([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { slots: [slot('s1', ['a', 'b', 'c']), slot('s2', ['a', 'b', 'c'])] });
  const capped = run(big, { max_price: 0 }, { maxNodes: 2 });
  assert.equal(capped.complete, false);
  assert.equal(capped.empty, false);
});

test('with nothing to buy the owned receiver is the base at price 0, and stock never grants a receiver', () => {
  // prapor 0 locks the receiver and a; a is owned once. The receiver is the player's own (interpretation 18).
  const f = fixtureOf([{ id: 'a', ergonomics: 3 }], { slots: [slot('s', ['a'])] });
  const r = run(f, { recoil_weight: 0, trader_levels: { prapor: 0 }, owned_items: ['gun', 'a'] });
  assert.equal(r.empty, false);
  assert.equal(r.complete, true);
  assert.deepEqual(labels(r.maximizers), ['naked|a']);
  // a buyable preset (Skier) means the locked receiver is not owned: only the preset is a base
  const g = fixtureOf([{ id: 'a', ergonomics: 3 }], { slots: [slot('s', ['a'])] }, {
    presets: [{ id: 'pre', weaponId: 'gun', components: [], offers: [{ kind: 'trader', trader: 'skier', level: 1, price: 2000 }] }],
  });
  const p = run(g, { recoil_weight: 0, trader_levels: { prapor: 0 }, owned_items: ['gun', 'a'] });
  assert.deepEqual(labels(p.maximizers), ['preset:pre|a']);
});

test('base choice: preset parts are free supply, stripping is free, the base is paid once', () => {
  const f = fixtureOf(
    [{ id: 'a', ergonomics: 3, offers: trader(700) }],
    { slots: [slot('s1', ['a']), slot('s2', ['a'])], offers: trader(1000) },
    { presets: [{ id: 'pre', weaponId: 'gun', components: [{ itemId: 'a', count: 2 }], offers: trader(1500) }] },
  );
  const r = run(f, { ergo_weight: 0, recoil_weight: 0, price_weight: 1 });
  // price-only objective: the cheapest feasible spend wins: naked, nothing installed (1000)
  const best = r.projections.find(p => eq(p.score, r.maxScore!))!;
  assert.equal(`${baseOf(best.key)}|${itemsOf(best.key)}`, 'naked|');
  assert.deepEqual(r.maxScore, q(-1)); // -(p/1000) * fP = -1000/1000
  // preset with both parts retained costs exactly the preset price
  const retained = r.projections.find(p => baseOf(p.key) === 'preset:pre' && itemsOf(p.key) === 'ax2')!;
  assert.deepEqual(retained.score, q(-3, 2));
  // preset with a third... naked with two bought copies costs 1000 + 1400
  const bought = r.projections.find(p => baseOf(p.key) === 'naked' && itemsOf(p.key) === 'ax2')!;
  assert.deepEqual(bought.score, q(-12, 5));
});

test('zero price weight ties naked and preset projections exactly, without any base penalty', () => {
  const f = fixtureOf(
    [{ id: 'a', ergonomics: 3 }],
    { slots: [slot('s', ['a'])], offers: trader(1000) },
    { presets: [{ id: 'pre', weaponId: 'gun', components: [{ itemId: 'a', count: 1 }], offers: trader(1500) }] },
  );
  const r = run(f, { recoil_weight: 0 });
  assert.deepEqual(labels(r.maximizers).sort(), ['naked|a', 'preset:pre|a']);
});

test('exact ties are exact: a tiny positive gap leaves a single maximizer', () => {
  const tie = fixtureOf([{ id: 'a', ergonomics: 5 }, { id: 'b', ergonomics: 5 }], { slots: [slot('s', ['a', 'b'])] });
  assert.deepEqual(labels(run(tie, { recoil_weight: 0 }).maximizers).sort(), ['naked|a', 'naked|b']);
  const gap = fixtureOf([{ id: 'a', ergonomics: 5 }, { id: 'b', ergonomics: 5.000000000000001 }], { slots: [slot('s', ['a', 'b'])] });
  assert.deepEqual(labels(run(gap, { recoil_weight: 0 }).maximizers), ['naked|b']);
});

test('prevent overswing at W = 3 kg: the boundary build is feasible, one hair above is not', () => {
  const f = fixtureOf(
    [{ id: 'light', weightKg: 1 }, { id: 'heavy', weightKg: 1.0625 }],
    { weightKg: 2, ergonomics: 0, slots: [slot('s', ['light', 'heavy'])] },
  );
  const r = run(f, { prevent_overswing: true });
  const keys = labels(r.projectionKeys).sort();
  assert.deepEqual(keys, ['naked|', 'naked|light']); // 3.0 ok, 3.0625 rejected
  assert.deepEqual(labels(run(f).projectionKeys).sort(), ['naked|', 'naked|heavy', 'naked|light']);
});

test('owned stock monotonicity: spend never rises, the feasible set grows, the optimum does not drop', () => {
  const f = fixtureOf(
    [{ id: 'rare', ergonomics: 8, offers: [] }, { id: 'common', ergonomics: 2, offers: trader(300) }],
    { slots: [slot('s1', ['rare']), slot('s2', ['common']), slot('s3', ['rare'])] },
  );
  const without = run(f, { recoil_weight: 0, price_weight: 0.5 });
  const withOne = run(f, { recoil_weight: 0, price_weight: 0.5, owned_items: ['rare'] });
  const withTwo = run(f, { recoil_weight: 0, price_weight: 0.5, owned_items: ['rare', 'rare', 'common'] });
  const keys = (r: ReturnType<typeof run>) => new Set(r.projectionKeys);
  for (const k of keys(without)) assert.ok(keys(withOne).has(k));
  for (const k of keys(withOne)) assert.ok(keys(withTwo).has(k));
  assert.ok(withTwo.maxScore!.n * withOne.maxScore!.d >= withOne.maxScore!.n * withTwo.maxScore!.d);
  assert.ok(withOne.maxScore!.n * without.maxScore!.d >= without.maxScore!.n * withOne.maxScore!.d);
  for (const [smaller, larger] of [[without, withOne], [withOne, withTwo]] as const) {
    for (const p of smaller.projections) {
      const sameBuild = larger.projections.find(x => x.key === p.key)!;
      // price weight > 0 so a larger stash can only lower spend, hence only raise the score
      assert.ok(sameBuild.score.n * p.score.d >= p.score.n * sameBuild.score.d, toString(p.score));
    }
  }
});

test('a build cap marks the result incomplete and never claims emptiness', () => {
  const f = fixtureOf([{ id: 'a' }, { id: 'b' }], { slots: [slot('s1', ['a', 'b']), slot('s2', ['a', 'b'])] });
  const r = run(f, {}, { maxBuilds: 3 });
  assert.equal(r.complete, false);
  assert.equal(r.empty, false);
  assert.ok(r.builds.length <= 3);
});

// --- cross-check: the enumerator is complete and sound relative to the validator ---------------------

/** Every potential placement reachable under the ancestor rule, plus all subsets filtered by the validator. */
function bruteForce(f: ReferenceFixture, request: ReferenceRequest, bases: ReferenceBuild['base'][]): Set<string> {
  const universe: Placement[] = [];
  const weapon = f.weapons[0];
  const expand = (parent: string, slots: ReferenceSlot[], ancestors: string[]) => {
    for (const s of slots) {
      for (const itemId of new Set(s.allowedItemIds)) {
        if (ancestors.includes(itemId)) continue;
        const child = childInstanceId(parent, s.id, itemId);
        universe.push({ parentInstanceId: parent, slotId: s.id, childInstanceId: child, itemId });
        expand(child, f.items.find(i => i.id === itemId)!.slots ?? [], [...ancestors, itemId]);
      }
    }
  };
  expand('weapon_0', weapon.slots ?? [], [weapon.id]);
  if (universe.length > 14) return new Set(['TOO_BIG']);
  const accepted = new Set<string>();
  for (const base of bases) {
    for (let mask = 0; mask < 1 << universe.length; mask++) {
      const placements = universe.filter((_, i) => (mask >> i) & 1);
      const build: ReferenceBuild = { base, placements };
      if (validateReference(f, request, build).ok) accepted.add(projectionKey(projectBuild(build)));
    }
  }
  return accepted;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test('enumerator + validator agree with exhaustive subset search on seeded random fixtures', () => {
  let checked = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const next = rng(seed * 7919);
    const pick = <T,>(xs: T[]): T => xs[Math.floor(next() * xs.length)];
    const ids = ['a', 'b', 'c', 'd'];
    const subset = () => ids.filter(() => next() < 0.5);
    const items: ReferenceItem[] = ids.map(id => ({
      id,
      ergonomics: Math.floor(next() * 7) - 2,
      weightKg: next() < 0.5 ? 0.5 : 1,
      categories: [pick(['c1', 'c2'])],
      slots: next() < 0.5 ? [{ id: `${id}-s`, required: next() < 0.25, allowedItemIds: subset() }] : [],
      conflictingItemIds: next() < 0.3 ? [pick(ids)] : [],
      conflictingSlotIds: next() < 0.2 ? ['r2'] : [],
      offers: next() < 0.75 ? trader(100) : [],
    }));
    const f: ReferenceFixture = {
      schemaVersion: 1,
      items,
      weapons: [{
        id: 'gun', offers: trader(1000), weightKg: 2,
        slots: [{ id: 'r1', required: next() < 0.2, allowedItemIds: subset() }, { id: 'r2', allowedItemIds: subset() }],
      }],
      presets: next() < 0.5 ? [{ id: 'pre', weaponId: 'gun', components: [{ itemId: pick(ids), count: 1 + Math.floor(next() * 2) }], offers: trader(1500) }] : [],
    };
    const request: ReferenceRequest = {
      weapon_id: 'gun',
      exclude_items: next() < 0.3 ? [pick(ids)] : [],
      include_items: next() < 0.25 ? [pick(ids)] : [],
      owned_items: next() < 0.5 ? [pick(ids)] : [],
      prevent_overswing: next() < 0.2,
      max_weight: next() < 0.3 ? 3 : null,
      ergo_weight: 1,
      recoil_weight: 0,
    };
    const oracle = runOracle(f, request);
    assert.equal(oracle.complete, true);
    const bases = (f.presets?.length ? [{ kind: 'naked' as const }, { kind: 'preset' as const, presetId: 'pre' }] : [{ kind: 'naked' as const }]);
    const expected = bruteForce(f, request, bases);
    if (expected.has('TOO_BIG')) continue;
    checked++;
    assert.deepEqual([...oracle.projectionKeys].sort(), [...expected].sort(), `seed ${seed}`);
    assert.equal(oracle.empty, expected.size === 0, `seed ${seed}`);
  }
  assert.ok(checked >= 20, `only ${checked} fixtures were small enough to cross-check`);
});
