// Family 10: disconnected and cyclic structures (ADR 0013 section 3 item 10, ADR 0010 section 4 item 10,
// ADR 0003 principles 2 and 3). A selected assembly must be connected to the receiver through an
// unbroken instance path; floating loops are never selected; an owner whose required slot cannot be
// filled is deactivated together with everything below it, while an alternate rooted path survives.

import { defineCase, fix, iid, nk, nakedBuild, reqSlot, ROOT, slot } from './dsl';
import type { LedgerCase } from './types';
import type { ReferenceBuild } from '../oracle/index';

const ADR = ['ADR 0003 principles 2 and 3', 'ADR 0010 section 4 item 10', 'ADR 0013 section 3 item 10'];
const ERGO_ONLY = { recoil_weight: 0 };

/** Placement with explicit instance ids, for floating structures that no path-derived id can express. */
const placement = (parentInstanceId: string, slotId: string, childInstanceId: string, itemId: string) =>
  ({ parentInstanceId, slotId, childInstanceId, itemId });

const floatingPair: ReferenceBuild = {
  base: { kind: 'naked' },
  placements: [placement('x2', 'l2s', 'x1', 'l1'), placement('x1', 'l1s', 'x2', 'l2')],
};
const floatingSelfLoop: ReferenceBuild = { base: { kind: 'naked' }, placements: [placement('w', 'ws', 'w', 'wloop')] };

