// The certifiable count model (src/solver/physical/specializeCount.ts, the certified mode of specializeFast.ts; Phase 2.10, decision 2e): strict text that HiGHS
// reads back as written, the proof record every constructed row carries, the row families, the numerics shared with the occurrence model, the MOA rows that state
// the oracle's rule (the largest centre of impact binds), the preconditions asserted on the data (Lemma 1), and the refusals. The plain Fast model must stay what it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLpText } from '../../src/solver/native';
import {
  assertCountModelApplies, familyOfRow, PhysicalModelError, integerNoGood, preparePhysicalWeapon, prepareSubproblemDomain, specializeCount, specializeFast, type CountModel, type SpatialNode, type SpecializeRequest, type SubproblemDomain, type SubproblemRequest,
} from '../../src/solver/physical';
import { specializeLP } from './occurrence/specializeOccurrence';
import { ratCmp, ratFromDouble } from '../../src/solver/physical/exact';
import type { ItemLookup } from '../../src/solver/types';
import { barter, flea, gun, gunWith, lookupOf, mod, modWith, slot, trader, WEAPON } from './lpFixtures';
import { assertReadbackMatches, assertTextIsStrict } from './lpHarness';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import { solveOccurrence } from './occurrence/solveOccurrence';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';

type Request = SpecializeRequest & SubproblemRequest;

function count(lookup: ItemLookup, request: Request = {}, node?: SpatialNode): CountModel {
  const blueprint = preparePhysicalWeapon(lookup, WEAPON);
  const domain = prepareSubproblemDomain(blueprint, lookup, request);
  const model = specializeCount(blueprint, domain, request, node);
  assertTextIsStrict(model.lp());
  return model;
}

const rowsOf = (model: CountModel) => new Map(parseLpText(model.lp()).rows.map(r => [r.name, r]));
const proofRow = (model: CountModel, name: string) => model.proof.rows.find(r => r.row === name);

/** A world that touches every constructed row: recoil caps, MOA (replacement and fallback), Tchebycheff, presets, whole lots, conflicts, owned stock. */
const rich = (): ItemLookup => lookupOf(
  gunWith(WEAPON, {
    ergo: 3, weight: 1.5, recoilV: 100, recoilH: 50, coi: 0.0625,
    slots: [slot('s1', ['a', 'b'], true), slot('s2', ['a', 'c']), slot('s3', ['c'])],
    presets: [{ id: 'P', items: [{ itemId: 'a', count: 2 }] }],
  }),
  ['a', modWith('a', { ergo: 4, coi: 0.125, accuracy: 3, recoil: -0.05, weight: 0.5, offers: [trader('prapor', 1, 100), barter('mechanic', 1, 250, false, 3)], conflictsItems: ['b'] })],
  ['b', modWith('b', { ergo: 6, coi: 0.25, accuracy: -2, recoil: -0.1, weight: 1, offers: [flea(300)], conflictsSlots: ['s3'] })],
  ['c', modWith('c', { ergo: -2, recoil: 0.02, weight: 0.25, offers: [trader('skier', 1, 40)] })],
);

const caps: Request = { maxMOA: 5, maxPrice: 9000, minErgonomics: 1, maxWeight: 5, maxRecoilV: 120, maxRecoilSum: 190, minMagCapacity: 0, ergoWeight: 1, recoilWeight: 1, priceWeight: 1, barterAvailable: true };
const tchebycheff: Request = { ...caps, useTchebycheff: true, idealPoint: { zE: 300, nadE: 20, zR: -200, nadR: 10, zP: 100, nadP: 20000 } };

test('the certified text is strict and HiGHS reads back exactly what it states: weighted, Tchebycheff, a TED node, with cuts and with continuous slot edges', async () => {
  for (const [request, node] of [
    [caps, undefined],
    [tchebycheff, undefined],
    [{ ...caps, useTrueErgo: true, equipErgoModifier: -0.15, preventOverswing: true }, { weightMin: 3, weightMax: 4.2 }],
    [{ ...tchebycheff, useTrueErgo: true }, { weightMin: 1.5, weightMax: 3 }],
  ] as [Request, SpatialNode | undefined][]) {
    const model = count(rich(), request, node);
    assert.equal(model.certified, true);
    await assertReadbackMatches(model.lp());
    await assertReadbackMatches(model.lpRelaxedEdges());
    const cut = integerNoGood('ng', model.decision, Object.fromEntries(model.decision.map(d => [d.name, 0])));
    assert.ok(cut);
    await assertReadbackMatches(model.lp([cut]));
  }
});

