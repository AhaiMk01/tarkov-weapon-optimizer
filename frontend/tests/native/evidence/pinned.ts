// Shared loader of the pinned capture for the Stage 3 native evidence tests (workstream 3.3, docs/stage3/native-evidence.md).
// frontend/benchmarks/snapshot.json, SHA-256 219443b4... (ADR 0013 section 1): the same artifact and the same ammunition rule as
// tests/physical/countModel.pinned.test.ts and tests/physical/scale.test.ts. Tests skip when the snapshot is not restored.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildItemLookup } from '../../../src/solver/dataService';
import type { ItemLookup } from '../../../src/solver/types';

const SNAPSHOT_PATH = fileURLToPath(new URL('../../../benchmarks/snapshot.json', import.meta.url));
export const SNAPSHOT_SHA256 = '219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c';

/** `false` when the snapshot is present (run), otherwise the skip reason. */
export const pinnedSkip: false | string = existsSync(SNAPSHOT_PATH) ? false : 'frontend/benchmarks/snapshot.json is not restored (ADR 0013 section 1)';

export interface PinnedGun { id: string; shortName: string }
export interface Pinned {
  guns: PinnedGun[];
  lookup: ItemLookup;
  /** On this capture every allowed id the lookup does not hold is ammunition (tests/physical/scale.test.ts). */
  isAmmo: (id: string) => boolean;
  /** Every gun with this short name (the capture has two `SR-25` entries). */
  gunsNamed: (shortName: string) => PinnedGun[];
}

let cached: Pinned | null = null;

/** Load (once) and verify the pinned capture. Call only when `pinnedSkip === false`. */
export function loadPinned(): Pinned {
  if (cached !== null) return cached;
  const bytes = readFileSync(SNAPSHOT_PATH);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), SNAPSHOT_SHA256, 'the snapshot must be the pinned artifact');
  const snapshot = JSON.parse(bytes.toString('utf8')) as { guns: PinnedGun[]; mods: Record<string, unknown>[] };
  const lookup = buildItemLookup(snapshot.guns as never, snapshot.mods as never);
  const guns = snapshot.guns;
  cached = {
    guns,
    lookup,
    isAmmo: (id: string): boolean => !Object.hasOwn(lookup, id),
    gunsNamed: (shortName: string): PinnedGun[] => {
      const found = guns.filter(g => g.shortName === shortName);
      assert.ok(found.length > 0, `no pinned gun named ${shortName}`);
      return found;
    },
  };
  return cached;
}
