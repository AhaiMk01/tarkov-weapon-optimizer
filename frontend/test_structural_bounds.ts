import assert from 'node:assert/strict';
import { choiceFixture } from './test_solver_fixtures.ts';
import { buildCompatibilityMap } from './src/solver/compatibilityMap.ts';
import { computeStructuralBounds } from './src/solver/structuralBounds.ts';
import { fetchAllData, buildItemLookup } from './src/solver/dataService.ts';
import { presetSupply } from './src/solver/presetSupply.ts';

console.log('Running structural bounds tests...');

// 1. Two mutually exclusive parts in one slot:
// Receiver: 1 kg.
// Part A: 2 kg. Part B: 5 kg.
// Naive sum: 1 + 2 + 5 = 8 kg.
// Structural bound: 1 + max(2, 5) = 6 kg!
{
  const fixture = choiceFixture([
    { id: 'A', weight: 3, ergo: 10 }, // 3 kg total build -> 2 kg part
    { id: 'B', weight: 6, ergo: 20 }, // 6 kg total build -> 5 kg part
  ]);
  const bounds = computeStructuralBounds('gun', fixture.itemLookup, fixture.compatibilityMap);
  assert.equal(bounds.weightBounds[0], 3, 'Min weight should be 1kg receiver + 2kg part A = 3kg');
  assert.equal(bounds.weightBounds[1], 6, 'Max weight should be 1kg receiver + 5kg part B = 6kg (NOT 8kg!)');
}

// 2. User maxWeight clamp:
{
  const fixture = choiceFixture([
    { id: 'A', weight: 3, ergo: 10 },
    { id: 'B', weight: 6, ergo: 20 },
  ]);
  const bounds = computeStructuralBounds('gun', fixture.itemLookup, fixture.compatibilityMap, { maxWeight: 4.5 });
  assert.equal(bounds.weightBounds[1], 4.5, 'Max weight should be clamped to user maxWeight 4.5kg');
}

// 3. Real weapon data tests (M4A1, SVDS, AK-74N):
{
  const data = await fetchAllData('en', 'regular');
  const lookup = buildItemLookup(data.guns, data.mods);
  for (const gunName of ['M4A1', 'SVDS', 'AK-74N']) {
    const gun = data.guns.find((g: Record<string, unknown>) => typeof g.name === 'string' && g.name.includes(gunName));
    assert.ok(gun, `Gun ${gunName} must exist`);
    const cmap = buildCompatibilityMap(gun.id, lookup);
    const bounds = computeStructuralBounds(gun.id, lookup, cmap);

    const [minW, maxW] = bounds.weightBounds;
    assert.ok(minW > 0, `${gunName} minWeight must be > 0 (got ${minW})`);
    assert.ok(maxW > minW, `${gunName} maxWeight must be > minWeight (got [${minW}, ${maxW}])`);
    assert.ok(maxW < 25, `${gunName} maxWeight must be realistically tight (< 25kg, got ${maxW})`);

    // Verify all factory presets fall strictly within [minW, maxW]
    const gunEntry = lookup[gun.id];
    if (gunEntry?.type === 'gun') {
      const baseW = gunEntry.stats.weight || 0;
      for (const preset of gunEntry.presets) {
        // The receiver once, plus every supplied component weighed once per supplied copy.
        let presetWeight = baseW;
        for (const [id, copies] of presetSupply(preset.items)) {
          const m = lookup[id];
          presetWeight += copies * (m && 'weight' in m.stats ? (m.stats.weight || 0) : 0);
        }
        assert.ok(
          presetWeight >= minW - 1e-4 && presetWeight <= maxW + 1e-4,
          `Preset ${preset.name} weight ${presetWeight} must be within [${minW}, ${maxW}]`
        );
      }
    }
  }
}

console.log('All structural bounds tests passed.');
