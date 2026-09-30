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

export function computeContinuousLPBounds(
  weaponId: string,
  itemLookup: ItemLookup,
  cmap: CompatibilityMap,
): { bounds: [number, number]; timeMs: number } {
  const t0 = performance.now();
  const lp = buildLP({ weaponId, itemLookup, compatibilityMap: cmap });
  const lpStr = lp.lpString.replace('  obj: total_obj', '  obj: total_weight');
  const binIdx = lpStr.indexOf('\nBinary');
  const contMaxLp = (binIdx > 0 ? lpStr.slice(0, binIdx) : lpStr) + '\nEnd\n';
  const resMax = highs.solve(contMaxLp);
  const maxW = resMax.ObjectiveValue ?? 0;

  const contMinLp = contMaxLp.replace('Maximize\n  obj: total_weight', 'Minimize\n  obj: total_weight');
  const resMin = highs.solve(contMinLp);
  const minW = resMin.ObjectiveValue ?? 0;
  const timeMs = performance.now() - t0;

  return { bounds: [Math.max(0, minW), Math.max(minW, maxW)], timeMs };
}

const testWeapons = ['M4A1', 'SVDS', 'AK-74N'];

console.log('=== Comparing Bound Strategies on Real Weapons ===\n');

for (const name of testWeapons) {
  const gun = data.guns.find((g: Record<string, unknown>) => typeof g.name === 'string' && g.name.includes(name));
  if (!gun) continue;
  const cmap = buildCompatibilityMap(gun.id, lookup);
  const baseParams = {
    weaponId: gun.id, itemLookup: lookup, compatibilityMap: cmap,
    ergoWeight: 50, recoilWeight: 50, priceWeight: 20, fleaAvailable: true,
    useTrueErgo: true,
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
  const naiveLp = buildLP(baseParams, [3, naiveMaxW]);
  const naiveSolve = highs.solve(naiveLp.lpString, { mip_rel_gap: 0, time_limit: 10 });

  console.log(`  1. Naive Sum:       prep=${naiveTime.toFixed(2)}ms, bounds=[3, ${naiveMaxW.toFixed(2)}], rootBound=${naiveSolve.ObjectiveValue?.toFixed(2)}`);

  // 2. Continuous LP Bounds
  const cont = computeContinuousLPBounds(gun.id, lookup, cmap);
  const contLp = buildLP(baseParams, [Math.max(3, cont.bounds[0]), Math.max(3, cont.bounds[1])]);
  const contSolve = highs.solve(contLp.lpString, { mip_rel_gap: 0, time_limit: 10 });

  console.log(`  2. Continuous LP:   prep=${cont.timeMs.toFixed(2)}ms, bounds=[${cont.bounds[0].toFixed(2)}, ${cont.bounds[1].toFixed(2)}], rootBound=${contSolve.ObjectiveValue?.toFixed(2)}`);

  // 3. Structural DAG DP Bounds
  const t2 = performance.now();
  const dagBounds = computeStructuralBounds(gun.id, lookup, cmap);
  const dagTime = performance.now() - t2;
  const dagLp = buildLP(baseParams, [Math.max(3, dagBounds.weightBounds[0]), Math.max(3, dagBounds.weightBounds[1])]);
  const dagSolve = highs.solve(dagLp.lpString, { mip_rel_gap: 0, time_limit: 10 });

  console.log(`  3. Structural DAG:  prep=${dagTime.toFixed(2)}ms, bounds=[${dagBounds.weightBounds[0].toFixed(2)}, ${dagBounds.weightBounds[1].toFixed(2)}], rootBound=${dagSolve.ObjectiveValue?.toFixed(2)}`);
  console.log('');
}
