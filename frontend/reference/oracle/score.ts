// Exact objective scoring (ADR 0010 section 2). Coordinates:
//   fE = ERGO_SCALE x (TED if use_true_ergo, else clamped ergonomics)
//   fR = SCALE x summed recoil modifier
//   fP = RUB spend
// and resolved nonnegative weights e, r, p.
//
//   weighted:    score = (e / ERGO_SCALE) fE - r fR - (p / SCALE) fP
//   Tchebycheff: sum = e + r + p (or 1 if 0)
//                c_e = e / (sum max(zE - nadE, 1)),  c_r = r / (sum max(nadR - zR, 1)),
//                c_p = p / (sum max(nadP - zP, 1))
//                d_e = c_e (zE - fE), d_r = c_r (fR - zR), d_p = c_p (fP - zP)   (active axes only)
//                score = AUGMENTATION (c_e fE - c_r fR - c_p fP) - max(d_a over active axes)
//   The deviations stay signed (no outer zero clamp); with no active axis the maximum is 0.

import { AUGMENTATION, ERGO_SCALE, SCALE } from './constants';
import type { ResolvedObjective, ResolvedRequest } from './resolve';
import type { BuildStats } from './stats';
import { add, div, gt, max, mul, ONE, sub, ZERO, type Q } from './q';

export interface Coordinates {
  fE: Q;
  fR: Q;
  fP: Q;
}

export function coordinatesOf(stats: BuildStats, request: ResolvedRequest): Coordinates {
  const ergo = request.useTrueErgo ? stats.ted : stats.ergonomics;
  return {
    fE: mul(ERGO_SCALE, ergo),
    fR: mul(SCALE, stats.recoilModifierSum),
    fP: stats.spend,
  };
}

export type Axis = 'e' | 'r' | 'p';

export interface TchebycheffCoefficients {
  ce: Q;
  cr: Q;
  cp: Q;
  /** Axes with positive weight, in e, r, p order. */
  active: Axis[];
}

export function tchebycheffCoefficients(objective: ResolvedObjective): TchebycheffCoefficients {
  if (objective.kind !== 'tchebycheff') throw new Error('tchebycheffCoefficients: objective is not Tchebycheff');
  const { e, r, p } = objective.weights;
  const { zE, nadE, zR, nadR, zP, nadP } = objective.ideal;
  const total = add(add(e, r), p);
  const sum = gt(total, ZERO) ? total : ONE;
  const coefficient = (weight: Q, range: Q) => div(weight, mul(sum, max(range, ONE)));
  const ce = coefficient(e, sub(zE, nadE));
  const cr = coefficient(r, sub(nadR, zR));
  const cp = coefficient(p, sub(nadP, zP));
  const active: Axis[] = [];
  if (gt(e, ZERO)) active.push('e');
  if (gt(r, ZERO)) active.push('r');
  if (gt(p, ZERO)) active.push('p');
  return { ce, cr, cp, active };
}

export function scoreCoordinates(objective: ResolvedObjective, c: Coordinates): Q {
  if (objective.kind === 'weighted') {
    const { e, r, p } = objective.weights;
    return sub(sub(mul(div(e, ERGO_SCALE), c.fE), mul(r, c.fR)), mul(div(p, SCALE), c.fP));
  }
  const { ce, cr, cp, active } = tchebycheffCoefficients(objective);
  const { zE, zR, zP } = objective.ideal;
  const deviation: Record<Axis, Q> = {
    e: mul(ce, sub(zE, c.fE)),
    r: mul(cr, sub(c.fR, zR)),
    p: mul(cp, sub(c.fP, zP)),
  };
  let maxDeviation = ZERO;
  active.forEach((axis, i) => {
    maxDeviation = i === 0 || gt(deviation[axis], maxDeviation) ? deviation[axis] : maxDeviation;
  });
  const linear = sub(sub(mul(ce, c.fE), mul(cr, c.fR)), mul(cp, c.fP));
  return sub(mul(AUGMENTATION, linear), maxDeviation);
}

export function scoreBuild(stats: BuildStats, request: ResolvedRequest): Q {
  return scoreCoordinates(request.objective, coordinatesOf(stats, request));
}
