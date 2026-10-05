/**
 * Model readback and the emitted-versus-parsed comparison (ADR 0013 section 4B).
 *
 * `readbackModel` (in native.ts) returns what HiGHS actually holds after parsing an LP text. This file defines that shape,
 * an independent strict parser of the LP text (`parseLpText`, a verified-equivalence second reader that shares no code with
 * HiGHS), and `compareReadback`, which reports every missing, extra and changed coefficient, objective entry, bound,
 * integrality marker, row and column. A dropped coefficient is therefore detected, never assumed away.
 *
 * `parseLpText` accepts the subset the model writers emit and rejects everything else with an `LpParseError`, so it cannot
 * report a false equivalence on text it does not understand: Maximize/Minimize, Subject To (`<=`, `>=`, `=`), Bounds,
 * General, Binary, End, `\` comments, whitespace-separated tokens, finite or `inf` bounds.
 */

/** HiGHS `HighsVarType`: 0 continuous, 1 integer, 2 semi-continuous, 3 semi-integer, 4 implicit integer. */
export type IntegralityCode = number;

export interface ModelReadback {
  readonly sense: 'min' | 'max';
  readonly objectiveOffset: number;
  readonly numCol: number;
  readonly numRow: number;
  readonly numNz: number;
  readonly colNames: readonly string[];
  readonly rowNames: readonly string[];
  /** Objective coefficients exactly as stored (HiGHS stores a maximization's costs unnegated and keeps `sense`). */
  readonly colCost: Float64Array;
  readonly colLower: Float64Array;
  readonly colUpper: Float64Array;
  readonly rowLower: Float64Array;
  readonly rowUpper: Float64Array;
  readonly integrality: Int32Array;
  /** Constraint matrix, column-wise: column j holds entries start[j] .. (start[j+1] ?? numNz) - 1. */
  readonly matrix: {
    readonly start: Int32Array;
    readonly index: Int32Array;
    readonly value: Float64Array;
  };
}

export interface ExpectedColumn {
  name: string;
  cost: number;
  lower: number;
  upper: number;
  integer: boolean;
}

export interface ExpectedRow {
  name: string;
  lower: number;
  upper: number;
  /** [column name, coefficient]; zero coefficients are ignored by the comparison (HiGHS never stores them). */
  terms: ReadonlyArray<readonly [string, number]>;
}

export interface ExpectedModel {
  sense: 'min' | 'max';
  objectiveOffset: number;
  columns: ExpectedColumn[];
  rows: ExpectedRow[];
}

export class LpParseError extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(`LP text line ${line}: ${message}`);
    this.name = 'LpParseError';
    this.line = line;
  }
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const INFINITY_WORD = /^([+-]?)(?:inf|infinity)$/i;

function parseNumber(token: string, line: number): number {
  const inf = INFINITY_WORD.exec(token);
  if (inf) return inf[1] === '-' ? -Infinity : Infinity;
  if (!NUMBER.test(token)) throw new LpParseError(`expected a number, got "${token}"`, line);
  return Number(token);
}

const isNumberToken = (token: string): boolean => NUMBER.test(token) || INFINITY_WORD.test(token);

/**
 * LP names: a letter or one of `_ . $ # % & ( ) , ; ? @ { } ~ ' ! " | ^ [ ]` first, then also digits. `+` and `-` are not name
 * characters: HiGHS splits `x_-1` into the column `x_` and the number `-1`, so such a token is rejected here (the legacy model
 * writer emitted exactly that for index -1, and HiGHS then read a different model than the one written). A backslash starts a
 * comment.
 */
