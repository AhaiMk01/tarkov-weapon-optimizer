import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareReadback, parseLpText, type ExpectedModel } from '../../src/solver/native';
import {
  preparePhysicalWeapon, prepareSubproblemDomain, specializeCount, specializeFast, validatePhysicalBuild,
  type FastModel, type SpecializeRequest, type SubproblemRequest,
} from '../../src/solver/physical';
import { computeActiveBounds } from '../../src/solver/physical/bounds';
import {
  RAT_ZERO, ratAdd, ratCmp, ratDiv, ratFromDouble, ratInt, ratMax, ratMin, ratMul, ratSub, type Rat,
} from '../../src/solver/physical/exact';
import { nextDown, nextUp } from '../../src/solver/physical/numeric';
import { HIGHS_SMALL_MATRIX_VALUE } from '../../src/solver/physical/proof';
import { nativeSolve, nativeSolveOptions } from '../../src/solver/physical/nativeSolve';
import { assessNativeResult } from '../../src/solver/physical/nativeProof';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import { gun, lookupOf, mod, slot, WEAPON } from './lpFixtures';
import { withRows } from './lpHarness';
import type { ItemLookup, ModLookupEntry } from '../../src/solver/types';
import { randomWorld } from './randomWorlds';

const R = ratFromDouble;
const neg = (value: Rat): Rat => ratSub(RAT_ZERO, value);
const clip = (value: Rat): Rat => ratMin(ratInt(100), ratMax(RAT_ZERO, value));
const zeroWeights = { ergoWeight: 0, recoilWeight: 0, priceWeight: 0 } as const;

function world(receiver: number, ...parts: number[]): ItemLookup {
  return lookupOf(
    gun(WEAPON, { ergo: receiver, slots: parts.map((_, k) => slot(`s${k}`, [`p${k}`])) }),
    ...parts.map((ergo, k): [string, ModLookupEntry] => [`p${k}`, mod(`p${k}`, { ergo })]),
  );
}

function models(lookup: ItemLookup, request: SpecializeRequest & SubproblemRequest = zeroWeights): FastModel[] {
  const bp = preparePhysicalWeapon(lookup, WEAPON);
  const domain = prepareSubproblemDomain(bp, lookup, request);
  return [specializeFast(bp, domain, request), specializeCount(bp, domain, request)];
}

function clampPart(model: FastModel, prefix: 'c1' | 'c2'): ExpectedModel {
  const parsed = parseLpText(model.lp());
  const source = prefix === 'c1' ? 'raw_ergo' : 'gear_ergo';
  const target = prefix === 'c1' ? 'capped_ergo' : 'eff_ergo';
  const rows = parsed.rows.filter(row => row.name.startsWith(`${prefix}_`));
  const names = new Set([source, target, ...rows.flatMap(row => row.terms.map(([name]) => name))]);
  return { ...parsed, rows, columns: parsed.columns.filter(column => names.has(column.name)) };
}

interface Inequality {
  terms: Map<string, Rat>;
  rhs: Rat;
}

