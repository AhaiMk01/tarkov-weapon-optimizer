// Reference fixture and request schema for the independent oracle (ADR 0010 sections 1 and 5).
//
// Everything here is plain JSON-serializable data so ledger fixtures are object literals.
// Nothing imports production types. Numbers are binary64 leaves that the oracle decodes to
// exact rationals (fromBinary64); the oracle never treats them as decimal approximations.
//
// Fields marked "default" may be omitted; resolve.ts applies each default in exactly one place.

import { OWNED_ITEMS_MAX } from './constants';

// ---------------------------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------------------------

/** A template slot. The physical slot is the instance-qualified pair (parentInstance, slot.id). */
export interface ReferenceSlot {
  /** Template slot id (24-hex Mongo id upstream); not unique across templates. */
  id: string;
  /** Required slots must be occupied whenever their owner instance is present. Default false. */
  required?: boolean;
  /** Template ids that may be installed in this slot. */
  allowedItemIds: string[];
}

/** One barter ingredient. Valued `avg24hPrice ?? basePrice ?? 0` per unit (ADR 0009 section 3). */
export interface ReferenceBarterRequirement {
  /** Informational ingredient id. */
  itemId?: string;
  /** Nonnegative integer ingredient quantity. */
  count: number;
  /** RUB per unit; null/absent falls back to basePrice. */
  avg24hPrice?: number | null;
  /** RUB per unit; null/absent falls back to 0. */
  basePrice?: number | null;
}

/** A trader cash offer. A stored price <= 0 is not an offer. */
export interface ReferenceTraderOffer {
  kind: 'trader';
  /** Normalized trader name; looked up verbatim in request.trader_levels. */
  trader: string;
  /** Loyalty level required, integer >= 1. */
  level: number;
  /** RUB for one unit. */
  price: number;
}

/** A flea market offer. A stored price <= 0 is not an offer. */
export interface ReferenceFleaOffer {
  kind: 'flea';
  /** Player level needed to buy this item on the flea market. Default 0. */
  minPlayerLevel?: number;
  /** RUB for one unit. */
  price: number;
}

/** A barter: ingredients are paid for in kind and valued in RUB. */
export interface ReferenceBarterOffer {
  kind: 'barter';
  trader: string;
  /** Loyalty level required, integer >= 1. */
  level: number;
  requirements: ReferenceBarterRequirement[];
  /** Units delivered by one barter, positive integer. Default 1. Per-unit price is lotPrice / offeredCount. */
  offeredCount?: number;
  /** True when an ingredient is a dogtag; excluded by request.barter_exclude_dogtags. Default false. */
  requiresDogtag?: boolean;
}

export type ReferenceOffer = ReferenceTraderOffer | ReferenceFleaOffer | ReferenceBarterOffer;

/** An installable mod. Units noted per field. */
export interface ReferenceItem {
  /** Item template id (unique across items and weapons). */
  id: string;
  /** Own category id first, then the ancestor chain up to the root. Default []. */
  categories?: string[];
  /** Mass in kilograms (may be fractional or negative). Default 0. */
  weightKg?: number;
  /** Ergonomics points, additive. Default 0. */
  ergonomics?: number;
  /** Recoil modifier as a dimensionless fraction (-0.05 means -5%). Default 0. */
  recoilModifier?: number;
  /** Accuracy modifier in percent points (may be negative). Default 0. */
  accuracyModifier?: number;
  /** Barrel centre of impact; a value > 0 replaces the weapon's intrinsic COI. Default 0 (no override). */
  centerOfImpact?: number;
  /** Magazine capacity in rounds. Default 0. */
  magazineCapacity?: number;
  /** Sighting range in metres. Default 0. */
  sightingRange?: number;
  /** Child slots of this template. Default []. */
  slots?: ReferenceSlot[];
  /** Template presence conflicts (symmetrized by the oracle). A self-listing caps installed copies at one. Default []. */
  conflictingItemIds?: string[];
  /** Template slot ids that must be empty everywhere in a build that installs this item. Default []. */
  conflictingSlotIds?: string[];
  /** Standalone acquisition offers. Default []. */
  offers?: ReferenceOffer[];
}

