// Family 4: includes, excludes and hard caps (ADR 0013 section 3 item 4, ADR 0010 section 4 item 4
// and its "full ledger additionally includes" list).
// Include groups are conjunctive across groups and disjunctive inside a group; a category id
// matches an item anywhere in its category chain (interpretation 5 of the oracle). Recoil caps are
// on the FINAL recoil nakedV x (1 + sum of modifiers); the model's modifier bound is cap/nakedV - 1.

import { defineCase, fix, nk, nakedBuild, ROOT, slot } from './dsl';
import type { LedgerCase } from './types';

const ADR = ['ADR 0003 principle 4 (include/exclude)', 'ADR 0010 section 4 item 4', 'ADR 0013 section 3 item 4'];
const ERGO_ONLY = { recoil_weight: 0 };

// Shared small fixtures ------------------------------------------------------------------------------------------

/** Three plain parts a, b, c (+1, +2, +3), two slots that take any of them. */
const capacityFixture = fix({
  items: [{ id: 'a', ergonomics: 1 }, { id: 'b', ergonomics: 2 }, { id: 'c', ergonomics: 3 }],
  weapon: { slots: [slot('s1', ['a', 'b', 'c']), slot('s2', ['a', 'b', 'c'])] },
});

/** a(+1), b(+2); a lists b; z(+5) fits no slot at all. */
const impossibleFixture = fix({
  items: [{ id: 'a', ergonomics: 1, conflictingItemIds: ['b'] }, { id: 'b', ergonomics: 2 }, { id: 'z', ergonomics: 5 }],
  weapon: { slots: [slot('s1', ['a']), slot('s2', ['b'])] },
});

/** Receiver V=100, H=200. s1: ergonomics -3, recoil -1/4; s2: ergonomics -2, recoil -1/8; receiver ergonomics 50. */
const recoilFixture = fix({
  items: [{ id: 's1', ergonomics: -3, recoilModifier: -0.25 }, { id: 's2', ergonomics: -2, recoilModifier: -0.125 }],
  weapon: { ergonomics: 50, recoilVertical: 100, recoilHorizontal: 200, slots: [slot('sa', ['s1']), slot('sb', ['s2'])] },
});
const s1Build = nakedBuild([ROOT, 'sa', 's1']);
const s2Build = nakedBuild([ROOT, 'sb', 's2']);
const bothBuild = nakedBuild([ROOT, 'sa', 's1'], [ROOT, 'sb', 's2']);

