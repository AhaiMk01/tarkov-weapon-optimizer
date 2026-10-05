/**
 * Decoding a solution vector of the physical LP into a physical build (ADR 0003 principle 5, ADR 0008 principle 5, ADR 0009
 * principle 2, ADR 0013 section 4A).
 *
 * `decodeSolution(model, columnValues)` reads ONLY the decision columns (one base, the occurrence binaries). Everything else, the
 * installed multiset, the per-occurrence acquisition and the exact spend, is reconstructed from them with exact integer logic:
 *
 *  - The paid deficit is d_i = max(0, installed_i - selected preset supply - owned_i), never the surrogate u_i (which may carry
 *    slack) and never an LP lot count (which may overbuy when the price weight is zero).
 *  - Allocation per template runs in code-unit `instanceId` order: preset supply first, owned stock second, the paid remainder last.
 *  - The paid remainder is covered with whole lots at the exact minimum cost (a DP over units, ties toward the earlier offer, as in
 *    the reference); the paid occurrences take the units of the chosen lots in offer-index order and the full lot price is charged to
 *    the first unit taken from a lot (INTERPRETATIONS.md choice 1), so the charges add up to the spend exactly.
 *
 * Binary columns come from the solver as doubles within its integrality tolerance of 0 or 1 (the structured native result is full
 * precision; the 1e-5 reading tolerance also covers the six-digit pretty-printed text of the retired wrapper): a binary is read as 0 or 1
 * only when it is within 1e-5 of it, and anything else is a typed decode error, never a guess.
 */

import { PhysicalModelError } from './errors';
import type { AcquisitionOffer } from './acquisition';
import type { SpecializedModel } from './specialize';

/** Column values by LP column name. */
export type ColumnValues = Readonly<Record<string, number>>;

/**
 * Column values from the structured native result (`NativeResult.colNames` and the full-precision `colValues`). Both are null without a
 * primal solution, which gives no values (and `decodeSolution` then reports every decision column missing).
 */
export function columnValuesFromStructured(colNames: readonly string[] | null, colValues: ArrayLike<number> | null): Record<string, number> {
  const values: Record<string, number> = {};
  if (colNames === null || colValues === null) return values;
  if (colNames.length !== colValues.length) throw new PhysicalModelError('DECODE_FAILED', `${colNames.length} column names for ${colValues.length} column values`);
  colNames.forEach((name, k) => { values[name] = colValues[k]; });
  return values;
}

export interface DecodedPlacement {
  parentInstanceId: string;
  /** Template slot id on the parent; the physical slot is the pair (parentInstanceId, slotId). */
  slotId: string;
  childInstanceId: string;
  /** Template id of the installed item. */
  itemId: string;
}

export type DecodedBase = { kind: 'naked' } | { kind: 'preset'; presetId: string; lookupIndex: number };

export interface OccurrenceProvenance {
  instanceId: string;
  itemId: string;
  source: 'preset' | 'owned' | 'offer';
  /** The preset the unit comes from (`preset` only). */
  presetId: string | null;
  /** The offer's source key: `fleaMarket`, a trader key or `barter:<trader>` (`offer` only). */
  offerSource: string | null;
  /** Index into the item's `ModStats.offers` (`offer` only). */
  offerIndex: number | null;
  /** RUB charged to this occurrence: the whole lot price on the first unit taken from a lot, 0 elsewhere. */
  price: number;
}

/** One lot of a purchase and how many of its units installed occurrences take (the rest is surplus). */
export interface PurchasedLot {
  offerIndex: number;
  source: string;
  lotSize: number;
  price: number;
  used: number;
}

export interface ItemPurchase {
  itemId: string;
  /** Paid units d_i (> 0). */
  deficit: number;
  lots: PurchasedLot[];
  /** The cheapest whole-lot cover cost. */
  cost: number;
}