export const FAMILY_10: LedgerCase[] = [
  defineCase({
    id: 'F10-no-disconnected-assembly',
    family: 10,
    subcases: ['no_disconnected_assembly'],
    title: 'Mutually nesting templates that no receiver slot offers are never part of a build',
    adrRefs: ADR,
    prerequisites: 'l1 and l2 accept each other and wloop accepts itself, but no receiver or mod slot lists any of them.',
    source: 'Receiver slot s:[q]; q(+1). l1(+50, slot l1s:[l2]), l2(+50, slot l2s:[l1]), wloop(+50, slot ws:[wloop]) are unreachable.',
    fixture: fix({
      items: [
        { id: 'q', ergonomics: 1 },
        { id: 'l1', ergonomics: 50, slots: [slot('l1s', ['l2'])] },
        { id: 'l2', ergonomics: 50, slots: [slot('l2s', ['l1'])] },
        { id: 'wloop', ergonomics: 50, slots: [slot('ws', ['wloop'])] },
      ],
      weapon: { slots: [slot('s', ['q'])] },
    }),
    request: ERGO_ONLY,
    feasible: [nk(), nk('q')],
    maxScore: '1',
    maximizers: [nk('q')],
    rejections: [
      { label: 'floating l1 <-> l2 loop', build: floatingPair, codes: ['UNROOTED_PLACEMENT'] },
      { label: 'floating self-loop', build: floatingSelfLoop, codes: ['UNROOTED_PLACEMENT'] },
      { label: 'l1 forced into the receiver slot', build: nakedBuild([ROOT, 's', 'l1']), codes: ['ITEM_NOT_ALLOWED_IN_SLOT'] },
    ],
    physicalBuildCount: 2,
    derivation: `Only q is offered by a receiver slot, so the rooted trees are none and q. The loops l1<->l2 and wloop->wloop have no path to the receiver and are never selected (x = 0), however attractive their +50.
A floating loop is a set of placements whose parents exist but none is rooted: UNROOTED_PLACEMENT. Forcing l1 into the receiver slot violates the slot's candidate list instead.`,
  }),

  defineCase({
    id: 'F10-conditional-owner-deactivation',
    family: 10,
    subcases: ['conditional_owner_deactivation'],
    title: 'An owner whose required slot cannot be filled is off, and so is every descendant that depended on it',
    adrRefs: ADR,
    prerequisites: 'p requires a child from {z}; z is banned; x fits only under p.',
    source: 'Receiver slot s:[p, q]; p(+9) has required slot pr:[z] and optional slot px:[x]; z(0) banned; x(+5); q(+1).',
    fixture: fix({
      items: [
        { id: 'p', ergonomics: 9, slots: [reqSlot('pr', ['z']), slot('px', ['x'])] },
        { id: 'z' },
        { id: 'x', ergonomics: 5 },
        { id: 'q', ergonomics: 1 },
      ],
      weapon: { slots: [slot('s', ['p', 'q'])] },
    }),
    request: { ...ERGO_ONLY, exclude_items: ['z'] },
    feasible: [nk(), nk('q')],
    maxScore: '1',
    maximizers: [nk('q')],
    rejections: [
      { label: 'p with x but no z', build: nakedBuild([ROOT, 's', 'p'], [iid(['s', 'p']), 'px', 'x']), codes: ['MISSING_REQUIRED_SLOT'] },
      { label: 'p alone', build: nakedBuild([ROOT, 's', 'p']), codes: ['MISSING_REQUIRED_SLOT'] },
    ],
    derivation: `z is banned, so p's required slot is empty and p is deactivated (0 = x_p). x fits only under p, so it disappears with it.
Feasible: none, q. The better p (+9) and x (+5) are unreachable; q (+1) wins.`,
  }),

  defineCase({
    id: 'F10-retained-alternate-rooted-path',
    family: 10,
    subcases: ['conditional_owner_deactivation', 'retained_alternate_path'],
    title: 'A part below a deactivated owner survives when a second rooted parent offers it',
    adrRefs: ADR,
    prerequisites: 'As above, but q also has a slot that accepts x.',
    source: 'Receiver slot s:[p, q]; p(+9) has required slot pr:[z] and optional slot px:[x]; z(0) banned; x(+5); q(+1) has slot qx:[x].',
    fixture: fix({
      items: [
        { id: 'p', ergonomics: 9, slots: [reqSlot('pr', ['z']), slot('px', ['x'])] },
        { id: 'z' },
        { id: 'x', ergonomics: 5 },
        { id: 'q', ergonomics: 1, slots: [slot('qx', ['x'])] },
      ],
      weapon: { slots: [slot('s', ['p', 'q'])] },
    }),
    request: { ...ERGO_ONLY, exclude_items: ['z'] },
    feasible: [nk(), nk('q'), nk('q', 'x')],
    maxScore: '6',
    maximizers: [nk('q', 'x')],
    rejections: [{ label: 'p with x but no z', build: nakedBuild([ROOT, 's', 'p'], [iid(['s', 'p']), 'px', 'x']), codes: ['MISSING_REQUIRED_SLOT'] }],
    accepts: [{ label: 'x rooted through q', build: nakedBuild([ROOT, 's', 'q'], [iid(['s', 'q']), 'qx', 'x']) }],
    physicalBuildCount: 3,
    derivation: `p is deactivated as before, so the path through p is gone, but x is still reachable through q (slot qx). Feasible: none, q, q+x.
Scores 0, 1, 1+5 = 6; q+x wins. Removing the owner never removes a part that has another rooted parent.`,
  }),

  defineCase({
    id: 'F10-cycle-behind-deactivated-owner',
    family: 10,
    subcases: ['no_disconnected_assembly', 'conditional_owner_deactivation'],
    title: 'A loop that hangs only below a deactivated owner is cut loose and disappears',
    adrRefs: ADR,
    prerequisites: 'l1 and l2 accept each other and are offered only by p, whose required slot cannot be filled.',
    source: 'Receiver slot s:[p, q]; p(+3) has required slot pr:[z] and optional slot pl:[l1]; z(0) banned; l1(+50, slot l1s:[l2]), l2(+50, slot l2s:[l1]); q(+1).',
    fixture: fix({
      items: [
        { id: 'p', ergonomics: 3, slots: [reqSlot('pr', ['z']), slot('pl', ['l1'])] },
        { id: 'z' },
        { id: 'l1', ergonomics: 50, slots: [slot('l1s', ['l2'])] },
        { id: 'l2', ergonomics: 50, slots: [slot('l2s', ['l1'])] },
        { id: 'q', ergonomics: 1 },
      ],
      weapon: { slots: [slot('s', ['p', 'q'])] },
    }),
    request: { ...ERGO_ONLY, exclude_items: ['z'] },
    feasible: [nk(), nk('q')],
    maxScore: '1',
    maximizers: [nk('q')],
    rejections: [
      {
        label: 'p holding the l1/l2 chain without z',
        build: nakedBuild([ROOT, 's', 'p'], [iid(['s', 'p']), 'pl', 'l1'], [iid(['s', 'p'], ['pl', 'l1']), 'l1s', 'l2']),
        codes: ['MISSING_REQUIRED_SLOT'],
      },
    ],
    derivation: `p is off (its required slot is empty), so the loop l1<->l2 that could only hang below p is never attached to the receiver and is never selected, although l1 and l2 give +50 each.
Feasible: none, q; q (+1) wins. (Had p been installable, l2 could not take l1 again: l1 would be its ancestor.)`,
  }),
];
