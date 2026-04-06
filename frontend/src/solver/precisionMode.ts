/**
 * Resolves Fast vs Precise LP mode. Auto uses reachable mod count from the compatibility BFS tree.
 */

import type { CompatibilityMap } from './types';

/** Auto mode runs Precise when the weapon's reachable mod count is at most this value. */
export const AUTO_PRECISE_MAX_REACHABLE_ITEMS = 220;

export type PrecisionRequest = 'auto' | 'fast' | 'precise';

export function normalizePrecisionRequest(raw: boolean | PrecisionRequest | undefined): PrecisionRequest {
  if (raw === true || raw === 'precise') return 'precise';
  if (raw === false || raw === 'fast') return 'fast';
  if (raw === 'auto') return 'auto';
  return 'fast';
}

export function resolvePreciseFlag(request: PrecisionRequest, compatMap: CompatibilityMap): boolean {
  if (request === 'precise') return true;
  if (request === 'fast') return false;
  const n = Object.keys(compatMap.reachable_items).length;
  return n <= AUTO_PRECISE_MAX_REACHABLE_ITEMS;
}
