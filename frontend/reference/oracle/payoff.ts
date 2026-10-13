// Payoff tables and ideal-point admissibility (INTERPRETATIONS.md choice 17; ADR 0010 section 2, owner decision 2026-10-04).
//
// Production builds the augmented-Tchebycheff ideal point from three single-axis solves over the request's feasible domain, with
// weights [100,0,0] (ergonomics), [0,100,0] (recoil) and [0,0,100] (price), in the same frame as the Tchebycheff score:
//   fE = 10 x ergonomics (TED under use_true_ergo), fR = 1000 x summed recoil modifier, fP = RUB spend.
// The ideal coordinates are unique: zE = max fE, zR = min fR, zP = min fP. Each nadir coordinate is the worst value of its axis over
// the three endpoint builds (nadE = min fE, nadR = max fR, nadP = max fP), and every endpoint build is ONE of possibly many tied
// optima of its own axis, so the nadir is not unique and a Tchebycheff optimum can change with the tie a solver happened to return.
//
// The oracle therefore keeps taking the ideal point as an input (a missing one is MISSING_IDEAL_POINT) and offers:
//   payoffTables    every admissible table of a domain: one tied optimal build per axis, all three chosen JOINTLY, so one build's
//                   coordinates feed every nadir it touches;
//   checkIdealPoint whether a reported table is one of them, compared in exact Q after decoding the reported doubles with
//                   fromBinary64, so Stage 3 / Stage 4 can verify the table a solver reports and then compare optima under it.
//
// Tolerance: the comparison is exact. A solver reports doubles, and an exact coordinate such as 1000 x fromBinary64(-0.1) is generally
// not a double, so Stage 3 needs its own documented tolerance handling for reported ideal points; none is provided here.
//
// An incomplete enumeration (a node, size or table-product cap) never produces a verdict: the result is `unknown`.

import type { ReferenceFixture, ReferenceRequest } from './domain';
import type { EnumerateOptions } from './enumerate';
import { runOracle } from './oracle';
import { codeUnitCompare } from './order';
import { cmp, eq, max, min, toString, type Q } from './q';
import { resolveRequest } from './resolve';
import { coordinatesOf, type Axis, type Coordinates } from './score';

export interface PayoffOptions extends EnumerateOptions {
  /** Cap on the endpoint triples examined (|E| x |R| x |P| distinct tied vectors). Beyond it the result is `unknown`. Default 1,000,000. */
  maxTableCombinations?: number;
}

/** One tied optimal build's coordinates, with every projection that realizes exactly them. */
export interface PayoffEndpoint {
  coordinates: Coordinates;
  /** Projection keys of the tied optimal builds with exactly these coordinates, code-unit sorted. */
  projectionKeys: string[];
}

export interface PayoffAxis {
  axis: Axis;
  /** The exact optimum on this axis: max fE, min fR or min fP over the feasible builds. */
  optimum: Q;
  /** The distinct coordinate vectors of the builds that attain the optimum, sorted by (fE, fR, fP). */
  endpoints: PayoffEndpoint[];
}

/** The reference point production passes to the Tchebycheff objective, in the objective frame. */
export interface PayoffTable {
  zE: Q;
  nadE: Q;
  zR: Q;
  nadR: Q;
  zP: Q;
  nadP: Q;
}

/** An admissible table with one choice of tied endpoints that produces it (the first in (e, r, p) enumeration order). */
export interface AdmissibleTable {
  table: PayoffTable;
  witness: { e: PayoffEndpoint; r: PayoffEndpoint; p: PayoffEndpoint };
}

export interface IdealCoordinates {
  zE: Q;
  zR: Q;
  zP: Q;
}

export type PayoffTables =
  | {
      status: 'tables';
      ideal: IdealCoordinates;
      axes: Record<Axis, PayoffAxis>;
      /** Distinct admissible tables, sorted ascending by (zE, nadE, zR, nadR, zP, nadP). */
      tables: AdmissibleTable[];
      examined: number;
      nodes: number;
    }
  | { status: 'empty'; reason: string; ideal: null; axes: null; tables: []; examined: number; nodes: number }
  | { status: 'unknown'; reason: string; ideal: null; axes: null; tables: []; examined: number; nodes: number };

export type IdealPointCheck =
  | { status: 'admissible'; admissible: true; table: PayoffTable; witness: AdmissibleTable['witness'] }
  | { status: 'inadmissible'; admissible: false; code: 'EMPTY_DOMAIN' | 'IDEAL_MISMATCH' | 'NADIR_NOT_ATTAINABLE'; reason: string }
  /** The enumeration did not complete: no verdict either way (`admissible` is null, never false). */
  | { status: 'unknown'; admissible: null; code: 'INCOMPLETE_ENUMERATION'; reason: string };

