import type { SolveParams } from './types';

export function effectiveErgo(rawErgo: number, modifier = 0): number {
  return Math.min(100, Math.max(0, Math.min(100, Math.max(0, rawErgo)) * (1 + modifier)));
}

export function weightPenalty(weightKg: number): number {
  return weightKg <= 3 ? 0 : 100 - 300 / weightKg;
}

export function trueErgoDelta(rawErgo: number, weightKg: number, modifier = 0): number {
  return effectiveErgo(rawErgo, modifier) - weightPenalty(weightKg);
}

/** Aiming-in kick starts once W(1 - E/100) passes 3 kg and is full at 7 kg. */
export const SWAY_START_KG = 3;
export const SWAY_FULL_KG = 7;

/** How hard aiming in kicks the weapon, 0-100. It is nonzero exactly when TED < 0. */
export function overswingPercent(rawErgo: number, weightKg: number, modifier = 0): number {
  const swing = weightKg * (1 - effectiveErgo(rawErgo, modifier) / 100);
  const fraction = (swing - SWAY_START_KG) / (SWAY_FULL_KG - SWAY_START_KG);
  return Math.min(1, Math.max(0, fraction)) * 100;
}

/** A part's TED change smaller than this would read "+0.0", so it is not shown. */
export const MIN_SHOWN_TED_DELTA = 0.05;
export function isShownTedDelta(delta: number | undefined): delta is number {
  return delta != null && Math.abs(delta) >= MIN_SHOWN_TED_DELTA;
}

/** TED the build gains from one part: TED(build) - TED(build without it). */
export function tedContribution(
  rawErgo: number, weightKg: number, partErgo: number, partWeight: number, modifier = 0,
): number {
  return trueErgoDelta(rawErgo, weightKg, modifier)
    - trueErgoDelta(rawErgo - partErgo, weightKg - partWeight, modifier);
}

export interface ObjectiveAxes { fE: number; fR: number; fP: number }
export interface ObjectiveModel {
  ergo: number;
  recoil: number;
  price: number;
  deviations: Array<{ axis: 'fE' | 'fR' | 'fP'; coefficient: number; ideal: number }>;
}

/** The weights the objective reads: a missing weight is its default (ergonomics 1, recoil 1, price 0), a negative one is 0. */
export function objectiveWeights(params: Pick<SolveParams, 'ergoWeight' | 'recoilWeight' | 'priceWeight'>): { e: number; r: number; p: number } {
  return {
    e: Math.max(0, params.ergoWeight ?? 1),
    r: Math.max(0, params.recoilWeight ?? 1),
    p: Math.max(0, params.priceWeight ?? 0),
  };
}

/** fE is ergonomics/TED * 10, fR is the summed recoil modifier * 1000,
 * fP is purchase cost (including the existing unavailable-item penalty).
 * The returned score and LP coefficients use exactly the same convention. */
export function objectiveModel(params: SolveParams): ObjectiveModel {
  const { e, r, p } = objectiveWeights(params);
  if (!params.useTchebycheff || !params.idealPoint) {
    return { ergo: e / 10, recoil: -r, price: -p / 1000, deviations: [] };
  }
  const { zE, nadE, zR, nadR, zP, nadP } = params.idealPoint;
  const sum = e + r + p || 1;
  const ce = e / sum / Math.max(zE - nadE, 1);
  const cr = r / sum / Math.max(nadR - zR, 1);
  const cp = p / sum / Math.max(nadP - zP, 1);
  const deviations: ObjectiveModel['deviations'] = [];
  if (ce) deviations.push({ axis: 'fE', coefficient: -ce, ideal: zE });
  if (cr) deviations.push({ axis: 'fR', coefficient: cr, ideal: zR });
  if (cp) deviations.push({ axis: 'fP', coefficient: cp, ideal: zP });
  return { ergo: 0.01 * ce, recoil: -0.01 * cr, price: -0.01 * cp, deviations };
}

export function objectiveScore(model: ObjectiveModel, axes: ObjectiveAxes): number {
  const maxDeviation = model.deviations.length
    ? Math.max(...model.deviations.map(d => d.coefficient * (axes[d.axis] - d.ideal)))
    : 0;
  return model.ergo * axes.fE + model.recoil * axes.fR + model.price * axes.fP - maxDeviation;
}
