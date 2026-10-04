// Authoring helpers for ledger cases. These only build data (fixtures, keys, builds, records);
// they never evaluate a statistic, a score or a feasibility, so they cannot launder oracle output
// into an expectation.
//
// Conventions used by every fixture unless a case says otherwise:
//   - the receiver is `gun`, its default offer is a Prapor level-1 cash offer of 1000 RUB;
//   - an item without an `offers` field gets a Prapor level-1 cash offer of 100 RUB (`offers: []`
//     makes it standalone-inaccessible);
//   - the default request weights are e = 1, r = 1, p = 0, so with recoil_weight 0 the score equals
//     the (clamped) ergonomics, and with ergo_weight 0, recoil_weight 0, price_weight 1000 the score
//     equals minus the RUB spend;
//   - slot ids are unique per template (the source requirement of ADR 0002 section 1); the same
//     template slot repeats across physical instances of one template.

import {
  childInstanceId, codeUnitCompare, makeBuild, parseQ, projectionKey, ROOT_INSTANCE_ID, toNumber,
  type BaseChoice, type PlacementEdge, type ReferenceBuild, type ReferenceFixture, type ReferenceItem,
  type ReferenceOffer, type ReferencePreset, type ReferenceRequest, type ReferenceSlot, type ReferenceWeapon,
} from '../oracle/index';
import { admittedFor } from './outcomes';
import type { Family, LedgerCase, Expected, ProvenanceCheck, Rejection, RuntimeTolerance, StatCheck, StatName } from './types';

/** Instance id of the receiver in every build (`weapon_0`). */
export const ROOT = ROOT_INSTANCE_ID;
/** The base choice "buy the naked receiver" (no preset supply). */
export const NAKED: BaseChoice = { kind: 'naked' };
/** The base choice "buy preset `presetId`": its offer is the base price and its components are free supply. */
export const PRESET = (presetId: string): BaseChoice => ({ kind: 'preset', presetId });

// --- fixtures --------------------------------------------------------------------------------------

export const slot = (id: string, allowedItemIds: string[], required = false): ReferenceSlot => ({ id, allowedItemIds, required });
export const reqSlot = (id: string, allowedItemIds: string[]): ReferenceSlot => slot(id, allowedItemIds, true);

/** An `offers` list holding one cash trader offer (default Prapor, loyalty level 1): `offers: trader(100)`. */
export const trader = (price: number, name = 'prapor', level = 1): ReferenceOffer[] => [{ kind: 'trader', trader: name, level, price }];
/** One flea-market offer (a single `ReferenceOffer`, for building a longer `offers` list); the player-level gate defaults to none. */
export const flea = (price: number, minPlayerLevel?: number): ReferenceOffer =>
  minPlayerLevel === undefined ? { kind: 'flea', price } : { kind: 'flea', price, minPlayerLevel };
/** One cash trader offer as a single `ReferenceOffer` (same fields as `trader`, unwrapped, for mixing with flea or barter offers). */
export const traderOffer = (price: number, name = 'prapor', level = 1): ReferenceOffer => ({ kind: 'trader', trader: name, level, price });

export interface FixtureParts {
  items: ReferenceItem[];
  weapon?: Partial<ReferenceWeapon>;
  /** Further receivers, for cases that need a second weapon. */
  otherWeapons?: ReferenceWeapon[];
  presets?: ReferencePreset[];
  description?: string;
}

/**
 * Builds a complete fixture from the parts a case cares about: an item without an `offers` field gets the default
 * Prapor L1 100 RUB cash offer, the receiver `gun` gets a Prapor L1 1000 RUB offer (both overridable), and the
 * `weapon` fields are merged over the receiver defaults.
 */
export function fix(parts: FixtureParts): ReferenceFixture {
  return {
    schemaVersion: 1,
    ...(parts.description === undefined ? {} : { description: parts.description }),
    items: parts.items.map(i => ({ offers: trader(100), ...i })),
    weapons: [{ id: 'gun', offers: trader(1000), ...parts.weapon }, ...(parts.otherWeapons ?? [])],
    ...(parts.presets === undefined ? {} : { presets: parts.presets }),
  };
}

// --- projection keys and builds ------------------------------------------------------------------------

function keyOf(base: BaseChoice, items: string[]): string {
  const counts = new Map<string, number>();
  for (const id of items) counts.set(id, (counts.get(id) ?? 0) + 1);
  const entries = [...counts.entries()].sort((a, b) => codeUnitCompare(a[0], b[0])).map(([itemId, count]) => ({ itemId, count }));
  return projectionKey({ base, items: entries });
}

