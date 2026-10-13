// The finite domains of the auxiliary columns are PROVED enclosures (ADR 0007 sections 2 and 4, ADR 0013 section 4C): the range of every statistic
// over the structurally buildable trees, summed in binary64 in some order, must contain the exact rational range. The reference here recomputes
// the same reverse sweep in exact rationals over seeded random worlds with awkward fractional leaves (0.1, 0.0155, 1/3, signed values), and the
// production enclosure must contain it and be tight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RAT_ZERO, ratAdd, ratCmp, ratFromDouble, type Rat } from '../../src/solver/physical/exact';
import { computeActiveBounds, preparePhysicalWeapon, prepareSubproblemDomain, type PhysicalBlueprint, type SubproblemDomain } from '../../src/solver/physical';
import { gunWith, lookupOf, modWith, slot, WEAPON } from './lpFixtures';
import type { ItemLookup } from '../../src/solver/types';

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const WEIGHTS = [0.1, 0.0155, 1 / 3, 0.35, 2.5, 0.7, 1.0000000000000002, -0.2, 0.05];
const ERGOS = [0, 1.5, -3.3, 7, 0.1, -0.7, 12.25];
const RECOILS = [0, -0.05, 0.07, -0.123, 0.0001, 0.3333];
const ACCURACIES = [0, -5, 0.1, 2.55, -0.35, 10];

interface World { lookup: ItemLookup; blueprint: PhysicalBlueprint; domain: SubproblemDomain }

function randomWorld(seed: number): World {
  const next = lcg(seed);
  const pick = <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)];
  const ids: string[] = [];
  const entries: [string, ReturnType<typeof modWith>][] = [];
  // three tiers of parts: tier 0 sits on the receiver, tier 1 on tier 0, tier 2 on tier 1; every part may own optional or required slots
  const tiers: string[][] = [[], [], []];
  for (let t = 2; t >= 0; t--) {
    const count = 2 + Math.floor(next() * 3);
    for (let k = 0; k < count; k++) {
      const id = `p${t}_${k}`;
      ids.push(id);
      tiers[t].push(id);
      const slots = t < 2 && next() < 0.7 ? [slot(`s${t}_${k}`, tiers[t + 1].slice(0, 1 + Math.floor(next() * tiers[t + 1].length)), next() < 0.3)] : [];
      entries.push([id, modWith(id, { weight: pick(WEIGHTS), ergo: pick(ERGOS), recoil: pick(RECOILS), accuracy: pick(ACCURACIES), slots })]);
    }
  }
  const rootSlots = [slot('r0', tiers[0], next() < 0.4), slot('r1', tiers[0].slice(0, 2)), slot('r2', tiers[0].slice(1), next() < 0.2)];
  const lookup = lookupOf(gunWith(WEAPON, { weight: pick(WEIGHTS) + 1, ergo: pick(ERGOS), slots: rootSlots }), ...entries);
  const blueprint = preparePhysicalWeapon(lookup, WEAPON);
  return { lookup, blueprint, domain: prepareSubproblemDomain(blueprint, lookup) };
}

/** The reverse sweep of `computeActiveBounds` in exact rationals: per occurrence the best and worst statistic of its subtree. */
function exactRange(blueprint: PhysicalBlueprint, domain: SubproblemDomain, values: Readonly<Float64Array>, receiverOnly = false): { lo: Rat; hi: Rat } {
  const N = blueprint.occurrenceCount;
  const lo: Rat[] = new Array<Rat>(N).fill(RAT_ZERO);
  const hi: Rat[] = new Array<Rat>(N).fill(RAT_ZERO);
  for (let v = N - 1; v >= 0; v--) {
    if (!domain.occActive[v]) continue;
    const own = receiverOnly && v === 0 ? RAT_ZERO : ratFromDouble(values[blueprint.occTemplate[v]]);
    lo[v] = own;
    hi[v] = own;
    for (let s = blueprint.occSlotStart[v]; s < blueprint.occSlotStart[v + 1]; s++) {
      let cLo: Rat | null = null;
      let cHi: Rat | null = null;
      for (let c = blueprint.slotCandStart[s], end = c + blueprint.slotCandCount[s]; c < end; c++) {
        if (!domain.occActive[c]) continue;
        if (cLo === null || ratCmp(lo[c], cLo) < 0) cLo = lo[c];
        if (cHi === null || ratCmp(hi[c], cHi) > 0) cHi = hi[c];
      }
      if (cLo === null || cHi === null) continue;
      if (blueprint.slotRequired(s)) {
        lo[v] = ratAdd(lo[v], cLo);
        hi[v] = ratAdd(hi[v], cHi);
      } else {
        lo[v] = ratAdd(lo[v], ratCmp(cLo, RAT_ZERO) < 0 ? cLo : RAT_ZERO);
        hi[v] = ratAdd(hi[v], ratCmp(cHi, RAT_ZERO) > 0 ? cHi : RAT_ZERO);
      }
    }
  }
  return { lo: lo[0], hi: hi[0] };
}

test('the active bounds of seeded random worlds enclose the exact rational ranges of weight, ergonomics, recoil modifier and accuracy, and are tight', () => {
  let worlds = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const { blueprint, domain } = randomWorld(seed * 7919);
    if (domain.empty) continue;
    worlds++;
    const bounds = computeActiveBounds(blueprint, domain);
    const stats: [string, Readonly<Float64Array>, { lo: number; hi: number }, boolean][] = [
      ['weight', blueprint.templateWeight, bounds.weight, false],
      ['ergonomics', blueprint.templateErgonomics, bounds.ergonomics, false],
      ['recoil', blueprint.templateRecoilModifier, bounds.recoil, true],
      ['accuracy', blueprint.templateAccuracyModifier, bounds.accuracy, true],
    ];
    for (const [name, values, enclosure, receiverOnly] of stats) {
      const exact = exactRange(blueprint, domain, values, receiverOnly);
      assert.ok(ratCmp(ratFromDouble(enclosure.lo), exact.lo) <= 0, `seed ${seed} ${name}: the lower end is at most the exact minimum`);
      assert.ok(ratCmp(ratFromDouble(enclosure.hi), exact.hi) >= 0, `seed ${seed} ${name}: the upper end is at least the exact maximum`);
      const width = Number(exact.hi.n) / Number(exact.hi.d) - Number(exact.lo.n) / Number(exact.lo.d);
      const slack = (Number(exact.lo.n) / Number(exact.lo.d) - enclosure.lo) + (enclosure.hi - Number(exact.hi.n) / Number(exact.hi.d));
      assert.ok(slack >= 0 && slack <= 1e-9 * Math.max(1, width), `seed ${seed} ${name}: the enclosure is tight (slack ${slack})`);
    }
  }
  assert.ok(worlds >= 80, `${worlds} nonempty worlds`);
});
