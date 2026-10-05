import { buildCompatibilityMap } from './src/solver/compatibilityMap.ts';
import type { GunLookupEntry, ItemLookup, ModLookupEntry, OfferInfo, SolveParams } from './src/solver/types.ts';
import { validatePhysicalBuild } from './src/solver/physical/validate.ts';
import type { PhysicalBuild } from './src/solver/physical/validate.ts';
import type { OptimizeResponse } from './src/api/client.ts';

export interface Choice { id: string; weight: number; ergo: number; recoil?: number; price?: number }

/** A required one-choice slot: every feasible build is explicitly enumerable. */
export function choiceFixture(choices: Choice[], receiverWeight = 1, receiverErgo = 0): SolveParams {
  const offer = (price: number): OfferInfo[] => [{ price, source: 'mechanic', vendor_name: 'Mechanic', vendor_normalized: 'mechanic', trader_level: 1 }];
  const gun: GunLookupEntry = {
    type: 'gun', data: { name: 'Fixture receiver' }, presets: [], all_presets: [],
    slots: [{ id: 'choice', name: 'Choice', nameId: 'choice', required: true, allowedItems: choices.map(c => c.id) }],
    stats: {
      naked_ergonomics: receiverErgo, naked_recoil_v: 100, naked_recoil_h: 100,
      default_ergonomics: 0, default_recoil_v: 100, default_recoil_h: 100, default_preset_image: null,
      accuracy_modifier: 0, fire_rate: 600, fire_modes: [], caliber: '', weight: receiverWeight,
      width: 1, height: 1, sighting_range: 0, category: 'gun', category_id: 'gun',
      camera_snap: 0, center_of_impact: 0, deviation_max: 0, deviation_curve: 0,
      recoil_angle: 0, recoil_dispersion: 0, offers: offer(1000), price: 1000, price_source: 'mechanic',
    },
  };
  const itemLookup: ItemLookup = { gun };
  for (const c of choices) {
    const mod: ModLookupEntry = {
      type: 'mod', data: { name: c.id }, slots: [], conflicting_items: [], conflicting_slot_ids: [],
      stats: {
        ergonomics: c.ergo - receiverErgo, recoil_modifier: (c.recoil ?? 100) / 100 - 1,
        accuracy_modifier: 0, center_of_impact: 0, offers: offer(c.price ?? 100), purchasable: true,
        price: c.price ?? 100, price_source: 'mechanic', weight: c.weight - receiverWeight,
        width: 1, height: 1, min_level_flea: 1, capacity: 0, sighting_range: 0,
        category: 'fixture', category_id: 'fixture',
      },
    };
    itemLookup[c.id] = mod;
  }
  return {
    weaponId: 'gun', itemLookup, compatibilityMap: buildCompatibilityMap('gun', itemLookup),
    ergoWeight: 100, recoilWeight: 0, priceWeight: 0, fleaAvailable: true, preciseMode: true,
  };
}

/**
 * Independent occurrence-level check of a published build: the response's placements and base go through the physical validator against the
 * request the solve ran (so every cap, filter and the supply rules apply), and the published statistics must be the validator's own. Returns
 * the violations, `[]` for a valid build. Unlike the legacy template-level `validateBuild`, it knows copies, instances and the self-conflict
 * copy cap.
 */
export function physicalViolations(params: SolveParams, response: OptimizeResponse): string[] {
  if (!response.selected_preset || !response.slot_pairs || !response.final_stats) return ['the response carries no build'];
  const build: PhysicalBuild = {
    base: response.selected_preset.id === params.weaponId ? { kind: 'naked' } : { kind: 'preset', presetId: response.selected_preset.id },
    placements: response.slot_pairs,
  };
  const { ok, violations, stats } = validatePhysicalBuild(params.itemLookup, params, build, { requirePathInstanceIds: true });
  const found = violations.map(v => `${v.code}: ${v.detail}`);
  if (ok && stats) {
    const published = response.final_stats;
    const same = (name: string, got: number, want: number): void => {
      if (!(Math.abs(got - want) <= 1e-9)) found.push(`published ${name} ${got} is not the exact ${want}`);
    };
    same('ergonomics', published.ergonomics, stats.ergonomics);
    same('total price', published.total_price, stats.spend);
    same('total weight', published.total_weight, stats.weight);
    same('vertical recoil', published.recoil_vertical, stats.recoilVertical);
    same('TED', published.true_ergo_delta ?? Number.NaN, stats.ted);
  }
  return found;
}
