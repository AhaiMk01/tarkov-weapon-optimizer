// Fixture helpers on top of the tiny lookup DSL (`fixtures.ts`): the model reads more statistics than that DSL names.

import type { GunLookupEntry, ModLookupEntry } from '../../src/solver/types';
import { gun, mod, type GunSpec, type ModSpec } from './fixtures';

export * from './fixtures';

export interface ExtraModStats {
  accuracy?: number;
  /** Barrel centre of impact (a value > 0 replaces the receiver's). */
  coi?: number;
  capacity?: number;
  sighting?: number;
}

/** A mod entry that also carries accuracy, centre of impact, magazine capacity and sighting range. */
export function modWith(id: string, spec: ModSpec & ExtraModStats = {}): ModLookupEntry {
  const entry = mod(id, spec);
  entry.stats.accuracy_modifier = spec.accuracy ?? 0;
  entry.stats.center_of_impact = spec.coi ?? 0;
  entry.stats.capacity = spec.capacity ?? 0;
  entry.stats.sighting_range = spec.sighting ?? 0;
  return entry;
}

export interface ExtraGunStats {
  recoilV?: number;
  recoilH?: number;
  coi?: number;
  sighting?: number;
}

/** A gun entry that also carries naked recoil, centre of impact and sighting range. */
export function gunWith(id: string, spec: GunSpec & ExtraGunStats = {}): GunLookupEntry {
  const entry = gun(id, spec);
  entry.stats.naked_recoil_v = spec.recoilV ?? 0;
  entry.stats.naked_recoil_h = spec.recoilH ?? 0;
  entry.stats.center_of_impact = spec.coi ?? 0;
  entry.stats.sighting_range = spec.sighting ?? 0;
  return entry;
}
