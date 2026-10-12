// Tables of the Phase 2.10 milestone 2 measurement (bench.ts): status and certificate counts, wall time, second-opinion cost and disagreements, the guns whose
// outcome changed, and the size data for Auto's rule.
//
//   npx tsx benchmarks/phase210m2/summarize.ts <results dir> [labels, default before,after]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Line {
  gun: string;
  id: string;
  profile: string;
  label: string;
  ms: number;
  kind: string;
  status?: string;
  certificate?: string;
  reason?: string | null;
  score?: number | null;
  bounds?: { lower: number | null; upper: number | null; gap: number | null };
  nodes?: number;
  telemetry?: Record<string, number>;
  size: { occurrences: number; autoEstimate?: number; candidateEdges?: number; templates: number; emptyDomain: boolean; countColumns: number | null; countRows: number | null; countEdges: number | null; countIntegers: number | null };
}

const dir = process.argv[2];
const labels = (process.argv[3] ?? 'before,after').split(',');
const lines: Line[] = [];
for (const file of readdirSync(dir)) {
  if (!file.endsWith('.jsonl')) continue;
  for (const text of readFileSync(join(dir, file), 'utf8').split('\n')) {
    if (text.trim() === '') continue;
    const line = JSON.parse(text) as Line & { done?: boolean };
    if (line.done !== true && labels.includes(line.label)) lines.push(line);
  }
}
const pick = (label: string, profile: string): Map<string, Line> => new Map(lines.filter(l => l.label === label && l.profile === profile).map(l => [l.id, l]));
const quantile = (values: number[], q: number): number => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const h = (sorted.length - 1) * q; // Hyndman-Fan type 7
  const lo = Math.floor(h);
  return sorted[lo] + (h - lo) * ((sorted[Math.min(lo + 1, sorted.length - 1)] ?? sorted[lo]) - sorted[lo]);
};
const s = (ms: number): string => (ms / 1000).toFixed(2);
const outcomeOf = (l: Line): string => (l.kind === 'error' ? 'error' : `${l.status}/${l.certificate}`);
const profiles = [...new Set(lines.map(l => l.profile))];

console.log('## Outcomes and wall time (seconds)\n');
console.log('| label | profile | runs | certified optimal | certified infeasible | feasible | incomplete | other | total s | median | p90 | max |');
console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const label of labels) {
  for (const profile of profiles) {
    const runs = [...pick(label, profile).values()];
    if (runs.length === 0) continue;
    const n = (pred: (l: Line) => boolean): number => runs.filter(pred).length;
    const ms = runs.map(l => l.ms);
    const opt = n(l => l.certificate === 'certified_optimal');
    const inf = n(l => l.certificate === 'certified_infeasible');
    const fea = n(l => l.status === 'feasible');
    const inc = n(l => l.status === 'incomplete');
    console.log(`| ${label} | ${profile} | ${runs.length} | ${opt} | ${inf} | ${fea} | ${inc} | ${runs.length - opt - inf - fea - inc} | ${s(ms.reduce((a, b) => a + b, 0))} | ${s(quantile(ms, 0.5))} | ${s(quantile(ms, 0.9))} | ${s(Math.max(...ms))} |`);
  }
}

if (labels.length >= 2) {
  const [a, b] = labels;
  console.log(`\n## ${a} vs ${b}, per gun\n`);
  for (const profile of profiles) {
    const A = pick(a, profile);
    const B = pick(b, profile);
    const both = [...A.keys()].filter(g => B.has(g));
    const certifiedBoth = both.filter(g => A.get(g)?.certificate === 'certified_optimal' && B.get(g)?.certificate === 'certified_optimal');
    const ratios = certifiedBoth.map(g => (B.get(g) as Line).ms / (A.get(g) as Line).ms);
    const scoreDiff = Math.max(0, ...certifiedBoth.map(g => Math.abs(((B.get(g) as Line).score ?? 0) - ((A.get(g) as Line).score ?? 0)) / Math.max(1, Math.abs((A.get(g) as Line).score ?? 0))));
    console.log(`- ${profile}: ${certifiedBoth.length} guns certified optimal in both; time ratio ${b}/${a} median ${quantile(ratios, 0.5).toFixed(3)}, p10 ${quantile(ratios, 0.1).toFixed(3)}, p90 ${quantile(ratios, 0.9).toFixed(3)}; largest relative score difference ${scoreDiff.toExponential(2)}`);
    const changed = both.filter(g => outcomeOf(A.get(g) as Line) !== outcomeOf(B.get(g) as Line));
    for (const g of changed.sort()) {
      const x = A.get(g) as Line;
      const y = B.get(g) as Line;
      console.log(`  - ${x.gun}: ${outcomeOf(x)} ${s(x.ms)} s -> ${outcomeOf(y)} ${s(y.ms)} s${y.reason ? ` (${y.reason})` : ''}; gap ${x.bounds?.gap ?? 'null'} -> ${y.bounds?.gap ?? 'null'}`);
    }
  }
}

