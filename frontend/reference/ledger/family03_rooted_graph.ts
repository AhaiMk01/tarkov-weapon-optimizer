// Family 3: rooted graph and acyclicity (ADR 0013 section 3 item 3, ADR 0003 principles 2 and 3).
// Every installed occurrence traces an unbroken instance path to the receiver; no template repeats
// along one root-to-leaf path (siblings and cousins may repeat). Slot ids are unique per template.

import { defineCase, fix, iid, nk, nakedBuild, reqSlot, ROOT, slot } from './dsl';
import type { LedgerCase } from './types';

const ADR = ['ADR 0003 principles 2 and 3', 'ADR 0010 section 4 item 3', 'ADR 0013 section 3 item 3'];
const ERGO_ONLY = { recoil_weight: 0 };

export const FAMILY_03: LedgerCase[] = [
  defineCase({
    id: 'F03-descendant-removal-chain',
    family: 3,
    subcases: ['descendant_removal'],
    title: 'A descendant exists only under an installed parent, all the way down a chain',
    adrRefs: ADR,
    prerequisites: 'A chain receiver -> p -> c -> g in which every slot is optional.',
    source: 'Weapon slot sp:[p]; p has slot pc:[c]; c has slot cg:[g]; p(+1), c(+2), g(+4).',
    fixture: fix({
      items: [
        { id: 'p', ergonomics: 1, slots: [slot('pc', ['c'])] },
        { id: 'c', ergonomics: 2, slots: [slot('cg', ['g'])] },
        { id: 'g', ergonomics: 4 },
      ],
      weapon: { slots: [slot('sp', ['p'])] },
    }),
    request: ERGO_ONLY,
    feasible: [nk(), nk('p'), nk('p', 'c'), nk('p', 'c', 'g')],
    maxScore: '7',
    maximizers: [nk('p', 'c', 'g')],
    scores: [[nk('p'), '1'], [nk('p', 'c'), '3']],
    rejections: [
      { label: 'g under a missing c', build: nakedBuild([iid(['sp', 'p'], ['pc', 'c']), 'cg', 'g']), codes: ['UNKNOWN_PARENT_INSTANCE'] },
      {
        label: 'c and g with p absent',
        build: nakedBuild([iid(['sp', 'p']), 'pc', 'c'], [iid(['sp', 'p'], ['pc', 'c']), 'cg', 'g']),
        codes: ['UNKNOWN_PARENT_INSTANCE', 'UNROOTED_PLACEMENT'],
      },
    ],
    physicalBuildCount: 4,
    derivation: `Each level exists only under its parent, so the trees are exactly: none, p, p+c, p+c+g. A deeper part never appears without every ancestor.
Scores are sums: p+c+g = 1+2+4 = 7 is the maximum. g without c has an unknown parent; c and g without p leave c with an unknown parent and g hanging from an unrooted c.`,
  }),

  defineCase({
    id: 'F03-fixed-point-removal',
    family: 3,
    subcases: ['descendant_removal', 'fixed_point_removal'],
    title: 'An impossible grandchild requirement removes the child, then the parent, and the alternative path survives',
    adrRefs: [...ADR, 'ADR 0013 section 4A (fixed-point removal)'],
    prerequisites: 'p requires c, c requires g, and g is banned.',
    source: 'Weapon slot sp:[p, q]; p(+9) has required slot pc:[c]; c(+9) has required slot cg:[g]; g(0) is banned; q(+1).',
    fixture: fix({
      items: [
        { id: 'p', ergonomics: 9, slots: [reqSlot('pc', ['c'])] },
        { id: 'c', ergonomics: 9, slots: [reqSlot('cg', ['g'])] },
        { id: 'g' },
        { id: 'q', ergonomics: 1 },
      ],
      weapon: { slots: [slot('sp', ['p', 'q'])] },
    }),
    request: { ...ERGO_ONLY, exclude_items: ['g'] },
    feasible: [nk(), nk('q')],
    maxScore: '1',
    maximizers: [nk('q')],
    rejections: [
      { label: 'p with empty required slot', build: nakedBuild([ROOT, 'sp', 'p']), codes: ['MISSING_REQUIRED_SLOT'] },
      { label: 'p and c with empty cg', build: nakedBuild([ROOT, 'sp', 'p'], [iid(['sp', 'p']), 'pc', 'c']), codes: ['MISSING_REQUIRED_SLOT'] },
      {
        label: 'p, c and the banned g',
        build: nakedBuild([ROOT, 'sp', 'p'], [iid(['sp', 'p']), 'pc', 'c'], [iid(['sp', 'p'], ['pc', 'c']), 'cg', 'g']),
        codes: ['EXCLUDED_ITEM'],
      },
    ],
    derivation: `g is banned, so c's required slot cg is empty and c is off. Then p's required slot pc has no usable candidate, so p is off too (fixed point). q is a separate candidate of sp and survives.
Feasible: none, q. Scores 0 and 1, so q wins although p/c would have scored +18.`,
  }),

  defineCase({
    id: 'F03-alternative-parents-distinct-projections',
    family: 3,
    subcases: ['alternative_parents'],
    title: 'The same child reachable through two different parents gives two different projections',
    adrRefs: ADR,
    prerequisites: 'x fits only under p1 or under p2; the receiver slot accepts either parent.',
    source: 'Weapon slot s:[p1, p2]; p1(+1) has slot c1:[x]; p2(+2) has slot c2:[x]; x(+4).',
    fixture: fix({
      items: [
        { id: 'p1', ergonomics: 1, slots: [slot('c1', ['x'])] },
        { id: 'p2', ergonomics: 2, slots: [slot('c2', ['x'])] },
        { id: 'x', ergonomics: 4 },
      ],
      weapon: { slots: [slot('s', ['p1', 'p2'])] },
    }),
    request: ERGO_ONLY,
    feasible: [nk(), nk('p1'), nk('p2'), nk('p1', 'x'), nk('p2', 'x')],
    maxScore: '6',
    maximizers: [nk('p2', 'x')],
    scores: [[nk('p1', 'x'), '5']],
    physicalBuildCount: 5,
    derivation: `s holds none, p1 (x optional under it) or p2 (x optional under it): 1 + 2 + 2 = 5 trees and 5 projections.
p1+x scores 1+4 = 5, p2+x scores 2+4 = 6, so p2+x is the unique maximum: the alternative parent is the better route.`,
  }),

  defineCase({
    id: 'F03-alternative-parents-same-projection',
    family: 3,
    subcases: ['alternative_parents'],
    title: 'Several physical builds can share one projection; the oracle counts projections, not tree ids',
    adrRefs: [...ADR, 'ADR 0010 section 3 (Gate A is not a bijection of tree ids)'],
    prerequisites: 'The same parent template fits two receiver slots, and each copy has its own child slot.',
    source: 'Weapon slots s1:[p], s2:[p]; p(+1) has slot c:[x]; x(+4).',
    fixture: fix({
      items: [{ id: 'p', ergonomics: 1, slots: [slot('c', ['x'])] }, { id: 'x', ergonomics: 4 }],
      weapon: { slots: [slot('s1', ['p']), slot('s2', ['p'])] },
    }),
    request: ERGO_ONLY,
    feasible: [nk(), nk('p'), nk('p', 'x'), nk('p', 'p'), nk('p', 'p', 'x'), nk('p', 'p', 'x', 'x')],
    maxScore: '10',
    maximizers: [nk('p', 'p', 'x', 'x')],
    scores: [[nk('p', 'p', 'x'), '6']],
    physicalBuildCount: 9,
    derivation: `s1 and s2 each hold {none, p with empty c, p with x}: 9 trees. Projections: none (1 build), p (2), p+x (2), pp (1), pp+x (2), pp+xx (1) = 6 projections from 9 builds.
Scores: pp+xx = 2*1 + 2*4 = 10 is the unique maximum.`,
  }),

  defineCase({
    id: 'F03-self-loop',
    family: 3,
    subcases: ['self_loop'],
    title: 'A template whose own slot accepts itself can never nest inside itself',
    adrRefs: ADR,
    prerequisites: 'a has a slot that lists a as a candidate.',
    source: 'Weapon slot s:[a]; a(+3) has slot loop:[a].',
    fixture: fix({ items: [{ id: 'a', ergonomics: 3, slots: [slot('loop', ['a'])] }], weapon: { slots: [slot('s', ['a'])] } }),
    request: ERGO_ONLY,
    feasible: [nk(), nk('a')],
    maxScore: '3',
    maximizers: [nk('a')],
    rejections: [
      { label: 'a inside a', build: nakedBuild([ROOT, 's', 'a'], [iid(['s', 'a']), 'loop', 'a']), codes: ['ANCESTOR_TEMPLATE_REPETITION'] },
    ],
    physicalBuildCount: 2,
    derivation: `The only receiver candidate is a. Inside a, template a is its own ancestor, so the loop slot stays empty.
Trees: none, a. Best score 3. The nested a is rejected as ancestor-template repetition.`,
  }),

  defineCase({
    id: 'F03-ancestor-loop-with-sibling-repetition',
    family: 3,
    subcases: ['ancestor_loop'],
    title: 'A two-template cycle is cut at the repeated ancestor while sibling copies stay legal',
    adrRefs: ADR,
    prerequisites: 'a accepts b, b accepts a (a cycle); the receiver offers a in two slots.',
    source: 'Weapon slots s1:[a], s2:[a]; a(+2) has slot sb:[b]; b(+3) has slot sa:[a].',
    fixture: fix({
      items: [
        { id: 'a', ergonomics: 2, slots: [slot('sb', ['b'])] },
        { id: 'b', ergonomics: 3, slots: [slot('sa', ['a'])] },
      ],
      weapon: { slots: [slot('s1', ['a']), slot('s2', ['a'])] },
    }),
    request: ERGO_ONLY,
    feasible: [nk(), nk('a'), nk('a', 'b'), nk('a', 'a'), nk('a', 'a', 'b'), nk('a', 'a', 'b', 'b')],
    maxScore: '10',
    maximizers: [nk('a', 'a', 'b', 'b')],
    scores: [[nk('a', 'a', 'b'), '7']],
    rejections: [
      {
        label: 'a under b under a',
        build: nakedBuild([ROOT, 's1', 'a'], [iid(['s1', 'a']), 'sb', 'b'], [iid(['s1', 'a'], ['sb', 'b']), 'sa', 'a']),
        codes: ['ANCESTOR_TEMPLATE_REPETITION'],
      },
    ],
    physicalBuildCount: 9,
    derivation: `Within one branch a -> b -> a repeats a, so b's slot sa is never filled. Each receiver slot holds {none, a, a+b}: 9 trees.
Projections: none (1 build), a (2), a+b (2), aa (1), aa+b (2), aa+bb (1). a appears in two sibling branches, which is allowed; only nesting is forbidden.
Scores: aa+bb = 2*2 + 2*3 = 10 is the unique maximum.`,
  }),

  defineCase({
    id: 'F03-indexed-orphan-removal',
    family: 3,
    subcases: ['indexed_orphan_removal'],
    title: 'A reachable-only-through-a-removed-parent item disappears; one with a surviving parent stays',
    adrRefs: [...ADR, 'ADR 0003 canonical boundaries (an undecided optional parent is not an orphan)'],
    prerequisites: 'p is banned by the request. c1 fits only under p; c2 fits under p and under q.',
    source: 'Weapon slot s:[p, q]; p(0) has slot pc:[c1, c2]; q(+1) has slot qc:[c2]; c1(+9), c2(+4); request excludes p.',
    fixture: fix({
      items: [
        { id: 'p', slots: [slot('pc', ['c1', 'c2'])] },
        { id: 'q', ergonomics: 1, slots: [slot('qc', ['c2'])] },
        { id: 'c1', ergonomics: 9 },
        { id: 'c2', ergonomics: 4 },
      ],
      weapon: { slots: [slot('s', ['p', 'q'])] },
    }),
    request: { ...ERGO_ONLY, exclude_items: ['p'] },
    feasible: [nk(), nk('q'), nk('q', 'c2')],
    maxScore: '5',
    maximizers: [nk('q', 'c2')],
    rejections: [
      { label: 'p with c1', build: nakedBuild([ROOT, 's', 'p'], [iid(['s', 'p']), 'pc', 'c1']), codes: ['EXCLUDED_ITEM'] },
      { label: 'c1 floating', build: nakedBuild([iid(['s', 'p']), 'pc', 'c1']), codes: ['UNKNOWN_PARENT_INSTANCE'] },
    ],
    derivation: `p is banned, so everything reachable only through p is gone: c1 (+9) never appears. c2 survives through its second parent q.
Feasible: none, q, q+c2. Scores 0, 1, 5; q+c2 wins.`,
  }),

  defineCase({
    id: 'F03-memoization-context-ancestor',
    family: 3,
    subcases: ['memoization_context'],
    title: 'The same template under different parents has a different legal subtree',
    adrRefs: [...ADR, 'ADR 0003 consequences (branch acyclicity caching)'],
    prerequisites: 'Mutual nesting: t accepts x, x accepts t. A subtree cache keyed by template alone would be wrong.',
    source: 'Weapon slots s1:[t], s2:[x]; t(+1) has slot tc:[x]; x(+5) has slot xd:[t].',
    fixture: fix({
      items: [
        { id: 't', ergonomics: 1, slots: [slot('tc', ['x'])] },
        { id: 'x', ergonomics: 5, slots: [slot('xd', ['t'])] },
      ],
      weapon: { slots: [slot('s1', ['t']), slot('s2', ['x'])] },
    }),
    request: ERGO_ONLY,
    feasible: [nk(), nk('x'), nk('t'), nk('t', 'x'), nk('t', 't', 'x'), nk('t', 'x', 'x'), nk('t', 't', 'x', 'x')],
    maxScore: '12',
    maximizers: [nk('t', 't', 'x', 'x')],
    scores: [[nk('t', 'x', 'x'), '11'], [nk('t', 't', 'x'), '7'], [nk('t', 'x'), '6']],
    rejections: [
      {
        label: 't under x under t',
        build: nakedBuild([ROOT, 's1', 't'], [iid(['s1', 't']), 'tc', 'x'], [iid(['s1', 't'], ['tc', 'x']), 'xd', 't']),
        codes: ['ANCESTOR_TEMPLATE_REPETITION'],
      },
      {
        label: 'x under t under x',
        build: nakedBuild([ROOT, 's2', 'x'], [iid(['s2', 'x']), 'xd', 't'], [iid(['s2', 'x'], ['xd', 't']), 'tc', 'x']),
        codes: ['ANCESTOR_TEMPLATE_REPETITION'],
      },
    ],
    physicalBuildCount: 9,
    derivation: `Under s1 the legal subtrees are none, t, t[x] (x under t cannot take t again: t is its ancestor). Under s2 they are none, x, x[t] (t under x cannot take x again).
9 trees. Their multisets: none; x; t+x (three builds: s2=x[t], or s1=t[x], or s1=t with s2=x); t; 2t+x; t+2x; 2t+2x.
Distinct projections: none, x, t, t+x, tt+x, t+xx, tt+xx = 7. Scores: t=1, x=5: tt+xx = 12 is the unique maximum (t+xx = 11).`,
  }),

  defineCase({
    id: 'F03-memoization-context-required-slot',
    family: 3,
    subcases: ['memoization_context'],
    title: 'A required slot makes a template legal under one parent and illegal under another',
    adrRefs: [...ADR, 'ADR 0003 consequences (branch acyclicity caching)'],
    prerequisites: 'x requires p1; x can sit under p1 or p2, but p1 is an ancestor of x only in the first case.',
    source: 'Weapon slot s:[p1, p2]; p1(+1) has slot c1:[x]; p2(+2) has slot c2:[x]; x(+8) has required slot r:[p1].',
    fixture: fix({
      items: [
        { id: 'p1', ergonomics: 1, slots: [slot('c1', ['x'])] },
        { id: 'p2', ergonomics: 2, slots: [slot('c2', ['x'])] },
        { id: 'x', ergonomics: 8, slots: [reqSlot('r', ['p1'])] },
      ],
      weapon: { slots: [slot('s', ['p1', 'p2'])] },
    }),
    request: ERGO_ONLY,
    feasible: [nk(), nk('p1'), nk('p2'), nk('p1', 'p2', 'x')],
    maxScore: '11',
    maximizers: [nk('p1', 'p2', 'x')],
    scores: [[nk('p2'), '2']],
    rejections: [
      {
        label: 'x under p2 without its required p1',
        build: nakedBuild([ROOT, 's', 'p2'], [iid(['s', 'p2']), 'c2', 'x']),
        codes: ['MISSING_REQUIRED_SLOT'],
      },
      {
        label: 'x under p1 satisfied by a nested p1',
        build: nakedBuild([ROOT, 's', 'p1'], [iid(['s', 'p1']), 'c1', 'x'], [iid(['s', 'p1'], ['c1', 'x']), 'r', 'p1']),
        codes: ['ANCESTOR_TEMPLATE_REPETITION'],
      },
    ],
    accepts: [
      {
        label: 'p2 with x holding p1',
        build: nakedBuild([ROOT, 's', 'p2'], [iid(['s', 'p2']), 'c2', 'x'], [iid(['s', 'p2'], ['c2', 'x']), 'r', 'p1']),
      },
    ],
    physicalBuildCount: 4,
    derivation: `Under p1, x would need p1 inside it, but p1 is an ancestor, so x cannot stand under p1: p1 stays a leaf. Under p2, x needs p1 inside it, and p1 is not an ancestor there, so p2[x[p1]] is legal.
Below that p1, slot c1 could take x but x is an ancestor, so it stays empty. Trees: none, p1, p2, p2[x[p1]] (4 builds, 4 projections).
Scores: none 0, p1 1, p2 2, p1+p2+x = 1+2+8 = 11, the unique maximum.`,
  }),
];
