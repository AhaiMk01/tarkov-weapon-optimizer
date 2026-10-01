import type { ExplorePoint, OptimizeRequest, OptimizeResponse } from '../src/api/client.ts';
import type { ItemLookup } from '../src/solver/types.ts';
import { validateBuild } from './validateBuild.ts';

/**
 * Display rounding applied by paretoExplorer.addPoint:
 * ergonomics and recoil are rounded to 0.1; price is rounded to an integer.
 * A value is faithful when it is within half of that step of the independent reconstruction.
 */
export const EXPLORE_DISPLAY_TENTH_TOLERANCE = 0.05 + 1e-9;
export const EXPLORE_DISPLAY_PRICE_TOLERANCE = 0.5 + 1e-9;

interface ReconstructedStats {
  ergo: number;
  weight: number;
  recoilV: number;
  recoilH: number;
  ted: number;
  moa: number;
  overswing: number;
}

function reconstruct(point: ExplorePoint, request: OptimizeRequest, lookup: ItemLookup): ReconstructedStats | string {
  const weaponEntry = lookup[request.weapon_id];
  if (weaponEntry?.type !== 'gun') return `Unknown weapon ${request.weapon_id}`;
  const sum = (fn: (stats: { ergonomics: number; weight: number; recoil_modifier: number; accuracy_modifier: number }) => number) =>
    (point.selected_items || []).reduce((acc, item) => {
      const entry = lookup[item.id];
      return acc + (entry?.type === 'mod' ? fn(entry.stats) : 0);
    }, 0);
  const rawErgo = weaponEntry.stats.naked_ergonomics + sum(s => s.ergonomics);
  const ergo = Math.max(0, Math.min(100, rawErgo));
  const weight = weaponEntry.stats.weight + sum(s => s.weight);
  const recoilFactor = 1 + sum(s => s.recoil_modifier);
  const recoilV = weaponEntry.stats.naked_recoil_v * recoilFactor;
  const recoilH = weaponEntry.stats.naked_recoil_h * recoilFactor;
  const effective = Math.max(0, Math.min(100, ergo * (1 + (request.equip_ergo_modifier ?? 0))));
  const ted = effective - (weight <= 3 ? 0 : 100 - 300 / weight);
  const barrels = (point.selected_items || []).filter(item => {
    const entry = lookup[item.id];
    return entry?.type === 'mod' && entry.stats.center_of_impact > 0;
  });
  const coi = barrels[0]
    ? (lookup[barrels[0].id] as { type: 'mod'; stats: { center_of_impact: number } }).stats.center_of_impact
    : weaponEntry.stats.center_of_impact;
  const moa = coi * (1 - sum(s => s.accuracy_modifier) / 100) * 34.3;
  const overswing = Math.max(0, Math.min(1, (weight * (1 - effective / 100) - 3) / 4)) * 100;
  return { ergo, weight, recoilV, recoilH, ted, moa, overswing };
}

function asBuild(point: ExplorePoint, exact: ReconstructedStats, totalPrice: number): OptimizeResponse {
  return {
    // Do not invent optimality. Physical checks require the emitted status.
    status: point.status,
    selected_items: point.selected_items || [],
    selected_preset: point.selected_preset,
    slot_pairs: point.slot_pairs,
    objective_value: point.recoil_v,
    final_stats: {
      ergonomics: exact.ergo,
      recoil_vertical: exact.recoilV,
      recoil_horizontal: exact.recoilH,
      total_price: totalPrice,
      total_weight: exact.weight,
      true_ergo_delta: exact.ted,
      moa: exact.moa,
      overswing_pct: exact.overswing,
    },
  };
}

function displayMismatch(name: string, emitted: number | undefined, reconstructed: number, tolerance: number): string | undefined {
  if (emitted == null || !Number.isFinite(emitted) || Math.abs(emitted - reconstructed) > tolerance) {
    return `${name}: emitted ${emitted} differs from reconstructed ${reconstructed} by more than display tolerance ${tolerance}`;
  }
  return undefined;
}

/**
 * Physical feasibility uses the original request, including hard limits.
 * Display agreement is a separate check against the rounded fields the curve actually emitted.
 * Neither check is an optimality certificate.
 */
export function validateExplorePoint(request: OptimizeRequest, point: ExplorePoint, lookup: ItemLookup): string[] {
  const exact = reconstruct(point, request, lookup);
  if (typeof exact === 'string') return [exact];

  let physical = validateBuild(request, asBuild(point, exact, point.price), lookup);
  const priceError = physical.find(error => error.startsWith('Total price:'));
  const expectedPrice = priceError ? Number(/expected ([^\s,]+)/.exec(priceError)?.[1]) : point.price;
  if (priceError && Number.isFinite(expectedPrice) && Math.abs(expectedPrice - point.price) <= EXPLORE_DISPLAY_PRICE_TOLERANCE) {
    physical = validateBuild(request, asBuild(point, exact, expectedPrice), lookup);
  }

  const display = [
    displayMismatch('Ergonomics', point.ergo, exact.ergo, EXPLORE_DISPLAY_TENTH_TOLERANCE),
    displayMismatch('Vertical recoil', point.recoil_v, exact.recoilV, EXPLORE_DISPLAY_TENTH_TOLERANCE),
    displayMismatch('Horizontal recoil', point.recoil_h, exact.recoilH, EXPLORE_DISPLAY_TENTH_TOLERANCE),
    displayMismatch('Price', point.price, expectedPrice, EXPLORE_DISPLAY_PRICE_TOLERANCE),
  ].filter((error): error is string => !!error);

  return [...physical, ...display];
}

export function validateExploreCurve(request: OptimizeRequest, points: ExplorePoint[], lookup: ItemLookup): string[] {
  const errors: string[] = [];
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    for (const error of validateExplorePoint(request, point, lookup)) {
      errors.push(`Point ${index} (E=${point.ergo}, R=${point.recoil_v}): ${error}`);
    }
  }
  return errors;
}