function projectTargetRangeExactly(part: ExpectedModel, source: string, target: string, value: Rat, state: number): { lo: Rat; hi: Rat } | null {
  const fixed = new Map<string, Rat>([[source, value]]);
  const binaries = part.columns.filter(column => column.integer);
  binaries.forEach((column, k) => fixed.set(column.name, ratInt((state >> k) & 1)));
  let rows: Inequality[] = [];
  const add = (terms: readonly (readonly [string, number])[], rhs: number, sign: number): void => {
    const coefficients = new Map<string, Rat>();
    let bound = ratMul(R(rhs), ratInt(sign));
    for (const [name, coefficient] of terms) {
      const a = ratMul(R(coefficient), ratInt(sign));
      const f = fixed.get(name);
      if (f !== undefined) bound = ratSub(bound, ratMul(a, f));
      else if (a.n !== 0n) coefficients.set(name, a);
    }
    rows.push({ terms: coefficients, rhs: bound });
  };
  for (const column of part.columns) {
    assert.ok(Number.isFinite(column.lower) && Number.isFinite(column.upper), column.name);
    add([[column.name, 1]], column.upper, 1);
    add([[column.name, 1]], column.lower, -1);
  }
  for (const row of part.rows) {
    if (Number.isFinite(row.upper)) add(row.terms, row.upper, 1);
    if (Number.isFinite(row.lower)) add(row.terms, row.lower, -1);
  }
  const contradiction = (): boolean => rows.some(row => row.terms.size === 0 && row.rhs.n < 0n);
  for (const column of part.columns) {
    if (fixed.has(column.name) || column.name === target) continue;
    if (contradiction()) return null;
    const positive = rows.filter(row => (row.terms.get(column.name)?.n ?? 0n) > 0n);
    const negative = rows.filter(row => (row.terms.get(column.name)?.n ?? 0n) < 0n);
    const kept = rows.filter(row => !row.terms.has(column.name));
    for (const p of positive) {
      for (const n of negative) {
        const pa = p.terms.get(column.name)!;
        const na = neg(n.terms.get(column.name)!);
        const terms = new Map<string, Rat>();
        for (const name of new Set([...p.terms.keys(), ...n.terms.keys()])) {
          if (name === column.name) continue;
          const coefficient = ratAdd(ratDiv(p.terms.get(name) ?? RAT_ZERO, pa), ratDiv(n.terms.get(name) ?? RAT_ZERO, na));
          if (coefficient.n !== 0n) terms.set(name, coefficient);
        }
        kept.push({ terms, rhs: ratAdd(ratDiv(p.rhs, pa), ratDiv(n.rhs, na)) });
      }
    }
    rows = kept;
  }
  if (contradiction()) return null;
  const domain = part.columns.find(column => column.name === target)!;
  let lo = R(domain.lower);
  let hi = R(domain.upper);
  for (const row of rows) {
    const a = row.terms.get(target);
    if (a === undefined) continue;
    const endpoint = ratDiv(row.rhs, a);
    if (a.n > 0n) hi = ratMin(hi, endpoint);
    else lo = ratMax(lo, endpoint);
  }
  return ratCmp(lo, hi) <= 0 ? { lo, hi } : null;
}

function assertGraph(model: FastModel, prefix: 'c1' | 'c2'): void {
  const part = clampPart(model, prefix);
  const source = prefix === 'c1' ? 'raw_ergo' : 'gear_ergo';
  const target = prefix === 'c1' ? 'capped_ergo' : 'eff_ergo';
  const domain = part.columns.find(column => column.name === source)!;
  const output = part.columns.find(column => column.name === target)!;
  assert.equal(output.lower, Math.min(100, Math.max(0, domain.lower)));
  assert.equal(output.upper, Math.min(100, Math.max(0, domain.upper)));
  for (const row of part.rows) {
    assert.equal(new Set(row.terms.map(([name]) => name)).size, row.terms.length);
    for (const [, coefficient] of row.terms) assert.ok(Math.abs(coefficient) > HIGHS_SMALL_MATRIX_VALUE, `${row.name}: ${coefficient} survives filtering`);
  }
  const lo = R(domain.lower);
  const hi = R(domain.upper);
  const samples = [lo, hi, ratDiv(ratAdd(lo, hi), ratInt(2))];
  for (const boundary of [0, 100]) {
    for (const point of [nextDown(boundary), boundary, nextUp(boundary)]) {
      if (point >= domain.lower && point <= domain.upper) samples.push(R(point));
    }
  }
  for (const threshold of [RAT_ZERO, ratInt(100)]) {
    if (ratCmp(lo, threshold) < 0 && ratCmp(threshold, hi) < 0) {
      samples.push(ratDiv(ratAdd(lo, threshold), ratInt(2)), ratDiv(ratAdd(threshold, hi), ratInt(2)));
    }
  }
  const selectors = part.columns.filter(column => column.integer).length;
  for (const sample of samples) {
    let lifts = 0;
    for (let state = 0; state < 2 ** selectors; state++) {
      const range = projectTargetRangeExactly(part, source, target, sample, state);
      if (range === null) continue;
      lifts++;
      assert.equal(ratCmp(range.lo, clip(sample)), 0, `${prefix}: projection lower endpoint`);
      assert.equal(ratCmp(range.hi, clip(sample)), 0, `${prefix}: projection upper endpoint`);
    }
    assert.ok(lifts > 0, `${prefix}: every source point has a finite lift`);
  }
}

