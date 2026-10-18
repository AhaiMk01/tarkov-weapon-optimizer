// TrueErgo and Prevent Overswing in the Fast (count) model, on a weight node (Phase 2.6b; src/solver/physical/specializeFast.ts): the rows of a node,
// exactness on a singleton or a light interval, the secant relaxation elsewhere, the 3 kg knee, the gear factor, finite auxiliary domains, strict text,
// and agreement with the Precise model on the same node (the count model carries total weight exactly, so a node means the same in both).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLpText } from '../../src/solver/native';
import {
  preparePhysicalWeapon, prepareSubproblemDomain, secantOfPenalty, specializeFast, weightPenalty, type FastModel, type SpatialNode, type SpecializeRequest, type SubproblemRequest,
} from '../../src/solver/physical';
import { specializeLP } from './occurrence/specializeOccurrence';
import type { ItemLookup } from '../../src/solver/types';
import { gun, lookupOf, mod, slot, WEAPON } from './lpFixtures';
import { assertReadbackMatches, assertTextIsStrict, solveLp } from './lpHarness';

type Request = SpecializeRequest & SubproblemRequest;

function fast(lookup: ItemLookup, request: Request, node?: SpatialNode): FastModel {
  const blueprint = preparePhysicalWeapon(lookup, WEAPON);
  const domain = prepareSubproblemDomain(blueprint, lookup, request);
  const model = specializeFast(blueprint, domain, request, node);
  assertTextIsStrict(model.lp());
  return model;
}

/** The same node, the Precise model: its LP text solved on the same native build. */
function preciseText(lookup: ItemLookup, request: Request, node?: SpatialNode): string {
  const blueprint = preparePhysicalWeapon(lookup, WEAPON);
  const domain = prepareSubproblemDomain(blueprint, lookup, request);
  return specializeLP(blueprint, domain, request, node).lp;
}

const rowsOf = (model: FastModel) => new Map(parseLpText(model.lp()).rows.map(r => [r.name, r]));
const ted = { ergoWeight: 1, recoilWeight: 0, useTrueErgo: true } as const;
const overswing = { ergoWeight: 1, recoilWeight: 0, preventOverswing: true } as const;
const close = (actual: number, expected: number, tolerance = 1e-7): void => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

/** Receiver 4 kg, ergonomics 50; part `a` adds 1 kg and 10 ergonomics. */
const heavy = (): ItemLookup => lookupOf(gun(WEAPON, { weight: 4, ergo: 50, slots: [slot('s', ['a'])] }), ['a', mod('a', { weight: 1, ergo: 10 })]);
/** Builds weigh 4, 4.5 (h or g) or 5 kg: the chord of q on [4, 5] is used on the root. */
const secantWorld = (): ItemLookup => lookupOf(
  gun(WEAPON, { weight: 4, ergo: 50, slots: [slot('s1', ['h']), slot('s2', ['g'])] }),
  ['h', mod('h', { weight: 0.5, ergo: 10 })],
  ['g', mod('g', { weight: 0.5, ergo: -30 })],
);

test('the rows of a TrueErgo node: the weight node, the gear factor and second clamp, the penalty line, and the ergonomics frame read from TED', async () => {
  const node = { weightMin: 4.2, weightMax: 4.8 };
  const model = fast(secantWorld(), ted, node);
  const rows = rowsOf(model);
  assert.deepEqual([...rows.keys()].filter(name => /^(node_|gear_def|ted_def|lim_overswing)/.test(name)), ['node_lo', 'node_hi', 'gear_def', 'ted_def']);
  const penalty = secantOfPenalty(4.2, 4.8);
  assert.equal(penalty.kind, 'secant');
  const row = rows.get('ted_def');
  assert.deepEqual([...(row?.terms ?? [])].sort(), [['eff_ergo', -1], ['ted', 1], ['weight', penalty.line.slope]].sort(), 'ted = eff - (slope W + intercept)');
  assert.equal(row?.lower, -penalty.line.intercept);
  assert.equal(row?.upper, -penalty.line.intercept);
  assert.deepEqual(rows.get('node_lo')?.lower, 4.2);
  assert.deepEqual(rows.get('node_hi')?.upper, 4.8);
  assert.deepEqual(rows.get('ergo_frame')?.terms.map(t => t[0]).sort(), ['ergo_axis', 'ted'], 'fE = 10 x TED under TrueErgo');
  assert.equal(model.objective.ergoSource, 'ted');
  assert.equal(model.exact, false, 'a secant node is a relaxation');
  assert.equal(model.spatial?.penalty.kind, 'secant');
  assert.deepEqual([model.spatial?.weightMin, model.spatial?.weightMax], [4.2, 4.8]);
  assert.equal(model.provedEmpty, null);
  await assertReadbackMatches(model.lp());
});

