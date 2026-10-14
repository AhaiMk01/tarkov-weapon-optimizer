// Family 5: base accessibility (ADR 0013 section 3 item 5, ADR 0002 principle 5 and ADR 0010 section 4 item 5).
// Exactly one accessible base (naked receiver or a preset of this receiver) is paid once. Owned stock
// never grants a receiver and a stored price of 0 is not an offer. When nothing can be bought as a base
// (no legal offer for the receiver and none for any of its presets), the naked receiver is the player's
// own at price 0 (owner decision 2026-10-14, interpretation 18); presets are never assumed owned.
// Amended 2026-10-14: the three cases that expected "no accessible base: infeasible"
// (F05-no-legal-base-owned-receiver-grants-nothing, F05-no-legal-base-preset-of-another-weapon,
// F05-stored-zero-price-receiver-is-not-an-offer) now expect the owned receiver; their ids are kept.

import { defineCase, fix, flea, iid, nk, nakedBuild, presetBuild, ps, reqSlot, ROOT, slot, trader, traderOffer } from './dsl';
import type { LedgerCase } from './types';

const ADR = ['ADR 0002 principles 3 and 5', 'ADR 0008 principle 4', 'ADR 0010 section 4 item 5', 'ADR 0013 section 3 item 5'];
const OWNED = 'amendment 2026-10-14 (owned receiver when no base can be bought)';

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
    subcases: ['no_legal_base', 'owned_receiver_fallback'],
    title: 'With no base to buy the receiver is the player\'s own at price 0; the stash entry for the receiver changes nothing',
    adrRefs: [...ADR, OWNED],
    prerequisites: 'Receiver offer needs Prapor L3 but only L2 is unlocked; there is no preset. owned_items names the receiver and a part. Score = ergonomics (e=1, r=0, p=0). Interpretation 18.',
    source: 'Slot s:[a]; a(+3) Prapor L1 100 RUB; receiver Prapor L3 1000 RUB; owned_items [gun, a].',
    fixture: fix({ items: [{ id: 'a', ergonomics: 3 }], weapon: { offers: trader(1000, 'prapor', 3), slots: [slot('s', ['a'])] } }),
    request: { recoil_weight: 0, trader_levels: { prapor: 2 }, owned_items: ['gun', 'a'] },
    feasible: [nk(), nk('a')],
    maxScore: '3',
    maximizers: [nk('a')],
    scores: [[nk(), '0']],
    accepts: [
      { label: 'bare receiver', build: nakedBuild() },
      { label: 'receiver with the owned part', build: nakedBuild([ROOT, 's', 'a']) },
    ],
    statChecks: [
      { label: 'bare receiver', build: nakedBuild(), values: { spend: '0' }, base: 'owned' },
      { label: 'receiver with the owned part', build: nakedBuild([ROOT, 's', 'a']), values: { spend: '0' }, base: 'owned' },
    ],
    provenance: [{ label: 'receiver with the owned part', build: nakedBuild([ROOT, 's', 'a']), occurrences: [{ instanceId: iid(['s', 'a']), source: 'owned', charged: '0' }] }],
    derivation: `The receiver offer is locked (L3 > L2) and there is no preset, so nothing can be bought as a base: the naked receiver is the player's own at price 0 (interpretation 18). The stash entry "gun" plays no part (it neither grants nor is used by the base); the stash copy of a supplies a.
Feasible: none and a. Spend: 0 and 0 (a is owned). Score = ergonomics: none 0, a 3. a is the unique maximum.
Before the 2026-10-14 amendment this case expected certified infeasibility (no accessible base).`,
  }),

  defineCase({
    id: 'F05-no-legal-base-preset-of-another-weapon',
    family: 5,
    subcases: ['no_legal_base', 'owned_receiver_fallback'],
    title: 'A preset built on a different receiver is not an accessible base and does not stop the owned receiver',
    adrRefs: [...ADR, OWNED],
    prerequisites: 'Receiver gun has no offers at all; the only preset belongs to gun2. Score = ergonomics (e=1, r=0, p=0). Interpretation 18.',
    source: 'Weapons gun (offers: []) and gun2 (900 RUB); preset pre2 on gun2, 2000 RUB; request is for gun. Slot s:[a]; a(+3) Prapor L1 100 RUB.',
    fixture: fix({
      items: [{ id: 'a', ergonomics: 3 }],
      weapon: { offers: [], slots: [slot('s', ['a'])] },
      otherWeapons: [{ id: 'gun2', offers: trader(900) }],
      presets: [{ id: 'pre2', weaponId: 'gun2', components: [], offers: trader(2000) }],
    }),
    request: { recoil_weight: 0 },
    feasible: [nk(), nk('a')],
    maxScore: '3',
    maximizers: [nk('a')],
    scores: [[nk(), '0']],
    accepts: [{ label: 'naked gun', build: nakedBuild() }],
    rejections: [{ label: 'preset of gun2', build: presetBuild('pre2'), codes: ['BASE_WRONG_WEAPON'] }],
    statChecks: [{ label: 'owned gun with a', build: nakedBuild([ROOT, 's', 'a']), values: { spend: '100' }, base: 'owned' }],
    derivation: `gun has no offers and no preset of its own (pre2 is built on gun2 and cannot serve gun), so nothing can be bought as a base for gun: the naked gun is the player's own at price 0 (interpretation 18).
Feasible: none and a. Spend: 0 and 100 (a bought from Prapor). Score = ergonomics: none 0, a 3. a is the unique maximum.
Before the 2026-10-14 amendment this case expected certified infeasibility (no accessible base).`,
  }),

  defineCase({
    id: 'F05-stored-zero-price-receiver-is-not-an-offer',
    family: 5,
    subcases: ['no_legal_base', 'owned_receiver_fallback'],
    title: 'A receiver whose only stored price is 0 has no legal offer; with no preset it is the player\'s own',
    adrRefs: [...ADR, 'ADR 0013 section 4A (stored zero is not an offer)', OWNED],
    prerequisites: 'Interpretation 2 of the oracle: a stored trader or flea price <= 0 is not an offer. Interpretation 18. Score = ergonomics (e=1, r=0, p=0).',
    source: 'Receiver offers: [Prapor L1 cash at 0 RUB, flea at 0 RUB]; slot s:[a]; a(+3) Prapor L1 100 RUB.',
    fixture: fix({
      items: [{ id: 'a', ergonomics: 3 }],
      weapon: { offers: [traderOffer(0), flea(0)], slots: [slot('s', ['a'])] },
    }),
    request: { recoil_weight: 0 },
    feasible: [nk(), nk('a')],
    maxScore: '3',
    maximizers: [nk('a')],
    scores: [[nk(), '0']],
    accepts: [{ label: 'bare receiver', build: nakedBuild() }],
    statChecks: [{ label: 'bare receiver', build: nakedBuild(), values: { spend: '0' }, base: 'owned' }],
    derivation: `A stored price of zero does not establish an offer, so the receiver has no legal offer, and there is no preset: nothing can be bought as a base, so the receiver is the player's own at price 0 (interpretation 18). The zero price is not what makes it free: F05-stored-zero-price-receiver-with-buyable-preset shows the same receiver is inaccessible as soon as a preset can be bought.
Feasible: none and a (a bought for 100). Score = ergonomics: none 0, a 3.
Before the 2026-10-14 amendment this case expected certified infeasibility (no accessible base).`,
    notes: ['Relies on interpretation 2 (stored price <= 0 is not an offer) and interpretation 18 (owned receiver).'],
  }),

  defineCase({
    id: 'F05-stored-zero-price-receiver-with-buyable-preset',
    family: 5,
    subcases: ['no_invented_zero_receiver'],
    title: 'A receiver whose only stored price is 0 is not free when a preset can be bought',
    adrRefs: [...ADR, 'ADR 0013 section 4A (stored zero is not an offer)', OWNED],
    prerequisites: 'Interpretation 2: a stored price <= 0 is not an offer. Interpretation 18: the owned receiver applies only when no base can be bought. Score = ergonomics - spend / 1000 (e=1, r=0, p=1).',
    source: 'Receiver offers: [Prapor L1 cash at 0 RUB, flea at 0 RUB]; slot s:[a]; a(+3) Prapor L1 100 RUB; preset pre (gun, no components) Prapor L1 2500 RUB.',
    fixture: fix({
      items: [{ id: 'a', ergonomics: 3 }],
      weapon: { offers: [traderOffer(0), flea(0)], slots: [slot('s', ['a'])] },
      presets: [{ id: 'pre', weaponId: 'gun', components: [], offers: trader(2500) }],
    }),
    request: { recoil_weight: 0, price_weight: 1 },
    feasible: [ps('pre'), ps('pre', 'a')],
    maxScore: '2/5',
    maximizers: [ps('pre', 'a')],
    scores: [[ps('pre'), '-5/2']],
    rejections: [
      { label: 'bare receiver', build: nakedBuild(), codes: ['BASE_INACCESSIBLE'] },
      { label: 'receiver with a', build: nakedBuild([ROOT, 's', 'a']), codes: ['BASE_INACCESSIBLE'] },
    ],
    statChecks: [{ label: 'preset with a', build: presetBuild('pre', [ROOT, 's', 'a']), values: { spend: '2600' }, base: 'offer' }],
    derivation: `The stored zero prices are not offers, so the naked receiver has no legal offer; the preset is sold for 2500, so a base can be bought and there is no owned receiver. The only base is pre: no price-zero receiver is invented.
Spend: pre 2500, pre+a 2600. Score = ergonomics - spend / 1000: pre -2.5, pre+a 3 - 2.6 = 0.4. pre+a is the unique maximum.`,
    notes: ['Relies on interpretation 2 and interpretation 18.'],
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

  defineCase({
    id: 'F05-owned-receiver-no-offer-no-preset',
    family: 5,
    subcases: ['owned_receiver_fallback'],
    title: 'A receiver with no offer and no preset is the player\'s own: it costs nothing and only the parts are paid',
    adrRefs: [...ADR, OWNED],
    prerequisites: 'Interpretation 18. Score = ergonomics - spend / 1000 (e=1, r=0, p=1).',
    source: 'Receiver offers: []; no preset; slot s:[a]; a(+3) Prapor L1 100 RUB.',
    fixture: fix({ items: [{ id: 'a', ergonomics: 3 }], weapon: { offers: [], slots: [slot('s', ['a'])] } }),
    request: { recoil_weight: 0, price_weight: 1 },
    feasible: [nk(), nk('a')],
    maxScore: '29/10',
    maximizers: [nk('a')],
    scores: [[nk(), '0']],
    accepts: [{ label: 'bare receiver', build: nakedBuild() }],
    statChecks: [
      { label: 'bare receiver', build: nakedBuild(), values: { spend: '0' }, base: 'owned' },
      { label: 'receiver with a', build: nakedBuild([ROOT, 's', 'a']), values: { spend: '100' }, base: 'owned' },
    ],
    provenance: [{ label: 'receiver with a', build: nakedBuild([ROOT, 's', 'a']), occurrences: [{ instanceId: iid(['s', 'a']), source: 'offer', via: 'trader', charged: '100' }] }],
    derivation: `No offer for the receiver and no preset: nothing can be bought as a base, so the receiver is owned, price 0 (interpretation 18).
Spend: none 0, a 100. Score = ergonomics - spend / 1000: none 0, a 3 - 0.1 = 2.9. a is the unique maximum (a paid receiver would make both scores negative).`,
  }),

  defineCase({
    id: 'F05-owned-receiver-not-used-when-preset-buyable',
    family: 5,
    subcases: ['owned_receiver_fallback', 'inaccessible_naked_accessible_preset'],
    title: 'A receiver with no offer is not owned when one of its presets can be bought',
    adrRefs: [...ADR, OWNED],
    prerequisites: 'Interpretation 18: the owned receiver needs every base to be unbuyable. Score = ergonomics - spend / 1000 (e=1, r=0, p=1).',
    source: 'Receiver offers: []; slot s:[a]; a(+3) Prapor L1 100 RUB; preset pre (gun, a x1) Prapor L1 2500 RUB.',
    fixture: fix({
      items: [{ id: 'a', ergonomics: 3 }],
      weapon: { offers: [], slots: [slot('s', ['a'])] },
      presets: [{ id: 'pre', weaponId: 'gun', components: [{ itemId: 'a', count: 1 }], offers: trader(2500) }],
    }),
    request: { recoil_weight: 0, price_weight: 1 },
    feasible: [ps('pre'), ps('pre', 'a')],
    maxScore: '1/2',
    maximizers: [ps('pre', 'a')],
    scores: [[ps('pre'), '-5/2']],
    rejections: [
      { label: 'bare receiver', build: nakedBuild(), codes: ['BASE_INACCESSIBLE'] },
      { label: 'receiver with a', build: nakedBuild([ROOT, 's', 'a']), codes: ['BASE_INACCESSIBLE'] },
    ],
    statChecks: [{ label: 'preset keeping a', build: presetBuild('pre', [ROOT, 's', 'a']), values: { spend: '2500' }, base: 'offer' }],
    derivation: `The receiver has no offer, but the preset can be bought, so there is no owned receiver and the only base is pre.
Spend: pre 2500 with or without a (a comes with the preset). Score = ergonomics - spend / 1000: pre -2.5, pre+a 3 - 2.5 = 0.5 (unique maximum).`,
  }),

  defineCase({
    id: 'F05-owned-receiver-not-used-when-naked-buyable',
    family: 5,
    subcases: ['owned_receiver_fallback'],
    title: 'A buyable receiver is paid for even when none of its presets can be bought, and a preset is never owned',
    adrRefs: [...ADR, OWNED],
    prerequisites: 'trader_levels {skier: 2}. Interpretation 18. Score = ergonomics - spend / 1000 (e=1, r=0, p=1).',
    source: 'Receiver Prapor L1 1000 RUB; slot s:[a]; a(+3) Prapor L1 100 RUB; preset pre (gun, a x1) Skier L3 2500 RUB (locked).',
    fixture: fix({
      items: [{ id: 'a', ergonomics: 3 }],
      weapon: { offers: trader(1000), slots: [slot('s', ['a'])] },
      presets: [{ id: 'pre', weaponId: 'gun', components: [{ itemId: 'a', count: 1 }], offers: trader(2500, 'skier', 3) }],
    }),
    request: { recoil_weight: 0, price_weight: 1, trader_levels: { skier: 2 } },
    feasible: [nk(), nk('a')],
    maxScore: '19/10',
    maximizers: [nk('a')],
    scores: [[nk(), '-1']],
    rejections: [
      { label: 'locked preset', build: presetBuild('pre'), codes: ['BASE_INACCESSIBLE'] },
      { label: 'locked preset keeping a', build: presetBuild('pre', [ROOT, 's', 'a']), codes: ['BASE_INACCESSIBLE'] },
    ],
    statChecks: [
      { label: 'bare receiver', build: nakedBuild(), values: { spend: '1000' }, base: 'offer' },
      { label: 'receiver with a', build: nakedBuild([ROOT, 's', 'a']), values: { spend: '1100' }, base: 'offer' },
    ],
    derivation: `The receiver is sold for 1000, so a base can be bought and nothing is owned; the preset needs Skier L3 (only L2), so it is inaccessible and never assumed owned.
Spend: none 1000, a 1100. Score = ergonomics - spend / 1000: none -1, a 3 - 1.1 = 1.9. a is the unique maximum. A receiver wrongly taken as owned would score 3 and 2.9 instead.`,
  }),

  defineCase({
    id: 'F05-owned-receiver-required-slot-conflict-budget',
    family: 5,
    subcases: ['owned_receiver_fallback'],
    title: 'The owned receiver keeps every other rule: required slots, conflicts, and a budget that counts 0 for the receiver',
    adrRefs: [...ADR, OWNED],
    prerequisites: 'Interpretation 18. max_price 250. Score = ergonomics (e=1, r=0, p=0).',
    source: 'Receiver offers: []; no preset. Required slot r:[m1, m2]; slot s:[a]. m1(+5) 300 RUB, m2(+2) 100 RUB, a(+4) 150 RUB, all Prapor L1; a lists m1 as a conflict.',
    fixture: fix({
      items: [
        { id: 'm1', ergonomics: 5, offers: trader(300) },
        { id: 'm2', ergonomics: 2, offers: trader(100) },
        { id: 'a', ergonomics: 4, offers: trader(150), conflictingItemIds: ['m1'] },
      ],
      weapon: { offers: [], slots: [reqSlot('r', ['m1', 'm2']), slot('s', ['a'])] },
    }),
    request: { recoil_weight: 0, max_price: 250 },
    feasible: [nk('m2'), nk('a', 'm2')],
    maxScore: '6',
    maximizers: [nk('a', 'm2')],
    scores: [[nk('m2'), '2']],
    rejections: [
      { label: 'empty required slot', build: nakedBuild(), codes: ['MISSING_REQUIRED_SLOT'] },
      { label: 'm1 over budget', build: nakedBuild([ROOT, 'r', 'm1']), codes: ['MAX_PRICE_EXCEEDED'] },
      { label: 'm1 with a', build: nakedBuild([ROOT, 'r', 'm1'], [ROOT, 's', 'a']), codes: ['MAX_PRICE_EXCEEDED', 'TEMPLATE_CONFLICT'] },
    ],
    statChecks: [{ label: 'm2 with a, exactly at the cap', build: nakedBuild([ROOT, 'r', 'm2'], [ROOT, 's', 'a']), values: { spend: '250' }, base: 'owned' }],
    derivation: `Nothing can be bought as a base, so the receiver is owned at price 0. r must hold m1 or m2; s is empty or a.
Trees: m1 (300), m2 (100), m1+a (450, a conflicts with m1), m2+a (250). The cap 250 removes m1 and m1+a; m2+a is exactly at the cap, which holds only because the receiver counts 0.
Score = ergonomics: m2 2, m2+a 6 (unique maximum).`,
  }),

  defineCase({
    id: 'F05-owned-receiver-stash-of-receiver-id',
    family: 5,
    subcases: ['owned_receiver_fallback'],
    title: 'The owned receiver does not use the stash: a stash copy of the receiver id and of a part are unaffected',
    adrRefs: [...ADR, 'ADR 0008 principle 4', OWNED],
    prerequisites: 'Interpretation 18. owned_items [gun, a]. Score = ergonomics - spend / 1000 (e=1, r=0, p=1).',
    source: 'Receiver offers: []; no preset; slots s1:[a], s2:[a]; a(+3) Prapor L1 100 RUB.',
    fixture: fix({ items: [{ id: 'a', ergonomics: 3 }], weapon: { offers: [], slots: [slot('s1', ['a']), slot('s2', ['a'])] } }),
    request: { recoil_weight: 0, price_weight: 1, owned_items: ['gun', 'a'] },
    feasible: [nk(), nk('a'), nk('a', 'a')],
    maxScore: '59/10',
    maximizers: [nk('a', 'a')],
    scores: [[nk(), '0'], [nk('a'), '3']],
    accepts: [{ label: 'two copies of a', build: nakedBuild([ROOT, 's1', 'a'], [ROOT, 's2', 'a']) }],
    statChecks: [{ label: 'two copies of a', build: nakedBuild([ROOT, 's1', 'a'], [ROOT, 's2', 'a']), values: { spend: '100' }, base: 'owned' }],
    provenance: [{
      label: 'two copies of a',
      build: nakedBuild([ROOT, 's1', 'a'], [ROOT, 's2', 'a']),
      occurrences: [
        { instanceId: iid(['s1', 'a']), source: 'owned', charged: '0' },
        { instanceId: iid(['s2', 'a']), source: 'offer', via: 'trader', charged: '100' },
      ],
    }],
    derivation: `Nothing can be bought as a base, so the receiver is owned at price 0; the stash entry "gun" is neither required for this nor used by it, and the one stash copy of a still supplies one a.
Spend: none 0, one a 0 (owned), two a 100 (weapon_0/s1:a < weapon_0/s2:a, so s1 takes the owned copy and s2 is bought). Score = ergonomics - spend / 1000: 0, 3, 6 - 0.1 = 5.9. Two a is the unique maximum.`,
  }),
];
