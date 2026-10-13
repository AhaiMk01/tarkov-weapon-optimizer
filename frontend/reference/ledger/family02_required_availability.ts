// Family 2: required occupancy and availability (ADR 0013 section 3 item 2, ADR 0002 principles 5 and 8,
// ADR 0003 principle 3). An empty root required slot is certified infeasible; an empty conditional
// (mod-owned) required slot only forces its owner off while alternatives survive; candidates that
// the market or the request makes unavailable can never fill a slot. A rejection here is a pass.

import { defineCase, fix, nk, nakedBuild, reqSlot, ROOT, slot, trader, flea, iid } from './dsl';
import type { LedgerCase } from './types';

const ADR = ['ADR 0002 principle 5', 'ADR 0003 principle 3', 'ADR 0010 section 4 item 2', 'ADR 0013 section 3 item 2'];
const ERGO_ONLY = { recoil_weight: 0 };

const barter = (price: number, requiresDogtag = false) => ({
  kind: 'barter' as const,
  trader: 'prapor',
  level: 1,
  requirements: [{ itemId: 'ingredient', count: 1, basePrice: price }],
  requiresDogtag,
});

/** Four items, one per optional weapon slot, differing only in how they can be bought. */
const marketFixture = fix({
  items: [
    { id: 'fl', ergonomics: 1, offers: [flea(100)] },
    { id: 'ba', ergonomics: 2, offers: [barter(100)] },
    { id: 'bd', ergonomics: 4, offers: [barter(100, true)] },
    { id: 'tr', ergonomics: 8, offers: trader(100) },
  ],
  weapon: { slots: [slot('s1', ['fl']), slot('s2', ['ba']), slot('s3', ['bd']), slot('s4', ['tr'])] },
});