test('every auxiliary column of a TED node has a finite domain that encloses its values, and the line cannot leave the TED range', () => {
  const model = fast(secantWorld(), ted, { weightMin: 4.2, weightMax: 4.8 });
  const parsed = parseLpText(model.lp());
  const column = (name: string) => parsed.columns.find(c => c.name === name);
  for (const c of parsed.columns) assert.ok(Number.isFinite(c.lower) && Number.isFinite(c.upper), `${c.name} has a finite domain`);
  // ted = eff - line(W) over the node: the line is increasing, so its range on [4.2, 4.8] is [line(4.2), line(4.8)].
  const line = secantOfPenalty(4.2, 4.8).line;
  const at = (w: number): number => line.slope * w + line.intercept;
  const tedColumn = column('ted');
  const eff = column('eff_ergo');
  assert.ok(tedColumn && eff);
  assert.ok(tedColumn.lower <= eff.lower - at(4.8) && tedColumn.upper >= eff.upper - at(4.2), `ted [${tedColumn.lower}, ${tedColumn.upper}] encloses eff [${eff.lower}, ${eff.upper}] minus the line`);
  assert.ok(eff.lower >= 0 && eff.upper <= 100, 'the second clamp keeps eff in [0, 100]');
  assert.ok(column('gear_ergo') && column('eff_ergo'));
});

test('Prevent Overswing alone: TED >= 0 as a row, the objective keeps reading the first clamp, no TED in the frame', () => {
  const model = fast(secantWorld(), overswing, { weightMin: 4, weightMax: 5 });
  const rows = rowsOf(model);
  assert.equal(rows.get('lim_overswing')?.lower, 0);
  assert.deepEqual(rows.get('lim_overswing')?.terms, [['ted', 1]]);
  assert.deepEqual(rows.get('ergo_frame')?.terms.map(t => t[0]).sort(), ['capped_ergo', 'ergo_axis']);
  assert.equal(model.objective.ergoSource, 'capped_ergo');
  assert.equal(model.exact, false);
  // TrueErgo alone states no overswing row
  assert.equal(rowsOf(fast(secantWorld(), ted, { weightMin: 4, weightMax: 5 })).has('lim_overswing'), false);
});

test('penalty kinds: zero up to 3 kg, a constant at one weight, the chord on a concave piece, the zero line across the knee; no node states the whole active range', () => {
  const light = fast(lookupOf(gun(WEAPON, { weight: 1, ergo: 50, slots: [slot('s', ['a'])] }), ['a', mod('a', { weight: 1, ergo: 10 })]), ted);
  assert.equal(light.spatial?.penalty.kind, 'zero_exact');
  assert.equal(light.exact, true, 'every build weighs at most 3 kg: exact with no node');
  assert.deepEqual(light.spatial?.penalty.line, { slope: 0, intercept: 0 });
  const singleton = fast(heavy(), ted, { weightMin: 5, weightMax: 5 });
  assert.equal(singleton.spatial?.penalty.kind, 'constant_exact');
  assert.equal(singleton.exact, true);
  assert.ok(rowsOf(singleton).has('node_fix'));
  assert.equal(rowsOf(singleton).get('node_fix')?.lower, 5);
  assert.equal(singleton.spatial?.penalty.line.intercept, weightPenalty(5));
  const chord = fast(secantWorld(), ted, { weightMin: 4, weightMax: 5 });
  assert.equal(chord.spatial?.penalty.kind, 'secant');
  assert.equal(chord.exact, false);
  const kneeWorld = lookupOf(gun(WEAPON, { weight: 2, ergo: 50, slots: [slot('s', ['a'])] }), ['a', mod('a', { weight: 2, ergo: 10 })]);
  const knee = fast(kneeWorld, ted);
  assert.equal(knee.spatial?.penalty.kind, 'knee_zero_relaxation', 'the active weights 2 .. 4 cross 3 kg');
  assert.equal(knee.exact, false);
  assert.deepEqual(knee.spatial?.penalty.line, { slope: 0, intercept: 0 });
  const atKnee = fast(kneeWorld, ted, { weightMin: 3, weightMax: 4 });
  assert.equal(atKnee.spatial?.penalty.kind, 'secant', 'a node that starts at 3 kg is a concave piece');
  assert.deepEqual(atKnee.spatial?.penalty.line, secantOfPenalty(3, 4).line);
});

