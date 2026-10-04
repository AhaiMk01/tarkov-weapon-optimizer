// Payoff tables and ideal-point admissibility (INTERPRETATIONS.md choice 17, owner decision 2026-10-04).
//
// Production derives the Tchebycheff ideal point from three single-axis solves (weights [100,0,0], [0,100,0], [0,0,100]) over the
// request's feasible domain. The ideal coordinates are unique (zE = max fE, zR = min fR, zP = min fP) but each endpoint build is ONE of
// possibly many tied optima of its axis, and a nadir coordinate is the worst value over the three endpoint builds, so the nadir is not
// unique. The oracle therefore keeps taking the ideal point as an input and checks it for admissibility.
//
// Every expectation below is derived by hand (arithmetic in the comments); frame: fE = 10 x ergonomics (TED under use_true_ergo),
// fR = 1000 x summed recoil modifier, fP = RUB spend.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReferenceFixture, ReferenceItem, ReferenceRequest, ReferenceSlot, ReferenceWeapon } from './domain';
import { ReferenceInputError } from './domain';
import { checkIdealPoint, payoffTables, type PayoffTable } from './payoff';
import { runOracle } from './oracle';
import { fromBinary64, mul, q, toString, type Q } from './q';

const trader = (price: number) => [{ kind: 'trader' as const, trader: 'prapor', level: 1, price }];
const slot = (id: string, allowedItemIds: string[], required = false): ReferenceSlot => ({ id, allowedItemIds, required });
function fixtureOf(items: ReferenceItem[], weapon: Partial<ReferenceWeapon> = {}): ReferenceFixture {
  return { schemaVersion: 1, items, weapons: [{ id: 'gun', offers: trader(1000), ...weapon }] };
}
const req = (r: Partial<ReferenceRequest> = {}): ReferenceRequest => ({ weapon_id: 'gun', ...r });
const table = (zE: number, nadE: number, zR: number, nadR: number, zP: number, nadP: number): PayoffTable => ({
  zE: q(zE), nadE: q(nadE), zR: q(zR), nadR: q(nadR), zP: q(zP), nadP: q(nadP),
});
const ideal = (t: PayoffTable) => ({
  zE: Number(t.zE.n / t.zE.d), nadE: Number(t.nadE.n / t.nadE.d), zR: Number(t.zR.n / t.zR.d),
  nadR: Number(t.nadR.n / t.nadR.d), zP: Number(t.zP.n / t.zP.d), nadP: Number(t.nadP.n / t.nadP.d),
});
const vec = (fE: number, fR: number, fP: number) => ({ fE: q(fE), fR: q(fR), fP: q(fP) });
const describeTable = (t: PayoffTable): string => [t.zE, t.nadE, t.zR, t.nadR, t.zP, t.nadP].map(toString).join(',');

/**
 * Receiver: ergonomics 40, 1000 RUB. One slot s, at most one of four parts, so the builds (ergonomics, recoil sum, spend) -> (fE, fR, fP):
 *   none (40, 0, 1000)        -> (400, 0, 1000)
 *   a  (+10, 150 RUB)         -> (500, 0, 1150)
 *   b  (+10, 400 RUB)         -> (500, 0, 1400)     a and b tie on the ergonomics axis and differ in price
 *   c  (recoil -1/4, 200 RUB) -> (400, -250, 1200)
 *   m  (+5, 10 RUB)           -> (450, 0, 1010)
 */
const tied = fixtureOf(
  [
    { id: 'a', ergonomics: 10, offers: trader(150) },
    { id: 'b', ergonomics: 10, offers: trader(400) },
    { id: 'c', recoilModifier: -0.25, offers: trader(200) },
    { id: 'm', ergonomics: 5, offers: trader(10) },
  ],
  { ergonomics: 40, slots: [slot('s', ['a', 'b', 'c', 'm'])] },
);
const naked = (id?: string) => JSON.stringify([['naked'], id === undefined ? [] : [[id, 1]]]);

