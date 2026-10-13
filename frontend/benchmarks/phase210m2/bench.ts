// Phase 2.10 milestone 2 measurement: Precise (`solvePrecise`) on every pinned gun, plain and TrueErgo, 60 s per request.
//
//   npx tsx benchmarks/phase210m2/bench.ts --out <dir> --label <before|after> --shard <k> --of <n> [--limit-ms 60000] [--profiles plain,trueErgo,trueErgoPO]
//     [--edges integer|relaxed-first] [--split-shortcut on|off] [--guns MP5,M4A1] [--snapshot <path>] [--tolerance <abs>] [--timing on] [--warmup <gun>]
//
// --tolerance sets the request's `objectiveTolerance` (absolute, objective units; default: production's 1e-5). --timing on passes an opt-in
// `PreciseContext.timing` and records its stage breakdown in the line (`timing`); it only reads the clock (docs/stage3/ted-tolerance-and-overhead.md).
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
import { countCandidateEdges } from '../../src/solver/precisionMode';
import { preparePhysicalWeapon, prepareSubproblemDomain, specializeFast } from '../../src/solver/physical';
import { emptyPreciseTiming, solvePrecise } from '../../src/solver/physical/solvePrecise';
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
/** The split-only shortcut (`PreciseContext.splitShortcut`): 'on' is the 2026-10-13 rule ('witness'), 'off' the 2026-10-12 rule ('f1'); default: production. */
const splitShortcut = arg('split-shortcut', '');
if (splitShortcut !== '' && splitShortcut !== 'on' && splitShortcut !== 'off') throw new Error('--split-shortcut must be on or off');
/** The request's absolute objective tolerance (`objectiveTolerance`); '' keeps production's default. */
const toleranceArg = arg('tolerance', '');
const tolerance = toleranceArg === '' ? undefined : Number(toleranceArg);
if (tolerance !== undefined && !(Number.isFinite(tolerance) && tolerance >= 0)) throw new Error('--tolerance must be a finite number >= 0');
const timingOn = arg('timing', 'off') === 'on';

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
  // s3fix2 supplement: TrueErgo with Prevent Overswing at gear -30% (the overswing split points that decision F1 changes are only produced here).
  ...(profile === 'trueErgoPO' ? { useTrueErgo: true, preventOverswing: true, equipErgoModifier: -0.3 } : {}),
  ...(tolerance === undefined ? {} : { objectiveTolerance: tolerance }),
});

/** The build's statistics the tolerance comparison reads (TED, ergonomics, recoil modifier sum, spend, weight). */
const pickStats = (stats: Record<string, unknown>): Record<string, unknown> => ({
  ted: stats.ted, ergonomics: stats.ergonomics, recoilModifierSum: stats.recoilModifierSum, spend: stats.spend, weight: stats.weight,
});

const wanted = only === '' ? null : new Set(only.split(','));
const guns = snapshot.guns.filter((g, i) => (wanted === null ? i % shards === shard : wanted.has(g.shortName) && i % shards === shard));

// --warmup <shortName>: solve that gun once (plain, not recorded) first, so the WebAssembly load and the first JIT pass are not in a measured request.
const warmup = arg('warmup', '');
if (warmup !== '') {
  const gun = snapshot.guns.find(g => g.shortName === warmup);
  if (gun === undefined) throw new Error(`--warmup: no gun ${warmup}`);
  await solvePrecise({ params: request(gun.id, 'plain'), deadline: performance.now() + limitMs });
}

for (const gun of guns) {
  // size of the gun: the candidate slot edges Auto counts today (the recorded runs predate it and carry `autoEstimate`, the occurrence estimate
  // Auto used then) and the count model's dimensions on the default domain
  const blueprint = preparePhysicalWeapon(lookup, gun.id, { isAmmo });
  const domain = prepareSubproblemDomain(blueprint, lookup, {});
  const compat = buildCompatibilityMap(gun.id, lookup);
  const size: Record<string, number | boolean | null> = {
    occurrences: blueprint.stats.itemOccurrences,
    candidateEdges: countCandidateEdges(compat),
    templates: blueprint.stats.templates,
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
    const timing = timingOn ? emptyPreciseTiming() : undefined;
    try {
      const context = {
        params, deadline: performance.now() + limitMs, ...(edges === '' ? {} : { edgeIntegrality: edges }), ...(timing === undefined ? {} : { timing }),
        ...(splitShortcut === '' ? {} : { splitShortcut: splitShortcut === 'on' ? 'witness' : 'f1' }),
      };
      const result = await solvePrecise(context as Parameters<typeof solvePrecise>[0]);
      const ms = performance.now() - started;
      const r = result as unknown as {
        kind: string; certified?: boolean; reason?: string; best?: { score: number };
        outcome: { status: string; physical_certificate: string; reason?: string };
        summary: { nodes: number; bounds: { lower: number | null; upper: number | null; gap: number | null }; telemetry: Record<string, unknown> };
      };
      line = {
        gun: gun.shortName, id: gun.id, profile, label, edges: edges || null, splitShortcut: splitShortcut || null, ms, kind: r.kind, status: r.outcome.status, certificate: r.outcome.physical_certificate,
        reason: r.outcome.reason ?? null, score: r.best?.score ?? null, bounds: r.summary.bounds, nodes: r.summary.nodes, telemetry: r.summary.telemetry, size,
        tolerance: tolerance ?? null, ...(r.best === undefined ? {} : { stats: pickStats((r.best as unknown as { stats: Record<string, unknown> }).stats) }),
        ...(timing === undefined ? {} : { timing }),
      };
    } catch (error) {
      line = { gun: gun.shortName, id: gun.id, profile, label, ms: performance.now() - started, kind: 'error', error: String(error).slice(0, 400), size };
    }
    appendFileSync(outFile, `${JSON.stringify(line)}\n`);
  }
}
appendFileSync(outFile, `${JSON.stringify({ done: true, shard, label })}\n`);
process.exit(0);
