/**
 * The endpoint (payoff table) cache (ADR 0013 section 4D, canonical #38, Phase 2.7a).
 *
 * A Tchebycheff request needs a payoff table: three single-axis solves. The table depends only on the physical and acquisition domain, never on
 * the preference weights, so it is reused across weight changes. It is cached ONLY when it is a qualified, MOA-independent Precise result:
 * every one of the three endpoints a `certified_optimal` exact optimum. A Fast endpoint, a provisional-MOA endpoint, a feasible (limited)
 * endpoint or anything less than certified is never stored, so a hit can never carry less authority than a fresh computation would.
 *
 * Keys carry the domain and the resolved controls (`reuseKey.ts`), never a request id or an absolute epoch deadline: the current deadline and
 * cancel flag stay runtime guards of the request that asks. The cache lives INSIDE the loaded data of the worker (`workerRuntime.ts`), so a
 * reload, a replacement or a cache clear discards it with the data it was derived from, even when the language and game mode names match.
 */

import type { IdealPoint } from './types';
import type { EndpointRecord, PayoffReport } from './solver';

/**
 * True when a payoff table may be cached: exactly the three endpoints, each an optimal, certified, exact Precise result that does not lean on
 * the provisional MOA model.
 */
export function endpointsQualifyForCache(endpoints: readonly EndpointRecord[]): boolean {
  return endpoints.length === 3 && endpoints.every(e => e.status === 'optimal'
    && e.physical_certificate === 'certified_optimal'
    && e.precision_resolved === 'precise'
    && e.model_qualification === 'exact'
    && e.moa_qualification === null);
}

interface Entry {
  idealPoint: IdealPoint;
  /** The objective tolerance the endpoints were certified under. */
  tolerance: number;
}

export class EndpointCache {
  private readonly entries = new Map<string, Entry>();

  /**
   * The cached table for `key`, when it is eligible for a request of the given tolerance: conservative, a table certified at a coarser
   * tolerance than the request asks for is not reused.
   */
  lookup(key: string, tolerance: number): IdealPoint | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined || entry.tolerance > tolerance) return undefined;
    return entry.idealPoint;
  }

  /** Store a freshly computed table if, and only if, it qualifies. Returns whether it was stored. */
  admit(key: string, payoff: PayoffReport, tolerance: number): boolean {
    if (!endpointsQualifyForCache(payoff.endpoints)) return false;
    this.entries.set(key, { idealPoint: { ...payoff.idealPoint }, tolerance });
    return true;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
