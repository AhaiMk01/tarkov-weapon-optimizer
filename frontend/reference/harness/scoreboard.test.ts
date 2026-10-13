// Unit tests of the scoreboard bookkeeping: the baseline file format, the ratchet comparison and the
// summary. Pure data in, pure data out; production is never touched here (see ledger.differential.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareToBaseline, DIMENSIONS, formatSummary, FAST_DIMENSIONS, parseBaseline, serializeBaseline, summarize, toBaseline,
  type CaseScore, type DimensionResults, type Verdict,
} from './scoreboard';

const result = (verdict: Verdict, reason = '', key?: string) => ({ verdict, reason, ...(key === undefined ? {} : { key }) });

function dims(values: Partial<Record<(typeof DIMENSIONS)[number], Verdict>>, reason = 'r'): DimensionResults {
  return {
    buildValid: result(values.buildValid ?? 'fail', reason),
    scoreOptimal: result(values.scoreOptimal ?? 'fail', reason),
    emptiness: result(values.emptiness ?? 'fail', reason),
    outcomeContract: result(values.outcomeContract ?? 'fail', reason),
  };
}

function score(id: string, family: number, precise: Partial<Record<(typeof DIMENSIONS)[number], Verdict>>, fast: Partial<Record<(typeof DIMENSIONS)[number], Verdict>> = {}, unsupported: string[] = []): CaseScore {
  return { id, family, unsupported, precise: dims(precise), fast: dims({ scoreOptimal: 'n/a', ...fast }) };
}

const board = (): CaseScore[] => [
  score('F01-a', 1, { emptiness: 'pass' }, { emptiness: 'pass' }),
  score('F01-b', 1, { buildValid: 'pass', scoreOptimal: 'pass', emptiness: 'pass' }),
  score('F02-c', 2, {}, {}, ['owned_items']),
];

test('baseline round trip: toBaseline then serialize then parse is lossless and one line per case', () => {
  const baseline = toBaseline(board());
  const text = serializeBaseline(baseline);
  assert.deepEqual(parseBaseline(text), baseline);
  assert.equal(text.endsWith('\n'), true);
  const caseLines = text.split('\n').filter(line => line.includes('"F0'));
  assert.equal(caseLines.length, 3, 'each case occupies exactly one line so a baseline diff is reviewable');
  assert.deepEqual(baseline.cases['F02-c'].unsupported, ['owned_items']);
  assert.equal(baseline.cases['F01-b'].precise.buildValid, 'pass');
  assert.equal(baseline.cases['F01-a'].fast.scoreOptimal, 'n/a');
});

test('serialization is deterministic and carries no reasons or timestamps', () => {
  const a = serializeBaseline(toBaseline(board()));
  const slower = board().map(c => ({ ...c, precise: dims({ ...Object.fromEntries(DIMENSIONS.map(d => [d, c.precise[d].verdict])) as Partial<Record<(typeof DIMENSIONS)[number], Verdict>> }, 'a different reason') }));
  assert.equal(serializeBaseline(toBaseline(slower)), a);
  assert.ok(!/reason|time|date/i.test(a.replace(/schemaVersion/, '')));
});

test('parseBaseline rejects malformed files', () => {
  assert.throws(() => parseBaseline('not json'));
  assert.throws(() => parseBaseline('{"schemaVersion":2,"cases":{}}'), /schemaVersion/);
  assert.throws(() => parseBaseline('{"schemaVersion":1,"cases":{"x":{"unsupported":[],"precise":{"buildValid":"maybe"},"fast":{}}}}'));
});

test('ratchet: an unchanged scoreboard is clean', () => {
  const report = compareToBaseline(toBaseline(board()), board());
  assert.deepEqual(report, { regressions: [], improvements: [], drift: [], ok: true });
});

test('ratchet: a passing dimension that now fails is a regression, naming case, mode and dimension', () => {
  const now = board();
  now[1] = score('F01-b', 1, { buildValid: 'pass', scoreOptimal: 'fail', emptiness: 'pass' });
  const report = compareToBaseline(toBaseline(board()), now);
  assert.equal(report.ok, false);
  assert.equal(report.regressions.length, 1);
  assert.match(report.regressions[0], /F01-b/);
  assert.match(report.regressions[0], /precise/);
  assert.match(report.regressions[0], /scoreOptimal/);
  assert.deepEqual(report.improvements, []);
});

test('ratchet: pass becoming n/a also counts as a regression (applicability may not silently shrink)', () => {
  const now = board();
  now[1] = score('F01-b', 1, { buildValid: 'pass', scoreOptimal: 'n/a', emptiness: 'pass' });
  const report = compareToBaseline(toBaseline(board()), now);
  assert.equal(report.regressions.length, 1);
  assert.match(report.regressions[0], /scoreOptimal/);
});

