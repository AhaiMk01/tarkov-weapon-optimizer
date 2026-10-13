// The TED display of a result (src/solver/trueErgo.ts helpers as buildDetails and solver.ts publish them): the overswing strength (0-100 %,
// nonzero exactly when TED < 0) and the per-part TED delta (TED of the build with the part minus TED without it). Migrated from
// test_ted_display.ts (Phase 2.9) onto the production `solve` with the pinned native build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { solve } from '../../src/solver/solver';
import { isShownTedDelta, overswingPercent, tedContribution, trueErgoDelta } from '../../src/solver/trueErgo';
import type { SolveParams } from '../../src/solver/types';
import { gun, lookupOf, mod, slot, WEAPON } from '../physical/lpFixtures';

const near = (got: number | undefined, want: number, msg: string): void =>
  assert.ok(got != null && Math.abs(got - want) < 1e-9, `${msg}: got ${got}, want ${want}`);

/** A 1 kg receiver with no ergonomics and one required slot holding the single part `p` (build weight 1 + `partWeight`). */
function onePart(partErgo: number, partWeight: number, extra: Partial<SolveParams> = {}): SolveParams {
  const lookup = lookupOf(gun(WEAPON, { weight: 1, slots: [slot('choice', ['p'], true)] }), ['p', mod('p', { ergo: partErgo, weight: partWeight })]);
  return {
    weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup),
    ergoWeight: 1, recoilWeight: 0, priceWeight: 0, fleaAvailable: true, preciseMode: true, ...extra,
  };
}

test('an overswinging build: 8 kg at 40 ergonomics swings 4.8 kg (45 %), TED -22.5, and its only part costs exactly that TED', async () => {
  // Without the part the build is the bare 1 kg receiver at 0 ergonomics: TED 0, so the part's delta is the whole TED.
  const r = await solve(onePart(40, 7, { useTrueErgo: true }));
  assert.equal(r.status, 'optimal', r.reason);
  near(r.final_stats?.true_ergo_delta, -22.5, 'TED');
  near(r.final_stats?.overswing_pct, 45, 'overswing %');
  near(r.selected_items[0].ted_delta, -22.5, 'part TED delta');
});

test('a build that does not overswing has no strength, and its part is credited with all of its TED', async () => {
  const r = await solve(onePart(30, 2, { useTrueErgo: true }));
  near(r.final_stats?.true_ergo_delta, 30, 'TED');
  near(r.final_stats?.overswing_pct, 0, 'overswing %');
  near(r.selected_items[0].ted_delta, 30, 'part TED delta');
});

test('the gear modifier scales the ergonomics of the strength as it does TED: 50 x 0.8 = 40', async () => {
  const r = await solve(onePart(50, 7, { useTrueErgo: true, equipErgoModifier: -0.2 }));
  near(r.final_stats?.overswing_pct, 45, 'overswing % with gear modifier');
  near(r.final_stats?.true_ergo_delta, -22.5, 'TED with gear modifier');
});

test('the strength is a statistic of the build, shown for a plain (raw ergonomics) request too', async () => {
  const r = await solve(onePart(40, 7));
  near(r.final_stats?.overswing_pct, 45, 'overswing % without TrueErgo');
});

test('a part delta is TED(build) - TED(build without it), recomputed by hand', () => {
  const totalErgo = 40, totalWeight = 8;
  for (const [ergo, weight] of [[10, 0.5], [0, 2], [-5, 0.1]] as const) {
    const expected = trueErgoDelta(totalErgo, totalWeight) - trueErgoDelta(totalErgo - ergo, totalWeight - weight);
    near(tedContribution(totalErgo, totalWeight, ergo, weight), expected, `contribution ${ergo}/${weight}`);
  }
  // +10 ergonomics / 0.5 kg: TED -22.5 with it, 30 - 60 = -30 without it.
  near(tedContribution(totalErgo, totalWeight, 10, 0.5), 7.5, 'hand-computed +10 ergo / 0.5 kg part');
});

test('the strength is nonzero exactly when TED is negative, across weights, ergonomics and gear modifiers; it is 0 at a 3 kg swing and caps at 100', () => {
  for (let w = 0.5; w <= 12; w += 0.37) {
    for (let e = -10; e <= 130; e += 3.1) {
      for (const m of [0, -0.15, 0.1]) {
        assert.equal(overswingPercent(e, w, m) > 1e-9, trueErgoDelta(e, w, m) < -1e-9, `w=${w} e=${e} m=${m}`);
      }
    }
  }
  near(overswingPercent(0, 3), 0, 'exactly 3 kg swing');
  near(overswingPercent(0, 7), 100, '7 kg swing is full');
  near(overswingPercent(0, 30), 100, 'capped at 100');
});

test('a tiny delta is hidden so a tag never reads "+0.0"', () => {
  assert.equal(isShownTedDelta(0.04), false);
  assert.equal(isShownTedDelta(-0.05), true);
  assert.equal(isShownTedDelta(undefined), false);
});