const DEFAULT_MAX_TABLE_COMBINATIONS = 1_000_000;

/** The coordinate of `axis`; ergonomics is maximized, recoil and price are minimized. */
const coordinate = (axis: Axis, c: Coordinates): Q => (axis === 'e' ? c.fE : axis === 'r' ? c.fR : c.fP);
const improves = (axis: Axis, a: Q, b: Q): boolean => (axis === 'e' ? cmp(a, b) > 0 : cmp(a, b) < 0);

const vectorKey = (c: Coordinates): string => `${toString(c.fE)}|${toString(c.fR)}|${toString(c.fP)}`;
const vectorCompare = (a: Coordinates, b: Coordinates): number => cmp(a.fE, b.fE) || cmp(a.fR, b.fR) || cmp(a.fP, b.fP);
const tableOrder = (t: PayoffTable): Q[] => [t.zE, t.nadE, t.zR, t.nadR, t.zP, t.nadP];
const tableKey = (t: PayoffTable): string => tableOrder(t).map(toString).join('|');
const tableCompare = (a: PayoffTable, b: PayoffTable): number => {
  const x = tableOrder(a);
  const y = tableOrder(b);
  for (let i = 0; i < x.length; i++) {
    const c = cmp(x[i], y[i]);
    if (c !== 0) return c;
  }
  return 0;
};
const sameTable = (a: PayoffTable, b: PayoffTable): boolean => tableOrder(a).every((v, i) => eq(v, tableOrder(b)[i]));
const show = (t: PayoffTable): string =>
  `zE ${toString(t.zE)}, nadE ${toString(t.nadE)}, zR ${toString(t.zR)}, nadR ${toString(t.nadR)}, zP ${toString(t.zP)}, nadP ${toString(t.nadP)}`;

/** The request as the single-axis payoff solves see it: its constraints, no Tchebycheff. Weights never affect feasibility. */
function payoffRequest(request: ReferenceRequest): ReferenceRequest {
  return { ...request, use_tchebycheff: false, ideal_point: null };
}

function axisPayoff(axis: Axis, points: ReadonlyMap<string, Coordinates>): PayoffAxis {
  let optimum: Q | null = null;
  for (const c of points.values()) {
    const v = coordinate(axis, c);
    if (optimum === null || improves(axis, v, optimum)) optimum = v;
  }
  if (optimum === null) throw new Error('payoff: axis payoff of an empty point set');
  const best = optimum;
  const byVector = new Map<string, PayoffEndpoint>();
  for (const [projectionKey, c] of points) {
    if (!eq(coordinate(axis, c), best)) continue;
    const key = vectorKey(c);
    const known = byVector.get(key);
    if (known) known.projectionKeys.push(projectionKey);
    else byVector.set(key, { coordinates: c, projectionKeys: [projectionKey] });
  }
  const endpoints = [...byVector.values()].sort((a, b) => vectorCompare(a.coordinates, b.coordinates));
  for (const endpoint of endpoints) endpoint.projectionKeys.sort(codeUnitCompare);
  return { axis, optimum: best, endpoints };
}

/**
 * Every admissible payoff table of the request's feasible domain: one distinct coordinate vector of the tied optimal builds per
 * axis, enumerated jointly, with production's nadir rule (min fE, max fR, max fP over the three chosen endpoint vectors).
 * The request's constraints bound the domain; its weights, use_tchebycheff and ideal_point play no part.
 */
