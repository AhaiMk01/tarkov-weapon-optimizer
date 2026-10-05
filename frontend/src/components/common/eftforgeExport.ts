/**
 * The EFTForge v1 export (ADR 0013 section 4E, Phase 2.8): a deliberate, checked projection of the internal occurrence manifest onto the external
 * format `{ v: 1, g: weaponId, p: [slotId, itemId][] }`.
 *
 * The internal `slot_pairs` are `Placement`s (parent instance -> slot -> child instance). EFTForge v1 knows neither instances nor parents: a pair
 * `[slotId, itemId]` names a template slot and the template installed in it, and the reader finds the owner of the slot by itself. So a build is
 * representable only when every pair identifies exactly one placement:
 *
 *  - every slot id occurs once (a slot id repeated under two parent instances cannot say which parent holds which child);
 *  - every item template occurs once (two copies of a template cannot be told apart, and a copy must never be dropped silently), which also
 *    guarantees that each owner of a used slot is installed exactly once, so the slot id alone names its parent;
 *  - the placements form one tree rooted at the weapon.
 *
 * The projection is then VERIFIED by reconstructing the build from the pairs and comparing it with the manifest (`reconstructEftforgeV1`). Anything
 * that fails a check is refused with its reason; the in-app manifest, copy and shopping list stay fully instance-aware and are not affected. No
 * other external format is invented, and no pair is ever passed through blindly.
 */

// lz-string is a CommonJS module: its functions are read from the default export, which works in the bundle and in Node's ESM loader alike.
import LZString from 'lz-string';
import type { Placement } from '../../solver/types';

export const EFTFORGE_URL = 'https://www.eftforge.com';

export interface EftforgePayload {
  v: 1;
  /** The weapon template id. */
  g: string;
  /** Slot id and installed item id of every placement, parents before children. */
  p: [string, string][];
}

export type EftforgeRefusal =
  /** No weapon id to name the build. */
  | 'no_weapon'
  /** Nothing is installed: there is nothing to export. */
  | 'empty'
  /** A placement lacks a slot, item or instance id. */
  | 'invalid_placement'
  /** Two placements claim one child instance, or the placements are not one tree rooted at the weapon. */
  | 'detached'
  /** A slot id occurs more than once (under different parent instances): the format cannot say which parent holds which child. */
  | 'repeated_slot'
  /** An item template occurs more than once: copies the format cannot distinguish. */
  | 'repeated_item'
  /** The pairs did not reconstruct the same build. */
  | 'round_trip';

export type EftforgeProjection =
  | { ok: true; payload: EftforgePayload }
  | { ok: false; refusal: EftforgeRefusal; detail: string };

/** i18n key of the explanation shown for a disabled export. */
export const eftforgeRefusalKey = (refusal: EftforgeRefusal): string => `export.eftforge_disabled_${refusal}`;

/** Every refusal, for the locale-parity test. */
export const EFTFORGE_REFUSALS: readonly EftforgeRefusal[] = [
  'no_weapon', 'empty', 'invalid_placement', 'detached', 'repeated_slot', 'repeated_item', 'round_trip',
];

const refuse = (refusal: EftforgeRefusal, detail: string): EftforgeProjection => ({ ok: false, refusal, detail });
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v !== '';

/** The canonical key of a placement in template terms: owner template, slot id, installed template. */
const tripleKey = (owner: string, slotId: string, itemId: string): string => `${owner}\u0000${slotId}\u0000${itemId}`;

/**
 * The checked projection. `placements` are the internal manifest of one build of `weaponId`. Pure: no lookup, no side effect.
 */
