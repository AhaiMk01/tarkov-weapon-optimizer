/**
 * Solver entry points: `solve` and `computeIdealPoint` (Stage 2 correctness cutover, Phase 2.4b-3b).
 *
 * Two models, one acceptance rule. Nothing is published that the independent physical validator (`physical/validate.ts`) did not accept,
 * and every published statistic is the validator's exact recomputation.
 *
 *  - Precise (`preciseMode: true`, forced by TrueErgo and Prevent Overswing): the exact occurrence-level model of `physical/`
 *    (`solvePrecise`). Multiple copies, physical slots, the exact wallet, preset/owned supply. TED requests run the spatial search.
 *  - Fast (everything else): the template-count model of `physical/specializeFast.ts` on the same physical domain, acquisition and request as
 *    Precise (only placement is approximated: counts per template and per slot edge, no ancestor-repetition rule), solved on the same pinned
 *    native build. Its counts are decoded into a rooted occurrence tree and judged by the same exact validator; a rejected point is cut out and
 *    the model re-solved, and a result that is not a valid physical build is `incomplete`, never published (`physical/solveFast.ts`).
 *
 * Statuses and reasons are the minimal set of this phase (the full ADR 0013 sections 5 and 6 transport is Phase 2.6):
 *   optimal       the search completed with a justified gap within the tolerance (Fast: the native solve was optimal, an approximate optimum)
 *   feasible      a verified build, search not complete or gap not justified
 *   infeasible    Precise, MOA-independent emptiness confirmed with presolve off (never a presolved verdict alone)
 *   incomplete    anything else: a Precise emptiness under a MOA cap, Fast emptiness, a limit with no verified build, a rejected build
 * A native failure is a typed error (`SolverError`), never a fabricated result.
 */

import type { OptimizeResponse, ItemDetail, PresetDetail, FinalStats } from '../api/client';
import type { SolveParams, GunLookupEntry, IdealPoint, ModLookupEntry } from './types';
export type { SolveParams, IdealPoint } from './types';
import { objectiveModel, objectiveScore, tedContribution } from './trueErgo';
import type { ObjectiveAxes } from './trueErgo';
import { canonicalizeTraderLevels } from './reuseKey';
import { mergeComponents, presetSupply } from './presetSupply';
import { setHighsBaseUrl } from './native';
import { legalOffers, resolveMarket } from './physical/acquisition';
import { axesOfStats } from './physical/objective';
import { inspectOwnedItems } from './physical/ownedItems';
import { PUBLIC_REASONS } from './physical/reasons';
import { solveFast } from './physical/solveFast';
import { solvePrecise } from './physical/solvePrecise';
import type { PreciseSummary } from './physical/solvePrecise';
import type { PhysicalBuild, PhysicalBuildStats } from './physical/validate';

/**
 * The shipped highs.js solve() returned only Status, ObjectiveValue, Columns and Rows: no dual bound, gap or node count.
 * Kept for the benchmark experiments that still read it (Phase 2.9); `solve` no longer uses it.
 * @deprecated
 */
export function classifyMipStatus(status: string): 'optimal' | 'infeasible' | 'limit' | 'other' {
  if (status === 'Optimal') return 'optimal';
  if (status === 'Infeasible') return 'infeasible';
  if (
    status === 'Time limit reached'
    || status === 'Iteration limit reached'
    || status === 'Target for objective reached'
    || status === 'Bound on objective reached'
  ) return 'limit';
  return 'other';
}

/**
 * Upper bound only after Optimal: the solver's own objective, with NO fixed margin. The pre-cutover code added a nominal 1e-7 to every
 * bound; that constant had no error analysis and made a requested tolerance below it impossible to certify. The proved allowance for
 * native, secant and frame error is Phase 2.5 (`physical/search.ts` `nodeUpperBound` is the seam).
 * @deprecated Kept for the benchmark experiments that still read it (Phase 2.9); `solve` uses the structured native bound.
 */
export function certifiedDualBound(status: string, objectiveValue: number | undefined): number | undefined {
  if (classifyMipStatus(status) !== 'optimal') return undefined;
  if (objectiveValue == null || !Number.isFinite(objectiveValue)) return undefined;
  return objectiveValue;
}

/**
 * A MIP column vector may update the incumbent only when every expected decision column is present and integral and exactly one purchase
 * base is selected, and the independent build validator reports no errors. Pure column check of the legacy template model.
 * @deprecated Kept for the benchmark experiments that still read it (Phase 2.9); `solve` validates through `physical/validate.ts`.
 */