export interface DecodedBuild {
  /** Index among the domain's accessible bases. */
  baseIndex: number;
  base: DecodedBase;
  /** The cheapest legal lot price of the base (a base is one unit). */
  basePrice: number;
  /** Installed occurrences, owner before child (ascending occurrence index). */
  placements: DecodedPlacement[];
  /** Installed copies per template id, keys in code-unit order. */
  installed: ReadonlyMap<string, number>;
  /** One record per installed occurrence, in code-unit order of `instanceId`. */
  acquisition: OccurrenceProvenance[];
  /** d_i for every template with a positive paid deficit. */
  deficits: ReadonlyMap<string, number>;
  /** The whole-lot purchases, in template-id code-unit order. */
  purchases: ItemPurchase[];
  /** Sum of the purchase costs. */
  modSpend: number;
  /** Base price plus `modSpend`: the exact out-of-pocket spend. */
  spend: number;
}

/** A binary column is within this of 0 or 1. HiGHS prints six significant digits, so 1e-5 is the honest reading. */
export const BINARY_READ_TOLERANCE = 1e-5;

const codeUnitCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function readBinary(values: ColumnValues, name: string): 0 | 1 {
  const value = values[name];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PhysicalModelError('DECODE_FAILED', `Decision column ${name} is missing from the solution`, { column: name });
  }
  const rounded = Math.round(value);
  if ((rounded !== 0 && rounded !== 1) || Math.abs(value - rounded) > BINARY_READ_TOLERANCE) {
    throw new PhysicalModelError('DECODE_FAILED', `Decision column ${name} is not integral: ${String(value)}`, { column: name, value });
  }
  return rounded;
}

interface Cover {
  cost: number;
  /** Indexes into the offer list, ascending, repeated per lot. */
  picks: number[];
}

/**
 * Minimum cost of covering at least `deficit` units with whole lots: min sum(lots x price) s.t. sum(lots x size) >= deficit, by a DP
 * over units. At every state the earliest offer that attains the minimum is kept (a strict comparison), as the reference does.
 */
export function cheapestLotCover(offers: readonly AcquisitionOffer[], deficit: number): Cover | null {
  if (deficit === 0) return { cost: 0, picks: [] };
  if (offers.length === 0) return null;
  const cost: number[] = [0];
  const pick: number[] = [-1];
  for (let j = 1; j <= deficit; j++) {
    let best = Infinity;
    let bestOffer = -1;
    for (let k = 0; k < offers.length; k++) {
      const candidate = offers[k].price + cost[Math.max(0, j - offers[k].lotSize)];
      if (candidate < best) {
        best = candidate;
        bestOffer = k;
      }
    }
    cost.push(best);
    pick.push(bestOffer);
  }
  const picks: number[] = [];
  for (let j = deficit; j > 0; ) {
    picks.push(pick[j]);
    j = Math.max(0, j - offers[pick[j]].lotSize);
  }
  picks.sort((a, b) => a - b);
  return { cost: cost[deficit], picks };
}