test('ratchet: a newly passing dimension is an improvement that demands a baseline update', () => {
  const now = board();
  now[0] = score('F01-a', 1, { emptiness: 'pass', buildValid: 'pass' }, { emptiness: 'pass' });
  const report = compareToBaseline(toBaseline(board()), now);
  assert.equal(report.ok, false);
  assert.deepEqual(report.regressions, []);
  assert.equal(report.improvements.length, 1);
  assert.match(report.improvements[0], /F01-a/);
  assert.match(report.improvements[0], /buildValid/);
});

test('ratchet: a Fast regression is found like a Precise one', () => {
  const now = board();
  now[0] = score('F01-a', 1, { emptiness: 'pass' }, { emptiness: 'fail' });
  const report = compareToBaseline(toBaseline(board()), now);
  assert.equal(report.regressions.length, 1);
  assert.match(report.regressions[0], /fast/);
  assert.match(report.regressions[0], /emptiness/);
});

test('ratchet: a regression and an improvement are reported together, none hides the other', () => {
  const now = board();
  now[0] = score('F01-a', 1, { emptiness: 'fail', buildValid: 'pass' }, { emptiness: 'pass' });
  const report = compareToBaseline(toBaseline(board()), now);
  assert.equal(report.regressions.length, 1);
  assert.equal(report.improvements.length, 1);
});

test('ratchet: fail to n/a, a new case, a removed case and changed unsupported features are drift', () => {
  const baseline = toBaseline(board());

  const applicability = board();
  applicability[0] = score('F01-a', 1, { emptiness: 'pass', scoreOptimal: 'n/a' }, { emptiness: 'pass' });
  assert.match(compareToBaseline(baseline, applicability).drift.join('\n'), /F01-a.*scoreOptimal/);

  const added = [...board(), score('F03-new', 3, { emptiness: 'pass' })];
  const addedReport = compareToBaseline(baseline, added);
  assert.match(addedReport.drift.join('\n'), /F03-new.*not in the baseline/);
  assert.deepEqual(addedReport.improvements, [], 'a new case is drift, not an improvement');

  const removed = board().slice(0, 2);
  assert.match(compareToBaseline(baseline, removed).drift.join('\n'), /F02-c.*no longer/);

  const unsupported = board();
  unsupported[2] = score('F02-c', 2, {}, {}, ['owned_items', 'preset_component_count_gt_1']);
  assert.match(compareToBaseline(baseline, unsupported).drift.join('\n'), /F02-c.*unsupported/);
});

test('summary: per-family pass counts over applicable dimensions, and the top failure reasons', () => {
  const rows: CaseScore[] = [
    { id: 'F01-a', family: 1, unsupported: [], precise: { ...dims({ emptiness: 'pass' }), buildValid: result('fail', 'detail 1', 'no build returned') }, fast: dims({ scoreOptimal: 'n/a' }) },
    { id: 'F01-b', family: 1, unsupported: [], precise: { ...dims({ emptiness: 'pass', buildValid: 'pass', scoreOptimal: 'n/a' }), outcomeContract: result('fail', 'detail 2', 'status mismatch') }, fast: dims({ scoreOptimal: 'n/a' }) },
    { id: 'F02-c', family: 2, unsupported: ['owned_items'], precise: { ...dims({}), buildValid: result('fail', 'detail 3', 'no build returned') }, fast: dims({ scoreOptimal: 'n/a' }) },
  ];
  const summary = summarize(rows);
  assert.equal(summary.total, 3);
  const f1 = summary.families.find(f => f.family === 1)!;
  assert.equal(f1.cases, 2);
  assert.deepEqual(f1.precise.emptiness, { pass: 2, applicable: 2 });
  assert.deepEqual(f1.precise.buildValid, { pass: 1, applicable: 2 });
  assert.deepEqual(f1.precise.scoreOptimal, { pass: 0, applicable: 1 }, 'n/a is not counted as applicable');
  const reasons = summary.topReasons.precise;
  assert.deepEqual(reasons.find(r => r.key === 'no build returned'), { key: 'no build returned', count: 2 });
  assert.deepEqual(reasons.find(r => r.key === 'status mismatch'), { key: 'status mismatch', count: 1 });
  assert.ok(reasons.every((r, i) => i === 0 || reasons[i - 1].count >= r.count), 'sorted by descending count');
  assert.ok(reasons.every(r => r.key !== 'detail 1'), 'failures are grouped by key, not by their case-specific reason text');
  assert.deepEqual(summary.unsupported, [{ feature: 'owned_items', cases: 1 }]);
  const text = formatSummary(summary);
  assert.match(text, /F01/);
  assert.match(text, /no build returned/);
  assert.match(text, /owned_items/);
  assert.ok(FAST_DIMENSIONS.every(d => DIMENSIONS.includes(d)));
});
