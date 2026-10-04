// Family 8: provisional MOA model (ADR 0013 section 3 item 8, ADR 0006, ADR 0007 section 1, ADR 0010 section 4 item 8).
//   MOA = effectiveCOI x (1 - sum(accuracy)/100) x K,  K = 100/2.9089 = 1000000/29089 (about 34.3773)
//   effectiveCOI = an installed barrel's COI when positive (it REPLACES the intrinsic value), else the intrinsic COI.
// Every case caps MOA, so every outcome carries the provisional-model qualification and the certificate
// is never certified_optimal. The model is a pinned software convention, not an attested game law.
//
// The caps are chosen with a clear margin from the exact MOA values (all stated as exact rationals;
// the decimals in the derivations are only for orientation):
//   coi 1/16 -> 62500/29089 = 2.149     coi 1/8 -> 125000/29089 = 4.297     coi 1/4 -> 250000/29089 = 8.594
//   coi 1/2  -> 500000/29089 = 17.189   (29089 = 19 x 1531, so some values reduce)

import { defineCase, fix, nk, nakedBuild, reqSlot, ROOT, slot } from './dsl';
import type { LedgerCase } from './types';

const ADR = ['ADR 0006 section 5 (formula)', 'ADR 0007 section 1', 'ADR 0010 section 4 item 8', 'ADR 0013 section 3 item 8'];
const NOTE_PROVISIONAL = 'The expectation follows the pinned provisional replacement/linear model; it is not an attested game formula (ADR 0006).';

/** weapon COI 1/16; barrel slot s: bad(1/2, +5), good(1/8, +2), plus the fixtures' own extras. */
const barrels = [
  { id: 'bad', centerOfImpact: 0.5, ergonomics: 5 },
  { id: 'good', centerOfImpact: 0.125, ergonomics: 2 },
];

