// No-good cuts over general-integer decision columns (src/solver/physical/fastCut.ts): the cut excludes exactly the rejected integer point and no
// other, checked by solving a tiny model pinned to every point of the domain on the pinned native build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendCuts, integerNoGood, noGoodRow, type DecisionColumn } from '../../src/solver/physical';
import { parseLpText } from '../../src/solver/native';
import { solveLp, STRICT_OPTIONS } from './lpHarness';

const BASE_LP = ['Maximize', '  obj: x', 'Subject To', '  keep: x + y + w >= 0', 'Bounds', '  0 <= x <= 3', 'General', '  x', 'Binary', '  y w', 'End'].join('\n');
const COLUMNS: DecisionColumn[] = [{ name: 'x', lo: 0, hi: 3 }, { name: 'y', lo: 0, hi: 1 }, { name: 'w', lo: 0, hi: 1 }];

async function feasible(lp: string, point: { x: number; y: number; w: number }): Promise<boolean> {
  const pinned = lp.replace('\nBounds\n', `\n  pin_x: x = ${point.x}\n  pin_y: y = ${point.y}\n  pin_w: w = ${point.w}\nBounds\n`);
  return (await solveLp(pinned, STRICT_OPTIONS)).status === 'Optimal';
}

test('the cut excludes exactly the rejected point: every other integer point of the domain stays feasible', async () => {
  for (const rejected of [{ x: 0, y: 0, w: 0 }, { x: 3, y: 1, w: 1 }, { x: 2, y: 1, w: 0 }, { x: 1, y: 0, w: 1 }]) {
    const cut = integerNoGood('ng', COLUMNS, rejected);
    assert.ok(cut);
    const lp = appendCuts(BASE_LP, [cut]);
    parseLpText(lp); // the spliced text is strictly parseable
    for (let x = 0; x <= 3; x++) {
      for (const y of [0, 1]) {
        for (const w of [0, 1]) {
          const same = x === rejected.x && y === rejected.y && w === rejected.w;
          assert.equal(await feasible(lp, { x, y, w }), !same, `point ${JSON.stringify({ x, y, w })} against the cut of ${JSON.stringify(rejected)}`);
        }
      }
    }
  }
});

test('interior values introduce two binaries each and no more; points at a bound introduce none', () => {
  assert.deepEqual(integerNoGood('ng', COLUMNS, { x: 0, y: 1, w: 0 })?.binaries, []);
  assert.deepEqual(integerNoGood('ng', COLUMNS, { x: 3, y: 0, w: 0 })?.binaries, []);
  assert.deepEqual(integerNoGood('ng', COLUMNS, { x: 2, y: 0, w: 0 })?.binaries, ['ng_up0', 'ng_dn0']);
});

test('for 0/1 columns the cut is the one `noGoodRow` writes', () => {
  const binary: DecisionColumn[] = [{ name: 'a', lo: 0, hi: 1 }, { name: 'b', lo: 0, hi: 1 }, { name: 'c', lo: 0, hi: 1 }];
  const point = { a: 1, b: 0, c: 1 };
  const general = integerNoGood('ng', binary, point);
  assert.ok(general);
  // sum_low x - sum_high x >= 1 - #high  is  sum_high x - sum_low x <= #high - 1: the same half-space, row for row.
  assert.equal(noGoodRow('ng', ['a', 'b', 'c'], point), '  ng: a + c - b <= 1');
  assert.equal(general.row, '  ng: - 1 a + 1 b - 1 c >= -1');
});

test('a point outside the domain, a missing column or a non-number excludes nothing (null), and appending no cuts changes nothing', () => {
  assert.equal(integerNoGood('ng', COLUMNS, { x: 4, y: 0, w: 0 }), null);
  assert.equal(integerNoGood('ng', COLUMNS, { x: -1, y: 0, w: 0 }), null);
  assert.equal(integerNoGood('ng', COLUMNS, { x: 0, y: 0 } as unknown as Record<string, number>), null);
  assert.equal(integerNoGood('ng', COLUMNS, { x: Number.NaN, y: 0, w: 0 }), null);
  assert.equal(integerNoGood('ng', [], {}), null);
  assert.equal(appendCuts(BASE_LP, []), BASE_LP);
});

test('binaries are appended to an existing Binary section, or open one when the text has none', () => {
  const cut = integerNoGood('ng', COLUMNS, { x: 1, y: 0, w: 0 });
  assert.ok(cut);
  const withSection = appendCuts(BASE_LP, [cut]);
  assert.equal(withSection.split('\nBinary\n').length, 2, 'one Binary section');
  assert.match(withSection, /\n {2}ng_up0 ng_dn0\nEnd$/);
  const bare = ['Maximize', '  obj: x', 'Subject To', '  keep: x >= 0', 'Bounds', '  0 <= x <= 3', 'General', '  x', 'End'].join('\n');
  const opened = appendCuts(bare, [integerNoGood('ng', [{ name: 'x', lo: 0, hi: 3 }], { x: 1 }) as NonNullable<typeof cut>]);
  assert.match(opened, /\nBinary\n {2}ng_up0 ng_dn0\nEnd$/);
  parseLpText(opened);
});
