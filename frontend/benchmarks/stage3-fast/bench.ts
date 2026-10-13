// Stage 3 workstream 3.4 (the Fast contract) on every pinned gun: production's public `solve()` in Fast mode, four profiles, 60 s per request.
//
//   npx tsx benchmarks/stage3-fast/bench.ts --out <dir> --shard <k> --of <n> [--limit-ms 60000] [--guns MP5,M4A1] [--precise plain,trueErgo|plain|none]
//     [--snapshot <path>]
//
// Profiles: fast-plain-single (the default: one copy per part, owner decision 2c), fast-plain-repeats (`allowRepeatedParts`), fast-ted-single and
// fast-ted-repeats (TrueErgo, owner decision 2b). Every Fast response goes through the shared contract check (`tests/physical/fastContract.check.ts`):
// the production validator on the published build, and the truthful qualification of the outcome. The certified Precise optimum of the same request
// is recorded for comparison (`--precise`, default plain and trueErgo): `precise-plain` and `precise-ted`. Precise always allows repeats, so it is
// the yardstick of the repeats profiles; the single-copy profiles solve a restricted model and may sit below it by design.
//
// The request is Phase 2.10's (weights e 1, r 1, p 0.1; flea; trader level 4; player level 50; default tolerance), so the Precise numbers can be
// read against `benchmarks/phase210m2/`. One JSON line per (gun, profile) is appended to <dir>/s3fast-<k>.jsonl as soon as it is measured.
// `run.sh` shards it, `summarize.ts` writes the tables.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildItemLookup } from '../../src/solver/dataService';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { solve } from '../../src/solver/solver';
import type { ItemLookup, SolveParams } from '../../src/solver/types';
import { checkFastContract, returnsBuild } from '../../tests/physical/fastContract.check';

const SNAPSHOT_SHA256 = '219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c';

const argv = process.argv.slice(2);
const arg = (name: string, fallback?: string): string => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
};
const outDir = arg('out');
const shard = Number(arg('shard', '0'));
const shards = Number(arg('of', '1'));
const limitMs = Number(arg('limit-ms', '60000'));
const snapshotPath = arg('snapshot', fileURLToPath(new URL('../snapshot.json', import.meta.url)));
const only = arg('guns', '');
const preciseProfiles = arg('precise', 'plain,trueErgo').split(',').filter(p => p !== 'none' && p !== '');

mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `s3fast-${shard}.jsonl`);

const bytes = readFileSync(snapshotPath);
const sha = createHash('sha256').update(bytes).digest('hex');
if (sha !== SNAPSHOT_SHA256) throw new Error('the snapshot is not the pinned artifact');
const snapshot = JSON.parse(bytes.toString('utf8')) as { guns: { id: string; shortName: string }[]; mods: unknown[] };
const lookup: ItemLookup = buildItemLookup(snapshot.guns as never, snapshot.mods as never);
const isAmmo = (id: string): boolean => !Object.hasOwn(lookup, id);

const request = (id: string, ted: boolean): SolveParams => ({
  weaponId: id, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(id, lookup), physicalOptions: { isAmmo },
  ergoWeight: 1, recoilWeight: 1, priceWeight: 0.1, fleaAvailable: true, barterAvailable: false, barterExcludeDogtags: true, playerLevel: 50,
  traderLevels: { prapor: 4, skier: 4, peacekeeper: 4, mechanic: 4, jaeger: 4, ref: 4 }, equipErgoModifier: 0, timeLimitMs: limitMs,
  ...(ted ? { useTrueErgo: true } : {}),
});

interface Profile { name: string; precise: boolean; ted: boolean; repeats: boolean }
const PROFILES: Profile[] = [
  { name: 'fast-plain-single', precise: false, ted: false, repeats: false },
  { name: 'fast-plain-repeats', precise: false, ted: false, repeats: true },
  { name: 'fast-ted-single', precise: false, ted: true, repeats: false },
  { name: 'fast-ted-repeats', precise: false, ted: true, repeats: true },
  ...(preciseProfiles.includes('plain') ? [{ name: 'precise-plain', precise: true, ted: false, repeats: true }] : []),
  ...(preciseProfiles.includes('trueErgo') ? [{ name: 'precise-ted', precise: true, ted: true, repeats: true }] : []),
];

const wanted = only === '' ? null : new Set(only.split(','));
const guns = snapshot.guns.filter((g, i) => i % shards === shard && (wanted === null || wanted.has(g.shortName)));

// Production logs diagnostics to the console: keep the shard log for the script's own errors.
console.log = console.warn = () => {};

for (const gun of guns) {
  for (const profile of PROFILES) {
    const params: SolveParams = {
      ...request(gun.id, profile.ted), preciseMode: profile.precise, precisionRequest: profile.precise ? 'precise' : 'fast',
      ...(profile.precise ? {} : { allowRepeatedParts: profile.repeats }),
    };
    const started = performance.now();
    let line: Record<string, unknown>;
    try {
      const r = await solve(params);
      const ms = performance.now() - started;
      const contract = profile.precise ? null : checkFastContract(params, r);
      const placed = r.slot_pairs?.map(p => p.itemId) ?? [];
      line = {
        gun: gun.shortName, id: gun.id, profile: profile.name, ms, solveMs: r.solve_time_ms,
        status: r.status, certificate: r.physical_certificate, resolved: r.precision_resolved, qualification: r.model_qualification, reason: r.reason ?? null,
        termination: r.optimization?.termination ?? null, nodes: r.optimization?.nodes ?? null,
        lower: r.optimization?.lower_bound ?? null, upper: r.optimization?.upper_bound ?? null, gap: r.optimization?.absolute_gap ?? null,
        tolerance: r.optimization?.tolerance ?? null, objective: r.objective_value, build: returnsBuild(r), items: placed.length,
        repeatedPart: new Set(placed).size !== placed.length, singleCopyFlag: r.single_copy === true,
        ted: r.final_stats?.true_ergo_delta ?? null,
        buildKey: returnsBuild(r) ? `${r.selected_preset?.id ?? '?'}|${[...placed].sort().join(',')}` : null,
        ...(contract === null ? {} : { validatorOk: contract.validation?.ok ?? null, violations: contract.violations }),
      };
    } catch (error) {
      line = { gun: gun.shortName, id: gun.id, profile: profile.name, ms: performance.now() - started, status: 'error', error: String(error).slice(0, 400) };
    }
    appendFileSync(outFile, `${JSON.stringify(line)}\n`);
  }
}
appendFileSync(outFile, `${JSON.stringify({ done: true, shard, snapshotSha256: sha })}\n`);
process.exit(0);
