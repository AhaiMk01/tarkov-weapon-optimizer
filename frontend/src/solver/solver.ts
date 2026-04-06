/**
 * HiGHS LP Solver Integration
 * Builds LP string via lpBuilder, solves with HiGHS WASM, decodes result.
 */

import type { OptimizeResponse, ItemDetail, PresetDetail, FinalStats } from '../api/client';
import type { SolveParams, GunLookupEntry } from './types';
export type { SolveParams } from './types';
import { buildLP } from './lpBuilder';
import { getAvailablePrice } from './dataService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let highs: any = null;
let highsCorrupted = false;

// Load HiGHS module.  In Node (tests), use the npm package directly.
// In browser workers, Vite's ES module bundling corrupts the Emscripten
// runtime, so we load highs.js from public/ at runtime instead.
async function loadHiGHS() {
  const base = import.meta.env?.BASE_URL || '/';

  // Node / test environment
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (globalThis as any).WorkerGlobalScope === 'undefined' && typeof (globalThis as any).window === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — dynamic require for Node
    const loader = (await import('highs')).default;
    return loader();
  }

  // Browser: fetch both WASM binary and highs.js source, then evaluate
  // highs.js with CJS shims.  Vite's ES module bundling corrupts the
  // Emscripten runtime, so we bypass the bundler entirely.
  const [wasmResp, jsResp] = await Promise.all([
    fetch(base + 'highs.wasm'),
    fetch(base + 'highs.js'),
  ]);
  const wasmBinary = new Uint8Array(await wasmResp.arrayBuffer());
  const jsSource = await jsResp.text();

  // Evaluate highs.js with CJS module/exports shims
  const exports = {} as Record<string, unknown>;
  const module = { exports };
  const fn = new Function('module', 'exports', jsSource);
  fn(module, exports);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loader = module.exports as any;

  return loader({ wasmBinary });
}

export async function solve(params: SolveParams): Promise<OptimizeResponse> {
  const startTime = performance.now();

  try {
    if (!highs || highsCorrupted) {
      highs = await loadHiGHS();
      highsCorrupted = false;
    }

    const lp = buildLP(params);
    const result = highs.solve(lp.lpString);

    if (result.Status !== 'Optimal') {
      return {
        status: 'infeasible',
        reason: result.Status === 'Infeasible' ? 'No valid configuration found' : result.Status,
        selected_items: [],
        selected_preset: undefined,
        objective_value: 0,
        solve_time_ms: performance.now() - startTime,
      };
    }

    // Decode solution: read x_i variables
    const columns = result.Columns || {};
    const selectedIds: string[] = [];
    for (let i = 1; i <= lp.nItems; i++) {
      const col = columns[`x_${i}`];
      if (col && col.Primal > 0.5) {
        selectedIds.push(lp.indexToItem[i]);
      }
    }

    // Find selected base
    let selectedBaseId: string | null = null;
    for (let b = 0; b < lp.nBases; b++) {
      const col = columns[`base_${b + 1}`];
      if (col && col.Primal > 0.5) {
        selectedBaseId = lp.baseIds[b];
        break;
      }
    }

    // Compute stats from raw item data (matching test_compare.py)
    const weapon = params.itemLookup[params.weaponId] as GunLookupEntry;
    const wStats = weapon.stats;

    let totalErgo = wStats.naked_ergonomics;
    let totalRecoilMod = 0;
    let totalWeight = wStats.weight || 0;

    const detailedItems: ItemDetail[] = [];

    for (const itemId of selectedIds) {
      const entry = params.itemLookup[itemId];
      if (!entry) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = entry.data as Record<string, any>;
      const icon = data.iconLink ?? data.iconLinkFallback ?? data.imageLink ?? data.image512pxLink;

      if (entry.type === 'mod') {
        const ms = entry.stats;
        totalErgo += ms.ergonomics || 0;
        totalRecoilMod += ms.recoil_modifier || 0;
        totalWeight += ms.weight || 0;

        detailedItems.push({
          id: itemId,
          name: data.name ?? 'Unknown',
          price: ms.purchasable ? (ms.price || 0) : 0,
          icon,
          source: ms.purchasable ? (ms.price_source ?? 'Unknown') : 'not_purchasable',
          purchasable: ms.purchasable,
          reference_price_rub: ms.reference_price_rub,
          ergonomics: ms.ergonomics || 0,
          recoil_modifier: ms.recoil_modifier || 0,
        });
      } else {
        detailedItems.push({
          id: itemId,
          name: data.name ?? 'Unknown',
          price: 0,
          icon,
          source: '',
          ergonomics: 0,
          recoil_modifier: 0,
        });
      }
    }

    // Compute price using buy variables with trader-filtered prices
    const traderLevels = params.traderLevels ?? undefined;
    const fleaAvailable = params.fleaAvailable ?? true;
    const playerLevel = params.playerLevel ?? null;

    let buyPrice = 0;
    for (let i = 1; i <= lp.nItems; i++) {
      const buyCol = columns[`buy_${i}`];
      if (buyCol && buyCol.Primal > 0.5) {
        const itemId = lp.indexToItem[i];
        const entry = params.itemLookup[itemId];
        if (entry?.type === 'mod') {
          const [price] = getAvailablePrice(entry.stats, traderLevels, fleaAvailable, playerLevel);
          buyPrice += price;
        }
      }
    }

    // Base price (use filtered preset price)
    let basePrice = 0;
    let presetDetail: PresetDetail | undefined;
    if (selectedBaseId === 'naked') {
      basePrice = wStats.price < 100_000_000 ? wStats.price : 0;
    } else if (selectedBaseId) {
      const preset = (weapon.presets || []).find(p => p.id === selectedBaseId)
        || (weapon.all_presets || []).find(p => p.id === selectedBaseId);
      if (preset) {
        const [filteredPrice, src, , purchaseLabel] = getAvailablePrice(preset, traderLevels, fleaAvailable, playerLevel);
        basePrice = filteredPrice;
        let source = src ?? undefined;
        let label = purchaseLabel ?? undefined;
        if (!source && preset.price_source && preset.price_source !== 'not_available') {
          source = preset.price_source;
        }
        if (!label && source === 'fleaMarket') {
          label = 'Flea Market';
        }
        presetDetail = {
          id: preset.id,
          name: preset.name,
          price: filteredPrice,
          items: preset.items || [],
          icon: preset.image ?? undefined,
          source,
          purchase_label: label,
        };
      }
    }

    const totalPrice = buyPrice + basePrice;

    const finalStats: FinalStats = {
      ergonomics: Math.max(0, Math.min(100, totalErgo)),
      recoil_vertical: wStats.naked_recoil_v * (1 + totalRecoilMod),
      recoil_horizontal: wStats.naked_recoil_h * (1 + totalRecoilMod),
      total_price: totalPrice,
      total_weight: totalWeight,
    };

    return {
      status: 'optimal',
      selected_items: detailedItems,
      selected_preset: presetDetail,
      objective_value: result.ObjectiveValue || 0,
      final_stats: finalStats,
      solve_time_ms: performance.now() - startTime,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message
      : typeof e === 'number' ? `HiGHS WASM exception (code ${e})`
      : `Unknown solver error: ${String(e)}`;
    console.error('HiGHS Solve Error:', e);
    // Mark as corrupted so next solve reinitializes WASM
    highsCorrupted = true;
    return {
      status: 'infeasible',
      reason: msg,
      selected_items: [],
      selected_preset: undefined,
      objective_value: 0,
      solve_time_ms: performance.now() - startTime,
    };
  }
}
