// Tables of the Stage 3 workstream 3.4 measurement (bench.ts): Fast outcomes and contract checks per profile, timing, and agreement with the certified
// Precise optimum of the same request.
//
//   npx tsx benchmarks/stage3-fast/summarize.ts <results dir>
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Line {
  gun: string;
  id: string;
  profile: string;
  ms: number;
  status: string;
  certificate?: string;
  reason?: string | null;
  termination?: string | null;
  nodes?: number | null;
  objective?: number | null;
  tolerance?: number | null;
  build?: boolean;
  repeatedPart?: boolean;
  buildKey?: string | null;
  validatorOk?: boolean | null;
  violations?: string[];
  error?: string;
}

const dir = process.argv[2];
const lines: Line[] = [];
const shas = new Set<string>();
let shardsDone = 0;
for (const file of readdirSync(dir)) {
  if (!file.endsWith('.jsonl')) continue;
  for (const text of readFileSync(join(dir, file), 'utf8').split('\n')) {
    if (text.trim() === '') continue;
    const line = JSON.parse(text) as Line & { done?: boolean; snapshotSha256?: string };
    if (line.done === true) {
      shardsDone++;
      if (line.snapshotSha256) shas.add(line.snapshotSha256);
    } else lines.push(line);
  }
}
const quantile = (values: number[], q: number): number => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const h = (sorted.length - 1) * q;
  const lo = Math.floor(h);
  return sorted[lo] + (h - lo) * ((sorted[Math.min(lo + 1, sorted.length - 1)] ?? sorted[lo]) - sorted[lo]);
};
const s = (ms: number): string => (ms / 1000).toFixed(2);
const byProfile = (profile: string): Map<string, Line> => new Map(lines.filter(l => l.profile === profile).map(l => [l.id, l]));
const FAST = ['fast-plain-single', 'fast-plain-repeats', 'fast-ted-single', 'fast-ted-repeats'];
const PRECISE = ['precise-plain', 'precise-ted'];

console.log(`Shards completed: ${shardsDone}; snapshot SHA-256: ${[...shas].join(', ')}; guns: ${new Set(lines.map(l => l.id)).size}\n`);

console.log('## Outcomes, contract checks and wall time (seconds)\n');
console.log('| profile | runs | optimal / approximate_optimal | feasible | incomplete | certified (any) | error | build published | validator rejects | contract violations | total s | median | p90 | max |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const profile of [...FAST, ...PRECISE]) {
  const runs = [...byProfile(profile).values()];
  if (runs.length === 0) continue;
  const n = (pred: (l: Line) => boolean): number => runs.filter(pred).length;
  const ms = runs.map(l => l.ms);
  const fast = profile.startsWith('fast');
  console.log(`| ${profile} | ${runs.length} | ${n(l => l.status === 'optimal' && l.certificate === 'approximate_optimal')} | ${n(l => l.status === 'feasible')} | ${n(l => l.status === 'incomplete')} | `
    + `${n(l => l.certificate === 'certified_optimal' || l.certificate === 'certified_infeasible')} | ${n(l => l.status === 'error')} | ${n(l => l.build === true)} | `
    + `${fast ? n(l => l.build === true && l.validatorOk !== true) : '-'} | ${fast ? n(l => (l.violations ?? []).length > 0) : '-'} | `
    + `${s(ms.reduce((a, b) => a + b, 0))} | ${s(quantile(ms, 0.5))} | ${s(quantile(ms, 0.9))} | ${s(Math.max(...ms))} |`);
}

console.log('\n## Fast reasons (status / certificate (reason))\n');
for (const profile of FAST) {
  const tally = new Map<string, number>();
  for (const l of byProfile(profile).values()) {
    const key = `${l.status}/${l.certificate ?? '-'}${l.reason ? ` (${l.reason})` : ''}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  console.log(`- ${profile}: ${[...tally].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('; ')}`);
}

console.log('\n## Agreement with the certified Precise optimum\n');
console.log('Equal = both publish a build and the scores differ by at most the request tolerance (1e-5). Precise always allows repeats; a single-copy profile solves a restricted model.\n');
console.log('| Fast profile | against | guns | equal score | of which same build | Fast below | Fast above (anomaly) | both empty (Precise certified infeasible, Fast incomplete) | Fast build, Precise infeasible (BUG) | Precise optimum, Fast no build | Precise not certified |');
console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
const details: string[] = [];
for (const [fastProfile, preciseProfile] of [['fast-plain-repeats', 'precise-plain'], ['fast-plain-single', 'precise-plain'], ['fast-ted-repeats', 'precise-ted'], ['fast-ted-single', 'precise-ted']] as const) {
  const fast = byProfile(fastProfile);
  const precise = byProfile(preciseProfile);
  if (precise.size === 0) continue;
  let equal = 0, same = 0, below = 0, above = 0, bothEmpty = 0, bug = 0, missing = 0, uncertified = 0, guns = 0;
  for (const [id, f] of fast) {
    const p = precise.get(id);
    if (!p) continue;
    guns++;
    const tol = p.tolerance ?? 1e-5;
    if (p.certificate === 'certified_infeasible') {
      if (f.build) { bug++; details.push(`- **BUG** ${f.gun} ${fastProfile}: Fast published a build, Precise certified infeasible`); } else bothEmpty++;
      continue;
    }
    if (p.certificate !== 'certified_optimal') { uncertified++; details.push(`- ${f.gun} ${preciseProfile}: Precise ${p.status}/${p.certificate} (${p.reason ?? ''})`); continue; }
    if (!f.build) { missing++; details.push(`- ${f.gun} ${fastProfile}: no build (${f.status}, ${f.reason ?? ''}); Precise optimum ${p.objective}`); continue; }
    const d = (f.objective as number) - (p.objective as number);
    if (Math.abs(d) <= tol) {
      equal++;
      if (f.buildKey === p.buildKey) same++;
    } else if (d < 0) {
      below++;
      details.push(`- ${f.gun} ${fastProfile}: Fast ${f.objective} below Precise ${p.objective} (by ${(-d).toPrecision(4)}; Precise optimum ${p.repeatedPart ? 'repeats a part' : 'repeats no part'}; Fast ${f.status}${f.reason ? `, ${f.reason}` : ''})`);
    } else {
      above++;
      details.push(`- **ANOMALY** ${f.gun} ${fastProfile}: Fast ${f.objective} above the certified Precise ${p.objective} (by ${d.toPrecision(4)})`);
    }
  }
  console.log(`| ${fastProfile} | ${preciseProfile} | ${guns} | ${equal} | ${same} | ${below} | ${above} | ${bothEmpty} | ${bug} | ${missing} | ${uncertified} |`);
}
console.log('\n### Every difference\n');
console.log(details.length ? details.join('\n') : 'none');

const violations = lines.filter(l => (l.violations ?? []).length > 0 || l.status === 'error');
console.log('\n## Contract violations and errors\n');
console.log(violations.length ? violations.map(l => `- ${l.gun} ${l.profile}: ${l.error ?? (l.violations ?? []).join(' | ')}`).join('\n') : 'none');

console.log('\n## Slowest Fast requests\n');
const slow = lines.filter(l => l.profile.startsWith('fast')).sort((a, b) => b.ms - a.ms).slice(0, 10);
console.log(slow.map(l => `- ${l.gun} ${l.profile}: ${s(l.ms)} s (${l.status}${l.reason ? `, ${l.reason}` : ''}, nodes ${l.nodes ?? '-'})`).join('\n'));
