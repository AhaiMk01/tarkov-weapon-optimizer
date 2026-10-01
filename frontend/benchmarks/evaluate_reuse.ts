import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAndVerifySnapshot } from './snapshot.ts';
import { buildItemLookup } from '../src/solver/dataService.ts';
import { buildCompatibilityMap } from '../src/solver/compatibilityMap.ts';
import { computeStructuralBounds } from '../src/solver/structuralBounds.ts';
import { explorePareto } from '../src/solver/paretoExplorer.ts';
import { solve, computeIdealPoint } from '../src/solver/solver.ts';
import { computeIdealPointCacheKey } from '../src/solver/reuseKey.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));
const { snapshot } = loadAndVerifySnapshot(dir);
const lookup = buildItemLookup(snapshot.guns, snapshot.mods);
const m4a1Id = '5447a9cd4bdc2dbd208b4567';
const cmap = buildCompatibilityMap(m4a1Id, lookup);

console.log('=== Benchmarking Reuse Across Solves (Refs #25) ===');

// 1. Benchmark Tier 1: Explore curve sweep with vs without precomputed structural bounds
console.log('\n--- 1. Explore 10-step curve on M4A1 (ignore: price) ---');
const expParams = {
  weaponId: m4a1Id,
  itemLookup: lookup,
  compatibilityMap: cmap,
  ignore: 'price' as const,
  steps: 10,
  preciseMode: false,
};

// Cold / without precomputed structural bounds
const tCold = performance.now();
const pointsCold = await explorePareto({ ...expParams, structuralBounds: undefined });
const elCold = performance.now() - tCold;
console.log(`Explore without precomputed bounds: ${Math.round(elCold)}ms (${pointsCold.length} points)`);

// Warm / with precomputed structural bounds
const sb = computeStructuralBounds(m4a1Id, lookup, cmap);
const tWarm = performance.now();
const pointsWarm = await explorePareto({ ...expParams, structuralBounds: sb });
const elWarm = performance.now() - tWarm;
console.log(`Explore with precomputed bounds:    ${Math.round(elWarm)}ms (${pointsWarm.length} points)`);
console.log(`Speedup from structural bounds reuse: ${(elCold / elWarm).toFixed(2)}x`);

// 2. Benchmark Tier 2: Sweet Spot weight adjustment reuse
console.log('\n--- 2. Sweet Spot Endpoint Reuse vs Weight Adjustment ---');
// Use a sparse weapon where endpoints certify quickly to show real endpoint reuse
const guns = snapshot.guns.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
const sparse = guns.find(g => Object.keys(buildCompatibilityMap(g.id, lookup).reachable_items).length > 2);
const sparseId = sparse?.id ?? m4a1Id;
const sparseCmap = buildCompatibilityMap(sparseId, lookup);
console.log(`Testing endpoint reuse on weapon: ${sparse?.name ?? sparseId}`);

const baseSweetReq = {
  weaponId: sparseId,
  itemLookup: lookup,
  compatibilityMap: sparseCmap,
  fleaAvailable: true,
  useTrueErgo: false,
  useTchebycheff: true,
};

// First solve: computes ideal point (cold endpoints)
const tEp0 = performance.now();
const idealPoint = await computeIdealPoint(baseSweetReq);
const elEp0 = performance.now() - tEp0;
console.log(`Initial endpoint computation: ${Math.round(elEp0)}ms`);
console.log(`  Ideal point: zE=${idealPoint.zE.toFixed(1)}, zR=${idealPoint.zR.toFixed(1)}, zP=${idealPoint.zP.toFixed(1)}`);

// First solve with weights (100, 0, 0)
const tSolve1 = performance.now();
const res1 = await solve({ ...baseSweetReq, idealPoint, ergoWeight: 100, recoilWeight: 0, priceWeight: 0 });
const elSolve1 = performance.now() - tSolve1;
console.log(`Solve 1 (ergo priority) with cached endpoints: ${Math.round(elSolve1)}ms`);

// User drags ternary slider to (0, 100, 0): endpoints are REUSED!
const tSolve2 = performance.now();
const res2 = await solve({ ...baseSweetReq, idealPoint, ergoWeight: 0, recoilWeight: 100, priceWeight: 0 });
const elSolve2 = performance.now() - tSolve2;
console.log(`Solve 2 (recoil priority) with cached endpoints: ${Math.round(elSolve2)}ms`);

// User drags ternary slider to (33, 33, 33): endpoints are REUSED!
const tSolve3 = performance.now();
const res3 = await solve({ ...baseSweetReq, idealPoint, ergoWeight: 33, recoilWeight: 33, priceWeight: 33 });
const elSolve3 = performance.now() - tSolve3;
console.log(`Solve 3 (balanced ternary) with cached endpoints: ${Math.round(elSolve3)}ms`);

console.log('\n--- Latency Comparison Summary ---');
console.log(`Without reuse: each slider drag would require recomputing endpoints (${Math.round(elEp0)}ms) + solve (${Math.round(elSolve2)}ms) = ${Math.round(elEp0 + elSolve2)}ms total.`);
console.log(`With reuse: each slider drag requires ONLY the solve (${Math.round(elSolve2)}ms).`);
console.log(`Sweet Spot weight adjustment speedup: ${((elEp0 + elSolve2) / elSolve2).toFixed(1)}x latency reduction!`);

console.log('\n=== Evaluation Completed Successfully ===');
