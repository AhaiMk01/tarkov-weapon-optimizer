import type { ItemDetail, OptimizeResponse } from '../../api/client';
import { supplyOf } from './manifest';

/** The words of the copied list, supplied by the caller (this module has no i18n instance). */
export interface ShoppingLabels {
  /** Marks the base line ("base"). */
  base: string;
  /** Occurrences supplied by the base preset ("from preset"). */
  preset: string;
  /** Occurrences taken from the stash ("owned"). */
  owned: string;
  /** Marks a barter purchase ("barter"). */
  barter: string;
  /** Used when a purchase's source is unknown. */
  unknownSource: string;
}

const SELLER_NAMES: Record<string, string> = { fleamarket: 'Flea Market' };

/** The seller named by an offer's source key: `fleaMarket`, a trader key, or `barter:<trader>`. */
export function sellerLabelOf(offerSource: string | null | undefined, labels: Pick<ShoppingLabels, 'barter' | 'unknownSource'>): string {
  if (offerSource === null || offerSource === undefined || offerSource === '') return labels.unknownSource;
  const isBarter = offerSource.startsWith('barter:');
  const key = isBarter ? offerSource.slice('barter:'.length) : offerSource;
  const name = SELLER_NAMES[key.toLowerCase()] ?? (key.charAt(0).toUpperCase() + key.slice(1));
  return isBarter ? `${name} (${labels.barter})` : name;
}

/** The charge of one occurrence: a paid lot is charged on its first unit, the other units of the lot ride on it at 0. */
const chargeOf = (item: Pick<ItemDetail, 'price'>): number => (Number.isFinite(item.price) ? item.price : 0);

/**
 * The true spend of a build as the manifest reflects it: the base plus the charge of every occurrence. It equals `final_stats.total_price`
 * (the validator's exact spend) for every published build.
 */
export function manifestSpend(result: Pick<OptimizeResponse, 'selected_items' | 'selected_preset'>): number {
  return (result.selected_preset?.price ?? 0) + result.selected_items.reduce((sum, item) => sum + chargeOf(item), 0);
}

/**
 * One line per group of occurrences that share a template and a provenance, in order of first appearance. Copies are counted ("x2"), never
 * merged across provenance: an occurrence the preset supplies, one taken from the stash and one bought are different lines even for one template.
 * The first line is the base. A paid line carries the summed charge of its occurrences, so the lines add up to the true spend.
 */
export function shoppingListLines(result: Pick<OptimizeResponse, 'selected_items' | 'selected_preset'>, labels: ShoppingLabels): string[] {
  const lines: string[] = [];
  const base = result.selected_preset;
  if (base !== undefined) lines.push(`${base.name} — ${labels.base} — ₽${base.price.toLocaleString()}`);

  interface Group { name: string; count: number; spend: number; label: string }
  const groups = new Map<string, Group>();
  for (const item of result.selected_items) {
    const supply = supplyOf(item);
    const offerSource = item.acquisition?.offerSource ?? item.source ?? null;
    const label = supply === 'preset' ? labels.preset : supply === 'owned' ? labels.owned : sellerLabelOf(offerSource, labels);
    const key = `${item.id}\u0000${supply ?? ''}\u0000${supply === 'offer' || supply === null ? offerSource ?? '' : ''}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { name: item.name, count: 1, spend: chargeOf(item), label });
    else { group.count += 1; group.spend += chargeOf(item); }
  }
  for (const g of groups.values()) {
    const count = g.count > 1 ? ` ×${g.count}` : '';
    const spend = g.spend > 0 ? ` — ₽${g.spend.toLocaleString()}` : '';
    lines.push(`${g.name}${count} — ${g.label}${spend}`);
  }
  return lines;
}
