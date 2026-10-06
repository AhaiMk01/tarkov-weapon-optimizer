/**
 * The power-user ("Advanced") menu of the optimize and explore side panels: its defaults and the few pure rules behind it.
 *
 * The menu holds the controls a regular player never needs to touch: the solver precision (Auto / Fast / Precise), "Allow repeated parts" (Fast only,
 * owner decision 2c) and, on the Optimize tab, Sweet Spot Mode (Tchebycheff). Everything here is a plain default: opening the menu is the only way to
 * see or change them, and the default result view says nothing about them.
 *
 * Pure: type-only imports, no DOM.
 */

import type { PrecisionRequest } from '../../api/client';

/** What the menu's controls are set to when nobody has touched them. */
export interface AdvancedState {
  solverPrecision: PrecisionRequest;
  /** Fast only: several copies of one part may be installed. Off means one copy of each part. */
  allowRepeatedParts: boolean;
  /** Optimize tab only. */
  useTchebycheff: boolean;
}

export const ADVANCED_DEFAULTS: Readonly<AdvancedState> = { solverPrecision: 'auto', allowRepeatedParts: false, useTchebycheff: false };

/** localStorage key of the repeated-parts choice (the panel settings persist the same way: one key per setting, `'true'` / `'false'`). */
export const ALLOW_REPEATED_PARTS_STORAGE_KEY = 'allowRepeatedParts';

/** The stored choice: anything but the exact string `'true'` is the default (off). */
export const readAllowRepeatedParts = (stored: string | null | undefined): boolean => stored === 'true';

/**
 * Whether "Allow repeated parts" has anything to act on for this precision: Precise always allows repeats (the control is shown but disabled),
 * Fast uses the option, and Auto may resolve to either, so it stays available.
 */
export const repeatedPartsApply = (precision: PrecisionRequest): boolean => precision !== 'precise';

/** Every control of the menu is at its default (a control the panel does not show, `undefined`, counts as default). */
export function isAdvancedDefault(state: { solverPrecision: PrecisionRequest; allowRepeatedParts: boolean; useTchebycheff?: boolean }): boolean {
  return state.solverPrecision === ADVANCED_DEFAULTS.solverPrecision
    && state.allowRepeatedParts === ADVANCED_DEFAULTS.allowRepeatedParts
    && (state.useTchebycheff ?? ADVANCED_DEFAULTS.useTchebycheff) === ADVANCED_DEFAULTS.useTchebycheff;
}