export const FAMILY_02: LedgerCase[] = [
  defineCase({
    id: 'F02-empty-root-required-slot-excluded',
    family: 2,
    subcases: ['empty_root_required_slot'],
    title: 'A root required slot whose only candidate is banned makes the whole request infeasible',
    adrRefs: ADR,
    prerequisites: 'The receiver has a required slot; a request ban removes its only candidate.',
    source: 'Weapon slots sr (required):[a] and so:[b]; a(+5), b(+1); request excludes a.',
    fixture: fix({
      items: [{ id: 'a', ergonomics: 5 }, { id: 'b', ergonomics: 1 }],
      weapon: { slots: [reqSlot('sr', ['a']), slot('so', ['b'])] },
    }),
    request: { ...ERGO_ONLY, exclude_items: ['a'] },
    feasible: [],
    maxScore: null,
    maximizers: [],
    rejections: [
      { label: 'optional slot filled, required slot empty', build: nakedBuild([ROOT, 'so', 'b']), codes: ['MISSING_REQUIRED_SLOT'] },
      { label: 'banned a in the required slot', build: nakedBuild([ROOT, 'sr', 'a']), codes: ['EXCLUDED_ITEM'] },
    ],
    derivation: `The root requires sr to be occupied (occupancy 1) and its only candidate a is banned, so no rooted tree exists: the feasible set is empty (certified infeasible).
Other builds fail differently: b alone leaves sr empty (MISSING_REQUIRED_SLOT); a in sr violates the ban (EXCLUDED_ITEM). Unlike a mod-owned slot, a root slot cannot be switched off.`,
  }),

  defineCase({
    id: 'F02-empty-root-required-slot-unavailable-candidate',
    family: 2,
    subcases: ['empty_root_required_slot', 'unavailable_candidates'],
    title: 'A required root slot whose only candidate has no legal source is infeasible',
    adrRefs: [...ADR, 'ADR 0002 principle 8'],
    prerequisites: 'a has no offers, no preset supplies it and the stash is empty; no zero-cost fallback exists.',
    source: 'Weapon slot sr (required):[a]; a(+5) has offers: [].',
    fixture: fix({ items: [{ id: 'a', ergonomics: 5, offers: [] }], weapon: { slots: [reqSlot('sr', ['a'])] } }),
    request: ERGO_ONLY,
    feasible: [],
    maxScore: null,
    maximizers: [],
    rejections: [
      { label: 'a installed without supply', build: nakedBuild([ROOT, 'sr', 'a']), codes: ['QUANTITY_CAP_EXCEEDED'] },
      { label: 'required slot empty', build: nakedBuild(), codes: ['MISSING_REQUIRED_SLOT'] },
    ],
    derivation: `a cannot be bought, no preset supplies it and N_owned(a) = 0, so the cap sum p_a <= 0 holds: one installed copy exceeds it (QUANTITY_CAP_EXCEEDED).
The required slot cannot stay empty (MISSING_REQUIRED_SLOT). Hence nothing is feasible. No price is invented for a.`,
  }),

  defineCase({
    id: 'F02-required-root-slot-filled-by-owned-stock',
    family: 2,
    subcases: ['unavailable_candidates'],
    title: 'The same unavailable candidate becomes legal once the stash supplies one copy',
    adrRefs: [...ADR, 'ADR 0008 principle 4'],
    prerequisites: 'As F02-empty-root-required-slot-unavailable-candidate, plus owned_items = [a]. The receiver itself is still bought.',
    source: 'Weapon slot sr (required):[a]; a(+5) has offers: []; owned_items [a].',
    fixture: fix({ items: [{ id: 'a', ergonomics: 5, offers: [] }], weapon: { slots: [reqSlot('sr', ['a'])] } }),
    request: { ...ERGO_ONLY, owned_items: ['a'] },
    feasible: [nk('a')],
    maxScore: '5',
    maximizers: [nk('a')],
    statChecks: [{ label: 'a from stock', build: nakedBuild([ROOT, 'sr', 'a']), values: { spend: '1000', ergonomics: '5' } }],
    derivation: `The only tree fills sr with a. Supply: preset 0 + owned 1 = 1 >= 1 copy, so the cap holds. Spend is the receiver offer 1000 plus 0 for the owned a. Score = clamped ergonomics = 5.`,
  }),

  defineCase({
    id: 'F02-conditional-required-slot-excluded-candidate-owner-off',
    family: 2,
    subcases: ['empty_conditional_slot_owner_off'],
    title: 'An empty mod-owned required slot forces its owner off while an alternative path survives',
    adrRefs: ADR,
    prerequisites: 'owner has a required slot whose only candidate is banned; the receiver slot also accepts alt.',
    source: 'Weapon slot s:[owner, alt]; owner(+10) has required slot need:[gone]; gone(0), alt(+1); request excludes gone.',
    fixture: fix({
      items: [
        { id: 'owner', ergonomics: 10, slots: [reqSlot('need', ['gone'])] },
        { id: 'gone' },
        { id: 'alt', ergonomics: 1 },
      ],
      weapon: { slots: [slot('s', ['owner', 'alt'])] },
    }),
    request: { ...ERGO_ONLY, exclude_items: ['gone'] },
    feasible: [nk(), nk('alt')],
    maxScore: '1',
    maximizers: [nk('alt')],
    rejections: [
      { label: 'owner with empty required slot', build: nakedBuild([ROOT, 's', 'owner']), codes: ['MISSING_REQUIRED_SLOT'] },
      { label: 'owner with banned gone', build: nakedBuild([ROOT, 's', 'owner'], [iid(['s', 'owner']), 'need', 'gone']), codes: ['EXCLUDED_ITEM'] },
    ],
    derivation: `Mod-owned required occupancy equals the owner's presence, so need empty forces owner off (0 = x_owner). The receiver slot s remains: none or alt.
Feasible: none, alt. Scores 0 and 1, so alt wins. owner (+10) would have been best but is unreachable. This is not global infeasibility.`,
  }),

  defineCase({
    id: 'F02-conditional-required-slot-unavailable-candidate-owner-off',
    family: 2,
    subcases: ['empty_conditional_slot_owner_off', 'unavailable_candidates'],
    title: 'A required mod slot whose candidate has no legal source also forces its owner off',
    adrRefs: [...ADR, 'ADR 0002 principle 8'],
    prerequisites: 'rare has no offers and there is no stash or preset supply.',
    source: 'Weapon slot s:[owner, alt]; owner(+10) has required slot need:[rare]; rare(0, offers: []), alt(+1).',
    fixture: fix({
      items: [
        { id: 'owner', ergonomics: 10, slots: [reqSlot('need', ['rare'])] },
        { id: 'rare', offers: [] },
        { id: 'alt', ergonomics: 1 },
      ],
      weapon: { slots: [slot('s', ['owner', 'alt'])] },
    }),
    request: ERGO_ONLY,
    feasible: [nk(), nk('alt')],
    maxScore: '1',
    maximizers: [nk('alt')],
    rejections: [
      { label: 'owner with rare but no supply', build: nakedBuild([ROOT, 's', 'owner'], [iid(['s', 'owner']), 'need', 'rare']), codes: ['QUANTITY_CAP_EXCEEDED'] },
      { label: 'owner with empty required slot', build: nakedBuild([ROOT, 's', 'owner']), codes: ['MISSING_REQUIRED_SLOT'] },
    ],
    derivation: `Installing rare needs supply it does not have (cap 0 < 1), and owner cannot stand without its required child, so owner is off.
Feasible: none, alt; alt (+1) wins. The cap rejection and the empty-slot rejection are different codes.`,
  }),

  defineCase({
    id: 'F02-conditional-required-slot-with-surviving-candidate',
    family: 2,
    subcases: ['conditional_slot_surviving_candidate'],
    title: 'The owner is off only when every candidate of its required slot is unusable',
    adrRefs: ADR,
    prerequisites: 'owner requires a child from {gone, ok}; gone is banned, ok is available.',
    source: 'Weapon slot s:[owner, alt]; owner(+10) has required slot need:[gone, ok]; gone(0), ok(+3), alt(+1); request excludes gone.',
    fixture: fix({
      items: [
        { id: 'owner', ergonomics: 10, slots: [reqSlot('need', ['gone', 'ok'])] },
        { id: 'gone' },
        { id: 'ok', ergonomics: 3 },
        { id: 'alt', ergonomics: 1 },
      ],
      weapon: { slots: [slot('s', ['owner', 'alt'])] },
    }),
    request: { ...ERGO_ONLY, exclude_items: ['gone'] },
    feasible: [nk(), nk('alt'), nk('owner', 'ok')],
    maxScore: '13',
    maximizers: [nk('owner', 'ok')],
    rejections: [
      { label: 'owner alone', build: nakedBuild([ROOT, 's', 'owner']), codes: ['MISSING_REQUIRED_SLOT'] },
      { label: 'owner with banned gone', build: nakedBuild([ROOT, 's', 'owner'], [iid(['s', 'owner']), 'need', 'gone']), codes: ['EXCLUDED_ITEM'] },
    ],
    derivation: `need keeps one usable candidate, ok, so owner may be installed only together with ok: the owner subtree is exactly owner+ok.
Feasible: none, alt, owner+ok. Scores 0, 1, 10+3 = 13, so owner+ok wins.`,
  }),

  defineCase({
    id: 'F02-root-required-slot-satisfied-only-via-alternative',
    family: 2,
    subcases: ['empty_conditional_slot_owner_off', 'independent_required_checks'],
    title: 'The root requirement and the owner requirement are separate checks',
    adrRefs: ADR,
    prerequisites: 'The root required slot accepts owner (which cannot stand) and alt (which can).',
    source: 'Weapon slots sr (required):[owner, alt] and so:[x]; owner(+10) has required slot need:[gone]; alt(+1), x(+2); request excludes gone.',
    fixture: fix({
      items: [
        { id: 'owner', ergonomics: 10, slots: [reqSlot('need', ['gone'])] },
        { id: 'gone' },
        { id: 'alt', ergonomics: 1 },
        { id: 'x', ergonomics: 2 },
      ],
      weapon: { slots: [reqSlot('sr', ['owner', 'alt']), slot('so', ['x'])] },
    }),
    request: { ...ERGO_ONLY, exclude_items: ['gone'] },
    feasible: [nk('alt'), nk('alt', 'x')],
    maxScore: '3',
    maximizers: [nk('alt', 'x')],
    rejections: [
      { label: 'nothing installed', build: nakedBuild(), codes: ['MISSING_REQUIRED_SLOT'] },
      { label: 'x only', build: nakedBuild([ROOT, 'so', 'x']), codes: ['MISSING_REQUIRED_SLOT'] },
      { label: 'owner with empty need, plus x', build: nakedBuild([ROOT, 'sr', 'owner'], [ROOT, 'so', 'x']), codes: ['MISSING_REQUIRED_SLOT'] },
    ],
    derivation: `Root sr must be occupied: owner or alt. owner needs its own required slot, which is empty, so owner is off and sr is filled only by alt. so is optional: empty or x.
Feasible: alt, alt+x (none and x alone leave the root required slot empty). Scores 1 and 3; alt+x wins.`,
  }),

  defineCase({
    id: 'F02-unavailable-by-trader-level-flea-level-and-disabled-trader',
    family: 2,
    subcases: ['unavailable_candidates', 'market_gating'],
    title: 'Trader loyalty, a disabled trader and the flea player level each remove a candidate',
    adrRefs: [...ADR, 'ADR 0008 principle 4', 'GLOSSARY: Standalone Market Accessibility'],
    prerequisites: 'Items have a single offer each. trader_levels {prapor:1, skier:0}; player_level 10; flea available; stash empty.',
    source: `Optional slots s1..s5, one item each: t_hi (Prapor L2 cash, +1), t_ok (Prapor L1 cash, +2), t_off (Skier L1 cash, +4), f_lvl (flea from player level 20, +8), f_ok (flea from player level 5, +16).`,
    fixture: fix({
      items: [
        { id: 't_hi', ergonomics: 1, offers: trader(100, 'prapor', 2) },
        { id: 't_ok', ergonomics: 2, offers: trader(100, 'prapor', 1) },
        { id: 't_off', ergonomics: 4, offers: trader(100, 'skier', 1) },
        { id: 'f_lvl', ergonomics: 8, offers: [flea(100, 20)] },
        { id: 'f_ok', ergonomics: 16, offers: [flea(100, 5)] },
      ],
      weapon: { slots: [slot('s1', ['t_hi']), slot('s2', ['t_ok']), slot('s3', ['t_off']), slot('s4', ['f_lvl']), slot('s5', ['f_ok'])] },
    }),
    request: { ...ERGO_ONLY, trader_levels: { prapor: 1, skier: 0 }, player_level: 10 },
    feasible: [nk(), nk('t_ok'), nk('f_ok'), nk('t_ok', 'f_ok')],
    maxScore: '18',
    maximizers: [nk('t_ok', 'f_ok')],
    rejections: [
      { label: 't_hi needs loyalty 2', build: nakedBuild([ROOT, 's1', 't_hi']), codes: ['QUANTITY_CAP_EXCEEDED'] },
      { label: 't_off trader disabled', build: nakedBuild([ROOT, 's3', 't_off']), codes: ['QUANTITY_CAP_EXCEEDED'] },
      { label: 'f_lvl needs player level 20', build: nakedBuild([ROOT, 's4', 'f_lvl']), codes: ['QUANTITY_CAP_EXCEEDED'] },
    ],
    derivation: `Each item's only offer must be legal: Prapor L2 > unlocked 1 (t_hi out); Skier level 0 disables the trader (t_off out); flea needs player level >= 20 but the player is 10 (f_lvl out). t_ok (L1 <= 1) and f_ok (5 <= 10) stay.
Unavailable items have no supply, so any copy violates the cap. Feasible: all subsets of {t_ok, f_ok} = 4 projections; best t_ok+f_ok = 2+16 = 18.`,
  }),

  defineCase({
    id: 'F02-missing-trader-defaults-to-level-four',
    family: 2,
    subcases: ['unavailable_candidates', 'market_gating'],
    title: 'A trader absent from trader_levels is treated as unlocked to the default level',
    adrRefs: ['ADR 0008 principle 4', 'ADR 0013 section 3 item 2'],
    prerequisites: 'Interpretation 10 of the oracle: a missing trader defaults to level 4.',
    source: 'Optional slots s1:[m4], s2:[m5]; m4(+3) is a Mechanic level-4 cash offer, m5(+6) a Mechanic level-5 cash offer; trader_levels omitted.',
    fixture: fix({
      items: [
        { id: 'm4', ergonomics: 3, offers: trader(100, 'mechanic', 4) },
        { id: 'm5', ergonomics: 6, offers: trader(100, 'mechanic', 5) },
      ],
      weapon: { slots: [slot('s1', ['m4']), slot('s2', ['m5'])] },
    }),
    request: ERGO_ONLY,
    feasible: [nk(), nk('m4')],
    maxScore: '3',
    maximizers: [nk('m4')],
    rejections: [{ label: 'm5 needs level 5', build: nakedBuild([ROOT, 's2', 'm5']), codes: ['QUANTITY_CAP_EXCEEDED'] }],
    derivation: `With no trader_levels entry the unlocked level is the default 4: m4 (level 4 <= 4) is buyable, m5 (level 5 > 4) is not.
Feasible: none, m4. Best score 3.`,
    notes: ['Relies on interpretation 10 (missing trader -> level 4). The core of the family does not.'],
  }),

  defineCase({
    id: 'F02-flea-off-and-barter-off-leave-only-cash-offers',
    family: 2,
    subcases: ['unavailable_candidates', 'market_gating', 'barter_gating'],
    title: 'With the flea market off and barters off only the trader cash offer remains',
    adrRefs: ADR,
    prerequisites: 'flea_available false; barter_available defaults to false.',
    source: 'Optional slots s1:[fl flea], s2:[ba barter], s3:[bd dogtag barter], s4:[tr Prapor cash]; erg 1, 2, 4, 8.',
    fixture: marketFixture,
    request: { ...ERGO_ONLY, flea_available: false },
    feasible: [nk(), nk('tr')],
    maxScore: '8',
    maximizers: [nk('tr')],
    rejections: [
      { label: 'flea-only fl', build: nakedBuild([ROOT, 's1', 'fl']), codes: ['QUANTITY_CAP_EXCEEDED'] },
      { label: 'barter-only ba', build: nakedBuild([ROOT, 's2', 'ba']), codes: ['QUANTITY_CAP_EXCEEDED'] },
      { label: 'dogtag barter bd', build: nakedBuild([ROOT, 's3', 'bd']), codes: ['QUANTITY_CAP_EXCEEDED'] },
    ],
    derivation: `fl is flea-only and the flea is off; ba and bd are barter-only and barters are off. None has any legal source, so they are capped at 0 copies.
tr stays buyable. Feasible: none, tr. Best score 8.`,
  }),

  defineCase({
    id: 'F02-barter-on-dogtag-excluded',
    family: 2,
    subcases: ['unavailable_candidates', 'market_gating', 'barter_gating'],
    title: 'An enabled barter makes its item available, unless it needs a dogtag and dogtags are excluded',
    adrRefs: [...ADR, 'ADR 0009 principle 3'],
    prerequisites: 'flea off, barter_available true, barter_exclude_dogtags true; the ba barter totals 100 (count 1 x basePrice 100).',
    source: 'Same four items as the previous case: fl (flea), ba (barter), bd (dogtag barter), tr (cash).',
    fixture: marketFixture,
    request: { ...ERGO_ONLY, flea_available: false, barter_available: true, barter_exclude_dogtags: true },
    feasible: [nk(), nk('tr'), nk('ba'), nk('ba', 'tr')],
    maxScore: '10',
    maximizers: [nk('ba', 'tr')],
    rejections: [
      { label: 'bd needs a dogtag', build: nakedBuild([ROOT, 's3', 'bd']), codes: ['QUANTITY_CAP_EXCEEDED'] },
      { label: 'fl flea off', build: nakedBuild([ROOT, 's1', 'fl']), codes: ['QUANTITY_CAP_EXCEEDED'] },
    ],
    statChecks: [{ label: 'ba bought by barter', build: nakedBuild([ROOT, 's2', 'ba']), values: { spend: '1100' } }],
    derivation: `ba is now buyable through its barter (a legal standalone path, ADR 0009), bd is not (dogtag excluded), fl still needs the flea.
Feasible: all subsets of {tr, ba} = 4; best ba+tr = 2+8 = 10. ba costs its barter total 100 on top of the 1000 receiver, so spend = 1100.`,
  }),
];
