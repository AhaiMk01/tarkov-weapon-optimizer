// Phase 2.10 milestone 2 measurement: Precise (`solvePrecise`) on every pinned gun, plain and TrueErgo, 60 s per request.
//
//   npx tsx benchmarks/phase210m2/bench.ts --out <dir> --label <before|after> --shard <k> --of <n> [--limit-ms 60000] [--profiles plain,trueErgo,trueErgoPO]
//     [--edges integer|relaxed-first] [--split-shortcut on|off] [--guns MP5,M4A1] [--snapshot <path>] [--tolerance <abs>] [--timing on] [--warmup <gun>]
//     [--pool <n>] [--speculation always|unsplittable|off] [--prefetch <k>] [--preempt on|off] [--warm on]
//     [--payoff-concurrent on|off]
//
// Sweet Spot profiles (docs/stage3/sweet-spot.md): `sweetPlain` (use_tchebycheff, default weights) and `sweetTrueErgo` (use_tchebycheff + TrueErgo) run
// through the public `solveRequest` (Precise), so the real `computePayoff` computes the payoff table on every request: no endpoint cache, a cold
// table each time. Their lines carry the endpoint and table times (`PayoffReport.timing`), the final solve's time (total minus table), the endpoint
// records, the ideal point and a hash of the returned build (`buildSha`, of the preset and the placements). --warm on also runs each Sweet Spot request
// a second time through an `EndpointCache` holding the first table (what the worker does on a hit) and records `warm`. --payoff-concurrent sets
// `configurePayoff` (default: production's, on; off is the sequential behaviour before docs/stage3/sweet-spot.md).
//
// --pool <n> runs Precise on a native solve pool of n worker_threads lanes (docs/stage3/parallel-pool.md; 1 = no pool, the in-thread instance);
// --speculation and --prefetch set `PreciseContext.speculation` / `prefetchNodes` (default: production's), --preempt the pool's preemption. Lines then
// carry `pool` (the size), the pool's per-lane peak wasm heap and the process's resident memory after the request.
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
import { configureNativePool, nativePoolStats, shutdownNativePool } from '../../src/solver/native/pool';
import { configurePayoff, solveRequest } from '../../src/solver/solver';
import { EndpointCache } from '../../src/solver/endpointCache';

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
const poolSize = Number(arg('pool', '1'));
if (!(Number.isInteger(poolSize) && poolSize >= 1)) throw new Error('--pool must be a positive integer');
const speculation = arg('speculation', '');
if (speculation !== '' && !['always', 'unsplittable', 'off'].includes(speculation)) throw new Error('--speculation must be always, unsplittable or off');
const prefetchArg = arg('prefetch', '');
const preempt = arg('preempt', 'on') === 'on';
const warmOn = arg('warm', 'off') === 'on';
const onOff = (name: string): boolean | undefined => {
  const v = arg(name, '');
  if (v === '') return undefined;
  if (v !== 'on' && v !== 'off') throw new Error(`--${name} must be on or off`);
  return v === 'on';
};
const payoffConcurrent = onOff('payoff-concurrent');
configurePayoff(payoffConcurrent === undefined ? {} : { concurrent: payoffConcurrent });
configureNativePool({ size: poolSize, preempt });

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
  ...(profile === 'sweetPlain' ? { useTchebycheff: true } : {}),
  ...(profile === 'sweetTrueErgo' ? { useTchebycheff: true, useTrueErgo: true } : {}),
});

const isSweet = (profile: string): boolean => profile === 'sweetPlain' || profile === 'sweetTrueErgo';

/** The returned build of a public response (preset and every placement), hashed like `buildSha` of a Precise result. */
const responseSha = (response: { selected_preset?: unknown; slot_pairs: unknown[]; objective_value: number | null }): string | null =>
  response.objective_value === null ? null
    : createHash('sha256').update(JSON.stringify({ preset: response.selected_preset ?? null, placements: response.slot_pairs })).digest('hex').slice(0, 16);

/** One Sweet Spot request through `solveRequest` (cold: no cache), and optionally the warm repeat through an endpoint cache. */
async function sweetLine(gun: { id: string; shortName: string }, profile: string): Promise<Record<string, unknown>> {
  const params: SolveParams = { ...request(gun.id, profile), preciseMode: true, timeLimitMs: limitMs };
  const started = performance.now();
  const report = await solveRequest(params);
  const ms = performance.now() - started;
  const r = report.response;
  const timing = report.payoff?.timing ?? null;
  const line: Record<string, unknown> = {
    gun: gun.shortName, id: gun.id, profile, label, ms, kind: r.objective_value === null ? 'none' : 'build',
    status: r.status, certificate: r.physical_certificate, reason: r.reason ?? null, score: r.objective_value,
    bounds: { lower: r.optimization.lower_bound, upper: r.optimization.upper_bound, gap: r.optimization.absolute_gap }, nodes: r.optimization.nodes,
    idealPoint: r.ideal_point ?? null,
    endpoints: report.payoff?.endpoints.map(e => ({ status: e.status, certificate: e.physical_certificate })) ?? null,
    endpointMs: timing?.endpointMs ?? null, tableMs: timing?.tableMs ?? null, finalMs: timing === null ? null : ms - timing.tableMs,
    buildSha: responseSha(r),
    stats: r.final_stats === undefined ? null : { ted: r.final_stats.true_ergo_delta, ergonomics: r.final_stats.ergonomics, spend: r.final_stats.total_price, weight: r.final_stats.total_weight },
    payoffConcurrent: payoffConcurrent ?? null,
    pool: poolSize, poolHeapBytes: (await nativePoolStats())?.maxHeapBytes ?? null, rssBytes: process.memoryUsage().rss,
  };
  if (warmOn && report.payoff !== null) {
    const cache = new EndpointCache();
    const admitted = cache.admit(gun.id, report.payoff, 1e-5);
    const cached = cache.lookup(gun.id, 1e-5);
    const warmStarted = performance.now();
    const warm = await solveRequest({ ...params, ...(cached === undefined ? {} : { idealPoint: cached }) });
    line.warm = {
      admitted, ms: performance.now() - warmStarted, status: warm.response.status, certificate: warm.response.physical_certificate,
      score: warm.response.objective_value, buildSha: responseSha(warm.response),
    };
  }
  return line;
}

