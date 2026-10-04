// Oracle entry point (ADR 0010 section 1, ADR 0013 section 3).
//
// runOracle enumerates the finite rooted domain, keeps exactly the validator-accepted builds,
// scores them in exact Q and reports:
//   - every accepted build with its projection key, statistics and score;
//   - the canonical projection keys (base + installed multiset with counts), sorted;
//   - the exact maximum score (null when nothing is feasible);
//   - the exact set of maximizing projections, by exact Q equality only (a tiny positive gap is
//     never a tie);
//   - empty: true only when the enumeration completed and nothing was accepted;
//   - complete: false when a node or size cap stopped the enumeration (never a proof of emptiness).

import type { ReferenceBuild, Projection } from './build';
import { projectBuild, projectionKey } from './build';
import type { ReferenceFixture, ReferenceRequest } from './domain';
import { enumerateBuilds, type EnumerateOptions } from './enumerate';
import { codeUnitCompare } from './order';
import { resolveFixture, resolveRequest } from './resolve';
import { scoreBuild } from './score';
import type { BuildStats } from './stats';
import { eq, gt, type Q } from './q';
import { inspectBuild } from './validate';

export interface AcceptedBuild {
  build: ReferenceBuild;
  projectionKey: string;
  stats: BuildStats;
  score: Q;
}

export interface ProjectionRecord {
  key: string;
  projection: Projection;
  score: Q;
  /** Number of accepted physical builds that project to this key. */
  builds: number;
}

export interface OracleResult {
  /** Every validator-accepted build, in enumeration order. */
  builds: AcceptedBuild[];
  /** Sorted, distinct projection keys of the accepted builds. */
  projectionKeys: string[];
  /** One record per projection key, in the same order as projectionKeys. */
  projections: ProjectionRecord[];
  /** Exact maximum score over accepted builds, or null. */
  maxScore: Q | null;
  /** Keys of the projections whose score equals maxScore exactly, sorted. */
  maximizers: string[];
  /** True only when the enumeration completed and no build was accepted. */
  empty: boolean;
  /** False when a cap stopped the enumeration. */
  complete: boolean;
  /** Number of enumerated builds that were examined. */
  examined: number;
  /** Placement expansions performed by the enumerator. */
  nodes: number;
}

export function runOracle(fixture: ReferenceFixture, request: ReferenceRequest, options: EnumerateOptions = {}): OracleResult {
  const resolvedFixture = resolveFixture(fixture);
  const resolvedRequest = resolveRequest(fixture, request);
  const enumeration = enumerateBuilds(fixture, request, options);
  const accepted: AcceptedBuild[] = [];
  const byKey = new Map<string, ProjectionRecord>();
  for (const build of enumeration.builds) {
    const { violations, stats } = inspectBuild(resolvedFixture, resolvedRequest, build);
    if (violations.length > 0 || stats === null) continue;
    const score = scoreBuild(stats, resolvedRequest);
    const projection = projectBuild(build);
    const key = projectionKey(projection);
    accepted.push({ build, projectionKey: key, stats, score });
    const record = byKey.get(key);
    if (!record) byKey.set(key, { key, projection, score, builds: 1 });
    else {
      if (!eq(record.score, score)) {
        throw new Error(`oracle invariant violated: projection ${key} scored both ${record.score.n}/${record.score.d} and ${score.n}/${score.d}`);
      }
      record.builds++;
    }
  }
  const projections = [...byKey.values()].sort((a, b) => codeUnitCompare(a.key, b.key));
  let maxScore: Q | null = null;
  for (const record of projections) if (maxScore === null || gt(record.score, maxScore)) maxScore = record.score;
  const best = maxScore;
  return {
    builds: accepted,
    projectionKeys: projections.map(p => p.key),
    projections,
    maxScore,
    maximizers: best === null ? [] : projections.filter(p => eq(p.score, best)).map(p => p.key),
    empty: enumeration.complete && accepted.length === 0,
    complete: enumeration.complete,
    examined: enumeration.builds.length,
    nodes: enumeration.nodes,
  };
}
