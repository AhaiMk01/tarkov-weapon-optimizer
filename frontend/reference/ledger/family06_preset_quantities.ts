// Family 6: preset quantities, stripping and retention (ADR 0013 section 3 item 6, ADR 0002 principle 2,
// ADR 0010 section 4 item 6). A preset supplies q_{b,i} copies of component i at 0 RUB; the base is paid
// once; unused parts are stripped for free (no resale credit, no penalty); an accessible preset never
// forces its own purchase when another legal source exists.

import { defineCase, fix, nk, nakedBuild, presetBuild, ps, reqSlot, ROOT, slot, trader } from './dsl';
import type { LedgerCase } from './types';

const ADR = ['ADR 0002 principle 2', 'ADR 0009 principle 3', 'ADR 0010 section 4 item 6', 'ADR 0013 section 3 item 6'];

/** Score = 1000 x ergonomics - spend (e=1000, r=0, p=1000), so a RUB of spend is one score point. */
const ERGO_MINUS_SPEND = { ergo_weight: 1000, recoil_weight: 0, price_weight: 1000 };

/** a(+3) costs 700 and fits three slots; naked 1000; preset pre (gun, a x2) 1500. */
const copiesFixture = fix({
  items: [{ id: 'a', ergonomics: 3, offers: trader(700) }],
  weapon: { slots: [slot('s1', ['a']), slot('s2', ['a']), slot('s3', ['a'])] },
  presets: [{ id: 'pre', weaponId: 'gun', components: [{ itemId: 'a', count: 2 }], offers: trader(1500) }],
});

/** Naked receiver locked (Prapor L3, unlocked L2); the only base is pre (gun, a x1, b x1) at 1500. */
const lockedFixture = fix({
  items: [{ id: 'a', ergonomics: 3 }, { id: 'b', ergonomics: 2 }],
  weapon: { offers: trader(1000, 'prapor', 3), slots: [slot('s1', ['a']), slot('s2', ['b'])] },
  presets: [{ id: 'pre', weaponId: 'gun', components: [{ itemId: 'a', count: 1 }, { itemId: 'b', count: 1 }], offers: trader(1500) }],
});
const LOCKED = { trader_levels: { prapor: 2 } };

/** a has no offers; naked 1000; preset pre (gun, a x1) 1500; a(+3) fits one slot. */
const supplyFixture = fix({
  items: [{ id: 'a', ergonomics: 3, offers: [] }],
  weapon: { slots: [slot('s', ['a'])] },
  presets: [{ id: 'pre', weaponId: 'gun', components: [{ itemId: 'a', count: 1 }], offers: trader(1500) }],
});