/** The build's statistics the tolerance comparison reads (TED, ergonomics, recoil modifier sum, spend, weight). */
const pickStats = (stats: Record<string, unknown>): Record<string, unknown> => ({
  ted: stats.ted, ergonomics: stats.ergonomics, recoilModifierSum: stats.recoilModifierSum, spend: stats.spend, weight: stats.weight,
});

const wanted = only === '' ? null : new Set(only.split(','));
const guns = snapshot.guns.filter((g, i) => (wanted === null ? i % shards === shard : wanted.has(g.shortName) && i % shards === shard));
/** --jobs <file>: lines "<profile> <gun id>", run in that order (replaces --guns / --profiles / sharding; parallel-pool.md latency runs). */
const jobsFile = arg('jobs', '');
const jobs: { gun: { id: string; shortName: string }; profile: string }[] | null = jobsFile === '' ? null : readFileSync(jobsFile, 'utf8').split(String.fromCharCode(10))
  .map(line => line.trim()).filter(line => line !== '' && !line.startsWith('#')).map(line => {
    const [profile, id] = line.split(' ').filter(part => part !== '');
    const gun = snapshot.guns.find(g => g.id === id);
    if (gun === undefined) throw new Error(`--jobs: no gun ${id}`);
    return { gun, profile };
  });

// --warmup <shortName>: solve that gun once (plain, not recorded) first, so the WebAssembly load and the first JIT pass are not in a measured request.
const warmup = arg('warmup', '');
if (warmup !== '') {
  const gun = snapshot.guns.find(g => g.shortName === warmup);
  if (gun === undefined) throw new Error(`--warmup: no gun ${warmup}`);
  await solvePrecise({ params: request(gun.id, 'plain'), deadline: performance.now() + limitMs });
}

const plan = jobs ?? guns.flatMap(gun => profiles.map(profile => ({ gun, profile })));
let sizedGun: string | null = null;
let size: Record<string, number | boolean | null> = {};
for (const { gun, profile } of plan) {
  if (sizedGun !== gun.id) {
    sizedGun = gun.id;
    // size of the gun: the candidate slot edges Auto counts today (the recorded runs predate it and carry `autoEstimate`, the occurrence estimate
    // Auto used then) and the count model's dimensions on the default domain
    const blueprint = preparePhysicalWeapon(lookup, gun.id, { isAmmo });
    const domain = prepareSubproblemDomain(blueprint, lookup, {});
    const compat = buildCompatibilityMap(gun.id, lookup);
    size = {
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
  }
  if (isSweet(profile)) {
    const started = performance.now();
    let line: Record<string, unknown>;
    try {
      line = await sweetLine(gun, profile);
    } catch (error) {
      line = { gun: gun.shortName, id: gun.id, profile, label, ms: performance.now() - started, kind: 'error', error: String(error).slice(0, 400) };
    }
    appendFileSync(outFile, `${JSON.stringify(line)}
`);
    continue;
  }
  {
    const params = request(gun.id, profile);
    const started = performance.now();
    let line: Record<string, unknown>;
    const timing = timingOn ? emptyPreciseTiming() : undefined;
    try {
      const context = {
        params, deadline: performance.now() + limitMs, ...(edges === '' ? {} : { edgeIntegrality: edges }), ...(timing === undefined ? {} : { timing }),
        ...(splitShortcut === '' ? {} : { splitShortcut: splitShortcut === 'on' ? 'witness' : 'f1' }),
        ...(speculation === '' ? {} : { speculation }), ...(prefetchArg === '' ? {} : { prefetchNodes: Number(prefetchArg) }),
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
        // The returned build itself (base and every placement), hashed: the pool must return the same build, not only the same score.
        buildSha: r.best === undefined ? null : createHash('sha256').update(JSON.stringify((r.best as unknown as { build: unknown }).build)).digest('hex').slice(0, 16),
        ...(timing === undefined ? {} : { timing }),
        pool: poolSize, speculation: speculation || null, prefetch: prefetchArg === '' ? null : Number(prefetchArg),
        poolHeapBytes: (await nativePoolStats())?.maxHeapBytes ?? null, rssBytes: process.memoryUsage().rss,
      };
    } catch (error) {
      line = { gun: gun.shortName, id: gun.id, profile, label, ms: performance.now() - started, kind: 'error', error: String(error).slice(0, 400), size };
    }
    appendFileSync(outFile, `${JSON.stringify(line)}\n`);
  }
}
appendFileSync(outFile, `${JSON.stringify({ done: true, shard, label })}\n`);
await shutdownNativePool();
process.exit(0);