test('a node outside every build weight is a contradiction of the request, and a request that reads no TED ignores a node', () => {
  const outside = fast(heavy(), ted, { weightMin: 10, weightMax: 12 });
  assert.equal(outside.provedEmpty?.source, 'request');
  assert.match(outside.provedEmpty?.reasons.join(';') ?? '', /weight node/);
  assert.ok(rowsOf(outside).has('contra_0'));
  const plain = fast(heavy(), { ergoWeight: 1, recoilWeight: 0 }, { weightMin: 100, weightMax: 200 });
  assert.equal(plain.spatial, null);
  assert.equal(plain.exact, true);
  assert.equal(plain.provedEmpty, null);
  // ... also when a weight cap alone puts the weight column in the model
  const capped = fast(heavy(), { ergoWeight: 1, recoilWeight: 0, maxWeight: 5 }, { weightMin: 100, weightMax: 200 });
  assert.equal(capped.provedEmpty, null);
  assert.equal(capped.spatial, null);
  assert.ok(rowsOf(capped).has('lim_weight') && !rowsOf(capped).has('node_lo'));
  assert.ok(!rowsOf(plain).has('ted_def') && !rowsOf(plain).has('node_lo') && !rowsOf(plain).has('gear_def'));
  assert.equal(plain.objective.ergoSource, 'capped_ergo');
});

test('the gear factor is one equality when representable and two neighbouring inequalities when it is not', () => {
  const exactFactor = rowsOf(fast(secantWorld(), { ...ted, equipErgoModifier: 0.5 }, { weightMin: 4, weightMax: 5 }));
  assert.ok(exactFactor.has('gear_def') && !exactFactor.has('gear_def_lo') && !exactFactor.has('gear_def_hi'));
  assert.equal(exactFactor.get('gear_def')?.terms.find(t => t[0] === 'capped_ergo')?.[1], -1.5);
  const inexact = rowsOf(fast(secantWorld(), { ...ted, equipErgoModifier: -0.2 }, { weightMin: 4, weightMax: 5 }));
  assert.ok(!inexact.has('gear_def') && inexact.has('gear_def_lo') && inexact.has('gear_def_hi'), '1 - 0.2 is not a double');
  const low = -(inexact.get('gear_def_lo')?.terms.find(t => t[0] === 'capped_ergo')?.[1] ?? 0);
  const high = -(inexact.get('gear_def_hi')?.terms.find(t => t[0] === 'capped_ergo')?.[1] ?? 0);
  assert.ok(low <= 0.8 && 0.8 <= high && low < high && high - low <= 2.3e-16, 'the neighbours enclose the real factor 0.8');
  // a factor below zero is floored at zero (the equality with factor 0 drops its term: the row fixes gear_ergo at 0)
  const floored = rowsOf(fast(secantWorld(), { ...ted, equipErgoModifier: -3 }, { weightMin: 4, weightMax: 5 }));
  assert.deepEqual(floored.get('gear_def')?.terms, [['gear_ergo', 1]]);
});

/** The Fast node and the Precise node have the same optimum (and the same verdict), on the same native build. */
async function sameNode(lookup: ItemLookup, request: Request, node?: SpatialNode): Promise<number | null> {
  const model = fast(lookup, request, node);
  await assertReadbackMatches(model.lp());
  const f = await solveLp(model.lp());
  const p = await solveLp(preciseText(lookup, request, node));
  assert.equal(f.status, p.status, `${JSON.stringify(node)}: Fast ${f.status}, Precise ${p.status}`);
  if (p.status !== 'Optimal') return null;
  close(f.objective, p.objective);
  return f.objective;
}