export function incumbentBlockReason(
  columns: Record<string, { Primal?: number } | undefined>,
  expectedColumns: readonly string[],
  nBases: number,
  validationErrors: readonly string[],
): string | undefined {
  for (const name of expectedColumns) {
    const primal = columns[name]?.Primal;
    if (primal == null || !Number.isFinite(primal)) return `Missing decision column ${name}`;
    if (Math.abs(primal - Math.round(primal)) > 1e-7) return `Nonintegral decision column ${name}`;
  }
  let bases = 0;
  for (let b = 1; b <= nBases; b++) {
    const primal = columns[`base_${b}`]?.Primal;
    if (primal != null && primal > 0.5) bases++;
  }
  if (bases !== 1) return `Decoded solution selected ${bases} purchase bases`;
  if (validationErrors.length) return `Independent build validation failed: ${validationErrors.join('; ')}`;
  return undefined;
}

/**
 * Solver features supported by this build.
 * Benchmark runners check this to avoid running candidate flags against legacy code.
 */
export const SOLVER_CAPABILITIES = {
  retainLimitIncumbent: false,
  branchOrdering: false,
  initialCandidate: false,
} as const;

// HiGHS is the pinned native build behind ./native (see vendor/highs/README.md). The loader hash-checks both artifacts and
// validates the ABI against the committed manifest, and throws a typed error on any mismatch: there is no fallback to the
// stock npm package or to any other HiGHS. The Vite base is the browser location of highs.js / highs.wasm.
setHighsBaseUrl((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL || '/');

const now = (): number => performance.now();

/** The result of one solve plus the objective axes of its build (what a payoff-table endpoint reads). */
interface Detailed {
  response: OptimizeResponse;
  axes?: ObjectiveAxes;
}

/** The payoff table could not be computed. `endpoint` is the response of the endpoint solve that failed, when there is one. */
class PayoffTableError extends Error {
  readonly reason: string;
  readonly endpoint: OptimizeResponse | null;

  constructor(reason: string, endpoint: OptimizeResponse | null) {
    super(`Ideal-point endpoint not certified: ${reason}`);
    this.name = 'PayoffTableError';
    this.reason = reason;
    this.endpoint = endpoint;
  }
}

/**
 * Endpoint payoff table (ADR 0013 section 4D): three solves with weights [100, 0, 0], [0, 100, 0] and [0, 0, 100], in the SAME frames as
 * the final objective (fE = 10 x ergonomics or TED, fR = 1000 x recoil modifier sum, fP = RUB spend). Each endpoint keeps every user
 * feasibility constraint and must be certified optimal; the six coordinates are derived from those three vectors.
 */
export async function computeIdealPoint(params: SolveParams): Promise<IdealPoint> {
  const deadline = now() + Math.max(0, params.timeLimitMs ?? 60_000);
  const base = { ...params, useTchebycheff: false, idealPoint: undefined };
  const pay: ObjectiveAxes[] = [];
  for (const weights of [[100, 0, 0], [0, 100, 0], [0, 0, 100]]) {
    const remaining = deadline - now();
    if (remaining <= 0) throw new PayoffTableError(PUBLIC_REASONS.timeLimitReached, null);
    const r = await solveDetailed({ ...base, timeLimitMs: remaining, ergoWeight: weights[0], recoilWeight: weights[1], priceWeight: weights[2] });
    if (r.response.status !== 'optimal' || !r.axes) throw new PayoffTableError(r.response.reason ?? r.response.status, r.response);
    pay.push(r.axes);
  }
  return {
    zE: Math.max(...pay.map(p => p.fE)), nadE: Math.min(...pay.map(p => p.fE)),
    zR: Math.min(...pay.map(p => p.fR)), nadR: Math.max(...pay.map(p => p.fR)),
    zP: Math.min(...pay.map(p => p.fP)), nadP: Math.max(...pay.map(p => p.fP)),
  };
}

export async function solve(params: SolveParams): Promise<OptimizeResponse> {
  return (await solveDetailed(params)).response;
}

// ---------------------------------------------------------------------------------------------
// Response assembly (shared by Precise and Fast: both publish a validated PhysicalBuild)
// ---------------------------------------------------------------------------------------------

interface ResponseExtras {
  reason?: string;
  optimization?: OptimizeResponse['optimization'];
  idealPoint?: IdealPoint;
}

function withoutBuild(status: 'incomplete' | 'infeasible', reason: string | undefined, start: number, extras: ResponseExtras): OptimizeResponse {
  return {
    status,
    ...(reason === undefined ? {} : { reason }),
    selected_items: [],
    selected_item_ids: [],
    slot_pairs: [],
    objective_value: 0,
    solve_time_ms: now() - start,
    ...(extras.idealPoint === undefined ? {} : { ideal_point: extras.idealPoint }),
  };
}

const incomplete = (reason: string, start: number, extras: ResponseExtras = {}): Detailed =>
  ({ response: withoutBuild('incomplete', reason, start, extras) });

/** A proved or admitted emptiness (Precise: infeasible, or incomplete under a MOA cap; Fast: incomplete with the approximate-model reason). */
function emptyOutcome(params: SolveParams, mode: 'precise' | 'fast', start: number, extras: ResponseExtras): Detailed {
  const moa = params.maxMOA != null;
  if (mode === 'fast') {
    return incomplete(moa ? PUBLIC_REASONS.fastProvisionalMoaModelInfeasible : PUBLIC_REASONS.approximateModelInfeasible, start, extras);
  }
  if (moa) return incomplete(PUBLIC_REASONS.provisionalMoaModelInfeasible, start, extras);
  return { response: withoutBuild('infeasible', undefined, start, extras) };
}

const imageOf = (data: Record<string, unknown>): { icon?: string; large?: string } => ({
  icon: (data.image512pxLink ?? data.imageLink ?? data.image8xLink ?? data.iconLink ?? data.iconLinkFallback) as string | undefined,
  large: (data.image512pxLink ?? data.imageLink ?? data.image8xLink) as string | undefined,
});

function itemDetails(params: SolveParams, build: PhysicalBuild, stats: PhysicalBuildStats): ItemDetail[] {
  const equip = params.equipErgoModifier ?? 0;
  const provenance = new Map(stats.acquisition.occurrences.map(o => [o.instanceId, o]));
  const details: ItemDetail[] = [];
  for (const placement of build.placements) {
    const entry = params.itemLookup[placement.itemId] as ModLookupEntry;
    const data = entry.data as Record<string, unknown>;
    const ms = entry.stats;
    const { icon, large } = imageOf(data);
    const occurrence = provenance.get(placement.childInstanceId);
    const detail: ItemDetail = {
      id: placement.itemId,
      instanceId: placement.childInstanceId,
      name: (data.name as string | undefined) ?? 'Unknown',
      price: occurrence?.price ?? 0,
      icon,
      image_large: large || undefined,
      source: occurrence?.offerSource ?? undefined,
      purchasable: ms.purchasable,
      reference_price_rub: ms.reference_price_rub,
      ergonomics: ms.ergonomics || 0,
      recoil_modifier: ms.recoil_modifier || 0,
      accuracy_modifier: ms.accuracy_modifier || undefined,
      weight: ms.weight || undefined,
      category: ms.category || undefined,
      handbook_categories: ms.handbook_categories?.length ? ms.handbook_categories : undefined,
      capacity: ms.capacity || undefined,
      sighting_range: ms.sighting_range || undefined,
    };
    if (occurrence) {
      detail.acquisition = { source: occurrence.source === 'unavailable' ? 'offer' : occurrence.source, presetId: occurrence.presetId, offerSource: occurrence.offerSource, offerIndex: occurrence.offerIndex };
      if (occurrence.source === 'offer' && occurrence.offerIndex !== null) {
        const requirements = ms.offers[occurrence.offerIndex]?.barter_requirements;
        if (requirements) detail.barter_requirements = requirements;
      }
    }
    if (detail.weight != null || detail.ergonomics) {
      detail.ted_delta = tedContribution(stats.rawErgonomics, stats.weight, detail.ergonomics || 0, detail.weight || 0, equip);
    }
    details.push(detail);
  }
  return details;
}

/** The cheapest legal offer of a base and the seller it names; ties keep the earlier offer, as the exact cover does. */
function cheapestLegalOffer(
  offers: GunLookupEntry['stats']['offers'], gate: number, market: ReturnType<typeof resolveMarket>,
): { source: string; label: string; barterRequirements?: PresetDetail['barter_requirements'] } | undefined {
  let best: ReturnType<typeof legalOffers>[number] | undefined;
  for (const offer of legalOffers(offers, gate, market)) if (best === undefined || offer.price < best.price) best = offer;
  if (best === undefined) return undefined;
  const info = offers[best.index];
  return {
    source: best.source,
    label: best.source === 'fleaMarket' ? 'Flea Market' : (info.vendor_name || info.vendor_normalized || best.source),
    ...(best.source.startsWith('barter:') && info.barter_requirements ? { barterRequirements: info.barter_requirements } : {}),
  };
}

const fleaGateOf = (stats: object): number => {
  const gate = (stats as { min_level_flea?: unknown }).min_level_flea;
  return typeof gate === 'number' ? gate : 0;
};

function presetDetail(params: SolveParams, build: PhysicalBuild, stats: PhysicalBuildStats): PresetDetail {
  const weapon = params.itemLookup[params.weaponId] as GunLookupEntry;
  const wStats = weapon.stats;
  const market = resolveMarket(params);
  const tooltip = {
    caliber: wStats.caliber || undefined,
    fire_rate: wStats.fire_rate || undefined,
    fire_modes: wStats.fire_modes?.length ? wStats.fire_modes : undefined,
    default_ergo: wStats.default_ergonomics || undefined,
    default_recoil_v: wStats.default_recoil_v || undefined,
    default_recoil_h: wStats.default_recoil_h || undefined,
    weight: wStats.weight || undefined,
  };
  const basePrice = stats.basePrice ?? 0;
  if (build.base.kind === 'naked') {
    const data = weapon.data as Record<string, unknown>;
    const seller = cheapestLegalOffer(wStats.offers, fleaGateOf(wStats), market);
    return {
      id: params.weaponId,
      name: (data.name as string | undefined) ?? 'Naked Gun',
      price: basePrice,
      receiver_id: params.weaponId,
      items: [],
      icon: (data.iconLink ?? data.iconLinkFallback ?? wStats.default_preset_image) as string | undefined,
      image_large: (data.image512pxLink ?? data.imageLink ?? data.image8xLink) as string | undefined,
      source: seller?.source,
      purchase_label: seller?.label,
      barter_requirements: seller?.barterRequirements,
      ...tooltip,
    };
  }
  const presetId = build.base.presetId;
  const preset = weapon.all_presets.find(p => p.id === presetId);
  if (!preset) throw new Error(`Validated preset ${presetId} is not a preset of ${params.weaponId}`);
  const seller = cheapestLegalOffer(preset.offers, fleaGateOf(preset), market);
  return {
    id: preset.id,
    name: preset.name,
    price: basePrice,
    receiver_id: preset.receiver_id,
    items: mergeComponents(preset.items ?? []),
    icon: preset.image ?? undefined,
    image_large: preset.image ?? undefined,
    source: seller?.source ?? (preset.price_source && preset.price_source !== 'not_available' ? preset.price_source : undefined),
    purchase_label: seller?.label ?? (preset.price_source === 'fleaMarket' ? 'Flea Market' : undefined),
    barter_requirements: seller?.barterRequirements,
    parts_count: presetSupply(preset.items).size || undefined,
    ...tooltip,
  };
}

function finalStatsOf(stats: PhysicalBuildStats): FinalStats {
  return {
    ergonomics: stats.ergonomics,
    recoil_vertical: stats.recoilVertical,
    recoil_horizontal: stats.recoilHorizontal,
    total_price: stats.spend,
    total_weight: stats.weight,
    true_ergo_delta: stats.ted,
    overswing_pct: stats.overswingPercent,
    moa: stats.moa,
  };
}

/** The published build: the installed multiset, placements, base and statistics all come from the validated build and its exact stats. */
function buildOutcome(
  params: SolveParams, build: PhysicalBuild, stats: PhysicalBuildStats, status: 'optimal' | 'feasible', start: number, extras: ResponseExtras,
): Detailed {
  const useTrueErgo = params.useTrueErgo === true;
  const axes = axesOfStats(stats, useTrueErgo);
  const response: OptimizeResponse = {
    status,
    ...(extras.reason === undefined ? {} : { reason: extras.reason }),
    selected_items: itemDetails(params, build, stats),
    selected_item_ids: build.placements.map(p => p.itemId),
    selected_preset: presetDetail(params, build, stats),
    slot_pairs: build.placements.map(p => ({ ...p })),
    objective_value: objectiveScore(objectiveModel(params), axes),
    final_stats: finalStatsOf(stats),
    solve_time_ms: now() - start,
    ...(extras.optimization === undefined ? {} : { optimization: extras.optimization }),
    ...(extras.idealPoint === undefined ? {} : { ideal_point: extras.idealPoint }),
  };
  return { response, axes };
}

function optimizationOf(summary: PreciseSummary): NonNullable<OptimizeResponse['optimization']> {
  // An unknown bound has no number yet: it is transported as Infinity until the nullable transport of Phase 2.6.
  return {
    lower_bound: summary.lowerBound ?? -Infinity,
    upper_bound: summary.upperBound,
    absolute_gap: summary.gap ?? Infinity,
    tolerance: summary.tolerance,
    nodes: summary.nodes,
    termination: summary.completed ? 'optimal' : 'limit',
  };
}

// ---------------------------------------------------------------------------------------------
// Precise
// ---------------------------------------------------------------------------------------------

async function solveExact(params: SolveParams, deadline: number, start: number, extras: ResponseExtras): Promise<Detailed> {
  const result = await solvePrecise({ params, deadline, now });
  if (result.kind === 'empty') return emptyOutcome(params, 'precise', start, extras);
  if (result.kind === 'incomplete') return incomplete(result.reason, start, extras);
  const { best, certified } = result;
  return buildOutcome(params, best.build, best.stats, certified ? 'optimal' : 'feasible', start, {
    ...extras,
    ...(result.reason === undefined ? {} : { reason: result.reason }),
    ...(result.summary.spatial ? { optimization: optimizationOf(result.summary) } : {}),
  });
}

// ---------------------------------------------------------------------------------------------
// Fast
// ---------------------------------------------------------------------------------------------

/**
 * The approximate model's outcome: a verified build is `optimal` when the native solve was (the build is the best point of the approximate
 * model that the exact validator accepts), otherwise `feasible` with the solver's stop reason; emptiness is incomplete with the approximate-model
 * reason, never infeasible.
 */
async function solveApproximate(params: SolveParams, deadline: number, start: number, extras: ResponseExtras): Promise<Detailed> {
  const result = await solveFast({ params, deadline, now });
  if (result.kind === 'empty') return emptyOutcome(params, 'fast', start, extras);
  if (result.kind === 'incomplete') return incomplete(result.reason, start, extras);
  return buildOutcome(params, result.best.build, result.best.stats, result.optimal ? 'optimal' : 'feasible', start, result.optimal ? extras : { ...extras, reason: result.reason });
}

// ---------------------------------------------------------------------------------------------
// Request driver
// ---------------------------------------------------------------------------------------------

async function solveDetailed(input: SolveParams): Promise<Detailed> {
  const start = now();
  const deadline = start + Math.max(0, input.timeLimitMs ?? 60_000);
  const owned = inspectOwnedItems(input.ownedItems);
  if (!owned.ok) return incomplete(owned.reason, start);
  let params: SolveParams = { ...input };
  if (params.traderLevels) params.traderLevels = canonicalizeTraderLevels(params.traderLevels) as SolveParams['traderLevels'];
  // Certificates describe real slot placements, not the Fast model's restrictions.
  if (params.useTrueErgo || params.preventOverswing) params.preciseMode = true;
  if (params.useTchebycheff && !params.idealPoint) {
    try {
      params = { ...params, idealPoint: await computeIdealPoint({ ...params, timeLimitMs: Math.max(0, deadline - now()) }) };
    } catch (error) {
      if (error instanceof PayoffTableError) {
        // An endpoint that proves the request empty proves it for every objective; any other failure leaves the table unavailable.
        const endpoint = error.endpoint;
        const empty = endpoint !== null && (endpoint.status === 'infeasible' || endpoint.reason === PUBLIC_REASONS.provisionalMoaModelInfeasible
          || endpoint.reason === PUBLIC_REASONS.approximateModelInfeasible || endpoint.reason === PUBLIC_REASONS.fastProvisionalMoaModelInfeasible);
        if (empty) return { response: { ...endpoint, solve_time_ms: now() - start } };
        return incomplete(error.reason === PUBLIC_REASONS.timeLimitReached ? error.reason : PUBLIC_REASONS.requiredProofPrerequisiteUnavailable, start);
      }
      throw error;
    }
  }
  if (now() >= deadline) return incomplete(PUBLIC_REASONS.timeLimitReached, start, { idealPoint: params.useTchebycheff ? params.idealPoint : undefined });
  const extras: ResponseExtras = { idealPoint: params.useTchebycheff ? params.idealPoint : undefined };
  return params.preciseMode ? solveExact(params, deadline, start, extras) : solveApproximate(params, deadline, start, extras);
}

