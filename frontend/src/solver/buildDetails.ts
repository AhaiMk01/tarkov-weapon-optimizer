/**
 * The published records of a validated build (ADR 0013 section 5): `ItemDetail` per installed occurrence and the `PresetDetail` of the chosen base.
 *
 * Shared by the Optimize response (`solver.ts`) and the MOA-floor witness (`moaFloor.ts`): both publish a build only after the independent
 * validator accepted it, and every figure here is read from the validator's exact statistics (`PhysicalBuildStats`), never from a solver column.
 *
 * NOTE (Phase 2.7b): these are the same functions as `itemDetails` / `presetDetail` in `solver.ts`, copied here because `solver.ts` is owned by
 * Phase 2.7a while this lands. Once both are merged, `solver.ts` should import them from this module instead of keeping a second copy.
 */

import type { ItemDetail, PresetDetail } from '../api/client';
import type { GunLookupEntry, ModLookupEntry, SolveParams } from './types';
import { tedContribution } from './trueErgo';
import { mergeComponents, presetSupply } from './presetSupply';
import { legalOffers, resolveMarket } from './physical/acquisition';
import type { PhysicalBuild, PhysicalBuildStats } from './physical/validate';

const imageOf = (data: Record<string, unknown>): { icon?: string; large?: string } => ({
  icon: (data.image512pxLink ?? data.imageLink ?? data.image8xLink ?? data.iconLink ?? data.iconLinkFallback) as string | undefined,
  large: (data.image512pxLink ?? data.imageLink ?? data.image8xLink) as string | undefined,
});

export function itemDetails(params: SolveParams, build: PhysicalBuild, stats: PhysicalBuildStats): ItemDetail[] {
  const equip = params.equipErgoModifier ?? 0;
  const provenance = new Map(stats.acquisition.occurrences.map(o => [o.instanceId, o]));
  const details: ItemDetail[] = [];
  for (const placement of build.placements) {
    const entry = params.itemLookup[placement.itemId] as ModLookupEntry;
    const data = entry.data as Record<string, unknown>;
    const ms = entry.stats;
    const { icon, large } = imageOf(data);
    const occurrence = provenance.get(placement.childInstanceId);
    const detail: ItemDetail = {
      id: placement.itemId,
      instanceId: placement.childInstanceId,
      name: (data.name as string | undefined) ?? 'Unknown',
      price: occurrence?.price ?? 0,
      icon,
      image_large: large || undefined,
      source: occurrence?.offerSource ?? undefined,
      purchasable: ms.purchasable,
      reference_price_rub: ms.reference_price_rub,
      ergonomics: ms.ergonomics || 0,
      recoil_modifier: ms.recoil_modifier || 0,
      accuracy_modifier: ms.accuracy_modifier || undefined,
      weight: ms.weight || undefined,
      category: ms.category || undefined,
      handbook_categories: ms.handbook_categories?.length ? ms.handbook_categories : undefined,
      capacity: ms.capacity || undefined,
      sighting_range: ms.sighting_range || undefined,
    };
    if (occurrence) {
      detail.acquisition = { source: occurrence.source === 'unavailable' ? 'offer' : occurrence.source, presetId: occurrence.presetId, offerSource: occurrence.offerSource, offerIndex: occurrence.offerIndex };
      if (occurrence.source === 'offer' && occurrence.offerIndex !== null) {
        const requirements = ms.offers[occurrence.offerIndex]?.barter_requirements;
        if (requirements) detail.barter_requirements = requirements;
      }
    }
    if (detail.weight != null || detail.ergonomics) {
      detail.ted_delta = tedContribution(stats.rawErgonomics, stats.weight, detail.ergonomics || 0, detail.weight || 0, equip);
    }
    details.push(detail);
  }
  return details;
}

/** The cheapest legal offer of a base and the seller it names; ties keep the earlier offer, as the exact cover does. */
function cheapestLegalOffer(
  offers: GunLookupEntry['stats']['offers'], gate: number, market: ReturnType<typeof resolveMarket>,
): { source: string; label: string; barterRequirements?: PresetDetail['barter_requirements'] } | undefined {
  let best: ReturnType<typeof legalOffers>[number] | undefined;
  for (const offer of legalOffers(offers, gate, market)) if (best === undefined || offer.price < best.price) best = offer;
  if (best === undefined) return undefined;
  const info = offers[best.index];
  return {
    source: best.source,
    label: best.source === 'fleaMarket' ? 'Flea Market' : (info.vendor_name || info.vendor_normalized || best.source),
    ...(best.source.startsWith('barter:') && info.barter_requirements ? { barterRequirements: info.barter_requirements } : {}),
  };
}

const fleaGateOf = (stats: object): number => {
  const gate = (stats as { min_level_flea?: unknown }).min_level_flea;
  return typeof gate === 'number' ? gate : 0;
};

export function presetDetail(params: SolveParams, build: PhysicalBuild, stats: PhysicalBuildStats): PresetDetail {
  const weapon = params.itemLookup[params.weaponId] as GunLookupEntry;
  const wStats = weapon.stats;
  const market = resolveMarket(params);
  const tooltip = {
    caliber: wStats.caliber || undefined,
    fire_rate: wStats.fire_rate || undefined,
    fire_modes: wStats.fire_modes?.length ? wStats.fire_modes : undefined,
    default_ergo: wStats.default_ergonomics || undefined,
    default_recoil_v: wStats.default_recoil_v || undefined,
    default_recoil_h: wStats.default_recoil_h || undefined,
    weight: wStats.weight || undefined,
  };
  const basePrice = stats.basePrice ?? 0;
  if (build.base.kind === 'naked') {
    const data = weapon.data as Record<string, unknown>;
    // The owned receiver (no base can be bought) has no seller: it is the player's own and costs 0.
    const owned = stats.baseSource === 'owned';
    const seller = owned ? undefined : cheapestLegalOffer(wStats.offers, fleaGateOf(wStats), market);
    return {
      id: params.weaponId,
      name: (data.name as string | undefined) ?? 'Naked Gun',
      price: basePrice,
      receiver_id: params.weaponId,
      items: [],
      icon: (data.iconLink ?? data.iconLinkFallback ?? wStats.default_preset_image) as string | undefined,
      image_large: (data.image512pxLink ?? data.imageLink ?? data.image8xLink) as string | undefined,
      source: seller?.source,
      purchase_label: seller?.label,
      barter_requirements: seller?.barterRequirements,
      acquisition: { source: owned ? 'owned' : 'offer' },
      ...tooltip,
    };
  }
  const presetId = build.base.presetId;
  const preset = weapon.all_presets.find(p => p.id === presetId);
  if (!preset) throw new Error(`Validated preset ${presetId} is not a preset of ${params.weaponId}`);
  const seller = cheapestLegalOffer(preset.offers, fleaGateOf(preset), market);
  return {
    id: preset.id,
    name: preset.name,
    price: basePrice,
    receiver_id: preset.receiver_id,
    items: mergeComponents(preset.items ?? []),
    icon: preset.image ?? undefined,
    image_large: preset.image ?? undefined,
    source: seller?.source ?? (preset.price_source && preset.price_source !== 'not_available' ? preset.price_source : undefined),
    purchase_label: seller?.label ?? (preset.price_source === 'fleaMarket' ? 'Flea Market' : undefined),
    barter_requirements: seller?.barterRequirements,
    parts_count: presetSupply(preset.items).size || undefined,
    acquisition: { source: 'offer' },
    ...tooltip,
  };
}