const regimes = [
  { label: 'zero', lookup: () => world(-10, 1), binaries: 0 },
  { label: 'constant', lookup: () => world(110, 1), binaries: 0 },
  { label: 'identity', lookup: () => world(37, 1), binaries: 0 },
  { label: 'lower', lookup: () => world(-5, 10), binaries: 1 },
  { label: 'upper', lookup: () => world(99, 2), binaries: 1 },
  { label: 'full', lookup: () => world(-5, 110), binaries: 3 },
] as const;

test('both public count specializers preserve the exact finite clamp graph in every regime', () => {
  for (const regime of regimes) {
    const pair = models(regime.lookup());
    for (const model of pair) {
      const part = clampPart(model, 'c1');
      assert.equal(part.columns.filter(column => column.integer).length, regime.binaries, regime.label);
      assertGraph(model, 'c1');
      if (model.certified) {
        assert.equal(model.rowFamilies?.reduce((sum, family) => sum + family.count, 0), model.stats.rows);
        assert.equal(model.rowFamilies?.find(family => family.id === 'first_clamp')?.constructionError, 0);
      }
    }
  }
});

test('closed thresholds, signed zero, fractional widths and subnormal endpoints keep every exact lift', () => {
  const tiny = Number.MIN_VALUE;
  const lookups = [
    world(-0), world(0), world(100), world(nextDown(100)), world(nextUp(100)),
    world(0, 100), world(-0.1, 0.3), world(-tiny, 2 * tiny), world(0, -tiny, 120),
    world(1e-10, 120), world(0, -1e-12, 1e-12), world(0, -1e-12, 120),
  ];
  for (const lookup of lookups) {
    for (const model of models(lookup)) {
      assertGraph(model, 'c1');
      const expected = computeActiveBounds(model.blueprint, model.domain).ergonomics;
      const source = clampPart(model, 'c1').columns.find(column => column.name === 'raw_ergo')!;
      assert.deepEqual([source.lower, source.upper], [expected.lo, expected.hi], 'auxiliary protection leaves the original source enclosure untouched');
    }
  }
});

test('raw clamp-source normalization preserves the original affine equation exactly', () => {
  for (const lookup of [world(-5, 10), world(1, 2, 5), world(0.1, -0.3, 0.7), world(-1e-12, 2)]) {
    for (const model of models(lookup)) {
      const parsed = parseLpText(model.lp());
      const row = parsed.rows.find(row => row.name === 'raw_ergo_def')!;
      const pivot = row.terms.find(([name]) => name === 'raw_ergo')![1];
      assert.ok(pivot > 0 && Number.isFinite(pivot));
      assert.equal(ratCmp(ratDiv(R(row.lower), R(pivot)), R(model.blueprint.templateErgonomics[0])), 0);
      assert.equal(row.lower, row.upper);
      for (let t = 1; t < model.blueprint.templateIds.length; t++) {
        const name = model.count(t);
        if (name === null) continue;
        const coefficient = row.terms.find(([column]) => column === name)?.[1] ?? 0;
        assert.equal(ratCmp(ratDiv(R(coefficient), R(pivot)), neg(R(model.blueprint.templateErgonomics[t]))), 0);
      }
      const source = parsed.columns.find(column => column.name === 'raw_ergo')!;
      assert.deepEqual([source.lower, source.upper], [model.activeBounds!.ergonomics.lo, model.activeBounds!.ergonomics.hi]);
    }
  }
});

test('auxiliary endpoint protection includes equality to the native filter threshold but does not widen surviving leaves', () => {
  const tau = HIGHS_SMALL_MATRIX_VALUE;
  const wanted = [nextDown(tau), tau, nextUp(tau)];
  const seen = new Set<number>();
  let candidate = tau;
  for (let k = 0; k < 32; k++) candidate = nextDown(candidate);
  for (let k = 0; k < 65; k++, candidate = nextUp(candidate)) {
    const model = models(world(0, -candidate, candidate))[1];
    const part = clampPart(model, 'c1');
    const source = part.columns.find(column => column.name === 'raw_ergo')!;
    if (!wanted.includes(source.upper)) continue;
    seen.add(source.upper);
    assertGraph(model, 'c1');
    const coefficients = part.rows.flatMap(row => row.terms.map(([, coefficient]) => Math.abs(coefficient)));
    if (source.upper > tau) assert.ok(coefficients.includes(source.upper), 'a surviving endpoint remains unchanged');
    else assert.ok(!coefficients.includes(source.upper), 'a filtered endpoint is not emitted as a matrix entry');
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), wanted);
});

