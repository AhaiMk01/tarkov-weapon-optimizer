// The EFTForge v1 export (src/components/common/eftforgeExport.ts; ADR 0013 section 4E, Phase 2.8): a checked projection of the internal occurrence
// manifest onto `{ v: 1, g, p: [slotId, itemId][] }`. Exportable builds round-trip; ambiguous repeated parents, copies of one template and repeated slot
// ids are refused with their reason; internal Placement objects are never passed through; no copy is silently dropped. Real solver builds included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import LZString from 'lz-string';
import type { OptimizeResponse, Placement } from '../../src/api/client';
import {
  EFTFORGE_MESSAGE_KEYS, EFTFORGE_REFUSALS, EFTFORGE_URL, eftforgeRefusalKey, eftforgeUrl, projectToEftforgeV1, reconstructEftforgeV1,
} from '../../src/components/common/eftforgeExport';
import type { EftforgePayload } from '../../src/components/common/eftforgeExport';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { solve } from '../../src/solver/solver';
import type { ItemLookup, SolveParams } from '../../src/solver/types';
import { gun, lookupOf, mod, slot, WEAPON } from '../physical/lpFixtures';

const G = 'gun';
const place = (parent: string, slotId: string, item: string, instance = `${parent}/${slotId}:${item}`): Placement => ({
  parentInstanceId: parent, slotId, childInstanceId: instance, itemId: item,
});

/** weapon -> handguard (slot s_hg) -> rail (slot s_rail) -> scope (slot s_scope); stock beside it. */
const NESTED: Placement[] = [
  place('weapon_0', 's_hg', 'hg'),
  place('weapon_0', 's_stock', 'stock'),
  place('weapon_0/s_hg:hg', 's_rail', 'rail'),
  place('weapon_0/s_hg:hg/s_rail:rail', 's_scope', 'scope'),
];

/** Slot id -> owner template, the data an EFTForge reader has. */
const ownersOf = (placements: readonly Placement[], weapon: string): Map<string, string> => {
  const itemOf = new Map(placements.map(p => [p.childInstanceId, p.itemId]));
  const owners = new Map<string, string>();
  for (const p of placements) owners.set(p.slotId, itemOf.get(p.parentInstanceId) ?? weapon);
  return owners;
};

const params = (lookup: ItemLookup, extra: Partial<SolveParams> = {}): SolveParams => ({
  weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup),
  ergoWeight: 1, recoilWeight: 0, priceWeight: 0, fleaAvailable: true, preciseMode: true, ...extra,
});

// ---------------------------------------------------------------------------------------------
// Exportable builds
// ---------------------------------------------------------------------------------------------

test('a build of single occurrences projects to the v1 pairs, parents before children, and round-trips', () => {
  const projection = projectToEftforgeV1(G, NESTED);
  assert.ok(projection.ok);
  const { payload } = projection;
  assert.equal(payload.v, 1);
  assert.equal(payload.g, G);
  assert.deepEqual(payload.p, [['s_hg', 'hg'], ['s_stock', 'stock'], ['s_rail', 'rail'], ['s_scope', 'scope']], 'breadth first from the receiver');
  // Every pair is a plain [slotId, itemId] of two strings, never an internal object.
  assert.ok(payload.p.every(pair => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && typeof pair[1] === 'string'));
  assert.equal(payload.p.length, NESTED.length, 'no placement is dropped');
  // Reading the pairs back gives the manifest again (owner, slot, item).
  const rebuilt = reconstructEftforgeV1(payload, ownersOf(NESTED, G));
  assert.deepEqual(rebuilt?.sort(), NESTED.map(p => [({ hg: G, stock: G, rail: 'hg', scope: 'rail' } as Record<string, string>)[p.itemId], p.slotId, p.itemId].join('\u0000')).sort());
});

test('the order of the manifest does not matter: children listed before their parents still project parents first', () => {
  const projection = projectToEftforgeV1(G, [...NESTED].reverse());
  assert.ok(projection.ok);
  const slots = projection.payload.p.map(p => p[0]);
  assert.ok(slots.indexOf('s_hg') < slots.indexOf('s_rail') && slots.indexOf('s_rail') < slots.indexOf('s_scope'));
});

