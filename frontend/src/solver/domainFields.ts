/**
 * The request domain: the ONE list of the request fields that say what is asked of the model (ADR 0013 section 5): the hard constraints, the filters,
 * the model flags and the acquisition settings. Everything that reads the domain is derived from this table, so a new request option is added here once
 * (and to the wire type `OptimizeRequest`, which stays the contract) and not in each consumer:
 *
 *   - `DomainParams` (and so `SolveParams`) is its camelCase solve-side shape;
 *   - `domainOf` turns a wire request into those params, with the defaults applied;
 *   - `keyEntries` is the domain part of the reuse key (`reuseKey.ts`);
 *   - `scopeOf` is the acquisition and feasibility scope a MOA-floor witness records.
 *
 * Not in the domain, by design: the objective (weights, Tchebycheff), the model options (precision, repeated parts), the stash (a multiset the
 * runtime validates first) and the time limit. The wire types `OptimizeRequest`, `MOAFloorRequest` and `WitnessScope` stay the contract; they are
 * checked against the table at compile time, below, so a field added to any of them without a decision here fails the build.
 *
 * The order of the rows is the order of the reuse key (the key is a string): the constraints and model flags, then the acquisition rows.
 */

import type { MOAFloorRequest, OptimizeRequest, TraderLevels, WitnessScope } from './types.ts';

type Wire = OptimizeRequest;

/** The group of a field in the witness scope; a field without one is not recorded there. `acquisition` rows also come last in the reuse key. */
type Group = 'acquisition' | 'feasibility';

interface Field<W extends keyof Wire, P, G extends Group | undefined> {
  readonly wire: W;
  readonly group: G;
  /** The wire value as the solve reads it (defaults applied, trader names canonical). */
  param(v: Wire[W]): P;
  /** The wire value as the reuse key records it. */
  key(v: Wire[W]): unknown;
  /** The solve value as a MOA-floor witness records it: never undefined, and a copy of anything mutable. */
  scoped(v: P | undefined): unknown;
}

// ---------------------------------------------------------------------------------------------
// Canonical forms (the reuse key and the acquisition domain must agree on them)
// ---------------------------------------------------------------------------------------------

/** Sorts and deduplicates an array of identifiers to prevent permutation invalidation. */
export function canonicalizeArray(arr?: readonly string[] | null): string[] | undefined {
  if (!arr || arr.length === 0) return undefined;
  const set = new Set(arr);
  return Array.from(set).sort();
}

/**
 * Canonicalizes trader levels map once at request entry:
 * - Trims whitespace and lowercases all vendor names.
 * - Resolves duplicate aliases deterministically: last-entry-wins in natural iteration order.
 * - Sorts keys alphabetically for stable serialization.
 *
 * This normalized map MUST be used consistently across:
 * - Cache key generation (computeIdealPointCacheKey)
 * - The physical acquisition domain (physical/acquisition.ts) and the solver entry (solver.ts)
 */