export function projectToEftforgeV1(weaponId: string | null | undefined, placements: readonly Placement[] | null | undefined): EftforgeProjection {
  if (!nonEmpty(weaponId)) return refuse('no_weapon', 'no weapon id');
  if (!Array.isArray(placements) || placements.length === 0) return refuse('empty', 'no placements');

  // Well-formed placements with unique child instances.
  const children = new Set<string>();
  for (const [i, p] of placements.entries()) {
    if (p === null || typeof p !== 'object' || !nonEmpty(p.slotId) || !nonEmpty(p.itemId) || !nonEmpty(p.parentInstanceId) || !nonEmpty(p.childInstanceId)) {
      return refuse('invalid_placement', `placement ${i} lacks a slot, item or instance id`);
    }
    if (children.has(p.childInstanceId)) return refuse('detached', `instance ${p.childInstanceId} is placed twice`);
    children.add(p.childInstanceId);
  }

  // One tree: exactly one parent instance is not itself a child (the root), and every placement reaches it.
  const roots = new Set<string>();
  for (const p of placements) if (!children.has(p.parentInstanceId)) roots.add(p.parentInstanceId);
  if (roots.size !== 1) return refuse('detached', `${roots.size} root instances`);
  const [root] = roots;
  const parentOf = new Map<string, string>();
  const itemOf = new Map<string, string>();
  for (const p of placements) { parentOf.set(p.childInstanceId, p.parentInstanceId); itemOf.set(p.childInstanceId, p.itemId); }
  for (const p of placements) {
    const seen = new Set<string>([p.childInstanceId]);
    let at = p.parentInstanceId;
    while (at !== root) {
      if (seen.has(at)) return refuse('detached', `placements of ${p.childInstanceId} loop`);
      seen.add(at);
      const up = parentOf.get(at);
      if (up === undefined) return refuse('detached', `placements of ${p.childInstanceId} do not reach the root`);
      at = up;
    }
  }

  // The format cannot name repeated slots (the sign of a repeated parent) or repeated templates (copies it cannot tell apart). Slots are checked
  // first: a slot used under two parent instances is the more specific explanation of the two.
  const slots = new Set<string>();
  for (const p of placements) {
    if (slots.has(p.slotId)) return refuse('repeated_slot', `slot ${p.slotId} is used more than once`);
    slots.add(p.slotId);
  }
  const items = new Set<string>([weaponId]);
  for (const p of placements) {
    if (items.has(p.itemId)) return refuse('repeated_item', `item ${p.itemId} is installed more than once`);
    items.add(p.itemId);
  }

  // Pairs, parents before children, in the manifest's own order among siblings.
  const byParent = new Map<string, Placement[]>();
  for (const p of placements) {
    const list = byParent.get(p.parentInstanceId);
    if (list === undefined) byParent.set(p.parentInstanceId, [p]);
    else list.push(p);
  }
  const pairs: [string, string][] = [];
  const queue: string[] = [root];
  for (let head = 0; head < queue.length; head++) {
    for (const p of byParent.get(queue[head]) ?? []) {
      pairs.push([p.slotId, p.itemId]);
      queue.push(p.childInstanceId);
    }
  }
  const payload: EftforgePayload = { v: 1, g: weaponId, p: pairs };

  // Verify: reconstruct the build from the pairs alone (plus the owner of each slot, which is template data) and compare it with the manifest.
  const ownerOfSlot = new Map<string, string>();
  const expected = new Set<string>();
  for (const p of placements) {
    const owner = p.parentInstanceId === root ? weaponId : itemOf.get(p.parentInstanceId) as string;
    ownerOfSlot.set(p.slotId, owner);
    expected.add(tripleKey(owner, p.slotId, p.itemId));
  }
  const rebuilt = reconstructEftforgeV1(payload, ownerOfSlot);
  if (rebuilt === null || rebuilt.length !== expected.size || rebuilt.some(key => !expected.has(key)) || pairs.length !== placements.length) {
    return refuse('round_trip', 'the projection did not reconstruct the build');
  }
  return { ok: true, payload };
}

/**
 * Read a v1 payload back the way the format defines it: the item of a pair goes into the slot it names, on the (single) installed owner of that
 * slot. `ownerOfSlot` is the template data a reader has (slot id -> owner template). Returns the placements as owner/slot/item keys, or `null`
 * when the payload cannot be read unambiguously (an unknown slot, an owner that is not installed, a repeated slot or item).
 */
export function reconstructEftforgeV1(payload: EftforgePayload, ownerOfSlot: ReadonlyMap<string, string>): string[] | null {
  if (payload.v !== 1 || !nonEmpty(payload.g) || !Array.isArray(payload.p)) return null;
  const installed = new Set<string>([payload.g]);
  const seenSlots = new Set<string>();
  const out: string[] = [];
  // Parents come first in the pair list, so the owner of each pair is already installed when it is read.
  for (const pair of payload.p) {
    if (!Array.isArray(pair) || pair.length !== 2 || !nonEmpty(pair[0]) || !nonEmpty(pair[1])) return null;
    const [slotId, itemId] = pair;
    const owner = ownerOfSlot.get(slotId);
    if (owner === undefined || !installed.has(owner)) return null;
    if (seenSlots.has(slotId) || installed.has(itemId)) return null;
    seenSlots.add(slotId);
    installed.add(itemId);
    out.push(tripleKey(owner, slotId, itemId));
  }
  return out;
}

/** The link that opens a verified payload in EFTForge. */
export function eftforgeUrl(payload: EftforgePayload): string {
  return `${EFTFORGE_URL}?build=${LZString.compressToEncodedURIComponent(JSON.stringify(payload))}`;
}