/** A weapon receiver. Its id is also the root's template identity for ancestor-repetition checks. */
export interface ReferenceWeapon {
  id: string;
  categories?: string[];
  /** Naked receiver mass in kg. Default 0. */
  weightKg?: number;
  /** Naked ergonomics points. Default 0. */
  ergonomics?: number;
  /** Naked vertical recoil (game units). Default 0. */
  recoilVertical?: number;
  /** Naked horizontal recoil (game units). Default 0. */
  recoilHorizontal?: number;
  /** Intrinsic centre of impact. Default 0. */
  centerOfImpact?: number;
  /** Intrinsic sighting range in metres. Default 0. */
  sightingRange?: number;
  /** Intrinsic magazine capacity in rounds. Default 0. */
  magazineCapacity?: number;
  /** Receiver slots. Default []. */
  slots?: ReferenceSlot[];
  /** Template conflicts listed by the receiver. Default []. */
  conflictingItemIds?: string[];
  /** Offers for the naked receiver. Owned stock never grants a receiver. Default []. */
  offers?: ReferenceOffer[];
}

/** A factory preset: a purchasable base that also supplies count-bearing component stock. */
export interface ReferencePreset {
  id: string;
  /** Receiver the preset is built on. */
  weaponId: string;
  /** Supplied components q_{b,i}; repeated entries for one itemId sum their counts. */
  components: { itemId: string; count: number }[];
  /** Offers for the whole preset. Default []. */
  offers?: ReferenceOffer[];
}

export interface ReferenceFixture {
  schemaVersion: 1;
  description?: string;
  items: ReferenceItem[];
  weapons: ReferenceWeapon[];
  presets?: ReferencePreset[];
}

// ---------------------------------------------------------------------------------------------
// Request (field names mirror production OptimizeRequest so Stage 3 can map requests 1:1)
// ---------------------------------------------------------------------------------------------

/** Ideal/nadir reference point in the objective frame: fE = 10 x ergo, fR = 1000 x recoilModSum, fP = RUB spend. */
export interface ReferenceIdealPoint {
  zE: number;
  nadE: number;
  zR: number;
  nadR: number;
  zP: number;
  nadP: number;
}

export interface ReferenceRequest {
  weapon_id: string;

  /** Hard cap on RUB spend (base offer plus paid units). null/absent = no cap. A cap of 0 is a real cap. */
  max_price?: number | null;
  /** Minimum clamped (first clamp, pre-gear) ergonomics. */
  min_ergonomics?: number | null;
  /** Maximum final vertical recoil: nakedV x (1 + recoil modifier sum). */
  max_recoil_v?: number | null;
  /** Maximum final vertical + horizontal recoil. */
  max_recoil_sum?: number | null;
  /** Some installed item (or the receiver) must reach this magazine capacity. */
  min_mag_capacity?: number | null;
  /** Some installed item (or the receiver) must reach this sighting range. */
  min_sighting_range?: number | null;
  /** Maximum total weight in kg. */
  max_weight?: number | null;
  /** Maximum MOA under the provisional ADR 0006 model. */
  max_moa?: number | null;
  /** Require TED >= 0 (equivalently W(1 - E/100) <= 3 kg). Default false. */
  prevent_overswing?: boolean;
  /** Equipment ergonomics modifier as a fraction (-0.15 = -15%); gear factor = max(0, 1 + modifier). Default 0. */
  equip_ergo_modifier?: number | null;

  /** Template ids that must each be installed at least once. Duplicates add nothing. */
  include_items?: string[] | null;
  /** Template ids that may not be installed. */
  exclude_items?: string[] | null;
  /** Each group needs an installed mod matching at least one id of the group. A category id matches an item whose category chain contains it. */
  include_categories?: string[][] | null;
  /** Category ids no installed mod may match. */
  exclude_categories?: string[] | null;

  /** Objective weights; negatives resolve to 0. Defaults 1, 1, 0. */
  ergo_weight?: number | null;
  recoil_weight?: number | null;
  price_weight?: number | null;
  /** Score the exact gear-adjusted TED instead of clamped ergonomics on the ergo axis. Default false. */
  use_true_ergo?: boolean;
  /** Use the augmented Tchebycheff form; requires ideal_point. Default false (linear weighted sum). */
  use_tchebycheff?: boolean;
  ideal_point?: ReferenceIdealPoint | null;

  /** Unlocked loyalty level per trader; 0 disables the trader. Missing traders default to DEFAULT_TRADER_LEVEL. */
  trader_levels?: Record<string, number> | null;
  /** Default true. */
  flea_available?: boolean;
  /** Default false. */
  barter_available?: boolean;
  /** Default false. */
  barter_exclude_dogtags?: boolean;
  /** null/absent = no player-level gating of the flea market. */
  player_level?: number | null;
  /** Stash multiset: element multiplicity is quantity. Default []. Never grants a receiver. */
  owned_items?: string[] | null;
}

