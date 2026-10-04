// The one string order every reference module uses: UTF-16 code units, never locale collation.
// ADR 0008 allocates supply per occurrence in this order of instanceId, so every sort that can
// influence a result (instance ids, projection keys, item ids) goes through this comparator.

/** UTF-16 code-unit order, the order ADR 0008 uses for instanceId allocation. */
export function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
