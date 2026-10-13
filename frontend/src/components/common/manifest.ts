/**
 * The instance-aware manifest (ADR 0013 sections 4A and 4E, Phase 2.8): how the installed occurrences of a build are split for display.
 *
 * `selected_items` has one record per installed OCCURRENCE (a unique `instanceId`); the template id repeats for copies. Each record says how that
 * very occurrence was supplied (`acquisition`): the base preset's stock, an owned copy, or a purchase. The split below is by that per-occurrence
 * provenance, never by template id: a template the preset supplies twice and the build installs three times has two preset occurrences and one
 * purchased one, and that is how it is listed. The shopping list and every price shown reflect the same provenance.
 */

import type { ItemDetail, OptimizeResponse } from '../../api/client';
import { presetSupply } from '../../solver/presetSupply';

export type SupplyKind = 'preset' | 'owned' | 'offer';

/** How an occurrence was supplied, `null` for a record that carries no provenance (it is then listed with the rest). */
export const supplyOf = (item: Pick<ItemDetail, 'acquisition'>): SupplyKind | null => item.acquisition?.source ?? null;

export interface ManifestPartition {
  /** Occurrences the base preset supplies, shown on the preset card. One entry per occurrence. */
  preset: ItemDetail[];
  /** Everything else (purchased and owned occurrences), shown in the manifest. One entry per occurrence. */
  listed: ItemDetail[];
}

export function partitionManifest(result: Pick<OptimizeResponse, 'selected_items' | 'selected_preset'>): ManifestPartition {
  const preset: ItemDetail[] = [];
  const listed: ItemDetail[] = [];
  for (const item of result.selected_items) {
    if (result.selected_preset !== undefined && supplyOf(item) === 'preset') preset.push(item);
    else listed.push(item);
  }
  return { preset, listed };
}

/** The preset's stock: units supplied (the sum of its component counts) against occurrences actually installed from it. */
export function presetUsage(result: Pick<OptimizeResponse, 'selected_items' | 'selected_preset'>): { supplied: number; installed: number } {
  let supplied = 0;
  for (const count of presetSupply(result.selected_preset?.items).values()) supplied += count;
  return { supplied, installed: partitionManifest(result).preset.length };
}