export const FAMILY_08: LedgerCase[] = [
  defineCase({
    id: 'F08-positive-replacement-barrel',
    family: 8,
    subcases: ['positive_replacement_barrel'],
    title: 'A positive barrel COI replaces the receiver COI instead of adding to it',
    adrRefs: ADR,
    prerequisites: 'Receiver COI 1/16 (MOA 2.149); barrel COI 1/8; max_moa 5.',
    source: 'Optional slot s:[b]; b(+2, COI 1/8).',
    fixture: fix({
      items: [{ id: 'b', centerOfImpact: 0.125, ergonomics: 2 }],
      weapon: { centerOfImpact: 0.0625, slots: [slot('s', ['b'])] },
    }),
    request: { recoil_weight: 0, max_moa: 5 },
    feasible: [nk(), nk('b')],
    maxScore: '2',
    maximizers: [nk('b')],
    statChecks: [
      { label: 'bare receiver', build: nakedBuild(), values: { effectiveCenterOfImpact: '1/16', moa: '62500/29089' } },
      { label: 'with barrel', build: nakedBuild([ROOT, 's', 'b']), values: { effectiveCenterOfImpact: '1/8', moa: '125000/29089' } },
    ],
    derivation: `With the barrel the effective COI is 1/8 (replacement), so MOA = (1/8) K = 125000/29089 = 4.297 <= 5: feasible. An additive model would give (1/16 + 1/8) K = 6.446 > 5 and wrongly reject it.
Feasible: none (2.149), b (4.297). Scores 0 and 2; b wins.`,
    notes: [NOTE_PROVISIONAL],
  }),

  defineCase({
    id: 'F08-optional-barrel-fallback',
    family: 8,
    subcases: ['optional_fallback'],
    title: 'With an optional barrel slot the intrinsic COI is a legal fallback and a too-wide barrel is excluded',
    adrRefs: ADR,
    prerequisites: 'Receiver COI 1/16; barrels bad (COI 1/2) and good (COI 1/8); max_moa 5; the barrel slot is optional.',
    source: 'Optional slot s:[bad, good]; bad(+5), good(+2).',
    fixture: fix({ items: barrels, weapon: { centerOfImpact: 0.0625, slots: [slot('s', ['bad', 'good'])] } }),
    request: { recoil_weight: 0, max_moa: 5 },
    feasible: [nk(), nk('good')],
    maxScore: '2',
    maximizers: [nk('good')],
    rejections: [{ label: 'bad barrel', build: nakedBuild([ROOT, 's', 'bad']), codes: ['MAX_MOA_EXCEEDED'] }],
    statChecks: [{ label: 'bad barrel', build: nakedBuild([ROOT, 's', 'bad']), values: { moa: '500000/29089' } }],
    derivation: `No barrel: fallback to the intrinsic COI, MOA 62500/29089 = 2.149 <= 5, feasible. good: 4.297 <= 5, feasible. bad: 500000/29089 = 17.189 > 5, excluded.
Feasible: none, good. bad (+5) would be best by ergonomics but breaks the cap, so good = 2 wins.`,
    notes: [NOTE_PROVISIONAL],
  }),

  defineCase({
    id: 'F08-required-barrel-slot-fallback-via-missing-coi',
    family: 8,
    subcases: ['required_fallback', 'missing_coi'],
    title: 'A required barrel slot has no empty fallback; only a barrel without COI falls back to the intrinsic value',
    adrRefs: [...ADR, 'ADR 0007 section 3 (fallback impossible when a barrel is required)'],
    prerequisites: 'Receiver COI 1/16; the barrel slot is required; bz has no centerOfImpact; max_moa 5.',
    source: 'Required slot s:[bad, good, bz]; bad(+5, COI 1/2), good(+2, COI 1/8), bz(+1, no COI).',
    fixture: fix({
      items: [...barrels, { id: 'bz', ergonomics: 1 }],
      weapon: { centerOfImpact: 0.0625, slots: [reqSlot('s', ['bad', 'good', 'bz'])] },
    }),
    request: { recoil_weight: 0, max_moa: 5 },
    feasible: [nk('good'), nk('bz')],
    maxScore: '2',
    maximizers: [nk('good')],
    scores: [[nk('bz'), '1']],
    rejections: [
      { label: 'no barrel', build: nakedBuild(), codes: ['MISSING_REQUIRED_SLOT'] },
      { label: 'bad barrel', build: nakedBuild([ROOT, 's', 'bad']), codes: ['MAX_MOA_EXCEEDED'] },
    ],
    statChecks: [{ label: 'bz', build: nakedBuild([ROOT, 's', 'bz']), values: { effectiveCenterOfImpact: '1/16', moa: '62500/29089' } }],
    derivation: `The slot is required, so the empty (intrinsic) build is out. A barrel without COI does not override, so bz keeps MOA 62500/29089 = 2.149 <= 5; good gives 4.297 <= 5; bad gives 17.189 > 5.
Feasible: good (+2), bz (+1); good wins.`,
    notes: [NOTE_PROVISIONAL],
  }),

  defineCase({
    id: 'F08-missing-and-nonpositive-coi-fall-back',
    family: 8,
    subcases: ['missing_coi', 'nonpositive_coi'],
    title: 'A barrel with a missing or negative COI falls back to the intrinsic COI instead of overriding it',
    adrRefs: ADR,
    prerequisites: 'Receiver COI 1/2 (MOA 17.189), max_moa 10; bm has no COI, bn has COI -1/4, bg has COI 1/8.',
    source: 'Optional slot s:[bm, bn, bg]; bm(+3), bn(+4), bg(+2).',
    fixture: fix({
      items: [
        { id: 'bm', ergonomics: 3 },
        { id: 'bn', centerOfImpact: -0.25, ergonomics: 4 },
        { id: 'bg', centerOfImpact: 0.125, ergonomics: 2 },
      ],
      weapon: { centerOfImpact: 0.5, slots: [slot('s', ['bm', 'bn', 'bg'])] },
    }),
    request: { recoil_weight: 0, max_moa: 10 },
    feasible: [nk('bg')],
    maxScore: '2',
    maximizers: [nk('bg')],
    rejections: [
      { label: 'missing COI', build: nakedBuild([ROOT, 's', 'bm']), codes: ['MAX_MOA_EXCEEDED'] },
      { label: 'negative COI', build: nakedBuild([ROOT, 's', 'bn']), codes: ['MAX_MOA_EXCEEDED'] },
      { label: 'bare receiver', build: nakedBuild(), codes: ['MAX_MOA_EXCEEDED'] },
    ],
    statChecks: [
      { label: 'negative COI barrel', build: nakedBuild([ROOT, 's', 'bn']), values: { effectiveCenterOfImpact: '1/2', moa: '500000/29089' } },
      { label: 'missing COI barrel', build: nakedBuild([ROOT, 's', 'bm']), values: { effectiveCenterOfImpact: '1/2' } },
    ],
    derivation: `Only a positive barrel COI replaces the intrinsic value. bm and bn keep COI 1/2, so their MOA is 500000/29089 = 17.189 > 10 (as is the bare receiver). bg replaces it with 1/8: 4.297 <= 10.
Feasible: bg only. Had the negative COI overridden, bn would give -8.594 <= 10 and (+4) would win.`,
    notes: [NOTE_PROVISIONAL],
  }),

  defineCase({
    id: 'F08-zero-intrinsic-coi-receiver',
    family: 8,
    subcases: ['zero_intrinsic_coi'],
    title: 'A receiver with intrinsic COI 0 still enforces the replacement rows of its barrels',
    adrRefs: [...ADR, 'ADR 0007 section 1 (replacement rows stay active on zero-intrinsic receivers)'],
    prerequisites: 'Receiver COI 0, so the intrinsic fallback has MOA 0; max_moa 5; barrels bw (COI 1/2) and bg (COI 1/8).',
    source: 'Optional slot s:[bw, bg]; bw(+9), bg(+2).',
    fixture: fix({
      items: [{ id: 'bw', centerOfImpact: 0.5, ergonomics: 9 }, { id: 'bg', centerOfImpact: 0.125, ergonomics: 2 }],
      weapon: { centerOfImpact: 0, slots: [slot('s', ['bw', 'bg'])] },
    }),
    request: { recoil_weight: 0, max_moa: 5 },
    feasible: [nk(), nk('bg')],
    maxScore: '2',
    maximizers: [nk('bg')],
    rejections: [{ label: 'wide barrel', build: nakedBuild([ROOT, 's', 'bw']), codes: ['MAX_MOA_EXCEEDED'] }],
    statChecks: [{ label: 'bare receiver', build: nakedBuild(), values: { effectiveCenterOfImpact: '0', moa: '0' } }],
    derivation: `The bare receiver has MOA 0 <= 5. bw replaces COI by 1/2: MOA 17.189 > 5, excluded; bg replaces it by 1/8: 4.297 <= 5, feasible.
A model that skips the barrel rows when the intrinsic COI is 0 would wrongly admit bw (+9). Feasible: none, bg; bg = 2 wins.`,
    notes: [NOTE_PROVISIONAL],
  }),

  defineCase({
    id: 'F08-zero-intrinsic-coi-cap-zero',
    family: 8,
    subcases: ['zero_intrinsic_coi'],
    title: 'A zero MOA cap admits exactly the builds whose MOA is exactly zero',
    adrRefs: [...ADR, 'ADR 0007 section 1 (zero and negative caps are real rows)'],
    prerequisites: 'Same zero-COI receiver; max_moa 0.',
    source: 'Same fixture as F08-zero-intrinsic-coi-receiver.',
    fixture: fix({
      items: [{ id: 'bw', centerOfImpact: 0.5, ergonomics: 9 }, { id: 'bg', centerOfImpact: 0.125, ergonomics: 2 }],
      weapon: { centerOfImpact: 0, slots: [slot('s', ['bw', 'bg'])] },
    }),
    request: { recoil_weight: 0, max_moa: 0 },
    feasible: [nk()],
    maxScore: '0',
    maximizers: [nk()],
    rejections: [{ label: 'barrel bg', build: nakedBuild([ROOT, 's', 'bg']), codes: ['MAX_MOA_EXCEEDED'] }],
    derivation: `Any installed barrel has positive MOA > 0. Only the bare receiver (MOA exactly 0, equal to the cap) remains: the zero cap is a real constraint, not an absent one. Score 0.`,
    notes: [NOTE_PROVISIONAL],
  }),

  defineCase({
    id: 'F08-constant-moa-exceeds-cap',
    family: 8,
    subcases: ['constant_moa_exceeds_cap'],
    title: 'When MOA is a constant above the cap the request is infeasible (the constant row is not dropped)',
    adrRefs: [...ADR, 'ADR 0007 section 3 (constant-only modular presolve)'],
    prerequisites: 'Receiver COI 1/2; no barrel slot and no accuracy parts, so MOA = 500000/29089 = 17.189 for every build; max_moa 17.',
    source: 'Optional slot s:[i]; i(+3) has neither COI nor accuracy.',
    fixture: fix({ items: [{ id: 'i', ergonomics: 3 }], weapon: { centerOfImpact: 0.5, slots: [slot('s', ['i'])] } }),
    request: { recoil_weight: 0, max_moa: 17 },
    feasible: [],
    maxScore: null,
    maximizers: [],
    rejections: [
      { label: 'bare receiver', build: nakedBuild(), codes: ['MAX_MOA_EXCEEDED'] },
      { label: 'with i', build: nakedBuild([ROOT, 's', 'i']), codes: ['MAX_MOA_EXCEEDED'] },
    ],
    derivation: `MOA is the constant 500000/29089 = 17.1886 for every build and exceeds the cap 17, so every build is rejected: the feasible set is empty. A model that drops the constant row because nothing varies would wrongly return builds.`,
    notes: [NOTE_PROVISIONAL],
  }),

  defineCase({
    id: 'F08-constant-moa-within-cap',
    family: 8,
    subcases: ['constant_moa_exceeds_cap'],
    title: 'The same constant MOA just below a cap of 18 leaves every build feasible',
    adrRefs: ADR,
    prerequisites: 'As F08-constant-moa-exceeds-cap with max_moa 18.',
    source: 'Same fixture; max_moa 18.',
    fixture: fix({ items: [{ id: 'i', ergonomics: 3 }], weapon: { centerOfImpact: 0.5, slots: [slot('s', ['i'])] } }),
    request: { recoil_weight: 0, max_moa: 18 },
    feasible: [nk(), nk('i')],
    maxScore: '3',
    maximizers: [nk('i')],
    derivation: `17.1886 <= 18, so the constant row is slack and both builds stay feasible: none (0), i (+3). Best 3.`,
    notes: [NOTE_PROVISIONAL],
  }),

  defineCase({
    id: 'F08-signed-accuracy',
    family: 8,
    subcases: ['signed_accuracy'],
    title: 'Positive accuracy shrinks MOA and negative accuracy grows it; the signed sum decides the cap',
    adrRefs: ADR,
    prerequisites: 'Receiver COI 1/4 (MOA 8.594); max_moa 8, i.e. the accuracy sum must reach about 6.9.',
    source: 'Slots sa:[boost], sb:[nerf]; boost(+1 ergonomics, accuracy +10), nerf(+5, accuracy -5).',
    fixture: fix({
      items: [{ id: 'boost', ergonomics: 1, accuracyModifier: 10 }, { id: 'nerf', ergonomics: 5, accuracyModifier: -5 }],
      weapon: { centerOfImpact: 0.25, slots: [slot('sa', ['boost']), slot('sb', ['nerf'])] },
    }),
    request: { recoil_weight: 0, max_moa: 8 },
    feasible: [nk('boost')],
    maxScore: '1',
    maximizers: [nk('boost')],
    rejections: [
      { label: 'boost and nerf', build: nakedBuild([ROOT, 'sa', 'boost'], [ROOT, 'sb', 'nerf']), codes: ['MAX_MOA_EXCEEDED'] },
      { label: 'nerf only', build: nakedBuild([ROOT, 'sb', 'nerf']), codes: ['MAX_MOA_EXCEEDED'] },
      { label: 'bare receiver', build: nakedBuild(), codes: ['MAX_MOA_EXCEEDED'] },
    ],
    statChecks: [
      { label: 'boost', build: nakedBuild([ROOT, 'sa', 'boost']), values: { accuracyModifierSum: '10', moa: '225000/29089' } },
      { label: 'nerf', build: nakedBuild([ROOT, 'sb', 'nerf']), values: { accuracyModifierSum: '-5', moa: '262500/29089' } },
      { label: 'boost and nerf', build: nakedBuild([ROOT, 'sa', 'boost'], [ROOT, 'sb', 'nerf']), values: { accuracyModifierSum: '5', moa: '12500/1531' } },
    ],
    derivation: `MOA = (1/4)(1 - A/100) K. A=0: 250000/29089 = 8.594; A=+10: 225000/29089 = 7.735; A=-5: 262500/29089 = 9.024; A=+5: 12500/1531 = 8.165. Only A=+10 (boost alone) is <= 8.
Feasible: boost only (score 1). boost+nerf (the sum +5 still misses) is excluded although it has the best ergonomics.`,
    notes: [NOTE_PROVISIONAL],
  }),

  defineCase({
    id: 'F08-negative-suppressor',
    family: 8,
    subcases: ['signed_accuracy', 'negative_suppressor'],
    title: 'A -5% suppressor breaks the cap alone but passes when a +10% part offsets it',
    adrRefs: [...ADR, 'ADR 0010 section 4 item 8 (worst-case negative suppressor)'],
    prerequisites: 'Receiver COI 1/8 (MOA 4.297); max_moa 4.4.',
    source: 'Slots sa:[sup], sb:[bo]; sup(+8, accuracy -5), bo(+1, accuracy +10).',
    fixture: fix({
      items: [{ id: 'sup', ergonomics: 8, accuracyModifier: -5 }, { id: 'bo', ergonomics: 1, accuracyModifier: 10 }],
      weapon: { centerOfImpact: 0.125, slots: [slot('sa', ['sup']), slot('sb', ['bo'])] },
    }),
    request: { recoil_weight: 0, max_moa: 4.4 },
    feasible: [nk(), nk('bo'), nk('bo', 'sup')],
    maxScore: '9',
    maximizers: [nk('bo', 'sup')],
    scores: [[nk('bo'), '1']],
    rejections: [{ label: 'suppressor alone', build: nakedBuild([ROOT, 'sa', 'sup']), codes: ['MAX_MOA_EXCEEDED'] }],
    statChecks: [
      { label: 'suppressor alone', build: nakedBuild([ROOT, 'sa', 'sup']), values: { moa: '131250/29089' } },
      { label: 'suppressor with the booster', build: nakedBuild([ROOT, 'sa', 'sup'], [ROOT, 'sb', 'bo']), values: { moa: '6250/1531' } },
    ],
    derivation: `MOA = (1/8)(1 - A/100) K: none 4.297 (ok), bo alone 112500/29089 = 3.867 (ok), sup alone (A=-5) 131250/29089 = 4.512 > 4.4 (out), sup+bo (A=+5) 6250/1531 = 4.082 (ok).
Feasible: none, bo, bo+sup. Best bo+sup = 1+8 = 9: the negative modifier is kept in the sum, not clamped at zero.`,
    notes: [NOTE_PROVISIONAL],
  }),

  defineCase({
    id: 'F08-high-divergence-linear-model',
    family: 8,
    subcases: ['high_divergence'],
    title: 'At +50% accuracy the linear model passes a cap that the divisor and compound families reject',
    adrRefs: [...ADR, 'ADR 0006 sections 1 and 3 (formula families diverge at high accuracy)'],
    prerequisites: 'Receiver COI 1/4; two +25% parts; max_moa 4.5. Linear: 4.297; divisor family: 5.730; compound family: 4.834.',
    source: 'Slots s1:[acc], s2:[acc]; acc(+1, accuracy +25).',
    fixture: fix({
      items: [{ id: 'acc', ergonomics: 1, accuracyModifier: 25 }],
      weapon: { centerOfImpact: 0.25, slots: [slot('s1', ['acc']), slot('s2', ['acc'])] },
    }),
    request: { recoil_weight: 0, max_moa: 4.5 },
    feasible: [nk('acc', 'acc')],
    maxScore: '2',
    maximizers: [nk('acc', 'acc')],
    rejections: [
      { label: 'one acc part', build: nakedBuild([ROOT, 's1', 'acc']), codes: ['MAX_MOA_EXCEEDED'] },
      { label: 'bare receiver', build: nakedBuild(), codes: ['MAX_MOA_EXCEEDED'] },
    ],
    statChecks: [
      { label: 'two acc parts', build: nakedBuild([ROOT, 's1', 'acc'], [ROOT, 's2', 'acc']), values: { accuracyModifierSum: '50', moa: '125000/29089' } },
      { label: 'one acc part', build: nakedBuild([ROOT, 's1', 'acc']), values: { moa: '187500/29089' } },
    ],
    physicalBuildCount: 1,
    derivation: `Linear model: MOA = (1/4)(1 - 50/100) K = 125000/29089 = 4.297 <= 4.5 (feasible); one part: 187500/29089 = 6.446 > 4.5; none: 8.594 > 4.5. Feasible: acc+acc only, score 2.
The divisor family (1/4 K / 1.5 = 5.730) and the compound family (1/4 K x 0.75 x 0.75 = 4.834) would both reject acc+acc: the example separates the families by far more than display rounding.`,
    notes: [NOTE_PROVISIONAL, 'Names the high-divergence example the provisional model must reproduce; it is not evidence for the linear family.'],
  }),
];