export const FAMILY_04: LedgerCase[] = [
  defineCase({
    id: 'F04-include-item',
    family: 4,
    subcases: ['include_item'],
    title: 'include_items forces the template to be installed and changes the optimum',
    adrRefs: ADR,
    prerequisites: 'Receiver ergonomics 10 keeps every build away from the clamps.',
    source: 'Slots s1:[a], s2:[b]; a(-2), b(+3); include_items [a].',
    fixture: fix({
      items: [{ id: 'a', ergonomics: -2 }, { id: 'b', ergonomics: 3 }],
      weapon: { ergonomics: 10, slots: [slot('s1', ['a']), slot('s2', ['b'])] },
    }),
    request: { ...ERGO_ONLY, include_items: ['a'] },
    feasible: [nk('a'), nk('a', 'b')],
    maxScore: '11',
    maximizers: [nk('a', 'b')],
    scores: [[nk('a'), '8']],
    rejections: [
      { label: 'nothing installed', build: nakedBuild(), codes: ['MISSING_INCLUDE_ITEM'] },
      { label: 'b without a', build: nakedBuild([ROOT, 's2', 'b']), codes: ['MISSING_INCLUDE_ITEM'] },
    ],
    derivation: `Builds without a are infeasible, leaving a (10-2 = 8) and a+b (10-2+3 = 11). Without the include, b alone (13) would win; with it a+b = 11 is the unique maximum.`,
  }),

  defineCase({
    id: 'F04-include-duplicates-add-nothing',
    family: 4,
    subcases: ['include_item'],
    title: 'Listing an included template twice does not require two copies',
    adrRefs: ADR,
    prerequisites: 'include_items [a, a] on the fixture of F04-include-item; receiver ergonomics 10.',
    source: 'Slots s1:[a], s2:[b]; a(-2), b(+3); include_items [a, a].',
    fixture: fix({
      items: [{ id: 'a', ergonomics: -2 }, { id: 'b', ergonomics: 3 }],
      weapon: { ergonomics: 10, slots: [slot('s1', ['a']), slot('s2', ['b'])] },
    }),
    request: { ...ERGO_ONLY, include_items: ['a', 'a'] },
    feasible: [nk('a'), nk('a', 'b')],
    maxScore: '11',
    maximizers: [nk('a', 'b')],
    accepts: [{ label: 'a single copy of a', build: nakedBuild([ROOT, 's1', 'a']) }],
    derivation: `An include asks for the template to be installed at least once; repeating it in the list changes nothing, so the result equals the single include: a (8) and a+b (11), best a+b = 11.`,
    notes: ['The ADR states "at least once"; duplicates adding nothing is the oracle documented reading.'],
  }),

  defineCase({
    id: 'F04-include-category',
    family: 4,
    subcases: ['include_category'],
    title: 'An include group is satisfied by any installed item of one of its categories',
    adrRefs: ADR,
    prerequisites: 'include_categories [[cx]]: at least one installed item whose category chain contains cx.',
    source: 'Slots s1:[x1], s2:[x2], s3:[y]; x1(+1) and x2(+2) are in cx, y(+3) in cy.',
    fixture: fix({
      items: [
        { id: 'x1', ergonomics: 1, categories: ['cx'] },
        { id: 'x2', ergonomics: 2, categories: ['cx'] },
        { id: 'y', ergonomics: 3, categories: ['cy'] },
      ],
      weapon: { slots: [slot('s1', ['x1']), slot('s2', ['x2']), slot('s3', ['y'])] },
    }),
    request: { ...ERGO_ONLY, include_categories: [['cx']] },
    feasible: [nk('x1'), nk('x2'), nk('x1', 'x2'), nk('x1', 'y'), nk('x2', 'y'), nk('x1', 'x2', 'y')],
    maxScore: '6',
    maximizers: [nk('x1', 'x2', 'y')],
    rejections: [
      { label: 'nothing installed', build: nakedBuild(), codes: ['MISSING_INCLUDE_CATEGORY_GROUP'] },
      { label: 'y only', build: nakedBuild([ROOT, 's3', 'y']), codes: ['MISSING_INCLUDE_CATEGORY_GROUP'] },
    ],
    derivation: `A build needs x1 or x2 (or both), with y optional: 3 x 2 = 6 projections. The empty build and y alone miss the group. Best: x1+x2+y = 1+2+3 = 6.`,
  }),

  defineCase({
    id: 'F04-category-group-structure',
    family: 4,
    subcases: ['category_group_structure'],
    title: 'Groups are conjunctive and the categories inside a group are disjunctive',
    adrRefs: [...ADR, 'ADR 0010 section 4 (category-group inclusion)'],
    prerequisites: 'include_categories [[c1, c2], [c3]]: (an item of c1 OR of c2) AND an item of c3.',
    source: 'Four optional slots, one item each: a(c1,+1), b(c2,+2), c(c3,+3), d(c4,+1); receiver ergonomics 10.',
    fixture: fix({
      items: [
        { id: 'a', ergonomics: 1, categories: ['c1'] },
        { id: 'b', ergonomics: 2, categories: ['c2'] },
        { id: 'c', ergonomics: 3, categories: ['c3'] },
        { id: 'd', ergonomics: 1, categories: ['c4'] },
      ],
      weapon: { ergonomics: 10, slots: [slot('sa', ['a']), slot('sb', ['b']), slot('sc', ['c']), slot('sd', ['d'])] },
    }),
    request: { ...ERGO_ONLY, include_categories: [['c1', 'c2'], ['c3']] },
    feasible: [nk('a', 'c'), nk('b', 'c'), nk('a', 'b', 'c'), nk('a', 'c', 'd'), nk('b', 'c', 'd'), nk('a', 'b', 'c', 'd')],
    maxScore: '17',
    maximizers: [nk('a', 'b', 'c', 'd')],
    rejections: [
      { label: 'a and b but no c', build: nakedBuild([ROOT, 'sa', 'a'], [ROOT, 'sb', 'b']), codes: ['MISSING_INCLUDE_CATEGORY_GROUP'] },
      { label: 'c only', build: nakedBuild([ROOT, 'sc', 'c']), codes: ['MISSING_INCLUDE_CATEGORY_GROUP'] },
      { label: 'd only', build: nakedBuild([ROOT, 'sd', 'd']), codes: ['MISSING_INCLUDE_CATEGORY_GROUP'] },
    ],
    derivation: `The first group needs a, b or both (3 choices), the second group needs c, and d is free (2 choices): 3 x 2 = 6 projections.
Best: all four = 10+1+2+3+1 = 17.`,
  }),

  defineCase({
    id: 'F04-exclude-item',
    family: 4,
    subcases: ['exclude_item'],
    title: 'exclude_items bans a template everywhere it could be installed',
    adrRefs: ADR,
    prerequisites: 'The banned template is offered in two slots.',
    source: 'Slots s1:[a, b], s2:[b]; a(+3), b(+5); request excludes b.',
    fixture: fix({
      items: [{ id: 'a', ergonomics: 3 }, { id: 'b', ergonomics: 5 }],
      weapon: { slots: [slot('s1', ['a', 'b']), slot('s2', ['b'])] },
    }),
    request: { ...ERGO_ONLY, exclude_items: ['b'] },
    feasible: [nk(), nk('a')],
    maxScore: '3',
    maximizers: [nk('a')],
    rejections: [{ label: 'banned b', build: nakedBuild([ROOT, 's1', 'b']), codes: ['EXCLUDED_ITEM'] }],
    derivation: `b is banned in every slot, so only a (in s1) or nothing remains. Best a = 3 although b (+5) would have been better.`,
  }),

  defineCase({
    id: 'F04-exclude-category-direct',
    family: 4,
    subcases: ['exclude_category'],
    title: 'exclude_categories bans every item of the category and nothing else',
    adrRefs: ADR,
    prerequisites: 'm1 is in category muzzle (its own category); m2 and k are not.',
    source: 'Slots s1:[m1], s2:[m2], s3:[k]; m1(+4, muzzle, mod), m2(+6, sight, mod), k(+1, grip); request excludes category muzzle.',
    fixture: fix({
      items: [
        { id: 'm1', ergonomics: 4, categories: ['muzzle', 'mod'] },
        { id: 'm2', ergonomics: 6, categories: ['sight', 'mod'] },
        { id: 'k', ergonomics: 1, categories: ['grip'] },
      ],
      weapon: { slots: [slot('s1', ['m1']), slot('s2', ['m2']), slot('s3', ['k'])] },
    }),
    request: { ...ERGO_ONLY, exclude_categories: ['muzzle'] },
    feasible: [nk(), nk('m2'), nk('k'), nk('m2', 'k')],
    maxScore: '7',
    maximizers: [nk('m2', 'k')],
    rejections: [{ label: 'm1 is a muzzle', build: nakedBuild([ROOT, 's1', 'm1']), codes: ['EXCLUDED_CATEGORY'] }],
    derivation: `Only m1 is in muzzle, so it is out; m2 and k remain freely combinable: 4 projections. Best m2+k = 6+1 = 7.`,
  }),

  defineCase({
    id: 'F04-exclude-category-ancestor-chain',
    family: 4,
    subcases: ['exclude_category'],
    title: 'A category exclusion also bans items that carry the category only through their ancestor chain',
    adrRefs: ADR,
    prerequisites: 'Interpretation 5 of the oracle: a category matches anywhere in the item chain. Both m1 and m2 have mod as an ancestor category.',
    source: 'Same fixture as F04-exclude-category-direct; request excludes the ancestor category mod.',
    fixture: fix({
      items: [
        { id: 'm1', ergonomics: 4, categories: ['muzzle', 'mod'] },
        { id: 'm2', ergonomics: 6, categories: ['sight', 'mod'] },
        { id: 'k', ergonomics: 1, categories: ['grip'] },
      ],
      weapon: { slots: [slot('s1', ['m1']), slot('s2', ['m2']), slot('s3', ['k'])] },
    }),
    request: { ...ERGO_ONLY, exclude_categories: ['mod'] },
    feasible: [nk(), nk('k')],
    maxScore: '1',
    maximizers: [nk('k')],
    rejections: [
      { label: 'm1 under mod', build: nakedBuild([ROOT, 's1', 'm1']), codes: ['EXCLUDED_CATEGORY'] },
      { label: 'm2 under mod', build: nakedBuild([ROOT, 's2', 'm2']), codes: ['EXCLUDED_CATEGORY'] },
    ],
    derivation: `Both m1 and m2 have mod in their category chain, so both are banned; only k remains: none, k. Best k = 1.`,
    notes: ['Relies on interpretation 5 (category match anywhere in the chain).'],
  }),

  defineCase({
    id: 'F04-impossible-include-excluded',
    family: 4,
    subcases: ['impossible_include'],
    title: 'An included template that is also banned makes the request infeasible',
    adrRefs: ADR,
    prerequisites: 'include_items [a] and exclude_items [a] at once.',
    source: 'impossibleFixture: slots s1:[a], s2:[b]; a lists b; z fits no slot.',
    fixture: impossibleFixture,
    request: { ...ERGO_ONLY, include_items: ['a'], exclude_items: ['a'] },
    feasible: [],
    maxScore: null,
    maximizers: [],
    rejections: [
      { label: 'a installed although banned', build: nakedBuild([ROOT, 's1', 'a']), codes: ['EXCLUDED_ITEM'] },
      { label: 'nothing installed', build: nakedBuild(), codes: ['MISSING_INCLUDE_ITEM'] },
    ],
    derivation: `Satisfying the include needs a installed, which the ban forbids. No build satisfies both, so the feasible set is empty (certified infeasible).`,
  }),

  defineCase({
    id: 'F04-impossible-include-conflicting-pair',
    family: 4,
    subcases: ['impossible_include'],
    title: 'Two included templates that conflict make the request infeasible',
    adrRefs: ADR,
    prerequisites: 'include_items [a, b] while a lists b as a conflict.',
    source: 'impossibleFixture.',
    fixture: impossibleFixture,
    request: { ...ERGO_ONLY, include_items: ['a', 'b'] },
    feasible: [],
    maxScore: null,
    maximizers: [],
    rejections: [
      { label: 'a and b together', build: nakedBuild([ROOT, 's1', 'a'], [ROOT, 's2', 'b']), codes: ['TEMPLATE_CONFLICT'] },
      { label: 'a alone', build: nakedBuild([ROOT, 's1', 'a']), codes: ['MISSING_INCLUDE_ITEM'] },
    ],
    derivation: `Both includes need a and b installed together, which the pair conflict forbids: empty.`,
  }),

  defineCase({
    id: 'F04-impossible-include-unreachable-item',
    family: 4,
    subcases: ['impossible_include'],
    title: 'An included template that no slot can hold makes the request infeasible',
    adrRefs: ADR,
    prerequisites: 'z exists in the fixture but no slot lists it.',
    source: 'impossibleFixture; include_items [z].',
    fixture: impossibleFixture,
    request: { ...ERGO_ONLY, include_items: ['z'] },
    feasible: [],
    maxScore: null,
    maximizers: [],
    rejections: [{ label: 'nothing installed', build: nakedBuild(), codes: ['MISSING_INCLUDE_ITEM'] }],
    derivation: `z is not a candidate of any physical slot, so no rooted build contains it: empty.`,
  }),

  defineCase({
    id: 'F04-impossible-include-unmatched-category',
    family: 4,
    subcases: ['impossible_include'],
    title: 'An include group that no item can satisfy makes the request infeasible',
    adrRefs: ADR,
    prerequisites: 'include_categories [[ghost]] and no item has the category ghost.',
    source: 'impossibleFixture; items carry no categories.',
    fixture: impossibleFixture,
    request: { ...ERGO_ONLY, include_categories: [['ghost']] },
    feasible: [],
    maxScore: null,
    maximizers: [],
    rejections: [{ label: 'a installed', build: nakedBuild([ROOT, 's1', 'a']), codes: ['MISSING_INCLUDE_CATEGORY_GROUP'] }],
    derivation: `No item matches the group, so every build misses it: empty.`,
  }),

  defineCase({
    id: 'F04-include-exceeds-capacity',
    family: 4,
    subcases: ['include_exceeds_capacity'],
    title: 'Three required distinct templates cannot fit two physical slots',
    adrRefs: ADR,
    prerequisites: 'Two slots each hold one item; the include list names three distinct templates.',
    source: 'capacityFixture: slots s1,s2:[a,b,c]; include_items [a, b, c].',
    fixture: capacityFixture,
    request: { ...ERGO_ONLY, include_items: ['a', 'b', 'c'] },
    feasible: [],
    maxScore: null,
    maximizers: [],
    rejections: [{ label: 'a and b', build: nakedBuild([ROOT, 's1', 'a'], [ROOT, 's2', 'b']), codes: ['MISSING_INCLUDE_ITEM'] }],
    derivation: `Two slots install at most two distinct templates but three must be present: empty.`,
  }),

  defineCase({
    id: 'F04-include-fills-capacity-exactly',
    family: 4,
    subcases: ['include_exceeds_capacity'],
    title: 'Two included templates exactly fill two slots; a copy of one of them cannot also fit',
    adrRefs: ADR,
    prerequisites: 'Same fixture, include_items [a, b].',
    source: 'capacityFixture; include_items [a, b].',
    fixture: capacityFixture,
    request: { ...ERGO_ONLY, include_items: ['a', 'b'] },
    feasible: [nk('a', 'b')],
    maxScore: '3',
    maximizers: [nk('a', 'b')],
    rejections: [
      { label: 'a and c', build: nakedBuild([ROOT, 's1', 'a'], [ROOT, 's2', 'c']), codes: ['MISSING_INCLUDE_ITEM'] },
      { label: 'two copies of a', build: nakedBuild([ROOT, 's1', 'a'], [ROOT, 's2', 'a']), codes: ['MISSING_INCLUDE_ITEM'] },
    ],
    physicalBuildCount: 2,
    derivation: `Both slots must hold a and b, one each: in order (a,b) or (b,a). One projection a+b from 2 physical builds, score 1+2 = 3.`,
  }),

  defineCase({
    id: 'F04-magazine-boundary',
    family: 4,
    subcases: ['magazine_boundary'],
    title: 'min_mag_capacity is inclusive at the threshold and exclusive just below it',
    adrRefs: ADR,
    prerequisites: 'Receiver magazine capacity 0; one magazine slot.',
    source: 'Slot s:[m31, m30, m29] with capacities 31, 30, 29 and ergonomics +1, +2, +3; min_mag_capacity 30.',
    fixture: fix({
      items: [
        { id: 'm31', magazineCapacity: 31, ergonomics: 1 },
        { id: 'm30', magazineCapacity: 30, ergonomics: 2 },
        { id: 'm29', magazineCapacity: 29, ergonomics: 3 },
      ],
      weapon: { slots: [slot('s', ['m31', 'm30', 'm29'])] },
    }),
    request: { ...ERGO_ONLY, min_mag_capacity: 30 },
    feasible: [nk('m31'), nk('m30')],
    maxScore: '2',
    maximizers: [nk('m30')],
    rejections: [
      { label: 'm29 one below', build: nakedBuild([ROOT, 's', 'm29']), codes: ['MIN_MAGAZINE_NOT_MET'] },
      { label: 'no magazine', build: nakedBuild(), codes: ['MIN_MAGAZINE_NOT_MET'] },
    ],
    statChecks: [{ label: 'm30', build: nakedBuild([ROOT, 's', 'm30']), values: { magazineCapacity: '30' } }],
    derivation: `Capacity must reach 30: m31 (31) and m30 (30, equal) pass, m29 (29) and the bare receiver (0) fail. Best among m31 (+1) and m30 (+2) is m30 = 2 (m29 would be +3).`,
  }),

  defineCase({
    id: 'F04-magazine-capacity-is-max-not-sum',
    family: 4,
    subcases: ['magazine_boundary'],
    title: 'Two small magazines do not add up to reach the minimum',
    adrRefs: ADR,
    prerequisites: 'Interpretation 7 of the oracle: the minimum compares the largest capacity among the receiver and installed items.',
    source: 'Slots s1:[m20], s2:[m20]; m20 has capacity 20; min_mag_capacity 30.',
    fixture: fix({
      items: [{ id: 'm20', magazineCapacity: 20, ergonomics: 1 }],
      weapon: { slots: [slot('s1', ['m20']), slot('s2', ['m20'])] },
    }),
    request: { ...ERGO_ONLY, min_mag_capacity: 30 },
    feasible: [],
    maxScore: null,
    maximizers: [],
    rejections: [{ label: 'two m20', build: nakedBuild([ROOT, 's1', 'm20'], [ROOT, 's2', 'm20']), codes: ['MIN_MAGAZINE_NOT_MET'] }],
    statChecks: [{ label: 'two m20', build: nakedBuild([ROOT, 's1', 'm20'], [ROOT, 's2', 'm20']), values: { magazineCapacity: '20' } }],
    derivation: `The achieved capacity is the maximum 20, never 40, so no build reaches 30: empty.`,
    notes: ['Relies on interpretation 7 (maximum over receiver and installed items, not a sum).'],
  }),

  defineCase({
    id: 'F04-sighting-boundary',
    family: 4,
    subcases: ['sighting_boundary'],
    title: 'min_sighting_range is inclusive at an exactly representable threshold',
    adrRefs: ADR,
    prerequisites: 'Receiver sighting range 0; thresholds 99.5 and 99.25 are exact binary64 values.',
    source: 'Slot s:[r100, r995, r9925] with ranges 100, 99.5, 99.25 and ergonomics +1, +2, +3; min_sighting_range 99.5.',
    fixture: fix({
      items: [
        { id: 'r100', sightingRange: 100, ergonomics: 1 },
        { id: 'r995', sightingRange: 99.5, ergonomics: 2 },
        { id: 'r9925', sightingRange: 99.25, ergonomics: 3 },
      ],
      weapon: { slots: [slot('s', ['r100', 'r995', 'r9925'])] },
    }),
    request: { ...ERGO_ONLY, min_sighting_range: 99.5 },
    feasible: [nk('r100'), nk('r995')],
    maxScore: '2',
    maximizers: [nk('r995')],
    rejections: [
      { label: 'r9925 below', build: nakedBuild([ROOT, 's', 'r9925']), codes: ['MIN_SIGHTING_NOT_MET'] },
      { label: 'no sight', build: nakedBuild(), codes: ['MIN_SIGHTING_NOT_MET'] },
    ],
    statChecks: [{ label: 'r9925', build: nakedBuild([ROOT, 's', 'r9925']), values: { sightingRange: '397/4' } }],
    derivation: `99.5 and 99.25 are exactly representable, so the comparison is exact: r100 (100) and r995 (99.5, equal) pass; r9925 (99.25 = 397/4) and the bare receiver fail.
Best among r100 (+1) and r995 (+2) is r995 = 2.`,
  }),

  defineCase({
    id: 'F04-recoil-final-cap-vertical',
    family: 4,
    subcases: ['recoil_final_cap_conversion'],
    title: 'max_recoil_v caps the FINAL vertical recoil nakedV x (1 + sum), converted to a modifier bound',
    adrRefs: [...ADR, 'ADR 0009 principle 4 (recoil cap collapse)'],
    prerequisites: 'Receiver recoil V = 100, H = 200, ergonomics 50; recoil weight 0 so the score is the ergonomics. Cap 75 corresponds to modifier sum <= 75/100 - 1 = -1/4.',
    source: 'recoilFixture: s1(-3 ergonomics, recoil -1/4), s2(-2, -1/8); max_recoil_v 75.',
    fixture: recoilFixture,
    request: { ...ERGO_ONLY, max_recoil_v: 75 },
    feasible: [nk('s1'), nk('s1', 's2')],
    maxScore: '47',
    maximizers: [nk('s1')],
    scores: [[nk('s1', 's2'), '45']],
    rejections: [
      { label: 'bare receiver', build: nakedBuild(), codes: ['MAX_RECOIL_V_EXCEEDED'] },
      { label: 's2 only', build: s2Build, codes: ['MAX_RECOIL_V_EXCEEDED'] },
    ],
    statChecks: [
      { label: 's1', build: s1Build, values: { recoilVertical: '75', recoilHorizontal: '150' } },
      { label: 's2', build: s2Build, values: { recoilVertical: '175/2' } },
      { label: 'both', build: bothBuild, values: { recoilVertical: '125/2' } },
    ],
    derivation: `Final V = 100 x (1 + sum): none 100, s1 75 (equal to the cap, allowed), s2 87.5, both 62.5. Feasible: s1, s1+s2.
Ergonomics 50-3 = 47 (s1) and 50-3-2 = 45 (both); s1 wins. Without the cap the bare receiver (50) would win.`,
  }),

  defineCase({
    id: 'F04-recoil-final-cap-sum',
    family: 4,
    subcases: ['recoil_final_cap_conversion'],
    title: 'max_recoil_sum caps final vertical plus horizontal recoil',
    adrRefs: [...ADR, 'ADR 0009 principle 4'],
    prerequisites: 'Same receiver. Cap 262.5 = 300 x (7/8) corresponds to modifier sum <= -1/8.',
    source: 'recoilFixture; max_recoil_sum 262.5.',
    fixture: recoilFixture,
    request: { ...ERGO_ONLY, max_recoil_sum: 262.5 },
    feasible: [nk('s1'), nk('s2'), nk('s1', 's2')],
    maxScore: '48',
    maximizers: [nk('s2')],
    scores: [[nk('s1'), '47']],
    rejections: [{ label: 'bare receiver', build: nakedBuild(), codes: ['MAX_RECOIL_SUM_EXCEEDED'] }],
    statChecks: [
      { label: 's2', build: s2Build, values: { recoilVertical: '175/2', recoilHorizontal: '175' } },
      { label: 'bare', build: nakedBuild(), values: { recoilVertical: '100', recoilHorizontal: '200' } },
    ],
    derivation: `Final V+H = 300 x (1 + sum): none 300, s1 225, s2 262.5 (equal to the cap, allowed), both 187.5. Only the bare receiver fails.
Ergonomics: s2 = 48, s1 = 47, both = 45; s2 wins.`,
  }),

  defineCase({
    id: 'F04-recoil-final-caps-combined',
    family: 4,
    subcases: ['recoil_final_cap_conversion'],
    title: 'Vertical and sum caps together keep the stricter bound',
    adrRefs: [...ADR, 'ADR 0009 principle 4 (collapse to the stricter bound)'],
    prerequisites: 'Same receiver. V <= 87.5 means sum <= -1/8; V+H <= 225 means sum <= -1/4. The stricter is -1/4.',
    source: 'recoilFixture; max_recoil_v 87.5 and max_recoil_sum 225.',
    fixture: recoilFixture,
    request: { ...ERGO_ONLY, max_recoil_v: 87.5, max_recoil_sum: 225 },
    feasible: [nk('s1'), nk('s1', 's2')],
    maxScore: '47',
    maximizers: [nk('s1')],
    rejections: [
      { label: 's2 only (V ok, sum too high)', build: s2Build, codes: ['MAX_RECOIL_SUM_EXCEEDED'] },
      { label: 'bare receiver', build: nakedBuild(), codes: ['MAX_RECOIL_SUM_EXCEEDED', 'MAX_RECOIL_V_EXCEEDED'] },
    ],
    derivation: `s2: V = 87.5 meets the vertical cap but V+H = 262.5 > 225. s1: V = 75, V+H = 225 meets both (equal to the sum cap). both: 62.5 / 187.5 meets both. The bare receiver breaks both.
Feasible: s1 (47), s1+s2 (45); s1 wins.`,
  }),

  defineCase({
    id: 'F04-recoil-cap-zero-naked-recoil-is-not-dropped',
    family: 4,
    subcases: ['recoil_cap_nonpositive_denominator'],
    title: 'A negative vertical cap on a receiver with zero vertical recoil is a real constraint',
    adrRefs: [...ADR, 'ADR 0009 principle 4 (never silently drop a nontrivial cap)', 'ADR 0013 section 4C'],
    prerequisites: 'Receiver recoil V = 0, so the modifier conversion cap/nakedV - 1 has no positive denominator; the physical cap must be evaluated directly.',
    source: 'Receiver V=0, H=100; slot sa:[s1] with s1(+2, recoil -1/4); max_recoil_v -1.',
    fixture: fix({
      items: [{ id: 's1', ergonomics: 2, recoilModifier: -0.25 }],
      weapon: { recoilVertical: 0, recoilHorizontal: 100, slots: [slot('sa', ['s1'])] },
    }),
    request: { ...ERGO_ONLY, max_recoil_v: -1 },
    feasible: [],
    maxScore: null,
    maximizers: [],
    rejections: [
      { label: 'bare receiver', build: nakedBuild(), codes: ['MAX_RECOIL_V_EXCEEDED'] },
      { label: 's1', build: nakedBuild([ROOT, 'sa', 's1']), codes: ['MAX_RECOIL_V_EXCEEDED'] },
    ],
    statChecks: [{ label: 's1', build: nakedBuild([ROOT, 'sa', 's1']), values: { recoilVertical: '0' } }],
    derivation: `Final V = 0 x (1 + sum) = 0 for every build, and 0 > -1, so every build breaks the cap: empty. Dropping the cap for lack of a denominator would wrongly return builds.`,
  }),

  defineCase({
    id: 'F04-recoil-cap-zero-naked-recoil-trivial',
    family: 4,
    subcases: ['recoil_cap_nonpositive_denominator'],
    title: 'A zero vertical cap on a receiver with zero vertical recoil is satisfied by every build',
    adrRefs: [...ADR, 'ADR 0009 principle 4'],
    prerequisites: 'Same receiver, cap 0.',
    source: 'Receiver V=0, H=100; slot sa:[s1]; max_recoil_v 0.',
    fixture: fix({
      items: [{ id: 's1', ergonomics: 2, recoilModifier: -0.25 }],
      weapon: { recoilVertical: 0, recoilHorizontal: 100, slots: [slot('sa', ['s1'])] },
    }),
    request: { ...ERGO_ONLY, max_recoil_v: 0 },
    feasible: [nk(), nk('s1')],
    maxScore: '2',
    maximizers: [nk('s1')],
    derivation: `Final V = 0 <= 0 for every build, so the cap removes nothing: none (0) and s1 (+2). Best 2.`,
  }),

  defineCase({
    id: 'F04-max-price-cap-boundary',
    family: 4,
    subcases: ['other_hard_caps'],
    title: 'max_price counts the receiver offer plus paid units and is inclusive at the cap',
    adrRefs: [...ADR, 'ADR 0002 principle 3'],
    prerequisites: 'Receiver costs 1000; each part 100; no stock, no preset.',
    source: 'Slots s1:[a], s2:[b]; a(+3), b(+4); max_price 1100.',
    fixture: fix({
      items: [{ id: 'a', ergonomics: 3 }, { id: 'b', ergonomics: 4 }],
      weapon: { slots: [slot('s1', ['a']), slot('s2', ['b'])] },
    }),
    request: { ...ERGO_ONLY, max_price: 1100 },
    feasible: [nk(), nk('a'), nk('b')],
    maxScore: '4',
    maximizers: [nk('b')],
    rejections: [{ label: 'a and b', build: nakedBuild([ROOT, 's1', 'a'], [ROOT, 's2', 'b']), codes: ['MAX_PRICE_EXCEEDED'] }],
    statChecks: [
      { label: 'a', build: nakedBuild([ROOT, 's1', 'a']), values: { spend: '1100' } },
      { label: 'a and b', build: nakedBuild([ROOT, 's1', 'a'], [ROOT, 's2', 'b']), values: { spend: '1200' } },
    ],
    derivation: `Spend: none 1000, a 1100 (equal to the cap, allowed), b 1100, a+b 1200 (over). Feasible: none, a, b; best b = 4.`,
  }),

  defineCase({
    id: 'F04-max-weight-cap-boundary',
    family: 4,
    subcases: ['other_hard_caps'],
    title: 'max_weight is a hard cap on total mass, inclusive at the boundary',
    adrRefs: ADR,
    prerequisites: 'Receiver 1 kg; all masses are exact binary fractions.',
    source: 'Slots s1:[a], s2:[b]; a(0.5 kg, +1), b(1 kg, +3); max_weight 2.',
    fixture: fix({
      items: [{ id: 'a', weightKg: 0.5, ergonomics: 1 }, { id: 'b', weightKg: 1, ergonomics: 3 }],
      weapon: { weightKg: 1, slots: [slot('s1', ['a']), slot('s2', ['b'])] },
    }),
    request: { ...ERGO_ONLY, max_weight: 2 },
    feasible: [nk(), nk('a'), nk('b')],
    maxScore: '3',
    maximizers: [nk('b')],
    rejections: [{ label: 'a and b', build: nakedBuild([ROOT, 's1', 'a'], [ROOT, 's2', 'b']), codes: ['MAX_WEIGHT_EXCEEDED'] }],
    statChecks: [{ label: 'a and b', build: nakedBuild([ROOT, 's1', 'a'], [ROOT, 's2', 'b']), values: { weight: '5/2' } }],
    derivation: `Total mass: none 1, a 1.5, b 2 (equal to the cap, allowed), a+b 2.5 (over). Feasible: none, a, b; best b = 3.`,
  }),

  defineCase({
    id: 'F04-min-ergonomics-cap-boundary',
    family: 4,
    subcases: ['other_hard_caps'],
    title: 'min_ergonomics is inclusive at the boundary',
    adrRefs: ADR,
    prerequisites: 'Receiver ergonomics 40; objective weights e=0, r=1 so the optimum sits on the boundary.',
    source: 'Slot s:[a, b, c]: a(+10 ergonomics, recoil -1/4), b(+9.5, recoil -1/2), c(+20, recoil 0); min_ergonomics 50.',
    fixture: fix({
      items: [
        { id: 'a', ergonomics: 10, recoilModifier: -0.25 },
        { id: 'b', ergonomics: 9.5, recoilModifier: -0.5 },
        { id: 'c', ergonomics: 20 },
      ],
      weapon: { ergonomics: 40, slots: [slot('s', ['a', 'b', 'c'])] },
    }),
    request: { ergo_weight: 0, recoil_weight: 1, min_ergonomics: 50 },
    feasible: [nk('a'), nk('c')],
    maxScore: '250',
    maximizers: [nk('a')],
    scores: [[nk('c'), '0']],
    rejections: [
      { label: 'b at 49.5', build: nakedBuild([ROOT, 's', 'b']), codes: ['MIN_ERGONOMICS_NOT_MET'] },
      { label: 'bare receiver at 40', build: nakedBuild(), codes: ['MIN_ERGONOMICS_NOT_MET'] },
    ],
    derivation: `Ergonomics: none 40, a 50 (equal to the minimum, allowed), b 49.5, c 60. Feasible: a, c.
Score = -(1) x 1000 x recoil sum: a = +250, c = 0, b would be 500 but is infeasible. a is the unique maximum, exactly on the boundary.`,
  }),

  defineCase({
    id: 'F04-min-ergonomics-compares-the-pre-gear-value',
    family: 4,
    subcases: ['other_hard_caps'],
    title: 'min_ergonomics is checked against the displayed (first-clamp) ergonomics, not the gear-adjusted value',
    adrRefs: ADR,
    prerequisites: 'Interpretation 8 of the oracle. equip_ergo_modifier -1/2 halves the effective ergonomics; min_ergonomics 50; receiver ergonomics 40.',
    source: 'One slot s:[a]; a(+20 ergonomics).',
    fixture: fix({ items: [{ id: 'a', ergonomics: 20 }], weapon: { ergonomics: 40, slots: [slot('s', ['a'])] } }),
    request: { ...ERGO_ONLY, min_ergonomics: 50, equip_ergo_modifier: -0.5 },
    feasible: [nk('a')],
    maxScore: '60',
    maximizers: [nk('a')],
    rejections: [{ label: 'bare receiver (displayed 40)', build: nakedBuild(), codes: ['MIN_ERGONOMICS_NOT_MET'] }],
    statChecks: [{ label: 'a', build: nakedBuild([ROOT, 's', 'a']), values: { ergonomics: '60', effectiveErgonomics: '30' } }],
    derivation: `a gives displayed ergonomics 60 >= 50 (feasible) although the gear-adjusted value is 30. The bare receiver shows 40 < 50 (infeasible). Feasible: a only, score 60.`,
    notes: ['Relies on interpretation 8 (min_ergonomics compares the first-clamp, pre-gear ergonomics).'],
  }),

  defineCase({
    id: 'F04-near-cap-price-gap-one-1024th',
    family: 4,
    subcases: ['other_hard_caps', 'near_cap'],
    title: 'A part costing 2^-10 RUB over the cap is infeasible while the exact-cap part is feasible',
    adrRefs: [...ADR, 'ADR 0010 section 2 (exact rational comparison)'],
    prerequisites: 'Prices 100 and 100 + 2^-10 are exact binary64 values; the cap is 1100.',
    source: 'Slot s:[a, b]: a costs 100 + 2^-10 and gives +5, b costs 100 and gives +3; max_price 1100.',
    fixture: fix({
      items: [{ id: 'a', ergonomics: 5, offers: [{ kind: 'trader', trader: 'prapor', level: 1, price: 100 + 2 ** -10 }] }, { id: 'b', ergonomics: 3 }],
      weapon: { slots: [slot('s', ['a', 'b'])] },
    }),
    request: { ...ERGO_ONLY, max_price: 1100 },
    feasible: [nk(), nk('b')],
    maxScore: '3',
    maximizers: [nk('b')],
    rejections: [{ label: 'a costs 1100 + 1/1024', build: nakedBuild([ROOT, 's', 'a']), codes: ['MAX_PRICE_EXCEEDED'] }],
    tolerance: {
      kind: 'near_cap',
      gap: '1/1024',
      capCheck: { build: nakedBuild([ROOT, 's', 'a']), stat: 'spend', value: '1126401/1024', cap: '1100', direction: 'max' },
    },
    derivation: `Spend of a = 1000 + 100 + 2^-10 = 1126401/1024, which exceeds 1100 by exactly 1/1024; b spends exactly 1100 and is feasible.
Feasible: none, b. Best b = 3 although a (+5) is better: the small gap is infeasible, not a tie.`,
  }),

  defineCase({
    id: 'F04-near-cap-min-ergonomics-gap-2e-20',
    family: 4,
    subcases: ['other_hard_caps', 'near_cap'],
    title: 'Ergonomics 2^-20 under the minimum fails while the exact minimum passes',
    adrRefs: [...ADR, 'ADR 0010 section 2 (exact rational comparison)'],
    prerequisites: 'Receiver ergonomics 40; a adds 10 - 2^-20 (exact binary64); e=0, r=1 weights.',
    source: 'Slot s:[a, b]: a(+10 - 2^-20, recoil -1/2), b(+10, recoil -1/4); min_ergonomics 50.',
    fixture: fix({
      items: [
        { id: 'a', ergonomics: 10 - 2 ** -20, recoilModifier: -0.5 },
        { id: 'b', ergonomics: 10, recoilModifier: -0.25 },
      ],
      weapon: { ergonomics: 40, slots: [slot('s', ['a', 'b'])] },
    }),
    request: { ergo_weight: 0, recoil_weight: 1, min_ergonomics: 50 },
    feasible: [nk('b')],
    maxScore: '250',
    maximizers: [nk('b')],
    rejections: [{ label: 'a reaches 50 - 2^-20', build: nakedBuild([ROOT, 's', 'a']), codes: ['MIN_ERGONOMICS_NOT_MET'] }],
    tolerance: {
      kind: 'near_cap',
      gap: '1/1048576',
      capCheck: { build: nakedBuild([ROOT, 's', 'a']), stat: 'ergonomics', value: '52428799/1048576', cap: '50', direction: 'min' },
    },
    derivation: `a reaches 40 + 10 - 2^-20 = 52428799/1048576, which is below 50 by exactly 2^-20; b reaches exactly 50. The bare receiver (40) also fails.
Feasible: b only; score = 1000 x 1/4 = 250. a would score 500 but is infeasible by a small exact gap.`,
  }),
];