export function canonicalizeTraderLevels(levels?: TraderLevels | null): Record<string, number> | undefined {
  if (!levels) return undefined;
  // Natural iteration order: last-entry-wins for conflicting aliases (e.g. {"mechanic": 0, "Mechanic": 4} -> 4)
  const merged = new Map<string, number>();
  for (const [k, v] of Object.entries(levels)) {
    const key = k.trim().toLowerCase();
    if (key.length > 0) {
      merged.set(key, Number(v));
    }
  }
  if (merged.size === 0) return undefined;
  // Sort alphabetically for deterministic serialization and lookup
  const sortedKeys = Array.from(merged.keys()).sort();
  const out: Record<string, number> = {};
  for (const k of sortedKeys) {
    out[k] = merged.get(k)!;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Row kinds
// ---------------------------------------------------------------------------------------------

/** A copy of a list, a list of lists or a record (so a witness never aliases the request); `null` for an absent value. */
const copyOrNull = (v: unknown): unknown => {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map(item => (Array.isArray(item) ? [...item] : item));
  return typeof v === 'object' ? { ...v } : v;
};

/** A value the model reads as given. */
const given = <W extends keyof Wire, G extends Group | undefined>(
  wire: W, group: G, key: (v: Wire[W]) => unknown, scoped: (v: Wire[W] | null | undefined) => unknown,
): Field<W, Wire[W] | null, G> => ({ wire, group, param: v => v, key, scoped });

const keyNumber = (v: number | null | undefined): number | undefined => (v != null ? Number(v) : undefined);

type NumberWire = 'max_price' | 'min_ergonomics' | 'max_recoil_v' | 'max_recoil_sum' | 'min_mag_capacity' | 'min_sighting_range' | 'max_weight' | 'max_moa'
  | 'equip_ergo_modifier' | 'player_level';

/** A number (a cap, a floor, a level); unset is `undefined` and never 0. */
const limit = <W extends NumberWire, G extends Group | undefined = undefined>(wire: W, group?: G) =>
  given(wire, group as G, v => keyNumber(v), v => v ?? null);

/** A list of ids: a different order or a repeat is the same filter. */
const ids = <W extends 'include_items' | 'exclude_items' | 'exclude_categories', G extends Group | undefined = undefined>(wire: W, group?: G) =>
  given(wire, group as G, v => canonicalizeArray(v as string[] | undefined), copyOrNull);

/** Groups of category ids (each group is one "any of these" requirement). */
const groups = <G extends Group | undefined = undefined>(group?: G) =>
  given('include_categories', group as G, v => v?.map(canonicalizeArray).filter(Boolean), copyOrNull);

/** A switch that is off unless set. */
const toggle = <W extends 'prevent_overswing' | 'use_true_ergo', G extends Group | undefined = undefined>(wire: W, group?: G): Field<W, boolean, G> => ({
  wire, group: group as G, param: v => (v as boolean | undefined) ?? false, key: v => Boolean(v), scoped: v => v ?? false,
});

/** A market switch with a default that applies when the request does not say. */
const flag = <W extends 'flea_available' | 'barter_available' | 'barter_exclude_dogtags', G extends Group | undefined = undefined>(
  wire: W, fallback: boolean, group?: G,
): Field<W, boolean, G> => ({
  wire, group: group as G, param: v => (v as boolean | undefined) ?? fallback, key: v => v ?? fallback, scoped: v => v ?? fallback,
});

/** Unlocked trader levels; names are trimmed and lowercased, so aliases are one trader. */
const traders = <G extends Group | undefined = undefined>(group?: G): Field<'trader_levels', TraderLevels | null | undefined, G> => ({
  wire: 'trader_levels',
  group: group as G,
  param: v => canonicalizeTraderLevels(v as TraderLevels | undefined) as TraderLevels | undefined,
  key: v => canonicalizeTraderLevels(v as TraderLevels | undefined),
  scoped: copyOrNull,
});

// ---------------------------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------------------------

const weapon: Field<'weapon_id', string, undefined> = { wire: 'weapon_id', group: undefined, param: v => v, key: v => v, scoped: v => v };

export const DOMAIN = {
  weaponId: weapon,
  maxPrice: limit('max_price', 'feasibility'),
  minErgonomics: limit('min_ergonomics', 'feasibility'),
  maxRecoilV: limit('max_recoil_v', 'feasibility'),
  maxRecoilSum: limit('max_recoil_sum', 'feasibility'),
  minMagCapacity: limit('min_mag_capacity', 'feasibility'),
  minSightingRange: limit('min_sighting_range', 'feasibility'),
  maxWeight: limit('max_weight', 'feasibility'),
  /** The MOA cap. The floor searches it, so a floor request has none and its witness records the cap of its own trial, not this field. */
  maxMOA: limit('max_moa'),
  includeItems: ids('include_items', 'feasibility'),
  excludeItems: ids('exclude_items', 'feasibility'),
  includeCategories: groups('feasibility'),
  excludeCategories: ids('exclude_categories', 'feasibility'),
  /** Require W * (1 - effectiveErgo / 100) <= 3. */
  preventOverswing: toggle('prevent_overswing', 'feasibility'),
  /** Equipment ergonomics modifier b as a decimal percentage (e.g. -0.15 for -15% armor penalty). */
  equipErgoModifier: limit('equip_ergo_modifier', 'feasibility'),
  /** Optimize the exact gear-adjusted TrueErgo Delta instead of raw ergonomics. */
  useTrueErgo: toggle('use_true_ergo'),
  traderLevels: traders('acquisition'),
  fleaAvailable: flag('flea_available', true, 'acquisition'),
  barterAvailable: flag('barter_available', false, 'acquisition'),
  barterExcludeDogtags: flag('barter_exclude_dogtags', false, 'acquisition'),
  playerLevel: limit('player_level', 'acquisition'),
};

type Table = typeof DOMAIN;

/** The solve-side value of every domain field. `SolveParams` extends it (every field but the weapon optional, so a caller sets what it needs). */
export type DomainParams = { [K in keyof Table]: ReturnType<Table[K]['param']> };

type AnyField = Field<keyof Wire, unknown, Group | undefined>;
const ROWS = Object.entries(DOMAIN) as unknown as [keyof Table, AnyField][];

/** A request as the solve reads its domain: every field, defaults applied. A floor request has no MOA cap, so its `maxMOA` is unset. */
export function domainOf(req: OptimizeRequest): DomainParams {
  const out: Record<string, unknown> = {};
  for (const [name, row] of ROWS) out[name] = row.param(req[row.wire]);
  return out as unknown as DomainParams;
}

/** The domain part of a reuse key, in key order: the constraints and model flags (`'constraints'`) or the acquisition settings (`'acquisition'`). */
export function keyEntries(req: OptimizeRequest, part: 'constraints' | 'acquisition'): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [, row] of ROWS) if ((row.group === 'acquisition') === (part === 'acquisition')) out[row.wire] = row.key(req[row.wire]);
  return out;
}

