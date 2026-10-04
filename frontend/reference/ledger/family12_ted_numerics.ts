// Family 12: TrueErgo (TED), overswing and boundary numerics (ADR 0013 section 3 item 12, ADR 0007 sections 5-6,
// ADR 0010 section 4 item 12).
//   TED = effective ergonomics - q(W),   q(W) = max(0, 100 - 300/W)  (free at or below 3 kg; concave above)
//   TED >= 0  <=>  W (1 - E/100) <= 3 kg  <=>  no overswing; overswing strength is nonzero exactly when TED < 0.
// Only the exact-arithmetic side of ADR 0007 is expressible in a finite ledger. Secant domains, outward
// allowances and mapping/parser/coefficient errors are native/numerical obligations of Stage 3.

import { defineCase, fix, nk, nakedBuild, ROOT, slot } from './dsl';
import type { LedgerCase } from './types';

const ADR = ['ADR 0007 sections 5 and 6', 'ADR 0010 section 4 item 12', 'ADR 0013 section 3 item 12'];
const TED_ONLY = { recoil_weight: 0, use_true_ergo: true };
const one = (id: string, slotId = 's') => nakedBuild([ROOT, slotId, id]);

// --- shared fixtures --------------------------------------------------------------------------------------------------

/** Receiver 2 kg, ergonomics 60; one slot s with parts of 0.5, 1, 1.75, 2, 3, 4, 5.5 and 10 kg (all ergonomics 0). */
const weightLadder = fix({
  items: [
    { id: 'a', weightKg: 0.5 },
    { id: 'b', weightKg: 1 },
    { id: 'c', weightKg: 1.75 },
    { id: 'd', weightKg: 2 },
    { id: 'f', weightKg: 3 },
    { id: 'g', weightKg: 4 },
    { id: 'h7', weightKg: 5.5 },
    { id: 'h12', weightKg: 10 },
  ],
  weapon: { weightKg: 2, ergonomics: 60, slots: [slot('s', ['a', 'b', 'c', 'd', 'f', 'g', 'h7', 'h12'])] },
});

/** Receiver 4 kg (penalty 25), ergonomics 20; e1/e2/e3 give effective ergonomics 26/25/24 and recoil 0, -1/4, -1/2. */
const overswingFixture = fix({
  items: [
    { id: 'e1', ergonomics: 6 },
    { id: 'e2', ergonomics: 5, recoilModifier: -0.25 },
    { id: 'e3', ergonomics: 4, recoilModifier: -0.5 },
  ],
  weapon: { weightKg: 4, ergonomics: 20, slots: [slot('s', ['e1', 'e2', 'e3'])] },
});

