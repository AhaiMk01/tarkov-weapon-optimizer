/**
 * No-good cuts for a solution the independent validator rejected (Phase 2.4b-3b).
 *
 * The solver is held to the model text only within its feasibility tolerance, the validator checks exact rational arithmetic, so the two can
 * disagree on a build that sits on a boundary (a total weight a few ulps over its cap is feasible to HiGHS and infeasible to the validator).
 * Publishing such a build is forbidden, and dropping the node would hide the valid builds beside it. The cut removes exactly the rejected 0/1
 * assignment of the decision columns and nothing else:
 *
 *     sum over the columns that were 1 of y  -  sum over the columns that were 0 of y   <=   (number that were 1) - 1
 *
 * It is violated only by the rejected assignment itself, so every build the validator accepts stays feasible: the cut model is a restriction
 * that contains the whole true feasible set, its optimum is still an upper bound of it, and if it is infeasible there is no valid build in
 * the node. (A cut on the ones alone would also remove every superset of the build, including valid ones that add a negative-weight part.)
 */

/** Rows are written in groups of this many terms per line: some LP readers choke on very long lines, the format allows a row to span lines. */
const TERMS_PER_LINE = 20;

/**
 * The no-good row (`name: ... <= rhs`) that excludes the 0/1 assignment `values` restricted to `columns`. A value above one half reads as 1.
 * Returns the row text with no trailing newline.
 */
export function noGoodRow(name: string, columns: Iterable<string>, values: Readonly<Record<string, number>>): string {
  const ones: string[] = [];
  const zeros: string[] = [];
  for (const column of columns) (values[column] > 0.5 ? ones : zeros).push(column);
  const terms = [...ones.map(c => `+ ${c}`), ...zeros.map(c => `- ${c}`)];
  const lines: string[] = [];
  for (let k = 0; k < terms.length; k += TERMS_PER_LINE) lines.push(terms.slice(k, k + TERMS_PER_LINE).join(' '));
  // A leading "+" on the first term is not part of the LP grammar's row start, so the first sign is dropped when it is positive.
  if (lines.length > 0 && lines[0].startsWith('+ ')) lines[0] = lines[0].slice(2);
  return `  ${name}: ${lines.join('\n    ')} <= ${ones.length - 1}`;
}

/** Insert constraint rows in front of the `Bounds` section of an LP text (every model writer here puts that header on its own line). */
export function insertRows(lpText: string, rows: readonly string[]): string {
  if (rows.length === 0) return lpText;
  const at = lpText.indexOf('\nBounds\n');
  if (at < 0) throw new Error('the model text has no Bounds section to insert rows before');
  return `${lpText.slice(0, at)}\n${rows.join('\n')}${lpText.slice(at)}`;
}