test('the proof record: every padded row is a row of the text, dominated by its exact need; the objective, gear and secant are recorded; nothing is withheld', () => {
  const model = count(rich(), { ...caps, useTrueErgo: true, equipErgoModifier: -0.35 }, { weightMin: 3.05, weightMax: 3.2 });
  const rows = rowsOf(model);
  assert.equal(model.proof.withheld, null);
  assert.ok(model.proof.rows.length >= 4, 'two recoil caps and the MOA rows are constructed');
  for (const row of model.proof.rows) {
    const parsed = rows.get(row.row);
    assert.ok(parsed, `${row.row} is written`);
    const bound = row.relation === '>=' ? parsed.lower : parsed.upper;
    assert.equal(bound, row.emitted, `${row.row}: the parsed right-hand side is the emitted one`);
    assert.ok(row.relation === '>=' ? ratCmp(ratFromDouble(row.emitted), row.need) <= 0 : ratCmp(ratFromDouble(row.emitted), row.need) >= 0, `${row.row}: the emitted right-hand side dominates the exact need`);
  }
  assert.ok(proofRow(model, 'lim_recoil_v') && proofRow(model, 'lim_recoil_sum') && proofRow(model, 'moa_fallback'));
  assert.ok(model.proof.objective !== null && Number.isFinite(model.proof.objective.frameError) && model.proof.objective.terms.length === 3);
  assert.ok(model.proof.gear !== null, 'the gear factor of a TED request is recorded');
  assert.ok(model.proof.secant !== null && model.proof.secant.kind === 'secant' && model.proof.secant.weightMin === 3.05 && model.proof.secant.weightMax === 3.2, 'the node lies inside the active weight range [2, 3.25]');
  assert.ok(model.proof.secant.objectiveUnits !== null && model.proof.secant.objectiveUnits >= 0);
  // without TED there is neither
  const plain = count(rich(), caps);
  assert.equal(plain.proof.gear, null);
  assert.equal(plain.proof.secant, null);
});

test('every row belongs to a row family, the families add up to the rows written, and a constant-true request row is counted vacuous', () => {
  const model = count(rich(), tchebycheff);
  const families = model.rowFamilies;
  assert.equal(families.reduce((n, f) => n + f.count, 0), model.stats.rows, 'the accounting covers every row');
  for (const name of rowsOf(model).keys()) assert.doesNotThrow(() => familyOfRow(name), name);
  assert.throws(() => familyOfRow('mystery_row_1'), /belongs to no row family/);
  const byId = new Map(families.map(f => [f.id, f]));
  for (const id of ['base_choice', 'parentage', 'wallet', 'moa', 'objective', 'cap_recoil', 'first_clamp'] as const) assert.ok((byId.get(id)?.count ?? 0) > 0, id);
  assert.ok((byId.get('objective')?.constructionError ?? -1) >= 0 && (byId.get('moa')?.constructionError ?? -1) >= 0);
  assert.equal(byId.get('ted')?.count, 0, 'no TED rows without TED');
  // a minimum the receiver already meets is a constant-true row: counted vacuous, never written
  const vacuous = count(lookupOf(gunWith(WEAPON, { slots: [slot('s', ['a'])] }), ['a', mod('a')]), { minMagCapacity: 0 });
  assert.equal(rowsOf(vacuous).has('lim_mag'), false);
});

