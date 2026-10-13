// Tables of docs/stage3/ted-tolerance-and-overhead.md from the bench.ts lines of run-tedmeasure.sh (labels tol<value>) and of the overhead run.
//
//   npx tsx benchmarks/phase210m2/tedmeasure-summarize.ts <results dir> tolerance <baseline label> <label,label,...>
//   npx tsx benchmarks/phase210m2/tedmeasure-summarize.ts <results dir> overhead <label> [profile, default trueErgo] [guns, default: all]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Timing {
  specializeMs: number; specializeCalls: number; lpTextMs: number; nativeMs: number; nativeCalls: number;
  nativeReadMs: number; nativeRunMs: number; nativeMarshalMs: number; judgeMs: number;
}
interface Line {
  gun: string; id: string; profile: string; label: string; ms: number; kind: string; status?: string; certificate?: string; score?: number | null;
  nodes?: number; bounds?: { gap: number | null }; telemetry?: Record<string, number>; timing?: Timing;
  stats?: { ted: number; ergonomics: number; recoilModifierSum: number; spend: number; weight: number };
}

const [dir, mode, ...rest] = process.argv.slice(2);
const lines: Line[] = [];
for (const file of readdirSync(dir)) {
  if (!file.endsWith('.jsonl')) continue;
  for (const text of readFileSync(join(dir, file), 'utf8').split('\n')) {
    if (text.trim() === '') continue;
    const line = JSON.parse(text) as Line & { done?: boolean };
    if (line.done !== true) lines.push(line);
  }
}
const pick = (label: string, profile: string): Map<string, Line> => new Map(lines.filter(l => l.label === label && l.profile === profile).map(l => [l.id, l]));
const quantile = (values: number[], q: number): number => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const h = (sorted.length - 1) * q;
  const lo = Math.floor(h);
  return sorted[lo] + (h - lo) * ((sorted[Math.min(lo + 1, sorted.length - 1)] ?? sorted[lo]) - sorted[lo]);
};
const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);
const s = (ms: number): string => (ms / 1000).toFixed(1);
const t = (key: string) => (l: Line): number => l.telemetry?.[key] ?? 0;
const fmt = (x: number): string => (x === 0 ? '0' : Math.abs(x) >= 0.01 ? x.toFixed(4) : x.toExponential(1));

