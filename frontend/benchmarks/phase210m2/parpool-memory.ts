// WebAssembly memory of the native solve pool (docs/stage3/parallel-pool.md): one fresh process per (pool size, gun), one TrueErgo request, then the
// peak wasm heap of every HiGHS instance that solved (pool lanes report theirs; size 1 reads the in-thread instance) and the process's resident set.
//
//   npx tsx benchmarks/phase210m2/parpool-memory.ts --pool <n> --gun <shortName> [--out <file.jsonl>]
import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildItemLookup } from '../../src/solver/dataService';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { getNativeHighs } from '../../src/solver/native';
import { configureNativePool, nativePoolStats, shutdownNativePool } from '../../src/solver/native/pool';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import type { SolveParams } from '../../src/solver/types';

const SNAPSHOT_SHA256 = '219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c';
const argv = process.argv.slice(2);
const arg = (name: string, fallback?: string): string => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
};
const size = Number(arg('pool'));
const gunName = arg('gun');
const out = arg('out', '');

const bytes = readFileSync(fileURLToPath(new URL('../snapshot.json', import.meta.url)));
if (createHash('sha256').update(bytes).digest('hex') !== SNAPSHOT_SHA256) throw new Error('the snapshot is not the pinned artifact');
const snapshot = JSON.parse(bytes.toString('utf8')) as { guns: { id: string; shortName: string }[]; mods: unknown[] };
const lookup = buildItemLookup(snapshot.guns as never, snapshot.mods as never);
const gun = snapshot.guns.find(g => g.shortName === gunName);
if (gun === undefined) throw new Error(`no gun ${gunName}`);
const isAmmo = (id: string): boolean => !Object.hasOwn(lookup, id);
const params: SolveParams = {
  weaponId: gun.id, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(gun.id, lookup), physicalOptions: { isAmmo },
  ergoWeight: 1, recoilWeight: 1, priceWeight: 0.1, fleaAvailable: true, barterAvailable: false, barterExcludeDogtags: true, playerLevel: 50,
  traderLevels: { prapor: 4, skier: 4, peacekeeper: 4, mechanic: 4, jaeger: 4, ref: 4 }, equipErgoModifier: 0, useTrueErgo: true,
};

configureNativePool({ size });
let peakRss = process.memoryUsage().rss;
const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 50);
const started = performance.now();
const result = await solvePrecise({ params, deadline: performance.now() + 60_000 });
const ms = performance.now() - started;
clearInterval(sampler);
peakRss = Math.max(peakRss, process.memoryUsage().rss);
const stats = await nativePoolStats();
const lanes = stats === null ? [(await getNativeHighs().acquire()).module.wasmMemory.buffer.byteLength] : stats.maxHeapBytes;
const line = {
  gun: gunName, pool: size, ms, status: result.outcome.status, certificate: result.outcome.physical_certificate,
  laneHeapBytes: lanes, totalHeapBytes: lanes.reduce((a, b) => a + b, 0), peakRssBytes: peakRss,
  respawns: stats === null ? 0 : stats.spawned - size,
};
console.log(JSON.stringify(line));
if (out !== '') appendFileSync(out, `${JSON.stringify(line)}\n`);
await shutdownNativePool();
process.exit(0);