// ---------------------------------------------------------------------------------------------------------------------

test('axis payoffs: the exact optimum and the distinct coordinate vectors of its tied builds, in the Tchebycheff frame', () => {
  const r = payoffTables(tied, req());
  assert.equal(r.status, 'tables');
  if (r.status !== 'tables') return;
  // fE: none 400, a 500, b 500, c 400, m 450 -> optimum 500, tied {a, b}, two distinct vectors (they differ in spend)
  assert.deepEqual(r.axes.e.optimum, q(500));
  assert.deepEqual(r.axes.e.endpoints.map(e => e.coordinates), [vec(500, 0, 1150), vec(500, 0, 1400)]);
  assert.deepEqual(r.axes.e.endpoints.map(e => e.projectionKeys), [[naked('a')], [naked('b')]]);
  // fR: only c carries recoil (-1/4 x 1000 = -250): unique minimum
  assert.deepEqual(r.axes.r.optimum, q(-250));
  assert.deepEqual(r.axes.r.endpoints.map(e => e.coordinates), [vec(400, -250, 1200)]);
  // fP: the receiver alone costs 1000, every part adds to it: unique minimum
  assert.deepEqual(r.axes.p.optimum, q(1000));
  assert.deepEqual(r.axes.p.endpoints.map(e => e.coordinates), [vec(400, 0, 1000)]);
  assert.deepEqual(r.ideal, { zE: q(500), zR: q(-250), zP: q(1000) });
});

test('a tied ergonomics optimum with different prices gives exactly two admissible tables, differing only in the price nadir', () => {
  const r = payoffTables(tied, req());
  assert.equal(r.status, 'tables');
  if (r.status !== 'tables') return;
  // Choose one tied build per axis. The r and p endpoints are forced: c = (400, -250, 1200) and none = (400, 0, 1000).
  //   e-endpoint a: (500, 0, 1150): zE 500, nadE min(500,400,400) = 400; zR -250, nadR max(0,-250,0) = 0;
  //                 zP 1000, nadP max(1150, 1200, 1000) = 1200
  //   e-endpoint b: (500, 0, 1400): nadP max(1400, 1200, 1000) = 1400, everything else as above
  assert.deepEqual(r.tables.map(t => t.table), [table(500, 400, -250, 0, 1000, 1200), table(500, 400, -250, 0, 1000, 1400)]);
  // the witness names the tied build behind each table
  assert.deepEqual(r.tables.map(t => t.witness.e.projectionKeys[0]), [naked('a'), naked('b')]);
  assert.deepEqual(r.tables.map(t => t.witness.r.projectionKeys[0]), [naked('c'), naked('c')]);
  assert.deepEqual(r.tables.map(t => t.witness.p.projectionKeys[0]), [naked(), naked()]);
});

test('every single-axis payoff solve of the weighted oracle ([100,0,0], [0,100,0], [0,0,100]) selects exactly the tie set reported', () => {
  const r = payoffTables(tied, req());
  assert.equal(r.status, 'tables');
  if (r.status !== 'tables') return;
  for (const [axis, weights] of [['e', [100, 0, 0]], ['r', [0, 100, 0]], ['p', [0, 0, 100]]] as const) {
    const solved = runOracle(tied, req({ ergo_weight: weights[0], recoil_weight: weights[1], price_weight: weights[2] }));
    assert.deepEqual([...solved.maximizers].sort(), r.axes[axis].endpoints.flatMap(e => e.projectionKeys).sort(), `axis ${axis}`);
  }
});

