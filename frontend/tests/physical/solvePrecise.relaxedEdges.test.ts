// Relaxed slot edges in Precise (`PreciseContext.edgeIntegrality`, Phase 2.10): every node is first solved with the slot-edge counts continuous, a relaxation
// whose dual bound is still a valid bound, and an integral optimum passes the same proof layer and the same second opinion as an integer one. The answers must
// equal the integer-only pipeline's on seeded worlds, plain and TrueErgo, with the same certificates, and every build must validate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePhysicalBuild } from '../../src/solver/physical';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import type { PreciseResult } from '../../src/solver/physical/solvePrecise';
import type { SolveParams } from '../../src/solver/types';
import { randomTedWorld, randomWorld } from './randomWorlds';

const TOLERANCE = 1e-6;

const sameAnswer = (label: string, a: PreciseResult, b: PreciseResult): void => {
  assert.equal(a.kind, b.kind, `${label}: ${a.kind} against ${b.kind}`);
  assert.equal(a.outcome.status, b.outcome.status, `${label}: status`);
  assert.equal(a.outcome.physical_certificate, b.outcome.physical_certificate, `${label}: certificate`);
  if (a.kind === 'build' && b.kind === 'build') {
    assert.ok(Math.abs(a.best.score - b.best.score) <= 3 * TOLERANCE * Math.max(1, Math.abs(b.best.score)), `${label}: score ${a.best.score} against ${b.best.score}`);
  }
};

test('relaxed-first Precise equals integer-only Precise on seeded acyclic worlds (plain and TrueErgo), with the same certificates, and its builds validate', { timeout: 900_000 }, async t => {
  let builds = 0;
  let relaxedSolves = 0;
  let fallbacks = 0;
  const worlds = [
    ...Array.from({ length: 60 }, (_, k) => ({ label: `plain ${k + 1}`, world: randomWorld(k + 1, false) })),
    ...Array.from({ length: 30 }, (_, k) => ({ label: `ted ${k + 1}`, world: randomTedWorld(k + 1, false) })),
  ];
  for (const { label, world } of worlds) {
    const params: SolveParams = { ...world.params, objectiveTolerance: TOLERANCE };
    const relaxed = await solvePrecise({ params, deadline: performance.now() + 60_000, edgeIntegrality: 'relaxed-first' });
    const integer = await solvePrecise({ params, deadline: performance.now() + 60_000, edgeIntegrality: 'integer' });
    sameAnswer(label, relaxed, integer);
    assert.equal(integer.summary.telemetry.relaxedEdgeSolves, 0, `${label}: integer-only never tries the relaxation`);
    assert.equal(relaxed.summary.telemetry.unqualifiedSolves, 0, `${label}: every relaxed solve is qualified (${relaxed.summary.telemetry.unqualifiedReasons.join(' | ')})`);
    if (relaxed.kind === 'build') {
      builds++;
      const verdict = validatePhysicalBuild(params.itemLookup, params, relaxed.best.build, { requirePathInstanceIds: true });
      assert.equal(verdict.ok, true, `${label}: ${JSON.stringify(verdict.violations)}`);
    }
    relaxedSolves += relaxed.summary.telemetry.relaxedEdgeSolves;
    fallbacks += relaxed.summary.telemetry.relaxedEdgeFallbacks;
  }
  t.diagnostic(`builds ${builds} of ${worlds.length}; relaxed solves ${relaxedSolves}, fallbacks to the integer model ${fallbacks}`);
  assert.ok(builds >= 40);
  assert.ok(relaxedSolves > 0);
});
