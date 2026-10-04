// Family 5: base accessibility (ADR 0013 section 3 item 5, ADR 0002 principle 5 and ADR 0010 section 4 item 5).
// Exactly one accessible base (naked receiver or a preset of this receiver) is paid once. With no
// accessible base the problem is certified infeasible: no free receiver is invented, owned stock never
// grants a receiver, and a stored price of 0 is not an offer.

import { defineCase, fix, flea, nk, nakedBuild, presetBuild, ps, ROOT, slot, trader, traderOffer } from './dsl';
import type { LedgerCase } from './types';

const ADR = ['ADR 0002 principles 3 and 5', 'ADR 0008 principle 4', 'ADR 0010 section 4 item 5', 'ADR 0013 section 3 item 5'];

export const FAMILY_05: LedgerCase[] = [
  defineCase({
    id: 'F05-inaccessible-naked-accessible-preset',
    family: 5,
    subcases: ['inaccessible_naked_accessible_preset'],
    title: 'A receiver locked by trader level is solved through an accessible preset at its real price',
    adrRefs: ADR,
    prerequisites: 'trader_levels {prapor: 2, skier: 1}. Receiver offer Prapor L3 (locked); preset offer Skier L1 2500 containing one a. Score = ergonomics - spend (e=1, r=0, p=1000).',
    source: 'Slots s1:[a], s2:[b]; a(+3), b(+2), each 100 RUB; receiver Prapor L3 1000 RUB; preset pre (gun, a x1) Skier L1 2500 RUB.',
    fixture: fix({
      items: [{ id: 'a', ergonomics: 3 }, { id: 'b', ergonomics: 2 }],
      weapon: { offers: trader(1000, 'prapor', 3), slots: [slot('s1', ['a']), slot('s2', ['b'])] },
      presets: [{ id: 'pre', weaponId: 'gun', components: [{ itemId: 'a', count: 1 }], offers: trader(2500, 'skier', 1) }],
    }),
    request: { recoil_weight: 0, price_weight: 1000, trader_levels: { prapor: 2, skier: 1 } },
    feasible: [ps('pre'), ps('pre', 'a'), ps('pre', 'b'), ps('pre', 'a', 'b')],
    maxScore: '-2497',
    maximizers: [ps('pre', 'a')],
    scores: [[ps('pre'), '-2500'], [ps('pre', 'b'), '-2598'], [ps('pre', 'a', 'b'), '-2595']],
    rejections: [{ label: 'naked receiver', build: nakedBuild(), codes: ['BASE_INACCESSIBLE'] }],
    statChecks: [
      { label: 'preset keeping a', build: presetBuild('pre', [ROOT, 's1', 'a']), values: { spend: '2500' } },
      { label: 'preset keeping a, buying b', build: presetBuild('pre', [ROOT, 's1', 'a'], [ROOT, 's2', 'b']), values: { spend: '2600' } },
    ],
    derivation: `The naked receiver needs Prapor L3 but only L2 is unlocked, so only the preset is an accessible base: 4 projections, all with base pre.
Spend: pre 2500 (a is supplied, retained or stripped for free), pre+b 2600 (b paid 100), pre+a+b 2600.
Score = ergonomics - spend: pre -2500, pre+a 3-2500 = -2497, pre+b 2-2600 = -2598, pre+a+b 5-2600 = -2595. pre+a is the unique maximum.`,
  }),

  defineCase({
    id: 'F05-no-legal-base-owned-receiver-grants-nothing',
    family: 5,
    subcases: ['no_legal_base', 'no_invented_zero_receiver'],
    title: 'With no accessible base the request is infeasible, even when the stash lists the receiver',
    adrRefs: ADR,
    prerequisites: 'Receiver offer needs Prapor L3 but only L2 is unlocked; there is no preset. owned_items names the receiver and a part.',
    source: 'Slot s:[a]; receiver Prapor L3 1000 RUB; owned_items [gun, a].',
    fixture: fix({ items: [{ id: 'a', ergonomics: 3 }], weapon: { offers: trader(1000, 'prapor', 3), slots: [slot('s', ['a'])] } }),
    request: { recoil_weight: 0, trader_levels: { prapor: 2 }, owned_items: ['gun', 'a'] },
    feasible: [],
    maxScore: null,
    maximizers: [],
    rejections: [
      { label: 'bare receiver', build: nakedBuild(), codes: ['BASE_INACCESSIBLE'] },
      { label: 'receiver with the owned part', build: nakedBuild([ROOT, 's', 'a']), codes: ['BASE_INACCESSIBLE'] },
    ],
    derivation: `Exactly one accessible base is required and none exists, so every build is rejected: certified infeasible. Owning a mod never grants a free receiver, and an owned receiver id is only a stash string for mods.`,
  }),

  defineCase({
    id: 'F05-no-legal-base-preset-of-another-weapon',
    family: 5,
    subcases: ['no_legal_base'],
    title: 'A preset built on a different receiver is not an accessible base',
    adrRefs: ADR,
    prerequisites: 'Receiver gun has no offers at all; the only preset belongs to gun2.',
    source: 'Weapons gun (offers: []) and gun2 (900 RUB); preset pre2 on gun2, 2000 RUB; request is for gun.',
    fixture: fix({
      items: [{ id: 'a', ergonomics: 3 }],
      weapon: { offers: [], slots: [slot('s', ['a'])] },
      otherWeapons: [{ id: 'gun2', offers: trader(900) }],
      presets: [{ id: 'pre2', weaponId: 'gun2', components: [], offers: trader(2000) }],
    }),
    request: { recoil_weight: 0 },
    feasible: [],
    maxScore: null,
    maximizers: [],
    rejections: [
      { label: 'naked gun', build: nakedBuild(), codes: ['BASE_INACCESSIBLE'] },
      { label: 'preset of gun2', build: presetBuild('pre2'), codes: ['BASE_WRONG_WEAPON'] },
    ],
    derivation: `gun has no offers, so the naked base is inaccessible; pre2 is built on gun2 and cannot serve gun. No accessible base: empty.`,
  }),

  defineCase({
    id: 'F05-stored-zero-price-receiver-is-not-an-offer',
    family: 5,
    subcases: ['no_legal_base', 'no_invented_zero_receiver'],
    title: 'A receiver whose only stored price is 0 has no legal offer and is not free',
    adrRefs: [...ADR, 'ADR 0013 section 4A (stored zero is not an offer)'],
    prerequisites: 'Interpretation 2 of the oracle: a stored trader or flea price <= 0 is not an offer.',
    source: 'Receiver offers: [Prapor L1 cash at 0 RUB, flea at 0 RUB]; slot s:[a].',
    fixture: fix({
      items: [{ id: 'a', ergonomics: 3 }],
      weapon: { offers: [traderOffer(0), flea(0)], slots: [slot('s', ['a'])] },
    }),
    request: { recoil_weight: 0 },
    feasible: [],
    maxScore: null,
    maximizers: [],
    rejections: [{ label: 'bare receiver', build: nakedBuild(), codes: ['BASE_INACCESSIBLE'] }],
    derivation: `A stored price of zero does not establish a free offer, so the receiver has no legal offer: no accessible base, empty. No price-zero receiver is invented.`,
    notes: ['Relies on interpretation 2 (stored price <= 0 is not an offer).'],
  }),

  defineCase({
    id: 'F05-expensive-legal-offer-is-used',
    family: 5,
    subcases: ['expensive_legal_offer'],
    title: 'The only legal receiver offer is expensive and is used as is',
    adrRefs: ADR,
    prerequisites: 'Receiver offers: Prapor L3 1000 (locked at L2) and flea 9,000,000. Score = ergonomics - spend (e=1, r=0, p=1000).',
    source: 'Slot s:[a]; a(+3) costs 100.',
    fixture: fix({
      items: [{ id: 'a', ergonomics: 3 }],
      weapon: { offers: [traderOffer(1000, 'prapor', 3), flea(9_000_000)], slots: [slot('s', ['a'])] },
    }),
    request: { recoil_weight: 0, price_weight: 1000, trader_levels: { prapor: 2 } },
    feasible: [nk(), nk('a')],
    maxScore: '-9000000',
    maximizers: [nk()],
    scores: [[nk('a'), '-9000097']],
    statChecks: [{ label: 'receiver with a', build: nakedBuild([ROOT, 's', 'a']), values: { spend: '9000100' } }],
    derivation: `The trader offer is locked, so the legal base price is the flea 9,000,000. Spend: none 9,000,000; a 9,000,100.
Score = ergonomics - spend: none -9,000,000, a 3-9,000,100 = -9,000,097. The expensive receiver is legal and none wins.`,
  }),

  defineCase({
    id: 'F05-expensive-legal-offer-exceeds-cap',
    family: 5,
    subcases: ['expensive_legal_offer'],
    title: 'The expensive legal receiver offer breaks a budget cap just below its price',
    adrRefs: ADR,
    prerequisites: 'As above with max_price 8,999,999.',
    source: 'Same fixture as F05-expensive-legal-offer-is-used.',
    fixture: fix({
      items: [{ id: 'a', ergonomics: 3 }],
      weapon: { offers: [traderOffer(1000, 'prapor', 3), flea(9_000_000)], slots: [slot('s', ['a'])] },
    }),
    request: { recoil_weight: 0, trader_levels: { prapor: 2 }, max_price: 8_999_999 },
    feasible: [],
    maxScore: null,
    maximizers: [],
    rejections: [{ label: 'bare receiver', build: nakedBuild(), codes: ['MAX_PRICE_EXCEEDED'] }],
    derivation: `The cheapest legal base costs 9,000,000 > 8,999,999, so even the bare receiver is over budget and no cheaper base is invented: empty.`,
  }),

  defineCase({
    id: 'F05-cheapest-legal-offer-is-selected',
    family: 5,
    subcases: ['cheapest_legal_offer'],
    title: 'The cheapest offer that is legal for the request sets the price; locked offers are ignored',
    adrRefs: ADR,
    prerequisites: 'trader_levels {prapor: 2}; flea open. Score = -spend (e=0, r=0, p=1000).',
    source: 'Receiver offers: Prapor L3 1000 (locked), flea 1400, Skier L1 1600. Slot s:[a]; a offers: Prapor L1 100, flea 80.',
    fixture: fix({
      items: [{ id: 'a', ergonomics: 3, offers: [traderOffer(100), flea(80)] }],
      weapon: { offers: [traderOffer(1000, 'prapor', 3), flea(1400), traderOffer(1600, 'skier', 1)], slots: [slot('s', ['a'])] },
    }),
    request: { ergo_weight: 0, recoil_weight: 0, price_weight: 1000, trader_levels: { prapor: 2 } },
    feasible: [nk(), nk('a')],
    maxScore: '-1400',
    maximizers: [nk()],
    scores: [[nk('a'), '-1480']],
    statChecks: [{ label: 'receiver with a', build: nakedBuild([ROOT, 's', 'a']), values: { spend: '1480' } }],
    derivation: `Receiver: the locked 1000 is ignored; min(1400, 1600) = 1400. Part a: min(100, 80) = 80.
Score = -spend: none -1400, a -1480. none is the unique maximum.`,
  }),

  defineCase({
    id: 'F05-preset-only-item-no-invented-price',
    family: 5,
    subcases: ['preset_only_item_real_spend'],
    title: 'An item sold only inside a preset is priced by that preset, with no invented stand-in price',
    adrRefs: [...ADR, 'ADR 0008 principle 5 (arbitrary preset-only heuristics are removed)'],
    prerequisites: 'r has no offers; the preset contains one r. Score = 1000 x ergonomics - spend (e=1000, r=0, p=1000).',
    source: 'Slot s:[r]; r(+5) has offers: []; receiver 1000 RUB; preset pre (gun, r x1) 1500 RUB.',
    fixture: fix({
      items: [{ id: 'r', ergonomics: 5, offers: [] }],
      weapon: { slots: [slot('s', ['r'])] },
      presets: [{ id: 'pre', weaponId: 'gun', components: [{ itemId: 'r', count: 1 }], offers: trader(1500) }],
    }),
    request: { ergo_weight: 1000, recoil_weight: 0, price_weight: 1000 },
    feasible: [nk(), ps('pre'), ps('pre', 'r')],
    maxScore: '3500',
    maximizers: [ps('pre', 'r')],
    scores: [[nk(), '-1000'], [ps('pre'), '-1500']],
    rejections: [{ label: 'naked receiver with r', build: nakedBuild([ROOT, 's', 'r']), codes: ['QUANTITY_CAP_EXCEEDED'] }],
    statChecks: [{ label: 'preset keeping r', build: presetBuild('pre', [ROOT, 's', 'r']), values: { spend: '1500' } }],
    derivation: `r can only come from the preset: naked+r breaks the supply cap (0 < 1), while pre+r is legal at exactly the preset price 1500.
Score = 1000 x ergonomics - spend: naked none -1000, pre none -1500, pre+r 5000-1500 = 3500 (unique maximum). No 100,000,000 stand-in price appears.`,
  }),
];
