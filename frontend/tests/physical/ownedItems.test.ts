// `owned_items` transport types and boundary validation (ADR 0008 section 1, ADR 0013 sections 4A and 6).
//
// An invalid stash is a typed INPUT error that later maps to the public reason `Invalid owned_items format`; it is never an
// infeasibility claim. A valid stash is a multiset: duplicates keep their multiplicity, unknown ids stay, omitted or [] means no stock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OptimizeRequest, ExploreRequest } from '../../src/api/client';
import type { SolveParams } from '../../src/solver/types';
import {
  countOwnedItems, INVALID_OWNED_ITEMS_REASON, inspectOwnedItems, OWNED_ITEMS_MAX, PhysicalModelError, preparePhysicalWeapon,
  prepareSubproblemDomain, snapshotOwnedItems,
} from '../../src/solver/physical';
import { gun, lookupOf, mod, slot, WEAPON } from './fixtures';

const isInvalidOwnedItems = (e: unknown): boolean => e instanceof PhysicalModelError && e.code === 'INVALID_OWNED_ITEMS';

// ---------------------------------------------------------------------------------------------
// Types: the field exists on the API request, is inherited by Explore, and on the solver parameters
// ---------------------------------------------------------------------------------------------

test('owned_items is an optional string[] on OptimizeRequest (inherited by ExploreRequest) and ownedItems on SolveParams', () => {
  const optimize: OptimizeRequest = { weapon_id: 'w', owned_items: ['a', 'a', 'b'] };
  const explore: ExploreRequest = { weapon_id: 'w', ignore: 'price', owned_items: [] };
  const omitted: OptimizeRequest = { weapon_id: 'w' };
  const params: Pick<SolveParams, 'ownedItems'> = { ownedItems: optimize.owned_items };
  assert.deepEqual(optimize.owned_items, ['a', 'a', 'b']);
  assert.deepEqual(explore.owned_items, []);
  assert.equal(omitted.owned_items, undefined);
  assert.deepEqual(params.ownedItems, ['a', 'a', 'b']);
});

// ---------------------------------------------------------------------------------------------
// Valid input
// ---------------------------------------------------------------------------------------------

test('omitted, null and [] all mean no stock', () => {
  for (const raw of [undefined, null, []]) {
    const result = inspectOwnedItems(raw);
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && [...result.items], []);
    assert.deepEqual(snapshotOwnedItems(raw), []);
    assert.equal(countOwnedItems(raw).size, 0);
  }
});

test('duplicates keep their multiplicity and unknown strings are retained', () => {
  const stash = ['m1', 'm1', 'm2', 'not-a-part', 'm1', ' padded ', 'M1'];
  const snapshot = snapshotOwnedItems(stash);
  assert.deepEqual([...snapshot], stash, 'no deduplication, trimming, case folding or reordering');
  const counts = countOwnedItems(snapshot);
  assert.equal(counts.get('m1'), 3);
  assert.equal(counts.get('m2'), 1);
  assert.equal(counts.get('not-a-part'), 1);
  assert.equal(counts.get(' padded '), 1);
  assert.equal(counts.get('M1'), 1);
  assert.equal(counts.size, 5);
});

test('exactly the cap is accepted and one more is refused; the cap bounds entries, not string length', () => {
  const atCap = new Array<string>(OWNED_ITEMS_MAX).fill('x');
  assert.equal(snapshotOwnedItems(atCap).length, OWNED_ITEMS_MAX);
  assert.equal(countOwnedItems(atCap).get('x'), OWNED_ITEMS_MAX);
  assert.throws(() => snapshotOwnedItems([...atCap, 'x']), isInvalidOwnedItems);
  assert.equal(OWNED_ITEMS_MAX, 10_000);
  const longId = 'a'.repeat(100_000);
  assert.deepEqual([...snapshotOwnedItems([longId])], [longId]);
});

test('the snapshot is an immutable copy: the caller array is never mutated and later edits do not leak in', () => {
  const stash = ['m1', 'm2'];
  const snapshot = snapshotOwnedItems(stash);
  assert.notEqual(snapshot, stash);
  assert.ok(Object.isFrozen(snapshot));
  stash.push('m3');
  stash[0] = 'changed';
  assert.deepEqual([...snapshot], ['m1', 'm2']);
  assert.deepEqual(stash, ['changed', 'm2', 'm3'], 'the caller keeps full ownership of its own array');
});

// ---------------------------------------------------------------------------------------------
// Invalid input: a typed input error naming the problem, never an infeasibility
// ---------------------------------------------------------------------------------------------

const sparse: string[] = ['a', 'b', 'c'];
delete sparse[1];
const holeAtEnd = new Array<string>(3);
holeAtEnd[0] = 'a';

