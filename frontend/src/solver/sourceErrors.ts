/**
 * Typed errors and count validators for raw tarkov.dev source data.
 *
 * ADR 0013 section 4A: a preset component quantity is a finite nonnegative integer and a barter
 * ingredient quantity is a finite nonnegative number. An absent, null or malformed raw count is a
 * source/input error. No default (the old `count ?? 1`) is adopted anywhere: a silent default is a
 * wrong build waiting to happen, so loading fails loudly instead and names the offending entry.
 *
 * Shared by `jsonApiAdapter.ts` (raw JSON API documents) and `dataService.ts` (GraphQL-shaped
 * documents, including the GraphQL fallback and any previously cached payload).
 */

export type SourceDataErrorKind = 'preset_component_count' | 'barter_ingredient_count';

/** Raw source data that cannot be trusted; never a solver infeasibility. */
export class SourceDataError extends Error {
  readonly kind: SourceDataErrorKind;
  /** The offending preset (preset component counts) or the barter's offered item (ingredient counts). */
  readonly subjectId: string;
  /** The component or ingredient item whose count is unusable. */
  readonly itemId: string;
  /** The raw value as found; `undefined` when the field was absent. */
  readonly rawValue: unknown;

  constructor(kind: SourceDataErrorKind, subjectId: string, itemId: string, rawValue: unknown, message: string) {
    super(message);
    this.name = 'SourceDataError';
    this.kind = kind;
    this.subjectId = subjectId;
    this.itemId = itemId;
    this.rawValue = rawValue;
  }
}

function describe(raw: unknown): string {
  if (raw === undefined) return 'absent';
  if (raw === null) return 'null';
  if (typeof raw === 'number') return String(raw);
  return `${typeof raw} ${JSON.stringify(raw)}`;
}

function label(id: string, name: string | undefined): string {
  return name ? `${id} ("${name}")` : id;
}

/**
 * `containsItems[].count`: a finite, nonnegative, safe integer. Absent, null, fractional, negative,
 * non-numeric or overflowing values throw a `SourceDataError` naming the preset and the item.
 */
export function presetComponentCount(
  raw: unknown,
  subject: { presetId: string; presetName?: string; itemId: string; itemName?: string },
): number {
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) return raw;
  const why = raw === undefined || raw === null
    ? `count is ${describe(raw)}; a preset component quantity is never defaulted`
    : `count must be a finite nonnegative integer, got ${describe(raw)}`;
  throw new SourceDataError(
    'preset_component_count',
    subject.presetId,
    subject.itemId,
    raw,
    `Preset ${label(subject.presetId, subject.presetName)}, component ${label(subject.itemId, subject.itemName)}: ${why}`,
  );
}

/**
 * Barter `requiredItems[].count`: a finite nonnegative number. Fractional quantities are real source
 * data (e.g. 155.1), so integrality is not a rule here; absent or null still throws.
 */
export function barterIngredientCount(
  raw: unknown,
  subject: { offeredItemId: string; offeredItemName?: string; itemId: string; itemName?: string },
): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw;
  const why = raw === undefined || raw === null
    ? `count is ${describe(raw)}; a barter ingredient quantity is never defaulted`
    : `count must be a finite nonnegative number, got ${describe(raw)}`;
  throw new SourceDataError(
    'barter_ingredient_count',
    subject.offeredItemId,
    subject.itemId,
    raw,
    `Barter for ${label(subject.offeredItemId, subject.offeredItemName)}, ingredient ${label(subject.itemId, subject.itemName)}: ${why}`,
  );
}