test('checkIdealPoint accepts each admissible table with a witness and rejects a table built from a non-optimal build', () => {
  for (const t of [table(500, 400, -250, 0, 1000, 1200), table(500, 400, -250, 0, 1000, 1400)]) {
    const verdict = checkIdealPoint(tied, req(), ideal(t));
    assert.equal(verdict.status, 'admissible', describeTable(t));
    assert.equal(verdict.admissible, true);
    if (verdict.status === 'admissible') assert.deepEqual(verdict.table, t);
  }
  // Table of the endpoint triple {m, c, none}: m = (450, 0, 1010) is NOT an ergonomics optimum (500 exists), so the reported zE is 450.
  const fromNonOptimal = table(450, 400, -250, 0, 1000, 1200);
  const verdict = checkIdealPoint(tied, req(), ideal(fromNonOptimal));
  assert.equal(verdict.status, 'inadmissible');
  assert.equal(verdict.admissible, false);
  if (verdict.status === 'inadmissible') {
    assert.equal(verdict.code, 'IDEAL_MISMATCH');
    assert.match(verdict.reason, /zE/);
    assert.match(verdict.reason, /450/);
    assert.match(verdict.reason, /500/);
  }
});

test('the ideal coordinates must be exact: each of zE, zR and zP is checked, an off-by-one is inadmissible', () => {
  const good = table(500, 400, -250, 0, 1000, 1200);
  for (const [name, bad] of [
    ['zE', { ...good, zE: q(501) }], ['zR', { ...good, zR: q(-249) }], ['zP', { ...good, zP: q(1001) }],
  ] as const) {
    const verdict = checkIdealPoint(tied, req(), ideal(bad));
    assert.equal(verdict.admissible, false, name);
    if (verdict.status === 'inadmissible') {
      assert.equal(verdict.code, 'IDEAL_MISMATCH', name);
      assert.ok(verdict.reason.includes(name), `${name}: ${verdict.reason}`);
    }
  }
});

test('a nadir no tied endpoint choice produces is inadmissible even when the ideal coordinates are exact', () => {
  // nadP is either 1200 (e-endpoint a) or 1400 (e-endpoint b); 1300 lies between, 1150 is a's own price but c costs 1200.
  for (const nadP of [1100, 1150, 1300, 1500]) {
    const verdict = checkIdealPoint(tied, req(), ideal(table(500, 400, -250, 0, 1000, nadP)));
    assert.equal(verdict.admissible, false, String(nadP));
    if (verdict.status === 'inadmissible') assert.equal(verdict.code, 'NADIR_NOT_ATTAINABLE', String(nadP));
  }
  // nadE and nadR are forced too: nadE is the worst ergonomics of the three endpoints (400) and nadR the worst recoil (0)
  assert.equal(checkIdealPoint(tied, req(), ideal(table(500, 450, -250, 0, 1000, 1200))).admissible, false);
  assert.equal(checkIdealPoint(tied, req(), ideal(table(500, 400, -250, 100, 1000, 1200))).admissible, false);
});

/**
 * Receiver as above. a1 and a2 tie on ergonomics and differ in recoil AND price, so one endpoint's coordinates must feed every nadir
 * consistently: (fE, fR, fP)
 *   none (400, 0, 1000); a1 (+10, recoil +1/10, 100 RUB) (500, 100, 1100); a2 (+10, 300 RUB) (500, 0, 1300); c (recoil -1/4, 20 RUB) (400, -250, 1020).
 * The recoil modifier +1/10 is a binary64, so the test uses +1/8 = 0.125 instead (fR = +125).
 */
const joint = fixtureOf(
  [
    { id: 'a1', ergonomics: 10, recoilModifier: 0.125, offers: trader(100) },
    { id: 'a2', ergonomics: 10, offers: trader(300) },
    { id: 'c', recoilModifier: -0.25, offers: trader(20) },
  ],
  { ergonomics: 40, slots: [slot('s', ['a1', 'a2', 'c'])] },
);