const INVALID: [label: string, raw: unknown, kind: string][] = [
  ['a string', 'm1', 'not_array'],
  ['an object', { 0: 'm1', length: 1 }, 'not_array'],
  ['a Set', new Set(['m1']), 'not_array'],
  ['a number', 7, 'not_array'],
  ['more than the cap', new Array<string>(OWNED_ITEMS_MAX + 1).fill('x'), 'too_many'],
  ['a sparse hole in the middle', sparse, 'missing_entry'],
  ['a trailing hole (array longer than its entries)', holeAtEnd, 'missing_entry'],
  ['an all-hole array', new Array<string>(2), 'missing_entry'],
  ['an empty string', ['a', ''], 'not_nonempty_string'],
  ['a number entry', ['a', 5], 'not_nonempty_string'],
  ['a null entry', ['a', null], 'not_nonempty_string'],
  ['an explicit undefined entry', ['a', undefined], 'not_nonempty_string'],
  ['an object entry', ['a', { id: 'm1' }], 'not_nonempty_string'],
  ['a nested array entry', ['a', ['m1']], 'not_nonempty_string'],
];

for (const [label, raw, kind] of INVALID) {
  test(`invalid owned_items (${label}) is a typed input error of kind ${kind}, with the public reason`, () => {
    const result = inspectOwnedItems(raw);
    assert.equal(result.ok, false);
    assert.ok(!result.ok);
    assert.equal(result.issue.kind, kind);
    assert.equal(result.reason, INVALID_OWNED_ITEMS_REASON);
    assert.match(result.message, /owned_items/);
    assert.throws(
      () => snapshotOwnedItems(raw),
      (e: unknown) => isInvalidOwnedItems(e) && (e as PhysicalModelError).details.reason === INVALID_OWNED_ITEMS_REASON
        && ((e as PhysicalModelError).details.issue as { kind: string }).kind === kind,
    );
    assert.throws(() => countOwnedItems(raw as string[]), isInvalidOwnedItems);
  });
}

test('the issue names the offending index', () => {
  const index = (raw: unknown) => {
    const result = inspectOwnedItems(raw);
    assert.ok(!result.ok);
    return (result.issue as { index?: number }).index;
  };
  assert.equal(index(['a', 'b', '', 'c']), 2);
  assert.equal(index(sparse), 1);
  assert.equal(index(['a', 'b', 3]), 2);
});

test('the public reason is the exact string of ADR 0013 section 6', () => {
  assert.equal(INVALID_OWNED_ITEMS_REASON, 'Invalid owned_items format');
});

test('a huge sparse array is refused by length before any per-entry work', () => {
  const started = performance.now();
  const huge = new Array<string>(2 ** 31);
  const result = inspectOwnedItems(huge);
  assert.ok(!result.ok);
  assert.equal(result.issue.kind, 'too_many');
  assert.ok(performance.now() - started < 100);
});

// ---------------------------------------------------------------------------------------------
// The domain preparation takes the request shape and rejects a bad stash as an input error
// ---------------------------------------------------------------------------------------------

test('prepareSubproblemDomain takes SolveParams.ownedItems directly and counts the multiset', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s', ['m1', 'm2'])] }),
    ['m1', mod('m1', { offers: [] })],
    ['m2', mod('m2')],
  );
  const bp = preparePhysicalWeapon(lookup, WEAPON);
  // A SolveParams-typed value is assignable to the domain request: no adapter step in between.
  const params = { weaponId: WEAPON, itemLookup: lookup, compatibilityMap: undefined as never, ownedItems: ['m1', 'm1', 'unknown'] } satisfies Partial<SolveParams>;
  const domain = prepareSubproblemDomain(bp, lookup, params);
  assert.equal(domain.templates[bp.templateIndexOf('m1')].owned, 2);
  assert.equal(domain.templates[bp.templateIndexOf('m1')].supply, 'capped');
  assert.equal(domain.ownedItems.get('unknown'), 1, 'ids outside the physical universe are retained for identity');

  const omitted = prepareSubproblemDomain(bp, lookup, { ownedItems: undefined });
  assert.equal(omitted.ownedItems.size, 0);
  assert.equal(omitted.templates[bp.templateIndexOf('m1')].supply, 'none');
});

test('prepareSubproblemDomain refuses an invalid stash with the typed input error, never an empty domain', () => {
  const lookup = lookupOf(gun(WEAPON, { slots: [slot('s', ['m1'])] }), ['m1', mod('m1')]);
  const bp = preparePhysicalWeapon(lookup, WEAPON);
  for (const bad of [[''], sparse, 'm1', new Array<string>(OWNED_ITEMS_MAX + 1).fill('x')] as unknown[]) {
    assert.throws(() => prepareSubproblemDomain(bp, lookup, { ownedItems: bad as string[] }), isInvalidOwnedItems);
  }
});
