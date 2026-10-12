// Scoreboard bookkeeping of the ledger-to-production harness: the per-case grade shape, the committed
// baseline file, the ratchet comparison and the printed summary.
//
// This module is pure data handling and deliberately imports nothing from production or from any
// `*.differential.*` file (the independence guard forbids it): the differential helpers import these types,
// never the other way round.

/** The four graded dimensions (README.md in this directory defines each one). */
export const DIMENSIONS = ['buildValid', 'scoreOptimal', 'emptiness', 'outcomeContract'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/**
 * Dimensions graded in the secondary Fast column. Fast optimizes an approximate model, so exact optimality
 * (`scoreOptimal`) is not required of it by ADR 0013 section 6 and is not graded.
 */
export const FAST_DIMENSIONS: readonly Dimension[] = ['buildValid', 'emptiness', 'outcomeContract'];

/**
 * `refused`: production refused the case as unsupported data, exactly as an owner decision requires (`OWNER_APPROVED_REFUSALS`), on a dimension that would
 * otherwise be graded. It is neither a pass nor a failure: the ledger expectation is unchanged (the oracle still solves the case), the scope is the owner's.
 */
export type Verdict = 'pass' | 'fail' | 'n/a' | 'refused';
export const VERDICTS: readonly Verdict[] = ['pass', 'fail', 'n/a', 'refused'];

// ---------------------------------------------------------------------------------------------
// Owner-approved scope (README.md, "Owner-approved scope")
// ---------------------------------------------------------------------------------------------

/**
 * Ledger cases production refuses, by owner decision, as unsupported data: the part graph reachable from the receiver has a cycle (owner decision 2d as
 * amended, 2026-10-12; docs/stage2-plan.md). The oracle still solves them and their ledger expectations are not edited; the harness grades them as
 * `refused` only when production returns exactly the refusal (`Unsupported data: cyclic part graph`, no build, nothing resolved) in both modes.
 */
export const OWNER_APPROVED_REFUSALS: Readonly<Record<string, string>> = {
  'F03-self-loop': 'decision 2d as amended: cyclic part graph',
  'F03-ancestor-loop-with-sibling-repetition': 'decision 2d as amended: cyclic part graph',
  'F03-memoization-context-ancestor': 'decision 2d as amended: cyclic part graph',
  'F03-memoization-context-required-slot': 'decision 2d as amended: cyclic part graph',
  'F10-cycle-behind-deactivated-owner': 'decision 2d as amended: cyclic part graph',
};

/**
 * Ledger cases whose Precise answer lost its certificate at the case tolerance (1e-9) to the native integrality tolerance of 1e-7 (owner decision 5b,
 * 2026-10-06): the optimum is returned and validated, but the proved gap is about 1e-7 (one case: a dual bound below its own verified build, withheld),
 * so the response is `feasible`. Only `precise.outcomeContract` fails for them, recorded in baseline.json by hand; the ledger expectation is not edited.
 */
export const OWNER_APPROVED_CERTIFICATE_LOSSES: Readonly<Record<string, string>> = {
  'F01-self-copy-cap': 'decision 5b: gap 1.0e-7',
  'F04-recoil-final-cap-sum': 'decision 5b: gap 1.0e-7',
  'F04-max-price-cap-boundary': 'decision 5b: gap 1.0e-7',
  'F04-max-weight-cap-boundary': 'decision 5b: gap 1.0e-7',
  'F04-near-cap-min-ergonomics-gap-2e-20': 'decision 5b: dual bound 1.1e-5 below the verified optimum, withheld',
  'F08-optional-barrel-fallback': 'decision 5b: gap 1.0e-7',
  'F12-near-cap-weight-one-ulp-over-cap': 'decision 5b: gap 1.0e-7',
};

export type ModeName = 'precise' | 'fast';
export const MODES: readonly ModeName[] = ['precise', 'fast'];

export interface DimensionResult {
  verdict: Verdict;
  /** One human-readable line with the specifics (ids, values). Not persisted in the baseline. */
  reason: string;
  /** Stable, case-independent label used to group failures in the summary. Defaults to `reason`. */
  key?: string;
}

export type DimensionResults = Record<Dimension, DimensionResult>;

export interface CaseScore {
  id: string;
  family: number;
  /** Ids of the fixture features production's inputs cannot represent (empty when the case was run). */
  unsupported: string[];
  precise: DimensionResults;
  fast: DimensionResults;
}

export type Scoreboard = CaseScore[];

// ---------------------------------------------------------------------------------------------
// Baseline file
// ---------------------------------------------------------------------------------------------

export type VerdictRow = Record<Dimension, Verdict>;

export interface BaselineEntry {
  unsupported: string[];
  precise: VerdictRow;
  fast: VerdictRow;
}

export interface Baseline {
  schemaVersion: 1;
  cases: Record<string, BaselineEntry>;
}

const verdictRow = (results: DimensionResults): VerdictRow => ({
  buildValid: results.buildValid.verdict,
  scoreOptimal: results.scoreOptimal.verdict,
  emptiness: results.emptiness.verdict,
  outcomeContract: results.outcomeContract.verdict,
});

export function toBaseline(board: Scoreboard): Baseline {
  const cases: Record<string, BaselineEntry> = {};
  for (const c of board) {
    cases[c.id] = { unsupported: [...c.unsupported], precise: verdictRow(c.precise), fast: verdictRow(c.fast) };
  }
  return { schemaVersion: 1, cases };
}

/** One line per case (valid JSON), in ledger order, so a baseline diff reads case by case. */
export function serializeBaseline(baseline: Baseline): string {
  const lines = Object.entries(baseline.cases).map(([id, entry]) => `    ${JSON.stringify(id)}: ${JSON.stringify(entry)}`);
  return `{\n  "schemaVersion": 1,\n  "cases": {\n${lines.join(',\n')}\n  }\n}\n`;
}

function isVerdictRow(value: unknown): value is VerdictRow {
  if (typeof value !== 'object' || value === null) return false;
  return DIMENSIONS.every(d => VERDICTS.includes((value as Record<string, Verdict>)[d]));
}

export function parseBaseline(text: string): Baseline {
  const raw = JSON.parse(text) as { schemaVersion?: unknown; cases?: unknown };
  if (raw.schemaVersion !== 1) throw new Error(`baseline schemaVersion must be 1, got ${String(raw.schemaVersion)}`);
  if (typeof raw.cases !== 'object' || raw.cases === null) throw new Error('baseline has no cases object');
  const cases: Record<string, BaselineEntry> = {};
  for (const [id, entry] of Object.entries(raw.cases as Record<string, unknown>)) {
    const e = entry as { unsupported?: unknown; precise?: unknown; fast?: unknown };
    if (!Array.isArray(e.unsupported) || !e.unsupported.every(f => typeof f === 'string')) throw new Error(`baseline case ${id}: unsupported must be a string list`);
    if (!isVerdictRow(e.precise) || !isVerdictRow(e.fast)) throw new Error(`baseline case ${id}: every dimension needs a pass, fail, n/a or refused verdict`);
    cases[id] = { unsupported: e.unsupported as string[], precise: e.precise, fast: e.fast };
  }
  return { schemaVersion: 1, cases };
}

// ---------------------------------------------------------------------------------------------
// Ratchet
// ---------------------------------------------------------------------------------------------

export interface RatchetReport {
  /** A dimension that passed in the baseline and does not now. Always a failure. */
  regressions: string[];
  /** A dimension that passes now and did not in the baseline. A failure until the baseline is updated. */
  improvements: string[];
  /** Any other disagreement with the baseline (cases added or removed, fail/n-a changes, unsupported changes). */
  drift: string[];
  ok: boolean;
}

export function compareToBaseline(baseline: Baseline, board: Scoreboard): RatchetReport {
  const regressions: string[] = [];
  const improvements: string[] = [];
  const drift: string[] = [];
  const seen = new Set<string>();
  for (const c of board) {
    seen.add(c.id);
    const base = baseline.cases[c.id];
    if (!base) {
      drift.push(`${c.id}: case is not in the baseline`);
      continue;
    }
    if (JSON.stringify([...base.unsupported].sort()) !== JSON.stringify([...c.unsupported].sort())) {
      drift.push(`${c.id}: unsupported features changed from [${base.unsupported.join(', ')}] to [${c.unsupported.join(', ')}]`);
    }
    for (const mode of MODES) {
      for (const dimension of DIMENSIONS) {
        const before = base[mode][dimension];
        const now = c[mode][dimension];
        const where = `${c.id} ${mode}.${dimension}`;
        if (before === 'pass' && now.verdict !== 'pass') regressions.push(`${where}: passed in the baseline, now ${now.verdict} (${now.reason})`);
        else if (before !== 'pass' && now.verdict === 'pass') improvements.push(`${where}: was ${before} in the baseline, now passes`);
        else if (before !== now.verdict) drift.push(`${where}: was ${before} in the baseline, now ${now.verdict}`);
      }
    }
  }
  for (const id of Object.keys(baseline.cases)) {
    if (!seen.has(id)) drift.push(`${id}: baseline case is no longer in the ledger`);
  }
  return { regressions, improvements, drift, ok: regressions.length === 0 && improvements.length === 0 && drift.length === 0 };
}

// ---------------------------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------------------------

export interface PassCount {
  pass: number;
  applicable: number;
}

export interface FamilySummary {
  family: number;
  cases: number;
  precise: Record<Dimension, PassCount>;
  fast: Record<Dimension, PassCount>;
}

export interface Summary {
  total: number;
  /** Cases graded `refused` (owner-approved unsupported data): outside every pass/applicable count. */
  refused: number;
  families: FamilySummary[];
  totals: { precise: Record<Dimension, PassCount>; fast: Record<Dimension, PassCount> };
  topReasons: Record<ModeName, { key: string; count: number }[]>;
  unsupported: { feature: string; cases: number }[];
}

const emptyCounts = (): Record<Dimension, PassCount> => ({
  buildValid: { pass: 0, applicable: 0 },
  scoreOptimal: { pass: 0, applicable: 0 },
  emptiness: { pass: 0, applicable: 0 },
  outcomeContract: { pass: 0, applicable: 0 },
});

function tally(into: Record<Dimension, PassCount>, results: DimensionResults): void {
  for (const d of DIMENSIONS) {
    if (results[d].verdict === 'n/a' || results[d].verdict === 'refused') continue;
    into[d].applicable++;
    if (results[d].verdict === 'pass') into[d].pass++;
  }
}

export function summarize(board: Scoreboard, topN = 8): Summary {
  const byFamily = new Map<number, FamilySummary>();
  const totals = { precise: emptyCounts(), fast: emptyCounts() };
  const reasons: Record<ModeName, Map<string, number>> = { precise: new Map(), fast: new Map() };
  const unsupported = new Map<string, number>();
  let refused = 0;
  for (const c of board) {
    if (MODES.some(mode => DIMENSIONS.some(d => c[mode][d].verdict === 'refused'))) refused++;
    let family = byFamily.get(c.family);
    if (!family) {
      family = { family: c.family, cases: 0, precise: emptyCounts(), fast: emptyCounts() };
      byFamily.set(c.family, family);
    }
    family.cases++;
    for (const mode of MODES) {
      tally(family[mode], c[mode]);
      tally(totals[mode], c[mode]);
      for (const d of DIMENSIONS) {
        const r = c[mode][d];
        if (r.verdict !== 'fail') continue;
        const key = r.key ?? r.reason;
        reasons[mode].set(key, (reasons[mode].get(key) ?? 0) + 1);
      }
    }
    for (const feature of c.unsupported) unsupported.set(feature, (unsupported.get(feature) ?? 0) + 1);
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, topN).map(([key, count]) => ({ key, count }));
  return {
    total: board.length,
    refused,
    families: [...byFamily.values()].sort((a, b) => a.family - b.family),
    totals,
    topReasons: { precise: top(reasons.precise), fast: top(reasons.fast) },
    unsupported: [...unsupported.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([feature, cases]) => ({ feature, cases })),
  };
}

const cell = (c: PassCount) => (c.applicable === 0 ? '-' : `${c.pass}/${c.applicable}`).padStart(6);

/** Compact, fixed-width report: pass counts per family and dimension, then the dominant failure reasons. */
export function formatSummary(summary: Summary): string {
  const out: string[] = [];
  out.push(`ledger-to-production harness: ${summary.total} cases (pass/applicable per dimension; bV=buildValid sO=scoreOptimal em=emptiness oC=outcomeContract)`);
  out.push(`${'family'.padEnd(8)}${'cases'.padStart(5)} |  bV     sO     em     oC   | fast:  bV     em     oC`);
  const row = (label: string, cases: number, p: Record<Dimension, PassCount>, f: Record<Dimension, PassCount>) =>
    `${label.padEnd(8)}${String(cases).padStart(5)} | ${DIMENSIONS.map(d => cell(p[d])).join(' ')}   | ${FAST_DIMENSIONS.map(d => cell(f[d])).join(' ')}`;
  for (const f of summary.families) out.push(row(`F${String(f.family).padStart(2, '0')}`, f.cases, f.precise, f.fast));
  out.push(row('total', summary.total, summary.totals.precise, summary.totals.fast));
  for (const mode of MODES) {
    out.push(`top failure reasons (${mode}):`);
    for (const r of summary.topReasons[mode]) out.push(`  ${String(r.count).padStart(4)}  ${r.key}`);
  }
  out.push(`unsupported features (cases): ${summary.unsupported.map(u => `${u.feature} (${u.cases})`).join(', ') || 'none'}`);
  out.push(`refused as owner-approved unsupported data (cases, outside the counts above): ${summary.refused}`);
  return out.join('\n');
}