// ---------------------------------------------------------------------------------------------
// Errors and structural checks
// ---------------------------------------------------------------------------------------------

export interface InputIssue {
  code: string;
  detail: string;
}

/** Malformed fixture or request: an input failure, never evidence of infeasibility. */
export class ReferenceInputError extends Error {
  readonly issues: InputIssue[];
  constructor(issues: InputIssue[]) {
    super(`Reference input rejected: ${issues.map(i => `${i.code}(${i.detail})`).join('; ')}`);
    this.name = 'ReferenceInputError';
    this.issues = issues;
  }
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

function checkOffers(subject: string, offers: ReferenceOffer[] | undefined, issues: InputIssue[]): void {
  (offers ?? []).forEach((offer, i) => {
    const where = `${subject}.offers[${i}]`;
    const bad = (detail: string) => issues.push({ code: 'BAD_OFFER', detail: `${where}: ${detail}` });
    if (offer.kind === 'trader') {
      if (typeof offer.trader !== 'string' || offer.trader === '') bad('trader name missing');
      if (!isNonNegInt(offer.level)) bad('level must be a nonnegative integer');
      if (!isFiniteNumber(offer.price)) bad('price must be finite');
    } else if (offer.kind === 'flea') {
      if (!isFiniteNumber(offer.price)) bad('price must be finite');
      if (offer.minPlayerLevel !== undefined && !isFiniteNumber(offer.minPlayerLevel)) bad('minPlayerLevel must be finite');
    } else if (offer.kind === 'barter') {
      if (typeof offer.trader !== 'string' || offer.trader === '') bad('trader name missing');
      if (!isNonNegInt(offer.level)) bad('level must be a nonnegative integer');
      if (offer.offeredCount !== undefined && !(isNonNegInt(offer.offeredCount) && offer.offeredCount >= 1)) {
        bad('offeredCount must be a positive integer');
      }
      if (!Array.isArray(offer.requirements)) bad('requirements must be an array');
      else {
        offer.requirements.forEach((r, j) => {
          if (!isNonNegInt(r.count)) bad(`requirements[${j}].count must be a nonnegative integer`);
          for (const field of ['avg24hPrice', 'basePrice'] as const) {
            const v = r[field];
            if (v !== undefined && v !== null && !isFiniteNumber(v)) bad(`requirements[${j}].${field} must be finite`);
          }
        });
      }
    } else {
      bad(`unknown offer kind ${String((offer as { kind?: unknown }).kind)}`);
    }
  });
}

function checkSlots(owner: string, slots: ReferenceSlot[] | undefined, itemIds: ReadonlySet<string>, issues: InputIssue[]): void {
  const seen = new Set<string>();
  for (const slot of slots ?? []) {
    if (typeof slot.id !== 'string' || slot.id === '') issues.push({ code: 'BAD_SLOT', detail: `${owner}: slot id missing` });
    if (seen.has(slot.id)) issues.push({ code: 'DUPLICATE_SLOT_ID', detail: `${owner}: slot ${slot.id} declared twice` });
    seen.add(slot.id);
    for (const allowed of slot.allowedItemIds ?? []) {
      if (!itemIds.has(allowed)) issues.push({ code: 'UNKNOWN_ALLOWED_ITEM', detail: `${owner}/${slot.id}: ${allowed}` });
    }
  }
}

function checkNumbers(subject: string, fields: Record<string, unknown>, issues: InputIssue[]): void {
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined && !isFiniteNumber(value)) issues.push({ code: 'BAD_NUMBER', detail: `${subject}.${name}` });
  }
}