if (mode === 'tolerance') {
  const [baseline, labelList] = rest;
  const labels = labelList.split(',');
  const profiles = [...new Set(lines.map(l => l.profile))].filter(p => p.startsWith('trueErgo'));
  console.log('## Outcomes, time and work per tolerance\n');
  console.log('| profile | tolerance | runs | cert. optimal | cert. infeasible | feasible | incomplete | other | total s | median s | p90 s | max s | nodes | native solves | 2nd opinions | 3rd | 2nd-opinion s | split-only |');
  console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const profile of profiles) {
    for (const label of labels) {
      const runs = [...pick(label, profile).values()];
      if (runs.length === 0) continue;
      const n = (pred: (l: Line) => boolean): number => runs.filter(pred).length;
      const ms = runs.map(l => l.ms);
      const opt = n(l => l.certificate === 'certified_optimal');
      const inf = n(l => l.certificate === 'certified_infeasible');
      const fea = n(l => l.status === 'feasible');
      const inc = n(l => l.status === 'incomplete');
      console.log(`| ${profile} | ${label.replace(/^tol/, '')} | ${runs.length} | ${opt} | ${inf} | ${fea} | ${inc} | ${runs.length - opt - inf - fea - inc} | ${s(sum(ms))} | ${(quantile(ms, 0.5) / 1000).toFixed(2)} | ${s(quantile(ms, 0.9))} | ${s(Math.max(...ms))} | ${sum(runs.map(l => l.nodes ?? 0))} | ${sum(runs.map(t('nativeSolves')))} | ${sum(runs.map(t('secondOpinions')))} | ${sum(runs.map(t('thirdOpinions')))} | ${s(sum(runs.map(t('secondOpinionMs'))))} | ${sum(runs.map(t('splitOnlyNodes')))} |`);
    }
  }

  console.log('\n## Distance of each certified score from the default-tolerance score\n');
  console.log('Objective units (with the bench weights e 1, r 1, p 0.1 one unit is one TrueErgo point of the blend). d = score(default) - score(loose), over guns certified optimal in both.\n');
  console.log('| profile | tolerance | paired | same build stats | d > 0 | max d | p50 d (d > 0) | p90 d (all) | max |dTED| | max |dErgo| | max |dRecoil mod sum| | max |dSpend| | d <= tolerance + 1e-5 |');
  console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const profile of profiles) {
    const A = pick(baseline, profile);
    for (const label of labels) {
      if (label === baseline) continue;
      const B = pick(label, profile);
      const tol = Number(label.replace(/^tol/, ''));
      const paired = [...A.keys()].filter(g => B.has(g) && A.get(g)?.certificate === 'certified_optimal' && B.get(g)?.certificate === 'certified_optimal');
      const d = paired.map(g => ((A.get(g) as Line).score ?? 0) - ((B.get(g) as Line).score ?? 0));
      const st = (g: string) => [(A.get(g) as Line).stats, (B.get(g) as Line).stats] as const;
      const same = paired.filter(g => { const [a, b] = st(g); return JSON.stringify(a) === JSON.stringify(b); }).length;
      const maxAbs = (f: (x: NonNullable<Line['stats']>) => number): number => Math.max(0, ...paired.map(g => { const [a, b] = st(g); return a && b ? Math.abs(f(a) - f(b)) : 0; }));
      const pos = d.filter(x => x > 1e-12);
      const within = d.filter(x => x <= tol + 1e-5 + 1e-9).length;
      console.log(`| ${profile} | ${tol} | ${paired.length} | ${same} | ${pos.length} | ${fmt(Math.max(0, ...d))} | ${pos.length ? fmt(quantile(pos, 0.5)) : '-'} | ${fmt(quantile(d, 0.9))} | ${fmt(maxAbs(x => x.ted))} | ${fmt(maxAbs(x => x.ergonomics))} | ${fmt(maxAbs(x => x.recoilModifierSum))} | ${fmt(maxAbs(x => x.spend))} | ${within}/${paired.length} |`);
    }
  }

  console.log('\n## Guns whose score moved (d > 1e-9), largest first\n');
  for (const profile of profiles) {
    const A = pick(baseline, profile);
    for (const label of labels) {
      if (label === baseline) continue;
      const B = pick(label, profile);
      const moved = [...A.keys()].filter(g => B.has(g) && A.get(g)?.certificate === 'certified_optimal' && B.get(g)?.certificate === 'certified_optimal')
        .map(g => ({ a: A.get(g) as Line, b: B.get(g) as Line })).map(x => ({ ...x, d: (x.a.score ?? 0) - (x.b.score ?? 0) })).filter(x => Math.abs(x.d) > 1e-9)
        .sort((x, y) => y.d - x.d);
      const head = moved.slice(0, 8).map(x => `${x.a.gun} ${fmt(x.d)} (TED ${x.a.stats?.ted.toFixed(3)} -> ${x.b.stats?.ted.toFixed(3)}, ergo ${x.a.stats?.ergonomics} -> ${x.b.stats?.ergonomics})`);
      console.log(`- ${profile} ${label}: ${moved.length} moved${head.length ? `: ${head.join('; ')}` : ''}`);
    }
  }

  console.log('\n## Outcome changes against the baseline\n');
  for (const profile of profiles) {
    const A = pick(baseline, profile);
    for (const label of labels) {
      if (label === baseline) continue;
      const B = pick(label, profile);
      const changed = [...A.keys()].filter(g => B.has(g) && `${A.get(g)?.status}/${A.get(g)?.certificate}` !== `${B.get(g)?.status}/${B.get(g)?.certificate}`);
      console.log(`- ${profile} ${label}: ${changed.length === 0 ? 'none' : changed.map(g => `${A.get(g)?.gun} ${A.get(g)?.status}/${A.get(g)?.certificate} -> ${B.get(g)?.status}/${B.get(g)?.certificate}`).join('; ')}`);
    }
  }

  console.log('\n## 10 slowest guns per tolerance (seconds / nodes / native solves / second opinions)\n');
  for (const profile of profiles) {
    const A = pick(baseline, profile);
    const order = [...A.values()].sort((x, y) => y.ms - x.ms).slice(0, 10);
    console.log(`\n${profile} (ordered by the ${baseline} time)\n`);
    console.log(`| gun | ${labels.map(l => l.replace(/^tol/, '')).join(' | ')} |`);
    console.log(`| --- | ${labels.map(() => '---').join(' | ')} |`);
    for (const g of order) {
      const cells = labels.map(label => { const l = pick(label, profile).get(g.id); return l ? `${s(l.ms)} / ${l.nodes} / ${t('nativeSolves')(l)} / ${t('secondOpinions')(l)}` : '-'; });
      console.log(`| ${g.gun} | ${cells.join(' | ')} |`);
    }
    for (const label of labels) {
      const top = [...pick(label, profile).values()].sort((x, y) => y.ms - x.ms).slice(0, 10);
      console.log(`- slowest 10 at ${label}: ${top.map(l => `${l.gun} ${s(l.ms)}`).join(', ')}`);
    }
  }

  console.log('\n## Paired time ratios against the baseline (guns certified in both and >= 1 s at the baseline)\n');
  for (const profile of profiles) {
    const A = pick(baseline, profile);
    for (const label of labels) {
      if (label === baseline) continue;
      const B = pick(label, profile);
      const both = [...A.keys()].filter(g => B.has(g) && (A.get(g) as Line).ms >= 1000);
      const r = both.map(g => (B.get(g) as Line).ms / (A.get(g) as Line).ms);
      const nodesR = sum(both.map(g => (B.get(g) as Line).nodes ?? 0)) / sum(both.map(g => (A.get(g) as Line).nodes ?? 0));
      console.log(`- ${profile} ${label}: ${both.length} guns, time ratio median ${quantile(r, 0.5).toFixed(3)}, p10 ${quantile(r, 0.1).toFixed(3)}, p90 ${quantile(r, 0.9).toFixed(3)}; node ratio ${nodesR.toFixed(3)}`);
    }
  }
} else if (mode === 'overhead') {
  const [label, profile = 'trueErgo', gunList = ''] = rest;
  const wanted = gunList === '' ? null : new Set(gunList.split(','));
  const runs = [...pick(label, profile).values()].filter(l => l.timing !== undefined && (wanted === null || wanted.has(l.gun))).sort((a, b) => b.ms - a.ms);
  type Row = { gun: string; ms: number; parts: Record<string, number>; nodes: number; solves: number; specializeCalls: number; secondMs: number };
  const rows: Row[] = runs.map(l => {
    const tm = l.timing as Timing;
    const readback = t('readbackMs')(l);
    const parts: Record<string, number> = {
      specialize: tm.specializeMs, lpText: tm.lpTextMs, parse: tm.nativeReadMs, marshal: tm.nativeMarshalMs, run: tm.nativeRunMs, readback, judge: tm.judgeMs,
    };
    parts.other = l.ms - sum(Object.values(parts));
    return { gun: l.gun, ms: l.ms, parts, nodes: l.nodes ?? 0, solves: tm.nativeCalls, specializeCalls: tm.specializeCalls, secondMs: t('secondOpinionMs')(l) };
  });
  const keys = ['specialize', 'lpText', 'parse', 'marshal', 'run', 'readback', 'judge', 'other'];
  const pct = (x: number, of: number): string => `${((100 * x) / of).toFixed(1)}%`;
  /** Saving if one parsed model were kept per request and only bounds, objective, integrality and cut rows changed: no re-specialization after the
   *  first, no text, no re-parse and re-marshalling of the model (solutions are still read), one readback check per model kind (integer, relaxed). */
  const saving = (r: Row): number => {
    const p = r.parts;
    const perSpec = r.specializeCalls > 0 ? p.specialize / r.specializeCalls : 0;
    const perCheck = r.solves > 0 ? p.readback / r.solves : 0;
    return Math.max(0, p.specialize - perSpec) + p.lpText + p.parse + p.marshal + Math.max(0, p.readback - 2 * perCheck);
  };
  console.log(`## Per-request breakdown, ${profile}, label ${label} (ms; share of the request wall time)\n`);
  console.log(`| gun | wall s | nodes | solves | ${keys.join(' | ')} | 2nd-opinion share | est. reuse saving |`);
  console.log(`| --- | ---: | ---: | ---: | ${keys.map(() => '---:').join(' | ')} | ---: | ---: |`);
  for (const r of rows) {
    console.log(`| ${r.gun} | ${(r.ms / 1000).toFixed(2)} | ${r.nodes} | ${r.solves} | ${keys.map(k => `${r.parts[k].toFixed(0)} (${pct(r.parts[k], r.ms)})`).join(' | ')} | ${pct(r.secondMs, r.ms)} | ${pct(saving(r), r.ms)} |`);
  }
  const total = sum(rows.map(r => r.ms));
  console.log(`| **all ${rows.length}** | ${(total / 1000).toFixed(1)} | ${sum(rows.map(r => r.nodes))} | ${sum(rows.map(r => r.solves))} | ${keys.map(k => `${(sum(rows.map(r => r.parts[k])) / 1000).toFixed(1)} s (${pct(sum(rows.map(r => r.parts[k])), total)})`).join(' | ')} | ${pct(sum(rows.map(r => r.secondMs)), total)} | ${pct(sum(rows.map(saving)), total)} |`);
  const per = (k: string): string => `${(sum(rows.map(r => r.parts[k])) / Math.max(1, sum(rows.map(r => (k === 'specialize' ? r.specializeCalls : r.solves))))).toFixed(1)} ms`;
  console.log(`\nPer unit: specialize ${per('specialize')} per call, parse ${per('parse')}, marshal ${per('marshal')}, readback ${per('readback')}, judge ${per('judge')}, run ${per('run')} per solve.`);
  console.log(`Estimated reuse saving: ${(sum(rows.map(saving)) / 1000).toFixed(1)} s of ${(total / 1000).toFixed(1)} s (${pct(sum(rows.map(saving)), total)}); per gun median ${pct(quantile(rows.map(r => saving(r) / r.ms), 0.5), 1)}, range ${pct(Math.min(...rows.map(r => saving(r) / r.ms)), 1)} to ${pct(Math.max(...rows.map(r => saving(r) / r.ms)), 1)}.`);
} else {
  throw new Error('mode must be tolerance or overhead');
}