export const FAMILY_12: LedgerCase[] = [
  defineCase({
    id: 'F12-ted-weight-regimes',
    family: 12,
    subcases: ['weight_below_3kg', 'weight_at_3kg', 'weight_above_3kg', 'concave_penalty', 'ted_objective'],
    title: 'The TED weight penalty is free up to exactly 3 kg and 100 - 300/W above it',
    adrRefs: ADR,
    prerequisites: 'use_true_ergo, e=1, r=0; receiver 2 kg and ergonomics 60 (gear factor 1); parts have no ergonomics, so only the penalty varies.',
    source: 'weightLadder: one slot s taking a (0.5 kg), b (1), c (1.75), d (2), f (3), g (4), h7 (5.5) or h12 (10 kg).',
    fixture: weightLadder,
    request: TED_ONLY,
    feasible: [nk(), ...['a', 'b', 'c', 'd', 'f', 'g', 'h7', 'h12'].map(id => nk(id))],
    maxScore: '60',
    maximizers: [nk(), nk('a'), nk('b')],
    scores: [
      [nk('c'), '40'], [nk('d'), '35'], [nk('f'), '20'], [nk('g'), '10'], [nk('h7'), '0'], [nk('h12'), '-15'],
    ],
    statChecks: [
      { label: 'a (W 2.5, below 3 kg)', build: one('a'), values: { weight: '5/2', weightPenalty: '0', ted: '60' }, overswingNonzero: false },
      { label: 'b (W 3, exactly at 3 kg)', build: one('b'), values: { weight: '3', weightPenalty: '0', ted: '60' }, overswingNonzero: false },
      { label: 'c (W 3.75)', build: one('c'), values: { weight: '15/4', weightPenalty: '20', ted: '40' }, overswingNonzero: false },
      { label: 'd (W 4)', build: one('d'), values: { weight: '4', weightPenalty: '25', ted: '35' } },
      { label: 'f (W 5)', build: one('f'), values: { weight: '5', weightPenalty: '40', ted: '20' } },
      { label: 'g (W 6)', build: one('g'), values: { weight: '6', weightPenalty: '50', ted: '10' }, overswingNonzero: false },
      { label: 'h7 (W 7.5: TED exactly 0)', build: one('h7'), values: { weight: '15/2', weightPenalty: '60', ted: '0' }, overswingNonzero: false },
      { label: 'h12 (W 12: TED negative)', build: one('h12'), values: { weight: '12', weightPenalty: '75', ted: '-15' }, overswingNonzero: true },
    ],
    derivation: `W = 2 + part: none 2, a 2.5, b 3, c 3.75, d 4, f 5, g 6, h7 7.5, h12 12. q(W) = 0 for W <= 3 and 100 - 300/W above: c 100 - 80 = 20, d 25, f 40, g 50, h7 60, h12 75. Effective ergonomics are 60 throughout, so TED = 60 - q: 60, 60, 60, 40, 35, 20, 10, 0, -15.
The maximum 60 is reached by none, a and b: weights below and exactly at 3 kg tie because the penalty starts strictly above 3 kg. q is concave: q(5) = 40 exceeds the average (25 + 50)/2 = 37.5 of q(4) and q(6).
Overswing is nonzero only for h12 (TED < 0); h7 has TED exactly 0 (swing 7.5 x 0.4 = 3 kg) and is not overswinging.`,
  }),

  defineCase({
    id: 'F12-ted-tradeoff-optimum-at-three-kg',
    family: 12,
    subcases: ['weight_at_3kg', 'weight_above_3kg', 'ted_objective'],
    title: 'A heavy high-ergonomics part loses its gain to the weight penalty; the optimum sits exactly at 3 kg',
    adrRefs: ADR,
    prerequisites: 'use_true_ergo, e=1, r=0; receiver 2 kg, ergonomics 60.',
    source: 'One slot s:[light, heavy, mid]; light(+5, 0.5 kg), heavy(+30, 2 kg), mid(+10, 1 kg).',
    fixture: fix({
      items: [
        { id: 'light', ergonomics: 5, weightKg: 0.5 },
        { id: 'heavy', ergonomics: 30, weightKg: 2 },
        { id: 'mid', ergonomics: 10, weightKg: 1 },
      ],
      weapon: { weightKg: 2, ergonomics: 60, slots: [slot('s', ['light', 'heavy', 'mid'])] },
    }),
    request: TED_ONLY,
    feasible: [nk(), nk('light'), nk('heavy'), nk('mid')],
    maxScore: '70',
    maximizers: [nk('mid')],
    scores: [[nk(), '60'], [nk('light'), '65'], [nk('heavy'), '65']],
    statChecks: [{ label: 'heavy', build: one('heavy'), values: { ergonomics: '90', weight: '4', weightPenalty: '25', ted: '65' } }],
    derivation: `none: W 2, TED 60. light: W 2.5, ergonomics 65, q 0: 65. heavy: W 4, ergonomics 90, q(4) = 25: 65 (tied with light). mid: W 3 (exactly at the free limit), ergonomics 70, q 0: 70.
mid = 70 is the unique maximum. By the clamped-ergonomics score alone heavy (90) would win; TED penalizes its extra kilogram.`,
  }),

  defineCase({
    id: 'F12-prevent-overswing-boundary',
    family: 12,
    subcases: ['prevent_overswing', 'overswing_nonzero_iff_ted_negative', 'weight_above_3kg'],
    title: 'prevent_overswing keeps TED >= 0 and the optimum sits exactly at TED = 0',
    adrRefs: [...ADR, 'ADR 0013 section 3 item 12 (overswing nonzero iff TED < 0)'],
    prerequisites: 'Receiver 4 kg (q = 25), ergonomics 20; e=0, r=1; prevent_overswing. Effective ergonomics 26, 25, 24 for e1, e2, e3.',
    source: 'overswingFixture: one slot s:[e1, e2, e3].',
    fixture: overswingFixture,
    request: { ergo_weight: 0, recoil_weight: 1, prevent_overswing: true },
    feasible: [nk('e1'), nk('e2')],
    maxScore: '250',
    maximizers: [nk('e2')],
    scores: [[nk('e1'), '0']],
    rejections: [
      { label: 'e3 (TED -1)', build: one('e3'), codes: ['OVERSWING_PREVENTED'] },
      { label: 'bare receiver (TED -5)', build: nakedBuild(), codes: ['OVERSWING_PREVENTED'] },
    ],
    statChecks: [
      { label: 'e1', build: one('e1'), values: { ted: '1' }, overswingNonzero: false },
      { label: 'e2 (TED exactly 0)', build: one('e2'), values: { ted: '0' }, overswingNonzero: false },
      { label: 'e3', build: one('e3'), values: { ted: '-1' }, overswingNonzero: true },
    ],
    derivation: `W = 4 for every build, so q = 25. E = 20, 26, 25, 24 for none, e1, e2, e3, giving TED = -5, 1, 0, -1. TED >= 0 keeps e1 and e2 only (e2 sits exactly at TED = 0).
Score = -1 x 1000 x recoil: e1 0, e2 +250 (recoil -1/4); e3 would give 500 but is infeasible. e2 is the unique maximum, exactly on the boundary.`,
  }),

  defineCase({
    id: 'F12-overswing-without-prevention',
    family: 12,
    subcases: ['overswing_nonzero_iff_ted_negative'],
    title: 'Without prevent_overswing a negative-TED build stays feasible and is flagged as overswinging',
    adrRefs: ADR,
    prerequisites: 'Same fixture and weights as F12-prevent-overswing-boundary, prevent_overswing off.',
    source: 'overswingFixture.',
    fixture: overswingFixture,
    request: { ergo_weight: 0, recoil_weight: 1 },
    feasible: [nk(), nk('e1'), nk('e2'), nk('e3')],
    maxScore: '500',
    maximizers: [nk('e3')],
    scores: [[nk(), '0'], [nk('e1'), '0'], [nk('e2'), '250']],
    statChecks: [
      { label: 'bare receiver', build: nakedBuild(), values: { ted: '-5' }, overswingNonzero: true },
      { label: 'e1', build: one('e1'), values: { ted: '1' }, overswingNonzero: false },
      { label: 'e2', build: one('e2'), values: { ted: '0' }, overswingNonzero: false },
      { label: 'e3', build: one('e3'), values: { ted: '-1' }, overswingNonzero: true },
    ],
    derivation: `With no overswing cap every build is feasible. Score = -1000 x recoil: none 0, e1 0, e2 250, e3 500, so e3 wins even though its TED is -1.
Overswing strength is nonzero exactly where TED < 0: none (TED -5) and e3 (-1) are flagged; e1 (1) and e2 (exactly 0) are not.`,
    notes: ['Only "nonzero iff TED < 0" is asserted; the 0..100% scale of the strength is interpretation 6 of the oracle.'],
  }),

  defineCase({
    id: 'F12-ted-uses-gear-adjusted-ergonomics',
    family: 12,
    subcases: ['ted_objective', 'weight_above_3kg'],
    title: 'TED subtracts the weight penalty from the gear-adjusted ergonomics, with both clamps applied first',
    adrRefs: ADR,
    prerequisites: 'use_true_ergo, e=1, r=0; equip_ergo_modifier -1/4 (factor 3/4); receiver 4 kg (q = 25), ergonomics 80.',
    source: 'One slot s:[x]; x(+30 ergonomics, weightless).',
    fixture: fix({ items: [{ id: 'x', ergonomics: 30 }], weapon: { weightKg: 4, ergonomics: 80, slots: [slot('s', ['x'])] } }),
    request: { ...TED_ONLY, equip_ergo_modifier: -0.25 },
    feasible: [nk(), nk('x')],
    maxScore: '50',
    maximizers: [nk('x')],
    scores: [[nk(), '35']],
    statChecks: [
      { label: 'x', build: one('x'), values: { rawErgonomics: '110', ergonomics: '100', effectiveErgonomics: '75', weightPenalty: '25', ted: '50' } },
      { label: 'bare receiver', build: nakedBuild(), values: { ergonomics: '80', effectiveErgonomics: '60', ted: '35' } },
    ],
    derivation: `W = 4 kg for both builds, q(4) = 100 - 75 = 25. none: raw 80, clamped 80, x 3/4 = 60, TED 60 - 25 = 35. x: raw 110, clamped 100, x 3/4 = 75, TED 75 - 25 = 50. x is the unique maximum.`,
  }),

  defineCase({
    id: 'F12-prevent-overswing-uses-gear-effective-ergonomics',
    family: 12,
    subcases: ['prevent_overswing', 'overswing_nonzero_iff_ted_negative'],
    title: 'The overswing bound uses the gear-adjusted ergonomics: halving the factor doubles the ergonomics needed',
    adrRefs: [...ADR, 'ADR 0007 section 5 (gear factor)'],
    prerequisites: 'Receiver 4 kg (q = 25), ergonomics 40; equip_ergo_modifier -1/2 (factor 1/2), so TED >= 0 needs clamped ergonomics >= 50. e=0, r=1; prevent_overswing.',
    source: 'One slot s:[p49, p50, p51]; p49(+9, recoil -1/2), p50(+10, recoil -1/4), p51(+11, recoil 0).',
    fixture: fix({
      items: [
        { id: 'p49', ergonomics: 9, recoilModifier: -0.5 },
        { id: 'p50', ergonomics: 10, recoilModifier: -0.25 },
        { id: 'p51', ergonomics: 11 },
      ],
      weapon: { weightKg: 4, ergonomics: 40, slots: [slot('s', ['p49', 'p50', 'p51'])] },
    }),
    request: { ergo_weight: 0, recoil_weight: 1, prevent_overswing: true, equip_ergo_modifier: -0.5 },
    feasible: [nk('p50'), nk('p51')],
    maxScore: '250',
    maximizers: [nk('p50')],
    scores: [[nk('p51'), '0']],
    rejections: [
      { label: 'p49 (effective 24.5)', build: one('p49'), codes: ['OVERSWING_PREVENTED'] },
      { label: 'bare receiver (effective 20)', build: nakedBuild(), codes: ['OVERSWING_PREVENTED'] },
    ],
    statChecks: [
      { label: 'p49', build: one('p49'), values: { ergonomics: '49', effectiveErgonomics: '49/2', ted: '-1/2' }, overswingNonzero: true },
      { label: 'p50 (TED exactly 0)', build: one('p50'), values: { ergonomics: '50', effectiveErgonomics: '25', ted: '0' }, overswingNonzero: false },
      { label: 'p51', build: one('p51'), values: { effectiveErgonomics: '51/2', ted: '1/2' }, overswingNonzero: false },
    ],
    derivation: `W = 4 kg gives q = 25. Clamped ergonomics 49, 50, 51 (and 40 for none) become effective 24.5, 25, 25.5 (and 20) after the factor 1/2, so TED = -1/2, 0, 1/2 (and -5): only p50 and p51 are feasible.
Score = -1000 x recoil: p50 +250 (TED exactly 0), p51 0; p49 would give 500 but is out. p50 is the unique maximum. With factor 1 even p49 would be legal (TED 24).`,
  }),

  defineCase({
    id: 'F12-prevent-overswing-narrow-interval',
    family: 12,
    subcases: ['prevent_overswing', 'narrow_interval', 'weight_at_3kg'],
    title: 'A hard TED >= 0 bound turns the weight into a narrow interval that ends exactly at 3 kg',
    adrRefs: ADR,
    prerequisites: 'Receiver 47/16 kg (2.9375) with ergonomics 0, so effective ergonomics stay 0 and TED >= 0 means W <= 3 kg. e=0, r=1; prevent_overswing.',
    source: 'Slots s1:[i], s2:[i]; i weighs 1/16 kg and has recoil -1/4.',
    fixture: fix({
      items: [{ id: 'i', weightKg: 0.0625, recoilModifier: -0.25 }],
      weapon: { weightKg: 2.9375, ergonomics: 0, slots: [slot('s1', ['i']), slot('s2', ['i'])] },
    }),
    request: { ergo_weight: 0, recoil_weight: 1, prevent_overswing: true },
    feasible: [nk(), nk('i')],
    maxScore: '250',
    maximizers: [nk('i')],
    scores: [[nk(), '0']],
    rejections: [{ label: 'two i (W 49/16)', build: nakedBuild([ROOT, 's1', 'i'], [ROOT, 's2', 'i']), codes: ['OVERSWING_PREVENTED'] }],
    statChecks: [
      { label: 'one i (W exactly 3)', build: one('i', 's1'), values: { weight: '3', weightPenalty: '0', ted: '0' }, overswingNonzero: false },
      { label: 'two i', build: nakedBuild([ROOT, 's1', 'i'], [ROOT, 's2', 'i']), values: { weight: '49/16', weightPenalty: '100/49', ted: '-100/49' }, overswingNonzero: true },
    ],
    physicalBuildCount: 3,
    derivation: `W = 47/16, 3, 49/16 for none, one i, two i. With ergonomics 0, TED = -q(W): 0 for W <= 3 and -(100 - 300/W) above. Two i: q(49/16) = 100 - 4800/49 = 100/49, so TED = -100/49 < 0: infeasible. One i sits exactly at W = 3 with TED 0: feasible.
Feasible: none (0), one i (2 builds, +250 from recoil). The unique maximum is one i.`,
  }),

  defineCase({
    id: 'F12-prevent-overswing-singleton-at-three-kg',
    family: 12,
    subcases: ['prevent_overswing', 'singleton_interval', 'weight_at_3kg'],
    title: 'A receiver at exactly 3 kg with zero ergonomics leaves a singleton feasible weight under prevent_overswing',
    adrRefs: ADR,
    prerequisites: 'Receiver 3 kg, ergonomics 0; any added mass makes TED negative. e=0, r=1; prevent_overswing.',
    source: 'One slot s:[w]; w weighs 1/16 kg with recoil -1/4.',
    fixture: fix({
      items: [{ id: 'w', weightKg: 0.0625, recoilModifier: -0.25 }],
      weapon: { weightKg: 3, ergonomics: 0, slots: [slot('s', ['w'])] },
    }),
    request: { ergo_weight: 0, recoil_weight: 1, prevent_overswing: true },
    feasible: [nk()],
    maxScore: '0',
    maximizers: [nk()],
    rejections: [{ label: 'w (W 49/16)', build: one('w'), codes: ['OVERSWING_PREVENTED'] }],
    statChecks: [{ label: 'bare receiver', build: nakedBuild(), values: { weight: '3', weightPenalty: '0', ted: '0' }, overswingNonzero: false }],
    derivation: `With ergonomics 0 the bound TED >= 0 means W <= 3 kg, and the receiver already weighs 3 kg: the feasible weight interval is the single point 3. Adding w (W = 49/16) gives TED = -100/49 < 0.
Feasible: the bare receiver only, with score 0.`,
  }),

  defineCase({
    id: 'F12-max-weight-singleton-interval',
    family: 12,
    subcases: ['singleton_interval', 'weight_below_3kg'],
    title: 'A weight cap equal to the receiver mass leaves a single feasible build',
    adrRefs: ADR,
    prerequisites: 'Receiver 2 kg, ergonomics 60; max_weight 2; use_true_ergo, e=1, r=0.',
    source: 'One slot s:[x]; x weighs 0.5 kg (+5 ergonomics).',
    fixture: fix({
      items: [{ id: 'x', weightKg: 0.5, ergonomics: 5 }],
      weapon: { weightKg: 2, ergonomics: 60, slots: [slot('s', ['x'])] },
    }),
    request: { ...TED_ONLY, max_weight: 2 },
    feasible: [nk()],
    maxScore: '60',
    maximizers: [nk()],
    rejections: [{ label: 'x (W 2.5)', build: one('x'), codes: ['MAX_WEIGHT_EXCEEDED'] }],
    statChecks: [{ label: 'bare receiver', build: nakedBuild(), values: { weight: '2', weightPenalty: '0', ted: '60' } }],
    derivation: `Total weight is capped at 2 kg and the receiver is 2 kg, so W is the single point 2 (no division by W, penalty 0). Only the bare receiver is feasible, TED = 60.`,
  }),

  defineCase({
    id: 'F12-near-cap-weight-one-ulp-over-cap',
    family: 12,
    subcases: ['near_cap', 'narrow_interval'],
    title: 'Two parts whose exact total mass exceeds 3 kg by 2^-52 break the weight cap although binary64 addition rounds to 3',
    adrRefs: [...ADR, 'ADR 0010 section 2 (exact rational evaluation)'],
    prerequisites: 'max_weight 3; masses 1, 1 and 1 + 2^-52 (1.0000000000000002) are exact binary64 values. Exact-arithmetic case only: the gap is far below any runtime tolerance.',
    source: 'Slots s1:[u], s2:[v]; receiver 1 kg; u 1 kg (+1), v 1 + 2^-52 kg (+2).',
    fixture: fix({
      items: [{ id: 'u', weightKg: 1, ergonomics: 1 }, { id: 'v', weightKg: 1 + 2 ** -52, ergonomics: 2 }],
      weapon: { weightKg: 1, slots: [slot('s1', ['u']), slot('s2', ['v'])] },
    }),
    request: { recoil_weight: 0, max_weight: 3 },
    feasible: [nk(), nk('u'), nk('v')],
    maxScore: '2',
    maximizers: [nk('v')],
    scores: [[nk('u'), '1'], [nk(), '0']],
    rejections: [{ label: 'u and v (3 + 2^-52 kg)', build: nakedBuild([ROOT, 's1', 'u'], [ROOT, 's2', 'v']), codes: ['MAX_WEIGHT_EXCEEDED'] }],
    tolerance: {
      kind: 'near_cap',
      gap: '1/4503599627370496',
      capCheck: { build: nakedBuild([ROOT, 's1', 'u'], [ROOT, 's2', 'v']), stat: 'weight', value: '13510798882111489/4503599627370496', cap: '3', direction: 'max' },
    },
    derivation: `Exact masses: none 1, u 2, v 2 + 2^-52, u+v 3 + 2^-52 = 13510798882111489/4503599627370496 (3 x 2^52 + 1 over 2^52), which exceeds 3 by exactly 2^-52 and is rejected. The three others are within the cap.
Feasible: none (0), u (1), v (2). v is the unique maximum; u+v (3) is infeasible by a tiny exact margin.
In binary64 arithmetic 2 + 1.0000000000000002 = 3.0000000000000002 rounds to 3 (a tie that rounds to even), so a floating-point check would wrongly accept u+v.`,
    notes: ['Exact-only case (resolvableAtTolerance false): a tolerance-bound solver cannot be required to reject u+v, but must not report any exact tie.'],
  }),
];