test('the constructed numerics are those of the occurrence model: recoil caps, MOA rows, objective coefficients, deviation rows, gear', () => {
  const lookup = rich();
  const blueprint = preparePhysicalWeapon(lookup, WEAPON);
  for (const request of [caps, tchebycheff, { ...caps, useTrueErgo: true, equipErgoModifier: -0.35 }] as Request[]) {
    const domain = prepareSubproblemDomain(blueprint, lookup, request);
    const node = request.useTrueErgo === true ? { weightMin: 3.05, weightMax: 3.2 } : undefined;
    if (request.useTrueErgo === true) assert.equal(specializeCount(blueprint, domain, request, node).provedEmpty, null, 'the node meets the active weight range');
    const occurrence = specializeLP(blueprint, domain, request, node);
    const countModel = specializeCount(blueprint, domain, request, node);
    const occurrenceRows = new Map(occurrence.proof.rows.map(r => [r.row, r]));
    for (const name of ['lim_recoil_v', 'lim_recoil_sum', 'tch_e', 'tch_r', 'tch_p']) {
      const a = occurrenceRows.get(name);
      const b = proofRow(countModel, name);
      assert.equal(b === undefined, a === undefined, name);
      if (a && b) {
        assert.equal(b.emitted, a.emitted, `${name}: emitted`);
        assert.equal(ratCmp(b.need, a.need), 0, `${name}: need`);
        assert.equal(b.relation, a.relation, name);
      }
    }
    // MOA: the row of a barrel template equals the row of its first active occurrence
    for (let t = 1; t < blueprint.templateCount; t++) {
      if (blueprint.templateCenterOfImpact[t] <= 0 || !countModel.graph.active[t]) continue;
      const v = blueprint.instancesOf(t).find(o => domain.occActive[o] === 1) as number;
      const a = occurrenceRows.get(`moa_rep_${v}`);
      const b = proofRow(countModel, `moa_rep_${t}`);
      assert.ok(a && b, `barrel template ${t}`);
      assert.equal(b.emitted, a.emitted);
      assert.equal(ratCmp(b.need, a.need), 0);
    }
    const fa = occurrenceRows.get('moa_fallback');
    const fb = proofRow(countModel, 'moa_fallback');
    assert.equal(fb?.emitted, fa?.emitted);
    // objective coefficients: the same exact targets, the same emitted doubles, the same axis scales and deviation rows
    const pa = occurrence.proof.objective;
    const pb = countModel.proof.objective;
    assert.ok(pa && pb);
    assert.deepEqual(pb.terms.map(t => [t.column, t.emitted]), pa.terms.map(t => [t.column, t.emitted]));
    assert.deepEqual(pb.axisScales.map(s => s.exponent), pa.axisScales.map(s => s.exponent));
    assert.deepEqual(pb.deviations.map(d => [d.axis, d.emitted, d.rhs.emitted]), pa.deviations.map(d => [d.axis, d.emitted, d.rhs.emitted]));
    assert.deepEqual(countModel.proof.gear, occurrence.proof.gear);
    assert.deepEqual(countModel.proof.secant?.line, occurrence.proof.secant?.line);
    assert.equal(countModel.proof.secant?.shift, occurrence.proof.secant?.shift);
    assert.equal(countModel.objective.weights.e, occurrence.objective.weights.e);
  }
});

test('the MOA rows state the oracle rule: the larger-centre-of-impact terms appear exactly when a negative cap and an accuracy sum above 100 percent can meet', () => {
  // b1 (centre of impact 1, accuracy +120) and b2 (0.5, accuracy 0) fit different root slots: installed together the sum is 120 percent points.
  const world = (accuracy: number, withB2 = true): ItemLookup => lookupOf(
    gunWith(WEAPON, { ergo: 50, slots: [slot('g0', ['b1']), ...(withB2 ? [slot('g1', ['b2'])] : [])] }),
    ['b1', modWith('b1', { coi: 1, accuracy, ergo: 10, offers: [trader('prapor', 1, 100)] })],
    ...(withB2 ? [['b2', modWith('b2', { coi: 0.5, accuracy: 0, ergo: 10, offers: [trader('prapor', 1, 100)] })] as [string, ReturnType<typeof modWith>]] : []),
  );
  const idx = (model: CountModel, id: string): number => model.blueprint.templateIndexOf(id);
  const dominated = count(world(120), { maxMOA: -5 });
  assert.equal(dominated.moaRows, 'dominance');
  const b1 = idx(dominated, 'b1');
  const b2 = idx(dominated, 'b2');
  const rows = rowsOf(dominated);
  const termsOf = (name: string): Map<string, number> => new Map(rows.get(name)?.terms ?? []);
  const larger = termsOf(`moa_rep_${b2}`);
  const bigM = Math.abs(larger.get(`n_${b2}`) as number);
  assert.ok(bigM > 0);
  assert.equal(larger.get(`n_${b1}`), bigM, 'the row of the SMALLER barrel is relaxed by M for the presence of the larger one');
  assert.equal(termsOf(`moa_rep_${b1}`).has(`n_${b2}`), false, 'the largest barrel has no dominating barrel');
  // every neighbouring regime states the plain rows
  for (const [label, model] of [
    ['cap above zero', count(world(120), { maxMOA: 5 })],
    ['cap at zero', count(world(120), { maxMOA: 0 })],
    ['accuracy sum at most 100', count(world(80), { maxMOA: -5 })],
    ['one barrel', count(world(120, false), { maxMOA: -5 })],
  ] as [string, CountModel][]) {
    assert.equal(model.moaRows, 'plain', label);
    const t = rowsOf(model);
    for (const [name, row] of t) if (name.startsWith('moa_rep_')) assert.equal(row.terms.length, 2, `${label}: ${name} states only the accuracy sum and its own presence`);
  }
  // `always` states the terms on a model that does not need them, and the model is still exact: same optimum as the plain rows
  const lookup = world(80);
  const blueprint = preparePhysicalWeapon(lookup, WEAPON);
  const domain = prepareSubproblemDomain(blueprint, lookup, {});
  assert.equal(specializeCount(blueprint, domain, { maxMOA: -5 }, undefined, { moaDominance: 'always' }).moaRows, 'dominance');
  // no cap, no MOA rows, no mode
  assert.equal(count(world(120), {}).moaRows, null);
});