test('the second clamp uses the complete gear enclosure for zero, identity, upper-hinge and saturated factors', () => {
  for (const modifier of [-3, -1, -0.2, 0, 0.25, 1, 3]) {
    for (const receiver of [0, 30, 60, 100]) {
      for (const model of models(world(receiver, 10), { ...zeroWeights, useTrueErgo: true, equipErgoModifier: modifier })) {
        assertGraph(model, 'c2');
        if (modifier === -0.2 && model.certified) {
          assert.ok(model.proof?.gear && model.proof.gear.low < model.proof.gear.high);
          assert.ok((model.rowFamilies?.find(family => family.id === 'gear_clamp')?.constructionError ?? 0) > 0);
        }
      }
    }
  }
});

const options = { ...nativeSolveOptions(1e-9), presolve: 'off', time_limit: 30 } as const;

test('native clamp outputs do not depend on objective direction, zero weights, or relaxed slot edges', async () => {
  for (const regime of regimes) {
    for (const model of models(regime.lookup())) {
      const part = model.blueprint.templateIndexOf('p0');
      for (const selected of [0, 1]) {
        const raw = model.blueprint.templateErgonomics[0] + selected * model.blueprint.templateErgonomics[part];
        for (const text of [model.lp(), model.lpRelaxedEdges()]) {
          const pinned = withRows(text, [`pin_part: ${model.count(part)} = ${selected}`]);
          for (const objective of ['0 total_obj', 'capped_ergo', '- capped_ergo']) {
            const lp = pinned.replace(/Maximize\n[\s\S]*?\nSubject To\n/, `Maximize\n obj: ${objective}\nSubject To\n`);
            const result = await nativeSolve(lp, options, { includeReadback: true });
            assert.equal(result.modelStatus.name, 'Optimal', `${regime.label} ${objective}`);
            assert.ok(result.readback && compareReadback(parseLpText(lp), result.readback).ok, 'native readback preserves all clamp rows and finite domains');
            const index = result.colNames?.indexOf('capped_ergo') ?? -1;
            assert.ok(index >= 0 && result.colValues);
            assert.ok(Math.abs(result.colValues[index] - Math.min(100, Math.max(0, raw))) <= 1e-7);
          }
        }
      }
    }
  }
});

test('original certified objectives and both edge texts still pass native proof qualification in every clamp regime', async () => {
  for (const regime of regimes) {
    const model = models(regime.lookup())[1];
    assert.ok(model.proof);
    assert.equal(model.matrixFilterRisk, false);
    for (const lpText of [model.lp(), model.lpRelaxedEdges()]) {
      const result = await nativeSolve(lpText, options, { includeReadback: true });
      assert.equal(result.modelStatus.name, 'Optimal', regime.label);
      const assessment = assessNativeResult({ lpText, proof: model.proof }, result);
      assert.equal(assessment.qualified, true, `${regime.label}: ${assessment.reasons.join(' | ')}`);
    }
  }
});

test('tiny auxiliary endpoints introduce no new filtering when all original statistic coefficients survive', async () => {
  for (const lookup of [world(0, 120), world(0, 10), world(1e-12, -1), world(1e-10, 120)]) {
    const model = models(lookup)[1];
    const raw = model.activeBounds?.ergonomics;
    assert.ok(raw && Math.min(Math.abs(raw.lo), Math.abs(raw.hi)) <= HIGHS_SMALL_MATRIX_VALUE);
    assertGraph(model, 'c1');
    assert.equal(model.matrixFilterRisk, false);
    assert.ok(model.proof);
    for (const lpText of [model.lp(), model.lpRelaxedEdges()]) {
      const result = await nativeSolve(lpText, options, { includeReadback: true });
      assert.equal(result.modelStatus.name, 'Optimal');
      const assessment = assessNativeResult({ lpText, proof: model.proof }, result);
      assert.equal(assessment.qualified, true, assessment.reasons.join(' | '));
    }
  }
});

