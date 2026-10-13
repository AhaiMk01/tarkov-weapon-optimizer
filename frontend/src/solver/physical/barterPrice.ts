/**
 * The price of one whole barter lot, exactly (ADR 0010 section 2, INTERPRETATIONS.md choice 3, Phase 2.5).
 *
 * Kept in its own DOM-free module: `dataService.ts` (IndexedDB, fetch) calls it for every barter, and the reference harness maps fixtures
 * through the very same function without importing a browser-only module.
 */

import { RAT_ZERO, ratAdd, ratFromDouble, ratMul, ratRoundHalfUp, ratToNumber } from './exact';

/**
 * The exact total of count x unit price over the ingredients of a barter, rounded half up, `floor(total + 1/2)`. Every count and unit price
 * is a binary64 leaf decoded to the exact rational it denotes (155.1 is just below the decimal 155.1), the sum and the products are exact,
 * and only the final integer is a double: a float sum rounds an exact .5 boundary the wrong way (155.1 x 5 is 775.5 in binary64 and
 * 775.5 - 2^-45 in truth, so the lot costs 775, not 776). Returns `null` when the exact total is not positive, which is no offer. A
 * non-finite unit price reads as 0, like a missing one (an ingredient is priced `avg24hPrice ?? basePrice ?? 0`).
 */
export function barterLotPrice(ingredients: ReadonlyArray<{ count: number; unitPrice: number }>): number | null {
  let total = RAT_ZERO;
  for (const { count, unitPrice } of ingredients) {
    total = ratAdd(total, ratMul(ratFromDouble(count), ratFromDouble(Number.isFinite(unitPrice) ? unitPrice : 0)));
  }
  if (total.n <= 0n) return null;
  return ratToNumber(ratRoundHalfUp(total));
}
