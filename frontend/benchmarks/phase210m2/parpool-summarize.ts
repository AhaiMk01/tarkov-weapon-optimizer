// Tables of docs/stage3/parallel-pool.md from bench.ts lines.
//
//   npx tsx benchmarks/phase210m2/parpool-summarize.ts latency <dir> <label,label,...>      per-request seconds by label (median of repeats r1/r2)
//   npx tsx benchmarks/phase210m2/parpool-summarize.ts equal <dir> <labelA> <labelB>         answer equality of two runs (status, certificate, score,
//                                                                                           bounds, build hash, nodes, native solves, second opinions)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Line {
  gun: string; id: string; profile: string; label: string; ms: number; status?: string; certificate?: string; score?: number | null;
  bounds?: unknown; nodes?: number; buildSha?: string | null; kind: string; telemetry?: { nativeSolves: number; secondOpinions: number; pool?: unknown };
  error?: string; done?: boolean;
}

const [mode, dir, a, b] = process.argv.slice(2);
const load = (label: string): Line[] => readdirSync(dir).filter(f => f.startsWith(`${label}-`) && f.endsWith('.jsonl'))
  .flatMap(f => readFileSync(join(dir, f), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as Line)).filter(l => l.done !== true);
const key = (l: Line): string => `${l.profile} ${l.id}`;
const answerOf = (l: Line): string => JSON.stringify({
  kind: l.kind, status: l.status, certificate: l.certificate, score: l.score, bounds: l.bounds, build: l.buildSha, nodes: l.nodes,
  solves: l.telemetry?.nativeSolves, second: l.telemetry?.secondOpinions, error: l.error ?? null,
});
const median = (xs: number[]): number => { const s = [...xs].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

if (mode === 'equal') {
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
  const total = (ls: Map<string, Line>): number => [...ls.values()].reduce((s, l) => s + l.ms, 0) / 1000;
  console.log(`${left.size} requests in ${a}, ${right.size} in ${b}; identical answers: ${same}; differences: ${diffs.length}`);
  console.log(`total s: ${a} ${total(left).toFixed(1)}, ${b} ${total(right).toFixed(1)}`);
  for (const d of diffs) console.log(d);
} else if (mode === 'latency') {
  const labels = a.split(',');
  // label "p3" = median over r1p3, r2p3, ...
  const runs = new Map<string, Map<string, number[]>>();
  const answers = new Map<string, Set<string>>();
  const names = new Map<string, string>();
  const order: string[] = [];
  for (const label of labels) {
    const byKey = new Map<string, number[]>();
    runs.set(label, byKey);
    for (const repeat of readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => f.replace(/-\d+\.jsonl$/, '')).filter((v, i, all) => all.indexOf(v) === i && v.endsWith(label) && /^r\d+/.test(v))) {
      for (const l of load(repeat)) {
        const k = key(l);
        if (!names.has(k)) { names.set(k, `${l.gun} (${l.profile})`); order.push(k); }
        (byKey.get(k) ?? byKey.set(k, []).get(k) as number[]).push(l.ms / 1000);
        (answers.get(k) ?? answers.set(k, new Set()).get(k) as Set<string>).add(answerOf(l));
      }
    }
  }
  console.log(`| request | ${labels.join(' | ')} | ${labels.slice(1).map(l => `${l}/${labels[0]}`).join(' | ')} | answers |`);
  console.log(`| --- | ${labels.map(() => '---:').join(' | ')} | ${labels.slice(1).map(() => '---:').join(' | ')} | ---: |`);
  const totals = labels.map(() => 0);
  const groups = new Map<string, number[]>();
  for (const k of order) {
    const meds = labels.map(label => median(runs.get(label)?.get(k) ?? [Number.NaN]));
    meds.forEach((m, i) => { totals[i] += m; });
    const profile = k.split(' ')[0];
    const g = groups.get(profile) ?? groups.set(profile, labels.map(() => 0)).get(profile) as number[];
    meds.forEach((m, i) => { g[i] += m; });
    console.log(`| ${names.get(k)} | ${meds.map(m => m.toFixed(2)).join(' | ')} | ${meds.slice(1).map(m => (m / meds[0]).toFixed(2)).join(' | ')} | ${answers.get(k)?.size} |`);
  }
  for (const [profile, g] of groups) console.log(`| **${profile} total** | ${g.map(m => m.toFixed(1)).join(' | ')} | ${g.slice(1).map(m => (m / g[0]).toFixed(2)).join(' | ')} | |`);
  console.log(`| **all** | ${totals.map(m => m.toFixed(1)).join(' | ')} | ${totals.slice(1).map(m => (m / totals[0]).toFixed(2)).join(' | ')} | |`);
} else {
  throw new Error('mode: latency | equal');
}
