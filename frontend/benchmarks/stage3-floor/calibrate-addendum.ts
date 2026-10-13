// Stage 3 workstream 3.7 ADDENDUM calibration (post-hoc, declared as such in docs/stage3/floor-measurement.md). None of the primary frozen cases
// spent the deadline: N1's Prevent Overswing premise was wrong (builds under 3 kg carry no weight penalty, so TED >= 0 holds trivially) and N2's
// seed emptiness took 0.1-0.4 s. To still probe a difficult no-witness / infeasible floor, the addendum puts a minimum ergonomics AT and just ABOVE the
// certified maximum ergonomics of two large platforms UNDER A BUDGET (unbudgeted, both reach the clamp of 100, so no cap above it is meaningful).
// This script measures that maximum with production Precise Optimize (`solve`, weights e 1, r 0, p 0, the floor cases' acquisition domain plus
// `maxPrice`), never with the floor. Its output is copied into cases-addendum.json by freeze-addendum.ts.
//
//   npx tsx benchmarks/stage3-floor/calibrate-addendum.ts > benchmarks/stage3-floor/calibration.json
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildItemLookup } from '../../src/solver/dataService';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { solve } from '../../src/solver/solver';

const snapshot = JSON.parse(readFileSync(fileURLToPath(new URL('../snapshot.json', import.meta.url)), 'utf8')) as { guns: unknown[]; mods: unknown[] };
const lookup = buildItemLookup(snapshot.guns as never, snapshot.mods as never);
const GUNS: Record<string, string> = { M4A1: '5447a9cd4bdc2dbd208b4567', 'AK-74N': '5644bd2b4bdc2d3b4c8b4572' };
// Budgets tried (the M4A1 receiver alone exceeds 60,000 RUB under this domain: those budgets are certified infeasible).
const BUDGETS: Record<string, number[]> = { M4A1: [25_000, 40_000, 60_000, 100_000, 150_000], 'AK-74N': [25_000, 40_000, 60_000] };

const log = console.error.bind(console);
console.log = console.warn = () => {};
const out: Record<string, unknown> = {};
for (const [name, id] of Object.entries(GUNS)) for (const maxPrice of BUDGETS[name]) {
  const started = performance.now();
  const r = await solve({
    weaponId: id, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(id, lookup), ergoWeight: 1, recoilWeight: 0, priceWeight: 0, maxPrice,
    fleaAvailable: true, barterAvailable: false, barterExcludeDogtags: true, playerLevel: 50,
    traderLevels: { prapor: 4, skier: 4, peacekeeper: 4, mechanic: 4, jaeger: 4, ref: 4 }, preciseMode: true, precisionRequest: 'precise', timeLimitMs: 120_000,
  });
  out[`${name} @ ${maxPrice}`] = {
    weaponId: id, maxPrice, status: r.status, certificate: r.physical_certificate, ergonomics: r.final_stats?.ergonomics ?? null, ms: Math.round(performance.now() - started),
  };
  log(name, maxPrice, JSON.stringify(out[`${name} @ ${maxPrice}`]));
}
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
process.exit(0);