/** What a MOA-floor witness records of the domain it was found under (the wire names of `WitnessScope`). */
export function scopeOf(domain: Partial<DomainParams>): Pick<WitnessScope, 'acquisition' | 'feasibility'> {
  const out = { acquisition: {} as Record<string, unknown>, feasibility: {} as Record<string, unknown> };
  for (const [name, row] of ROWS) if (row.group !== undefined) out[row.group][row.wire] = row.scoped(domain[name]);
  return out as unknown as Pick<WitnessScope, 'acquisition' | 'feasibility'>;
}

// ---------------------------------------------------------------------------------------------
// Drift checks: the compiler fails here when a wire type and this table disagree
// ---------------------------------------------------------------------------------------------

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type TableWire = Table[keyof Table]['wire'];
type WireIn<G extends Group> = { [K in keyof Table]: Table[K]['group'] extends G ? Table[K]['wire'] : never }[keyof Table];

/** Request fields that are deliberately not domain: the objective, the model options, the stash and the clock. */
type OutsideDomain = 'ergo_weight' | 'recoil_weight' | 'price_weight' | 'use_tchebycheff' | 'precise_mode' | 'allow_repeated_parts' | 'owned_items' | 'time_limit_ms';

export type DomainDriftChecks = [
  // A request field is either a row of the table or named as outside the domain above.
  Assert<Same<Exclude<keyof OptimizeRequest, TableWire>, OutsideDomain>>,
  // The witness scope records exactly the rows that carry its groups.
  Assert<Same<WireIn<'acquisition'>, keyof WitnessScope['acquisition']>>,
  Assert<Same<WireIn<'feasibility'>, keyof WitnessScope['feasibility']>>,
  // The floor request is the domain without the cap it searches, plus the stash and the clock.
  Assert<Same<keyof MOAFloorRequest, Exclude<TableWire, 'max_moa'> | 'owned_items' | 'time_limit_ms'>>,
];
