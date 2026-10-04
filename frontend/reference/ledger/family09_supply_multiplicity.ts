// Family 9: supply multiplicity (ADR 0013 section 3 item 9, ADR 0002 principles 7 and 8,
// ADR 0008 principles 4 and 5, ADR 0010 section 4 item 9).
// installed_i copies need legal supply: selected-preset q_{b,i} + owned N_i + (paid copies, only when
// a legal standalone offer exists). An item without a legal standalone offer is capped by
// q_{b,i} + N_i; a stored price of 0 is not an offer. One installed copy never fills two slots.

import { defineCase, fix, flea, iid, nk, nakedBuild, presetBuild, ps, reqSlot, ROOT, slot, trader, traderOffer } from './dsl';
import type { LedgerCase } from './types';

const ADR = ['ADR 0002 principles 7 and 8', 'ADR 0008 principles 4 and 5', 'ADR 0010 section 4 item 9', 'ADR 0013 section 3 item 9'];
const ERGO_ONLY = { recoil_weight: 0 };
const ERGO_MINUS_SPEND = { ergo_weight: 1000, recoil_weight: 0, price_weight: 1000 };

/** T(+4) has no offers and fills two REQUIRED receiver slots; a preset exists but supplies no T. */
const twoRequiredSlots = fix({
  items: [{ id: 'T', ergonomics: 4, offers: [] }],
  weapon: { slots: [reqSlot('s1', ['T']), reqSlot('s2', ['T'])] },
  presets: [{ id: 'pre', weaponId: 'gun', components: [], offers: trader(1500) }],
});
/** bt(+2): 3000 cash (Prapor L1) or a Prapor L1 barter totalling 2 x 1000 + 250 + 0 + 0.5 = 2250.5. */
const barterFixture = fix({
  items: [{
    id: 'bt',
    ergonomics: 2,
    offers: [
      traderOffer(3000),
      {
        kind: 'barter',
        trader: 'prapor',
        level: 1,
        requirements: [
          { itemId: 'i1', count: 2, avg24hPrice: 1000, basePrice: 1 },
          { itemId: 'i2', count: 1, avg24hPrice: null, basePrice: 250 },
          { itemId: 'i3', count: 3, avg24hPrice: 0, basePrice: 999 },
          { itemId: 'i4', count: 1, avg24hPrice: 0.5 },
        ],
      },
    ],
  }],
  weapon: { slots: [slot('s', ['bt'])] },
});

const bothSlots = (base: 'naked' | 'pre') =>
  base === 'naked'
    ? nakedBuild([ROOT, 's1', 'T'], [ROOT, 's2', 'T'])
    : presetBuild('pre', [ROOT, 's1', 'T'], [ROOT, 's2', 'T']);