test('the build the plain Fast rows lose is found: {b1, b2} meets a cap of -5 at accuracy 120 on the certified model, and equals the occurrence model', async () => {
  const lookup = lookupOf(
    gunWith(WEAPON, { ergo: 50, slots: [slot('g0', ['b1']), slot('g1', ['b2'])] }),
    ['b1', modWith('b1', { coi: 1, accuracy: 120, ergo: 10, offers: [trader('prapor', 1, 100)] })],
    ['b2', modWith('b2', { coi: 0.5, accuracy: 0, ergo: 10, offers: [trader('prapor', 1, 100)] })],
  );
  const params = { weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup), ergoWeight: 1, recoilWeight: 0, priceWeight: 0, maxMOA: -5, objectiveTolerance: 1e-9 };
  const run = await solvePrecise({ params, deadline: performance.now() + 60_000 });
  assert.equal(run.kind, 'build');
  assert.equal(run.kind === 'build' && run.certified, true);
  assert.deepEqual(run.kind === 'build' ? run.best.build.placements.map(p => p.itemId).sort() : [], ['b1', 'b2']);
  const occurrence = await solveOccurrence({ params, deadline: performance.now() + 60_000 });
  assert.equal(occurrence.kind, 'build');
  assert.deepEqual(occurrence.kind === 'build' ? occurrence.best.build.placements.map(p => p.itemId).sort() : [], ['b1', 'b2'], 'the occurrence model states the same rule');
});

const isCode = (code: string) => (e: unknown): boolean => e instanceof PhysicalModelError && e.code === code;

test('the preconditions are asserted on the data: path-independent candidates pass; an empty domain and a foreign domain throw', () => {
  const acyclic = lookupOf(gun(WEAPON, { slots: [slot('s0', ['A'])] }), ['A', mod('A', { slots: [slot('s1', ['B'])] })], ['B', mod('B')]);
  const bp = preparePhysicalWeapon(acyclic, WEAPON);
  const domain = prepareSubproblemDomain(bp, acyclic, {});
  const ok = assertCountModelApplies(bp, domain);
  assert.ok(ok.slotsChecked >= 2);
  assert.equal(assertCountModelApplies(bp, domain), ok, 'memoized per domain');

  const noBase = lookupOf(gun(WEAPON, { offers: [], slots: [slot('s', ['a'])] }), ['a', mod('a')]);
  const ebp = preparePhysicalWeapon(noBase, WEAPON);
  const edomain = prepareSubproblemDomain(ebp, noBase, {});
  assert.throws(() => assertCountModelApplies(ebp, edomain), isCode('DOMAIN_INCONSISTENT'), 'an empty domain has no count model to check');
  const empty = specializeCount(ebp, edomain, {});
  assert.equal(empty.provedEmpty?.source, 'domain');
  assert.equal(empty.certified, true);
  assert.equal(empty.proof.withheld, null);

  const other = preparePhysicalWeapon(acyclic, WEAPON);
  assert.throws(() => assertCountModelApplies(other, domain), /was not prepared from the blueprint/);
});

