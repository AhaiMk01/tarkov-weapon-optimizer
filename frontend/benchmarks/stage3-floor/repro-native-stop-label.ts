// Minimal reproduction (Stage 3 workstream 3.7 finding, not fixed here): a MOA floor witness is labelled `nativeStop: 'solution_limit'` (and its
// Precise outcome carries the factual reason `Native solution limit reached`) although the native solve that produced it COMPLETED with model status
// `Optimal`. ADR 0013 section 6 keeps a native `Optimal` completion and an unfinished native solution-limit stop distinct, and the header of
// `src/solver/moaFloor.ts` (`nativeStopOf`) says the first-witness relabelling applies to "a weight search (stopAtFirstWitness, TED requests only)";
// this request reads no TED (one node, no weight search). Cause: `solvePrecise`'s `confirm` returns the reason `nativeSolutionLimitReached` for ANY
// first witness under `stopAtFirstWitness`, whatever the native status. Effect: the floor trace diagnostic only; the floor status, bounds and
// witness are unaffected (`nativeStop` is never an input of the search).
//
//   npx tsx benchmarks/stage3-floor/repro-native-stop-label.ts
//
// Expected (per the ADR): nativeStop 'optimal' when every native call of the query returned Optimal. Observed: 'solution_limit'.
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
const M45A1 = '5f36a0e5fbf956000b716b65';
const request: MoaFloorRequest = {
  weaponId: M45A1, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(M45A1, lookup), fleaAvailable: true, playerLevel: 50,
  traderLevels: { prapor: 4, skier: 4, peacekeeper: 4, mechanic: 4, jaeger: 4, ref: 4 }, precisionRequest: 'precise', preciseMode: true,
};

const statuses: string[] = [];
const recording: SolveFn = async (lp, options, extras) => {
  const r = await nativeSolve(lp, options, extras);
  statuses.push(r.modelStatus.name);
  return r;
};

console.log = () => {};
const result = await preciseFloorQuery(request, recording)(null, fixedGuard(performance.now() + 30_000));
const nativeStop = result.kind === 'witness' ? result.witness.nativeStop : null;
process.stdout.write(`${JSON.stringify({ queryResult: result.kind, nativeStop, nativeStatuses: statuses })}\n`);
const reproduced = result.kind === 'witness' && nativeStop === 'solution_limit' && statuses.length > 0 && statuses.every(s => s === 'Optimal');
process.stdout.write(reproduced ? 'REPRODUCED: every native call returned Optimal, the witness is labelled solution_limit\n' : 'not reproduced\n');
process.exit(0);
