// Stage 3 workstream 3.7 shard driver: runs this shard's jobs (frozen case x repetition) one after another, each in a FRESH node process
// (`bench.ts`, so the first request of a job is truly cold), and keeps a progress file.
//
//   npx tsx benchmarks/stage3-floor/driver.ts --out <dir> --shard <k> --of <n> [--only <case id,...>] [--cases cases.json]
//
// Jobs are numbered repetition-major (job = rep x cases + case index) and shard k takes the jobs with job % n == k. Each job writes
// <dir>/job-<case>-r<rep>.jsonl (one line per cache state) and <dir>/job-<case>-r<rep>.log. A job whose process dies or that leaves a cache state
// unwritten gets a `missing` line from the driver, so every planned request stays in the denominator. Progress: <dir>/progress-<k>.json.
import { appendFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const only = arg('only', '');
const casesFile = arg('cases', 'cases.json');

const frontend = fileURLToPath(new URL('../..', import.meta.url));
const benchPath = fileURLToPath(new URL('./bench.ts', import.meta.url));
const frozen = JSON.parse(readFileSync(fileURLToPath(new URL(`./${casesFile}`, import.meta.url)), 'utf8')) as {
  plan: { repetitions: number; cacheStates: string[] };
  cases: { id: string; group: string; weapon: string }[];
};
mkdirSync(outDir, { recursive: true });

const wanted = only === '' ? null : new Set(only.split(','));
const jobs: { caseId: string; group: string; weapon: string; rep: number }[] = [];
for (let rep = 1; rep <= frozen.plan.repetitions; rep++) {
  frozen.cases.forEach((c, i) => {
    const job = (rep - 1) * frozen.cases.length + i;
    if (job % shards === shard && (wanted === null || wanted.has(c.id))) jobs.push({ caseId: c.id, group: c.group, weapon: c.weapon, rep });
  });
}

const progressFile = join(outDir, `progress-${shard}.json`);
const startedAt = new Date().toISOString();
const progress = (done: number, current: string | null): void => writeFileSync(progressFile, `${JSON.stringify({
  shard, of: shards, total: jobs.length, done, current, startedAt, updatedAt: new Date().toISOString(),
}, null, 2)}\n`);

jobs.forEach((job, k) => {
  const stem = join(outDir, `job-${job.caseId}-r${job.rep}`);
  progress(k, `${job.caseId} r${job.rep}`);
  const out = `${stem}.jsonl`;
  if (existsSync(out)) throw new Error(`${out} exists: use a fresh results directory`);
  const logFd = openSync(`${stem}.log`, 'w');
  const started = Date.now();
  // The job runs under the same tsx loader as this driver (`process.execArgv`: tsx comes from the npx cache, not from node_modules).
  const r = spawnSync(process.execPath, [...process.execArgv, benchPath, '--case', job.caseId, '--rep', String(job.rep), '--out', out, '--cases', casesFile],
    { cwd: frontend, stdio: ['ignore', logFd, logFd], timeout: 10 * 60_000 });
  closeSync(logFd);
  const written = existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter(l => l.trim() !== '').map(l => (JSON.parse(l) as { cache: string }).cache) : [];
  for (const cache of frozen.plan.cacheStates) {
    if (!written.includes(cache)) {
      appendFileSync(out, `${JSON.stringify({
        case: job.caseId, group: job.group, weapon: job.weapon, rep: job.rep, cache, status: 'missing', exitCode: r.status, signal: r.signal,
        processMs: Date.now() - started, error: r.error === undefined ? null : String(r.error),
      })}\n`);
    }
  }
});
progress(jobs.length, null);