test('the three endpoints are chosen jointly: one tied build feeds every nadir, so mixed nadirs are not admissible', () => {
  const r = payoffTables(joint, req());
  assert.equal(r.status, 'tables');
  if (r.status !== 'tables') return;
  // builds: none (400, 0, 1000), a1 (500, 125, 1100), a2 (500, 0, 1300), c (400, -250, 1020). e ties {a1, a2}; r -> c; p -> none.
  //   e = a1: nadE 400, nadR max(125, -250, 0) = 125, nadP max(1100, 1020, 1000) = 1100
  //   e = a2: nadE 400, nadR max(0, -250, 0) = 0,   nadP max(1300, 1020, 1000) = 1300
  assert.deepEqual(r.tables.map(t => t.table), [table(500, 400, -250, 0, 1000, 1300), table(500, 400, -250, 125, 1000, 1100)]);
  // nadR from a1 combined with nadP from a2 (and the other way round) comes from no single endpoint build
  assert.equal(checkIdealPoint(joint, req(), ideal(table(500, 400, -250, 125, 1000, 1300))).admissible, false);
  assert.equal(checkIdealPoint(joint, req(), ideal(table(500, 400, -250, 0, 1000, 1100))).admissible, false);
  assert.equal(checkIdealPoint(joint, req(), ideal(table(500, 400, -250, 125, 1000, 1100))).admissible, true);
  assert.equal(checkIdealPoint(joint, req(), ideal(table(500, 400, -250, 0, 1000, 1300))).admissible, true);
});

test('the request constraints define the domain: a price cap that removes one tied build leaves exactly one table', () => {
  // max_price 1300 removes b (1400): the ergonomics optimum is the unique build a, so the only table is a's.
  const r = payoffTables(tied, req({ max_price: 1300 }));
  assert.equal(r.status, 'tables');
  if (r.status !== 'tables') return;
  assert.deepEqual(r.tables.map(t => t.table), [table(500, 400, -250, 0, 1000, 1200)]);
  assert.equal(checkIdealPoint(tied, req({ max_price: 1300 }), ideal(table(500, 400, -250, 0, 1000, 1400))).admissible, false);
});

test('weights, use_tchebycheff and the request ideal_point play no part: payoffs are the single-axis solves of the domain', () => {
  const plain = payoffTables(tied, req());
  const noisy = payoffTables(tied, req({
    ergo_weight: -5, recoil_weight: 7, price_weight: 3, use_tchebycheff: true, ideal_point: { zE: 1, nadE: 2, zR: 3, nadR: 4, zP: 5, nadP: 6 },
  }));
  assert.deepEqual(noisy, plain);
  // a Tchebycheff request without an ideal point is not an input error for the payoff computation itself
  assert.doesNotThrow(() => payoffTables(tied, req({ use_tchebycheff: true, ideal_point: null })));
});

test('use_true_ergo moves the ergonomics axis to TED x 10: a 4 kg receiver costs 25 ergonomics points', () => {
  // Receiver ergonomics 50, 4 kg; part a (+10 ergonomics, -1/2 recoil, 200 RUB, weightless). Builds: none (50, 0, 1000), a (60, -1/2, 1200).
  // First clamp: fE = 500 and 600. TED = effective ergonomics - penalty(W); q(4 kg) = 100 - 300/4 = 25, so TED = 25 and 35, fE = 250 and 350.
  // Every axis is won by a single build, so there is exactly one table each way.
  const f = fixtureOf(
    [{ id: 'a', ergonomics: 10, recoilModifier: -0.5, offers: trader(200) }],
    { ergonomics: 50, weightKg: 4, slots: [slot('s', ['a'])] },
  );
  const plain = payoffTables(f, req());
  const ted = payoffTables(f, req({ use_true_ergo: true }));
  assert.equal(plain.status, 'tables');
  assert.equal(ted.status, 'tables');
  if (plain.status !== 'tables' || ted.status !== 'tables') return;
  assert.deepEqual(plain.tables.map(t => t.table), [table(600, 500, -500, 0, 1000, 1200)]);
  assert.deepEqual(ted.tables.map(t => t.table), [table(350, 250, -500, 0, 1000, 1200)]);
});

