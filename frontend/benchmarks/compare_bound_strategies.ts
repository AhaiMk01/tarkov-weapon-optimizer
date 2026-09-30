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
 * Constructs a mathematically sound continuous LP relaxation of the exact placement model.
 * 1. Independent: built with boundsMode: 'naive' and unconstrained weightInterval [0, 1000]
 *    so it is NOT pre-constrained by the structural bounds it is being compared against.
 * 2. Exact relaxation: replaces 'Binary' with explicit unit bounds '0 <= var <= 1' in the Bounds section,
 *    preventing variables from becoming unbounded [0, infinity).
 */
function relaxToContinuousLP(lpString: string): string {
  const binMarker = '\nBinary\n';
  const binIdx = lpString.indexOf(binMarker);
  if (binIdx < 0) throw new Error('Malformed LP: Binary section missing');

  const endIdx = lpString.indexOf('\nEnd', binIdx);
  const binContent = lpString.slice(binIdx + binMarker.length, endIdx > 0 ? endIdx : undefined);
  const binVars = binContent.trim().split(/\s+/).filter(Boolean);

  const unitBounds = binVars.map(v => `  0 <= ${v} <= 1`).join('\n');
  const boundsMarker = '\nBounds\n';
  const boundsIdx = lpString.indexOf(boundsMarker);

  if (boundsIdx >= 0) {
    return lpString.slice(0, boundsIdx + boundsMarker.length)
      + unitBounds + '\n'
      + lpString.slice(boundsIdx + boundsMarker.length, binIdx)
      + '\nEnd\n';
  } else {
    return lpString.slice(0, binIdx)
      + '\nBounds\n'
      + unitBounds
      + '\nEnd\n';
  }
}

/**
 * Solves the truly independent continuous LP relaxation of exact placement to find
 * the mathematical min and max total_weight achievable by any feasible build.
 */
export function computeExactContinuousLPBounds(
  weaponId: string,
  itemLookup: ItemLookup,
  cmap: CompatibilityMap,
): { bounds: [number, number]; timeMs: number; status: string } {
  const t0 = performance.now();
  // MUST use preciseMode: true for exact placement, boundsMode: 'naive' to avoid circularity,
  // and [0, 1000] so total_weight is completely unconstrained by prior bounds.
  const lp = buildLP(
    { weaponId, itemLookup, compatibilityMap: cmap, preciseMode: true, boundsMode: 'naive' },
    [0, 1000],
  );

  const baseContinuousLp = relaxToContinuousLP(lp.lpString);

  // Maximize total_weight
  const maxLp = baseContinuousLp.replace('  obj: total_obj', '  obj: total_weight');
  const resMax = highs.solve(maxLp);

  // Minimize total_weight
  const minLp = baseContinuousLp
    .replace('Maximize\n  obj: total_obj', 'Minimize\n  obj: total_weight')
    .replace('Maximize\n', 'Minimize\n');
  const resMin = highs.solve(minLp);

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
 * Computes the root continuous relaxation dual bound on the TrueErgo objective
 * for a given weight interval [lo, hi], with explicit unit bounds on relaxed binary variables.
 */
function computeRootRelaxationBound(params: Record<string, unknown>, interval: [number, number]): number {
  const lp = buildLP(params as unknown as Parameters<typeof buildLP>[0], interval);
  const continuousLp = relaxToContinuousLP(lp.lpString);
  const res = highs.solve(continuousLp);
  if (res.Status !== 'Optimal' || res.ObjectiveValue == null) {
    throw new Error(`Root relaxation solve failed with status ${res.Status}`);
  }
  return res.ObjectiveValue;
}

const testWeapons = ['M4A1', 'SVDS', 'AK-74N'];

console.log('=== Comparing Truly Independent Bound Strategies on Exact Placement Model ===\n');

for (const name of testWeapons) {
  const gun = data.guns.find((g: Record<string, unknown>) => typeof g.name === 'string' && g.name.includes(name));
  if (!gun) continue;
  const cmap = buildCompatibilityMap(gun.id, lookup);
  const baseParams = {
    weaponId: gun.id, itemLookup: lookup, compatibilityMap: cmap,
    ergoWeight: 50, recoilWeight: 50, priceWeight: 20, fleaAvailable: true,
    useTrueErgo: true, preciseMode: true, boundsMode: 'naive',
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

  console.log(`  1. Naive Sum (v2.13.0):   prep=${naiveTime.toFixed(2)}ms, bounds=[3.00, ${naiveMaxW.toFixed(2)}], rootContinuousBound=${naiveRootBound.toFixed(2)}`);

  // 2. Independent Exact Continuous LP Bounds
  const cont = computeExactContinuousLPBounds(gun.id, lookup, cmap);
  const contInterval: [number, number] = [Math.max(3, cont.bounds[0]), Math.max(3, cont.bounds[1])];
  const contRootBound = computeRootRelaxationBound(baseParams, contInterval);

  console.log(`  2. Independent Cont. LP:  prep=${cont.timeMs.toFixed(2)}ms, bounds=[${cont.bounds[0].toFixed(2)}, ${cont.bounds[1].toFixed(2)}], rootContinuousBound=${contRootBound.toFixed(2)} (${cont.status})`);

  // 3. Structural DAG DP Bounds
  const t2 = performance.now();
  const dagBounds = computeStructuralBounds(gun.id, lookup, cmap);
  const dagTime = performance.now() - t2;
  const dagInterval: [number, number] = [Math.max(3, dagBounds.weightBounds[0]), Math.max(3, dagBounds.weightBounds[1])];
  const dagRootBound = computeRootRelaxationBound(baseParams, dagInterval);

  console.log(`  3. Structural DAG DP:     prep=${dagTime.toFixed(2)}ms, bounds=[${dagBounds.weightBounds[0].toFixed(2)}, ${dagBounds.weightBounds[1].toFixed(2)}], rootContinuousBound=${dagRootBound.toFixed(2)}`);

  const gapCont = naiveRootBound - contRootBound;
  const gapDag = naiveRootBound - dagRootBound;
  console.log(`  Tightness vs Naive: Cont. LP pruned ${gapCont.toFixed(2)} pts; Structural DAG pruned ${gapDag.toFixed(2)} pts (${(gapDag / gapCont * 100).toFixed(1)}% of LP bound)`);
  console.log('');
}
