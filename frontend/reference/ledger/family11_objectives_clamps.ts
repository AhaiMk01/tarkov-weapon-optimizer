// Family 11: objectives and clamps (ADR 0013 section 3 item 11, ADR 0010 sections 2 and 4 item 11, ADR 0007 section 5).
//
// Coordinates: fE = 10 x ergonomics (or TED), fR = 1000 x summed recoil modifier, fP = RUB spend.
//   weighted:    score = (e/10) fE - r fR - (p/1000) fP        (so e=1, r=p=0 scores the ergonomics)
//   Tchebycheff: sum = e+r+p (1 if 0); c_e = e/(sum max(zE-nadE,1)), c_r = r/(sum max(nadR-zR,1)), c_p = p/(sum max(nadP-zP,1))
//                d_e = c_e (zE - fE), d_r = c_r (fR - zR), d_p = c_p (fP - zP), active axes only
//                score = (1/100)(c_e fE - c_r fR - c_p fP) - max(d_a)     (no outer zero clamp)
// Ergonomics clamp twice: clamp[0,100](raw) is the displayed value; clamp[0,100](that x gear) is the effective value.
// The gear factor is max(0, 1 + equip_ergo_modifier). A score without use_true_ergo uses the first clamp only.

import { defineCase, fix, nk, nakedBuild, ROOT, slot, trader } from './dsl';
import type { LedgerCase } from './types';

const ADR = ['ADR 0007 section 5', 'ADR 0010 sections 2 and 4 item 11', 'ADR 0013 section 3 item 11'];
const ERGO_ONLY = { recoil_weight: 0 };

// --- raw clamp ------------------------------------------------------------------------------------------------

const rawClampFixture = fix({
  items: [
    { id: 'up110', ergonomics: 60 },
    { id: 'upx', ergonomics: 50 },
    { id: 'p995', ergonomics: 49.5 },
    { id: 'q1005', ergonomics: 50.5 },
    { id: 'down', ergonomics: -60 },
    { id: 'downx', ergonomics: -50 },
    { id: 'r05', ergonomics: -49.5 },
    { id: 's05', ergonomics: -50.5 },
    { id: 'mid', ergonomics: 10 },
  ],
  weapon: {
    ergonomics: 50,
    slots: [slot('s', ['up110', 'upx', 'p995', 'q1005', 'down', 'downx', 'r05', 's05', 'mid'])],
  },
});

// --- effective clamp with a gear factor -----------------------------------------------------------------------

/** Receiver 1 kg (TED weight penalty 0), ergonomics 40; one slot s with five parts that land at clamped 0, 50, 60, 100, 100. */
const gearFixture = fix({
  items: [
    { id: 'lo', ergonomics: -60 },
    { id: 'a', ergonomics: 10 },
    { id: 'b', ergonomics: 20 },
    { id: 'c', ergonomics: 70 },
    { id: 'd', ergonomics: 60 },
  ],
  weapon: { ergonomics: 40, weightKg: 1, slots: [slot('s', ['lo', 'a', 'b', 'c', 'd'])] },
});
const GEAR_BASE = { recoil_weight: 0, use_true_ergo: true };
const gearKeys = [nk(), nk('lo'), nk('a'), nk('b'), nk('c'), nk('d')];
const gearBuild = (id: string) => nakedBuild([ROOT, 's', id]);
const GEAR_DERIVATION_HEAD = `One slot, so the projections are none and one part. Receiver ergonomics 40: raw lo = -20 (clamped 0), none 40, a 50, b 60, c = 110 (clamped 100), d = 100 (exactly the bound).
Receiver 1 kg, parts weightless: W = 1 <= 3 kg so the TED penalty is 0 and the score (e=1) equals the effective ergonomics.`;

// --- Tchebycheff fixture -------------------------------------------------------------------------------------------

/** Receiver ergonomics 40 and 1000 RUB; a(+10 ergonomics, 100 RUB) in s1, b(recoil -1/4, 300 RUB) in s2. */
const tchebFixture = fix({
  items: [{ id: 'a', ergonomics: 10, offers: trader(100) }, { id: 'b', recoilModifier: -0.25, offers: trader(300) }],
  weapon: { ergonomics: 40, slots: [slot('s1', ['a']), slot('s2', ['b'])] },
});
const tchebKeys = [nk(), nk('a'), nk('b'), nk('a', 'b')];
const TCHEB_TABLE = `Builds (ergonomics, recoil sum, spend): none (40, 0, 1000), a (50, 0, 1100), b (40, -1/4, 1300), a+b (50, -1/4, 1400); so fE = 400, 500, 400, 500 and fR = 0, 0, -250, -250.`;

// --- payoff-table admissibility fixture -------------------------------------------------------------------------------

/**
 * Receiver ergonomics 40 and 1000 RUB; one slot s takes at most one of four parts, so the builds (fE, fR, fP) are
 *   none (400, 0, 1000); a (+10 ergonomics, 150 RUB) (500, 0, 1150); b (+10, 400 RUB) (500, 0, 1400);
 *   c (recoil -1/4, 200 RUB) (400, -250, 1200); m (+5, 10 RUB) (450, 0, 1010).
 * a and b tie on the ergonomics axis and differ in price: the nadir of the price axis is not unique.
 */
