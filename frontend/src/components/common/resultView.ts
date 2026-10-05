/**
 * How a solver result is shown (ADR 0013 sections 5 and 6, Phase 2.8): the pure mapping from the transport fields of a response to what the UI
 * says about its authority, its reason and its bounds. No React, no antd, no i18n instance: components turn the keys into text, and the unit tests
 * check the mapping itself.
 *
 * The rules this module owns:
 *  - Only a Precise, MOA-independent, certified optimum is shown as PROVED. Fast results (including Fast TrueErgo / Prevent Overswing) and results
 *    that lean on the provisional MOA model are labelled APPROXIMATE; a verified build without a proof is FEASIBLE; no verified build is INCOMPLETE;
 *    only a certified emptiness is INFEASIBLE. An inconsistent record (a status that claims more than its certificate and qualifications support)
 *    is never promoted: it is downgraded.
 *  - Every public reason has one localized message keyed by the reason's constant (`reasons.<constantName>`). Retry/timeout advice comes from the
 *    factual reason only (time, node or native solution limit), never from `termination: 'limit'` alone. `Cancelled by user` is a cancel, not an
 *    error. A reason outside the closed set (an Explore E-row diagnostic) is shown as it is, in a neutral style.
 *  - A bound that is `null` (unknown) is never formatted as a number and never shown as zero.
 */

import type { ExploreStepOutcome, OptimizationMetadata, OptimizeResponse } from '../../api/client';
import { PUBLIC_REASONS } from '../../solver/physical/reasons';

// ---------------------------------------------------------------------------------------------
// Authority
// ---------------------------------------------------------------------------------------------

export type AuthorityLevel =
  /** A proved optimum: Precise, MOA-independent, certified. */
  | 'certified_optimal'
  /** The optimum of an approximate model: Fast, or leaning on the provisional MOA model. Not proved. */
  | 'approximate_optimal'
  /** A verified build; the optimum is not proved. */
  | 'feasible'
  /** No verified build, and no proof that none exists. */
  | 'incomplete'
  /** Proved: no build satisfies the request. */
  | 'certified_infeasible'
  | 'error';

export type Tone = 'success' | 'info' | 'warning' | 'error';

/** Why a result carries a caveat besides its level: the model it ran on. */
export type Qualifier = 'fast_model' | 'provisional_moa';

/** The fields of a response that decide its authority (an Optimize response, an Explore point or an Explore step row). */
export interface AuthorityInput {
  status: OptimizeResponse['status'];
  physical_certificate: OptimizeResponse['physical_certificate'];
  model_qualification: OptimizeResponse['model_qualification'];
  moa_qualification: OptimizeResponse['moa_qualification'];
  precision_resolved: OptimizeResponse['precision_resolved'];
}

export interface Authority {
  level: AuthorityLevel;
  tone: Tone;
  /** i18n key of the one-line headline, `results.authority_<level>`. */
  titleKey: string;
  /** i18n keys of the caveats, `results.qualifier_<qualifier>`: the Fast model, the provisional MOA model. */
  qualifiers: Qualifier[];
  /** True only for a proved optimum or a proved emptiness. Never true for an approximate or feasible result. */
  proved: boolean;
  /** A verified build is published (status optimal or feasible). */
  hasBuild: boolean;
}

/** Antd tag colour per tone (preset colour names resolve through the theme, so light and dark both work). */
export const TONE_TAG_COLOR: Record<Tone, string> = { success: 'success', info: 'processing', warning: 'warning', error: 'error' };

const TONE: Record<AuthorityLevel, Tone> = {
  certified_optimal: 'success',
  approximate_optimal: 'info',
  feasible: 'warning',
  incomplete: 'warning',
  certified_infeasible: 'error',
  error: 'error',
};

/** The caveats of the model a result ran on: the Fast count model, and the provisional MOA model. */
export function qualifiersOf(r: Pick<AuthorityInput, 'model_qualification' | 'moa_qualification' | 'precision_resolved'>): Qualifier[] {
  const qualifiers: Qualifier[] = [];
  if (r.model_qualification === 'approximate' || r.precision_resolved === 'fast') qualifiers.push('fast_model');
  if (r.moa_qualification === 'provisional_model') qualifiers.push('provisional_moa');
  return qualifiers;
}

