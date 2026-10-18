// The a-priori cap bound of the TrueErgo weight search (owner decision 2026-10-18, amending G1; docs/proofs/count-model.md section 16):
// `aprioriScoreBound` bounds the exact score of every build whose weight lies in an interval, with no solve, when the objective is exactly e x TED.
//
// Checked against the independent oracle (reference/oracle), not against production's own scoring: on every ledger fixture, made heavy so that the
// weight penalty matters (receiver +2.5 kg, every part 3 w + 1 kg, receiver ergonomics +60 so the clamp at 100 is reached), the oracle enumerates every
// accepted build; the bound of any interval starting at or below a build's weight is at least the build's oracle score. Precise on the same heavy
// fixtures returns the oracle's optimum, with a published upper bound at least the optimum, while the a-priori bound fathoms nodes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEDGER } from '../../reference/ledger/index';
import type { LedgerCase } from '../../reference/ledger/index';
import { OUT_OF_SCOPE_CASES } from '../../reference/harness/scoreboard';
import { toProduction } from '../../reference/harness/toProduction.differential';
import { runOracle, type ReferenceFixture, type ReferenceRequest } from '../../reference/oracle/index';
import { aprioriScoreBound, ratRoundDown } from '../../src/solver/physical';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import { ratCmp, ratFromDouble, ratInt, ratMul, ratSub, ratToNumber, type Rat } from '../../src/solver/physical/exact';

const heavy = (fixture: ReferenceFixture): ReferenceFixture => ({
  ...fixture,
  weapons: fixture.weapons.map(w => ({ ...w, weightKg: (w.weightKg ?? 0) + 2.5, ergonomics: (w.ergonomics ?? 0) + 60 })),
  items: fixture.items.map(i => ({ ...i, weightKg: 3 * (i.weightKg ?? 0) + 1 })),
});

/** The case's request with the objective replaced: TrueErgo, weights (e, r, 0), no Tchebycheff. */
const tedRequest = (c: LedgerCase, e: number, r: number, preventOverswing: boolean): ReferenceRequest => ({
  ...c.request, use_true_ergo: true, prevent_overswing: preventOverswing, ergo_weight: e, recoil_weight: r, price_weight: 0, use_tchebycheff: false, ideal_point: null,
});

const CASES = LEDGER.filter(c => !Object.hasOwn(OUT_OF_SCOPE_CASES, c.id) && c.todo === undefined);

test('the cap bound is e x (100 - q(lo)), and it exists only for a weighted TrueErgo objective with recoil and price weight 0', () => {
  const q = (w: number): Rat => (w <= 3 ? ratInt(0) : ratSub(ratInt(100), ratFromDouble(300 / w)));
  assert.deepEqual(aprioriScoreBound({ e: 100, r: 0, p: 0 }, null, true, { lo: 6, hi: 14 }), ratMul(ratInt(100), ratSub(ratInt(100), q(6))), '100 x (100 - 50)');
  assert.deepEqual(aprioriScoreBound({ e: 1, r: 0, p: 0 }, null, true, { lo: 2.5, hi: 3 }), ratInt(100), 'no penalty up to 3 kg');
  assert.deepEqual(aprioriScoreBound({ e: 0, r: 0, p: 0 }, null, true, { lo: 5, hi: 9 }), ratInt(0), 'a zero ergonomics weight scores every build 0');
  const ideal = { zE: 900, nadE: 100, zR: -300, nadR: 0, zP: 0, nadP: 50_000 };
  assert.equal(aprioriScoreBound({ e: 100, r: 0.001, p: 0 }, null, true, { lo: 6, hi: 14 }), null, 'a recoil weight');
  assert.equal(aprioriScoreBound({ e: 100, r: 0, p: 0.001 }, null, true, { lo: 6, hi: 14 }), null, 'a price weight');
  assert.equal(aprioriScoreBound({ e: 100, r: 0, p: 0 }, ideal, true, { lo: 6, hi: 14 }), null, 'Tchebycheff');
  assert.equal(aprioriScoreBound({ e: 100, r: 0, p: 0 }, null, false, { lo: 6, hi: 14 }), null, 'TrueErgo off: the axis is ergonomics, not TED');
});

