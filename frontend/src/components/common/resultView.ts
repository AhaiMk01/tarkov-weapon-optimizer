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
 *  - PLAIN BY DEFAULT, DETAILS ON DEMAND (owner decision 2026-10-05): what a regular player sees is the `Headline` of a result, exactly one of a
 *    small badge for a normal result ("Best build" only for a proved optimum, "Build found" for every other optimum) or ONE plain sentence for a
 *    result that is off (a notice). Everything else this module computes (authority wording, qualifiers, reason, bounds) is for the collapsed
 *    Details panel. The plain sentences never say "best" or "optimal"; only the proved-optimum badge does.
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
// The headline: what a regular player sees
// ---------------------------------------------------------------------------------------------

/**
 * The plain sentences, one per situation. Each is a localized message `notice.<id>`; there is no sentence for a normal result (a normal result
 * gets a badge instead). The set is closed and every public reason maps into it (`noticeOf`).
 */
export type NoticeId =
  /** A verified build, stopped by the clock; or by the node / native solution cap. */
  | 'feasible_time' | 'feasible_limit'
  /** A verified build with no proof, for any other reason (proof withheld, validation, no reason given). */
  | 'feasible_other'
  /** No build, after the clock; or after the node / native solution cap. */
  | 'none_time' | 'none_limit'
  /** No build, for any other reason. */
  | 'none_other'
  /** The Fast model; or the provisional MOA model, found no build. Not a proof about the game. */
  | 'fast_empty' | 'moa_empty'
  /** Proved: no build satisfies the request. */
  | 'infeasible'
  | 'cancelled_build' | 'cancelled_none'
  | 'invalid_owned' | 'invalid_schedule'
  | 'queue_timeout'
  | 'error';

export const NOTICE_IDS: readonly NoticeId[] = [
  'feasible_time', 'feasible_limit', 'feasible_other', 'none_time', 'none_limit', 'none_other', 'fast_empty', 'moa_empty', 'infeasible',
  'cancelled_build', 'cancelled_none', 'invalid_owned', 'invalid_schedule', 'queue_timeout', 'error',
];

/** i18n key of a plain sentence, `notice.<id>`. */
export const noticeKey = (id: NoticeId): string => `notice.${id}`;

/** The two badges of a normal result. */
export type BadgeId = 'best' | 'found';

/** i18n key of a badge: the only place the words "Best build" appear. */
export const BADGE_KEY: Record<BadgeId, string> = { best: 'results.best_build', found: 'results.build_found' };

/**
 * The one thing a result says by default: a badge (`kind: 'badge'`) for a normal result, a plain sentence (`kind: 'notice'`) for anything that
 * is off. `retry`: running the request again can help, so the run button reads "Retry".
 */
export interface Headline {
  kind: 'badge' | 'notice';
  id: BadgeId | NoticeId;
  /** i18n key of the text. */
  key: string;
  tone: Tone;
  retry: boolean;
}

const badge = (id: BadgeId, tone: Tone): Headline => ({ kind: 'badge', id, key: BADGE_KEY[id], tone, retry: false });
const notice = (id: NoticeId, tone: Tone, retry = false): Headline => ({ kind: 'notice', id, key: noticeKey(id), tone, retry });

/**
 * The plain sentence of a result that is off, or `null` for a normal one (a proved or approximate optimum). Total over the authority levels and
 * the reason kinds, and it never promotes: a cancel wins over everything (it says what the user did, and never calls the build "best"); a limit
 * reason names the limit; the emptiness of a Fast or provisional-MOA model is "no build", never "none exists"; only a certified emptiness says that
 * no build satisfies the constraints.
 */
