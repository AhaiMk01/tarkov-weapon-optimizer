// Family 14: instance identity and source precision (ADR 0013 section 3 item 14, ADR 0003 principle 5,
// ADR 0002 principle 2, ADR 0010 section 4 item 14).
// Every installed occurrence has its own instance id (several copies of one template stay distinct);
// fractional masses are kept exactly (0.0155 kg is the exact binary64 value, never rounded to grams);
// negative masses are legal and signed; preset source counts are integers, repeated entries sum.
// Exact rationals of binary64 decimals were computed with Python fractions (an independent implementation).

import type { ReferenceBuild } from '../oracle/index';
import { defineCase, fix, nk, nakedBuild, presetBuild, ps, ROOT, slot } from './dsl';
import type { LedgerCase } from './types';

const ADR = ['ADR 0002 principle 2', 'ADR 0003 principle 5', 'ADR 0010 section 4 item 14', 'ADR 0013 section 3 item 14'];
const ERGO_ONLY = { recoil_weight: 0 };

const placement = (parentInstanceId: string, slotId: string, childInstanceId: string, itemId: string) =>
  ({ parentInstanceId, slotId, childInstanceId, itemId });

/** Receiver slots s1, s2 each take host H (+1); H has slot c taking grip (+3). */
const hostFixture = fix({
  items: [{ id: 'H', ergonomics: 1, slots: [slot('c', ['grip'])] }, { id: 'grip', ergonomics: 3 }],
  weapon: { slots: [slot('s1', ['H']), slot('s2', ['H'])] },
});

const duplicateIds: ReferenceBuild = {
  base: { kind: 'naked' },
  placements: [placement(ROOT, 's1', 'dup', 'H'), placement(ROOT, 's2', 'dup', 'H')],
};
const sameSlotTwice: ReferenceBuild = {
  base: { kind: 'naked' },
  placements: [placement(ROOT, 's1', 'i1', 'H'), placement(ROOT, 's1', 'i2', 'H')],
};
const externalIds: ReferenceBuild = {
  base: { kind: 'naked' },
  placements: [
    placement(ROOT, 's1', 'inst-a', 'H'),
    placement(ROOT, 's2', 'inst-b', 'H'),
    placement('inst-a', 'c', 'inst-c', 'grip'),
    placement('inst-b', 'c', 'inst-d', 'grip'),
  ],
};

/** Receiver 0 kg; mount (+1) weighs 0.0155 kg and fits three slots. */
const mountFixture = fix({
  items: [{ id: 'mount', ergonomics: 1, weightKg: 0.0155 }],
  weapon: { slots: [slot('s1', ['mount']), slot('s2', ['mount']), slot('s3', ['mount'])] },
});
const mounts = (n: number): ReferenceBuild => nakedBuild(...['s1', 's2', 's3'].slice(0, n).map(s => [ROOT, s, 'mount'] as [string, string, string]));