export function levelOf(r: AuthorityInput): AuthorityLevel {
  switch (r.status) {
    case 'optimal':
      // PROVED only when the status, the certificate and the qualifications all say so; anything less is the optimum of an approximate model.
      return r.physical_certificate === 'certified_optimal' && r.model_qualification !== 'approximate' && r.precision_resolved !== 'fast'
        && r.moa_qualification === null
        ? 'certified_optimal'
        : 'approximate_optimal';
    case 'feasible':
      return 'feasible';
    case 'infeasible':
      // An emptiness is proved only with its certificate; without it nothing is claimed about the absence of builds.
      return r.physical_certificate === 'certified_infeasible' ? 'certified_infeasible' : 'incomplete';
    case 'error':
      return 'error';
    default:
      return 'incomplete';
  }
}

export function authorityOf(r: AuthorityInput): Authority {
  const level = levelOf(r);
  return {
    level,
    tone: TONE[level],
    titleKey: `results.authority_${level}`,
    qualifiers: qualifiersOf(r),
    proved: level === 'certified_optimal' || level === 'certified_infeasible',
    hasBuild: r.status === 'optimal' || r.status === 'feasible',
  };
}

/** i18n key of a qualifier chip. */
export const qualifierKey = (q: Qualifier): string => `results.qualifier_${q}`;

// ---------------------------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------------------------

type ReasonName = keyof typeof PUBLIC_REASONS;

export type ReasonKind =
  /** The user cancelled: not an error. */
  | 'cancel'
  /** A factual interrupt: the clock, the node cap or the native solution cap stopped the search. */
  | 'limit'
  /** A model searched to completion and found no build (Fast or provisional-MOA): not a proof about the game. */
  | 'model_empty'
  /** The request was rejected before any model work. */
  | 'input'
  /** The request's own time ran out while it waited. */
  | 'queue'
  /** A build was withheld because the independent validator rejected it. */
  | 'validation'
  /** A requirement of a proof was unavailable. */
  | 'prerequisite'
  /** Text outside the closed set (an Explore E-row diagnostic): shown as it is. */
  | 'unknown';

/** The kind of every public reason. Typed over the closed set: adding a reason to `PUBLIC_REASONS` fails to compile until it is classified here. */
const REASON_KIND: Record<ReasonName, ReasonKind> = {
  approximateModelInfeasible: 'model_empty',
  provisionalMoaModelInfeasible: 'model_empty',
  fastProvisionalMoaModelInfeasible: 'model_empty',
  invalidOwnedItems: 'input',
  invalidExploreSchedule: 'input',
  queueTimeoutBeforeDispatch: 'queue',
  independentBuildValidationFailed: 'validation',
  requiredProofPrerequisiteUnavailable: 'prerequisite',
  cancelledByUser: 'cancel',
  timeLimitReached: 'limit',
  nodeLimitReached: 'limit',
  nativeSolutionLimitReached: 'limit',
};

/** The reasons that carry retry advice: the three factual interrupts, and only them. */
const ADVICE: Partial<Record<ReasonName, true>> = { timeLimitReached: true, nodeLimitReached: true, nativeSolutionLimitReached: true };

const NAME_BY_TEXT: ReadonlyMap<string, ReasonName> = new Map(
  (Object.entries(PUBLIC_REASONS) as [ReasonName, string][]).map(([name, text]) => [text, name]),
);

/** i18n key of the message of a public reason: one per constant, `reasons.<constantName>`. */
export const reasonKey = (name: ReasonName): string => `reasons.${name}`;
/** i18n key of the retry advice of a limit reason, `reasons.advice_<constantName>`. */
export const adviceKey = (name: ReasonName): string => `reasons.advice_${name}`;

/** Every i18n key the reason layer can ask for (messages and advice): the locale tests check each one exists in every language. */
export function allReasonKeys(): string[] {
  const names = Object.keys(PUBLIC_REASONS) as ReasonName[];
  return [...names.map(reasonKey), ...names.filter(n => ADVICE[n] === true).map(adviceKey)];
}

export interface ReasonView {
  /** The reason exactly as the response carries it. */
  text: string;
  /** The constant name of a public reason, `null` for text outside the closed set. */
  name: ReasonName | null;
  /** i18n key of the localized message, `null` for text outside the closed set (shown as it is). */
  key: string | null;
  kind: ReasonKind;
  /** i18n key of the retry advice; present only for a factual limit reason. */
  adviceKey: string | null;
  /** The user cancelled this request. */
  cancelled: boolean;
}

