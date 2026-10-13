// RESOLVED (owner decision F1, 2026-10-12, s3fix2): a first opinion that leads only to a split is no longer confirmed (search verdict `split`,
// `leadsOnlyToSplit` in src/solver/physical/solvePrecise.ts). After the change this script prints a witness at 1.0210 MOA for the Prevent Overswing query
// and the native log shows no seed-11 SolutionLimit (see docs/stage3/floor-measurement.md, F1 resolved). Kept as the regression reproduction.
// Minimal reproduction of Stage 3 workstream 3.7 finding F1 (not fixed here; production is untouched): a Prevent Overswing floor query stops
// WITHOUT a witness or an emptiness after ~0.6 s, because the decision-5a second opinion of a TED weight node runs under the floor's native stop
// `mip_max_improving_sols = 1` and HiGHS reports `SolutionLimit` (objective 0 = dual bound 0, gap closed) where the first opinion of the same node
// text reported `Optimal`. A limit status is never a qualified verdict, so the node is unsettled, the spatial search ends with the stop reason
// `Native solution limit reached`, and the whole floor ends `model_witnessed` with a 1.0 MOA bracket while ~29 s of the 30 s budget remain.
//
// Measured on the frozen cases R1-SR25-PO and N1-SR25-PO-60 (6/6 runs each, identical; see summary.md). This script is the single query, the
// production `preciseFloorQuery` with the native solve only recorded:
//
//   npx tsx benchmarks/stage3-floor/repro-ted-second-opinion-solution-limit.ts
//
// Observed at tip 74066da (frontend/src tree 7921d95): the query returns { kind: 'stopped', reason: 'Native solution limit reached' } and the native
// log of the >= 3 kg weight node reads `Optimal` (seed 0, objective 0, dual bound 0) then `SolutionLimit` (seed 11, objective 0, dual bound 0).
// The same cap on the same gun WITHOUT Prevent Overswing (frozen case C2-SR25) yields a witness at 1.0210 MOA, so the query is not empty.
// Whether this is a defect (a liveness loss the ADR's "retain the spatial safeguards until a full witness, qualified emptiness or unresolved stop"
// permits) or the intended conservative outcome is an owner / implementer call; it is reported, not changed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildItemLookup } from '../../src/solver/dataService';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { preciseFloorQuery } from '../../src/solver/moaFloor';
import type { MoaFloorRequest } from '../../src/solver/moaFloor';
import { nativeSolve } from '../../src/solver/physical/nativeSolve';
import type { SolveFn } from '../../src/solver/physical/nativeSolve';
import { fixedGuard } from '../../src/solver/runtimeGuard';

const snapshot = JSON.parse(readFileSync(fileURLToPath(new URL('../snapshot.json', import.meta.url)), 'utf8')) as { guns: unknown[]; mods: unknown[] };
const lookup = buildItemLookup(snapshot.guns as never, snapshot.mods as never);
const SR25 = '5df8ce05b11454561e39243b';
/** The second threshold trial of frozen case R1-SR25-PO (bisection between lo 0.5315067551308055 and the seed's hi 1.5315067551308055). */
const CAP = 1.0315067551308055;

// The worker's normalized domain of frozen case R1-SR25-PO (`domainParams` of `workerRuntime.ts`; the floor sets the objective and the cap itself).
const request = (preventOverswing: boolean): MoaFloorRequest => ({
  weaponId: SR25, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(SR25, lookup), useTrueErgo: false, preventOverswing,
  equipErgoModifier: preventOverswing ? -0.3 : undefined, traderLevels: { prapor: 4, skier: 4, peacekeeper: 4, mechanic: 4, jaeger: 4, ref: 4 },
  fleaAvailable: true, barterAvailable: false, barterExcludeDogtags: true, playerLevel: 50, ownedItems: [], precisionRequest: 'precise', preciseMode: true,
});

console.log = () => {};
for (const preventOverswing of [true, false]) {
  const calls: { status: string; seed: unknown; objective: number | null; dualBound: number | null; integers: number }[] = [];
  const recording: SolveFn = async (lp, options, extras) => {
    const r = await nativeSolve(lp, options, extras);
    calls.push({ status: r.modelStatus.name, seed: r.effectiveOptions.random_seed, objective: r.objectiveValue, dualBound: r.mipDualBound, integers: r.model.numInteger });
    return r;
  };
  const started = performance.now();
  const result = await preciseFloorQuery(request(preventOverswing), recording)(CAP, fixedGuard(performance.now() + 30_000));
  const summary = result.kind === 'witness' ? { kind: 'witness', achievedMoa: result.witness.achievedMoa } : result;
  process.stdout.write(`${JSON.stringify({ preventOverswing, cap: CAP, ms: Math.round(performance.now() - started), result: summary, native: calls })}\n`);
}
process.exit(0);