test('Lemma 1 is verified, not trusted: masking one candidate occurrence under one of two copies of a template fails the assertion (a fault, never a fallback)', () => {
  // T hangs under two hosts (P1 in g0, P2 in g1) and owns the slot `ts` for X: two occurrences of T, each with an X candidate.
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('g0', ['P1']), slot('g1', ['P2'])] }),
    ['P1', mod('P1', { slots: [slot('p1', ['T'])] })],
    ['P2', mod('P2', { slots: [slot('p2', ['T'])] })],
    ['T', mod('T', { slots: [slot('ts', ['X'])] })],
    ['X', mod('X')],
  );
  const bp = preparePhysicalWeapon(lookup, WEAPON);
  const domain = prepareSubproblemDomain(bp, lookup, {});
  assert.ok(assertCountModelApplies(bp, domain).slotsChecked > 0);
  const occurrencesOfX = bp.instancesOf(bp.templateIndexOf('X')).filter(o => domain.occActive[o] === 1);
  assert.equal(occurrencesOfX.length, 2);
  const mask = Uint8Array.from(domain.occActive);
  mask[occurrencesOfX[0]] = 0;
  const tampered: SubproblemDomain = { ...domain, occActive: mask };
  assert.throws(() => assertCountModelApplies(bp, tampered), (e: unknown) => isCode('DOMAIN_INCONSISTENT')(e) && /depend on the path/.test((e as Error).message));
  assert.throws(() => specializeCount(bp, tampered, {}), isCode('DOMAIN_INCONSISTENT'), 'no certified model is built on it');
});

test('a certified model allows every repeat: the singleCopy restriction of Fast is not read; the plain Fast model is unchanged by the option existing', () => {
  const lookup = lookupOf(gun(WEAPON, { slots: [slot('s1', ['a']), slot('s2', ['a']), slot('s3', ['a'])] }), ['a', mod('a', { ergo: 1, offers: [trader('prapor', 1, 10)] })]);
  const blueprint = preparePhysicalWeapon(lookup, WEAPON);
  const domain = prepareSubproblemDomain(blueprint, lookup, {});
  const a = blueprint.templateIndexOf('a');
  const repeated = specializeCount(blueprint, domain, { singleCopy: true });
  assert.equal(repeated.singleCopy, false);
  assert.equal(repeated.graph.maxCopies[a], 3);
  assert.equal(repeated.lpBase, specializeCount(blueprint, domain, {}).lpBase, 'singleCopy changes nothing in a certified model');
  const plain = specializeFast(blueprint, domain, { singleCopy: true });
  assert.equal(plain.singleCopy, true);
  assert.equal(plain.certified, false);
  assert.equal(plain.proof, null);
  assert.equal(plain.rowFamilies, null);
  assert.equal(plain.moaRows, null);
});

test('a certified LP never carries a legacy remnant: no 1000 Big-M literal, no rounded coefficient, no stand-in price, no x_-1; every auxiliary column is finite', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['a', 'host']), slot('s2', ['a'])] }),
    ['a', mod('a', { ergo: 0.123456789, recoil: -0.0123456789, weight: 0.0123456789, offers: [trader('prapor', 1, 123)] })],
    ['host', mod('host', { slots: [slot('r', ['a'], true)], offers: [barter('mechanic', 1, 777)] })],
  );
  const model = count(lookup, { barterAvailable: true, priceWeight: 1, useTrueErgo: true });
  assert.doesNotMatch(model.lpBase, /x_-/);
  assert.doesNotMatch(model.lpBase, /50000000|100000000/);
  assert.match(model.lpBase, /0\.123456789/, 'full-precision coefficients, no toFixed(6)');
  assert.match(model.lpBase, /0\.0123456789/);
  const parsed = parseLpText(model.lpBase);
  for (const column of parsed.columns) {
    assert.ok(Number.isFinite(column.lower) && Number.isFinite(column.upper), `${column.name} has a finite domain`);
  }
  assert.equal(model.matrixFilterRisk, false);
});
