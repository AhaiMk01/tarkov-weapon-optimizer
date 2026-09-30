import assert from 'node:assert/strict';
import { solve } from './src/solver/solver.ts';
import { overswingPercent, tedContribution, trueErgoDelta, isShownTedDelta } from './src/solver/trueErgo.ts';
import { choiceFixture } from './test_solver_fixtures.ts';

const near = (got: number | undefined, want: number, msg: string) =>
  assert.ok(got != null && Math.abs(got - want) < 1e-9, `${msg}: got ${got}, want ${want}`);

// 8 kg at 40 ergo: swing 8 * 0.6 = 4.8 kg -> (4.8 - 3) / 4 = 45%; TED = 40 - 62.5 = -22.5.
// The only part carries the whole 40 ergo and 7 of the 8 kg, so removing it leaves 0 ergo at 1 kg
// (TED 0): the part costs the build exactly its TED.
{
  const result = await solve({ ...choiceFixture([{ id: 'heavy', weight: 8, ergo: 40 }]), useTrueErgo: true });
  assert.equal(result.status, 'optimal', result.reason);
  near(result.final_stats?.true_ergo_delta, -22.5, 'TED');
  near(result.final_stats?.overswing_pct, 45, 'overswing %');
  near(result.selected_items[0].ted_delta, -22.5, 'part TED delta');
}

// Not overswinging: no severity, and the part is credited with all of its TED.
{
  const result = await solve({ ...choiceFixture([{ id: 'light', weight: 3, ergo: 30 }]), useTrueErgo: true });
  near(result.final_stats?.true_ergo_delta, 30, 'TED');
  near(result.final_stats?.overswing_pct, 0, 'overswing %');
  near(result.selected_items[0].ted_delta, 30, 'part TED delta');
}

// The gear modifier applies to severity the same way it applies to TED: 50 ergo * 0.8 = 40.
{
  const result = await solve({ ...choiceFixture([{ id: 'heavy', weight: 8, ergo: 50 }]), useTrueErgo: true, equipErgoModifier: -0.2 });
  near(result.final_stats?.overswing_pct, 45, 'overswing % with gear modifier');
  near(result.final_stats?.true_ergo_delta, -22.5, 'TED with gear modifier');
}

// Severity is shown for a raw-ergo solve too (it is a stat of the build, not of the objective).
{
  const result = await solve(choiceFixture([{ id: 'heavy', weight: 8, ergo: 40 }]));
  near(result.final_stats?.overswing_pct, 45, 'overswing % without TrueErgo');
}

// A part's delta is TED(build) - TED(build without it): several parts, each recomputed by hand.
{
  const totalErgo = 40, totalWeight = 8;
  for (const [ergo, weight] of [[10, 0.5], [0, 2], [-5, 0.1]] as const) {
    const expected = trueErgoDelta(totalErgo, totalWeight) - trueErgoDelta(totalErgo - ergo, totalWeight - weight);
    near(tedContribution(totalErgo, totalWeight, ergo, weight), expected, `contribution ${ergo}/${weight}`);
  }
  // +10 ergo / 0.5 kg: TED -22.5 with it, 30 - 60 = -30 without it.
  near(tedContribution(totalErgo, totalWeight, 10, 0.5), 7.5, 'hand-computed +10 ergo / 0.5 kg part');
}

// Severity is nonzero exactly when TED is negative, across weights, ergo and gear modifiers.
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

// Tiny deltas are hidden so a tag never reads "+0.0".
assert.equal(isShownTedDelta(0.04), false);
assert.equal(isShownTedDelta(-0.05), true);
assert.equal(isShownTedDelta(undefined), false);
console.log('TED display: overswing severity and per-part TED delta passed');