test('the URL opens a verified payload: lz-string decodes to the same JSON', () => {
  const projection = projectToEftforgeV1(G, NESTED);
  assert.ok(projection.ok);
  const url = eftforgeUrl(projection.payload);
  assert.ok(url.startsWith(`${EFTFORGE_URL}?build=`));
  const code = url.slice(`${EFTFORGE_URL}?build=`.length);
  assert.deepEqual(JSON.parse(LZString.decompressFromEncodedURIComponent(code)), projection.payload);
});

test('a real single-occurrence build from the solver exports, and its pairs are exactly the (slot, item) of its placements', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['a']), slot('s2', ['b'])] }),
    ['a', mod('a', { ergo: 5 })],
    ['b', mod('b', { ergo: 4, slots: [slot('s3', ['c'])] })],
    ['c', mod('c', { ergo: 3 })],
  );
  const response = await solve(params(lookup));
  assert.equal(response.status, 'optimal', response.reason);
  assert.equal(response.slot_pairs.length, 3);
  const projection = projectToEftforgeV1(WEAPON, response.slot_pairs);
  assert.ok(projection.ok, JSON.stringify(projection));
  assert.deepEqual([...projection.payload.p].sort(), response.slot_pairs.map(p => [p.slotId, p.itemId] as [string, string]).sort());
  const rebuilt = reconstructEftforgeV1(projection.payload, ownersOf(response.slot_pairs, WEAPON));
  assert.equal(rebuilt?.length, 3);
});

// ---------------------------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------------------------

const refusalOf = (weapon: string | undefined, placements: readonly Placement[] | undefined): string => {
  const projection = projectToEftforgeV1(weapon, placements);
  assert.equal(projection.ok, false, 'expected a refusal');
  return projection.ok ? '' : projection.refusal;
};

test('two copies of a parent with a child each repeat the child slot: refused as a repeated slot, never flattened', () => {
  const twoHandguards: Placement[] = [
    place('weapon_0', 's1', 'hg', 'weapon_0/s1:hg'),
    place('weapon_0', 's2', 'hg', 'weapon_0/s2:hg'),
    place('weapon_0/s1:hg', 's_rail', 'rail', 'weapon_0/s1:hg/s_rail:rail'),
    place('weapon_0/s2:hg', 's_rail', 'rail', 'weapon_0/s2:hg/s_rail:rail'),
  ];
  assert.equal(refusalOf(G, twoHandguards), 'repeated_slot');
});

test('copies of one template that the format cannot tell apart are refused, even without children and even when their slots differ', () => {
  const twoRails: Placement[] = [place('weapon_0', 's1', 'mount'), place('weapon_0', 's2', 'mount')];
  assert.equal(refusalOf(G, twoRails), 'repeated_item');
  // One copy has a child, the other none: the child slot is not repeated, but which copy holds it would still be a guess.
  const oneChild: Placement[] = [
    place('weapon_0', 's1', 'hg'), place('weapon_0', 's2', 'hg'),
    place('weapon_0/s1:hg', 's_rail', 'rail'),
  ];
  assert.equal(refusalOf(G, oneChild), 'repeated_item');
  // A part equal to the weapon itself would be a second copy of the receiver.
  assert.equal(refusalOf(G, [place('weapon_0', 's1', G)]), 'repeated_item');
});

test('the real multi-copy build of the solver is refused, with no copy dropped from the in-app manifest', async () => {
  // A preset supplies one `a`; two slots take `a`: the build has two separate occurrences of one template.
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['a']), slot('s2', ['a'])], presets: [{ id: 'pre', items: [{ itemId: 'a', count: 1 }] }] }),
    ['a', mod('a', { ergo: 5 })],
  );
  const response: OptimizeResponse = await solve(params(lookup));
  assert.equal(response.status, 'optimal', response.reason);
  assert.deepEqual(response.selected_item_ids, ['a', 'a']);
  assert.equal(response.slot_pairs.length, 2, 'both occurrences are in the internal manifest');
  assert.equal(refusalOf(WEAPON, response.slot_pairs), 'repeated_item');
  assert.equal(new Set(response.selected_items.map(i => i.instanceId)).size, 2, 'the in-app manifest keeps both copies as separate occurrences');
});

test('a real build with two copies of a parent and a child under each is refused as a repeated slot', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['hg']), slot('s2', ['hg'])] }),
    ['hg', mod('hg', { ergo: 5, slots: [slot('s_rail', ['rail'])] })],
    ['rail', mod('rail', { ergo: 3 })],
  );
  const response = await solve(params(lookup));
  assert.equal(response.status, 'optimal', response.reason);
  assert.equal(response.slot_pairs.length, 4, 'two handguards and a rail on each');
  assert.equal(refusalOf(WEAPON, response.slot_pairs), 'repeated_slot');
});