/** Structural validation of a fixture. An empty result means the fixture is well formed. */
export function checkFixture(fixture: ReferenceFixture): InputIssue[] {
  const issues: InputIssue[] = [];
  if (fixture.schemaVersion !== 1) issues.push({ code: 'BAD_SCHEMA_VERSION', detail: String(fixture.schemaVersion) });
  const itemIds = new Set<string>();
  const templateIds = new Set<string>();
  for (const item of fixture.items ?? []) {
    if (templateIds.has(item.id)) issues.push({ code: 'DUPLICATE_ID', detail: item.id });
    templateIds.add(item.id);
    itemIds.add(item.id);
  }
  const weaponIds = new Set<string>();
  for (const weapon of fixture.weapons ?? []) {
    if (templateIds.has(weapon.id)) issues.push({ code: 'DUPLICATE_ID', detail: weapon.id });
    templateIds.add(weapon.id);
    weaponIds.add(weapon.id);
  }
  for (const item of fixture.items ?? []) {
    checkNumbers(item.id, {
      weightKg: item.weightKg, ergonomics: item.ergonomics, recoilModifier: item.recoilModifier,
      accuracyModifier: item.accuracyModifier, centerOfImpact: item.centerOfImpact,
      magazineCapacity: item.magazineCapacity, sightingRange: item.sightingRange,
    }, issues);
    checkSlots(item.id, item.slots, itemIds, issues);
    checkOffers(item.id, item.offers, issues);
  }
  for (const weapon of fixture.weapons ?? []) {
    checkNumbers(weapon.id, {
      weightKg: weapon.weightKg, ergonomics: weapon.ergonomics, recoilVertical: weapon.recoilVertical,
      recoilHorizontal: weapon.recoilHorizontal, centerOfImpact: weapon.centerOfImpact,
      sightingRange: weapon.sightingRange, magazineCapacity: weapon.magazineCapacity,
    }, issues);
    checkSlots(weapon.id, weapon.slots, itemIds, issues);
    checkOffers(weapon.id, weapon.offers, issues);
  }
  const presetIds = new Set<string>();
  for (const preset of fixture.presets ?? []) {
    if (presetIds.has(preset.id)) issues.push({ code: 'DUPLICATE_PRESET_ID', detail: preset.id });
    presetIds.add(preset.id);
    if (!weaponIds.has(preset.weaponId)) issues.push({ code: 'UNKNOWN_PRESET_WEAPON', detail: `${preset.id}: ${preset.weaponId}` });
    for (const [i, c] of preset.components.entries()) {
      if (!isNonNegInt(c.count)) issues.push({ code: 'BAD_COUNT', detail: `${preset.id}.components[${i}]` });
      if (!itemIds.has(c.itemId) && c.itemId !== preset.weaponId) {
        issues.push({ code: 'UNKNOWN_PRESET_COMPONENT', detail: `${preset.id}: ${c.itemId}` });
      }
    }
    checkOffers(preset.id, preset.offers, issues);
  }
  return issues;
}

/** Structural validation of a request against a fixture. */
export function checkRequest(fixture: ReferenceFixture, request: ReferenceRequest): InputIssue[] {
  const issues: InputIssue[] = [];
  if (!fixture.weapons.some(w => w.id === request.weapon_id)) {
    issues.push({ code: 'UNKNOWN_WEAPON', detail: request.weapon_id });
  }
  checkNumbers('request', {
    max_price: request.max_price ?? undefined, min_ergonomics: request.min_ergonomics ?? undefined,
    max_recoil_v: request.max_recoil_v ?? undefined, max_recoil_sum: request.max_recoil_sum ?? undefined,
    min_mag_capacity: request.min_mag_capacity ?? undefined, min_sighting_range: request.min_sighting_range ?? undefined,
    max_weight: request.max_weight ?? undefined, max_moa: request.max_moa ?? undefined,
    equip_ergo_modifier: request.equip_ergo_modifier ?? undefined, ergo_weight: request.ergo_weight ?? undefined,
    recoil_weight: request.recoil_weight ?? undefined, price_weight: request.price_weight ?? undefined,
    player_level: request.player_level ?? undefined,
  }, issues);
  if (request.use_tchebycheff) {
    if (!request.ideal_point) issues.push({ code: 'MISSING_IDEAL_POINT', detail: 'use_tchebycheff requires ideal_point' });
    else checkNumbers('ideal_point', { ...request.ideal_point }, issues);
  }
  for (const [trader, level] of Object.entries(request.trader_levels ?? {})) {
    if (!isFiniteNumber(level)) issues.push({ code: 'BAD_NUMBER', detail: `trader_levels.${trader}` });
  }
  const owned = request.owned_items ?? [];
  if (!Array.isArray(owned) || owned.length > OWNED_ITEMS_MAX) {
    issues.push({ code: 'BAD_OWNED_ITEMS', detail: 'owned_items must be an array of at most 10000 entries' });
  } else {
    for (let i = 0; i < owned.length; i++) {
      if (typeof owned[i] !== 'string' || owned[i] === '') {
        issues.push({ code: 'BAD_OWNED_ITEMS', detail: `owned_items[${i}] must be a nonempty string` });
        break;
      }
    }
  }
  return issues;
}