test('with a single build every axis endpoint is that build and the one table collapses to ideal = nadir', () => {
  const f = fixtureOf([], { ergonomics: 40 });
  const r = payoffTables(f, req());
  assert.equal(r.status, 'tables');
  if (r.status !== 'tables') return;
  assert.deepEqual(r.tables.map(t => t.table), [table(400, 400, 0, 0, 1000, 1000)]);
  assert.equal(checkIdealPoint(f, req(), ideal(table(400, 400, 0, 0, 1000, 1000))).admissible, true);
  assert.equal(checkIdealPoint(f, req(), ideal(table(400, 300, 0, 0, 1000, 1000))).admissible, false);
});

test('an empty domain has no tables: it is reported as empty and no ideal point is admissible', () => {
  // The receiver alone costs 1000 RUB, so a 500 RUB cap leaves no build (production would fail its endpoint certification).
  const r = payoffTables(tied, req({ max_price: 500 }));
  assert.equal(r.status, 'empty');
  assert.deepEqual(r.tables, []);
  const verdict = checkIdealPoint(tied, req({ max_price: 500 }), ideal(table(500, 400, -250, 0, 1000, 1200)));
  assert.equal(verdict.status, 'inadmissible');
  assert.equal(verdict.admissible, false);
  if (verdict.status === 'inadmissible') assert.equal(verdict.code, 'EMPTY_DOMAIN');
});

test('an incomplete enumeration is unknown: it claims neither admissibility nor inadmissibility', () => {
  const capped = { maxNodes: 2 };
  const r = payoffTables(tied, req(), capped);
  assert.equal(r.status, 'unknown');
  assert.deepEqual(r.tables, []);
  for (const t of [table(500, 400, -250, 0, 1000, 1200), table(1, 2, 3, 4, 5, 6)]) {
    const verdict = checkIdealPoint(tied, req(), ideal(t), capped);
    assert.equal(verdict.status, 'unknown', describeTable(t));
    assert.equal(verdict.admissible, null);
    if (verdict.status === 'unknown') assert.match(verdict.reason, /cap/i);
  }
  // an oversized table product is incomplete too, never a verdict
  const small = payoffTables(tied, req(), { maxTableCombinations: 1 });
  assert.equal(small.status, 'unknown');
});

test('malformed input is an input error, not a verdict: a non-finite reported coordinate and an unknown weapon', () => {
  assert.throws(() => checkIdealPoint(tied, req(), { zE: Number.NaN, nadE: 0, zR: 0, nadR: 0, zP: 0, nadP: 0 }), ReferenceInputError);
  assert.throws(() => payoffTables(tied, { weapon_id: 'no-such-gun' }), ReferenceInputError);
});

test('reported doubles are decoded to exact rationals: a coordinate that is not a binary64 value has no exact double (Stage 3 needs a tolerance)', () => {
  // recoil modifier -0.1 is the binary64 -3602879701896397/2^55 (slightly below -1/10), so the exact ideal zR = 1000 x that
  // = -3602879701896397000/2^55, about -100.0000000000000055 -- which is not a double. The nearest double -100 is therefore not exactly admissible.
  const f = fixtureOf([{ id: 'c', recoilModifier: -0.1, offers: trader(10) }], { ergonomics: 40, slots: [slot('s', ['c'])] });
  const r = payoffTables(f, req());
  assert.equal(r.status, 'tables');
  if (r.status !== 'tables') return;
  const exactZR: Q = mul(q(1000), fromBinary64(-0.1));
  assert.deepEqual(r.ideal?.zR, exactZR);
  assert.notDeepEqual(exactZR, q(-100));
  const verdict = checkIdealPoint(f, req(), { zE: 400, nadE: 400, zR: -100, nadR: 0, zP: 1000, nadP: 1010 });
  assert.equal(verdict.admissible, false);
  if (verdict.status === 'inadmissible') assert.equal(verdict.code, 'IDEAL_MISMATCH');
});
