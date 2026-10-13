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

/**
 * fb(+2): 776 cash (Prapor L1, listed first) or a Prapor L1 barter of 155.1 x (avg24hPrice 5). The count is a fractional
 * value real Ref barters carry; its exact binary64 value sits slightly below the decimal 155.1 (derivation in the case).
 */
const fractionalBarterFixture = fix({
  items: [{
    id: 'fb',
    ergonomics: 2,
    offers: [
      traderOffer(776),
      { kind: 'barter', trader: 'prapor', level: 1, requirements: [{ itemId: 'i5', count: 155.1, avg24hPrice: 5 }] },
    ],
  }],
  weapon: { slots: [slot('s', ['fb'])] },
});

/**
 * lm(+2): 100 cash (Prapor L1, listed first) or a Prapor L1 barter that delivers a LOT of 3 for 2 x avg 80 + 1 x (avg null, base 30) = 190.
 * Four optional receiver slots hold it, so 0..4 copies are installable.
 */
const lotFixture = fix({
  items: [{
    id: 'lm',
    ergonomics: 2,
    offers: [
      traderOffer(100),
      {
        kind: 'barter',
        trader: 'prapor',
        level: 1,
        offeredCount: 3,
        requirements: [
          { itemId: 'i6', count: 2, avg24hPrice: 80, basePrice: 1 },
          { itemId: 'i7', count: 1, avg24hPrice: null, basePrice: 30 },
        ],
      },
    ],
  }],
  weapon: { slots: [slot('s1', ['lm']), slot('s2', ['lm']), slot('s3', ['lm']), slot('s4', ['lm'])] },
});
const lmBuild = (n: number) => nakedBuild(...['s1', 's2', 's3', 's4'].slice(0, n).map(s => [ROOT, s, 'lm'] as [string, string, string]));

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
          { instanceId: iid(['s1', 'M']), source: 'preset', charged: '0' },
          { instanceId: iid(['s2', 'M']), source: 'owned', charged: '0' },
          { instanceId: iid(['s3', 'M']), source: 'offer', via: 'trader', charged: '100' },
          { instanceId: iid(['s4', 'M']), source: 'offer', via: 'trader', charged: '100' },
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
          { instanceId: iid(['s10', 'M']), source: 'preset', charged: '0' },
          { instanceId: iid(['s1', 'M']), source: 'owned', charged: '0' },
          { instanceId: iid(['s2', 'M']), source: 'offer', via: 'trader', charged: '100' },
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
      { label: 'bt via the barter', build: nakedBuild([ROOT, 's', 'bt']), occurrences: [{ instanceId: iid(['s', 'bt']), source: 'offer', via: 'barter', charged: '2251' }] },
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
      { label: 'bt via cash', build: nakedBuild([ROOT, 's', 'bt']), occurrences: [{ instanceId: iid(['s', 'bt']), source: 'offer', via: 'trader', charged: '3000' }] },
    ],
    derivation: `Barters are off, so only the 3000 cash offer is legal: spend 1000 + 3000 = 4000, source trader. Feasible: none, bt; best bt = 2.`,
  }),

  defineCase({
    id: 'F09-fractional-barter-count-is-decoded-exactly',
    family: 9,
    subcases: ['barter_valuation', 'fractional_barter_count'],
    title: 'A fractional barter ingredient count is valued exactly: 155.1 x 5 falls just below a half and rounds down, undercutting a 776 cash offer',
    adrRefs: [...ADR, 'ADR 0009 principle 3 (barter valuation)', 'ADR 0010 section 2 (exact binary64 leaves, rounding after the exact total)'],
    prerequisites: 'barter_available true. Real barters carry fractional counts (every Ref barter: 7.52, 25.02, 155.1); the count is a binary64 leaf decoded exactly, never a decimal. Offers tie-break by list order, so the 776 cash offer listed first would win a tie.',
    source: 'Slot s:[fb]; fb(+2) is sold for 776 cash (Prapor L1, listed first) or by a Prapor L1 barter of 155.1 x (avg24hPrice 5). Default 1000 cash receiver.',
    fixture: fractionalBarterFixture,
    request: { ...ERGO_ONLY, barter_available: true },
    feasible: [nk(), nk('fb')],
    maxScore: '2',
    maximizers: [nk('fb')],
    statChecks: [{ label: 'fb via the barter', build: nakedBuild([ROOT, 's', 'fb']), values: { spend: '1775' } }],
    provenance: [
      { label: 'fb via the barter', build: nakedBuild([ROOT, 's', 'fb']), occurrences: [{ instanceId: iid(['s', 'fb']), source: 'offer', via: 'barter', charged: '775' }] },
    ],
    derivation: `Exact value of the count: Fraction(155.1) = 5457096110977843 / 2^45 (2^45 = 35184372088832), because 155.1 x 2^45 = 5457096110977843.2 and the nearest integer is ...843; the double is just BELOW the decimal 155.1.
Barter total = 5 x 5457096110977843 / 2^45 = 27285480554889215 / 2^45. The decimal reading gives 155.1 x 5 = 775.5, and 775.5 = 1551 x 2^44 / 2^45 = 27285480554889216 / 2^45, so the exact total is 775.5 - 2^-45, strictly below the half (binary64 multiplication rounds it up to exactly 775.5, which would round to 776).
Rounded half up: floor(total + 1/2) = floor(776 - 2^-45) = 775. With offeredCount 1 the barter lot costs 775 and the cash offer 776, so the barter is strictly cheaper and wins (an implementation that reads 775.5 would round to 776, tie with the earlier-listed cash offer, and report a trader source at 776). The build costs 1000 + 775 = 1775 with the barter as the recorded source.
Feasible: none, fb; best fb = 2.`,
    notes: ['Relies on ADR 0010 section 2: legal nonnegative barter totals round floor(total + 1/2) on the exact rational total of the decoded binary64 leaves.'],
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

  defineCase({
    id: 'F09-barter-lot-is-bought-whole',
    family: 9,
    subcases: ['barter_lot_granularity'],
    title: 'A barter delivering a lot of 3 is bought whole: the cheapest cover mixes the lot with single cash units and surplus units are unused',
    adrRefs: [...ADR, 'ADR 0009 principle 3 (barter valuation; the lot granularity is interpretation 1)', 'ADR 0002 (the hard budget counts out-of-pocket spend)'],
    prerequisites: 'Interpretation 1 of the oracle: offers are bought in whole lots (a trader or flea offer is a lot of 1, a barter delivers offeredCount units for its rounded total) and the cost of a paid deficit d is the exact minimum over lot counts of the total lot price subject to total units >= d. barter_available true; max_price 1260.',
    source: 'Optional slots s1..s4:[lm]; lm(+2) is sold for 100 cash (Prapor L1, listed first) or by a Prapor L1 barter delivering 3 units for 2 x avg 80 + 1 x (avg null, base 30). Receiver 1000. Score = 1000 x ergonomics - spend; spend capped at 1260.',
    fixture: lotFixture,
    request: { ...ERGO_MINUS_SPEND, barter_available: true, max_price: 1260 },
    feasible: [nk(), nk('lm'), nk('lm', 'lm'), nk('lm', 'lm', 'lm')],
    maxScore: '4810',
    maximizers: [nk('lm', 'lm', 'lm')],
    scores: [[nk(), '-1000'], [nk('lm'), '900'], [nk('lm', 'lm'), '2810'], [nk('lm', 'lm', 'lm'), '4810']],
    physicalBuildCount: 15,
    rejections: [{ label: 'four lm (spend 1290 > 1260)', build: lmBuild(4), codes: ['MAX_PRICE_EXCEEDED'] }],
    statChecks: [
      { label: 'one lm', build: lmBuild(1), values: { spend: '1100' } },
      { label: 'two lm (surplus unit unused)', build: lmBuild(2), values: { spend: '1190' } },
      { label: 'three lm (one whole lot)', build: lmBuild(3), values: { spend: '1190' } },
      { label: 'four lm (lot plus one single)', build: lmBuild(4), values: { spend: '1290' } },
    ],
    provenance: [
      {
        label: 'two lm: one lot of 3 with one unit unused',
        build: lmBuild(2),
        occurrences: [
          { instanceId: iid(['s1', 'lm']), source: 'offer', via: 'barter', charged: '190' },
          { instanceId: iid(['s2', 'lm']), source: 'offer', via: 'barter', charged: '0' },
        ],
      },
      {
        label: 'four lm: a single cash unit (listed first) then one lot of 3',
        build: lmBuild(4),
        occurrences: [
          { instanceId: iid(['s1', 'lm']), source: 'offer', via: 'trader', charged: '100' },
          { instanceId: iid(['s2', 'lm']), source: 'offer', via: 'barter', charged: '190' },
          { instanceId: iid(['s3', 'lm']), source: 'offer', via: 'barter', charged: '0' },
          { instanceId: iid(['s4', 'lm']), source: 'offer', via: 'barter', charged: '0' },
        ],
      },
    ],
    derivation: `Lot price of the barter: 2 x 80 + 1 x 30 (average absent, base used) = 190, a lot of 3 units; the single cash offer is a lot of 1 at 100. The cost of k copies is cover(k) = min over lot counts of (100 c + 190 b) with c + 3b >= k:
k = 0: 0.  k = 1: 100 (one cash; one lot is 190).  k = 2: min(2 x 100 = 200, one lot 190 with one unit unused) = 190.  k = 3: min(300, one lot 190) = 190.
k = 4: min(4 x 100 = 400, one lot + one cash = 290, two lots = 380 with two units unused) = 290.
Spend = 1000 + cover(k) = 1000, 1100, 1190, 1190, 1290; the cap 1260 rejects k = 4 only. Score = 2000 k - spend: k = 0: -1000; k = 1: 2000 - 1100 = 900; k = 2: 4000 - 1190 = 2810; k = 3: 6000 - 1190 = 4810. k = 3 is the unique maximum.
Physical builds with k <= 3 copies in four slots: C(4,0) + C(4,1) + C(4,2) + C(4,3) = 1 + 4 + 6 + 4 = 15.
Charging a fractional share (190/3 per unit, 63.33 each) would price k = 4 at 1000 + 4 x 190/3 = 1253.33 and wrongly admit it under the cap, and would price k = 1 at 1063.33 instead of the true 1100. Provenance: with two copies the lot of 3 is the cheapest cover (190); the first paid occurrence is charged the lot price and the second rides on it. With four copies the cover is {cash, lot}: lots are taken in offer-list order (cash is listed first), so s1 takes the cash unit (100), s2 opens the lot (190) and s3, s4 ride on it.`,
    notes: ['Relies on interpretation 1 (whole-lot purchasing): the ADRs state the barter valuation but not the lot granularity.'],
  }),
];
