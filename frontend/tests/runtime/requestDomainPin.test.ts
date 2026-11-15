// The request domain, pinned. `requestDomainPin.golden.json` was captured from the code BEFORE the request fields were collapsed into one table
// (src/solver/domainFields.ts): commit 108300e, running requestDomainPin.collect.ts over the requests of requestDomainPin.corpus.ts. Everything that
// reads the domain must still produce exactly those outputs: the reuse keys (ADR 0001, ADR 0012 invalidation ledger), the witness scope of a MOA-floor
// witness (ADR 0013 section 5) and the solve parameters the worker hands to Optimize, to every target of an Explore sweep (the endpoints and the interior
// steps) and to the MOA floor. The golden file is never regenerated to make this pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectPin } from './requestDomainPin.collect';
import type { PinGolden } from './requestDomainPin.collect';

const golden = JSON.parse(readFileSync(new URL('./requestDomainPin.golden.json', import.meta.url), 'utf8')) as PinGolden;
const actual = await collectPin();

/** The same entries on both sides, each equal; the JSON round trip drops what JSON drops (undefined). */
function assertSame(got: Record<string, unknown>, expected: Record<string, unknown>): void {
  assert.deepEqual(Object.keys(got).sort(), Object.keys(expected).sort(), 'the same entries');
  for (const name of Object.keys(expected)) assert.deepEqual(JSON.parse(JSON.stringify(got[name])), expected[name], name);
}

test('the reuse key of every corpus request is the key it was before the request fields were collapsed', () => {
  assert.deepEqual(Object.keys(actual.keys).sort(), Object.keys(golden.keys).sort());
  for (const [name, key] of Object.entries(actual.keys)) assert.equal(key, golden.keys[name], name);
});

test('the witness scope of every corpus domain is the scope it was before the request fields were collapsed', () => {
  assertSame(actual.scopes, golden.scopes);
});

test('the worker hands every operation the solve parameters it handed before the request fields were collapsed, every Explore target included', () => {
  assertSame(actual.runtime, golden.runtime);
  // The sweeps really ran past their endpoints: an interior target is a solve after the first two.
  const sweeps = Object.entries(actual.runtime).filter(([name]) => name.includes(' | explore steps '));
  assert.ok(sweeps.length > 0);
  for (const [name, solves] of sweeps) assert.ok(solves.length > 2, `${name} launched ${solves.length} targets`);
});
