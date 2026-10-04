// Family 7: owned-stock monotonicity (ADR 0013 section 3 item 7, ADR 0010 section 4 item 7).
// Growing the stash N -> N + delta must satisfy, on one fixed fixture and request:
//   (a) same-build spend does not rise:           spend(B | N + delta) <= spend(B | N)
//   (b) the feasible set grows:                   F(N) is contained in F(N + delta)
//   (c) the maximum score does not drop:          S*(N + delta) >= S*(N)   (an empty set counts as -infinity)
// These are relations BETWEEN the three paired cases below, checked in ledger.test.ts. They do not
// claim the chosen optimum's spend cannot rise: F07-stock-one-rare shows it rising.

import { defineCase, fix, iid, nk, nakedBuild, reqSlot, ROOT, slot, trader } from './dsl';
import type { LedgerCase, MonotonicityRelation } from './types';

const ADR = ['ADR 0008 principle 5', 'ADR 0010 section 4 item 7', 'ADR 0013 section 3 item 7'];

/**
 * Receiver slot sp:[P, Q] (receiver 1000 RUB, e=1, r=0, p=0 so the score is the ergonomics).
 *   P(+10, 200 RUB): required slot r:[rare], optional sb:[big], optional sx:[rare]
 *   rare(+1): no offers, so only stock can supply it
 *   big(+6, 5000 RUB)
 *   Q(+1, 100 RUB): optional slot qc:[common]
 *   common(+2, 300 RUB)
 */
const fixture = fix({
  items: [
    { id: 'P', ergonomics: 10, offers: trader(200), slots: [reqSlot('r', ['rare']), slot('sb', ['big']), slot('sx', ['rare'])] },
    { id: 'rare', ergonomics: 1, offers: [] },
    { id: 'big', ergonomics: 6, offers: trader(5000) },
    { id: 'Q', ergonomics: 1, offers: trader(100), slots: [slot('qc', ['common'])] },
    { id: 'common', ergonomics: 2, offers: trader(300) },
  ],
  weapon: { slots: [slot('sp', ['P', 'Q'])] },
});

const REQUEST = { recoil_weight: 0 };
const qCommon = nakedBuild([ROOT, 'sp', 'Q'], [iid(['sp', 'Q']), 'qc', 'common']);
const pRareBig = nakedBuild([ROOT, 'sp', 'P'], [iid(['sp', 'P']), 'r', 'rare'], [iid(['sp', 'P']), 'sb', 'big']);

export const FAMILY_07: LedgerCase[] = [
  defineCase({
    id: 'F07-stock-empty',
    family: 7,
    subcases: ['monotonicity_baseline'],
    title: 'Empty stash baseline: the rare part cannot be supplied, so P is unusable',
    adrRefs: ADR,
    prerequisites: 'Fixture of this family; owned_items omitted (zero stock).',
    source: 'See the fixture comment: P needs rare, rare has no offers, common is buyable at 300.',
    fixture,
    request: REQUEST,
    feasible: [nk(), nk('Q'), nk('Q', 'common')],
    maxScore: '3',
    maximizers: [nk('Q', 'common')],
    scores: [[nk('Q'), '1']],
    statChecks: [{ label: 'Q with a bought common', build: qCommon, values: { spend: '1400' } }],
    derivation: `P requires rare in slot r, rare has no offer and the stash is empty, so P cannot stand. The remaining trees: none, Q, Q+common.
Scores 0, 1, 1+2 = 3. The optimum Q+common spends 1000 + 100 + 300 = 1400.`,
  }),

  defineCase({
    id: 'F07-stock-one-rare',
    family: 7,
    subcases: ['spend_nonincrease', 'feasible_set_expansion', 'max_score_nondecrease', 'optimum_spend_may_rise'],
    title: 'One owned rare opens P: the feasible set grows and the optimum becomes more expensive',
    adrRefs: [...ADR, 'ADR 0013 section 3 item 7 (not a claim that the optimum spend cannot rise)'],
    prerequisites: 'owned_items [rare]; everything else as F07-stock-empty.',
    source: 'Same fixture and request as F07-stock-empty plus one owned rare.',
    fixture,
    request: { ...REQUEST, owned_items: ['rare'] },
    feasible: [nk(), nk('Q'), nk('Q', 'common'), nk('P', 'rare'), nk('P', 'rare', 'big')],
    maxScore: '17',
    maximizers: [nk('P', 'rare', 'big')],
    scores: [[nk('P', 'rare'), '11']],
    statChecks: [
      { label: 'P, rare from stock, big bought', build: pRareBig, values: { spend: '6200' } },
      { label: 'Q with a bought common (unchanged)', build: qCommon, values: { spend: '1400' } },
    ],
    derivation: `One rare in stock fills P's required slot r (cap 0 + 1 >= 1); a second rare for the optional slot sx would exceed the cap, so P always carries exactly one rare.
New projections: P+rare (10+1 = 11) and P+rare+big (10+1+6 = 17). Old ones stay feasible. Maximum 17 (was 3).
The new optimum spends 1000 + 200 (P) + 0 (rare, owned) + 5000 (big) = 6200, up from 1400: the optimum's spend may rise when the feasible set grows.`,
  }),

  defineCase({
    id: 'F07-stock-two-rare-and-common',
    family: 7,
    subcases: ['spend_nonincrease', 'feasible_set_expansion', 'max_score_nondecrease'],
    title: 'Two owned rares and an owned common: same builds get cheaper, new builds appear',
    adrRefs: ADR,
    prerequisites: 'owned_items [rare, rare, common]; everything else as before.',
    source: 'Same fixture and request; the stash adds a second rare and one common.',
    fixture,
    request: { ...REQUEST, owned_items: ['rare', 'rare', 'common'] },
    feasible: [
      nk(), nk('Q'), nk('Q', 'common'), nk('P', 'rare'), nk('P', 'rare', 'big'), nk('P', 'rare', 'rare'), nk('P', 'rare', 'rare', 'big'),
    ],
    maxScore: '18',
    maximizers: [nk('P', 'rare', 'rare', 'big')],
    scores: [[nk('P', 'rare', 'rare'), '12'], [nk('P', 'rare', 'big'), '17']],
    statChecks: [
      { label: 'Q with the now-owned common', build: qCommon, values: { spend: '1100' } },
      { label: 'P, rare, big (spend unchanged)', build: pRareBig, values: { spend: '6200' } },
    ],
    derivation: `The second rare fills P's optional slot sx, adding P+rare+rare (10+1+1 = 12) and P+rare+rare+big (18): 7 projections in all, a superset of the previous 5.
Maximum 18. The same build Q+common drops from 1400 to 1100 because the common is owned; P+rare+big keeps spending 6200 (its rare was already owned).`,
  }),
];

export const MONOTONICITY_F07: readonly MonotonicityRelation[] = [
  { smaller: 'F07-stock-empty', larger: 'F07-stock-one-rare' },
  { smaller: 'F07-stock-one-rare', larger: 'F07-stock-two-rare-and-common' },
  { smaller: 'F07-stock-empty', larger: 'F07-stock-two-rare-and-common' },
];