test('malformed manifests are refused: no weapon, nothing installed, incomplete placements, a child placed twice, detached or looping placements', () => {
  assert.equal(refusalOf(undefined, NESTED), 'no_weapon');
  assert.equal(refusalOf('', NESTED), 'no_weapon');
  assert.equal(refusalOf(G, []), 'empty');
  assert.equal(refusalOf(G, undefined), 'empty');
  assert.equal(refusalOf(G, [place('weapon_0', '', 'a')]), 'invalid_placement');
  assert.equal(refusalOf(G, [{ parentInstanceId: 'weapon_0', slotId: 's', childInstanceId: '', itemId: 'a' }]), 'invalid_placement');
  assert.equal(refusalOf(G, [place('weapon_0', 's1', 'a', 'x'), place('weapon_0', 's2', 'b', 'x')]), 'detached', 'one child instance claimed twice');
  // Two roots: a placement hanging from an instance that is not in the build.
  assert.equal(refusalOf(G, [place('weapon_0', 's1', 'a'), place('ghost', 's2', 'b')]), 'detached');
  // A loop: each is the other's child, so neither reaches a root.
  assert.equal(refusalOf(G, [place('weapon_0', 's1', 'a', 'i1'), place('i2', 's2', 'b', 'i3'), place('i3', 's3', 'c', 'i2')]), 'detached');
});

test('every refusal has one plain localized sentence: repeated parts, nothing to send, or "cannot open this build" (no technical subcodes for players)', () => {
  const keys = EFTFORGE_REFUSALS.map(eftforgeRefusalKey);
  assert.ok(keys.every(k => (EFTFORGE_MESSAGE_KEYS as readonly string[]).includes(k)), 'every refusal maps into the closed set of sentences');
  assert.deepEqual([...new Set(keys)].sort(), [...EFTFORGE_MESSAGE_KEYS].sort(), 'and every sentence is reachable');
  assert.equal(eftforgeRefusalKey('repeated_slot'), 'export.eftforge_disabled_repeated');
  assert.equal(eftforgeRefusalKey('repeated_item'), 'export.eftforge_disabled_repeated');
  assert.equal(eftforgeRefusalKey('empty'), 'export.eftforge_disabled_empty');
  assert.equal(eftforgeRefusalKey('no_weapon'), 'export.eftforge_disabled_empty');
  for (const refusal of ['invalid_placement', 'detached', 'round_trip'] as const) assert.equal(eftforgeRefusalKey(refusal), 'export.eftforge_disabled_unsupported', refusal);
  // The technical detail stays in the projection (for diagnostics), never in the sentence key.
  const repeated = projectToEftforgeV1(G, [place('weapon_0', 's1', 'a'), place('weapon_0', 's2', 'a')]);
  assert.equal(repeated.ok, false);
  if (!repeated.ok) assert.deepEqual([repeated.refusal, /installed more than once/.test(repeated.detail)], ['repeated_item', true]);
});

// ---------------------------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------------------------

test('reading a payload back refuses what it cannot read unambiguously: an unknown slot, an owner that is not installed, a repeated slot or item', () => {
  const owners = new Map([['s_hg', G], ['s_rail', 'hg']]);
  const ok: EftforgePayload = { v: 1, g: G, p: [['s_hg', 'hg'], ['s_rail', 'rail']] };
  assert.equal(reconstructEftforgeV1(ok, owners)?.length, 2);
  assert.equal(reconstructEftforgeV1({ ...ok, p: [['s_unknown', 'hg']] }, owners), null, 'unknown slot');
  assert.equal(reconstructEftforgeV1({ ...ok, p: [['s_rail', 'rail']] }, owners), null, 'the owner of the slot is not installed');
  assert.equal(reconstructEftforgeV1({ ...ok, p: [['s_hg', 'hg'], ['s_hg', 'hg2']] }, owners), null, 'repeated slot');
  assert.equal(reconstructEftforgeV1({ ...ok, p: [['s_hg', 'hg'], ['s_rail', 'hg']] }, owners), null, 'repeated item');
  assert.equal(reconstructEftforgeV1({ v: 2 as unknown as 1, g: G, p: [] }, owners), null, 'no other version is read');
});
