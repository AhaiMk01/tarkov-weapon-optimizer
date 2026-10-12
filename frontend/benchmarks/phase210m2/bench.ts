// Phase 2.10 milestone 2 measurement: Precise (`solvePrecise`) on every pinned gun, plain and TrueErgo, 60 s per request.
//
//   npx tsx benchmarks/phase210m2/bench.ts --out <dir> --label <before|after> --shard <k> --of <n> [--limit-ms 60000] [--profiles plain,trueErgo]
//     [--edges integer|relaxed-first] [--guns MP5,M4A1] [--snapshot <path>]
//
// One JSON line per (gun, profile) is appended to <dir>/<label>-<k>.jsonl as soon as it is measured (node's test runner buffers its output, a
// plain script with appendFileSync does not), so an interrupted run keeps what it measured. The same script runs on the tip before the change
// (occurrence model) and after it (count model with the second opinion): it reads the result generically and records the telemetry it finds.
// `run.sh` shards it across processes and `summarize.ts` builds the tables.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildItemLookup } from '../../src/solver/dataService';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { estimateOccurrences } from '../../src/solver/precisionMode';
import { preparePhysicalWeapon, prepareSubproblemDomain, specializeFast } from '../../src/solver/physical';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import type { ItemLookup, SolveParams } from '../../src/solver/types';

const SNAPSHOT_SHA256 = '219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c';

const argv = process.argv.slice(2);
const arg = (name: string, fallback?: string): string => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
};
const outDir = arg('out');
const label = arg('label');
const shard = Number(arg('shard', '0'));
const shards = Number(arg('of', '1'));
const limitMs = Number(arg('limit-ms', '60000'));
const profiles = arg('profiles', 'plain,trueErgo').split(',');
const snapshotPath = arg('snapshot', fileURLToPath(new URL('../snapshot.json', import.meta.url)));
const only = arg('guns', '');
/** After the change only: the node strategy of Precise (`PreciseContext.edgeIntegrality`); the tip ignores it. */
const edges = arg('edges', '');

mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${label}-${shard}.jsonl`);

const bytes = readFileSync(snapshotPath);
if (createHash('sha256').update(bytes).digest('hex') !== SNAPSHOT_SHA256) throw new Error('the snapshot is not the pinned artifact');
const snapshot = JSON.parse(bytes.toString('utf8')) as { guns: { id: string; shortName: string }[]; mods: unknown[] };
const lookup: ItemLookup = buildItemLookup(snapshot.guns as never, snapshot.mods as never);
const isAmmo = (id: string): boolean => !Object.hasOwn(lookup, id);

/** The request of the policy measurement (default weights e 1, r 1, p 0.1; flea; trader level 4; player level 50) at the default tolerance. */
const request = (id: string, profile: string): SolveParams => ({
  weaponId: id, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(id, lookup), physicalOptions: { isAmmo },
  ergoWeight: 1, recoilWeight: 1, priceWeight: 0.1, fleaAvailable: true, barterAvailable: false, barterExcludeDogtags: true, playerLevel: 50,
  traderLevels: { prapor: 4, skier: 4, peacekeeper: 4, mechanic: 4, jaeger: 4, ref: 4 }, equipErgoModifier: 0,
  ...(profile === 'trueErgo' ? { useTrueErgo: true } : {}),
});

const wanted = only === '' ? null : new Set(only.split(','));
const guns = snapshot.guns.filter((g, i) => (wanted === null ? i % shards === shard : wanted.has(g.shortName) && i % shards === shard));

for (const gun of guns) {
  // size of the gun: the occurrences Auto counts today and the count model's dimensions on the default domain
  const blueprint = preparePhysicalWeapon(lookup, gun.id, { isAmmo });
  const domain = prepareSubproblemDomain(blueprint, lookup, {});
  const compat = buildCompatibilityMap(gun.id, lookup);
  const size: Record<string, number | boolean | null> = {
    occurrences: blueprint.stats.itemOccurrences,
    autoEstimate: estimateOccurrences(compat, 1_000_000),
    templates: blueprint.stats.templates,
    prunedAncestorEdges: blueprint.stats.prunedAncestorEdges,
    emptyDomain: domain.empty,
    countColumns: null, countRows: null, countEdges: null, countIntegers: null,
  };
  if (!domain.empty) {
    const model = specializeFast(blueprint, domain, { ergoWeight: 1, recoilWeight: 1, priceWeight: 0.1 });
    size.countColumns = model.stats.columns;
    size.countRows = model.stats.rows;
    size.countEdges = model.edges.length;
    size.countIntegers = model.stats.integers + model.stats.binaries;
  }
  for (const profile of profiles) {
    const params = request(gun.id, profile);
    const started = performance.now();
    let line: Record<string, unknown>;
    try {
      const context = { params, deadline: performance.now() + limitMs, ...(edges === '' ? {} : { edgeIntegrality: edges }) };
      const result = await solvePrecise(context as Parameters<typeof solvePrecise>[0]);
      const ms = performance.now() - started;
      const r = result as unknown as {
        kind: string; certified?: boolean; reason?: string; best?: { score: number };
        outcome: { status: string; physical_certificate: string; reason?: string };
        summary: { nodes: number; bounds: { lower: number | null; upper: number | null; gap: number | null }; telemetry: Record<string, unknown> };
      };
      line = {
        gun: gun.shortName, id: gun.id, profile, label, edges: edges || null, ms, kind: r.kind, status: r.outcome.status, certificate: r.outcome.physical_certificate,
        reason: r.outcome.reason ?? null, score: r.best?.score ?? null, bounds: r.summary.bounds, nodes: r.summary.nodes, telemetry: r.summary.telemetry, size,
      };
    } catch (error) {
      line = { gun: gun.shortName, id: gun.id, profile, label, ms: performance.now() - started, kind: 'error', error: String(error).slice(0, 400), size };
    }
    appendFileSync(outFile, `${JSON.stringify(line)}\n`);
  }
}
appendFileSync(outFile, `${JSON.stringify({ done: true, shard, label })}\n`);
process.exit(0);
