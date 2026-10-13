// Tables of the Stage 3 workstream 3.7 MOA floor measurement (bench.ts, driver.ts): status rates over the planned denominator, latency, trials,
// stop causes, brackets, every seed / discovery / bisection query with its native calls and stop codes, native option checks and witness validation.
//
//   npx tsx benchmarks/stage3-floor/summarize.ts <results dir> [cases file, default cases.json] > benchmarks/stage3-floor/summary.md
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface TraceEntry { step: string; trial: number | null; cap: number | null; result: string; achieved_moa?: number; nativeStop?: string; reason?: string; elapsed_ms: number }
interface NativeCall {
  query: number; startMs: number; wallMs: number; status?: string; statusCode?: number; primal?: string; objective?: number | null; nodes?: number | null;
  cols?: number; rows?: number; integers?: number; effective?: Record<string, unknown>; requested?: Record<string, unknown>; costNonzeros?: number | null;
  costColumns?: string[]; objectiveOffset?: number | null; error?: string;
}
interface QueryRecord {
  index: number; cap: number | null; startMs: number; wallMs: number; launched: boolean;
  precise?: { kind: string; status?: string; termination?: string; reason?: string; nodes?: number; spatial?: boolean; completed?: boolean };
  telemetry?: Record<string, number>;
  floor: { kind: string; qualified?: boolean; reason?: string; achievedMoa?: number; nativeStop?: string };
  validation?: { ok: boolean; violations: string[]; moaExactMatches: boolean; withinCap: boolean | null; moa: number | null; ted: number | null; weight: number | null };
  nativeCalls: number;
}
interface Line {
  case: string; group: string; weapon: string; rep: number; cache: 'cold' | 'warm'; status: string; gitTip?: string; casesSha256?: string;
  endToEndMs?: number; deadlineOvershootMs?: number; messageType?: string; snapshots?: number; error?: string; exitCode?: number | null;
  response?: { status: string; floor: number | null; display_floor: number | null; proved_lower_bound: number | null; reason?: string; solve_time_ms: number; witness?: { max_moa: number | null } };
  responseWitnessValidation?: { ok: boolean; violations: string[]; moa: number | null; floorEnclosesMoa: boolean; displayAtLeastFloor: boolean | null };
  trials?: number; ended?: string; trace?: TraceEntry[]; bracketGap?: number | null; queries?: QueryRecord[]; nativeCalls?: NativeCall[];
  highs?: { version: string; githash: string } | null; dataLoadMs?: number;
}

const dir = process.argv[2];
const casesFile = process.argv[3] ?? 'cases.json';
const frozen = JSON.parse(readFileSync(fileURLToPath(new URL(`./${casesFile}`, import.meta.url)), 'utf8')) as {
  frozenAt: string;
  identities: { snapshot: { sha256: string }; highs: { manifestSha256: string; version: string; commit: string; artifacts: Record<string, { sha256: string }> };
    toolchain: { node: string; tsx: string; platform: string }; source: { gitTip: string; srcTree: string } };
  plan: { repetitions: number; cacheStates: string[]; plannedRequests: number; shards: number };
  cases: { id: string; group: string; weapon: string; intent: string; request: Record<string, unknown> }[];
};

const lines: Line[] = [];
for (const file of readdirSync(dir).sort()) {
  if (!file.startsWith('job-') || !file.endsWith('.jsonl')) continue;
  for (const text of readFileSync(join(dir, file), 'utf8').split('\n')) if (text.trim() !== '') lines.push(JSON.parse(text) as Line);
}

