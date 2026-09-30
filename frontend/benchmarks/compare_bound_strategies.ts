import { fetchAllData, buildItemLookup } from '../src/solver/dataService.ts';
import { buildCompatibilityMap } from '../src/solver/compatibilityMap.ts';
import { buildLP } from '../src/solver/lpBuilder.ts';
import { computeStructuralBounds } from '../src/solver/structuralBounds.ts';
import type { CompatibilityMap, ItemLookup } from '../src/solver/types.ts';
import highsLoader from 'highs';

interface HighsLoader {
  (): Promise<{ solve(lp: string, options?: Record<string, unknown>): { Status: string; ObjectiveValue?: number } }>;
}

const highs = await (highsLoader as unknown as HighsLoader)();
const data = await fetchAllData('en', 'regular');
const lookup = buildItemLookup(data.guns, data.mods);

/**
 * Solves the true continuous LP relaxation of the EXACT placement model (preciseMode: true).
 * Strips binary constraints so variables are continuous in [0, 1].
 * Validates solver status and falls back to structural bounds if LP fails.
 */
export function computeExactContinuousLPBounds(
  weaponId: string,
  itemLookup: ItemLookup,
  cmap: CompatibilityMap,
): { bounds: [number, number]; timeMs: number; status: string } {
  const t0 = performance.now();
  // MUST use preciseMode: true so placement linking is preserved
  const lp = buildLP({ weaponId, itemLookup, compatibilityMap: cmap, preciseMode: true });

  const binIdx = lp.lpString.indexOf('\nBinary');
  if (binIdx <= 0) {
    throw new Error('Malformed LP: Binary section missing');
  }

  // Maximize total_weight
  let maxLpStr = lp.lpString.replace('  obj: total_obj', '  obj: total_weight');
  maxLpStr = maxLpStr.slice(0, maxLpStr.indexOf('\nBinary')) + '\nEnd\n';
  const resMax = highs.solve(maxLpStr);

  // Minimize total_weight
  let minLpStr = lp.lpString.replace('Maximize\n  obj: total_obj', 'Minimize\n  obj: total_weight');
  minLpStr = minLpStr.slice(0, minLpStr.indexOf('\nBinary')) + '\nEnd\n';
  const resMin = highs.solve(minLpStr);

  const timeMs = performance.now() - t0;

  if (resMax.Status !== 'Optimal' || resMax.ObjectiveValue == null ||
      resMin.Status !== 'Optimal' || resMin.ObjectiveValue == null) {
    console.warn(`Continuous LP solve non-optimal (max: ${resMax.Status}, min: ${resMin.Status}), falling back to structural bounds`);
    const fallback = computeStructuralBounds(weaponId, itemLookup, cmap);
    return { bounds: fallback.weightBounds, timeMs, status: `Fallback (${resMax.Status}/${resMin.Status})` };
  }

  const minW = Math.max(0, resMin.ObjectiveValue);
  const maxW = Math.max(minW, resMax.ObjectiveValue);

  return { bounds: [minW, maxW], timeMs, status: 'Optimal' };
}

/**
 * Computes the root continuous relaxation bound on the TrueErgo objective
 * for a given weight interval [lo, hi].
 * This represents the mathematical upper bound at the root node of spatial B&B.
 */
function computeRootRelaxationBound(params: Record<string, unknown>, interval: [number, number]): number {
  const lp = buildLP(params, interval);
  const binIdx = lp.lpString.indexOf('\nBinary');
  const continuousLp = lp.lpString.slice(0, binIdx) + '\nEnd\n';
  const res = highs.solve(continuousLp);
  if (res.Status !== 'Optimal' || res.ObjectiveValue == null) {
    throw new Error(`Root relaxation solve failed with status ${res.Status}`);
  }
  return res.ObjectiveValue;
}

const testWeapons = ['M4A1', 'SVDS', 'AK-74N'];

console.log('=== Comparing Bound Strategies on Exact Placement Model ===\n');

for (const name of testWeapons) {
  const gun = data.guns.find((g: Record<string, unknown>) => typeof g.name === 'string' && g.name.includes(name));
  if (!gun) continue;
  const cmap = buildCompatibilityMap(gun.id, lookup);
  const baseParams = {
    weaponId: gun.id, itemLookup: lookup, compatibilityMap: cmap,
    ergoWeight: 50, recoilWeight: 50, priceWeight: 20, fleaAvailable: true,
    useTrueErgo: true, preciseMode: true,
  };

  console.log(`--- Weapon: ${name} (${gun.id}) ---`);

  // 1. Naive Sum (Baseline)
  const t0 = performance.now();
  const baseWeight = (gun.properties as Record<string, unknown>)?.weight as number ?? 0;
  const naiveMaxW = baseWeight + Object.keys(cmap.reachable_items).reduce((sum, id) => {
    const item = lookup[id];
    return sum + (item && 'weight' in item.stats ? Math.max(0, item.stats.weight || 0) : 0);
  }, 0);
  const naiveTime = performance.now() - t0;
  const naiveInterval: [number, number] = [3, naiveMaxW];
  const naiveRootBound = computeRootRelaxationBound(baseParams, naiveInterval);

  console.log(`  1. Naive Sum:           prep=${naiveTime.toFixed(2)}ms, bounds=[3.00, ${naiveMaxW.toFixed(2)}], rootContinuousBound=${naiveRootBound.toFixed(2)}`);

  // 2. Exact Continuous LP Bounds
  const cont = computeExactContinuousLPBounds(gun.id, lookup, cmap);
  const contInterval: [number, number] = [Math.max(3, cont.bounds[0]), Math.max(3, cont.bounds[1])];
  const contRootBound = computeRootRelaxationBound(baseParams, contInterval);

  console.log(`  2. Exact Continuous LP: prep=${cont.timeMs.toFixed(2)}ms, bounds=[${cont.bounds[0].toFixed(2)}, ${cont.bounds[1].toFixed(2)}], rootContinuousBound=${contRootBound.toFixed(2)} (${cont.status})`);

  // 3. Structural DAG DP Bounds
  const t2 = performance.now();
  const dagBounds = computeStructuralBounds(gun.id, lookup, cmap);
  const dagTime = performance.now() - t2;
  const dagInterval: [number, number] = [Math.max(3, dagBounds.weightBounds[0]), Math.max(3, dagBounds.weightBounds[1])];
  const dagRootBound = computeRootRelaxationBound(baseParams, dagInterval);

  console.log(`  3. Structural DAG DP:   prep=${dagTime.toFixed(2)}ms, bounds=[${dagBounds.weightBounds[0].toFixed(2)}, ${dagBounds.weightBounds[1].toFixed(2)}], rootContinuousBound=${dagRootBound.toFixed(2)}`);

  const gapCont = naiveRootBound - contRootBound;
  const gapDag = naiveRootBound - dagRootBound;
  console.log(`  Tightness vs Naive: Continuous LP pruned ${gapCont.toFixed(2)} pts; Structural DAG pruned ${gapDag.toFixed(2)} pts (${(gapDag / gapCont * 100).toFixed(1)}% of LP bound)`);
  console.log('');
}
