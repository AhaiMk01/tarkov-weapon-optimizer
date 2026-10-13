// Tables of docs/stage3/sweet-spot.md from bench.ts Sweet Spot lines (profiles sweetPlain, sweetTrueErgo).
//
//   npx tsx benchmarks/phase210m2/sweetspot-summarize.ts times <dir> <label>[,<label>...]   per profile: outcomes, total / median / p90 / max request s,
//                                                                                          summed endpoint, table and final-solve s
//   npx tsx benchmarks/phase210m2/sweetspot-summarize.ts equal <dir> <labelA> <labelB>     per request: status, certificate, score, bounds, ideal point,
//                                                                                          endpoint records and build hash must match
//   npx tsx benchmarks/phase210m2/sweetspot-summarize.ts slow <dir> <labelA> <labelB> [n]   the n slowest requests of A next to B
//   npx tsx benchmarks/phase210m2/sweetspot-summarize.ts warm <dir> <label>                 cold vs warm (endpoint cache hit) request s
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Line {
  gun: string; id: string; profile: string; label: string; ms: number; kind: string; status?: string; certificate?: string; reason?: string | null;
  score?: number | null; bounds?: unknown; nodes?: number; idealPoint?: unknown; endpoints?: unknown; endpointMs?: number[] | null;
  tableMs?: number | null; finalMs?: number | null; buildSha?: string | null; error?: string; done?: boolean;
  warm?: { ms: number; admitted: boolean; status: string; score: number | null; buildSha: string | null };
}

const [mode, dir, a, b, n] = process.argv.slice(2);
const load = (label: string): Line[] => readdirSync(dir).filter(f => f.startsWith(`${label}-`) && f.endsWith('.jsonl'))
  .flatMap(f => readFileSync(join(dir, f), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as Line)).filter(l => l.done !== true);
const key = (l: Line): string => `${l.profile} ${l.id}`;
const quantile = (xs: number[], q: number): number => {
  const s = [...xs].sort((x, y) => x - y);
  if (s.length === 0) return Number.NaN;
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
};
const sum = (xs: number[]): number => xs.reduce((x, y) => x + y, 0);
const s1 = (ms: number): string => (ms / 1000).toFixed(1);
const s2 = (ms: number): string => (ms / 1000).toFixed(2);
const answerOf = (l: Line): string => JSON.stringify({
  kind: l.kind, status: l.status, certificate: l.certificate, reason: l.reason ?? null, score: l.score, bounds: l.bounds, ideal: l.idealPoint,
  endpoints: l.endpoints, build: l.buildSha, error: l.error ?? null,
});

if (mode === 'times') {
  console.log('| run | profile | requests | optimal | infeasible | other | total s | median s | p90 s | max s | endpoint 1 s | endpoint 2 s | endpoint 3 s | table s | final s |');
  console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const label of a.split(',')) {
    const lines = load(label);
    for (const profile of [...new Set(lines.map(l => l.profile))].sort()) {
      const ls = lines.filter(l => l.profile === profile);
      const ms = ls.map(l => l.ms);
      const ep = (i: number): number => sum(ls.map(l => l.endpointMs?.[i] ?? 0));
      const optimal = ls.filter(l => l.status === 'optimal').length;
      const infeasible = ls.filter(l => l.status === 'infeasible').length;
      console.log(`| ${label} | ${profile} | ${ls.length} | ${optimal} | ${infeasible} | ${ls.length - optimal - infeasible} | ${s1(sum(ms))} | ${s2(quantile(ms, 0.5))} | ${s2(quantile(ms, 0.9))} | ${s2(Math.max(...ms))} | ${s1(ep(0))} | ${s1(ep(1))} | ${s1(ep(2))} | ${s1(sum(ls.map(l => l.tableMs ?? 0)))} | ${s1(sum(ls.map(l => l.finalMs ?? 0)))} |`);
    }
  }
} else if (mode === 'equal') {
  const left = new Map(load(a).map(l => [key(l), l]));
  const right = new Map(load(b).map(l => [key(l), l]));
  let same = 0;
  const diffs: string[] = [];
  for (const [k, l] of left) {
    const r = right.get(k);
    if (r === undefined) { diffs.push(`${k} (${l.gun}): missing in ${b}`); continue; }
    if (answerOf(l) === answerOf(r)) same++;
    else diffs.push(`${k} (${l.gun}):\n  ${a} ${answerOf(l)}\n  ${b} ${answerOf(r)}`);
  }
  for (const k of right.keys()) if (!left.has(k)) diffs.push(`${k}: missing in ${a}`);
  console.log(`${left.size} requests in ${a}, ${right.size} in ${b}; identical answers: ${same}; differences: ${diffs.length}`);
  for (const d of diffs) console.log(d);
} else if (mode === 'slow') {
  const left = load(a);
  const right = new Map(load(b).map(l => [key(l), l]));
  const top = [...left].sort((x, y) => y.ms - x.ms).slice(0, Number(n ?? 10));
  console.log(`| gun | profile | ${a} s (endpoints / final) | ${b} s (endpoints / final) |`);
  console.log('| --- | --- | --- | --- |');
  const cell = (l: Line | undefined): string => (l === undefined ? '-' : `${s2(l.ms)} (${(l.endpointMs ?? []).map(s2).join(' + ')} / ${s2(l.finalMs ?? 0)})`);
  for (const l of top) console.log(`| ${l.gun} | ${l.profile} | ${cell(l)} | ${cell(right.get(key(l)))} |`);
} else if (mode === 'warm') {
  console.log('| gun | profile | cold s | table s | warm s | same answer |');
  console.log('| --- | --- | ---: | ---: | ---: | --- |');
  for (const l of load(a)) {
    if (l.warm === undefined) continue;
    const same = l.warm.status === l.status && l.warm.score === l.score && l.warm.buildSha === l.buildSha;
    console.log(`| ${l.gun} | ${l.profile} | ${s2(l.ms)} | ${s2(l.tableMs ?? 0)} | ${s2(l.warm.ms)} | ${same ? 'yes' : 'NO'} |`);
  }
} else {
  throw new Error('mode: times | equal | slow | warm');
}
