// The Fast contract on seeded worlds (Stage 3 workstream 3.4), through production's public `solve()` in Fast mode: plain worlds (`randomWorld`,
// every request feature the Fast rows state drawn at random: weights, Tchebycheff, caps, MOA, includes/excludes, stock, presets, barters, conflicts)
// and TED worlds (`randomTedWorld`: TrueErgo and/or Prevent Overswing near the 3 kg knee, gear modifier), each with one copy per part (the default,
// decision 2c) and with repeats allowed. Every published build passes the production validator, and every outcome is truthfully qualified
// (`fastContract.check.ts`). Worlds from the cyclic generator whose part graph has a cycle are refused as unsupported data.
//
// The last test proves the checker itself bites: tampered responses (a certificate, an infeasibility claim, a broken build, a repeated part under
// single copy, a published upper bound) are each reported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OptimizeResponse } from '../../src/api/client';
import { solve } from '../../src/solver/solver';
import { PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import type { RuntimeGuard } from '../../src/solver/runtimeGuard';
import type { SolveParams } from '../../src/solver/types';
import { checkFastContract, returnsBuild } from './fastContract.check';
import { randomTedWorld, randomWorld } from './randomWorlds';

const fastParams = (params: SolveParams, repeats: boolean): SolveParams => ({ ...params, preciseMode: false, precisionRequest: 'fast', allowRepeatedParts: repeats, timeLimitMs: 60_000 });

interface Tally { builds: number; outcomes: Map<string, number>; failures: string[] }

async function sweep(label: string, seeds: Iterable<number>, world: (seed: number) => SolveParams): Promise<Tally> {
  const tally: Tally = { builds: 0, outcomes: new Map(), failures: [] };
  for (const seed of seeds) {
    for (const repeats of [false, true]) {
      const params = fastParams(world(seed), repeats);
      const r = await solve(params);
      const key = `${r.status}/${r.physical_certificate}${r.reason ? ` (${r.reason})` : ''}`;
      tally.outcomes.set(key, (tally.outcomes.get(key) ?? 0) + 1);
      if (returnsBuild(r)) tally.builds++;
      const { violations } = checkFastContract(params, r);
      if (violations.length > 0) tally.failures.push(`${label} seed ${seed} ${repeats ? 'repeats' : 'single copy'}: ${violations.join(' | ')}`);
    }
  }
  return tally;
}

const show = (t: Tally) => [...t.outcomes].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('; ');
const range = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);

test('plain seeded worlds: every published Fast build validates and every outcome is approximate (150 seeds x 2 copy modes)', { timeout: 600_000 }, async t => {
  const tally = await sweep('plain', range(1, 150), seed => randomWorld(seed, false).params);
  t.diagnostic(`${tally.builds} builds; ${show(tally)}`);
  assert.deepEqual(tally.failures, []);
  assert.ok(tally.builds >= 80, `many worlds publish a build: ${tally.builds}`);
});

test('TED seeded worlds (TrueErgo / Prevent Overswing): every published Fast build validates, never overswings under Prevent Overswing, and is approximate (200 seeds x 2)', { timeout: 600_000 }, async t => {
  const tally = await sweep('ted', range(1, 200), seed => randomTedWorld(seed, false).params);
  t.diagnostic(`${tally.builds} builds; ${show(tally)}`);
  assert.deepEqual(tally.failures, []);
  assert.ok(tally.builds >= 200, `most worlds publish a build: ${tally.builds}`);
});

test('worlds from the cyclic generator: a cyclic world is refused as unsupported data, the rest honour the contract (40 seeds x 2, plain and TED)', { timeout: 600_000 }, async t => {
  const plain = await sweep('cyclic plain', range(1001, 1040), seed => randomWorld(seed, true).params);
  const ted = await sweep('cyclic ted', range(1001, 1040), seed => randomTedWorld(seed, true).params);
  t.diagnostic(`plain: ${show(plain)}`);
  t.diagnostic(`ted: ${show(ted)}`);
  assert.deepEqual([...plain.failures, ...ted.failures], []);
  const refused = [...plain.outcomes, ...ted.outcomes].filter(([k]) => k.includes(PUBLIC_REASONS.unsupportedCyclicPartGraph)).reduce((s, [, n]) => s + n, 0);
  assert.ok(refused >= 20, `the generator reaches cyclic part graphs: ${refused}`);
});

