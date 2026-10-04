// Exact build statistics (ADR 0006 MOA, ADR 0007 clamp and TED, ADR 0010 section 2 coordinates).
// All arithmetic is in Q. Installed statistics are summed over occurrences, so a template placed
// in two physical slots counts twice (ADR 0002 section 4, ADR 0003 section 5).

import { acquire, type AcquisitionResult } from './acquisition';
import type { ReferenceBuild } from './build';
import {
  ERGO_CLAMP_MAX, ERGO_CLAMP_MIN, MOA_K, OVERSWING_FULL_KG, OVERSWING_START_KG,
  TED_FREE_WEIGHT_KG, TED_PENALTY_CAP, TED_PENALTY_NUMERATOR,
} from './constants';
import type { ResolvedFixture, ResolvedRequest, ResolvedTemplate } from './resolve';
import { add, div, gt, le, max, min, mul, ONE, q, sub, sum, ZERO, type Q } from './q';

const HUNDRED = q(100);

/** First ergonomics clamp: raw ergonomics to [0, 100]. */
export function clampErgonomics(raw: Q): Q {
  return min(ERGO_CLAMP_MAX, max(ERGO_CLAMP_MIN, raw));
}

/** Gear-adjusted ergonomics: clamp, scale by the equipment factor, clamp again. */
export function effectiveErgonomics(rawErgonomics: Q, gearFactor: Q): Q {
  return clampErgonomics(mul(clampErgonomics(rawErgonomics), gearFactor));
}

/** q(W) = 0 for W <= 3 kg, otherwise 100 - 300 / W. */
export function weightPenalty(weightKg: Q): Q {
  if (le(weightKg, TED_FREE_WEIGHT_KG)) return ZERO;
  return sub(TED_PENALTY_CAP, div(TED_PENALTY_NUMERATOR, weightKg));
}

/** TrueErgo delta: effective ergonomics minus the weight penalty. */
export function tedOf(effective: Q, weightKg: Q): Q {
  return sub(effective, weightPenalty(weightKg));
}

/**
 * Overswing strength in [0, 100]: W(1 - E/100) is 0% at 3 kg and 100% at 7 kg. It is nonzero
 * exactly when TED < 0 (swing > 3 kg  <=>  E < 100 - 300/W for W > 3, and swing <= 3 otherwise).
 */
export function overswingPercent(effective: Q, weightKg: Q): Q {
  const swing = mul(weightKg, sub(ONE, div(effective, HUNDRED)));
  const fraction = div(sub(swing, OVERSWING_START_KG), sub(OVERSWING_FULL_KG, OVERSWING_START_KG));
  return mul(min(ONE, max(ZERO, fraction)), HUNDRED);
}

/**
 * Effective centre of impact. An installed item with COI > 0 replaces the intrinsic value;
 * zero or negative COI (and no barrel at all) falls back to the intrinsic COI. With several
 * positive overriders the largest applies, which matches one replacement row per installed barrel.
 */
export function effectiveCenterOfImpact(intrinsic: Q, installedItemCois: readonly Q[]): Q {
  let best: Q | null = null;
  for (const coi of installedItemCois) {
    if (gt(coi, ZERO) && (best === null || gt(coi, best))) best = coi;
  }
  return best ?? intrinsic;
}

/** MOA = effectiveCOI x (1 - sum(accuracy)/100) x K, K = 100 / 2.9089 (ADR 0006 section 5). */
export function moaOf(effectiveCoi: Q, accuracyModifierSum: Q): Q {
  return mul(mul(effectiveCoi, sub(ONE, div(accuracyModifierSum, HUNDRED))), MOA_K);
}

export interface BuildStats {
  /** Unclamped receiver ergonomics plus installed ergonomics. */
  rawErgonomics: Q;
  /** First clamp of rawErgonomics: the displayed ergonomics. */
  ergonomics: Q;
  /** After the gear factor and the second clamp. */
  effectiveErgonomics: Q;
  recoilModifierSum: Q;
  /** nakedV x (1 + recoilModifierSum). */
  recoilVertical: Q;
  recoilHorizontal: Q;
  /** Receiver mass plus installed mass, fractional mass preserved. */
  weight: Q;
  weightPenalty: Q;
  ted: Q;
  /** Overswing strength 0..100, nonzero iff ted < 0. */
  overswingPercent: Q;
  accuracyModifierSum: Q;
  effectiveCenterOfImpact: Q;
  moa: Q;
  /** Largest magazine capacity among the receiver and installed items. */
  magazineCapacity: Q;
  /** Largest sighting range among the receiver and installed items. */
  sightingRange: Q;
  /** Base offer plus paid units; see acquisition.ts. */
  spend: Q;
  acquisition: AcquisitionResult;
}

/** Statistics of a build whose items all exist in the fixture. */
export function computeStats(fixture: ResolvedFixture, request: ResolvedRequest, build: ReferenceBuild): BuildStats {
  const weapon = fixture.weapons.get(request.weaponId);
  if (!weapon) throw new Error(`computeStats: unknown weapon ${request.weaponId}`);
  const installed: ResolvedTemplate[] = build.placements.map(p => {
    const item = fixture.items.get(p.itemId);
    if (!item) throw new Error(`computeStats: unknown item ${p.itemId}`);
    return item;
  });
  const rawErgonomics = add(weapon.ergonomics, sum(installed.map(i => i.ergonomics)));
  const ergonomics = clampErgonomics(rawErgonomics);
  const effective = effectiveErgonomics(rawErgonomics, request.gearFactor);
  const recoilModifierSum = sum(installed.map(i => i.recoilModifier));
  const recoilFactor = add(ONE, recoilModifierSum);
  const weight = add(weapon.weight, sum(installed.map(i => i.weight)));
  const accuracyModifierSum = sum(installed.map(i => i.accuracyModifier));
  const coi = effectiveCenterOfImpact(weapon.centerOfImpact, installed.map(i => i.centerOfImpact));
  const acquisition = acquire(fixture, request, build);
  return {
    rawErgonomics,
    ergonomics,
    effectiveErgonomics: effective,
    recoilModifierSum,
    recoilVertical: mul(weapon.recoilVertical, recoilFactor),
    recoilHorizontal: mul(weapon.recoilHorizontal, recoilFactor),
    weight,
    weightPenalty: weightPenalty(weight),
    ted: tedOf(effective, weight),
    overswingPercent: overswingPercent(effective, weight),
    accuracyModifierSum,
    effectiveCenterOfImpact: coi,
    moa: moaOf(coi, accuracyModifierSum),
    magazineCapacity: installed.reduce((m, i) => max(m, i.magazineCapacity), weapon.magazineCapacity),
    sightingRange: installed.reduce((m, i) => max(m, i.sightingRange), weapon.sightingRange),
    spend: acquisition.spend,
    acquisition,
  };
}