test('a Fast node has the Precise node optimum: singletons, a secant node, the knee, the whole range, with and without a gear modifier', async () => {
  const request = [ted, overswing, { ...ted, preventOverswing: true }, { ...ted, equipErgoModifier: -0.2 }, { ...overswing, equipErgoModifier: 0.3 }];
  for (const r of request) {
    for (const node of [undefined, { weightMin: 4, weightMax: 4 }, { weightMin: 5, weightMax: 5 }, { weightMin: 4.5, weightMax: 4.5 }, { weightMin: 4, weightMax: 5 }]) {
      await sameNode(heavy(), r, node);
      await sameNode(secantWorld(), r, node);
    }
  }
  const kneeWorld = lookupOf(gun(WEAPON, { weight: 2, ergo: 50, slots: [slot('s', ['a'])] }), ['a', mod('a', { weight: 2, ergo: 10 })]);
  for (const node of [undefined, { weightMin: 2, weightMax: 3 }, { weightMin: 3, weightMax: 4 }, { weightMin: 2.5, weightMax: 3.5 }]) await sameNode(kneeWorld, ted, node);
});

test('a secant node never underestimates the best exact TED of its builds, and is exact at the node ends', async () => {
  // Builds: bare (W 4, ergonomics 50), h or g (W 4.5, ergonomics 60 or 20), both (W 5, ergonomics 30). The chord of [4, 5] is 15 W - 35.
  const lookup = secantWorld();
  const objective = await sameNode(lookup, ted, { weightMin: 4, weightMax: 5 });
  assert.ok(objective !== null);
  const exactBest = Math.max(50 - weightPenalty(4), 60 - weightPenalty(4.5), 20 - weightPenalty(4.5), 30 - weightPenalty(5));
  assert.ok(objective >= exactBest - 1e-9, `the node bound ${objective} is below the exact optimum ${exactBest}`);
  close(objective, 60 - 32.5, 1e-7); // the chord credits h with 60 - 32.5 where its true TED is 26.67
  // an end of the node: the chord is exact there, so a singleton at that weight gives the exact value
  close((await sameNode(lookup, ted, { weightMin: 5, weightMax: 5 })) ?? Number.NaN, 30 - weightPenalty(5), 1e-7);
});

test('Prevent Overswing at its boundary: TED of exactly 0 is feasible, a hair less is not, and the same on the Precise node', async () => {
  // Receiver 6 kg: q(6) = 50. Ergonomics 50 gives TED 0 (allowed), 49.99 gives -0.01 (prevented).
  const at = (ergo: number): ItemLookup => lookupOf(gun(WEAPON, { weight: 6, ergo, slots: [slot('s', ['a'])] }), ['a', mod('a', { weight: 0, ergo: 0 })]);
  close((await sameNode(at(50), overswing, { weightMin: 6, weightMax: 6 })) ?? Number.NaN, 50, 1e-9);
  assert.equal(await sameNode(at(49.99), overswing, { weightMin: 6, weightMax: 6 }), null, 'TED 0 is not overswinging, TED -0.01 is');
  close((await sameNode(at(50), overswing)) ?? Number.NaN, 50, 1e-9);
  assert.equal(await sameNode(at(49.99), overswing), null, 'the whole range holds the single weight 6');
  // exactly 3 kg: q = 0, so any ergonomics (even 0) is allowed; just above the knee is a concave piece
  const knee = lookupOf(gun(WEAPON, { weight: 3, ergo: 0, slots: [slot('s', ['a'])] }), ['a', mod('a', { weight: 0.5, ergo: 0 })]);
  assert.notEqual(await sameNode(knee, overswing, { weightMin: 3, weightMax: 3 }), null);
  assert.equal(await sameNode(knee, overswing, { weightMin: 3.5, weightMax: 3.5 }), null, 'at 3.5 kg q = 14.3 and the ergonomics are 0');
});
