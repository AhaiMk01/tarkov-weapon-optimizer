/**
 * `owned_items` boundary validation (ADR 0008 section 1, ADR 0013 sections 4A and 6).
 *
 * The stash is an optional array of item id strings in which element multiplicity is quantity. Omitted, null and `[]` all mean no
 * stock. Anything else must be a dense array of at most {@link OWNED_ITEMS_MAX} entries, each a nonempty string: a sparse hole, a
 * non-string and an empty string all fail. The cap bounds entries, not bytes; there is no trimming, case folding, id-syntax or
 * string-length rule, and unknown, non-mod and incompatible ids are valid (they stay in the multiset for request identity).
 *
 * An invalid stash is a typed INPUT error (`PhysicalModelError` code `INVALID_OWNED_ITEMS`), mapped by the operation layer to the
 * public reason {@link INVALID_OWNED_ITEMS_REASON}. It is never an infeasibility claim and never a numeric fallback.
 *
 * Validation snapshots: the result is a frozen copy, so the caller keeps ownership of its own array and later edits cannot change a
 * request that was already validated.
 */

import { PhysicalModelError } from './errors';

/** Maximum entries of `owned_items` (ADR 0008 section 1). */
export const OWNED_ITEMS_MAX = 10_000;

/** The public reason string of an invalid stash (ADR 0013 section 6). */
export const INVALID_OWNED_ITEMS_REASON = 'Invalid owned_items format';

export type OwnedItemsIssue =
  /** The value is neither omitted/null nor an array. */
  | { kind: 'not_array' }
  /** More than {@link OWNED_ITEMS_MAX} entries (`length` is the array length). */
  | { kind: 'too_many'; length: number }
  /** The array has no entry at `index` (a sparse hole). */
  | { kind: 'missing_entry'; index: number }
  /** The entry at `index` is not a nonempty string. */
  | { kind: 'not_nonempty_string'; index: number };

export type OwnedItemsInspection =
  | {
      ok: true;
      /** A frozen copy of the stash, in the caller's order, duplicates kept. */
      items: readonly string[];
    }
  | {
      ok: false;
      issue: OwnedItemsIssue;
      reason: typeof INVALID_OWNED_ITEMS_REASON;
      message: string;
    };

function describe(issue: OwnedItemsIssue): string {
  switch (issue.kind) {
    case 'not_array':
      return 'owned_items must be an array of strings';
    case 'too_many':
      return `owned_items has ${issue.length} entries, more than the ${OWNED_ITEMS_MAX} allowed`;
    case 'missing_entry':
      return `owned_items entry ${issue.index} is missing (sparse array)`;
    case 'not_nonempty_string':
      return `owned_items entry ${issue.index} is not a nonempty string`;
  }
}

/** Validate without throwing; the non-throwing form for operation layers that map the failure to a public envelope. */
export function inspectOwnedItems(raw: unknown): OwnedItemsInspection {
  if (raw === undefined || raw === null) return { ok: true, items: Object.freeze([]) };
  const fail = (issue: OwnedItemsIssue): OwnedItemsInspection => ({ ok: false, issue, reason: INVALID_OWNED_ITEMS_REASON, message: describe(issue) });
  if (!Array.isArray(raw)) return fail({ kind: 'not_array' });
  // The length is checked first: a huge sparse array must not cost per-entry work.
  if (raw.length > OWNED_ITEMS_MAX) return fail({ kind: 'too_many', length: raw.length });
  const items: string[] = new Array<string>(raw.length);
  for (let i = 0; i < raw.length; i++) {
    if (!(i in raw)) return fail({ kind: 'missing_entry', index: i });
    const entry: unknown = raw[i];
    if (typeof entry !== 'string' || entry === '') return fail({ kind: 'not_nonempty_string', index: i });
    items[i] = entry;
  }
  return { ok: true, items: Object.freeze(items) };
}

/** Validate and snapshot `owned_items`; throws the typed input error for an invalid stash. */
export function snapshotOwnedItems(raw: unknown): readonly string[] {
  const result = inspectOwnedItems(raw);
  if (!result.ok) {
    throw new PhysicalModelError('INVALID_OWNED_ITEMS', `owned_items rejected: ${result.message}`, { reason: result.reason, issue: result.issue });
  }
  return result.items;
}

/** Validate `owned_items` and count it as a multiset N_owned(i): each id with its multiplicity. */
export function countOwnedItems(ownedItems: readonly string[] | null | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of snapshotOwnedItems(ownedItems)) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}
