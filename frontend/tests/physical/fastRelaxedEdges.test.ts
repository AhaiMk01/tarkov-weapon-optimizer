// Continuous slot-edge counts first, integer fallback (solveFast `edgeIntegrality: 'relaxed-first'`, the default).
//  - The relaxed text differs from the integer text only in the integrality declarations of the e_ columns.
//  - Relaxed-first and integer-only return the same answers on seeded random worlds (plain, TrueErgo / Prevent Overswing).
//  - A fractional edge, or a point that must be cut, falls back to the integer model and still ends in the same valid build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePhysicalBuild } from '../../src/solver/physical';
import { getPhysicalBlueprint } from '../../src/solver/physical/solvePrecise';
import { prepareSubproblemDomain } from '../../src/solver/physical/domain';
import { specializeFast } from '../../src/solver/physical/specializeFast';
import { solveFast } from '../../src/solver/physical/solveFast';
import type { FastResult } from '../../src/solver/physical/solveFast';
import { nativeSolve } from '../../src/solver/physical/nativeSolve';
import type { SolveFn } from '../../src/solver/physical/nativeSolve';
import { LpWriter } from '../../src/solver/physical/lpText';
import { randomTedWorld, randomWorld } from './randomWorlds';

const section = (lp: string, name: string): string[] => {
  const lines = lp.split('\n');
  const start = lines.indexOf(name);
  if (start < 0) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && /^\s/.test(lines[i]); i++) out.push(...lines[i].trim().split(/\s+/));
  return out;
};

test('LpWriter.toStringRelaxing drops only the integrality of the listed columns and keeps a binary column on [0, 1]', () => {
  const w = new LpWriter();
  w.addColumn('b', 'binary', 0, 1);
  w.addColumn('i', 'integer', 0, 3);
  w.addColumn('k', 'integer', 0, 2);
  w.addColumn('obj', 'continuous', -10, 10);
  w.addRow('r', [['b', 1], ['i', 1], ['k', 1], ['obj', -1]], '=', 0);
  w.setObjective('obj');
  const relaxed = w.toStringRelaxing(new Set(['b', 'i']));
  assert.deepEqual(section(relaxed, 'General'), ['k']);
  assert.deepEqual(section(relaxed, 'Binary'), []);
  assert.ok(relaxed.includes('0 <= b <= 1'));
  assert.ok(relaxed.includes('0 <= i <= 3'));
  // Rows and objective are the same text.
  const rowsOf = (lp: string) => lp.slice(lp.indexOf('Subject To'), lp.indexOf('Bounds'));
  assert.equal(rowsOf(relaxed), rowsOf(w.toString()));
});

test('specializeFast: lpRelaxedEdges relaxes exactly the slot-edge columns (counts, bases and lots stay integer)', () => {
  for (const seed of [3, 11, 29]) {
    const { params } = randomWorld(seed);
    const blueprint = getPhysicalBlueprint(params.itemLookup, params.weaponId, params.physicalOptions);
    const domain = prepareSubproblemDomain(blueprint, params.itemLookup, params);
    const model = specializeFast(blueprint, domain, params);
    if (model.provedEmpty !== null || model.edges.length === 0) continue;
    const integer = [...section(model.lp(), 'General'), ...section(model.lp(), 'Binary')];
    const relaxed = new Set([...section(model.lpRelaxedEdges(), 'General'), ...section(model.lpRelaxedEdges(), 'Binary')]);
    const edges = new Set(model.edges.map(edge => edge.column));
    for (const name of integer) assert.equal(relaxed.has(name), !edges.has(name), `seed ${seed}: ${name}`);
    for (const edge of edges) assert.ok(integer.includes(edge), `seed ${seed}: ${edge} is integer in the integer model`);
  }
});

