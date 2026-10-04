// Declared constants of the reference oracle (ADR 0010 section 2, ADR 0006, ADR 0007).
// Every real-valued constant is an exact rational; none is a binary64 approximation.
import { q, type Q } from './q';

/** fE = ergonomics (or TED) x ERGO_SCALE. ADR 0010 section 2. */
export const ERGO_SCALE: Q = q(10);
/** fR = summed recoil modifier x SCALE. ADR 0010 section 2. */
export const SCALE: Q = q(1000);
/** Tchebycheff augmentation weight, exactly one hundredth. ADR 0010 section 2. */
export const AUGMENTATION: Q = q(1, 100);
/** MOA per unit of centre of impact: K = 100 / 2.9089 = 1000000 / 29089. ADR 0006 section 5. */
export const MOA_K: Q = q(1000000, 29089);

/** Barter requirement totals round half up: floor(total + 1/2). ADR 0009 section 3, ADR 0010 section 2. */
export const HALF: Q = q(1, 2);

/** Ergonomics clamp interval (both the raw and the gear-adjusted clamp). ADR 0007 section 5. */
export const ERGO_CLAMP_MIN: Q = q(0);
export const ERGO_CLAMP_MAX: Q = q(100);

/** TED weight penalty q(W) = max(0, 100 - 300 / W); free at or below 3 kg. ADR 0007 section 6. */
export const TED_FREE_WEIGHT_KG: Q = q(3);
export const TED_PENALTY_CAP: Q = q(100);
export const TED_PENALTY_NUMERATOR: Q = q(300);

/**
 * Overswing strength display: 0 at W(1 - E/100) <= 3 kg, 100 at >= 7 kg, linear between.
 * Nonzero exactly when TED < 0. The 3 kg start is ADR 0007; the 7 kg full-strength point is
 * taken from the production display (trueErgo.ts SWAY_FULL_KG), the ADRs being silent on it.
 */
export const OVERSWING_START_KG: Q = q(3);
export const OVERSWING_FULL_KG: Q = q(7);

/** Trader level meaning "this trader is disabled". Every trader offer needs level >= 1. */
export const TRADER_DISABLED = 0;
/** Level assumed for a trader absent from request.trader_levels (production default). */
export const DEFAULT_TRADER_LEVEL = 4;

/** Upper bound on owned_items entries. ADR 0008 section 1. */
export const OWNED_ITEMS_MAX = 10000;

/** Instance id of the weapon receiver. ADR 0003 section 1. */
export const ROOT_INSTANCE_ID = 'weapon_0';