for (const label of labels) {
  const runs = lines.filter(l => l.label === label && l.telemetry?.secondOpinions !== undefined);
  if (runs.length === 0) continue;
  console.log(`\n## Second opinion (${label})\n`);
  console.log('| profile | runs | native solves | second solves | third solves | disagreements | unsettled | second-opinion s | share of wall time | runs with a disagreement |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const profile of profiles) {
    const rs = runs.filter(l => l.profile === profile);
    const sum = (k: string): number => rs.reduce((acc, l) => acc + (l.telemetry?.[k] ?? 0), 0);
    const wall = rs.reduce((acc, l) => acc + l.ms, 0);
    const disagreeing = rs.filter(l => (l.telemetry?.disagreements ?? 0) > 0).map(l => `${l.gun} (${l.telemetry?.disagreements})`).join(', ') || 'none';
    console.log(`| ${profile} | ${rs.length} | ${sum('nativeSolves')} | ${sum('secondOpinions')} | ${sum('thirdOpinions')} | ${sum('disagreements')} | ${sum('unsettledDisagreements')} | ${s(sum('secondOpinionMs'))} | ${(100 * sum('secondOpinionMs') / wall).toFixed(1)}% | ${disagreeing} |`);
  }
}

// Size data for Auto: per gun, the occurrences Auto counts today, the count model's integer columns, and the wall time and outcome of the last label.
const last = labels[labels.length - 1];
console.log(`\n## Size versus Precise cost (${last})\n`);
console.log('| gun | occurrences | count columns | count integer columns | count edges | plain s | plain | trueErgo s | trueErgo |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |');
const plain = pick(last, 'plain');
const ted = pick(last, 'trueErgo');
const rows = [...plain.values()].filter(l => !l.size.emptyDomain).sort((x, y) => (y.size.countIntegers ?? 0) - (x.size.countIntegers ?? 0));
for (const l of rows.slice(0, 40)) {
  const t = ted.get(l.id);
  console.log(`| ${l.gun} | ${l.size.occurrences} | ${l.size.countColumns} | ${l.size.countIntegers} | ${l.size.countEdges} | ${s(l.ms)} | ${outcomeOf(l)} | ${t ? s(t.ms) : '-'} | ${t ? outcomeOf(t) : '-'} |`);
}
console.log(`\n(${rows.length} nonempty guns; the 40 with the most integer columns are listed)`);
for (const [name, size] of [['occurrences', (l: Line) => l.size.occurrences], ['count integer columns', (l: Line) => l.size.countIntegers ?? 0]] as const) {
  for (const profile of profiles) {
    const runs = [...pick(last, profile).values()].filter(l => !l.size.emptyDomain);
    const uncertified = runs.filter(l => l.certificate !== 'certified_optimal' && l.certificate !== 'certified_infeasible');
    const largestCertified = Math.max(0, ...runs.filter(l => l.certificate === 'certified_optimal' || l.certificate === 'certified_infeasible').map(size));
    const smallestUncertified = Math.min(Infinity, ...uncertified.map(size));
    console.log(`- ${profile}, by ${name}: largest certified ${largestCertified}, smallest uncertified ${smallestUncertified} (${uncertified.length} uncertified)`);
  }
}