const sameAnswer = (label: string, a: FastResult, b: FastResult): void => {
  assert.equal(a.kind, b.kind, `${label}: ${a.kind} against ${b.kind}`);
  assert.deepEqual(a.outcome, b.outcome, `${label}: outcome`);
  if (a.kind === 'build' && b.kind === 'build') {
    assert.ok(Math.abs(a.best.score - b.best.score) <= 1e-6 * Math.max(1, Math.abs(b.best.score)), `${label}: score ${a.best.score} against ${b.best.score}`);
  }
};

test('relaxed-first equals integer-only on seeded worlds (plain and TED), and its builds are valid', { timeout: 600_000 }, async t => {
  let builds = 0;
  let fallbacks = 0;
  let relaxedSolves = 0;
  const worlds = [
    ...Array.from({ length: 60 }, (_, k) => ({ label: `plain ${k + 1}`, world: randomWorld(k + 1) })),
    ...Array.from({ length: 30 }, (_, k) => ({ label: `ted ${k + 1}`, world: randomTedWorld(k + 1) })),
  ];
  for (const { label, world } of worlds) {
    const { params } = world;
    const deadline = performance.now() + 60_000;
    const relaxed = await solveFast({ params: { ...params, allowRepeatedParts: true }, deadline });
    const integer = await solveFast({ params: { ...params, allowRepeatedParts: true }, deadline, edgeIntegrality: 'integer' });
    sameAnswer(label, relaxed, integer);
    if (relaxed.kind === 'build') {
      builds++;
      const verdict = validatePhysicalBuild(params.itemLookup, params, relaxed.best.build, { requirePathInstanceIds: true });
      assert.equal(verdict.ok, true, `${label}: ${JSON.stringify(verdict.violations)}`);
    }
    fallbacks += relaxed.summary.relaxedEdgeFallbacks;
    relaxedSolves += relaxed.summary.relaxedEdgeSolves;
    assert.equal(integer.summary.relaxedEdgeSolves, 0, `${label}: integer-only never tries the relaxation`);
  }
  t.diagnostic(`builds ${builds} of ${worlds.length}; relaxed solves ${relaxedSolves}, fallbacks ${fallbacks}`);
  assert.ok(builds >= 40);
  assert.ok(relaxedSolves > 0);
});

test('a fractional edge falls back to the integer model and ends in the same build', async () => {
  const { params } = randomWorld(5);
  const deadline = performance.now() + 60_000;
  const reference = await solveFast({ params: { ...params, allowRepeatedParts: true }, deadline, edgeIntegrality: 'integer' });
  assert.equal(reference.kind, 'build');
  // The solver answers the RELAXED text (no e_ column declared integer) with one edge nudged to a fractional value.
  let nudged = 0;
  const fractional: SolveFn = async (lp, options, extras) => {
    const result = await nativeSolve(lp, options, extras);
    const integerNames = new Set([...section(lp, 'General'), ...section(lp, 'Binary')]);
    if (result.colValues === null || result.colNames === null) return result;
    const j = result.colNames.findIndex(name => name.startsWith('e_') && !integerNames.has(name));
    if (j < 0) return result;
    nudged++;
    const values = Float64Array.from(result.colValues);
    values[j] += 0.5;
    return { ...result, colValues: values };
  };
  const relaxed = await solveFast({ params: { ...params, allowRepeatedParts: true }, deadline, solve: fractional });
  assert.ok(nudged >= 1, 'the relaxed text was solved');
  assert.equal(relaxed.summary.relaxedEdgeFallbacks, relaxed.summary.relaxedEdgeSolves, 'every relaxed answer fell back');
  sameAnswer('fractional fallback', relaxed, reference);
});

test('relaxed-first on a plain request: one relaxed solve, no fallback, the integer model untouched', async () => {
  const { params } = randomWorld(7);
  const result = await solveFast({ params: { ...params, allowRepeatedParts: true }, deadline: performance.now() + 60_000 });
  if (result.kind !== 'build') return;
  assert.equal(result.summary.relaxedEdgeSolves, 1);
  assert.equal(result.summary.relaxedEdgeFallbacks, 0);
  assert.equal(result.summary.nativeSolves, 1);
});