const NAME = /^[A-Za-z_.$#%&(),;?@{}~'!"|^[\]][A-Za-z0-9_.$#%&(),;?@{}~'!"|^[\]]*$/;

type Section = 'objective' | 'constraints' | 'bounds' | 'general' | 'binary' | 'end';

function sectionOf(line: string): Section | 'max' | 'min' | undefined {
  const text = line.trim().toLowerCase().replace(/\s+/g, ' ');
  if (['maximize', 'maximum', 'max'].includes(text)) return 'max';
  if (['minimize', 'minimum', 'min'].includes(text)) return 'min';
  if (['subject to', 'such that', 'st', 's.t.', 'st.'].includes(text)) return 'constraints';
  if (['bounds', 'bound'].includes(text)) return 'bounds';
  if (['general', 'generals', 'gen', 'integers', 'integer'].includes(text)) return 'general';
  if (['binary', 'binaries', 'bin'].includes(text)) return 'binary';
  if (text === 'end') return 'end';
  return undefined;
}

/** Parse a linear expression made of whitespace-separated `[+|-] [coefficient] name` terms and optional constants. */
function parseExpression(tokens: string[], line: number): { terms: Array<[string, number]>; constant: number } {
  const terms: Array<[string, number]> = [];
  let constant = 0;
  let i = 0;
  while (i < tokens.length) {
    let sign = 1;
    let token = tokens[i];
    // A lone sign token ("+" / "-") applies to the next token; a signed number carries its own sign.
    if (token === '+' || token === '-') {
      sign = token === '-' ? -1 : 1;
      i++;
      if (i >= tokens.length) throw new LpParseError('dangling sign', line);
      token = tokens[i];
      if (token === '+' || token === '-') throw new LpParseError('two consecutive signs', line);
    }
    if (isNumberToken(token)) {
      const value = sign * parseNumber(token, line);
      const next = tokens[i + 1];
      if (next !== undefined && next !== '+' && next !== '-' && !isNumberToken(next)) {
        terms.push([next, value]);
        i += 2;
      } else {
        constant += value;
        i += 1;
      }
    } else {
      if (!NAME.test(token)) {
        const split = /^(.+?)([+-].*)$/.exec(token);
        throw new LpParseError(
          split && NAME.test(split[1])
            ? `token "${token}" contains an operator: HiGHS reads it as the column ${split[1]} followed by ${split[2]}`
            : `unsupported token "${token}"`,
          line,
        );
      }
      terms.push([token, sign]);
      i += 1;
    }
  }
  return { terms, constant };
}

function mergeUnique(terms: Array<[string, number]>, line: number, what: string): Array<[string, number]> {
  const seen = new Set<string>();
  for (const [name] of terms) {
    if (seen.has(name)) throw new LpParseError(`column ${name} repeats in ${what}; merge repeated columns before writing`, line);
    seen.add(name);
  }
  return terms;
}

/** Strict independent parse of an LP text into the model HiGHS is expected to hold. Throws `LpParseError` outside the subset. */
export function parseLpText(text: string): ExpectedModel {
  const columns = new Map<string, ExpectedColumn>();
  const column = (name: string): ExpectedColumn => {
    let c = columns.get(name);
    if (!c) { c = { name, cost: 0, lower: 0, upper: Infinity, integer: false }; columns.set(name, c); }
    return c;
  };
  const rows: ExpectedRow[] = [];
  const rowNames = new Set<string>();
  let sense: 'min' | 'max' | undefined;
  let offset = 0;
  let section: Section | undefined;
  const binaries: string[] = [];
  const generals: string[] = [];
  let objectiveSeen = false;
  const boundTouched = new Set<string>();

  const lines = text.split(/\r?\n/);
  // Constraint and objective statements may span lines until the next section header or the next "name:" label.
  let pending: { tokens: string[]; line: number } | undefined;
  const flush = (): void => {
    if (!pending) return;
    const { tokens, line } = pending;
    pending = undefined;
    if (section === 'objective') {
      objectiveSeen = true;
      let body = tokens;
      if (body[0]?.endsWith(':')) body = body.slice(1);
      else if (body.length && body[0].includes(':')) throw new LpParseError('label must be followed by a space', line);
      const { terms, constant } = parseExpression(body, line);
      mergeUnique(terms, line, 'the objective');
      for (const [name, coef] of terms) column(name).cost = coef;
      offset += constant;
    } else if (section === 'constraints') {
      if (!tokens[0]?.endsWith(':')) throw new LpParseError('every constraint needs a "name:" label', line);
      const name = tokens[0].slice(0, -1);
      if (!name) throw new LpParseError('empty row name', line);
      if (rowNames.has(name)) throw new LpParseError(`duplicate row name ${name}`, line);
      rowNames.add(name);
      const body = tokens.slice(1);
      const opIndex = body.findIndex((t) => t === '<=' || t === '>=' || t === '=');
      if (opIndex < 0) throw new LpParseError(`constraint ${name} has no <=, >= or =`, line);
      if (body.slice(opIndex + 1).some((t) => t === '<=' || t === '>=' || t === '=')) {
        throw new LpParseError(`constraint ${name}: range rows (two relational operators) are not supported`, line);
      }
      const rhsTokens = body.slice(opIndex + 1);
      if (rhsTokens.length !== 1 || !isNumberToken(rhsTokens[0])) {
        throw new LpParseError(`constraint ${name}: the right-hand side must be a single number`, line);
      }
      const { terms, constant } = parseExpression(body.slice(0, opIndex), line);
      if (constant !== 0) throw new LpParseError(`constraint ${name}: constants on the left-hand side are not supported`, line);
      mergeUnique(terms, line, `row ${name}`);
      const rhs = parseNumber(rhsTokens[0], line);
      const op = body[opIndex];
      for (const [col] of terms) column(col);
      rows.push({
        name,
        lower: op === '<=' ? -Infinity : rhs,
        upper: op === '>=' ? Infinity : rhs,
        terms,
      });
    } else if (section === 'bounds') {
      parseBound(tokens, line);
    }
  };

  const parseBound = (tokens: string[], line: number): void => {
    const touch = (name: string): ExpectedColumn => { boundTouched.add(name); return column(name); };
    if (tokens.length === 2 && tokens[1].toLowerCase() === 'free') {
      const c = touch(tokens[0]); c.lower = -Infinity; c.upper = Infinity; return;
    }
    const ops = new Set(['<=', '>=', '=']);
    if (tokens.length === 3 && ops.has(tokens[1])) {
      const [name, op, value] = tokens;
      if (isNumberToken(name) || !isNumberToken(value)) throw new LpParseError(`unsupported bound "${tokens.join(' ')}"`, line);
      const v = parseNumber(value, line);
      const c = touch(name);
      if (op === '<=') { c.upper = v; if (v < c.lower) throw new LpParseError(`upper bound ${v} below the default lower bound of ${name}; state both bounds`, line); }
      else if (op === '>=') c.lower = v;
      else { c.lower = v; c.upper = v; }
      return;
    }
    if (tokens.length === 5 && tokens[1] === '<=' && tokens[3] === '<=') {
      const c = touch(tokens[2]);
      c.lower = parseNumber(tokens[0], line);
      c.upper = parseNumber(tokens[4], line);
      return;
    }
    throw new LpParseError(`unsupported bound statement "${tokens.join(' ')}"`, line);
  };

  for (let n = 0; n < lines.length; n++) {
    const lineNo = n + 1;
    const raw = lines[n].replace(/\\.*$/, '');
    if (!raw.trim()) continue;
    const header = sectionOf(raw);
    if (header !== undefined) {
      flush();
      if (header === 'max' || header === 'min') {
        if (sense) throw new LpParseError('a second objective section', lineNo);
        sense = header;
        section = 'objective';
      } else {
        section = header;
        if (header === 'end') break;
      }
      continue;
    }
    if (section === undefined) throw new LpParseError('text before the objective section', lineNo);
    const tokens = raw.trim().split(/\s+/);
    if (section === 'binary' || section === 'general') {
      for (const name of tokens) {
        if (isNumberToken(name)) throw new LpParseError(`unexpected number "${name}" in the ${section} section`, lineNo);
        (section === 'binary' ? binaries : generals).push(name);
      }
      continue;
    }
    if (section === 'objective' || section === 'constraints') {
      const startsNew = tokens[0].endsWith(':') && (section === 'constraints' || !pending);
      if (startsNew || !pending) { flush(); pending = { tokens, line: lineNo }; }
      else pending.tokens.push(...tokens);
      continue;
    }
    // bounds: one statement per line
    flush();
    pending = { tokens, line: lineNo };
    flush();
  }
  flush();

  if (!sense) throw new LpParseError('no Maximize/Minimize objective section', lines.length);
  if (!objectiveSeen) throw new LpParseError('no objective expression', lines.length);
  for (const name of generals) column(name).integer = true;
  for (const name of binaries) {
    const c = column(name);
    c.integer = true;
    c.lower = 0;
    c.upper = 1;
  }
  return { sense, objectiveOffset: offset, columns: [...columns.values()], rows };
}

/** Which documented HiGHS filter would explain a coefficient that did not survive. */
export type FilterCause = 'small_matrix_value' | 'large_matrix_value' | 'infinite_bound' | 'unexplained';

export type ReadbackDifference =
  | { kind: 'missing-column' | 'extra-column'; name: string }
  | { kind: 'missing-row' | 'extra-row'; name: string }
  | { kind: 'missing-coefficient'; row: string; column: string; expected: number; cause: FilterCause }
  | { kind: 'extra-coefficient'; row: string; column: string; actual: number }
  | { kind: 'changed-coefficient'; row: string; column: string; expected: number; actual: number; cause: FilterCause }
  | { kind: 'changed-objective'; column: string; expected: number; actual: number }
  | { kind: 'changed-column-bound'; column: string; bound: 'lower' | 'upper'; expected: number; actual: number; cause: FilterCause }
  | { kind: 'changed-row-bound'; row: string; bound: 'lower' | 'upper'; expected: number; actual: number; cause: FilterCause }
  | { kind: 'changed-integrality'; column: string; expected: boolean; actual: IntegralityCode }
  | { kind: 'changed-sense'; expected: 'min' | 'max'; actual: 'min' | 'max' }
  | { kind: 'changed-offset'; expected: number; actual: number };

export interface CompareOptions {
  /** HiGHS options in force when the model was read; they decide which differences are explained by a documented filter. */
  smallMatrixValue?: number;
  largeMatrixValue?: number;
  infiniteBound?: number;
  /** Absolute and relative tolerance of numeric equality. Default 0: parsed decimal text must round-trip bit-exactly. */
  absoluteTolerance?: number;
  relativeTolerance?: number;
}

export interface ReadbackComparison {
  /** True iff the readback equals the expected model under the tolerances (no differences of any kind). */
  readonly ok: boolean;
  readonly differences: readonly ReadbackDifference[];
  /** Number of differences per kind. */
  readonly counts: Readonly<Record<string, number>>;
  /** Coefficients, objective entries or bounds a documented HiGHS filter removed (small/large matrix value, infinite bound). */
  readonly filtered: number;
  readonly checked: { columns: number; rows: number; coefficients: number };
}

/** HiGHS defaults, used when `CompareOptions` does not say otherwise. */
const DEFAULT_SMALL_MATRIX_VALUE = 1e-9;
const DEFAULT_LARGE_MATRIX_VALUE = 1e15;
const DEFAULT_INFINITE_BOUND = 1e20;

export function compareReadback(expected: ExpectedModel, readback: ModelReadback, options: CompareOptions = {}): ReadbackComparison {
  const small = options.smallMatrixValue ?? DEFAULT_SMALL_MATRIX_VALUE;
  const large = options.largeMatrixValue ?? DEFAULT_LARGE_MATRIX_VALUE;
  const infiniteBound = options.infiniteBound ?? DEFAULT_INFINITE_BOUND;
  const absTol = options.absoluteTolerance ?? 0;
  const relTol = options.relativeTolerance ?? 0;
  const differences: ReadbackDifference[] = [];

  const same = (a: number, b: number): boolean => {
    if (a === b) return true;
    if (Number.isNaN(a) || Number.isNaN(b) || !Number.isFinite(a) || !Number.isFinite(b)) return false;
    const diff = Math.abs(a - b);
    return diff <= absTol || diff <= relTol * Math.max(Math.abs(a), Math.abs(b));
  };
  const coefficientCause = (value: number): FilterCause =>
    Math.abs(value) <= small ? 'small_matrix_value' : Math.abs(value) >= large ? 'large_matrix_value' : 'unexplained';
  const boundCause = (expectedValue: number, actualValue: number): FilterCause =>
    Math.abs(expectedValue) >= infiniteBound && !Number.isFinite(actualValue) ? 'infinite_bound' : 'unexplained';

  if (expected.sense !== readback.sense) differences.push({ kind: 'changed-sense', expected: expected.sense, actual: readback.sense });
  if (!same(expected.objectiveOffset, readback.objectiveOffset)) {
    differences.push({ kind: 'changed-offset', expected: expected.objectiveOffset, actual: readback.objectiveOffset });
  }

  const colIndex = new Map<string, number>();
  readback.colNames.forEach((name, j) => colIndex.set(name, j));
  const rowIndex = new Map<string, number>();
  readback.rowNames.forEach((name, i) => rowIndex.set(name, i));

  const expectedColumns = new Set<string>();
  for (const col of expected.columns) {
    expectedColumns.add(col.name);
    const j = colIndex.get(col.name);
    if (j === undefined) { differences.push({ kind: 'missing-column', name: col.name }); continue; }
    if (!same(col.cost, readback.colCost[j])) differences.push({ kind: 'changed-objective', column: col.name, expected: col.cost, actual: readback.colCost[j] });
    if (!same(col.lower, readback.colLower[j])) {
      differences.push({ kind: 'changed-column-bound', column: col.name, bound: 'lower', expected: col.lower, actual: readback.colLower[j], cause: boundCause(col.lower, readback.colLower[j]) });
    }
    if (!same(col.upper, readback.colUpper[j])) {
      differences.push({ kind: 'changed-column-bound', column: col.name, bound: 'upper', expected: col.upper, actual: readback.colUpper[j], cause: boundCause(col.upper, readback.colUpper[j]) });
    }
    const code = readback.integrality[j];
    if (col.integer !== (code === 1)) differences.push({ kind: 'changed-integrality', column: col.name, expected: col.integer, actual: code });
  }
  readback.colNames.forEach((name) => { if (!expectedColumns.has(name)) differences.push({ kind: 'extra-column', name }); });

  // Per-row coefficient maps of the readback (row index -> column index -> value), from the column-wise matrix.
  const actualRows: Array<Map<number, number>> = Array.from({ length: readback.numRow }, () => new Map<number, number>());
  const { start, index, value } = readback.matrix;
  for (let j = 0; j < readback.numCol; j++) {
    const end = j + 1 < readback.numCol ? start[j + 1] : readback.numNz;
    for (let k = start[j]; k < end; k++) actualRows[index[k]].set(j, value[k]);
  }

  let coefficientsChecked = 0;
  const expectedRowNames = new Set<string>();
  for (const row of expected.rows) {
    expectedRowNames.add(row.name);
    const i = rowIndex.get(row.name);
    if (i === undefined) { differences.push({ kind: 'missing-row', name: row.name }); continue; }
    if (!same(row.lower, readback.rowLower[i])) {
      differences.push({ kind: 'changed-row-bound', row: row.name, bound: 'lower', expected: row.lower, actual: readback.rowLower[i], cause: boundCause(row.lower, readback.rowLower[i]) });
    }
    if (!same(row.upper, readback.rowUpper[i])) {
      differences.push({ kind: 'changed-row-bound', row: row.name, bound: 'upper', expected: row.upper, actual: readback.rowUpper[i], cause: boundCause(row.upper, readback.rowUpper[i]) });
    }
    const actual = actualRows[i];
    const seen = new Set<number>();
    for (const [colName, coef] of row.terms) {
      if (coef === 0) continue;
      coefficientsChecked++;
      const j = colIndex.get(colName);
      if (j === undefined) continue; // already reported as a missing column
      seen.add(j);
      const got = actual.get(j);
      if (got === undefined) differences.push({ kind: 'missing-coefficient', row: row.name, column: colName, expected: coef, cause: coefficientCause(coef) });
      else if (!same(coef, got)) differences.push({ kind: 'changed-coefficient', row: row.name, column: colName, expected: coef, actual: got, cause: coefficientCause(coef) });
    }
    for (const [j, got] of actual) {
      if (!seen.has(j) && got !== 0) differences.push({ kind: 'extra-coefficient', row: row.name, column: readback.colNames[j], actual: got });
    }
  }
  readback.rowNames.forEach((name) => { if (!expectedRowNames.has(name)) differences.push({ kind: 'extra-row', name }); });

  const counts: Record<string, number> = {};
  let filtered = 0;
  for (const d of differences) {
    counts[d.kind] = (counts[d.kind] ?? 0) + 1;
    if ('cause' in d && d.cause !== 'unexplained') filtered++;
  }
  return {
    ok: differences.length === 0,
    differences,
    counts,
    filtered,
    checked: { columns: expected.columns.length, rows: expected.rows.length, coefficients: coefficientsChecked },
  };
}