const payoffFixture = fix({
  items: [
    { id: 'a', ergonomics: 10, offers: trader(150) },
    { id: 'b', ergonomics: 10, offers: trader(400) },
    { id: 'c', recoilModifier: -0.25, offers: trader(200) },
    { id: 'm', ergonomics: 5, offers: trader(10) },
  ],
  weapon: { ergonomics: 40, slots: [slot('s', ['a', 'b', 'c', 'm'])] },
});
const payoffKeys = [nk(), nk('a'), nk('b'), nk('c'), nk('m')];
const PAYOFF_TABLE_A = { zE: 500, nadE: 400, zR: -250, nadR: 0, zP: 1000, nadP: 1200 };

export const FAMILY_11: LedgerCase[] = [
  defineCase({
    id: 'F11-clamp-raw-regimes-and-bounds',
    family: 11,
    subcases: ['clamp_raw_above_100', 'clamp_raw_below_zero', 'clamp_exact_bounds', 'exact_tie'],
    title: 'The first ergonomics clamp saturates at 100 and floors at 0, including exact boundaries and half-point neighbours',
    adrRefs: ADR,
    prerequisites: 'Receiver ergonomics 50; e=1, r=0, p=0 so the score is the clamped ergonomics. All values are exact binary fractions.',
    source: 'One slot s taking one of nine parts: raw ergonomics up110 = 110, upx = 100, p995 = 99.5, q1005 = 100.5, down = -10, downx = 0, r05 = 0.5, s05 = -0.5, mid = 60 (none = 50).',
    fixture: rawClampFixture,
    request: ERGO_ONLY,
    feasible: [nk(), ...['up110', 'upx', 'p995', 'q1005', 'down', 'downx', 'r05', 's05', 'mid'].map(id => nk(id))],
    maxScore: '100',
    maximizers: [nk('up110'), nk('upx'), nk('q1005')],
    scores: [
      [nk(), '50'], [nk('mid'), '60'], [nk('p995'), '199/2'], [nk('r05'), '1/2'],
      [nk('down'), '0'], [nk('downx'), '0'], [nk('s05'), '0'],
    ],
    statChecks: [
      { label: 'up110', build: nakedBuild([ROOT, 's', 'up110']), values: { rawErgonomics: '110', ergonomics: '100' } },
      { label: 'q1005', build: nakedBuild([ROOT, 's', 'q1005']), values: { rawErgonomics: '201/2', ergonomics: '100' } },
      { label: 's05', build: nakedBuild([ROOT, 's', 's05']), values: { rawErgonomics: '-1/2', ergonomics: '0' } },
      { label: 'downx', build: nakedBuild([ROOT, 's', 'downx']), values: { rawErgonomics: '0', ergonomics: '0' } },
    ],
    derivation: `Raw = 50 + part: up110 110, upx 100, p995 99.5, q1005 100.5, down -10, downx 0, r05 0.5, s05 -0.5, mid 60, none 50. Clamped to [0,100]: 100, 100, 99.5, 100, 0, 0, 0.5, 0, 60, 50.
The maximum 100 is reached by three different projections (up110, upx at the exact bound, q1005): an exact three-way tie. 99.5 stays below it and every value at or below 0 collapses to 0.`,
  }),

  defineCase({
    id: 'F11-gear-identity',
    family: 11,
    subcases: ['effective_clamp', 'identity_gear'],
    title: 'With an identity equipment factor the effective ergonomics equal the first clamp',
    adrRefs: ADR,
    prerequisites: 'use_true_ergo, e=1, r=0; equip_ergo_modifier 0 (factor 1).',
    source: 'gearFixture.',
    fixture: gearFixture,
    request: { ...GEAR_BASE, equip_ergo_modifier: 0 },
    feasible: gearKeys,
    maxScore: '100',
    maximizers: [nk('c'), nk('d')],
    scores: [[nk(), '40'], [nk('a'), '50'], [nk('b'), '60'], [nk('lo'), '0']],
    statChecks: [{ label: 'c', build: gearBuild('c'), values: { rawErgonomics: '110', ergonomics: '100', effectiveErgonomics: '100', ted: '100' } }],
    derivation: `${GEAR_DERIVATION_HEAD}
Factor 1: effective = clamped = 0, 40, 50, 60, 100, 100. Maximum 100, a tie of c and d.`,
  }),

  defineCase({
    id: 'F11-gear-below-one',
    family: 11,
    subcases: ['effective_clamp', 'gear_below_one'],
    title: 'An equipment factor of 3/4 scales the clamped ergonomics down',
    adrRefs: ADR,
    prerequisites: 'equip_ergo_modifier -1/4 (factor 3/4).',
    source: 'gearFixture.',
    fixture: gearFixture,
    request: { ...GEAR_BASE, equip_ergo_modifier: -0.25 },
    feasible: gearKeys,
    maxScore: '75',
    maximizers: [nk('c'), nk('d')],
    scores: [[nk(), '30'], [nk('a'), '75/2'], [nk('b'), '45'], [nk('lo'), '0']],
    statChecks: [{ label: 'a', build: gearBuild('a'), values: { ergonomics: '50', effectiveErgonomics: '75/2' } }],
    derivation: `${GEAR_DERIVATION_HEAD}
Factor 3/4: effective = 3/4 x clamped = 0, 30, 37.5, 45, 75, 75. Maximum 75, a tie of c and d (both clamped to 100 first).`,
  }),

  defineCase({
    id: 'F11-gear-above-one',
    family: 11,
    subcases: ['effective_clamp', 'gear_above_one'],
    title: 'An equipment factor of 3/2 raises ergonomics and the second clamp saturates at 100',
    adrRefs: ADR,
    prerequisites: 'equip_ergo_modifier +1/2 (factor 3/2).',
    source: 'gearFixture.',
    fixture: gearFixture,
    request: { ...GEAR_BASE, equip_ergo_modifier: 0.5 },
    feasible: gearKeys,
    maxScore: '100',
    maximizers: [nk('c'), nk('d')],
    scores: [[nk(), '60'], [nk('a'), '75'], [nk('b'), '90'], [nk('lo'), '0']],
    statChecks: [
      { label: 'b (second clamp not binding)', build: gearBuild('b'), values: { ergonomics: '60', effectiveErgonomics: '90' } },
      { label: 'c (second clamp binding)', build: gearBuild('c'), values: { ergonomics: '100', effectiveErgonomics: '100', ted: '100' } },
    ],
    derivation: `${GEAR_DERIVATION_HEAD}
Factor 3/2: 3/2 x clamped = 0, 60, 75, 90, 150, 150; the second clamp caps the last two at 100. Maximum 100, a tie of c and d.`,
  }),

  defineCase({
    id: 'F11-gear-two-hits-the-bound-exactly',
    family: 11,
    subcases: ['effective_clamp', 'gear_above_one', 'clamp_exact_bounds'],
    title: 'An equipment factor of 2 reaches the effective bound exactly for clamped 50 and saturates above it',
    adrRefs: ADR,
    prerequisites: 'equip_ergo_modifier +1 (factor 2).',
    source: 'gearFixture.',
    fixture: gearFixture,
    request: { ...GEAR_BASE, equip_ergo_modifier: 1 },
    feasible: gearKeys,
    maxScore: '100',
    maximizers: [nk('a'), nk('b'), nk('c'), nk('d')],
    scores: [[nk(), '80'], [nk('lo'), '0']],
    derivation: `${GEAR_DERIVATION_HEAD}
Factor 2: 2 x clamped = 0, 80, 100, 120, 200, 200 -> effective 0, 80, 100, 100, 100, 100. a lands exactly on the bound, b, c and d saturate: a four-way tie at 100.`,
  }),

  defineCase({
    id: 'F11-gear-zero-factor',
    family: 11,
    subcases: ['effective_clamp', 'zero_gear', 'exact_tie'],
    title: 'A modifier of -100% gives a zero gear factor and every build ties at effective ergonomics 0',
    adrRefs: ADR,
    prerequisites: 'equip_ergo_modifier -1 (factor 0).',
    source: 'gearFixture.',
    fixture: gearFixture,
    request: { ...GEAR_BASE, equip_ergo_modifier: -1 },
    feasible: gearKeys,
    maxScore: '0',
    maximizers: gearKeys,
    statChecks: [{ label: 'c', build: gearBuild('c'), values: { ergonomics: '100', effectiveErgonomics: '0', ted: '0' } }],
    derivation: `${GEAR_DERIVATION_HEAD}
Factor 0: effective = 0 for every build, so TED = 0 and all six projections tie at 0 (a six-way exact tie).`,
  }),

  defineCase({
    id: 'F11-gear-negative-factor-is-floored-at-zero',
    family: 11,
    subcases: ['effective_clamp', 'zero_gear', 'exact_tie'],
    title: 'A modifier below -100% still yields factor 0, not a negative factor',
    adrRefs: ADR,
    prerequisites: 'equip_ergo_modifier -2: factor max(0, 1 - 2) = 0.',
    source: 'gearFixture.',
    fixture: gearFixture,
    request: { ...GEAR_BASE, equip_ergo_modifier: -2 },
    feasible: gearKeys,
    maxScore: '0',
    maximizers: gearKeys,
    statChecks: [{ label: 'd', build: gearBuild('d'), values: { effectiveErgonomics: '0', ted: '0' } }],
    derivation: `${GEAR_DERIVATION_HEAD}
Factor max(0, 1 + (-2)) = 0, so effective = 0 for every build and all six projections tie at 0. A negative factor would instead produce a clamp-to-0 anyway, but the factor itself must be floored.`,
  }),

  defineCase({
    id: 'F11-gear-does-not-change-a-non-ted-score',
    family: 11,
    subcases: ['effective_clamp'],
    title: 'Without use_true_ergo the score is the first clamp only; the gear factor affects the effective value, not the score',
    adrRefs: ADR,
    prerequisites: 'use_true_ergo false (default), equip_ergo_modifier -1/2.',
    source: 'gearFixture.',
    fixture: gearFixture,
    request: { ...ERGO_ONLY, equip_ergo_modifier: -0.5 },
    feasible: gearKeys,
    maxScore: '100',
    maximizers: [nk('c'), nk('d')],
    scores: [[nk(), '40'], [nk('a'), '50'], [nk('b'), '60'], [nk('lo'), '0']],
    statChecks: [{ label: 'c', build: gearBuild('c'), values: { ergonomics: '100', effectiveErgonomics: '50' } }],
    derivation: `${GEAR_DERIVATION_HEAD}
The score uses the displayed (first-clamp) ergonomics 0, 40, 50, 60, 100, 100 whatever the factor; the effective value (here half of it) only matters for TED and overswing. Maximum 100, a tie of c and d.`,
    notes: ['Relies on interpretation 16 (the ergonomics axis is the displayed first-clamp value unless use_true_ergo is set).'],
  }),

  defineCase({
    id: 'F11-all-zero-weights-weighted',
    family: 11,
    subcases: ['all_zero_weights', 'exact_tie'],
    title: 'With every weight 0 the weighted score is 0 for every build',
    adrRefs: ADR,
    prerequisites: 'ergo_weight 0, recoil_weight 0, price_weight 0.',
    source: 'Slots s1:[a], s2:[b]; a(+3), b(+2).',
    fixture: fix({
      items: [{ id: 'a', ergonomics: 3 }, { id: 'b', ergonomics: 2 }],
      weapon: { slots: [slot('s1', ['a']), slot('s2', ['b'])] },
    }),
    request: { ergo_weight: 0, recoil_weight: 0, price_weight: 0 },
    feasible: [nk(), nk('a'), nk('b'), nk('a', 'b')],
    maxScore: '0',
    maximizers: [nk(), nk('a'), nk('b'), nk('a', 'b')],
    derivation: `All weights are 0, so (e/10) fE - r fR - (p/1000) fP = 0 for every build: all four projections are feasible and tie exactly at 0.`,
  }),

  defineCase({
    id: 'F11-all-zero-weights-tchebycheff',
    family: 11,
    subcases: ['all_zero_weights', 'exact_tie'],
    title: 'With every weight 0 the augmented Tchebycheff score is 0 for every build, with no NaN',
    adrRefs: ADR,
    prerequisites: 'use_tchebycheff with an ideal point; all weights 0: sum falls back to 1, every c is 0, no axis is active so maxDeviation = 0.',
    source: 'tchebFixture; ideal zE 500 / nadE 400, zR -250 / nadR 0, zP 1000 / nadP 2000.',
    fixture: tchebFixture,
    request: {
      ergo_weight: 0, recoil_weight: 0, price_weight: 0, use_tchebycheff: true,
      ideal_point: { zE: 500, nadE: 400, zR: -250, nadR: 0, zP: 1000, nadP: 2000 },
    },
    feasible: tchebKeys,
    maxScore: '0',
    maximizers: tchebKeys,
    derivation: `sum = 0 falls back to 1, so c_e = c_r = c_p = 0, the linear term is 0, and with no active axis max(d) = 0: score = 0.01 x 0 - 0 = 0 for all four projections: an exact four-way tie.`,
  }),

  defineCase({
    id: 'F11-inactive-recoil-axis-weighted',
    family: 11,
    subcases: ['inactive_axes', 'exact_tie'],
    title: 'A weight of 0 makes an axis irrelevant: builds that differ only in recoil tie',
    adrRefs: ADR,
    prerequisites: 'e=1, r=0, p=0.',
    source: 'One slot s:[r1, r2]; r1(+2 ergonomics, recoil -1/2), r2(+2, recoil +1/2).',
    fixture: fix({
      items: [{ id: 'r1', ergonomics: 2, recoilModifier: -0.5 }, { id: 'r2', ergonomics: 2, recoilModifier: 0.5 }],
      weapon: { slots: [slot('s', ['r1', 'r2'])] },
    }),
    request: ERGO_ONLY,
    feasible: [nk(), nk('r1'), nk('r2')],
    maxScore: '2',
    maximizers: [nk('r1'), nk('r2')],
    derivation: `Score = ergonomics: none 0, r1 2, r2 2. The recoil axis has weight 0, so -1/2 and +1/2 are indistinguishable: an exact tie at 2.`,
  }),

  defineCase({
    id: 'F11-active-recoil-axis-weighted',
    family: 11,
    subcases: ['inactive_axes'],
    title: 'With r=1 less recoil is better: the score gains 1000 x |recoil modifier|',
    adrRefs: ADR,
    prerequisites: 'e=1, r=1, p=0 on the same fixture.',
    source: 'Same fixture as F11-inactive-recoil-axis-weighted.',
    fixture: fix({
      items: [{ id: 'r1', ergonomics: 2, recoilModifier: -0.5 }, { id: 'r2', ergonomics: 2, recoilModifier: 0.5 }],
      weapon: { slots: [slot('s', ['r1', 'r2'])] },
    }),
    request: { recoil_weight: 1 },
    feasible: [nk(), nk('r1'), nk('r2')],
    maxScore: '502',
    maximizers: [nk('r1')],
    scores: [[nk(), '0'], [nk('r2'), '-498']],
    derivation: `Score = ergonomics - 1 x fR with fR = 1000 x recoil sum: none 0; r1 2 - (-500) = 502; r2 2 - 500 = -498. r1 is the unique maximum.`,
  }),

  defineCase({
    id: 'F11-negative-request-weight-resolves-to-zero',
    family: 11,
    subcases: ['negative_weight_resolves_zero'],
    title: 'A negative request weight resolves to 0 instead of rewarding bad ergonomics',
    adrRefs: [...ADR, 'ADR 0013 section 3 item 11 (resolved weights are nonnegative)'],
    prerequisites: 'ergo_weight -5, recoil_weight 1, p 0. Receiver ergonomics 50.',
    source: 'One slot s:[hi, good]; hi(ergonomics -10), good(recoil -1/64).',
    fixture: fix({
      items: [{ id: 'hi', ergonomics: -10 }, { id: 'good', recoilModifier: -0.015625 }],
      weapon: { ergonomics: 50, slots: [slot('s', ['hi', 'good'])] },
    }),
    request: { ergo_weight: -5, recoil_weight: 1 },
    feasible: [nk(), nk('hi'), nk('good')],
    maxScore: '125/8',
    maximizers: [nk('good')],
    scores: [[nk(), '0'], [nk('hi'), '0']],
    derivation: `The ergo weight -5 resolves to 0, so only recoil scores: none 0, hi 0, good -1 x (1000 x -1/64) = 125/8 = 15.625. good is the unique maximum.
Taken literally the weight would score ergonomics 50 as -250, 40 as -200 and good as -234.375, picking hi instead.`,
  }),

  defineCase({
    id: 'F11-tchebycheff-reference',
    family: 11,
    subcases: ['tchebycheff_basic'],
    title: 'Augmented Tchebycheff with an ideal point that no single build dominates, two exactly tied runners-up',
    adrRefs: ADR,
    prerequisites: 'e=1, r=1, p=0 (sum 2). Ideal zE 500, nadE 400, zR -250, nadR 0; price axis inactive.',
    source: 'tchebFixture.',
    fixture: tchebFixture,
    request: { use_tchebycheff: true, ideal_point: { zE: 500, nadE: 400, zR: -250, nadR: 0, zP: 1000, nadP: 2000 } },
    feasible: tchebKeys,
    maxScore: '3/100',
    maximizers: [nk('a', 'b')],
    scores: [[nk(), '-12/25'], [nk('a'), '-19/40'], [nk('b'), '-19/40']],
    derivation: `${TCHEB_TABLE}
c_e = 1/(2 x 100) = 1/200, c_r = 1/(2 x 250) = 1/500. d_e = (500 - fE)/200, d_r = (fR + 250)/500.
none: d = (1/2, 1/2), max 1/2; linear = 400/200 = 2; score = 0.02 - 0.5 = -12/25. a: d = (0, 1/2); linear 2.5; 0.025 - 0.5 = -19/40. b: d = (1/2, 0); linear 2 + 0.5 = 2.5; 0.025 - 0.5 = -19/40 (tied with a).
a+b: d = (0, 0), max 0; linear 2.5 + 0.5 = 3; score 0.03 = 3/100, the unique maximum.`,
  }),

  defineCase({
    id: 'F11-tchebycheff-signed-active-deviations',
    family: 11,
    subcases: ['tchebycheff_signed_deviation'],
    title: 'Active deviations stay signed: a build beating the ideal point on every axis scores a negative maximum deviation',
    adrRefs: [...ADR, 'ADR 0010 section 2 (no outer zero clamp)'],
    prerequisites: 'e=1, r=1, p=0. Ideal zE 450 (below a+b\'s 500) and zR -200 (above a+b\'s -250), so a+b exceeds the ideal on both active axes.',
    source: 'tchebFixture; ideal zE 450, nadE 400, zR -200, nadR 0.',
    fixture: tchebFixture,
    request: { use_tchebycheff: true, ideal_point: { zE: 450, nadE: 400, zR: -200, nadR: 0, zP: 1000, nadP: 2000 } },
    feasible: tchebKeys,
    maxScore: '29/160',
    maximizers: [nk('a', 'b')],
    scores: [[nk(), '-23/50'], [nk('a'), '-9/20'], [nk('b'), '-363/800']],
    derivation: `${TCHEB_TABLE}
c_e = 1/(2 x 50) = 1/100, c_r = 1/(2 x 200) = 1/400. d_e = (450 - fE)/100, d_r = (fR + 200)/400.
a+b: d_e = (450-500)/100 = -1/2, d_r = (-250+200)/400 = -1/8; max = -1/8 (signed, NOT clamped to 0). Linear = 500/100 + 250/400 = 5.625; score = 0.05625 - (-0.125) = 0.18125 = 29/160.
none: d = (1/2, 1/2) -> 0.04 - 0.5 = -23/50. a: d = (-1/2, 1/2) -> max 1/2; 0.05 - 0.5 = -9/20. b: d = (1/2, -1/8) -> max 1/2; linear 4 + 0.625 -> 0.04625 - 0.5 = -363/800.
A zero clamp on the deviation would give a+b only 0.05625.`,
  }),

  defineCase({
    id: 'F11-tchebycheff-normalization-floors',
    family: 11,
    subcases: ['normalization_floor'],
    title: 'Each normalization range is floored at 1: a zero or negative range, and a range of 1/2, all divide by 1',
    adrRefs: [...ADR, 'ADR 0010 section 2 (max(., 1) floors)'],
    prerequisites: 'e=1, r=1, p=0. Ideal zE 400 with nadE 450 (range -50 -> 1); zR -250 with nadR -249.5 (range 1/2 -> 1).',
    source: 'tchebFixture.',
    fixture: tchebFixture,
    request: { use_tchebycheff: true, ideal_point: { zE: 400, nadE: 450, zR: -250, nadR: -249.5, zP: 1000, nadP: 2000 } },
    feasible: tchebKeys,
    maxScore: '15/4',
    maximizers: [nk('a', 'b')],
    scores: [[nk(), '-123'], [nk('a'), '-245/2'], [nk('b'), '13/4']],
    derivation: `${TCHEB_TABLE}
Floors: max(zE - nadE, 1) = max(-50, 1) = 1 and max(nadR - zR, 1) = max(1/2, 1) = 1, so c_e = c_r = 1/(2 x 1) = 1/2. d_e = (400 - fE)/2, d_r = (fR + 250)/2.
none: d = (0, 125), max 125; linear 200; 2 - 125 = -123. a: d = (-50, 125); linear 250; 2.5 - 125 = -245/2. b: d = (0, 0); linear 200 + 125 = 325; 3.25 = 13/4. a+b: d = (-50, 0), max 0; linear 250 + 125 = 375; 3.75 = 15/4 (unique maximum).`,
  }),

  defineCase({
    id: 'F11-tchebycheff-three-active-axes',
    family: 11,
    subcases: ['tchebycheff_basic'],
    title: 'With ergonomics, recoil and price all active the price deviation joins the maximum',
    adrRefs: ADR,
    prerequisites: 'e=r=p=1 (sum 3). Ideal zE 500 / nadE 400, zR -250 / nadR 0, zP 1000 / nadP 1400.',
    source: 'tchebFixture (spend 1000, 1100, 1300, 1400).',
    fixture: tchebFixture,
    request: {
      price_weight: 1, use_tchebycheff: true,
      ideal_point: { zE: 500, nadE: 400, zR: -250, nadR: 0, zP: 1000, nadP: 1400 },
    },
    feasible: tchebKeys,
    maxScore: '-13/40',
    maximizers: [nk('a', 'b')],
    scores: [[nk(), '-197/600'], [nk('a'), '-391/1200'], [nk('b'), '-131/400']],
    derivation: `${TCHEB_TABLE} Spend 1000, 1100, 1300, 1400.
c_e = 1/(3 x 100) = 1/300, c_r = 1/(3 x 250) = 1/750, c_p = 1/(3 x 400) = 1/1200. d_e = (500 - fE)/300, d_r = (fR + 250)/750, d_p = (fP - 1000)/1200.
none: d = (1/3, 1/3, 0); linear = 4/3 - 0 - 5/6 = 1/2; 1/200 - 1/3 = -197/600. a: d = (0, 1/3, 1/12); linear 5/3 - 11/12 = 3/4; 3/400 - 1/3 = -391/1200.
b: d = (1/3, 0, 1/4); linear 4/3 + 1/3 - 13/12 = 7/12; 7/1200 - 1/3 = -131/400. a+b: d = (0, 0, 1/3); linear 5/3 + 1/3 - 7/6 = 5/6; 1/120 - 1/3 = -13/40 (unique maximum, 1/1200 above a).`,
  }),

  defineCase({
    id: 'F11-tchebycheff-inactive-axes',
    family: 11,
    subcases: ['inactive_axes', 'exact_tie'],
    title: 'With only the ergonomics weight positive the recoil and price axes drop out of both the maximum and the linear term',
    adrRefs: ADR,
    prerequisites: 'e=1, r=0, p=0 (sum 1). Ideal zE 500 / nadE 400.',
    source: 'tchebFixture.',
    fixture: tchebFixture,
    request: { recoil_weight: 0, use_tchebycheff: true, ideal_point: { zE: 500, nadE: 400, zR: -250, nadR: 0, zP: 1000, nadP: 2000 } },
    feasible: tchebKeys,
    maxScore: '1/20',
    maximizers: [nk('a'), nk('a', 'b')],
    scores: [[nk(), '-24/25'], [nk('b'), '-24/25']],
    derivation: `${TCHEB_TABLE}
Only the ergonomics axis is active: c_e = 1/(1 x 100) = 1/100, c_r = c_p = 0, so recoil and spend cannot matter. d_e = (500 - fE)/100.
none and b (fE = 400): d_e = 1, linear 4, 0.04 - 1 = -24/25 (tied). a and a+b (fE = 500): d_e = 0, linear 5, 0.05 = 1/20 (tied maximum).`,
  }),

  defineCase({
    id: 'F11-payoff-table-admissibility-tied-endpoints',
    family: 11,
    subcases: ['payoff_table_admissibility'],
    title: 'A tied ergonomics optimum with different prices gives two admissible payoff tables, and the Tchebycheff optimum differs under them',
    adrRefs: [...ADR, 'ADR 0010 section 2 (ideal point from three single-axis solves)', 'INTERPRETATIONS.md choice 17'],
    prerequisites:
      'e=1, r=0, p=1 (sum 2): recoil is an inactive axis of the score but its endpoint still enters the table. The ideal point is an input: the request carries ' +
      'table A; table B differs only in nadP. Every coordinate is an integer, so each reported double is exact.',
    source: 'payoffFixture (receiver ergonomics 40, 1000 RUB; slot s: a, b, c, m); ideal zE 500 / nadE 400, zR -250 / nadR 0, zP 1000 / nadP 1200 (table A).',
    fixture: payoffFixture,
    request: { recoil_weight: 0, price_weight: 1, use_tchebycheff: true, ideal_point: PAYOFF_TABLE_A },
    feasible: payoffKeys,
    maxScore: '-1011/4000',
    maximizers: [nk('m')],
    scores: [[nk(), '-101/200'], [nk('a'), '-303/800'], [nk('b'), '-101/100'], [nk('c'), '-51/100'], [nk('m'), '-1011/4000']],
    payoff: {
      ideal: { zE: '500', zR: '-250', zP: '1000' },
      tables: [
        { table: { zE: '500', nadE: '400', zR: '-250', nadR: '0', zP: '1000', nadP: '1200' }, maxScore: '-1011/4000', maximizers: [nk('m')] },
        { table: { zE: '500', nadE: '400', zR: '-250', nadR: '0', zP: '1000', nadP: '1400' }, maxScore: '-283/1600', maximizers: [nk('a')] },
      ],
      rejected: [
        { label: 'table of the endpoint triple {m, c, none}: m is not an ergonomics optimum', table: { zE: '450', nadE: '400', zR: '-250', nadR: '0', zP: '1000', nadP: '1200' }, code: 'IDEAL_MISMATCH' },
        { label: 'nadP 1300 lies between the two attainable price nadirs', table: { zE: '500', nadE: '400', zR: '-250', nadR: '0', zP: '1000', nadP: '1300' }, code: 'NADIR_NOT_ATTAINABLE' },
      ],
    },
    derivation: `Builds (fE, fR, fP): none (400, 0, 1000), a (500, 0, 1150), b (500, 0, 1400), c (400, -250, 1200), m (450, 0, 1010).
Payoff solves. Ergonomics [100,0,0]: max fE = 500, tied {a, b} with the two vectors (500, 0, 1150) and (500, 0, 1400). Recoil [0,100,0]: min fR = -250, only c. Price [0,0,100]: min fP = 1000, only none. So zE = 500, zR = -250, zP = 1000 are unique.
Tables (nadE = min fE, nadR = max fR, nadP = max fP over the three chosen endpoint vectors; r-endpoint c and p-endpoint none are forced): e-endpoint a: nadE min(500, 400, 400) = 400, nadR max(0, -250, 0) = 0, nadP max(1150, 1200, 1000) = 1200 (table A). e-endpoint b: nadP max(1400, 1200, 1000) = 1400, rest equal (table B). Exactly two tables.
Rejected: a table from the triple {m, c, none} reports zE = max(450, 400, 400) = 450, not the exact ideal 500. nadP = 1300 matches neither 1200 nor 1400.
Tchebycheff, e=1, r=0, p=1: sum 2, c_e = 1/(2 x max(500 - 400, 1)) = 1/200, c_r = 0, c_p = 1/(2 x (nadP - 1000)); active axes e and p. d_e = (500 - fE)/200, d_p = c_p (fP - 1000), score = (1/100)(c_e fE - c_p fP) - max(d_e, d_p).
Table A (nadP 1200, c_p = 1/400): none d = (1/2, 0), linear 2 - 5/2 = -1/2, score -1/200 - 1/2 = -101/200. a d = (0, 3/8), linear 5/2 - 23/8 = -3/8, score -3/800 - 3/8 = -303/800. b d = (0, 1), linear 5/2 - 7/2 = -1, score -1/100 - 1 = -101/100. c d = (1/2, 1/2), linear 2 - 3 = -1, score -1/100 - 1/2 = -51/100. m d = (1/4, 1/40), linear 9/4 - 101/40 = -11/40, score -11/4000 - 1/4 = -1011/4000. Unique maximum m.
Table B (nadP 1400, c_p = 1/800): none d = (1/2, 0), linear 2 - 5/4 = 3/4, score 3/400 - 1/2 = -197/400. a d = (0, 3/16), linear 5/2 - 23/16 = 17/16, score 17/1600 - 3/16 = -283/1600. b d = (0, 1/2), linear 5/2 - 7/4 = 3/4, score -197/400. c d = (1/2, 1/4), linear 2 - 3/2 = 1/2, score 1/200 - 1/2 = -99/200. m d = (1/4, 1/80), linear 9/4 - 101/80 = 79/80, score 79/8000 - 1/4 = -1921/8000. Unique maximum a.
So the optimum is m under table A and a under table B: the table is an input of the result, which is why a solver's reported table must be checked for admissibility (and Gate B comparisons made under that same table).`,
    notes: ['Relies on interpretation 17 (the payoff table is an input checked by exact admissibility). Reported doubles are compared exactly; Stage 3 needs tolerance handling for real data, whose exact coordinates are not doubles.'],
  }),

  defineCase({
    id: 'F11-decimal-weight-breaks-a-decimal-tie',
    family: 11,
    subcases: ['decimal_weight_exactness', 'exact_tie', 'tiny_positive_gap'],
    title: 'Weights 5 and 0.2 look like a tie in decimals, but the exact binary64 value of 0.2 separates the builds by 25/2^53',
    adrRefs: [...ADR, 'ADR 0010 section 2 (binary64 leaves decode to exact ratios; ties are exact equality)'],
    prerequisites: 'ergo_weight 5, recoil_weight 0.2 (binary64 0.2 = 3602879701896397/18014398509481984, slightly above 1/5); receiver ergonomics 20.',
    source: 'One slot s:[a, b]; a(+10 ergonomics), b(recoil -1/4).',
    fixture: fix({
      items: [{ id: 'a', ergonomics: 10 }, { id: 'b', recoilModifier: -0.25 }],
      weapon: { ergonomics: 20, slots: [slot('s', ['a', 'b'])] },
    }),
    request: { ergo_weight: 5, recoil_weight: 0.2 },
    feasible: [nk(), nk('a'), nk('b')],
    maxScore: '1351079888211148825/9007199254740992',
    maximizers: [nk('b')],
    scores: [[nk(), '100'], [nk('a'), '150']],
    tolerance: { kind: 'tiny_positive_gap', gap: '25/9007199254740992' },
    derivation: `Score = (5/10) fE - 0.2 fR. none: 0.5 x 200 = 100. a: 0.5 x 300 = 150. b: ergonomics 20 -> 100, plus 0.2 x 250 = 250 x 3602879701896397/18014398509481984 = 450359962737049625/9007199254740992 (= 50 + 25/2^53), so b = 1351079888211148825/9007199254740992.
In decimals a and b would both be 150; with the exact double 0.2 (just above 1/5) b exceeds a by 25/2^53 = 2.8e-15, so b is the unique maximum and no tie is claimed. (Exact values computed with Python fractions from the binary64 value of 0.2.)`,
    notes: ['The gap is far below any runtime tolerance: Stage 3 may skip exact equality (resolvableAtTolerance false) but must never report a tie.'],
  }),

  defineCase({
    id: 'F11-decimal-weights-adr-0010-example',
    family: 11,
    subcases: ['decimal_weight_exactness'],
    title: 'The ADR 0010 example with weights 0.4 and 0.6: exact scores differ from the decimal 84 and 200',
    adrRefs: [...ADR, 'ADR 0010 section 2 (worked example)'],
    prerequisites: 'ergo_weight 0.4, recoil_weight 0.6, price 0; receiver ergonomics 0; recoil modifiers -0.1 and -0.3 are binary64 values.',
    source: 'One slot s:[A, B]; A(+60 ergonomics, recoil -0.1), B(+50, recoil -0.3).',
    fixture: fix({
      items: [{ id: 'A', ergonomics: 60, recoilModifier: -0.1 }, { id: 'B', ergonomics: 50, recoilModifier: -0.3 }],
      weapon: { slots: [slot('s', ['A', 'B'])] },
    }),
    request: { ergo_weight: 0.4, recoil_weight: 0.6 },
    feasible: [nk(), nk('A'), nk('B')],
    maxScore: '4056481920730333837091470751825925/20282409603651670423947251286016',
    maximizers: [nk('B')],
    scores: [[nk(), '0'], [nk('A'), '3407444813413480730302330018201595/40564819207303340847894502572032']],
    derivation: `fE = 600, fR = 1000 x (-0.1) for A; fE = 500, fR = 1000 x (-0.3) for B, with every decimal read as its exact binary64 value. In decimals A = 84 and B = 200, but the exact rational scores are slightly different:
A = 3407444813413480730302330018201595/40564819207303340847894502572032 (about 84), B = 4056481920730333837091470751825925/20282409603651670423947251286016 (about 200). B is the unique maximum with a margin near 116.
(Exact rationals computed with Python fractions from the binary64 inputs and the ADR 0010 formula.)`,
  }),
];
