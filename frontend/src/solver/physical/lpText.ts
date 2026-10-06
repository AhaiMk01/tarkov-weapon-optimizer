/**
 * Minimal CPLEX-LP text writer for the physical model (ADR 0013 section 4C).
 *
 * Every number goes through `String(n)`, the shortest string that round-trips the binary64 value: no `toFixed`, no rounding,
 * no integer scaling. A coefficient that is not finite never reaches the text. Repeated columns of one row are merged before
 * writing (HiGHS rejects duplicate columns in a row, and a repeated column is a real case: a slot blocker also occupies the
 * slot it blocks). Every column is declared with finite bounds; there is no free column.
 */

import { finiteOrThrow } from './numeric';

export type RowSense = '<=' | '>=' | '=';

export type ColumnKind = 'continuous' | 'binary' | 'integer';

/** A column declaration, kept for the model's metadata (domains and integrality of every column the LP holds). */
export interface ColumnDeclaration {
  name: string;
  kind: ColumnKind;
  lo: number;
  hi: number;
}

/** `String(n)` for a finite number (negative zero reads `0`). */
export const lpNumber = (n: number): string => String(finiteOrThrow(n, 'LP number'));

/** One row after merging repeated columns and dropping zero coefficients. */
export interface MergedRow {
  names: string[];
  coefs: number[];
}

/** Merge repeated columns (summing their coefficients) and drop exact zeros, keeping first-appearance order. */
export function mergeTerms(terms: Iterable<readonly [string, number]>): MergedRow {
  const sums = new Map<string, number>();
  for (const [name, coef] of terms) {
    finiteOrThrow(coef, `coefficient of ${name}`);
    sums.set(name, (sums.get(name) ?? 0) + coef);
  }
  const names: string[] = [];
  const coefs: number[] = [];
  for (const [name, coef] of sums) {
    if (coef === 0) continue;
    names.push(name);
    coefs.push(coef);
  }
  return { names, coefs };
}

function termsText(row: MergedRow): string {
  const parts: string[] = [];
  for (let i = 0; i < row.names.length; i++) {
    const c = row.coefs[i];
    if (i === 0) parts.push(`${lpNumber(c)} ${row.names[i]}`);
    else parts.push(c < 0 ? `- ${lpNumber(-c)} ${row.names[i]}` : `+ ${lpNumber(c)} ${row.names[i]}`);
  }
  return parts.join(' ');
}

export class LpWriter {
  private readonly rowLines: string[] = [];
  private readonly boundLines: string[] = [];
  private readonly binaryNames: string[] = [];
  private readonly integerNames: string[] = [];
  private readonly columnNames = new Set<string>();
  private readonly rowNames = new Set<string>();
  private objective = '';
  readonly declarations: ColumnDeclaration[] = [];
  nonzeros = 0;
  /** Smallest and largest magnitude of a written matrix coefficient (Infinity and 0 while there is none). */
  minAbsCoefficient = Infinity;
  maxAbsCoefficient = 0;

  get columnCount(): number {
    return this.columnNames.size;
  }

  get rowCount(): number {
    return this.rowNames.size;
  }

  get binaryCount(): number {
    return this.binaryNames.length;
  }

  get integerCount(): number {
    return this.integerNames.length;
  }

  hasColumn(name: string): boolean {
    return this.columnNames.has(name);
  }

  /**
   * Declare a column with finite bounds. Binary columns carry the section declaration instead of a bounds line. A column with
   * `record` false (the per-occurrence decision columns, tens of thousands of them) is declared but not listed in `declarations`.
   */
  addColumn(name: string, kind: ColumnKind, lo: number, hi: number, record = true): void {
    finiteOrThrow(lo, `lower bound of ${name}`);
    finiteOrThrow(hi, `upper bound of ${name}`);
    if (lo > hi) throw new RangeError(`column ${name} has an empty domain [${String(lo)}, ${String(hi)}]`);
    if (this.columnNames.has(name)) throw new Error(`column ${name} declared twice`);
    this.columnNames.add(name);
    if (record) this.declarations.push({ name, kind, lo, hi });
    if (kind === 'binary') {
      if (lo !== 0 || hi !== 1) throw new RangeError(`binary column ${name} must have domain [0, 1]`);
      this.binaryNames.push(name);
      return;
    }
    this.boundLines.push(lo === hi ? `  ${name} = ${lpNumber(lo)}` : `  ${lpNumber(lo)} <= ${name} <= ${lpNumber(hi)}`);
    if (kind === 'integer') this.integerNames.push(name);
  }

  setObjective(column: string): void {
    this.objective = column;
  }

  /**
   * Write a row. `terms` must reduce to at least one nonzero coefficient; a row without variables is a constant statement the
   * caller decides (it is never written). Returns the merged row.
   */
  addRow(name: string, terms: Iterable<readonly [string, number]>, sense: RowSense, rhs: number): MergedRow {
    return this.addMerged(name, mergeTerms(terms), sense, rhs);
  }

  /** Write an already merged row (see {@link addRow}). */
  addMerged(name: string, row: MergedRow, sense: RowSense, rhs: number): MergedRow {
    if (row.names.length === 0) throw new Error(`row ${name} has no variables`);
    if (this.rowNames.has(name)) throw new Error(`row ${name} declared twice`);
    for (const column of row.names) if (!this.columnNames.has(column)) throw new Error(`row ${name} uses the undeclared column ${column}`);
    this.rowNames.add(name);
    this.nonzeros += row.names.length;
    for (const c of row.coefs) {
      const a = Math.abs(c);
      if (a < this.minAbsCoefficient) this.minAbsCoefficient = a;
      if (a > this.maxAbsCoefficient) this.maxAbsCoefficient = a;
    }
    this.rowLines.push(`  ${name}: ${termsText(row)} ${sense} ${lpNumber(rhs)}`);
    return row;
  }

  toString(): string {
    return this.write(this.integerNames, this.binaryNames, []);
  }

  /**
   * The same model with the listed integer and binary columns made continuous over their declared domains: a relaxation of
   * {@link toString} (every row, bound and objective unchanged; only the integrality declarations of those columns are dropped).
   */
  toStringRelaxing(relaxed: ReadonlySet<string>): string {
    const binaryBounds = this.binaryNames.filter(name => relaxed.has(name)).map(name => `  0 <= ${name} <= 1`);
    return this.write(this.integerNames.filter(name => !relaxed.has(name)), this.binaryNames.filter(name => !relaxed.has(name)), binaryBounds);
  }

  private write(integers: readonly string[], binaries: readonly string[], extraBounds: readonly string[]): string {
    const lines: string[] = ['Maximize', `  obj: ${this.objective}`, 'Subject To', ...this.rowLines, 'Bounds', ...this.boundLines, ...extraBounds];
    if (integers.length > 0) {
      lines.push('General');
      chunk(integers, lines);
    }
    if (binaries.length > 0) {
      lines.push('Binary');
      chunk(binaries, lines);
    }
    lines.push('End');
    return lines.join('\n');
  }
}

function chunk(names: readonly string[], out: string[], perLine = 24): void {
  for (let i = 0; i < names.length; i += perLine) out.push(`  ${names.slice(i, i + perLine).join(' ')}`);
}