/** A guard whose cancel flag turns on at the `k`-th macrotask yield: interrupts a Fast search at a reproducible point. */
const cancelAtYield = (k: number): RuntimeGuard => {
  let yields = 0;
  return {
    deadline: performance.now() + 60_000,
    now: () => performance.now(),
    cancelled: () => yields >= k,
    yieldMacrotask: async () => {
      yields++;
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    },
  };
};

test('interrupted Fast searches (cancel at the k-th yield, a deadline already past): witnesses still validate, stops are feasible or incomplete with the factual reason', { timeout: 600_000 }, async t => {
  const outcomes = new Map<string, number>();
  const failures: string[] = [];
  const record = (label: string, params: SolveParams, r: OptimizeResponse) => {
    const key = `${r.status}/${r.physical_certificate}${r.reason ? ` (${r.reason})` : ''}`;
    outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
    const { violations } = checkFastContract(params, r);
    if (violations.length > 0) failures.push(`${label}: ${violations.join(' | ')}`);
  };
  for (let seed = 1; seed <= 40; seed++) {
    for (const repeats of [false, true]) {
      const base = fastParams(randomTedWorld(seed, false).params, repeats);
      for (const k of [1, 2, 3, 5, 8]) {
        const params: SolveParams = { ...base, timeLimitMs: undefined, guard: cancelAtYield(k) };
        record(`ted seed ${seed} ${repeats ? 'repeats' : 'single'} cancel@${k}`, params, await solve(params));
      }
    }
    const late = { ...fastParams(randomWorld(seed, false).params, false), timeLimitMs: undefined, guard: { ...cancelAtYield(1_000_000), deadline: performance.now() - 1 } };
    record(`plain seed ${seed} past deadline`, late, await solve(late));
  }
  t.diagnostic([...outcomes].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('; '));
  assert.deepEqual(failures, []);
  assert.ok([...outcomes.keys()].some(k => k.startsWith(`incomplete/none (${PUBLIC_REASONS.timeLimitReached}`)), 'the past deadline stops before any solve');
  assert.ok((outcomes.get(`feasible/feasible (${PUBLIC_REASONS.cancelledByUser})`) ?? 0) > 0, 'a cancel after a witness keeps it as feasible');
});

test('the checker reports every tampering of a valid Fast response', async () => {
  // a world that publishes a build in single-copy mode, with at least one placement
  let params: SolveParams | null = null;
  let r: OptimizeResponse | null = null;
  for (let seed = 1; seed <= 50 && r === null; seed++) {
    const p = fastParams(randomWorld(seed, false).params, false);
    const out = await solve(p);
    if (out.status === 'optimal' && out.slot_pairs.length >= 1) {
      params = p;
      r = out;
    }
  }
  assert.ok(params !== null && r !== null, 'a seeded world with a build');
  assert.deepEqual(checkFastContract(params, r).violations, [], 'the untouched response honours the contract');
  const tampered: [string, OptimizeResponse][] = [
    ['certified optimum', { ...r, physical_certificate: 'certified_optimal' }],
    ['infeasibility claim', { ...r, status: 'infeasible', physical_certificate: 'certified_infeasible', slot_pairs: [], selected_items: [], selected_item_ids: [], objective_value: null }],
    ['exact qualification', { ...r, model_qualification: 'exact' }],
    ['physical upper bound', { ...r, optimization: { ...r.optimization, upper_bound: 1, absolute_gap: 0 } }],
    ['unrooted placement', { ...r, slot_pairs: r.slot_pairs.map((p, i) => (i === 0 ? { ...p, parentInstanceId: 'nowhere' } : p)) }],
    ['missing single_copy', { ...r, single_copy: undefined }],
    ['repeated part under single copy', { ...r, slot_pairs: [...r.slot_pairs, r.slot_pairs[0]], selected_item_ids: [...r.selected_item_ids, r.slot_pairs[0].itemId] }],
    ['reason outside the closed set', { ...r, status: 'feasible', physical_certificate: 'feasible', reason: 'Timed out' }],
  ];
  for (const [name, response] of tampered) assert.ok(checkFastContract(params, response).violations.length > 0, name);
});
