/**
 * Reading a native solution (ADR 0013 section 4B): the column values of the structured result by name, and the tolerance within which a
 * decision column is read as an integer. The decoder of the count model is `decodeFast.ts`; the occurrence-model decoder left production with
 * owner decision 2d as amended (2026-10-12) and lives in the tests (`tests/physical/occurrence/decodeOccurrence.ts`).
 *
 * Integer columns come from the solver as doubles within its integrality tolerance of an integer (1e-7, `nativeSolve.ts`; the structured native
 * result is full precision): a decision column is read as an integer only when it is within `BINARY_READ_TOLERANCE` of one, and anything else
 * is a typed decode error, never a guess.
 */

import { PhysicalModelError } from './errors';

/** Column values by LP column name. */
export type ColumnValues = Readonly<Record<string, number>>;

/**
 * Column values from the structured native result (`NativeResult.colNames` and the full-precision `colValues`). Both are null without a
 * primal solution, which gives no values (and a decoder then reports every decision column missing).
 */
export function columnValuesFromStructured(colNames: readonly string[] | null, colValues: ArrayLike<number> | null): Record<string, number> {
  const values: Record<string, number> = {};
  if (colNames === null || colValues === null) return values;
  if (colNames.length !== colValues.length) throw new PhysicalModelError('DECODE_FAILED', `${colNames.length} column names for ${colValues.length} column values`);
  colNames.forEach((name, k) => { values[name] = colValues[k]; });
  return values;
}

/** A decision column is within this of an integer. HiGHS prints six significant digits, so 1e-5 is the honest reading of its text, and well above the native integrality tolerance. */
export const BINARY_READ_TOLERANCE = 1e-5;
