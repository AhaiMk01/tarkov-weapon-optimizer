/**
 * How the MOA floor is shown and used (ADR 0013 sections 5 and 6, Phase 2.8). The floor is a bracket on the minimum MOA of the PROVISIONAL model,
 * never a game-physical minimum, and it is always presented as such.
 *
 *   model_proved      the minimum of the provisional model is proved to within 0.02 MOA; `display_floor` is its outward 2-decimal value
 *   model_witnessed   a build reaching `display_floor` exists, but the minimum is NOT proved ("best witnessed MOA - minimum not proved")
 *   unresolved        no build was found; nothing is known
 *   model_infeasible  the request has no build at all under the provisional model, so no MOA cap can be met
 *
 * The MOA control's lower end comes from `display_floor` (2 decimals, at least the achieved floor) when there is one, and from the theoretical
 * estimate otherwise. A missing floor is `null`, never 0: nothing here substitutes a number for an unknown one.
 *
 * Pure: no React, no worker, no solver imports.
 */

import type { MOAFloorResponse } from '../../api/client';
import { completionOf } from '../../solver/runtimeErrors';
import { reasonViewOf } from './resultView';
import type { ReasonView, Tone } from './resultView';

export type FloorKind = 'proved' | 'witnessed' | 'unresolved' | 'infeasible';

export interface FloorView {
  kind: FloorKind;
  tone: Tone;
  /** i18n key of the headline, `moa_floor.<kind>`. */
  titleKey: string;
  /** The displayed floor with two decimals, `null` when none is safe to display. */
  display: string | null;
  /**
   * The value that may drive the MOA control's lower end: `display_floor` when it is finite and at least the achieved floor, else `null`. It is
   * also `null` for a floor that was cut short (a cancel, a solver failure): its best witness is only an upper bound of the minimum, often the
   * poor seed, and a search the user stopped must not narrow the caps they may choose.
   */
  sliderMin: number | null;
  /** The search was cut short (cancelled by the user, or a solver failure that retained its state) and did not prove its minimum. */
  interrupted: boolean;
  /** The proved lower end of the bracket, formatted, `null` when none was proved. */
  provedLower: string | null;
  reason: ReasonView | null;
  /** The floor is a result of the provisional MOA model. Always true. */
  provisional: true;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The display floor if it can safely drive the control: finite, and not below the achieved floor it must contain. */
export function usableDisplayFloor(r: Pick<MOAFloorResponse, 'display_floor' | 'floor'>): number | null {
  if (!isFiniteNumber(r.display_floor)) return null;
  if (isFiniteNumber(r.floor) && r.display_floor < r.floor) return null;
  return r.display_floor;
}

const KIND: Record<MOAFloorResponse['status'], FloorKind> = {
  model_proved: 'proved',
  model_witnessed: 'witnessed',
  unresolved: 'unresolved',
  model_infeasible: 'infeasible',
};

const TONE: Record<FloorKind, Tone> = { proved: 'success', witnessed: 'warning', unresolved: 'warning', infeasible: 'error' };

/**
 * `interrupted`: the response is the state a failed request retained (a `CancellationError` snapshot, a `SolverError`'s completion), which is cut
 * short by definition, whatever its reason says. A response that carries `Cancelled by user` without a proved minimum is cut short too.
 */
export function floorViewOf(r: MOAFloorResponse, options: { interrupted?: boolean } = {}): FloorView {
  const kind = KIND[r.status] ?? 'unresolved';
  const reason = reasonViewOf(r.reason);
  const interrupted = kind !== 'proved' && (options.interrupted === true || reason?.cancelled === true);
  const shown = kind === 'proved' || kind === 'witnessed' ? usableDisplayFloor(r) : null;
  const sliderMin = interrupted ? null : shown;
  return {
    kind,
    tone: reason?.cancelled === true && kind !== 'proved' ? 'info' : TONE[kind],
    titleKey: `moa_floor.${kind}`,
    display: shown === null ? null : shown.toFixed(2),
    sliderMin,
    interrupted,
    provedLower: isFiniteNumber(r.proved_lower_bound) ? r.proved_lower_bound.toFixed(2) : null,
    reason,
    provisional: true,
  };
}

/**
 * The MOA control's range. `estimateMin` is the theoretical lower estimate (used only without a floor), `estimateMax` the theoretical upper end.
 * With a floor the lower end IS the floor (no rounding that could move it); the upper end never falls below the lower one.
 */
export function moaSliderRange(floorMin: number | null, estimateMin: number, estimateMax: number): { min: number; max: number } {
  const min = floorMin ?? Math.ceil(estimateMin * 100) / 100;
  return { min, max: Math.max(min, Math.ceil(estimateMax * 100) / 100) };
}

/** The retained floor a failed floor request carried (a `SolverError`'s completion metadata, or a `CancellationError`'s snapshot), or `null`. */
export function retainedFloorOf(error: unknown): MOAFloorResponse | null {
  const fromCompletion = completionOf(error)?.floor;
  if (isFloorResponse(fromCompletion)) return fromCompletion;
  const snapshot = typeof error === 'object' && error !== null ? (error as { snapshot?: unknown }).snapshot : undefined;
  return isFloorResponse(snapshot) ? snapshot : null;
}

/** A published floor snapshot, validated as the shape the UI reads. */
export function isFloorResponse(v: unknown): v is MOAFloorResponse {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.status === 'string' && o.status in KIND && o.moa_qualification === 'provisional_model';
}
