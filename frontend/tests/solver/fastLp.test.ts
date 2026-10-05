// The Fast (template-level) LP text is HiGHS-safe (Phase 2.4b-3b): every column and row name matches [A-Za-z_][A-Za-z0-9_]*, the strict
// HiGHS-independent parser reads the text, and HiGHS reads back exactly the model the text states. The legacy writer used to emit `x_-1`
// for a required slot whose owner had no column; HiGHS reads that as the column `x_` and the number -1, a different model than the one
// written (107 occurrences in the AK-74 LP of the pinned capture).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compareReadback, parseLpText, readbackModel } from '../../src/solver/native';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { buildItemLookup } from '../../src/solver/dataService';
import { buildLP, MOA_K } from '../../src/solver/lpBuilder';
import type { ItemLookup, SolveParams } from '../../src/solver/types';
import { barter, gun, lookupOf, mod, slot, WEAPON } from '../physical/lpFixtures';

const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The text parses strictly, every name is safe, and HiGHS reads back exactly the stated model. */
async function assertRoundTrips(label: string, lp: string): Promise<void> {
  const expected = parseLpText(lp); // throws on `x_-1` and every other token the strict reader rejects
  for (const column of expected.columns) assert.match(column.name, SAFE_NAME, `${label}: column ${column.name}`);
  for (const row of expected.rows) assert.match(row.name, SAFE_NAME, `${label}: row ${row.name}`);
  const readback = await readbackModel(lp, {});
  assert.equal(readback.readStatus, 'ok', `${label}: HiGHS adjusted the model: ${readback.readMessages.join(' | ')}`);
  const comparison = compareReadback(expected, readback);
  assert.ok(comparison.ok, `${label}: HiGHS read a different model: ${JSON.stringify(comparison.counts)} ${JSON.stringify(comparison.differences[0])}`);
}

const fastParams = (lookup: ItemLookup, weaponId: string, extra: Partial<SolveParams> = {}): SolveParams => ({
  weaponId, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(weaponId, lookup),
  ergoWeight: 1, recoilWeight: 1, priceWeight: 0.5, fleaAvailable: true, preciseMode: false, ...extra,
});

test('a required slot whose owner has no column is not written as x_-1: the row is dropped, because that owner can never be installed', async () => {
  // `host` is sold only by a barter and barters are off (the default), so it is not modelled; its required slot `need` still lists the buyable `filler`.
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('mount', ['host', 'plain'])] }),
    ['host', mod('host', { offers: [barter('mechanic', 1, 500)], slots: [slot('need', ['filler'], true)] })],
    ['plain', mod('plain', { ergo: 1 })],
    ['filler', mod('filler', { ergo: 2 })],
  );
  const { lpString, indexToItem } = buildLP(fastParams(lookup, WEAPON));
  assert.ok(!indexToItem.includes('host'), 'the owner is not in the model');
  assert.ok(indexToItem.includes('filler'));
  assert.doesNotMatch(lpString, /x_-/, 'no column index below zero');
  assert.doesNotMatch(lpString, /mreq_\d+: - x_\s/, 'no row that subtracts a missing owner');
  await assertRoundTrips('orphaned required slot', lpString);
});

test('the text of an empty base set is a contradiction row, not a free fallback base, and still round-trips', async () => {
  const lookup = lookupOf(gun(WEAPON, { offers: [], slots: [slot('s', ['a'])] }), ['a', mod('a', { ergo: 3 })]);
  const lp = buildLP(fastParams(lookup, WEAPON));
  assert.equal(lp.nBases, 0, 'there is no purchasable base and none is invented');
  assert.match(lp.lpString, /base_sum: 0 __dummy = 1/);
  assert.deepEqual(lp.baseIds, []);
  await assertRoundTrips('empty base set', lp.lpString);
});

test('the MOA constant of the template model is the exact K = 100 / 2.9089, not the empirical 34.3', () => {
  assert.equal(MOA_K, 1000000 / 29089);
  assert.ok(Math.abs(MOA_K - 34.3768) < 1e-3);
});

// ---- real data: the pinned capture (frontend/benchmarks/snapshot.json, restored from its hashed artifact, never regenerated) ----------

const SNAPSHOT_PATH = fileURLToPath(new URL('../../benchmarks/snapshot.json', import.meta.url));
const SNAPSHOT_SHA256 = '219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c';
const skip = existsSync(SNAPSHOT_PATH) ? false : 'frontend/benchmarks/snapshot.json is not restored (ADR 0013 section 1)';

test('real guns: the Fast LP text of the default, Tchebycheff and capped requests round-trips through the parser and HiGHS', { skip, timeout: 300_000 }, async () => {
  const bytes = readFileSync(SNAPSHOT_PATH);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), SNAPSHOT_SHA256, 'the snapshot must be the pinned artifact');
  const snapshot = JSON.parse(bytes.toString('utf8')) as { guns: { id: string; shortName: string }[]; mods: Record<string, unknown>[] };
  const lookup = buildItemLookup(snapshot.guns as never, snapshot.mods as never);
  const variants: Record<string, Partial<SolveParams>> = {
    default: {},
    tchebycheff: { useTchebycheff: true, idealPoint: { zE: 500, nadE: 100, zR: -300, nadR: 0, zP: 1000, nadP: 100000 } },
    capped: { maxMOA: 5, maxPrice: 300000, minMagCapacity: 20, maxRecoilV: 300, minSightingRange: 50 },
  };
  for (const shortName of ['M45A1', 'P226R', 'MP7A1', 'AK-74', 'M4A1']) {
    const gunEntry = snapshot.guns.find(g => g.shortName === shortName);
    assert.ok(gunEntry, `${shortName} is in the snapshot`);
    for (const [name, extra] of Object.entries(variants)) {
      const { lpString } = buildLP(fastParams(lookup, gunEntry.id, extra));
      assert.doesNotMatch(lpString, /x_-/, `${shortName} ${name}`);
      await assertRoundTrips(`${shortName} ${name}`, lpString);
    }
  }
});