export const FAMILY_09: LedgerCase[] = [
  defineCase({
    id: 'F09-one-item-two-required-slots-insufficient-stock',
    family: 9,
    subcases: ['one_item_two_required_slots', 'required_copies_insufficient_stock'],
    title: 'One standalone-inaccessible item, two required slots, no preset copy and one owned copy: infeasible',
    adrRefs: [...ADR, 'ADR 0003 context item 3 (a single variable must not satisfy two required slots)'],
    prerequisites: 'T has no offers; the stash holds exactly one T; the preset supplies none. Two required slots accept only T.',
    source: 'Required receiver slots s1:[T], s2:[T]; T(+4, offers: []); preset pre (no T) 1500; owned_items [T].',
    fixture: twoRequiredSlots,
    request: { ...ERGO_ONLY, owned_items: ['T'] },
    feasible: [],
    maxScore: null,
    maximizers: [],
    rejections: [
      { label: 'two T on the naked base', build: bothSlots('naked'), codes: ['QUANTITY_CAP_EXCEEDED'] },
      { label: 'two T on the preset base', build: bothSlots('pre'), codes: ['QUANTITY_CAP_EXCEEDED'] },
      { label: 'one required slot left empty', build: nakedBuild([ROOT, 's1', 'T']), codes: ['MISSING_REQUIRED_SLOT'] },
    ],
    derivation: `Both required slots must hold T, so two occurrences are installed. Supply is preset 0 + owned 1 = 1 < 2 on either base and T cannot be bought, so the cap p_T <= 1 fails: certified infeasible.
Filling only one slot violates the other required slot. A presence-only model (one variable for T) would wrongly accept it.`,
    notes: [
      'Canonical case of ADR 0010 section 4 item 9. Fast (relaxed presence) must not claim exact optimal here: a Fast answer is at best incomplete/none, never optimal or certified.',
    ],
  }),

  defineCase({
    id: 'F09-required-copies-sufficient-owned-stock',
    family: 9,
    subcases: ['one_item_two_required_slots', 'required_copies_sufficient_stock'],
    title: 'With two owned copies the same two required slots can be filled on either base',
    adrRefs: ADR,
    prerequisites: 'As above with owned_items [T, T]. p = 0, so the two bases tie exactly.',
    source: 'twoRequiredSlots; owned_items [T, T].',
    fixture: twoRequiredSlots,
    request: { ...ERGO_ONLY, owned_items: ['T', 'T'] },
    feasible: [nk('T', 'T'), ps('pre', 'T', 'T')],
    maxScore: '8',
    maximizers: [nk('T', 'T'), ps('pre', 'T', 'T')],
    statChecks: [
      { label: 'naked with both owned copies', build: bothSlots('naked'), values: { spend: '1000' } },
      { label: 'preset with both owned copies', build: bothSlots('pre'), values: { spend: '1500' } },
    ],
    physicalBuildCount: 2,
    derivation: `Supply 0 + 2 = 2 >= 2 on both bases, so the only tree (T in s1 and s2) is legal on each: two projections, naked+TT and pre+TT.
Score = 2 x 4 = 8 for both; with price weight 0 the bases tie exactly. Spend is the base offer only (owned copies cost 0): 1000 and 1500.`,
  }),

  defineCase({
    id: 'F09-required-copies-preset-plus-owned-supply',
    family: 9,
    subcases: ['required_copies_sufficient_stock', 'mixed_supply'],
    title: 'One preset copy plus one owned copy supply two required slots, but only on the preset base',
    adrRefs: ADR,
    prerequisites: 'The preset contains one T; owned_items [T]. Supply depends on the selected base.',
    source: 'Required slots s1,s2:[T]; T(+4, offers: []); preset pre (T x1) 1500; owned_items [T].',
    fixture: fix({
      items: [{ id: 'T', ergonomics: 4, offers: [] }],
      weapon: { slots: [reqSlot('s1', ['T']), reqSlot('s2', ['T'])] },
      presets: [{ id: 'pre', weaponId: 'gun', components: [{ itemId: 'T', count: 1 }], offers: trader(1500) }],
    }),
    request: { ...ERGO_ONLY, owned_items: ['T'] },
    feasible: [ps('pre', 'T', 'T')],
    maxScore: '8',
    maximizers: [ps('pre', 'T', 'T')],
    rejections: [{ label: 'two T on the naked base', build: bothSlots('naked'), codes: ['QUANTITY_CAP_EXCEEDED'] }],
    derivation: `Naked base: supply 0 + 1 = 1 < 2, so TT is illegal. Preset base: 1 (preset) + 1 (owned) = 2 >= 2, so TT is legal. The preset is therefore the only feasible base here.
Feasible: pre+TT, score 8.`,
  }),

  defineCase({
    id: 'F09-mixed-preset-owned-paid-supply',
    family: 9,
    subcases: ['mixed_supply'],
    title: 'Preset supply, owned stock and paid copies combine; the base is paid once',
    adrRefs: [...ADR, 'ADR 0008 principle 5 (preset first, owned second, paid remainder)'],
    prerequisites: 'M is buyable at 100. Preset pre (M x1) costs 900, the naked receiver 1000; owned_items [M]. Score = 1000 x ergonomics - spend.',
    source: 'Optional slots s1..s4:[M]; M(+2).',
    fixture: fix({
      items: [{ id: 'M', ergonomics: 2, offers: trader(100) }],
      weapon: { slots: [slot('s1', ['M']), slot('s2', ['M']), slot('s3', ['M']), slot('s4', ['M'])] },
      presets: [{ id: 'pre', weaponId: 'gun', components: [{ itemId: 'M', count: 1 }], offers: trader(900) }],
    }),
    request: { ...ERGO_MINUS_SPEND, owned_items: ['M'] },
    feasible: [
      nk(), nk('M'), nk('M', 'M'), nk('M', 'M', 'M'), nk('M', 'M', 'M', 'M'),
      ps('pre'), ps('pre', 'M'), ps('pre', 'M', 'M'), ps('pre', 'M', 'M', 'M'), ps('pre', 'M', 'M', 'M', 'M'),
    ],
    maxScore: '6900',
    maximizers: [ps('pre', 'M', 'M', 'M', 'M')],
    scores: [
      [nk('M', 'M', 'M', 'M'), '6700'], [nk('M', 'M', 'M'), '4800'], [nk('M'), '1000'], [nk(), '-1000'],
      [ps('pre', 'M', 'M', 'M'), '5000'], [ps('pre', 'M', 'M'), '3100'], [ps('pre', 'M'), '1100'], [ps('pre'), '-900'],
    ],
    statChecks: [
      {
        label: 'preset: one preset, one owned, two paid',
        build: presetBuild('pre', [ROOT, 's1', 'M'], [ROOT, 's2', 'M'], [ROOT, 's3', 'M'], [ROOT, 's4', 'M']),
        values: { spend: '1100' },
      },
      {
        label: 'naked: one owned, three paid',
        build: nakedBuild([ROOT, 's1', 'M'], [ROOT, 's2', 'M'], [ROOT, 's3', 'M'], [ROOT, 's4', 'M']),
        values: { spend: '1300' },
      },
    ],
    provenance: [
      {
        label: 'preset: one preset, one owned, two paid',
        build: presetBuild('pre', [ROOT, 's1', 'M'], [ROOT, 's2', 'M'], [ROOT, 's3', 'M'], [ROOT, 's4', 'M']),
        occurrences: [
          { instanceId: iid(['s1', 'M']), source: 'preset', unitPrice: '0' },
          { instanceId: iid(['s2', 'M']), source: 'owned', unitPrice: '0' },
          { instanceId: iid(['s3', 'M']), source: 'offer', via: 'trader', unitPrice: '100' },
          { instanceId: iid(['s4', 'M']), source: 'offer', via: 'trader', unitPrice: '100' },
        ],
      },
    ],
    derivation: `With k copies installed, paid copies are max(0, k - preset - owned). Naked: spend 1000 + 100 x max(0, k-1). Preset: spend 900 + 100 x max(0, k-2).
Score = 2000k - spend. Naked k=0..4: -1000, 1000, 2900, 4800, 6700. Preset k=0..4: -900, 1100, 3100, 5000, 6900.
pre+MMMM = 6900 is the unique maximum: one copy from the preset, one owned, two bought, one base price.`,
  }),

  defineCase({
    id: 'F09-standalone-inaccessible-cap-is-exact',
    family: 9,
    subcases: ['standalone_inaccessible_cap'],
    title: 'A standalone-inaccessible item is capped at exactly preset supply plus owned stock',
    adrRefs: ADR,
    prerequisites: 'R has no offers; owned_items [R, R]; the preset contains one R; four slots could hold R.',
    source: 'Optional slots s1..s4:[R]; R(+2, offers: []); preset pre (R x1) 1500.',
    fixture: fix({
      items: [{ id: 'R', ergonomics: 2, offers: [] }],
      weapon: { slots: [slot('s1', ['R']), slot('s2', ['R']), slot('s3', ['R']), slot('s4', ['R'])] },
      presets: [{ id: 'pre', weaponId: 'gun', components: [{ itemId: 'R', count: 1 }], offers: trader(1500) }],
    }),
    request: { ...ERGO_ONLY, owned_items: ['R', 'R'] },
    feasible: [nk(), nk('R'), nk('R', 'R'), ps('pre'), ps('pre', 'R'), ps('pre', 'R', 'R'), ps('pre', 'R', 'R', 'R')],
    maxScore: '6',
    maximizers: [ps('pre', 'R', 'R', 'R')],
    scores: [[nk('R', 'R'), '4']],
    rejections: [
      { label: 'three R on the naked base (cap 2)', build: nakedBuild([ROOT, 's1', 'R'], [ROOT, 's2', 'R'], [ROOT, 's3', 'R']), codes: ['QUANTITY_CAP_EXCEEDED'] },
      {
        label: 'four R on the preset base (cap 3)',
        build: presetBuild('pre', [ROOT, 's1', 'R'], [ROOT, 's2', 'R'], [ROOT, 's3', 'R'], [ROOT, 's4', 'R']),
        codes: ['QUANTITY_CAP_EXCEEDED'],
      },
    ],
    derivation: `Cap = preset supply + owned: naked 0 + 2 = 2, preset 1 + 2 = 3. Naked allows 0..2 copies, preset 0..3 copies: 3 + 4 = 7 projections. One copy above the cap is rejected on each base.
Score = 2 x copies: pre+RRR = 6 is the unique maximum (naked+RR = 4).`,
  }),

  defineCase({
    id: 'F09-allocation-order-is-code-unit-not-natural',
    family: 9,
    subcases: ['mixed_supply', 'allocation_order'],
    title: 'Supply is allocated to occurrences in code-unit instanceId order: preset first, owned second, paid last',
    adrRefs: [...ADR, 'ADR 0008 principle 5 (deterministic per-occurrence provenance)', 'ADR 0013 section 4A'],
    prerequisites: 'Instance ids are path-derived (weapon_0/<slot>:<item>). In code-unit order weapon_0/s10:M precedes weapon_0/s1:M because "0" (0x30) < ":" (0x3A), and s1 precedes s2. Score = 1000 x ergonomics - spend.',
    source: 'Optional slots s1, s2, s10:[M]; M(+2) costs 100; receiver 1000; preset pre (M x1) 1500; owned_items [M].',
    fixture: fix({
      items: [{ id: 'M', ergonomics: 2, offers: trader(100) }],
      weapon: { slots: [slot('s1', ['M']), slot('s2', ['M']), slot('s10', ['M'])] },
      presets: [{ id: 'pre', weaponId: 'gun', components: [{ itemId: 'M', count: 1 }], offers: trader(1500) }],
    }),
    request: { ...ERGO_MINUS_SPEND, owned_items: ['M'] },
    feasible: [nk(), nk('M'), nk('M', 'M'), nk('M', 'M', 'M'), ps('pre'), ps('pre', 'M'), ps('pre', 'M', 'M'), ps('pre', 'M', 'M', 'M')],
    maxScore: '4800',
    maximizers: [nk('M', 'M', 'M')],
    scores: [
      [nk('M', 'M'), '2900'], [nk('M'), '1000'], [nk(), '-1000'],
      [ps('pre', 'M', 'M', 'M'), '4400'], [ps('pre', 'M', 'M'), '2500'], [ps('pre', 'M'), '500'], [ps('pre'), '-1500'],
    ],
    provenance: [
      {
        label: 'preset base with M in s1, s2 and s10',
        build: presetBuild('pre', [ROOT, 's1', 'M'], [ROOT, 's2', 'M'], [ROOT, 's10', 'M']),
        occurrences: [
          { instanceId: iid(['s10', 'M']), source: 'preset', unitPrice: '0' },
          { instanceId: iid(['s1', 'M']), source: 'owned', unitPrice: '0' },
          { instanceId: iid(['s2', 'M']), source: 'offer', via: 'trader', unitPrice: '100' },
        ],
      },
    ],
    statChecks: [{ label: 'preset base with three M', build: presetBuild('pre', [ROOT, 's1', 'M'], [ROOT, 's2', 'M'], [ROOT, 's10', 'M']), values: { spend: '1600' } }],
    derivation: `Spend with k copies: naked 1000 + 100 x max(0, k-1); preset 1500 + 100 x max(0, k-2). Score = 2000k - spend: naked -1000, 1000, 2900, 4800; preset -1500, 500, 2500, 4400. naked+MMM = 4800 is the unique maximum.
Provenance of the preset build with three M: the instance ids sort as weapon_0/s10:M < weapon_0/s1:M < weapon_0/s2:M (code-unit order: character 0 < colon), so the preset copy goes to s10, the owned copy to s1 and the single paid copy to s2 at 100; the build costs 1500 + 100 = 1600.`,
  }),

  defineCase({
    id: 'F09-barter-valuation-uses-avg-then-base-and-rounds-half-up',
    family: 9,
    subcases: ['barter_valuation'],
    title: 'A barter is valued as round(sum of count x (avg24hPrice ?? basePrice ?? 0)) and wins over a dearer cash offer',
    adrRefs: [...ADR, 'ADR 0009 principle 3 (barter valuation)'],
    prerequisites: 'barter_available true. A stored average of 0 is not nullish and stays 0; an absent average falls back to basePrice; the total rounds half up.',
    source: 'Slot s:[bt]; bt(+2) is sold for 3000 cash (Prapor L1) or by a Prapor L1 barter: 2 x avg 1000, 1 x (avg null, base 250), 3 x (avg 0, base 999), 1 x avg 0.5.',
    fixture: barterFixture,
    request: { ...ERGO_ONLY, barter_available: true },
    feasible: [nk(), nk('bt')],
    maxScore: '2',
    maximizers: [nk('bt')],
    statChecks: [{ label: 'bt via the barter', build: nakedBuild([ROOT, 's', 'bt']), values: { spend: '3251' } }],
    provenance: [
      { label: 'bt via the barter', build: nakedBuild([ROOT, 's', 'bt']), occurrences: [{ instanceId: iid(['s', 'bt']), source: 'offer', via: 'barter', unitPrice: '2251' }] },
    ],
    derivation: `Barter total = 2 x 1000 + 1 x 250 (average absent, base used) + 3 x 0 (average 0 is kept, base 999 ignored) + 1 x 0.5 = 2250.5; rounded half up: 2251. The cheaper legal offer is the barter (2251 < 3000), so bt costs 2251 on top of the 1000 receiver: 3251, with the barter as the recorded source.
Feasible: none, bt; best bt = 2.`,
  }),

  defineCase({
    id: 'F09-barter-off-uses-the-cash-offer',
    family: 9,
    subcases: ['barter_valuation'],
    title: 'With barters disabled the same item costs its cash offer',
    adrRefs: ADR,
    prerequisites: 'As above with barter_available omitted (false).',
    source: 'Same fixture as F09-barter-valuation-uses-avg-then-base-and-rounds-half-up.',
    fixture: barterFixture,
    request: ERGO_ONLY,
    feasible: [nk(), nk('bt')],
    maxScore: '2',
    maximizers: [nk('bt')],
    statChecks: [{ label: 'bt via cash', build: nakedBuild([ROOT, 's', 'bt']), values: { spend: '4000' } }],
    provenance: [
      { label: 'bt via cash', build: nakedBuild([ROOT, 's', 'bt']), occurrences: [{ instanceId: iid(['s', 'bt']), source: 'offer', via: 'trader', unitPrice: '3000' }] },
    ],
    derivation: `Barters are off, so only the 3000 cash offer is legal: spend 1000 + 3000 = 4000, source trader. Feasible: none, bt; best bt = 2.`,
  }),

  defineCase({
    id: 'F09-zero-stored-price-is-not-an-offer',
    family: 9,
    subcases: ['zero_stored_price_not_an_offer'],
    title: 'An item whose stored price is 0 and which has no other offer is not buyable',
    adrRefs: [...ADR, 'ADR 0013 section 4A (stored zero is not an offer)'],
    prerequisites: 'Interpretation 2 of the oracle: a stored trader or flea price <= 0 is not an offer. No stock.',
    source: 'Optional slots s1:[z1], s2:[z2], s3:[z3]; z1 has a Prapor cash offer at 0, z2 a flea offer at 0, z3 a cash offer at 100; +1, +2, +4.',
    fixture: fix({
      items: [
        { id: 'z1', ergonomics: 1, offers: [traderOffer(0)] },
        { id: 'z2', ergonomics: 2, offers: [flea(0)] },
        { id: 'z3', ergonomics: 4, offers: trader(100) },
      ],
      weapon: { slots: [slot('s1', ['z1']), slot('s2', ['z2']), slot('s3', ['z3'])] },
    }),
    request: ERGO_ONLY,
    feasible: [nk(), nk('z3')],
    maxScore: '4',
    maximizers: [nk('z3')],
    rejections: [
      { label: 'z1 (stored price 0)', build: nakedBuild([ROOT, 's1', 'z1']), codes: ['QUANTITY_CAP_EXCEEDED'] },
      { label: 'z2 (flea price 0)', build: nakedBuild([ROOT, 's2', 'z2']), codes: ['QUANTITY_CAP_EXCEEDED'] },
    ],
    derivation: `z1 and z2 have no legal offer (a stored 0 is not an offer) and no supply, so they are capped at 0 copies. z3 is buyable. Feasible: none, z3 (+4). No free acquisition is inferred from a zero price.`,
    notes: ['Relies on interpretation 2 (stored price <= 0 is not an offer).'],
  }),

  defineCase({
    id: 'F09-zero-cost-barter-is-a-legal-offer',
    family: 9,
    subcases: ['zero_cost_legal_offer'],
    title: 'A barter whose positive total rounds to zero is a legal zero-cost offer; a zero total is not an offer',
    adrRefs: [...ADR, 'ADR 0009 principle 3 (genuinely accessible zero-cost offers keep their provenance)'],
    prerequisites: 'Interpretation 2 of the oracle. barter_available true. zb needs 1 x basePrice 0.25 (total 1/4 rounds half up to 0); zn needs 1 x basePrice 0 (total 0).',
    source: 'Optional slots s1:[zb], s2:[zn]; zb(+2), zn(+3), each sold only by a Prapor level-1 barter.',
    fixture: fix({
      items: [
        { id: 'zb', ergonomics: 2, offers: [{ kind: 'barter', trader: 'prapor', level: 1, requirements: [{ count: 1, basePrice: 0.25 }] }] },
        { id: 'zn', ergonomics: 3, offers: [{ kind: 'barter', trader: 'prapor', level: 1, requirements: [{ count: 1, basePrice: 0 }] }] },
      ],
      weapon: { slots: [slot('s1', ['zb']), slot('s2', ['zn'])] },
    }),
    request: { ...ERGO_ONLY, barter_available: true },
    feasible: [nk(), nk('zb')],
    maxScore: '2',
    maximizers: [nk('zb')],
    rejections: [{ label: 'zn (zero barter total)', build: nakedBuild([ROOT, 's2', 'zn']), codes: ['QUANTITY_CAP_EXCEEDED'] }],
    statChecks: [{ label: 'zb at zero cost', build: nakedBuild([ROOT, 's1', 'zb']), values: { spend: '1000' } }],
    derivation: `zb: total 1 x 0.25 = 1/4 > 0, a real barter; rounded half up floor(1/4 + 1/2) = 0, so it is a legal offer at 0 RUB (spend stays 1000). zn: total 0 is not an offer, so zn is capped at 0 copies.
Feasible: none, zb (+2).`,
    notes: ['Relies on interpretation 2 (a positive barter total that rounds to 0 is legal; a zero total is not an offer).'],
  }),
];