test('on every ledger fixture made heavy, the bound of an interval starting at or below a build\'s weight is at least the build\'s oracle score', () => {
  let builds = 0;
  let tight = 0;
  for (const c of CASES) {
    const fixture = heavy(c.fixture);
    for (const e of [1, 100, 0.3]) {
      for (const po of [false, true]) {
        const oracle = runOracle(fixture, tedRequest(c, e, 0, po));
        for (const b of oracle.builds) {
          const lo = ratRoundDown(b.stats.weight);
          for (const interval of [{ lo, hi: lo + 20 }, { lo: lo - 1.5, hi: lo + 0.5 }]) {
            const bound = aprioriScoreBound({ e, r: 0, p: 0 }, null, true, interval);
            assert.ok(bound !== null, `${c.id}: the objective is e x TED`);
            assert.ok(ratCmp(bound, b.score) >= 0, `${c.id} e ${e} po ${po}: bound ${ratToNumber(bound)} on [${interval.lo}, ${interval.hi}] below the score ${ratToNumber(b.score)} of a build of ${ratToNumber(b.stats.weight)} kg`);
          }
          builds++;
          if (ratCmp(aprioriScoreBound({ e, r: 0, p: 0 }, null, true, { lo, hi: lo })!, b.score) === 0) tight++;
        }
      }
    }
  }
  assert.ok(builds > 1000, `${builds} oracle builds checked`);
  assert.ok(tight > 0, 'some build meets the bound exactly (clamped ergonomics at an exact weight), so the check can see a bound that is too low');
  console.log(`ℹ ${builds} oracle builds over ${CASES.length} heavy fixtures; ${tight} meet the bound exactly`);
});

test('Precise on the heavy ledger fixtures, weights (1, 0, 0) under TrueErgo with and without Prevent Overswing: the oracle optimum, a valid upper bound, nodes fathomed a priori; none with a recoil weight', { timeout: 900_000 }, async () => {
  let fathomed = 0;
  let solved = 0;
  for (const c of CASES) {
    const fixture = heavy(c.fixture);
    for (const [r, po] of [[0, false], [0, true], [1, false]] as const) {
      const request = tedRequest(c, 1, r, po);
      const inputs = toProduction(fixture, request, { preciseMode: true, timeLimitMs: 20_000 });
      if (inputs.unsupported.length > 0) continue;
      const oracle = runOracle(fixture, request);
      if (!oracle.complete) continue;
      const result = await solvePrecise({ params: inputs.params, deadline: performance.now() + 20_000 });
      const label = `${c.id} r ${r} po ${po}`;
      if (r > 0) {
        assert.equal(result.summary.telemetry.aprioriFathomedNodes, 0, `${label}: the bound is off with a recoil weight`);
        continue;
      }
      solved++;
      fathomed += result.summary.telemetry.aprioriFathomedNodes;
      if (oracle.maxScore === null) {
        assert.equal(result.kind, 'empty', `${label}: the oracle has no build`);
        continue;
      }
      const best = oracle.maxScore;
      assert.equal(result.kind, 'build', `${label}: ${result.kind}`);
      if (result.kind !== 'build') continue;
      assert.ok(ratCmp(ratFromDouble(result.best.scoreLower), best) <= 0, `${label}: the build scores at most the optimum`);
      assert.ok(ratCmp(ratFromDouble(result.summary.upperBound), best) >= 0, `${label}: published upper bound ${result.summary.upperBound} below the optimum ${ratToNumber(best)}`);
      if (result.certified) {
        assert.ok(ratToNumber(best) - result.best.score <= result.summary.tolerance, `${label}: certified ${result.best.score}, optimum ${ratToNumber(best)}`);
      }
    }
  }
  assert.ok(solved > 100, `${solved} requests solved`);
  assert.ok(fathomed > 0, 'the a-priori bound fathomed some node');
  console.log(`ℹ ${solved} Precise requests, ${fathomed} nodes fathomed a priori`);
});
