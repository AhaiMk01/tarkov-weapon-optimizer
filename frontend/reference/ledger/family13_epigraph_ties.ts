// Family 13: zero price weight, exact budget deficits, multiple presets, exact ties and optional-reduction
// counterexamples (ADR 0013 section 3 item 13 and section 4A, ADR 0009, ADR 0010 section 4 item 13).
// The decoded purchase deficit d_i = max(0, installed_i - owned_i - preset_i) alone prices a build.
// No epsilon or base-count penalty breaks ties: with p = 0 builds that differ only in spend tie exactly.
// A tiny positive gap is never an exact tie.

import { defineCase, fix, nk, nakedBuild, presetBuild, ps, ROOT, slot, trader } from './dsl';
import type { LedgerCase } from './types';

const ADR = ['ADR 0009 principles 1-4', 'ADR 0010 section 4 item 13', 'ADR 0013 section 3 item 13'];
const ERGO_ONLY = { recoil_weight: 0 };
const ERGO_MINUS_SPEND = { ergo_weight: 1000, recoil_weight: 0, price_weight: 1000 };
const LOCKED = { trader_levels: { prapor: 2 } };
const edges = (slots: string[], item: string): [string, string, string][] => slots.map(s => [ROOT, s, item]);

/** M(+2, 100 RUB) fits four slots; receiver 1000; preset pre (M x1) 1500; one owned M. */
const budgetFixture = fix({
  items: [{ id: 'M', ergonomics: 2, offers: trader(100) }],
  weapon: { slots: [slot('s1', ['M']), slot('s2', ['M']), slot('s3', ['M']), slot('s4', ['M'])] },
  presets: [{ id: 'pre', weaponId: 'gun', components: [{ itemId: 'M', count: 1 }], offers: trader(1500) }],
});

/** a(+3), b(+4) at 100 RUB each in s1, s2; receiver 1000; presets p1 (a x1) 1500 and p2 (b x1) 1200. */
const presetsFixture = (naked: 'open' | 'locked') =>
  fix({
    items: [{ id: 'a', ergonomics: 3 }, { id: 'b', ergonomics: 4 }],
    weapon: { ...(naked === 'locked' ? { offers: trader(1000, 'prapor', 3) } : {}), slots: [slot('s1', ['a']), slot('s2', ['b'])] },
    presets: [
      { id: 'p1', weaponId: 'gun', components: [{ itemId: 'a', count: 1 }], offers: trader(1500) },
      { id: 'p2', weaponId: 'gun', components: [{ itemId: 'b', count: 1 }], offers: trader(1200) },
    ],
  });