export function payoffTables(fixture: ReferenceFixture, request: ReferenceRequest, options: PayoffOptions = {}): PayoffTables {
  const { maxTableCombinations = DEFAULT_MAX_TABLE_COMBINATIONS, ...enumerate } = options;
  const stripped = payoffRequest(request);
  const resolved = resolveRequest(fixture, stripped); // malformed input throws ReferenceInputError, never a verdict
  const run = runOracle(fixture, stripped, enumerate);
  const counts = { examined: run.examined, nodes: run.nodes };
  if (!run.complete) {
    return {
      status: 'unknown', ideal: null, axes: null, tables: [], ...counts,
      reason: `the enumeration stopped at a cap (${run.examined} builds examined, ${run.nodes} nodes): no table can be certified`,
    };
  }
  if (run.empty) {
    return { status: 'empty', ideal: null, axes: null, tables: [], ...counts, reason: 'no build satisfies the request: the domain is empty' };
  }

  // Coordinates are a function of the projection (base + installed multiset); runOracle already pins the score per projection.
  const points = new Map<string, Coordinates>();
  for (const accepted of run.builds) {
    const c = coordinatesOf(accepted.stats, resolved);
    const known = points.get(accepted.projectionKey);
    if (known === undefined) points.set(accepted.projectionKey, c);
    else if (vectorKey(known) !== vectorKey(c)) {
      throw new Error(`payoff invariant violated: projection ${accepted.projectionKey} has two coordinate vectors`);
    }
  }
  const axes: Record<Axis, PayoffAxis> = { e: axisPayoff('e', points), r: axisPayoff('r', points), p: axisPayoff('p', points) };
  const ideal: IdealCoordinates = { zE: axes.e.optimum, zR: axes.r.optimum, zP: axes.p.optimum };

  const combinations = axes.e.endpoints.length * axes.r.endpoints.length * axes.p.endpoints.length;
  if (combinations > maxTableCombinations) {
    return {
      status: 'unknown', ideal: null, axes: null, tables: [], ...counts,
      reason: `${combinations} endpoint triples exceed the table-product cap of ${maxTableCombinations}: the table set is incomplete`,
    };
  }
  const seen = new Set<string>();
  const tables: AdmissibleTable[] = [];
  for (const e of axes.e.endpoints) {
    for (const r of axes.r.endpoints) {
      for (const p of axes.p.endpoints) {
        const chosen = [e.coordinates, r.coordinates, p.coordinates];
        const table: PayoffTable = {
          zE: chosen.map(c => c.fE).reduce(max), nadE: chosen.map(c => c.fE).reduce(min),
          zR: chosen.map(c => c.fR).reduce(min), nadR: chosen.map(c => c.fR).reduce(max),
          zP: chosen.map(c => c.fP).reduce(min), nadP: chosen.map(c => c.fP).reduce(max),
        };
        const key = tableKey(table);
        if (seen.has(key)) continue;
        seen.add(key);
        tables.push({ table, witness: { e, r, p } });
      }
    }
  }
  tables.sort((a, b) => tableCompare(a.table, b.table));
  return { status: 'tables', ideal, axes, tables, ...counts };
}

/**
 * Whether `idealPoint` (in the objective frame, as a solver reports it) is one of the admissible payoff tables of the request's
 * domain. Reported doubles are decoded with fromBinary64 and compared exactly in Q; a non-finite coordinate is a
 * ReferenceInputError. An empty domain admits no table; an incomplete enumeration yields `unknown`, never a verdict.
 */
export function checkIdealPoint(
  fixture: ReferenceFixture, request: ReferenceRequest, idealPoint: NonNullable<ReferenceRequest['ideal_point']>, options: PayoffOptions = {},
): IdealPointCheck {
  // Decoding through resolveRequest validates the request and every reported coordinate with the oracle's own input rules.
  const resolved = resolveRequest(fixture, { ...request, use_tchebycheff: true, ideal_point: idealPoint });
  if (resolved.objective.kind !== 'tchebycheff') throw new Error('checkIdealPoint: the reported ideal point did not resolve');
  const reported: PayoffTable = resolved.objective.ideal;

  const result = payoffTables(fixture, request, options);
  if (result.status === 'unknown') return { status: 'unknown', admissible: null, code: 'INCOMPLETE_ENUMERATION', reason: result.reason };
  if (result.status === 'empty') {
    return { status: 'inadmissible', admissible: false, code: 'EMPTY_DOMAIN', reason: `${result.reason}; there is no table to report` };
  }
  const mismatches: string[] = [];
  for (const [name, exact] of [['zE', result.ideal.zE], ['zR', result.ideal.zR], ['zP', result.ideal.zP]] as const) {
    if (!eq(reported[name], exact)) mismatches.push(`${name} reported ${toString(reported[name])} but the exact ideal is ${toString(exact)}`);
  }
  if (mismatches.length > 0) {
    return { status: 'inadmissible', admissible: false, code: 'IDEAL_MISMATCH', reason: `ideal coordinates are not exact: ${mismatches.join('; ')}` };
  }
  const found = result.tables.find(t => sameTable(t.table, reported));
  if (found) return { status: 'admissible', admissible: true, table: found.table, witness: found.witness };
  return {
    status: 'inadmissible', admissible: false, code: 'NADIR_NOT_ATTAINABLE',
    reason:
      `no choice of tied endpoint builds yields (${show(reported)}); ` +
      `the ${result.tables.length} admissible table(s) are: ${result.tables.map(t => `[${show(t.table)}]`).join(' ')}`,
  };
}