export function noticeOf(authority: Pick<Authority, 'level' | 'hasBuild'>, reason: ReasonView | null): Headline | null {
  if (reason?.cancelled === true) return authority.hasBuild ? notice('cancelled_build', 'info') : notice('cancelled_none', 'info');
  switch (authority.level) {
    case 'certified_optimal':
    case 'approximate_optimal':
      return null;
    case 'certified_infeasible':
      return notice('infeasible', 'error');
    case 'error':
      return notice('error', 'error', true);
    case 'feasible':
      if (reason?.kind === 'limit') return notice(reason.name === 'timeLimitReached' ? 'feasible_time' : 'feasible_limit', 'warning', true);
      return notice('feasible_other', 'warning');
    case 'incomplete':
      switch (reason?.kind) {
        case 'limit': return notice(reason.name === 'timeLimitReached' ? 'none_time' : 'none_limit', 'warning', true);
        case 'model_empty': return notice(reason.name === 'provisionalMoaModelInfeasible' ? 'moa_empty' : 'fast_empty', 'warning');
        case 'input': return notice(reason.name === 'invalidExploreSchedule' ? 'invalid_schedule' : 'invalid_owned', 'warning');
        case 'queue': return notice('queue_timeout', 'warning', true);
        default: return notice('none_other', 'warning');
      }
  }
}

/** The headline of a result: its notice when it is off, else the badge of its authority ("Best build" only for a proved optimum). */
export function headlineOf(authority: Authority, reason: ReasonView | null): Headline {
  const off = noticeOf(authority, reason);
  if (off !== null) return off;
  return authority.level === 'certified_optimal' ? badge('best', 'success') : badge('found', 'info');
}

/** The quiet facts next to the headline ("367 ms · Fast"): the solve time, and the mode the request ran in. */
export interface MetaView {
  /** Whole milliseconds, `null` when the time is not a positive finite number. */
  ms: number | null;
  /** The mode the user asked for (`auto` resolves per request) and the mode that ran; `null` when the response does not say. */
  request: 'auto' | 'fast' | 'precise' | null;
  mode: 'fast' | 'precise' | null;
}

export function metaOf(r: Partial<Pick<OptimizeResponse, 'solve_time_ms' | 'precision_request' | 'precision_resolved'>>): MetaView {
  const ms = typeof r.solve_time_ms === 'number' && Number.isFinite(r.solve_time_ms) && r.solve_time_ms > 0 ? Math.round(r.solve_time_ms) : null;
  const mode = r.precision_resolved === 'fast' || r.precision_resolved === 'precise' ? r.precision_resolved : null;
  const request = r.precision_request === 'auto' || r.precision_request === 'fast' || r.precision_request === 'precise' ? r.precision_request : null;
  return { ms, request, mode };
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
  /** What a regular player sees: a badge or one plain sentence. The rest of this view is for the Details panel. */
  headline: Headline;
  /** Tone of the alert: that of the headline (a cancel is informational whatever the level). */
  tone: Tone;
  meta: MetaView;
}

export function resultViewOf(r: AuthorityInput & Pick<OptimizeResponse, 'optimization' | 'reason'> & Partial<Pick<OptimizeResponse, 'solve_time_ms' | 'precision_request'>>): ResultView {
  const authority = authorityOf(r);
  const reason = reasonViewOf(r.reason);
  const headline = headlineOf(authority, reason);
  return { authority, reason, bounds: boundsViewOf(r.optimization), cancelled: reason?.cancelled === true, headline, tone: headline.tone, meta: metaOf(r) };
}

// ---------------------------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------------------------

export interface ToastSpec {
  type: 'success' | 'info' | 'warning' | 'error';
  /** i18n key of the message: the proved-optimum toast, or the text of the result's own headline (the "Build found" badge or its plain sentence). */
  key: string;
}

/**
 * The toast of a finished Optimize (or Gunsmith) request. It says what the headline of the result says, so a toast never calls an approximate or
 * feasible result "complete" and a cancel is an info toast, never an error. "complete" is said only of a proved optimum.
 */
export function toastOf(r: ResultView, kind: 'optimize' | 'gunsmith'): ToastSpec {
  const { headline } = r;
  if (headline.id === 'best') return { type: 'success', key: kind === 'gunsmith' ? 'toast.gunsmith_success' : 'toast.optimize_success' };
  return { type: headline.tone, key: headline.key };
}

/** The authority of one Explore step row (it carries the same fields as a response). */
export const authorityOfStep = (row: Pick<ExploreStepOutcome, 'status' | 'physical_certificate' | 'model_qualification' | 'moa_qualification' | 'precision_resolved'>): Authority =>
  authorityOf(row);
