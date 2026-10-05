/**
 * @deprecated TEMPORARY legacy shim, scheduled for deletion in Phase 2.4b-3 / 2.6 when `solver.ts` consumes
 * `solveStructured` directly. Do not use it from new code.
 *
 * `legacySolve` returns the shape the highs-js wrapper used to return (`{ Status, Columns, Rows, ObjectiveValue }`) so the
 * current solver keeps working, but every number in it is built from the structured full-precision result (the old wrapper
 * parsed rounded pretty text: 3.123456789012 came back as 3.12346). Fields the old wrapper filled from the basis (`Status`
 * of a column or row, `Dual`) are not provided. Infinite bounds are `Infinity`, as the old wrapper returned them.
 */

import { getNativeHighs } from './instance';
import { MODEL_STATUS_TEXT } from './native';
import type { HighsOptions } from './options';

/** The options the current solver passes. Any option of the typed table is accepted; unknown names throw. */
export type LegacyHighsOptions = HighsOptions;

export interface LegacyColumn {
  Index: number;
  Name: string;
  Lower: number;
  Upper: number;
  Type: 'Continuous' | 'Integer';
  Primal: number;
}

export interface LegacyRow {
  Index: number;
  Name: string;
  Lower: number;
  Upper: number;
  Primal: number;
}

export interface LegacySolveResult {
  /** HiGHS's model status text: `Optimal`, `Infeasible`, `Time limit reached`, `Solution limit reached`, ... */
  Status: string;
  ObjectiveValue: number;
  /** Empty unless HiGHS holds a primal solution (an optimal one, or the incumbent of a limit stop). */
  Columns: Record<string, LegacyColumn>;
  Rows: LegacyRow[];
}

/** @deprecated See the file comment. */
export async function legacySolve(lpText: string, options?: LegacyHighsOptions): Promise<LegacySolveResult> {
  const result = await getNativeHighs().solveStructured(lpText, options, { includeRows: true, includeReadback: true });
  const status = result.modelStatus.name === 'Unrecognized' ? `Unrecognized status ${result.modelStatus.code}` : MODEL_STATUS_TEXT[result.modelStatus.name];
  const columns: Record<string, LegacyColumn> = {};
  const rows: LegacyRow[] = [];
  const { colValues, rowValues, readback, colNames, rowNames } = result;
  if (colValues && readback && colNames) {
    colNames.forEach((name, j) => {
      columns[name] = {
        Index: j,
        Name: name,
        Lower: readback.colLower[j],
        Upper: readback.colUpper[j],
        Type: readback.integrality[j] === 0 ? 'Continuous' : 'Integer',
        Primal: colValues[j],
      };
    });
    if (rowValues && rowNames) {
      rowNames.forEach((name, i) => {
        rows.push({
          Index: i,
          Name: name,
          Lower: readback.rowLower[i],
          Upper: readback.rowUpper[i],
          Primal: rowValues[i],
        });
      });
    }
  }
  return { Status: status, ObjectiveValue: result.objectiveValue ?? 0, Columns: columns, Rows: rows };
}