export const FAMILY_06: LedgerCase[] = [
  defineCase({
    id: 'F06-preset-count-gt-one-two-copies',
    family: 6,
    subcases: ['preset_count_gt_one', 'multiple_copies', 'base_cost_once'],
    title: 'A preset that contains two copies supplies both for the single base price',
    adrRefs: ADR,
    prerequisites: 'Two slots take a; the preset contains a x2 (a source count above one). Score = 1000 x ergonomics - spend.',
    source: 'Slots s1,s2:[a]; a(+3) costs 700; receiver 1000; preset pre (a x2) 1500.',
    fixture: fix({
      items: [{ id: 'a', ergonomics: 3, offers: trader(700) }],
      weapon: { slots: [slot('s1', ['a']), slot('s2', ['a'])] },
      presets: [{ id: 'pre', weaponId: 'gun', components: [{ itemId: 'a', count: 2 }], offers: trader(1500) }],
    }),
    request: ERGO_MINUS_SPEND,
    feasible: [nk(), nk('a'), nk('a', 'a'), ps('pre'), ps('pre', 'a'), ps('pre', 'a', 'a')],
    maxScore: '4500',
    maximizers: [ps('pre', 'a', 'a')],
    scores: [[nk(), '-1000'], [nk('a'), '1300'], [nk('a', 'a'), '3600'], [ps('pre'), '-1500'], [ps('pre', 'a'), '1500']],
    statChecks: [
      { label: 'preset with both copies', build: presetBuild('pre', [ROOT, 's1', 'a'], [ROOT, 's2', 'a']), values: { spend: '1500' } },
      { label: 'naked with two bought copies', build: nakedBuild([ROOT, 's1', 'a'], [ROOT, 's2', 'a']), values: { spend: '2400' } },
    ],
    derivation: `Spend: naked 1000 + 700 per copy: none 1000, a 1700, aa 2400. Preset: 1500 once, with up to two copies free, so pre, pre+a and pre+aa all cost 1500.
Score = 3000 x copies - spend: naked -1000, 1300, 3600; preset -1500, 1500, 4500. pre+aa = 4500 is the unique maximum.`,
  }),

  defineCase({
    id: 'F06-base-cost-once-extra-copy-paid',
    family: 6,
    subcases: ['multiple_copies', 'base_cost_once'],
    title: 'A third copy beyond the preset supply is paid on top of one base price',
    adrRefs: ADR,
    prerequisites: 'Three slots take a; the preset supplies two copies. Score = 1000 x ergonomics - spend.',
    source: 'copiesFixture: a(+3) 700 RUB in s1..s3; receiver 1000; pre (a x2) 1500.',
    fixture: copiesFixture,
    request: ERGO_MINUS_SPEND,
    feasible: [nk(), nk('a'), nk('a', 'a'), nk('a', 'a', 'a'), ps('pre'), ps('pre', 'a'), ps('pre', 'a', 'a'), ps('pre', 'a', 'a', 'a')],
    maxScore: '6800',
    maximizers: [ps('pre', 'a', 'a', 'a')],
    scores: [[nk('a', 'a', 'a'), '5900'], [ps('pre', 'a', 'a'), '4500']],
    statChecks: [{ label: 'preset with three copies', build: presetBuild('pre', [ROOT, 's1', 'a'], [ROOT, 's2', 'a'], [ROOT, 's3', 'a']), values: { spend: '2200' } }],
    derivation: `Spend with k copies: naked 1000 + 700k; preset 1500 + 700 x max(0, k-2) (the base is counted once, two copies are supplied).
Score = 3000k - spend: naked -1000, 1300, 3600, 5900; preset -1500, 1500, 4500, 9000-2200 = 6800. pre+aaa = 6800 is the unique maximum.`,
  }),

  defineCase({
    id: 'F06-stripping-and-retention-exact-tie',
    family: 6,
    subcases: ['stripping', 'retention'],
    title: 'Keeping or stripping preset parts costs the same, so a price-only objective ties all four',
    adrRefs: [...ADR, 'ADR 0009 principle 2 (no objective penalty on stripping)'],
    prerequisites: 'Naked receiver locked; the preset (a x1, b x1, 1500 RUB) is the only base. Score = -spend (e=0, r=0, p=1000).',
    source: 'lockedFixture: slots s1:[a], s2:[b]; a(+3), b(+2); trader_levels {prapor: 2}.',
    fixture: lockedFixture,
    request: { ergo_weight: 0, recoil_weight: 0, price_weight: 1000, ...LOCKED },
    feasible: [ps('pre'), ps('pre', 'a'), ps('pre', 'b'), ps('pre', 'a', 'b')],
    maxScore: '-1500',
    maximizers: [ps('pre'), ps('pre', 'a'), ps('pre', 'b'), ps('pre', 'a', 'b')],
    rejections: [{ label: 'naked receiver', build: nakedBuild(), codes: ['BASE_INACCESSIBLE'] }],
    statChecks: [
      { label: 'stripped bare preset', build: presetBuild('pre'), values: { spend: '1500' } },
      { label: 'fully retained preset', build: presetBuild('pre', [ROOT, 's1', 'a'], [ROOT, 's2', 'b']), values: { spend: '1500' } },
    ],
    derivation: `Only pre is accessible. Every subset of {a, b} fits the supply, so spend is 1500 whether parts are retained or stripped (no resale credit, no penalty).
Score = -1500 for all four projections: an exact four-way tie. No epsilon or base penalty separates them.`,
  }),

  defineCase({
    id: 'F06-retention-beats-stripping-with-ergonomics',
    family: 6,
    subcases: ['retention'],
    title: 'When ergonomics matter the preset parts are retained at no extra cost',
    adrRefs: ADR,
    prerequisites: 'Same locked fixture. Score = 1000 x ergonomics - spend.',
    source: 'lockedFixture; trader_levels {prapor: 2}.',
    fixture: lockedFixture,
    request: { ...ERGO_MINUS_SPEND, ...LOCKED },
    feasible: [ps('pre'), ps('pre', 'a'), ps('pre', 'b'), ps('pre', 'a', 'b')],
    maxScore: '3500',
    maximizers: [ps('pre', 'a', 'b')],
    scores: [[ps('pre'), '-1500'], [ps('pre', 'a'), '1500'], [ps('pre', 'b'), '500']],
    derivation: `Spend is 1500 for every projection, so the score is 1000 x ergonomics - 1500: none -1500, a 1500, b 500, a+b 5000-1500 = 3500. Retaining both parts is the unique maximum.`,
  }),

  defineCase({
    id: 'F06-forced-stripping-by-exclusion',
    family: 6,
    subcases: ['stripping'],
    title: 'A preset stays legal when the request bans one of its parts: the part is stripped',
    adrRefs: ADR,
    prerequisites: 'Same locked fixture; exclude_items [b]. Score = 1000 x ergonomics - spend.',
    source: 'lockedFixture; request bans b although pre contains it.',
    fixture: lockedFixture,
    request: { ...ERGO_MINUS_SPEND, ...LOCKED, exclude_items: ['b'] },
    feasible: [ps('pre'), ps('pre', 'a')],
    maxScore: '1500',
    maximizers: [ps('pre', 'a')],
    scores: [[ps('pre'), '-1500']],
    rejections: [
      { label: 'preset with the banned b installed', build: presetBuild('pre', [ROOT, 's2', 'b']), codes: ['EXCLUDED_ITEM'] },
    ],
    derivation: `b is banned, so it is stripped from the preset at zero cost; the preset itself stays accessible. Feasible: pre, pre+a. Scores -1500 and 3000-1500 = 1500; pre+a wins.`,
  }),

  defineCase({
    id: 'F06-preset-with-conflicting-parts-forces-stripping',
    family: 6,
    subcases: ['stripping'],
    title: 'A preset whose parts conflict with each other stays a legal base: one of them must be stripped',
    adrRefs: ADR,
    prerequisites: 'a lists b as a conflict yet pre contains both; the naked receiver is locked. Score = 1000 x ergonomics - spend.',
    source: 'Slots s1:[a], s2:[b]; a(+3, lists b), b(+2); preset pre (a x1, b x1) 1500; trader_levels {prapor: 2}.',
    fixture: fix({
      items: [{ id: 'a', ergonomics: 3, conflictingItemIds: ['b'] }, { id: 'b', ergonomics: 2 }],
      weapon: { offers: trader(1000, 'prapor', 3), slots: [slot('s1', ['a']), slot('s2', ['b'])] },
      presets: [{ id: 'pre', weaponId: 'gun', components: [{ itemId: 'a', count: 1 }, { itemId: 'b', count: 1 }], offers: trader(1500) }],
    }),
    request: { ...ERGO_MINUS_SPEND, ...LOCKED },
    feasible: [ps('pre'), ps('pre', 'a'), ps('pre', 'b')],
    maxScore: '1500',
    maximizers: [ps('pre', 'a')],
    scores: [[ps('pre'), '-1500'], [ps('pre', 'b'), '500']],
    rejections: [{ label: 'both conflicting parts kept', build: presetBuild('pre', [ROOT, 's1', 'a'], [ROOT, 's2', 'b']), codes: ['TEMPLATE_CONFLICT'] }],
    derivation: `Only pre is accessible. Its supply covers a and b, but the installed set may not contain both (pair conflict), so one of them is stripped at no cost: pre, pre+a, pre+b.
Score = 1000 x ergonomics - 1500: -1500, 1500, 500; pre+a is the unique maximum. The conflict constrains the installed set, never the preset's legality.`,
  }),

  defineCase({
    id: 'F06-required-slot-filled-only-through-preset-supply',
    family: 6,
    subcases: ['retention'],
    title: 'A required slot whose only candidate is unbuyable forces the preset base and the retained part',
    adrRefs: ADR,
    prerequisites: 'r has no offers and no stock; only the preset supplies it; the naked receiver is accessible but cannot fill the required slot. Score = 1000 x ergonomics - spend.',
    source: 'Required receiver slot sr:[r]; r(+4, offers: []); receiver 1000; preset pre (r x1) 1500.',
    fixture: fix({
      items: [{ id: 'r', ergonomics: 4, offers: [] }],
      weapon: { slots: [reqSlot('sr', ['r'])] },
      presets: [{ id: 'pre', weaponId: 'gun', components: [{ itemId: 'r', count: 1 }], offers: trader(1500) }],
    }),
    request: ERGO_MINUS_SPEND,
    feasible: [ps('pre', 'r')],
    maxScore: '2500',
    maximizers: [ps('pre', 'r')],
    rejections: [
      { label: 'naked receiver with r', build: nakedBuild([ROOT, 'sr', 'r']), codes: ['QUANTITY_CAP_EXCEEDED'] },
      { label: 'naked receiver, empty required slot', build: nakedBuild(), codes: ['MISSING_REQUIRED_SLOT'] },
      { label: 'preset with the part stripped', build: presetBuild('pre'), codes: ['MISSING_REQUIRED_SLOT'] },
    ],
    derivation: `The required slot must hold r. Naked base: r has no supply (breaks the cap); preset base: supply 1, so the part must be retained (stripping it empties the required slot).
The only feasible projection is pre+r, with score 4 x 1000 - 1500 = 2500.`,
  }),

  defineCase({
    id: 'F06-no-preset-monopoly-owned-supply',
    family: 6,
    subcases: ['no_preset_monopoly'],
    title: 'An owned copy keeps the naked receiver legal although a preset also contains the part',
    adrRefs: [...ADR, 'ADR 0008 principle 5 (the presence-only preset monopoly is removed)'],
    prerequisites: 'a has no standalone offer; owned_items [a]; a preset also contains a. Score = 1000 x ergonomics - spend.',
    source: 'supplyFixture: slot s:[a]; a(+3, offers: []); receiver 1000; pre (a x1) 1500.',
    fixture: supplyFixture,
    request: { ...ERGO_MINUS_SPEND, owned_items: ['a'] },
    feasible: [nk(), nk('a'), ps('pre'), ps('pre', 'a')],
    maxScore: '2000',
    maximizers: [nk('a')],
    scores: [[nk(), '-1000'], [ps('pre'), '-1500'], [ps('pre', 'a'), '1500']],
    statChecks: [{ label: 'naked with the owned a', build: nakedBuild([ROOT, 's', 'a']), values: { spend: '1000' } }],
    derivation: `The owned copy supplies a for the naked base (cap 0 + 1 >= 1), so both bases are legal with and without a: 4 projections.
Score = 3000 x copies - spend: naked none -1000, naked a 3000-1000 = 2000, pre none -1500, pre a 3000-1500 = 1500. The cheaper naked base wins: the preset is not forced.`,
  }),

  defineCase({
    id: 'F06-preset-supply-when-no-other-source',
    family: 6,
    subcases: ['no_preset_monopoly'],
    title: 'Without stock the preset is the only source of the part, yet the bare receiver stays legal',
    adrRefs: [...ADR, 'ADR 0008 principle 5'],
    prerequisites: 'As above but the stash is empty.',
    source: 'supplyFixture; no owned_items.',
    fixture: supplyFixture,
    request: ERGO_MINUS_SPEND,
    feasible: [nk(), ps('pre'), ps('pre', 'a')],
    maxScore: '1500',
    maximizers: [ps('pre', 'a')],
    scores: [[nk(), '-1000'], [ps('pre'), '-1500']],
    rejections: [{ label: 'naked with a', build: nakedBuild([ROOT, 's', 'a']), codes: ['QUANTITY_CAP_EXCEEDED'] }],
    derivation: `Installing a needs preset supply (naked has none, stock 0), so naked+a breaks the cap while the bare naked receiver stays legal: no forced monopoly for builds that do not install a.
Feasible: naked none, pre none, pre+a. Scores -1000, -1500, 3000-1500 = 1500; pre+a wins.`,
  }),
];