export const FAMILY_13: LedgerCase[] = [
  defineCase({
    id: 'F13-zero-price-weight-exact-tie',
    family: 13,
    subcases: ['zero_price_weight', 'exact_tie'],
    title: 'With price weight 0 builds that differ only in spend or base tie exactly: no phantom spend, no base penalty',
    adrRefs: ADR,
    prerequisites: 'price_weight 0 (default), e=1, r=0. Receiver 1000, preset pre (a x1) 1500; a costs 100, b costs 9000; both give +3.',
    source: 'One slot s:[a, b].',
    fixture: fix({
      items: [{ id: 'a', ergonomics: 3, offers: trader(100) }, { id: 'b', ergonomics: 3, offers: trader(9000) }],
      weapon: { slots: [slot('s', ['a', 'b'])] },
      presets: [{ id: 'pre', weaponId: 'gun', components: [{ itemId: 'a', count: 1 }], offers: trader(1500) }],
    }),
    request: ERGO_ONLY,
    feasible: [nk(), nk('a'), nk('b'), ps('pre'), ps('pre', 'a'), ps('pre', 'b')],
    maxScore: '3',
    maximizers: [nk('a'), nk('b'), ps('pre', 'a'), ps('pre', 'b')],
    statChecks: [
      { label: 'naked a', build: nakedBuild([ROOT, 's', 'a']), values: { spend: '1100' } },
      { label: 'naked b', build: nakedBuild([ROOT, 's', 'b']), values: { spend: '10000' } },
      { label: 'preset a', build: presetBuild('pre', [ROOT, 's', 'a']), values: { spend: '1500' } },
      { label: 'preset b', build: presetBuild('pre', [ROOT, 's', 'b']), values: { spend: '10500' } },
    ],
    derivation: `Both bases and both parts are legal: naked and pre, each with none, a or b: 6 projections. Spend ranges from 1000 to 10500, but with p = 0 spend has no weight.
Score = ergonomics: 0 without a part, 3 with a or b. Four projections reach 3: naked+a, naked+b, pre+a, pre+b: an exact four-way tie, with no base or purchase penalty.`,
  }),

  defineCase({
    id: 'F13-budget-deficit-cap-equals-spend',
    family: 13,
    subcases: ['budget_deficit', 'zero_price_weight'],
    title: 'max_price equal to the exact deficit spend admits that build and no more',
    adrRefs: ADR,
    prerequisites: 'budgetFixture; owned_items [M]; price weight 0 so only the hard budget limits the build; max_price 1200.',
    source: 'Slots s1..s4:[M]; M(+2) 100 RUB; receiver 1000; preset pre (M x1) 1500.',
    fixture: budgetFixture,
    request: { ...ERGO_ONLY, owned_items: ['M'], max_price: 1200 },
    feasible: [nk(), nk('M'), nk('M', 'M'), nk('M', 'M', 'M')],
    maxScore: '6',
    maximizers: [nk('M', 'M', 'M')],
    rejections: [
      { label: 'naked, four M (1300)', build: nakedBuild(...edges(['s1', 's2', 's3', 's4'], 'M')), codes: ['MAX_PRICE_EXCEEDED'] },
      { label: 'bare preset (1500)', build: presetBuild('pre'), codes: ['MAX_PRICE_EXCEEDED'] },
    ],
    statChecks: [
      { label: 'naked, one M (owned)', build: nakedBuild(...edges(['s1'], 'M')), values: { spend: '1000' } },
      { label: 'naked, three M (one owned, two paid)', build: nakedBuild(...edges(['s1', 's2', 's3'], 'M')), values: { spend: '1200' } },
      { label: 'naked, four M', build: nakedBuild(...edges(['s1', 's2', 's3', 's4'], 'M')), values: { spend: '1300' } },
    ],
    derivation: `Naked spend with k copies = 1000 + 100 x max(0, k - 1) (one owned copy is free): 1000, 1000, 1100, 1200, 1300 for k = 0..4. The preset already costs 1500 > 1200, so no preset build is feasible.
With max_price 1200 the naked builds k = 0..3 are feasible (k = 3 is exactly at the cap) and k = 4 is not. Score = 2k: k = 3 gives 6, the unique maximum.`,
  }),

  defineCase({
    id: 'F13-budget-deficit-cap-one-below',
    family: 13,
    subcases: ['budget_deficit', 'zero_price_weight'],
    title: 'One RUB below the exact deficit spend the same build is infeasible',
    adrRefs: ADR,
    prerequisites: 'As above with max_price 1199.',
    source: 'budgetFixture; owned_items [M]; max_price 1199.',
    fixture: budgetFixture,
    request: { ...ERGO_ONLY, owned_items: ['M'], max_price: 1199 },
    feasible: [nk(), nk('M'), nk('M', 'M')],
    maxScore: '4',
    maximizers: [nk('M', 'M')],
    rejections: [{ label: 'naked, three M (1200)', build: nakedBuild(...edges(['s1', 's2', 's3'], 'M')), codes: ['MAX_PRICE_EXCEEDED'] }],
    derivation: `Spend 1000, 1000, 1100 for k = 0, 1, 2 is within 1199; k = 3 costs 1200 > 1199 and k = 4 costs 1300; the preset costs 1500. Feasible: k = 0, 1, 2; the best is k = 2 with score 4.
A model that charged the installed count (not the deficit) would price k = 2 at 1200 and wrongly reject it.`,
  }),

  defineCase({
    id: 'F13-multiple-presets-exact-tie',
    family: 13,
    subcases: ['multiple_presets', 'exact_tie'],
    title: 'Three accessible bases give three exactly tied optimal projections when the price weight is 0',
    adrRefs: ADR,
    prerequisites: 'Naked receiver 1000 and presets p1 (a x1, 1500), p2 (b x1, 1200) are all accessible; p = 0.',
    source: 'presetsFixture(open): slots s1:[a], s2:[b]; a(+3), b(+4).',
    fixture: presetsFixture('open'),
    request: ERGO_ONLY,
    feasible: [
      nk(), nk('a'), nk('b'), nk('a', 'b'),
      ps('p1'), ps('p1', 'a'), ps('p1', 'b'), ps('p1', 'a', 'b'),
      ps('p2'), ps('p2', 'a'), ps('p2', 'b'), ps('p2', 'a', 'b'),
    ],
    maxScore: '7',
    maximizers: [nk('a', 'b'), ps('p1', 'a', 'b'), ps('p2', 'a', 'b')],
    scores: [[nk('a'), '3'], [ps('p1', 'b'), '4'], [ps('p2', 'a'), '3']],
    derivation: `Every base (naked, p1, p2) combines with every subset of {a, b}: 3 x 4 = 12 projections, all legal (parts missing from a preset are bought, parts it contains are retained or stripped).
With p = 0 the score is the ergonomics 0, 3, 4, 7. The maximum 7 is reached by a+b on all three bases: an exact three-way tie. No base-count or spend penalty separates them.`,
  }),

  defineCase({
    id: 'F13-multiple-presets-cheapest-base-wins',
    family: 13,
    subcases: ['multiple_presets'],
    title: 'With the naked receiver locked, the cheaper of two presets wins once price matters',
    adrRefs: ADR,
    prerequisites: 'Naked receiver needs Prapor L3 (L2 unlocked); presets p1 (a x1, 1500) and p2 (b x1, 1200). Score = 1000 x ergonomics - spend.',
    source: 'presetsFixture(locked).',
    fixture: presetsFixture('locked'),
    request: { ...ERGO_MINUS_SPEND, ...LOCKED },
    feasible: [
      ps('p1'), ps('p1', 'a'), ps('p1', 'b'), ps('p1', 'a', 'b'),
      ps('p2'), ps('p2', 'a'), ps('p2', 'b'), ps('p2', 'a', 'b'),
    ],
    maxScore: '5700',
    maximizers: [ps('p2', 'a', 'b')],
    scores: [
      [ps('p1'), '-1500'], [ps('p1', 'a'), '1500'], [ps('p1', 'b'), '2400'], [ps('p1', 'a', 'b'), '5400'],
      [ps('p2'), '-1200'], [ps('p2', 'a'), '1700'], [ps('p2', 'b'), '2800'],
    ],
    statChecks: [
      { label: 'p1 with a and b', build: presetBuild('p1', [ROOT, 's1', 'a'], [ROOT, 's2', 'b']), values: { spend: '1600' } },
      { label: 'p2 with a and b', build: presetBuild('p2', [ROOT, 's1', 'a'], [ROOT, 's2', 'b']), values: { spend: '1300' } },
    ],
    derivation: `Only p1 and p2 are accessible bases. Spend: p1 1500 (a free), +100 for b; p2 1200 (b free), +100 for a. For {a,b}: p1 1600, p2 1300.
Score = 1000 x ergonomics - spend. p1: -1500, 3000-1500 = 1500, 4000-1600 = 2400, 7000-1600 = 5400. p2: -1200, 3000-1300 = 1700, 4000-1200 = 2800, 7000-1300 = 5700. p2+a+b = 5700 is the unique maximum.`,
  }),

  defineCase({
    id: 'F13-tiny-positive-gap-objective',
    family: 13,
    subcases: ['tiny_positive_gap'],
    title: 'Two parts whose ergonomics differ by 2^-20 do not tie: the better one is the unique maximum',
    adrRefs: [...ADR, 'ADR 0013 section 3 (a small positive gap is never an exact tie)'],
    prerequisites: 'Receiver ergonomics 0; e=1, r=0. Ergonomics 5 and 5 + 2^-20 are exact binary64 values.',
    source: 'One slot s:[a, b]; a(+5), b(+5 + 2^-20).',
    fixture: fix({ items: [{ id: 'a', ergonomics: 5 }, { id: 'b', ergonomics: 5 + 2 ** -20 }], weapon: { slots: [slot('s', ['a', 'b'])] } }),
    request: ERGO_ONLY,
    feasible: [nk(), nk('a'), nk('b')],
    maxScore: '5242881/1048576',
    maximizers: [nk('b')],
    scores: [[nk('a'), '5'], [nk(), '0']],
    tolerance: { kind: 'tiny_positive_gap', gap: '1/1048576' },
    derivation: `Score = ergonomics: none 0, a 5, b 5 + 1/1048576 = 5242881/1048576. The gap between the two best projections is exactly 2^-20 = 9.5e-7 > 0, so b is the unique maximum and {a, b} is not a tie.
A runtime tolerance of 1e-9 can resolve this gap (it is about 950 times larger).`,
  }),

  defineCase({
    id: 'F13-tiny-positive-gap-price-objective',
    family: 13,
    subcases: ['tiny_positive_gap'],
    title: 'Two parts whose prices differ by 2^-20 RUB do not tie once price counts',
    adrRefs: ADR,
    prerequisites: 'Score = 1000 x ergonomics - spend. Prices 100 and 100 + 2^-20 are exact binary64 values.',
    source: 'One slot s:[x, y]; x(+3) costs 100, y(+3) costs 100 + 2^-20.',
    fixture: fix({
      items: [
        { id: 'x', ergonomics: 3, offers: trader(100) },
        { id: 'y', ergonomics: 3, offers: trader(100 + 2 ** -20) },
      ],
      weapon: { slots: [slot('s', ['x', 'y'])] },
    }),
    request: ERGO_MINUS_SPEND,
    feasible: [nk(), nk('x'), nk('y')],
    maxScore: '1900',
    maximizers: [nk('x')],
    scores: [[nk('y'), '1992294399/1048576'], [nk(), '-1000']],
    tolerance: { kind: 'tiny_positive_gap', gap: '1/1048576' },
    derivation: `Score = 3000 - spend for a part: x 3000 - 1100 = 1900; y 3000 - (1100 + 1/1048576) = 1900 - 1/1048576 = 1992294399/1048576; none 0 - 1000 = -1000.
x beats y by exactly 2^-20 (9.5e-7): a unique maximum, not a tie.`,
  }),

  defineCase({
    id: 'F13-reduction-counterexample-multi-copy-capacity',
    family: 13,
    subcases: ['optional_reduction_counterexample', 'zero_price_weight'],
    title: 'Two copies of a purchasable part cost twice: a presence-only price would admit the over-budget build',
    adrRefs: [...ADR, 'ADR 0009 principle 4 (presence substitution needs capacity at most one)'],
    prerequisites: 'M fits two slots (capacity 2) and has no stock or preset supply; max_price 1100; price weight 0.',
    source: 'Slots s1,s2:[M]; M(+2) 100 RUB; receiver 1000.',
    fixture: fix({
      items: [{ id: 'M', ergonomics: 2, offers: trader(100) }],
      weapon: { slots: [slot('s1', ['M']), slot('s2', ['M'])] },
    }),
    request: { ...ERGO_ONLY, max_price: 1100 },
    feasible: [nk(), nk('M')],
    maxScore: '2',
    maximizers: [nk('M')],
    rejections: [{ label: 'two M (1200)', build: nakedBuild(...edges(['s1', 's2'], 'M')), codes: ['MAX_PRICE_EXCEEDED'] }],
    statChecks: [{ label: 'two M', build: nakedBuild(...edges(['s1', 's2'], 'M')), values: { spend: '1200' } }],
    derivation: `Spend: none 1000, M 1100 (at the cap), MM 1200 (two paid copies). MM breaks the cap. Feasible: none, M; the best is M = 2.
A presence-only substitution (buy_M = whether M appears) would price MM at 1100 and wrongly accept it as the maximum (4). Presence substitution is only legal for capacity at most one.`,
  }),

  defineCase({
    id: 'F13-reduction-counterexample-owned-offset',
    family: 13,
    subcases: ['optional_reduction_counterexample', 'zero_price_weight'],
    title: 'An owned copy costs nothing: a presence-only price would reject a build that fits the budget',
    adrRefs: [...ADR, 'ADR 0009 principle 4 (presence substitution needs zero owned stock)'],
    prerequisites: 'owned_items [N]; max_price 1000 (equal to the receiver price); price weight 0.',
    source: 'Slots s1,s2:[N]; N(+2) 100 RUB; receiver 1000.',
    fixture: fix({
      items: [{ id: 'N', ergonomics: 2, offers: trader(100) }],
      weapon: { slots: [slot('s1', ['N']), slot('s2', ['N'])] },
    }),
    request: { ...ERGO_ONLY, owned_items: ['N'], max_price: 1000 },
    feasible: [nk(), nk('N')],
    maxScore: '2',
    maximizers: [nk('N')],
    rejections: [{ label: 'two N (one paid)', build: nakedBuild(...edges(['s1', 's2'], 'N')), codes: ['MAX_PRICE_EXCEEDED'] }],
    statChecks: [
      { label: 'one N from stock', build: nakedBuild(...edges(['s1'], 'N')), values: { spend: '1000' } },
      { label: 'two N', build: nakedBuild(...edges(['s1', 's2'], 'N')), values: { spend: '1100' } },
    ],
    derivation: `Deficit d_N = max(0, installed - 1): one N costs 1000 (equal to the cap), two N cost 1100 (one paid copy). Feasible: none, N; the best is N = 2.
A presence-only price that ignored the owned copy would charge N 1100 and wrongly reject the best build.`,
  }),

  defineCase({
    id: 'F13-reduction-counterexample-preset-offset',
    family: 13,
    subcases: ['optional_reduction_counterexample'],
    title: 'A part supplied by the only accessible preset is free: ignoring preset supply would reject it',
    adrRefs: [...ADR, 'ADR 0009 principle 4 (presence substitution needs no supply from an accessible preset)'],
    prerequisites: 'Naked receiver locked; the preset (M x1) costs 1500; max_price 1500; price weight 0.',
    source: 'One slot s:[M]; M(+2) 100 RUB; preset pre (M x1) 1500; naked receiver Prapor L3 with L2 unlocked.',
    fixture: fix({
      items: [{ id: 'M', ergonomics: 2, offers: trader(100) }],
      weapon: { offers: trader(1000, 'prapor', 3), slots: [slot('s', ['M'])] },
      presets: [{ id: 'pre', weaponId: 'gun', components: [{ itemId: 'M', count: 1 }], offers: trader(1500) }],
    }),
    request: { ...ERGO_ONLY, ...LOCKED, max_price: 1500 },
    feasible: [ps('pre'), ps('pre', 'M')],
    maxScore: '2',
    maximizers: [ps('pre', 'M')],
    rejections: [{ label: 'naked receiver', build: nakedBuild(), codes: ['BASE_INACCESSIBLE'] }],
    statChecks: [{ label: 'preset keeping M', build: presetBuild('pre', [ROOT, 's', 'M']), values: { spend: '1500' } }],
    derivation: `Only pre is accessible; its supply of M makes pre+M cost exactly the preset price 1500 = the cap. Feasible: pre, pre+M; the best is pre+M = 2.
A reduction that charged M (100) regardless of preset supply would price pre+M at 1600 and wrongly reject it.`,
  }),

  defineCase({
    id: 'F13-reduction-counterexample-owned-stock-below-capacity',
    family: 13,
    subcases: ['optional_reduction_counterexample'],
    title: 'One owned copy does not cover two slots: eliminating the supply cap for "owned" items would admit two copies',
    adrRefs: [...ADR, 'ADR 0009 principle 4 (fully-owned elimination needs stock dominating capacity and keeps caps)'],
    prerequisites: 'R has no offers; owned_items [R]; two slots could hold R, so stock 1 < capacity 2.',
    source: 'Slots s1,s2:[R]; R(+2, offers: []).',
    fixture: fix({
      items: [{ id: 'R', ergonomics: 2, offers: [] }],
      weapon: { slots: [slot('s1', ['R']), slot('s2', ['R'])] },
    }),
    request: { ...ERGO_ONLY, owned_items: ['R'] },
    feasible: [nk(), nk('R')],
    maxScore: '2',
    maximizers: [nk('R')],
    rejections: [{ label: 'two R', build: nakedBuild(...edges(['s1', 's2'], 'R')), codes: ['QUANTITY_CAP_EXCEEDED'] }],
    derivation: `Supply for R is the single owned copy, and R cannot be bought, so at most one copy may be installed (the cap stays even though the stored price is irrelevant). Feasible: none, R; the best is R = 2.
Dropping the cap because R is "owned" would wrongly allow RR (score 4).`,
  }),
];