export const FAMILY_14: LedgerCase[] = [
  defineCase({
    id: 'F14-repeated-instance-identity',
    family: 14,
    subcases: ['instance_identity'],
    title: 'Copies of one template under different parents are distinct instances with unique ids',
    adrRefs: ADR,
    prerequisites: 'Host H fits two receiver slots and each H has its own grip slot, so grip can be installed twice under different parents.',
    source: 'hostFixture: receiver slots s1:[H], s2:[H]; H(+1) has slot c:[grip]; grip(+3).',
    fixture: hostFixture,
    request: ERGO_ONLY,
    feasible: [nk(), nk('H'), nk('H', 'grip'), nk('H', 'H'), nk('H', 'H', 'grip'), nk('H', 'H', 'grip', 'grip')],
    maxScore: '8',
    maximizers: [nk('H', 'H', 'grip', 'grip')],
    scores: [[nk('H', 'H', 'grip'), '5']],
    rejections: [
      { label: 'two placements sharing one instance id', build: duplicateIds, codes: ['DUPLICATE_INSTANCE_ID'] },
      { label: 'two children in one physical slot', build: sameSlotTwice, codes: ['SLOT_CAPACITY_EXCEEDED'] },
    ],
    accepts: [{ label: 'both grips with arbitrary distinct ids', build: externalIds }],
    physicalBuildCount: 9,
    derivation: `Each receiver slot holds {none, H with empty c, H with grip}: 9 trees and 6 projections (none, H, H+grip, HH, HH+grip, HH+grip+grip). The two grips of the best build sit under different hosts, so they are two instances of one template: weapon_0/s1:H/c:grip and weapon_0/s2:H/c:grip.
Score = 1 x copies of H + 3 x copies of grip: HH+grip+grip = 2 + 6 = 8 is the unique maximum.
An id shared by two placements (DUPLICATE_INSTANCE_ID) and two children in one physical slot (SLOT_CAPACITY_EXCEEDED) are different violations; arbitrary but unique external ids are accepted.`,
  }),

  defineCase({
    id: 'F14-fractional-weight-0155',
    family: 14,
    subcases: ['fractional_weight_0155'],
    title: 'A 0.0155 kg mount keeps its exact binary64 mass: two fit a 0.031 kg cap, three do not',
    adrRefs: [...ADR, 'ADR 0007 context (fractional inputs such as 15.5 g are preserved, not rounded)'],
    prerequisites: 'Receiver 0 kg; max_weight 0.031. The double 0.031 is exactly twice the double 0.0155 (same mantissa, next exponent).',
    source: 'mountFixture: slots s1..s3:[mount]; mount(+1) weighs 0.0155 kg.',
    fixture: mountFixture,
    request: { ...ERGO_ONLY, max_weight: 0.031 },
    feasible: [nk(), nk('mount'), nk('mount', 'mount')],
    maxScore: '2',
    maximizers: [nk('mount', 'mount')],
    rejections: [{ label: 'three mounts', build: mounts(3), codes: ['MAX_WEIGHT_EXCEEDED'] }],
    statChecks: [
      { label: 'one mount', build: mounts(1), values: { weight: '1116892707587883/72057594037927936' } },
      { label: 'two mounts', build: mounts(2), values: { weight: '1116892707587883/36028797018963968' } },
      { label: 'three mounts', build: mounts(3), values: { weight: '3350678122763649/72057594037927936' } },
    ],
    physicalBuildCount: 7,
    derivation: `The exact value of the double nearest 0.0155 is 1116892707587883/2^56. Two mounts weigh 2 x that = 1116892707587883/2^55, which equals the double 0.031 exactly, so they sit exactly on the cap (feasible); three mounts weigh 3350678122763649/2^56 = 0.0465 > 0.031 (infeasible).
Feasible: none, one mount (3 builds), two mounts (3 builds): 7 builds. Score = number of mounts: 2 is the unique maximum.
Rounding each mount to 16 g (or 15 g) would change the feasible set: 2 x 16 g = 32 g > 31 g would reject the best build.`,
    notes: ['The cap and the mass are decimal-looking binary64 values; the expectation uses their exact binary64 decoding (interpretation 3), not decimal arithmetic.'],
  }),

  defineCase({
    id: 'F14-negative-weight-ted',
    family: 14,
    subcases: ['negative_weight'],
    title: 'A negative-mass part lowers the total weight and the TED penalty',
    adrRefs: [...ADR, 'ADR 0007 section 6'],
    prerequisites: 'use_true_ergo, e=1, r=0; receiver 3.25 kg, ergonomics 60; neg weighs -0.5 kg, pos +0.5 kg, neither changes ergonomics.',
    source: 'One slot s:[neg, pos].',
    fixture: fix({
      items: [{ id: 'neg', weightKg: -0.5 }, { id: 'pos', weightKg: 0.5 }],
      weapon: { weightKg: 3.25, ergonomics: 60, slots: [slot('s', ['neg', 'pos'])] },
    }),
    request: { ...ERGO_ONLY, use_true_ergo: true },
    feasible: [nk(), nk('neg'), nk('pos')],
    maxScore: '60',
    maximizers: [nk('neg')],
    scores: [[nk(), '680/13'], [nk('pos'), '40']],
    statChecks: [
      { label: 'bare receiver', build: nakedBuild(), values: { weight: '13/4', weightPenalty: '100/13', ted: '680/13' } },
      { label: 'neg', build: nakedBuild([ROOT, 's', 'neg']), values: { weight: '11/4', weightPenalty: '0', ted: '60' } },
    ],
    derivation: `W = 3.25 (none), 2.75 (neg), 3.75 (pos). q(3.25) = 100 - 300/3.25 = 100 - 1200/13 = 100/13; q(2.75) = 0 (at most 3 kg); q(3.75) = 100 - 80 = 20.
TED = 60 - q: none 680/13 = 52.3, neg 60, pos 40. neg (W 2.75) is the unique maximum: a negative mass moves W below the 3 kg free limit.`,
  }),

  defineCase({
    id: 'F14-negative-weight-meets-weight-cap',
    family: 14,
    subcases: ['negative_weight'],
    title: 'Two negative-mass parts make a build feasible under a cap that the receiver alone exceeds',
    adrRefs: ADR,
    prerequisites: 'Receiver 3.25 kg; max_weight 2.5; neg weighs -0.5 kg. A weight bound that only sums nonnegative masses would call this infeasible.',
    source: 'Slots s1,s2:[neg]; neg(+1, -0.5 kg).',
    fixture: fix({
      items: [{ id: 'neg', weightKg: -0.5, ergonomics: 1 }],
      weapon: { weightKg: 3.25, slots: [slot('s1', ['neg']), slot('s2', ['neg'])] },
    }),
    request: { ...ERGO_ONLY, max_weight: 2.5 },
    feasible: [nk('neg', 'neg')],
    maxScore: '2',
    maximizers: [nk('neg', 'neg')],
    rejections: [
      { label: 'one neg (2.75 kg)', build: nakedBuild([ROOT, 's1', 'neg']), codes: ['MAX_WEIGHT_EXCEEDED'] },
      { label: 'bare receiver (3.25 kg)', build: nakedBuild(), codes: ['MAX_WEIGHT_EXCEEDED'] },
    ],
    statChecks: [{ label: 'two neg', build: nakedBuild([ROOT, 's1', 'neg'], [ROOT, 's2', 'neg']), values: { weight: '9/4' } }],
    derivation: `W = 3.25, 2.75, 2.25 for 0, 1, 2 copies of neg. Only 2.25 <= 2.5, so the single feasible projection is neg+neg (score 2). Both bounds on W are signed: the minimum weight is below the receiver mass.`,
  }),

  defineCase({
    id: 'F14-source-quantities-repeated-entries-and-zero-count',
    family: 14,
    subcases: ['source_quantities'],
    title: 'Preset counts are integers: repeated entries sum, a zero count supplies nothing, the receiver entry is harmless',
    adrRefs: [...ADR, 'ADR 0013 section 4A (counts are preserved, repeated entries sum)'],
    prerequisites: 'a, b and c have no standalone offers; the preset lists a twice (1 + 1), b once with count 2, c with count 0 and the receiver itself.',
    source: 'Optional slots sa1..sa3:[a], sb1..sb2:[b], sc:[c]; a(+1), b(+2), c(+4); preset pre = [a x1, a x1, b x2, c x0, gun x1].',
    fixture: fix({
      items: [
        { id: 'a', ergonomics: 1, offers: [] },
        { id: 'b', ergonomics: 2, offers: [] },
        { id: 'c', ergonomics: 4, offers: [] },
      ],
      weapon: {
        slots: [slot('sa1', ['a']), slot('sa2', ['a']), slot('sa3', ['a']), slot('sb1', ['b']), slot('sb2', ['b']), slot('sc', ['c'])],
      },
      presets: [{
        id: 'pre',
        weaponId: 'gun',
        components: [
          { itemId: 'a', count: 1 }, { itemId: 'a', count: 1 }, { itemId: 'b', count: 2 }, { itemId: 'c', count: 0 }, { itemId: 'gun', count: 1 },
        ],
        offers: [{ kind: 'trader', trader: 'prapor', level: 1, price: 1500 }],
      }],
    }),
    request: ERGO_ONLY,
    feasible: [
      nk(),
      ps('pre'), ps('pre', 'a'), ps('pre', 'a', 'a'),
      ps('pre', 'b'), ps('pre', 'a', 'b'), ps('pre', 'a', 'a', 'b'),
      ps('pre', 'b', 'b'), ps('pre', 'a', 'b', 'b'), ps('pre', 'a', 'a', 'b', 'b'),
    ],
    maxScore: '6',
    maximizers: [ps('pre', 'a', 'a', 'b', 'b')],
    scores: [[ps('pre', 'a', 'b', 'b'), '5'], [ps('pre', 'a', 'a', 'b'), '4']],
    rejections: [
      { label: 'three a (supply 2)', build: presetBuild('pre', [ROOT, 'sa1', 'a'], [ROOT, 'sa2', 'a'], [ROOT, 'sa3', 'a']), codes: ['QUANTITY_CAP_EXCEEDED'] },
      { label: 'c (supply 0)', build: presetBuild('pre', [ROOT, 'sc', 'c']), codes: ['QUANTITY_CAP_EXCEEDED'] },
      { label: 'a on the naked base', build: nakedBuild([ROOT, 'sa1', 'a']), codes: ['QUANTITY_CAP_EXCEEDED'] },
    ],
    physicalBuildCount: 29,
    derivation: `Supply of pre: a = 1 + 1 = 2 (repeated entries sum), b = 2, c = 0; the receiver entry is not an installable part. None of a, b, c can be bought, so each is capped at its supply, and the naked base supplies nothing.
Feasible: the naked base with no parts (1) and the preset base with 0..2 a and 0..2 b (9): 10 projections. Physical builds: a goes into 0..2 of 3 slots (1+3+3 = 7 ways), b into 0..2 of 2 slots (1+2+1 = 4 ways): 28 preset builds + 1 naked = 29.
Score = a + 2b: pre+aabb = 2 + 4 = 6 is the unique maximum. A model that read the repeated 'a' entries as presence (one copy) would cap a at 1.`,
  }),
];
