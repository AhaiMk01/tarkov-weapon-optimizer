/**
 * Request-level raw ranges over the ACTIVE occurrences (ADR 0007 section 2, ADR 0013 section 4C).
 *
 * The blueprint holds the raw ranges of the whole unmasked universe. After the domain masks (filters, supply, receiver bans) the
 * reachable trees are fewer, so the exact min and max of weight, ergonomics, recoil modifier and accuracy over the structurally
 * buildable ACTIVE trees are tighter. They ignore conflicts, includes and every cap, so they enclose every physical build of the
 * request: each is a valid finite domain for the auxiliary column that sums that statistic.
 *
 * The per-occurrence pass is one reverse sweep (children are numbered after their owner). Occurrence counting is built in: a template
 * placed in two physical slots contributes twice, which is what keeps the negative-accuracy bound valid on multi-copy builds
 * (ADR 0007 section 2). The enclosures are widened by the n-term summation bound, so rounding in any order of summation cannot
 * let a feasible build leave its column's domain.
 */

import type { PhysicalBlueprint } from './blueprint';
import { PhysicalModelError } from './errors';
import type { SubproblemDomain } from './domain';
import { sumEnclosure, type Interval } from './numeric';

export interface ActiveBounds {
  /** Total weight in kilograms, receiver included. */
  weight: Interval;
  /** Raw (unclamped) ergonomics, receiver included. */
  ergonomics: Interval;
  /** Sum of installed recoil modifiers (a fraction). */
  recoil: Interval;
  /** Sum of installed accuracy modifiers, percent points. The lower end is the conservative A_min of ADR 0007. */
  accuracy: Interval;
}

const STATS = 4;

export function computeActiveBounds(blueprint: PhysicalBlueprint, domain: SubproblemDomain): ActiveBounds {
  if (domain.empty) throw new PhysicalModelError('DOMAIN_INCONSISTENT', 'Bounds of an empty domain are undefined', { weaponId: blueprint.weaponId });
  const N = blueprint.occurrenceCount;
  const { occTemplate, occSlotStart, slotCandStart, slotCandCount } = blueprint;
  const own = [blueprint.templateWeight, blueprint.templateErgonomics, blueprint.templateRecoilModifier, blueprint.templateAccuracyModifier];
  // The receiver carries no accuracy or recoil modifier of its own in the sums (its naked recoil enters through the caps).
  const lo = Array.from({ length: STATS }, () => new Float64Array(N));
  const hi = Array.from({ length: STATS }, () => new Float64Array(N));
  const absSum = new Float64Array(STATS);
  let terms = 1;
  for (let v = N - 1; v >= 0; v--) {
    if (!domain.occActive[v]) continue;
    terms++;
    const t = occTemplate[v];
    for (let k = 0; k < STATS; k++) {
      const value = v === 0 && k >= 2 ? 0 : own[k][t];
      lo[k][v] = value;
      hi[k][v] = value;
      absSum[k] += Math.abs(value);
    }
    for (let s = occSlotStart[v]; s < occSlotStart[v + 1]; s++) {
      const cLo = [Infinity, Infinity, Infinity, Infinity];
      const cHi = [-Infinity, -Infinity, -Infinity, -Infinity];
      let any = false;
      for (let c = slotCandStart[s], end = c + slotCandCount[s]; c < end; c++) {
        if (!domain.occActive[c]) continue;
        any = true;
        for (let k = 0; k < STATS; k++) {
          if (lo[k][c] < cLo[k]) cLo[k] = lo[k][c];
          if (hi[k][c] > cHi[k]) cHi[k] = hi[k][c];
        }
      }
      if (blueprint.slotRequired(s)) {
        if (!any) {
          throw new PhysicalModelError('DOMAIN_INCONSISTENT', `Active occurrence ${v} owns a required slot with no active candidate`, { occurrence: v, slot: s });
        }
        for (let k = 0; k < STATS; k++) {
          lo[k][v] += cLo[k];
          hi[k][v] += cHi[k];
        }
      } else if (any) {
        for (let k = 0; k < STATS; k++) {
          lo[k][v] += Math.min(0, cLo[k]);
          hi[k][v] += Math.max(0, cHi[k]);
        }
      }
    }
  }
  const range = (k: number): Interval => sumEnclosure(lo[k][0], hi[k][0], terms, absSum[k]);
  return { weight: range(0), ergonomics: range(1), recoil: range(2), accuracy: range(3) };
}
