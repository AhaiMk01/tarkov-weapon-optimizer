// Family 1: conflicts (ADR 0013 section 3 item 1, ADR 0010 section 4 item 1, ADR 0003 principle 4).
// Template pair exclusion, the self-copy cap and physical slot conflicts are three different
// relations and are never conflated. Every score is the clamped ergonomics (recoil_weight 0).

import { defineCase, fix, iid, nk, nakedBuild, reqSlot, ROOT, slot } from './dsl';
import type { LedgerCase } from './types';

const ADR = ['ADR 0003 principle 4', 'ADR 0010 section 4 item 1', 'ADR 0013 section 3 item 1'];
const ERGO_ONLY = { recoil_weight: 0 };

export const FAMILY_01: LedgerCase[] = [
  defineCase({
    id: 'F01-template-pair-exclusion',
    family: 1,
    subcases: ['template_pair_exclusion'],
    title: 'Two conflicting template pairs exclude each other no matter which side lists the conflict',
    adrRefs: ADR,
    prerequisites: 'Receiver naked ergonomics 0; items default to a 100 RUB cash offer; weight e=1, r=0 so score = ergonomics.',
    source: 'Slots s1..s4 each take one template: a(+3, lists b), b(+4), c(+2), d(+1, lists c). Pair (a,b) is listed by the earlier item, pair (c,d) by the later one.',
    fixture: fix({
      items: [
        { id: 'a', ergonomics: 3, conflictingItemIds: ['b'] },
        { id: 'b', ergonomics: 4 },
        { id: 'c', ergonomics: 2 },
        { id: 'd', ergonomics: 1, conflictingItemIds: ['c'] },
      ],
      weapon: { slots: [slot('s1', ['a']), slot('s2', ['b']), slot('s3', ['c']), slot('s4', ['d'])] },
    }),
    request: ERGO_ONLY,
    feasible: [nk(), nk('a'), nk('b'), nk('c'), nk('d'), nk('a', 'c'), nk('a', 'd'), nk('b', 'c'), nk('b', 'd')],
    maxScore: '6',
    maximizers: [nk('b', 'c')],
    scores: [[nk('a', 'd'), '4'], [nk('a', 'c'), '5'], [nk('b', 'd'), '5'], [nk('b', 'c'), '6']],
    rejections: [
      { label: 'a and b together', build: nakedBuild([ROOT, 's1', 'a'], [ROOT, 's2', 'b']), codes: ['TEMPLATE_CONFLICT'] },
      { label: 'c and d together', build: nakedBuild([ROOT, 's3', 'c'], [ROOT, 's4', 'd']), codes: ['TEMPLATE_CONFLICT'] },
      { label: 'everything', build: nakedBuild([ROOT, 's1', 'a'], [ROOT, 's2', 'b'], [ROOT, 's3', 'c'], [ROOT, 's4', 'd']), codes: ['TEMPLATE_CONFLICT'] },
    ],
    derivation: `Each slot is empty or holds its one template, giving 16 trees. A pair conflict is symmetric: it is violated exactly when both templates are installed, whichever one lists the other.
Pair (a,b) allows {none, a, b} (3 states, ab is out); pair (c,d) allows {none, c, d} (3 states, cd is out). The groups are independent, so 3 x 3 = 9 projections.
Scores are sums of ergonomics: b+c = 4+2 = 6 is the unique maximum (b+d = 5, a+c = 5, a+d = 4).`,
  }),

  defineCase({
    id: 'F01-copies-legal-when-partner-absent',
    family: 1,
    subcases: ['template_pair_exclusion', 'copies_without_partner'],
    title: 'A template conflict forbids A and B together but not A twice or B twice',
    adrRefs: [...ADR, 'ADR 0003 context item 2'],
    prerequisites: 'Two physical slots both accept a or b; a lists b as a conflict.',
    source: 'Weapon slots s1:[a,b] and s2:[a,b]; a(+3, lists b), b(+4).',
    fixture: fix({
      items: [{ id: 'a', ergonomics: 3, conflictingItemIds: ['b'] }, { id: 'b', ergonomics: 4 }],
      weapon: { slots: [slot('s1', ['a', 'b']), slot('s2', ['a', 'b'])] },
    }),
    request: ERGO_ONLY,
    feasible: [nk(), nk('a'), nk('b'), nk('a', 'a'), nk('b', 'b')],
    maxScore: '8',
    maximizers: [nk('b', 'b')],
    scores: [[nk('a', 'a'), '6'], [nk('b'), '4'], [nk('a'), '3']],
    rejections: [
      { label: 'a in s1 and b in s2', build: nakedBuild([ROOT, 's1', 'a'], [ROOT, 's2', 'b']), codes: ['TEMPLATE_CONFLICT'] },
      { label: 'b in s1 and a in s2', build: nakedBuild([ROOT, 's1', 'b'], [ROOT, 's2', 'a']), codes: ['TEMPLATE_CONFLICT'] },
    ],
    accepts: [
      { label: 'two copies of a', build: nakedBuild([ROOT, 's1', 'a'], [ROOT, 's2', 'a']) },
      { label: 'two copies of b', build: nakedBuild([ROOT, 's1', 'b'], [ROOT, 's2', 'b']) },
    ],
    physicalBuildCount: 7,
    derivation: `Each slot is empty, a or b: 9 trees. The mixed trees (a,b) and (b,a) hold both templates and are out. The rest project to: none, a (in s1 or s2), b (in s1 or s2), aa, bb.
So 5 projections and 1+2+2+1+1 = 7 accepted physical builds. The naive pairwise sum x_a + x_b <= 1 would wrongly reject aa and bb.
Scores: aa = 6, bb = 8, so bb is the unique maximum.`,
  }),

  defineCase({
    id: 'F01-template-conflict-across-branches',
    family: 1,
    subcases: ['template_pair_exclusion'],
    title: 'A template conflict applies across different branches of the build, not only between siblings',
    adrRefs: [...ADR, 'ADR 0003 principle 4 (presence indicators are global y_A + y_B <= 1)'],
    prerequisites: 'a and b sit under two different hosts; a lists b.',
    source: 'Weapon slots s1:[h1], s2:[h2]; h1(+1) has slot c1:[a]; h2(+2) has slot c2:[b]; a(+3, lists b), b(+4).',
    fixture: fix({
      items: [
        { id: 'h1', ergonomics: 1, slots: [slot('c1', ['a'])] },
        { id: 'h2', ergonomics: 2, slots: [slot('c2', ['b'])] },
        { id: 'a', ergonomics: 3, conflictingItemIds: ['b'] },
        { id: 'b', ergonomics: 4 },
      ],
      weapon: { slots: [slot('s1', ['h1']), slot('s2', ['h2'])] },
    }),
    request: ERGO_ONLY,
    feasible: [nk(), nk('h1'), nk('a', 'h1'), nk('h2'), nk('b', 'h2'), nk('h1', 'h2'), nk('a', 'h1', 'h2'), nk('b', 'h1', 'h2')],
    maxScore: '7',
    maximizers: [nk('b', 'h1', 'h2')],
    scores: [[nk('a', 'h1', 'h2'), '6'], [nk('b', 'h2'), '6']],
    rejections: [
      {
        label: 'a under h1 and b under h2',
        build: nakedBuild([ROOT, 's1', 'h1'], [ROOT, 's2', 'h2'], [iid(['s1', 'h1']), 'c1', 'a'], [iid(['s2', 'h2']), 'c2', 'b']),
        codes: ['TEMPLATE_CONFLICT'],
      },
    ],
    physicalBuildCount: 8,
    derivation: `h1 holds {none, h1, h1+a} and h2 holds {none, h2, h2+b}: 9 trees; only the one with both a and b is out, whichever branches they sit in. 8 projections, each from one build.
Scores: h1+h2+b = 1+2+4 = 7 is the unique maximum (h1+a+h2 = 6, h2+b = 6); the excluded a+b build would have scored 10.`,
  }),

  defineCase({
    id: 'F01-self-copy-cap',
    family: 1,
    subcases: ['self_copy_cap'],
    title: 'A template that lists itself may be installed at most once; an unrelated template may repeat',
    adrRefs: ADR,
    prerequisites: 'c lists itself in conflictingItemIds; d lists nothing. This is the self-copy cap, a different code from a pair conflict.',
    source: 'Weapon slots s1:[c], s2:[c], s3:[d], s4:[d]; c(+2, self-conflict), d(+1).',
    fixture: fix({
      items: [{ id: 'c', ergonomics: 2, conflictingItemIds: ['c'] }, { id: 'd', ergonomics: 1 }],
      weapon: { slots: [slot('s1', ['c']), slot('s2', ['c']), slot('s3', ['d']), slot('s4', ['d'])] },
    }),
    request: ERGO_ONLY,
    feasible: [nk(), nk('c'), nk('d'), nk('d', 'd'), nk('c', 'd'), nk('c', 'd', 'd')],
    maxScore: '4',
    maximizers: [nk('c', 'd', 'd')],
    scores: [[nk('d', 'd'), '2'], [nk('c', 'd'), '3']],
    rejections: [
      { label: 'two copies of c', build: nakedBuild([ROOT, 's1', 'c'], [ROOT, 's2', 'c']), codes: ['SELF_CONFLICT_COPY_CAP'] },
      { label: 'two copies of c plus d', build: nakedBuild([ROOT, 's1', 'c'], [ROOT, 's2', 'c'], [ROOT, 's3', 'd']), codes: ['SELF_CONFLICT_COPY_CAP'] },
    ],
    accepts: [{ label: 'two copies of d', build: nakedBuild([ROOT, 's3', 'd'], [ROOT, 's4', 'd']) }],
    derivation: `c may appear 0 or 1 times (cc is the self-conflict cap), d may appear 0, 1 or 2 times: 2 x 3 = 6 projections.
Best score: one c (+2) plus two d (+1 each) = 4. The self cap is not a pair conflict, so the only violation code is SELF_CONFLICT_COPY_CAP.`,
  }),

  defineCase({
    id: 'F01-slot-conflict-blocks-host-rail',
    family: 1,
    subcases: ['physical_slot_conflict'],
    title: 'A slot conflict blocks the occupancy of a physical slot, not the items that could fill it',
    adrRefs: [...ADR, 'GLOSSARY: Slot-Occupancy Conflict'],
    prerequisites: 'blocker lists the template slot id rail; host owns that slot. Slot ids are unique per template.',
    source: 'Weapon slots s1:[blocker], s2:[host]; host has slot rail:[x]. blocker(+5, blocks slot rail), host(0), x(+9).',
    fixture: fix({
      items: [
        { id: 'blocker', ergonomics: 5, conflictingSlotIds: ['rail'] },
        { id: 'host', slots: [slot('rail', ['x'])] },
        { id: 'x', ergonomics: 9 },
      ],
      weapon: { slots: [slot('s1', ['blocker']), slot('s2', ['host'])] },
    }),
    request: ERGO_ONLY,
    feasible: [nk(), nk('host'), nk('host', 'x'), nk('blocker'), nk('blocker', 'host')],
    maxScore: '9',
    maximizers: [nk('host', 'x')],
    scores: [[nk('blocker'), '5'], [nk('blocker', 'host'), '5'], [nk('host'), '0']],
    rejections: [
      {
        label: 'blocker with x on the blocked rail',
        build: nakedBuild([ROOT, 's1', 'blocker'], [ROOT, 's2', 'host'], [iid(['s2', 'host']), 'rail', 'x']),
        codes: ['SLOT_CONFLICT'],
      },
    ],
    accepts: [{ label: 'blocker with an empty rail', build: nakedBuild([ROOT, 's1', 'blocker'], [ROOT, 's2', 'host']) }],
    derivation: `Trees: s1 in {none, blocker}, s2 in {none, host with empty rail, host with x}: 2 x 3 = 6. Only (blocker, host with x) occupies the blocked rail, so it is the one illegal build.
Feasible projections: none, host, host+x, blocker, blocker+host (rail empty). blocker+host+x is out.
Scores: host+x = 9 beats blocker+host = 5. blocker is still legal in other builds, so a slot conflict is not a global item ban.`,
  }),

  defineCase({
    id: 'F01-slot-conflict-blocks-every-physical-occurrence',
    family: 1,
    subcases: ['physical_slot_conflict'],
    title: 'A raw slot id blocks every matching physical occurrence on the weapon',
    adrRefs: [...ADR, 'ADR 0003 principle 4 (slot conflicts)'],
    prerequisites: 'host template is installable in two weapon slots, so two physical rail slots can exist; blocker lists rail.',
    source: 'Weapon slots s1:[blocker], s2:[host], s3:[host]; host(+1) has slot rail:[x]; blocker(+7, blocks rail), x(+3).',
    fixture: fix({
      items: [
        { id: 'blocker', ergonomics: 7, conflictingSlotIds: ['rail'] },
        { id: 'host', ergonomics: 1, slots: [slot('rail', ['x'])] },
        { id: 'x', ergonomics: 3 },
      ],
      weapon: { slots: [slot('s1', ['blocker']), slot('s2', ['host']), slot('s3', ['host'])] },
    }),
    request: ERGO_ONLY,
    feasible: [
      nk(), nk('host'), nk('host', 'x'), nk('host', 'host'), nk('host', 'host', 'x'), nk('host', 'host', 'x', 'x'),
      nk('blocker'), nk('blocker', 'host'), nk('blocker', 'host', 'host'),
    ],
    maxScore: '9',
    maximizers: [nk('blocker', 'host', 'host')],
    scores: [[nk('host', 'host', 'x', 'x'), '8'], [nk('blocker', 'host'), '8'], [nk('blocker'), '7']],
    rejections: [
      {
        label: 'blocker with x only on the second host',
        build: nakedBuild([ROOT, 's1', 'blocker'], [ROOT, 's2', 'host'], [ROOT, 's3', 'host'], [iid(['s3', 'host']), 'rail', 'x']),
        codes: ['SLOT_CONFLICT'],
      },
    ],
    physicalBuildCount: 13,
    derivation: `s2 and s3 each hold {none, host, host+x}: 9 combinations. Without blocker all 9 are legal, projecting to: none, host (2 builds), host+x (2), hostx2 (1), host2+x (2), host2+xx (1) = 9 builds.
With blocker both physical rails are blocked, so no x may sit anywhere: blocker, blocker+host (2 builds), blocker+host2 (1) = 4 builds. Total 13 builds, 9 projections.
Scores: host=+1, x=+3, blocker=+7. blocker+host+host = 9 is the unique maximum; host2+xx = 8, blocker+host = 8.`,
  }),

  defineCase({
    id: 'F01-slot-conflict-against-a-required-slot-bans-the-blocker',
    family: 1,
    subcases: ['physical_slot_conflict'],
    title: 'A blocker whose slot conflict hits a required slot can never be installed',
    adrRefs: [...ADR, 'ADR 0003 principle 3 (required occupancy)'],
    prerequisites: 'sa is a required receiver slot that only p fits; blocker lists the template slot id sa.',
    source: 'Receiver slots sa (required):[p] and sc:[blocker]; p(+3), blocker(+10, blocks slot sa).',
    fixture: fix({
      items: [{ id: 'p', ergonomics: 3 }, { id: 'blocker', ergonomics: 10, conflictingSlotIds: ['sa'] }],
      weapon: { slots: [reqSlot('sa', ['p']), slot('sc', ['blocker'])] },
    }),
    request: ERGO_ONLY,
    feasible: [nk('p')],
    maxScore: '3',
    maximizers: [nk('p')],
    rejections: [
      { label: 'blocker with p in the blocked required slot', build: nakedBuild([ROOT, 'sa', 'p'], [ROOT, 'sc', 'blocker']), codes: ['SLOT_CONFLICT'] },
      { label: 'blocker with the required slot empty', build: nakedBuild([ROOT, 'sc', 'blocker']), codes: ['MISSING_REQUIRED_SLOT'] },
      { label: 'nothing installed', build: nakedBuild(), codes: ['MISSING_REQUIRED_SLOT'] },
    ],
    derivation: `sa must be occupied (root required slot) and the blocker forbids any occupancy of sa, so a build with the blocker has either an occupied sa (slot conflict) or an empty required sa (missing required slot). The blocker is therefore never installed.
Feasible: p alone, score 3. The better blocker (+10) is unreachable; the two relations stay distinct codes.`,
  }),

  defineCase({
    id: 'F01-legal-alternative-placement',
    family: 1,
    subcases: ['physical_slot_conflict', 'legal_alternative_placement'],
    title: 'When the first slot is blocked the part still has a legal alternative placement',
    adrRefs: [...ADR, 'ADR 0003 principle 4'],
    prerequisites: 'p fits slot sa or slot sb; blocker lists the template slot id sa only.',
    source: 'Weapon slots sa:[p], sb:[p], sc:[blocker]; p(+3), blocker(+10, blocks slot sa).',
    fixture: fix({
      items: [{ id: 'p', ergonomics: 3 }, { id: 'blocker', ergonomics: 10, conflictingSlotIds: ['sa'] }],
      weapon: { slots: [slot('sa', ['p']), slot('sb', ['p']), slot('sc', ['blocker'])] },
    }),
    request: ERGO_ONLY,
    feasible: [nk(), nk('p'), nk('p', 'p'), nk('blocker'), nk('blocker', 'p')],
    maxScore: '13',
    maximizers: [nk('blocker', 'p')],
    scores: [[nk('p', 'p'), '6'], [nk('blocker'), '10']],
    rejections: [
      { label: 'blocker with p in the blocked slot sa', build: nakedBuild([ROOT, 'sc', 'blocker'], [ROOT, 'sa', 'p']), codes: ['SLOT_CONFLICT'] },
      { label: 'blocker with p in both slots', build: nakedBuild([ROOT, 'sc', 'blocker'], [ROOT, 'sa', 'p'], [ROOT, 'sb', 'p']), codes: ['SLOT_CONFLICT'] },
    ],
    accepts: [{ label: 'blocker with p in the alternative slot sb', build: nakedBuild([ROOT, 'sc', 'blocker'], [ROOT, 'sb', 'p']) }],
    physicalBuildCount: 6,
    derivation: `Without blocker, p sits in sa and/or sb: none, p (2 builds), pp (1) = 4 builds.
With blocker, sa must stay empty: blocker alone and blocker with p in sb (the legal alternative) = 2 builds; blocker with p in sa, or in both, is illegal.
Projections: none, p, pp, blocker, blocker+p. Scores: blocker+p = 10+3 = 13 is the unique maximum (pp = 6): the part survives through the alternative slot, so the conflict does not ban p.`,
  }),
];

