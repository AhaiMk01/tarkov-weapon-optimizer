// The payoff table production reports for a Tchebycheff request (INTERPRETATIONS.md choices 9 and 17, ADR 0013 sections 4D and 5, Phase 2.6).
//
// `F11-payoff-table-admissibility-tied-endpoints` has a tied ergonomics optimum with two prices, so exactly two payoff tables are admissible and
// the Tchebycheff optimum differs under them (build m under table A, build a under table B). The request is run with NO ideal point, so production
// computes its own table from three single-axis solves and reports it as `ideal_point`:
//
//   * the oracle must find the reported table admissible (`checkIdealPoint`, exact Q), which is what Stage 3 does for every case;
//   * the returned build must be a maximizer of the oracle score UNDER THAT SAME TABLE (Gate B compares optima under the reported table: the
//     optimum can differ between admissible tables, so the table is an input of the result);
//   * the table is reported whether the request ran Precise or Fast, and a table supplied by the caller is reported as given.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEDGER } from '../ledger/index';
import { checkIdealPoint, eq, inspectBuild, parseQ, projectBuild, projectionKey, resolveFixture, resolveRequest, scoreBuild, toNumber } from '../oracle/index';
import type { ReferenceIdealPoint, ReferenceRequest } from '../oracle/index';
import { decodeBuild, runProduction } from './compare.differential';
import { toProduction } from './toProduction.differential';

const CASE_ID = 'F11-payoff-table-admissibility-tied-endpoints';
const c = LEDGER.find(l => l.id === CASE_ID)!;
const payoff = c.expected.payoff!;
const KEYS = ['zE', 'nadE', 'zR', 'nadR', 'zP', 'nadP'] as const;

/** The request with no ideal point: production has to compute the table itself. */
const withoutTable = (): ReferenceRequest => {
  const { ideal_point: _table, ...rest } = c.request;
  return rest;
};

async function run(preciseMode: boolean, request: ReferenceRequest = withoutTable()) {
  const inputs = toProduction(c.fixture, request, { preciseMode, timeLimitMs: 20_000, objectiveTolerance: c.runtimeTolerance.absolute });
  assert.deepEqual(inputs.unsupported, []);
  const outcome = await runProduction(inputs.params);
  assert.equal(outcome.kind, 'response', outcome.kind === 'response' ? '' : JSON.stringify(outcome));
  return (outcome as Extract<typeof outcome, { kind: 'response' }>).response;
}

test('the table production computes and reports is admissible for the oracle, and the build it returns is optimal under that very table', async () => {
  const response = await run(true);
  assert.equal(response.status, 'optimal');
  const reported = response.ideal_point as ReferenceIdealPoint | undefined;
  assert.ok(reported, 'a Tchebycheff result reports the payoff table it used');
  // Admissible: exact ideal coordinates and a nadir some choice of tied endpoint builds attains.
  const { ideal_point: _table, use_tchebycheff: _t, ...constraints } = c.request;
  const verdict = checkIdealPoint(c.fixture, constraints, reported);
  assert.equal(verdict.admissible, true, verdict.admissible === true ? '' : (verdict as { reason?: string }).reason);
  // Which of the two admissible tables was it? The ledger gives the exact optimum and maximizers under each.
  const entry = payoff.tables.find(t => KEYS.every(k => toNumber(parseQ(t.table[k])) === reported[k]));
  assert.ok(entry, `the reported table ${JSON.stringify(reported)} is one of the ledger's admissible tables`);
  // Gate B in miniature: the oracle's score of the returned build under the reported table is that table's maximum.
  const decoded = decodeBuild(c.fixture, c.request, response);
  assert.deepEqual(decoded.issues, []);
  const request = { ...c.request, ideal_point: reported };
  const { stats } = inspectBuild(resolveFixture(c.fixture), resolveRequest(c.fixture, request), decoded.build);
  assert.ok(stats !== null);
  const score = scoreBuild(stats, resolveRequest(c.fixture, request));
  assert.ok(eq(score, parseQ(entry.maxScore)), `score ${toNumber(score)} against the table's optimum ${entry.maxScore}`);
  assert.ok(entry.maximizers.includes(projectionKey(projectBuild(decoded.build))));
});

test('Fast reports a table as well, and a table the caller supplies is reported exactly as given', async () => {
  const fast = await run(false);
  assert.equal(fast.status, 'optimal');
  const precise = await run(true);
  assert.deepEqual(fast.ideal_point, precise.ideal_point, 'on this case the Fast endpoints are the same tied optima');
  for (const entry of payoff.tables) {
    const given = Object.fromEntries(KEYS.map(k => [k, toNumber(parseQ(entry.table[k]))])) as unknown as ReferenceIdealPoint;
    const response = await run(true, { ...c.request, ideal_point: given });
    assert.deepEqual(response.ideal_point, given);
    const decoded = decodeBuild(c.fixture, c.request, response);
    assert.ok(entry.maximizers.includes(projectionKey(projectBuild(decoded.build))), `under ${JSON.stringify(given)} the maximizer is ${entry.maximizers.join(' or ')}`);
  }
});