export function decodeSolution(model: SpecializedModel, values: ColumnValues): DecodedBuild {
  const { blueprint: bp, domain } = model;
  if (model.provedEmpty?.source === 'domain') {
    throw new PhysicalModelError('DECODE_FAILED', 'The domain is empty: there is no build to decode', { reasons: model.provedEmpty.reasons });
  }

  // --- base ---
  let baseIndex = -1;
  for (let b = 0; b < domain.bases.length; b++) {
    if (readBinary(values, model.columns.base(b)) === 1) {
      if (baseIndex >= 0) throw new PhysicalModelError('DECODE_FAILED', 'More than one base is selected', { bases: [baseIndex, b] });
      baseIndex = b;
    }
  }
  if (baseIndex < 0) throw new PhysicalModelError('DECODE_FAILED', 'No base is selected');
  const chosen = domain.bases[baseIndex];
  const base: DecodedBase = chosen.kind === 'naked' ? { kind: 'naked' } : { kind: 'preset', presetId: chosen.presetId, lookupIndex: chosen.lookupIndex };

  // --- installed occurrences, rootedness and slot capacity ---
  const installed = new Uint8Array(bp.occurrenceCount);
  installed[0] = 1;
  for (const v of model.columns.activeOccurrences) {
    const column = model.columns.occurrence(v) as string;
    installed[v] = readBinary(values, column);
  }
  const placements: DecodedPlacement[] = [];
  const occupied = new Set<number>();
  for (const v of model.columns.activeOccurrences) {
    if (!installed[v]) continue;
    const slot = bp.parentSlot(v);
    const owner = bp.slotOwner(slot);
    if (!installed[owner]) {
      throw new PhysicalModelError('DECODE_FAILED', `Occurrence ${bp.instanceId(v)} is installed but its parent is not`, { occurrence: v });
    }
    if (occupied.has(slot)) {
      throw new PhysicalModelError('DECODE_FAILED', `Physical slot ${bp.instanceId(owner)}/${bp.rawSlotId(slot)} holds two children`, { slot });
    }
    occupied.add(slot);
    placements.push({ parentInstanceId: bp.instanceId(owner), slotId: bp.rawSlotId(slot), childInstanceId: bp.instanceId(v), itemId: bp.templateId(v) });
  }

  // --- multiset and allocation, per template ---
  const byTemplate = new Map<number, string[]>();
  for (const v of model.columns.activeOccurrences) {
    if (!installed[v]) continue;
    const t = bp.occTemplate[v];
    const ids = byTemplate.get(t);
    if (ids) ids.push(bp.instanceId(v));
    else byTemplate.set(t, [bp.instanceId(v)]);
  }
  const templates = [...byTemplate.keys()].sort((a, b) => codeUnitCompare(bp.templateIds[a], bp.templateIds[b]));
  const installedCounts = new Map<string, number>();
  const acquisition: OccurrenceProvenance[] = [];
  const deficits = new Map<string, number>();
  const purchases: ItemPurchase[] = [];
  let modSpend = 0;
  for (const t of templates) {
    const itemId = bp.templateIds[t];
    const ids = (byTemplate.get(t) as string[]).sort(codeUnitCompare);
    installedCounts.set(itemId, ids.length);
    const acquirable = domain.templates[t];
    let presetLeft = chosen.kind === 'preset' ? (chosen.supply.get(itemId) ?? 0) : 0;
    let ownedLeft = acquirable.owned;
    const paid: OccurrenceProvenance[] = [];
    for (const instanceId of ids) {
      const record: OccurrenceProvenance = { instanceId, itemId, source: 'offer', presetId: null, offerSource: null, offerIndex: null, price: 0 };
      if (presetLeft > 0) {
        presetLeft--;
        record.source = 'preset';
        record.presetId = chosen.kind === 'preset' ? chosen.presetId : null;
      } else if (ownedLeft > 0) {
        ownedLeft--;
        record.source = 'owned';
      } else {
        paid.push(record);
      }
      acquisition.push(record);
    }
    if (paid.length === 0) continue;
    const cover = cheapestLotCover(acquirable.standaloneLots, paid.length);
    if (cover === null) {
      throw new PhysicalModelError('DECODE_FAILED', `${itemId} is installed ${paid.length} time(s) past its supply and has no legal offer`, { itemId, deficit: paid.length });
    }
    deficits.set(itemId, paid.length);
    const lots: PurchasedLot[] = [];
    let next = 0;
    for (const k of cover.picks) {
      const lot = acquirable.standaloneLots[k];
      const takers = paid.slice(next, next + lot.lotSize);
      next += takers.length;
      takers.forEach((record, position) => {
        record.offerSource = lot.source;
        record.offerIndex = lot.index;
        record.price = position === 0 ? lot.price : 0;
      });
      lots.push({ offerIndex: lot.index, source: lot.source, lotSize: lot.lotSize, price: lot.price, used: takers.length });
    }
    purchases.push({ itemId, deficit: paid.length, lots, cost: cover.cost });
    modSpend += cover.cost;
  }
  acquisition.sort((a, b) => codeUnitCompare(a.instanceId, b.instanceId));

  return {
    baseIndex,
    base,
    basePrice: chosen.cheapestPrice,
    placements,
    installed: installedCounts,
    acquisition,
    deficits,
    purchases,
    modSpend,
    spend: chosen.cheapestPrice + modSpend,
  };
}
