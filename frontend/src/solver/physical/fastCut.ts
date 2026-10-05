/**
 * No-good cuts over GENERAL-INTEGER decision columns (Phase 2.4c, the Fast model).
 *
 * `nogood.ts` excludes a rejected 0/1 assignment; the Fast model's decisions are counts (copies of a part in a slot), so a rejected point can
 * hold a 2 or a 3. A 0/1 reading of such a point would cut the wrong set. This cut excludes exactly one integer point x* of the decision columns
 * and nothing else (every other integer assignment keeps its feasibility, so the cut model still contains every point the validator accepts):
 *
 *     sum over the columns at their lower bound of (x - lo)  +  sum over the columns at their upper bound of (hi - x)
 *       +  sum over the interior columns of (up_j + down_j)   >=   1
 *
 * where, for an interior column (lo < x* < hi), the two binaries stand for "x_j >= x*_j + 1" and "x_j <= x*_j - 1":
 *
 *     x_j - (x*_j + 1 - lo) up_j >= lo        x_j + (hi - x*_j + 1) down_j <= hi
 *
 * An integer point other than x* either differs at a bound column (that column's deviation is at least 1) or at an interior column (one of
 * its two indicators can be 1 while the row holds), so the left side reaches 1; x* itself leaves every deviation and indicator at 0. For a
 * model whose decision columns are all binary the row is the one `noGoodRow` writes.
 *
 * The cut introduces binaries (two per interior column), so it also contributes to the model's Binary section: `appendCuts` splices rows and
 * binaries into an LP text produced by `LpWriter` (rows before `Bounds`, binaries at the end of the text).
 */

/** A decision column of the model: an integer column with finite bounds. */
export interface DecisionColumn {
  name: string;
  lo: number;
  hi: number;
}

export interface IntegerNoGood {
  /** The row text, no trailing newline. */
  row: string;
  /** Names of the binaries the row introduces (declared in the Binary section). */
  binaries: string[];
}

/** Rows are written in groups of this many terms per line: some LP readers choke on very long lines, the format allows a row to span lines. */
const TERMS_PER_LINE = 20;

/**
 * The cut that excludes the integer point `values` of `columns`. A value is rounded to the nearest integer and must lie within its column's
 * domain, otherwise the point is not one the model can hold and nothing is excluded (`null`).
 */
export function integerNoGood(name: string, columns: readonly DecisionColumn[], values: Readonly<Record<string, number>>): IntegerNoGood | null {
  const terms: { column: string; coefficient: number }[] = [];
  const binaries: string[] = [];
  const extraRows: string[] = [];
  let constant = 0; // sum of the lower bounds of the low columns minus the upper bounds of the high columns: the deviations' constants, moved to the right
  let k = 0;
  for (const { name: column, lo, hi } of columns) {
    const raw = values[column];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
    const x = Math.round(raw);
    if (x < lo || x > hi) return null;
    if (x === lo) {
      terms.push({ column, coefficient: 1 }); // the deviation x - lo
      constant += lo;
    } else if (x === hi) {
      terms.push({ column, coefficient: -1 }); // the deviation hi - x
      constant -= hi;
    } else {
      const up = `${name}_up${k}`;
      const down = `${name}_dn${k}`;
      k++;
      binaries.push(up, down);
      terms.push({ column: up, coefficient: 1 }, { column: down, coefficient: 1 });
      extraRows.push(`  ${name}_u${k}: ${column} - ${x + 1 - lo} ${up} >= ${lo}`);
      extraRows.push(`  ${name}_d${k}: ${column} + ${hi - x + 1} ${down} <= ${hi}`);
    }
  }
  if (terms.length === 0) return null;
  const text = terms.map((term, i) => {
    const sign = term.coefficient < 0 ? '-' : '+';
    const body = `${Math.abs(term.coefficient)} ${term.column}`;
    return i === 0 ? (sign === '-' ? `- ${body}` : body) : `${sign} ${body}`;
  });
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += TERMS_PER_LINE) lines.push(text.slice(i, i + TERMS_PER_LINE).join(' '));
  // sum_low (x - lo) + sum_high (hi - x) + indicators >= 1  <=>  sum_low x - sum_high x + indicators >= 1 + sum_low lo - sum_high hi.
  const rhs = 1 + constant;
  const row = [`  ${name}: ${lines.join('\n    ')} >= ${rhs}`, ...extraRows].join('\n');
  return { row, binaries };
}

/** Splice cuts into an LP text written by `LpWriter`: rows go before the Bounds section, binaries are appended to (or open) the Binary section. */
export function appendCuts(lpText: string, cuts: readonly IntegerNoGood[]): string {
  if (cuts.length === 0) return lpText;
  const at = lpText.indexOf('\nBounds\n');
  if (at < 0) throw new Error('the model text has no Bounds section to insert rows before');
  const rows = cuts.map(cut => cut.row).join('\n');
  const binaries = cuts.flatMap(cut => cut.binaries);
  let text = `${lpText.slice(0, at)}\n${rows}${lpText.slice(at)}`;
  if (binaries.length > 0) {
    const end = text.lastIndexOf('\nEnd');
    if (end < 0) throw new Error('the model text has no End line');
    const lines: string[] = [];
    for (let i = 0; i < binaries.length; i += 24) lines.push(`  ${binaries.slice(i, i + 24).join(' ')}`);
    const tail = text.includes('\nBinary\n') ? lines.join('\n') : `Binary\n${lines.join('\n')}`;
    text = `${text.slice(0, end)}\n${tail}${text.slice(end)}`;
  }
  return text;
}