test('native second-clamp outputs keep zero, identity, upper-hinge and saturation semantics with no ergonomics preference', async () => {
  for (const modifier of [-1, -0.2, 0, 0.25, 1, 3]) {
    for (const model of models(world(60, 30), { ...zeroWeights, useTrueErgo: true, equipErgoModifier: modifier })) {
      const part = model.blueprint.templateIndexOf('p0');
      for (const selected of [0, 1]) {
        const lpText = withRows(model.lp(), [`pin_part: ${model.count(part)} = ${selected}`]);
        const result = await nativeSolve(lpText, options, { includeReadback: true });
        assert.equal(result.modelStatus.name, 'Optimal');
        assert.ok(result.readback && compareReadback(parseLpText(lpText), result.readback).ok);
        const index = result.colNames?.indexOf('eff_ergo') ?? -1;
        assert.ok(index >= 0 && result.colValues);
        const expected = Math.min(100, (60 + 30 * selected) * Math.max(0, 1 + modifier));
        assert.ok(Math.abs(result.colValues[index] - expected) <= 1e-7);
        if (model.proof) {
          const assessment = assessNativeResult({ lpText, proof: model.proof }, result);
          assert.equal(assessment.qualified, true, assessment.reasons.join(' | '));
        }
      }
    }
  }
});

test('the full feasible count set and saturation maximizers survive weighted and all-zero Tchebycheff objectives', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { ergo: -10, slots: [slot('s1', ['a']), slot('s2', ['a'])] }),
    ['a', mod('a', { ergo: 110 })],
  );
  const requests: SpecializeRequest[] = [
    { ...zeroWeights },
    { ...zeroWeights, useTchebycheff: true, idealPoint: { zE: 1000, nadE: 0, zR: 0, nadR: 0, zP: 5000, nadP: 10000 } },
    { ergoWeight: 1, recoilWeight: 0, priceWeight: 0 },
    { ergoWeight: 1, recoilWeight: 0, priceWeight: 0, useTrueErgo: true, equipErgoModifier: -1 },
  ];
  for (const request of requests) {
    for (const model of models(lookup, request)) {
      const part = model.blueprint.templateIndexOf('a');
      const objectives: number[] = [];
      for (const count of [0, 1, 2]) {
        const result = await nativeSolve(withRows(model.lp(), [`pin_count: ${model.count(part)} = ${count}`]), options);
        assert.equal(result.modelStatus.name, 'Optimal', `count ${count} remains feasible`);
        assert.ok(result.objectiveValue !== null);
        objectives.push(result.objectiveValue);
      }
      const expected = request.ergoWeight === 1 && !request.useTrueErgo ? [0, 100, 100] : [0, 0, 0];
      objectives.forEach((value, k) => assert.ok(Math.abs(value - expected[k]) <= 1e-7));
      const best = Math.max(...objectives);
      const maximizers = objectives.flatMap((value, k) => Math.abs(value - best) <= 1e-7 ? [k] : []);
      assert.deepEqual(maximizers, expected[0] === expected[1] ? [0, 1, 2] : [1, 2]);
    }
  }
});

test('a clamp lower bound straddling zero retains a certificate at the consumer objective tolerance', async () => {
  const { params } = randomWorld(147);
  const request = { ...params, objectiveTolerance: 1e-6 };
  for (const edgeIntegrality of ['relaxed-first', 'integer'] as const) {
    const result = await solvePrecise({ params: request, deadline: performance.now() + 120_000, lanes: null, edgeIntegrality });
    assert.equal(result.kind, 'build', edgeIntegrality);
    if (result.kind !== 'build') continue;
    assert.equal(result.certified, true, result.reason);
    assert.ok(result.summary.bounds.gap !== null && result.summary.bounds.gap <= request.objectiveTolerance);
    assert.ok(Math.abs(result.best.score - 36) < 1e-12);
    assert.equal(validatePhysicalBuild(request.itemLookup, request, result.best.build, { requirePathInstanceIds: true }).ok, true);
  }
});