const GROUPS = [...new Set(frozen.cases.map(c => c.group))];
const STATUSES = ['model_proved', 'model_witnessed', 'unresolved', 'model_infeasible', 'error', 'missing'];
const fmt = (x: number | null | undefined, d = 0): string => (x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(d));
const moa = (x: number | null | undefined): string => (x === null || x === undefined ? '—' : x.toFixed(4));
const pct = (n: number, d: number): string => (d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}%`);
const quantile = (xs: number[], q: number): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const h = (s.length - 1) * q; // type 7
  const lo = Math.floor(h);
  return s[lo] + (h - lo) * ((s[Math.min(lo + 1, s.length - 1)]) - s[lo]);
};
const out: string[] = [];
const p = (s = ''): void => { out.push(s); };
const table = (head: string[], rows: (string | number)[][]): void => {
  p(`| ${head.join(' | ')} |`);
  p(`|${head.map(() => '---').join('|')}|`);
  for (const r of rows) p(`| ${r.join(' | ')} |`);
  p();
};
const stepOf = (l: Line, q: number): string => l.trace?.[q]?.step ?? (q === 0 ? 'seed' : '?');
const seedMs = (l: Line): number | null => l.queries?.[0]?.wallMs ?? null;

// ---------------------------------------------------------------------------------------------
p('# Stage 3 workstream 3.7: MOA floor measurement (summary tables)');
p();
p('Generated by `benchmarks/stage3-floor/summarize.ts` from the raw results (git-ignored, `benchmarks/stage3-floor/results/`). Method, identities and');
p('discussion: `docs/stage3/floor-measurement.md`. All times are milliseconds of wall clock; MOA values are the provisional model\'s.');
p();
p('## Frozen identities');
p();
const tips = [...new Set(lines.map(l => l.gitTip).filter(Boolean))];
const highs = [...new Set(lines.map(l => (l.highs ? `${l.highs.version} (${l.highs.githash})` : null)).filter(Boolean))];
const caseHashes = [...new Set(lines.map(l => l.casesSha256).filter(Boolean))];
table(['identity', 'value'], [
  ['cases frozen at', frozen.frozenAt],
  [`${casesFile} SHA-256 seen by every job`, caseHashes.join(', ') || '—'],
  ['snapshot SHA-256', frozen.identities.snapshot.sha256],
  ['HiGHS manifest SHA-256', frozen.identities.highs.manifestSha256],
  ['HiGHS declared / reported by every native call', `${frozen.identities.highs.version} ${frozen.identities.highs.commit} / ${highs.join(', ') || '—'}`],
  ['highs.wasm / highs.js SHA-256', `${frozen.identities.highs.artifacts['highs.wasm'].sha256} / ${frozen.identities.highs.artifacts['highs.js'].sha256}`],
  ['node / tsx / platform', `${frozen.identities.toolchain.node} / ${frozen.identities.toolchain.tsx} / ${frozen.identities.toolchain.platform}`],
  ['frontend/src tree (frozen, checked by every job)', frozen.identities.source.srcTree],
  ['git tip at freeze / during the jobs', `${frozen.identities.source.gitTip} / ${tips.join(', ')}`],
  ['plan', `${frozen.cases.length} cases x ${frozen.plan.repetitions} repetitions x ${frozen.plan.cacheStates.join('+')} = ${frozen.plan.plannedRequests} planned requests, ${frozen.plan.shards} shards`],
]);

// ---------------------------------------------------------------------------------------------
p('## Status rates (planned denominator)');
p();
const planned = frozen.plan.plannedRequests;
const count = (ls: Line[], s: string): number => ls.filter(l => l.status === s).length;
p(`Planned requests: ${planned}; result lines found: ${lines.length}. A planned request without a line would count as missing.`);
p();
const groups: [string, (l: Line) => boolean, number][] = [
  ['all', () => true, planned],
  ...GROUPS.map(g => [g, (l: Line) => l.group === g, frozen.cases.filter(c => c.group === g).length * frozen.plan.repetitions * 2] as [string, (l: Line) => boolean, number]),
  ['cold', (l: Line) => l.cache === 'cold', planned / 2],
  ['warm', (l: Line) => l.cache === 'warm', planned / 2],
];
table(['subset', 'planned', ...STATUSES], groups.map(([name, f, d]) => {
  const ls = lines.filter(f);
  const missing = d - ls.length + count(ls, 'missing');
  return [name, d, ...STATUSES.map(s => (s === 'missing' ? `${missing} (${pct(missing, d)})` : `${count(ls, s)} (${pct(count(ls, s), d)})`))];
}));

// ---------------------------------------------------------------------------------------------
p('## Per case (6 runs each: 3 repetitions x cold/warm)');
p();
table(['case', 'statuses', 'stop causes (ended)', 'trials min/med/max', 'e2e ms med (max)', 'seed ms med (max)', 'achieved hi', 'proved lo', 'bracket gap', 'native calls med', 'rejected cand.', 'witness validation'],
  frozen.cases.map(c => {
    const ls = lines.filter(l => l.case === c.id);
    const tally = (xs: string[]): string => [...new Set(xs)].map(x => `${x} ${xs.filter(y => y === x).length}`).join(', ');
    const trials = ls.map(l => l.trials).filter((x): x is number => typeof x === 'number');
    const e2e = ls.map(l => l.endToEndMs).filter((x): x is number => typeof x === 'number');
    const seeds = ls.map(seedMs).filter((x): x is number => x !== null);
    const his = [...new Set(ls.map(l => moa(l.response?.floor)))];
    const los = [...new Set(ls.map(l => moa(l.response?.proved_lower_bound)))];
    const gaps = ls.map(l => l.bracketGap).filter((x): x is number => typeof x === 'number');
    const calls = ls.map(l => l.nativeCalls?.length ?? 0);
    const rejected = ls.reduce((s, l) => s + (l.queries ?? []).reduce((t, q) => t + (q.telemetry?.rejectedCandidates ?? 0), 0), 0);
    const witnesses = ls.flatMap(l => (l.queries ?? []).filter(q => q.validation !== undefined));
    const vOk = witnesses.filter(q => q.validation?.ok === true && q.validation.moaExactMatches && q.validation.withinCap !== false).length;
    return [c.id, tally(ls.map(l => l.status)), tally(ls.map(l => l.ended ?? '—')), `${fmt(Math.min(...trials))}/${fmt(quantile(trials, 0.5))}/${fmt(Math.max(...trials))}`,
      `${fmt(quantile(e2e, 0.5))} (${fmt(Math.max(...e2e))})`, `${fmt(quantile(seeds, 0.5))} (${fmt(Math.max(...seeds))})`, his.join(', '), los.join(', '),
      gaps.length === 0 ? '—' : `${fmt(Math.min(...gaps), 4)}..${fmt(Math.max(...gaps), 4)}`, fmt(quantile(calls, 0.5)), rejected, `${vOk}/${witnesses.length}`];
  }));

// ---------------------------------------------------------------------------------------------
p('## Latency distribution (end to end: deadline stamp to result message)');
p();
const dist = (name: string, ls: Line[]): (string | number)[] => {
  const xs = ls.map(l => l.endToEndMs).filter((x): x is number => typeof x === 'number');
  const over = ls.map(l => l.deadlineOvershootMs).filter((x): x is number => typeof x === 'number');
  return [name, xs.length, fmt(Math.min(...xs)), fmt(quantile(xs, 0.5)), fmt(quantile(xs, 0.9)), fmt(quantile(xs, 0.95)), fmt(Math.max(...xs)),
    xs.filter(x => x >= 29_000).length, fmt(Math.max(...over))];
};
table(['subset', 'n', 'min', 'p50', 'p90', 'p95', 'max', 'n >= 29 s', 'max overshoot past deadline'],
  [dist('all', lines), ...GROUPS.map(g => dist(g, lines.filter(l => l.group === g))),
    dist('cold', lines.filter(l => l.cache === 'cold')), dist('warm', lines.filter(l => l.cache === 'warm'))]);

// ---------------------------------------------------------------------------------------------
p('## Every request');
p();
p('`gap` is the justified bracket hi - lo (only when a qualified emptiness proved lo). `calls` counts native solves; `stop codes` tallies their HiGHS model statuses.');
p();
table(['case', 'rep', 'cache', 'status', 'ended', 'reason', 'trials', 'e2e ms', 'overshoot', 'seed ms', 'hi', 'lo', 'gap', 'display', 'calls', 'stop codes', 'rejected', 'resp. witness valid'],
  lines.map(l => {
    const codes = (l.nativeCalls ?? []).map(c => c.status ?? `error`);
    const tally = [...new Set(codes)].map(x => `${x} ${codes.filter(y => y === x).length}`).join(', ');
    const rejected = (l.queries ?? []).reduce((t, q) => t + (q.telemetry?.rejectedCandidates ?? 0), 0);
    const v = l.responseWitnessValidation;
    return [l.case, l.rep, l.cache, l.status, l.ended ?? '—', l.response?.reason ?? (l.error ? l.error.slice(0, 80) : '—'), l.trials ?? '—', fmt(l.endToEndMs),
      fmt(l.deadlineOvershootMs), fmt(seedMs(l)), moa(l.response?.floor), moa(l.response?.proved_lower_bound), l.bracketGap == null ? '—' : l.bracketGap.toFixed(4),
      l.response?.display_floor ?? '—', l.nativeCalls?.length ?? '—', tally || '—', rejected, v === undefined ? '—' : v.ok && v.floorEnclosesMoa && v.displayAtLeastFloor !== false ? 'ok' : 'FAIL'];
  }));

// ---------------------------------------------------------------------------------------------
p('## Queries by step (all requests)');
p();
p('One row per (step, floor result). Wall time is the whole query (blueprint, model building, every native call, decoding, validation).');
p();
{
  const rows = new Map<string, { n: number; ms: number[]; calls: number[]; rejected: number }>();
  for (const l of lines) for (const q of l.queries ?? []) {
    const key = `${stepOf(l, q.index)} / ${q.floor.kind}${q.floor.kind === 'empty' ? (q.floor.qualified ? ' (qualified)' : ' (UNQUALIFIED)') : ''}${q.floor.kind === 'stopped' ? ` (${q.floor.reason})` : ''}`;
    const r = rows.get(key) ?? { n: 0, ms: [], calls: [], rejected: 0 };
    r.n++; r.ms.push(q.wallMs); r.calls.push(q.nativeCalls); r.rejected += q.telemetry?.rejectedCandidates ?? 0;
    rows.set(key, r);
  }
  table(['step / result', 'queries', 'ms p50', 'ms p90', 'ms max', 'native calls p50 (max)', 'rejected candidates'],
    [...rows.entries()].sort().map(([k, r]) => [k, r.n, fmt(quantile(r.ms, 0.5)), fmt(quantile(r.ms, 0.9)), fmt(Math.max(...r.ms)), `${fmt(quantile(r.calls, 0.5))} (${Math.max(...r.calls)})`, r.rejected]));
}

// ---------------------------------------------------------------------------------------------
p('## Native calls: stop codes, options in effect, objective');
p();
{
  const calls = lines.flatMap(l => (l.nativeCalls ?? []).map(c => ({ ...c, step: stepOf(l, c.query), line: l })));
  const byCode = new Map<string, number[]>();
  for (const c of calls) {
    const key = `${c.step} / ${c.status ?? 'thrown'}`;
    byCode.set(key, [...(byCode.get(key) ?? []), c.wallMs]);
  }
  table(['step / HiGHS model status', 'calls', 'ms p50', 'ms p90', 'ms max', 'ms total'],
    [...byCode.entries()].sort().map(([k, ms]) => [k, ms.length, fmt(quantile(ms, 0.5), 1), fmt(quantile(ms, 0.9), 1), fmt(Math.max(...ms), 1), fmt(ms.reduce((a, b) => a + b, 0))]));
  const eff = (c: NativeCall, k: string): unknown => c.effective?.[k];
  const stopOk = calls.filter(c => eff(c, 'mip_max_improving_sols') === 1).length;
  const presolveOff = calls.filter(c => eff(c, 'presolve') === 'off').length;
  const tl = calls.map(c => eff(c, 'time_limit')).filter((x): x is number => typeof x === 'number');
  const tlOk = calls.filter(c => {
    const t = eff(c, 'time_limit');
    return typeof t === 'number' && t > 0 && t * 1000 <= 30_000 - c.startMs + 1;
  }).length;
  const zeroObj = calls.filter(c => c.costNonzeros === 1 && (c.costColumns ?? []).length === 1 && c.costColumns?.[0] === 'total_obj' && (c.objectiveOffset ?? 0) === 0).length;
  const objVals = calls.filter(c => c.objective !== null && c.objective !== undefined);
  const objZero = objVals.filter(c => c.objective === 0).length;
  const seeds = [...new Set(calls.map(c => String(eff(c, 'random_seed'))))];
  const gaps = [...new Set(calls.map(c => `${String(eff(c, 'mip_rel_gap'))}/${String(eff(c, 'mip_abs_gap'))}/${String(eff(c, 'mip_feasibility_tolerance'))}`))];
  table(['check over every native call', 'result'], [
    ['native calls recorded', calls.length],
    ['effective `mip_max_improving_sols` = 1 (read back from HiGHS)', `${stopOk}/${calls.length}`],
    ['effective presolve = off', `${presolveOff}/${calls.length}`],
    ['effective time_limit positive and within the remaining request budget', `${tlOk}/${calls.length} (min ${fmt(Math.min(...tl), 3)} s, max ${fmt(Math.max(...tl), 3)} s)`],
    ['parsed objective: the single cost column `total_obj`, offset 0', `${zeroObj}/${calls.length}`],
    ['objective value of every primal solution = 0', `${objZero}/${objVals.length}`],
    ['random_seed values used', seeds.join(', ')],
    ['mip_rel_gap / mip_abs_gap / mip_feasibility_tolerance', gaps.join(', ')],
    ['calls that threw', calls.filter(c => c.error !== undefined).length],
  ]);
  const longest = [...calls].sort((a, b) => b.wallMs - a.wallMs).slice(0, 15);
  p('Longest native calls:');
  p();
  table(['case', 'rep', 'cache', 'query', 'step', 'cap', 'status', 'primal', 'ms', 'B&B nodes', 'cols x rows (int)'],
    longest.map(c => [c.line.case, c.line.rep, c.line.cache, c.query, c.step, moa(c.line.queries?.[c.query]?.cap), c.status ?? 'thrown', c.primal ?? '—', fmt(c.wallMs), c.nodes ?? '—',
      `${c.cols} x ${c.rows} (${c.integers})`]));
}

// ---------------------------------------------------------------------------------------------
p('## Witness validation (production validator, every witness of every query)');
p();
{
  const ws = lines.flatMap(l => (l.queries ?? []).filter(q => q.validation !== undefined).map(q => ({ q, l })));
  const bad = ws.filter(({ q }) => !(q.validation?.ok === true && q.validation.moaExactMatches && q.validation.withinCap !== false));
  const resp = lines.filter(l => l.responseWitnessValidation !== undefined);
  const respBad = resp.filter(l => { const v = l.responseWitnessValidation; return !(v?.ok === true && v.floorEnclosesMoa && v.displayAtLeastFloor !== false); });
  table(['check', 'result'], [
    ['query witnesses validated (accepted, exact MOA equals the witness value, MOA <= the trial cap)', `${ws.length - bad.length}/${ws.length}`],
    ['response witnesses validated under their scope cap; floor >= validated MOA; display_floor >= floor', `${resp.length - respBad.length}/${resp.length}`],
    ['TED of witnesses of Prevent Overswing cases (min)', fmt(Math.min(...ws.filter(({ l }) => (l.queries?.length ?? 0) > 0 && ['T1-M4A1-TE-PO', 'T2-NL545DI-TE-PO', 'R1-SR25-PO', 'N1-SR25-PO-60'].includes(l.case)).map(({ q }) => q.validation?.ted ?? Infinity)), 3)],
  ]);
  for (const { q, l } of bad.slice(0, 10)) p(`- FAIL ${l.case} r${l.rep} ${l.cache} query ${q.index}: ${JSON.stringify(q.validation)}`);
  if (bad.length > 0) p();
}

// ---------------------------------------------------------------------------------------------
p('## Query traces (repetition 1, cold and warm)');
p();
p('Each row is one floor query; `native` lists its native calls as `status ms` (seed of the random_seed list in brackets when not 0).');
p();
for (const c of frozen.cases) {
  for (const cache of ['cold', 'warm'] as const) {
    const l = lines.find(x => x.case === c.id && x.rep === 1 && x.cache === cache);
    if (l === undefined) continue;
    p(`### ${c.id} (${c.weapon}), rep 1 ${cache}: ${l.status}, ended ${l.ended ?? '—'}, ${l.trials ?? '—'} trials, ${fmt(l.endToEndMs)} ms`);
    p();
    table(['#', 'step', 'cap', 'result', 'achieved MOA', 'reason', 'query ms', 'nodes', 'rejected', 'native'],
      (l.queries ?? []).map(q => {
        const calls = (l.nativeCalls ?? []).filter(n => n.query === q.index)
          .map(n => `${n.status ?? 'thrown'} ${fmt(n.wallMs)}${n.effective?.random_seed !== undefined && n.effective.random_seed !== 0 ? ` [${String(n.effective.random_seed)}]` : ''}`);
        const shown = calls.length > 8 ? [...calls.slice(0, 8), `... +${calls.length - 8}`] : calls;
        return [q.index, stepOf(l, q.index), moa(q.cap), q.floor.kind === 'empty' ? `empty${q.floor.qualified ? '' : ' (unqualified)'}` : q.floor.kind, moa(q.floor.achievedMoa),
          q.floor.reason ?? q.precise?.reason ?? '—', fmt(q.wallMs), q.precise?.nodes ?? '—', q.telemetry?.rejectedCandidates ?? 0, shown.join('; ') || '—'];
      }));
  }
}

process.stdout.write(`${out.join('\n')}\n`);