/** The view of a reason, `null` when the response carries none. */
export function reasonViewOf(reason: string | null | undefined): ReasonView | null {
  if (reason === undefined || reason === null || reason === '') return null;
  const name = NAME_BY_TEXT.get(reason);
  if (name === undefined) return { text: reason, name: null, key: null, kind: 'unknown', adviceKey: null, cancelled: false };
  const kind = REASON_KIND[name];
  return {
    text: reason,
    name,
    key: reasonKey(name),
    kind,
    adviceKey: ADVICE[name] === true ? adviceKey(name) : null,
    cancelled: kind === 'cancel',
  };
}

// ---------------------------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------------------------

export interface BoundsView {
  /** Formatted values, `null` when the bound is unknown. */
  lower: string | null;
  upper: string | null;
  gap: string | null;
  tolerance: string | null;
  /** At least one of the three proof numbers is known. */
  anyKnown: boolean;
}

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Format the bounds of a result; every nullable number is guarded before `toPrecision`. */
export function boundsViewOf(o: Partial<Pick<OptimizationMetadata, 'lower_bound' | 'upper_bound' | 'absolute_gap' | 'tolerance'>> | null | undefined): BoundsView {
  const lower = finite(o?.lower_bound) ? o.lower_bound.toPrecision(5) : null;
  const upper = finite(o?.upper_bound) ? o.upper_bound.toPrecision(5) : null;
  const gap = finite(o?.absolute_gap) ? o.absolute_gap.toPrecision(3) : null;
  const tolerance = finite(o?.tolerance) ? o.tolerance.toPrecision(3) : null;
  return { lower, upper, gap, tolerance, anyKnown: lower !== null || upper !== null || gap !== null };
}

// ---------------------------------------------------------------------------------------------
// The status line of one result
// ---------------------------------------------------------------------------------------------

export interface ResultView {
  authority: Authority;
  reason: ReasonView | null;
  bounds: BoundsView;
  /** The user cancelled (the reason says so): shown as a cancel, not an error or a failure. */
  cancelled: boolean;
  /** Tone of the alert: a cancel is informational whatever the level. */
  tone: Tone;
}

export function resultViewOf(r: AuthorityInput & Pick<OptimizeResponse, 'optimization' | 'reason'>): ResultView {
  const authority = authorityOf(r);
  const reason = reasonViewOf(r.reason);
  const cancelled = reason?.cancelled === true;
  return { authority, reason, bounds: boundsViewOf(r.optimization), cancelled, tone: cancelled ? 'info' : authority.tone };
}

// ---------------------------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------------------------

export interface ToastSpec {
  type: 'success' | 'info' | 'warning' | 'error';
  /** i18n key of the message. */
  key: string;
  /** The reason message to append, when there is one. */
  reason: ReasonView | null;
}

/**
 * The toast of a finished Optimize (or Gunsmith) request. One message per authority level, so a toast never calls an approximate or feasible
 * result "complete"; a cancel is an info toast, never an error.
 */
export function toastOf(r: ResultView, kind: 'optimize' | 'gunsmith'): ToastSpec {
  if (r.cancelled) return { type: 'info', key: 'toast.cancelled', reason: null };
  switch (r.authority.level) {
    case 'certified_optimal': return { type: 'success', key: kind === 'gunsmith' ? 'toast.gunsmith_success' : 'toast.optimize_success', reason: null };
    case 'approximate_optimal': return { type: 'info', key: 'toast.optimize_approximate', reason: r.reason };
    case 'feasible': return { type: 'warning', key: 'toast.optimize_feasible', reason: r.reason };
    case 'incomplete': return { type: 'warning', key: 'toast.optimize_incomplete', reason: r.reason };
    case 'certified_infeasible': return { type: 'error', key: kind === 'gunsmith' ? 'toast.gunsmith_infeasible' : 'toast.optimize_infeasible', reason: r.reason };
    case 'error': return { type: 'error', key: kind === 'gunsmith' ? 'toast.gunsmith_failed' : 'toast.optimize_failed', reason: r.reason };
  }
}

/** The authority of one Explore step row (it carries the same fields as a response). */
export const authorityOfStep = (row: Pick<ExploreStepOutcome, 'status' | 'physical_certificate' | 'model_qualification' | 'moa_qualification' | 'precision_resolved'>): Authority =>
  authorityOf(row);