/** Projection key (base + installed multiset) of the naked receiver with these installed items; repeat an id for a copy. */
export const nk = (...items: string[]): string => keyOf(NAKED, items);
/** Projection key of preset base `presetId` with these installed items; repeat an id for a copy. */
export const ps = (presetId: string, ...items: string[]): string => keyOf(PRESET(presetId), items);

export const nakedBuild = (...edges: PlacementEdge[]): ReferenceBuild => makeBuild(NAKED, ...edges);
export const presetBuild = (presetId: string, ...edges: PlacementEdge[]): ReferenceBuild => makeBuild(PRESET(presetId), ...edges);

/**
 * Path-derived instance id of a placement chain below the receiver, one `[slotId, itemId]` pair per hop:
 * iid(['s','a'], ['t','b']) = weapon_0/s:a/t:b. Provenance expectations name occurrences by these ids.
 */
export function iid(...chain: [slotId: string, itemId: string][]): string {
  let id = ROOT;
  for (const [slotId, itemId] of chain) id = childInstanceId(id, slotId, itemId);
  return id;
}

// --- case records ---------------------------------------------------------------------------------------

export interface CaseInput {
  id: string;
  family: Family;
  subcases: string[];
  title: string;
  adrRefs: string[];
  prerequisites: string;
  source: string;
  derivation: string;
  notes?: string[];
  fixture: ReferenceFixture;
  request: Partial<ReferenceRequest>;
  /** Complete feasible projection keys, any order (sorted when the record is built). */
  feasible: string[];
  maxScore: string | null;
  maximizers: string[];
  scores?: [key: string, score: string][];
  rejections?: { label: string; build: ReferenceBuild; codes: Rejection['codes'] }[];
  accepts?: { label: string; build: ReferenceBuild }[];
  statChecks?: StatCheck[];
  provenance?: ProvenanceCheck[];
  physicalBuildCount?: number;
  /** Omit for a well-separated case. */
  tolerance?: { kind: 'tiny_positive_gap' | 'near_cap'; gap: string; absolute?: number; capCheck?: { build: ReferenceBuild; stat: StatName; value: string; cap: string; direction: 'max' | 'min' } };
  todo?: string;
}

export const DEFAULT_RUNTIME_TOLERANCE = 1e-9;

export function defineCase(input: CaseInput): LedgerCase {
  const request: ReferenceRequest = { weapon_id: 'gun', ...input.request };
  const projectionKeys = [...input.feasible].sort(codeUnitCompare);
  const empty = projectionKeys.length === 0;
  const moaDependent = request.max_moa !== undefined && request.max_moa !== null;
  const absolute = input.tolerance?.absolute ?? DEFAULT_RUNTIME_TOLERANCE;
  const runtimeTolerance: RuntimeTolerance = input.tolerance
    ? {
        absolute,
        kind: input.tolerance.kind,
        gap: input.tolerance.gap,
        resolvableAtTolerance: toNumber(parseQ(input.tolerance.gap)) > absolute,
        ...(input.tolerance.capCheck ? { capCheck: input.tolerance.capCheck } : {}),
      }
    : { absolute, kind: 'well_separated', gap: null, resolvableAtTolerance: true };
  const expected: Expected = {
    projectionKeys,
    maxScore: input.maxScore,
    maximizers: [...input.maximizers].sort(codeUnitCompare),
    empty,
    ...(input.scores ? { scores: Object.fromEntries(input.scores) } : {}),
    ...(input.rejections ? { rejections: input.rejections.map(r => ({ ...r, codes: [...r.codes].sort() })) } : {}),
    ...(input.accepts ? { accepts: input.accepts } : {}),
    ...(input.statChecks ? { statChecks: input.statChecks } : {}),
    ...(input.provenance ? { provenance: input.provenance } : {}),
    ...(input.physicalBuildCount === undefined ? {} : { physicalBuildCount: input.physicalBuildCount }),
  };
  return {
    id: input.id,
    family: input.family,
    subcases: input.subcases,
    title: input.title,
    adrRefs: input.adrRefs,
    prerequisites: input.prerequisites,
    source: input.source,
    fixture: input.fixture,
    request,
    moaDependent,
    expected,
    runtimeTolerance,
    admitted: admittedFor(moaDependent, empty),
    derivation: input.derivation,
    notes: input.notes ?? [],
    ...(input.todo === undefined ? {} : { todo: input.todo }),
  };
}
