# Is the Fast count/edge model an exact reformulation on acyclic template graphs?

Status: **final** (2026-10-05). Research only: no production code was changed.

Research question (issue #40, Stage 2 branch `impl/stage2-correctness-cutover`): is `specializeFast`'s integer count/edge model an exact reformulation of the physical
(path-qualified occurrence) domain on weapons whose template graph is acyclic? If so, acyclic weapons could get certified answers at Fast speed.

## Findings

1. **Verdict: conditionally exact.** On an acyclic ACTIVE template graph, Fast's integer feasible set projects onto exactly the physical feasible set of selected builds
   `pi_sel = (base, installed multiset)`, every integer Fast point decodes to a rooted physical build with the same projection, and the best Fast objective of every
   projection equals the oracle's exact score. The proof (sections 3 to 5) goes constraint family by constraint family. Conditions: (C1) the blueprint prepared without error
   (raw slot ids belong to one template), (C2) no TrueErgo / Prevent Overswing, (C3) the MOA guard of section 5.7, (C4) the active template graph is acyclic.
2. **One real deviation, fixed on paper.** `moa_rep_t` demands the MOA cap of EVERY installed barrel; the oracle uses only the barrel with the largest centre of impact. They
   agree unless the accuracy sum can pass 100 percent points AND the cap is below zero AND two barrels with different centres of impact can be installed together. Minimal fixture
   (2 slots, 2 barrels, accuracy +120, cap -5): oracle `{b1}`, `{b1,b2}`; Fast `{b1}` only. Relaxing each barrel row by the presence of every barrel with a larger centre of impact
   (`moaDominanceFix`, a text rewrite in the research run) restores equality. The long campaign hit the family in 65 of the 600 cases of the profile built for it and in no other
   case; the fix repaired all 65. The sum can pass 100 through several copies of one item (seed 700298: 45 + 4 x 45 - 30 = 195), so the guard needs a bound that counts copies:
   `computeActiveBounds` sums per occurrence and does, and `specializeFast` already notes the assumption when that bound passes 100 with several barrels. On the pinned snapshot
   the bound is at most 20 percent points (172 guns, three request profiles), so the deviation cannot occur on real data.
3. **"Acyclic" must mean the ACTIVE template graph after the masks (`buildTemplateGraph(...).acyclic`), not the closure.** The closure being acyclic (`prunedAncestorEdges === 0`,
   request independent) implies it; the converse fails. Lemma 1 (section 4) shows the active-graph condition alone is enough: every active occurrence of one template has the
   same active candidates in every slot. All 172 pinned guns have an acyclic closure; the lemma's conditions hold on 60,689 (template, slot) pairs of real data, and on 931 generated
   cases whose closure is cyclic but whose active graph is not (where the lemma is not vacuous).
4. **#39 / ADR 0011 does not transfer.** The counterexample is a defect of a CONTINUOUS relaxation with per-slot pair conflicts. Fast is an integer model; the conflicts the domain can
   express are keyed globally by (blocker template, raw slot id), so aggregating the copies of an owner loses nothing, and for a single-copy owner Fast's edge column IS the physical
   occurrence variable. Reproduced (LP feasible at 1/2, integer program infeasible, 64 vectors give 0 witnesses of count 3) and tested against the closest realizable domains.
5. **The gates pass on 5,361 gated cases, with no deviation outside the MOA family** (section 7): ledger 133 (production `solveFast` path 123/123), random worlds 1,242,
   adversarial worlds 3,654 (seven profiles; the six outside the MOA family pass every gate on 3,097 cases), real-gun slices 332 (production path 155/155), plus the fixed #39 and MOA
   fixtures. 94,855 oracle projections were compared; the largest objective difference per projection is 1.0e-9 relative, the native MIP absolute gap.
6. **Cyclic active graphs stay out of scope.** In 43 generated worlds with a cyclic active graph, Fast differed from the oracle in 18, always the same way: it admits an integer point
   that does not decode to a rooted tree. It never lost a physical build (lifting holds there too). Exactness, and so a certificate, needs C4.
7. **A certificate needs less than exactness, but more than the current Fast emission.** Lifting alone (every physical build is a model point) makes the model an OUTER
   RELAXATION, which is what the proof layer needs for a certified optimum (validated witness attaining a padded bound) and a certified infeasibility. Acyclicity is what makes the
   witness always decodable. Fast's rows are not yet built on the proof layer (no exact-rational construction, no directed padding), so exact model != certified answer yet.
8. **Solver finding.** With presolve OFF the pinned HiGHS 1.15.1 still returns false `Infeasible` verdicts: 16 of the 5,524 Infeasible verdicts the long campaign cross-checked
   (about 180,000 solves of small enumeration and pinning models; the checkpoint run found 3 in 13,084 solves). A looser feasibility tolerance as a second opinion is unsound (it
   admits near-boundary points); the gates use strict second opinions and decode and validate every feasible answer. A certified infeasibility from Fast needs the same policy.

## Recommendation

The answer supports the first Stage 4 candidate of `docs/stage2-plan.md` (owner decision 2a). It does not change Stage 2: Fast stays `approximate`, Auto stays size based, and
Phase 2.6 can resume. Adopting certified Fast answers in Stage 4 needs, in order:

1. Fast rows built through the proof layer (exact-rational construction, directed padding, readback), as Precise already is.
2. The MOA rows: either the dominance relaxation in `specializeFast`, or the guard (C3) as a precondition of a certificate.
3. A per-request check of C1 and C4 (the closure test is a cheaper sufficient pre-check), and C2 until Fast has the spatial search over aggregate weight.
4. The infeasibility second-opinion policy of finding 8.
5. Gates A to C and the comparative gates on the production path, as ADR 0010 and ADR 0013 require for any reformulation.

## How the evidence was produced

- Default sizes (about 90 s, part of `npm run test:reference`): `cd frontend && npx tsx --test reference/harness/acyclicFast.differential.test.ts`.
  `frontend/tests/research/acyclicFast.pinned.test.ts` (part of `npm run test:unit`) scans the 172 pinned guns.
- Long campaign: `ACYCLIC_FAST_LONG=1`, split over 16 processes. `ACYCLIC_FAST_SHARDS=16 ACYCLIC_FAST_SHARD=i` runs every 16th case of each population (the fixed tests run in shard 0);
  `ACYCLIC_FAST_PROGRESS` and `ACYCLIC_FAST_RESULTS` give a live per-case log and per-test tallies (the node test runner buffers a file's output until it ends); real-gun slices
  vary in cost by orders of magnitude, so the slow shards' real and cyclic cases were redistributed by work stealing (`ACYCLIC_FAST_CLAIM_DIR`, `ACYCLIC_FAST_SHARD_SET`). The tallies of
  all processes were summed; the merged counts equal the number of distinct completed cases. Wall clock 12:32 to 13:50 on 16 threads.
- Two real-gun slices (random slices 151 and 232) did not finish within about an hour of enumeration (up to 2,500 points, each adding a no-good cut) and were stopped; they are not
  counted. One SV-98 slice took about an hour and passed.
- A test bug found and fixed during the run: the adversarial test first attributed failures to the MOA family only when the generator's `accuracy-sum-can-pass-100` tag was set, and
  that tag counts each item once. Three cases whose sum passed 100 only through copies were reported as failures; each was checked (the dominance fix repairs it), the classifier
  now requires a negative cap and several barrels, and it still requires the fix to repair the case. That keeps the attribution sound: the fix only relaxes the per-barrel MOA
  rows, which changes nothing when the sum stays at or below 100. The affected shards were re-run.

| File | Contents |
| --- | --- |
| `frontend/reference/harness/acyclicFast.differential.ts` | gates, enumeration, pinning, tolerance-boundary classification, solver second opinion, MOA fix rewrite |
| `frontend/reference/harness/acyclicFastWorlds.differential.ts` | adversarial generator, `drawRequest`, structural features |
| `frontend/reference/harness/acyclicFastRealSlices.differential.ts` | real-gun slices of the pinned raw documents, `treeCount` |
| `frontend/reference/harness/acyclicFast.differential.test.ts` | the gates (default and long sizes, sharding, work stealing) |
| `frontend/tests/research/acyclicFast.pinned.test.ts` | 172-gun scan: closure acyclicity, Lemma 1 on real data, accuracy bound |
| `docs/research/acyclic-fast-exactness.md` | this report |

---

## 1. Definitions

**Physical domain.** The blueprint unrolls the weapon into path-qualified occurrences with the no-ancestor-template-repetition rule; `prepareSubproblemDomain` masks them (filters, receiver bans,
supply, and a bottom-up/top-down fixed point: an occurrence is *viable* when its template passes the filters and every required slot it owns has a viable candidate, *reachable* when it is
viable and its owner is; *active* = viable and reachable). A physical build `B = (base, T)` is a base choice plus a rooted set of placements (one child per physical slot, required slots filled,
only allowed candidates, no ancestor-template repeat) satisfying: template conflicts by presence, self-conflict copy cap of one, slot conflicts (an installed blocker empties every physical slot
of every listed raw slot id, its own host slot included), includes/excludes, quantity caps (preset supply + owned stock for templates with no standalone offer), base accessibility, and every
request cap (price as the exact minimum whole-lot cover, ergonomics after the first clamp, recoil, magazine/sighting maximum over the receiver and installed items, weight, MOA with the largest
positive barrel COI replacing the intrinsic one). `F_phys` is the set of such builds; `Pi_phys = pi_sel(F_phys)`.

**Fast domain.** `F_fast` is the set of integer points of the LP `specializeFast` emits: base binaries `base_b`, template counts `n_t` (0..`copies[t]`), edge counts `e_{rho,c}` (copies of template
`c` installed in a slot of raw id `rho`, summed over all copies of the slot's owner), presence binaries `z_t` for repeatable templates used in a conflict or MOA row, whole-lot columns, and the
statistic/clamp/objective columns, which are determined by the integer columns up to the choice of lots (price). `pi_fast(point) = (base, n)`.

**Exact reformulation (Gates A, B, C of ADR 0010).** (A) `pi_fast(F_fast) = Pi_phys` and every integer Fast point decodes to a physical build with the same projection; (B) for every projection
the best Fast objective equals the oracle's exact score (hence the maximum and the whole maximizer set agree); (C) `F_fast` is empty exactly when `F_phys` is.

**Acyclic.** Two graphs:
- the *closure graph* `H`: template -> candidate template over the allowlists, before the ancestor rule. `H` acyclic <=> `blueprint.stats.prunedAncestorEdges === 0`. Request independent.
- the *active graph* `G` (`buildTemplateGraph(blueprint, domain).acyclic`): the receiver, the active templates, and an edge `t -> c` when some ACTIVE occurrence of `t` has an ACTIVE candidate
  occurrence of `c`. Request dependent (masks remove edges and templates).

`G` is a subgraph of `H`, so `H` acyclic implies `G` acyclic; the converse is false (A allows B, B allows A, B reachable only below A: the closure has a cycle, the ancestor rule prunes `B -> A`
at every occurrence, `G` is acyclic). The proof needs `G`; `H` is a cheap request-independent sufficient test. It matters because (i) the ancestor rule is vacuous exactly when no active path can
repeat a template, which is a statement about `G`; (ii) a filter can only remove edges, never add them, so a certificate decided once on `H` holds for every request, whereas a certificate on `G`
admits more weapon/request pairs but must be re-checked per request; (iii) the pinned data satisfies the stronger `H` condition on all 172 guns, so nothing real needs the weaker one.

## 2. Evidence base and what it does and does not show

Agreement of optima (2.4c: 384/384 builds, 1,650 random worlds) is not projection-set equality. The gates here enumerate and pin projections (both directions), compare the decoded witnesses with
the oracle's validator, and compare objective values per projection. See sections 7 and 8 for counts.

## 3. Theorem (conditional)

Assume (C1) the blueprint prepared without error, (C2) the request has no TrueErgo/Prevent Overswing, (C3) the MOA guard (section 5.7), (C4) `G` is acyclic. Then (A), (B), (C) hold for `specializeFast`.

Two directions. **Lifting**: every physical build maps to a Fast integer point with the same projection and objective. **Projection**: every integer Fast point decodes (in time linear in the tree)
to a physical build with the same projection. Lifting holds on every graph (the flow rows cover cycles) except for the MOA deviation; projection is where acyclicity is used.

## 4. Lemma: the active domain is template-determined when `G` is acyclic

**Lemma 1.** If `G` is acyclic, then for any two active occurrences `v, v'` of one template `t` and any raw slot `rho` of `t`, the sets of active candidate templates of their slots with raw
id `rho` are equal (and equal the Fast candidate set `C(rho)`, the union over all active occurrences).

*Proof.* Let `Anc(v)` be the templates on the root path of `v` including `v`'s own. Viability of an occurrence depends only on its template and `Anc`: `V(c, S) = filter_ok(c) and for every required slot r
of c there is a candidate d not in S with V(d, S + d)` (a candidate in `S` is pruned by the ancestor rule). Suppose `c` is an active candidate of `v'` in slot `rho` but not of `v`; then `t -> c` is an edge of `G` (witnessed by `v'`).
(i) `c` is pruned at `v`, i.e. `c in Anc(v)`. Every occurrence on the path from `c`'s ancestor to `v` is active (they are ancestors of the active `v`), so `G` contains a path `c -> ... -> t`; with
`t -> c` that is a cycle. (ii) The candidate occurrence of `c` under `v` exists but is not viable, while the one under `v'` is (the template-level reasons are the same for both). Some required slot of
`c` has, under `v`, only pruned or non-viable candidates while under `v'` it has a viable candidate `d_1`. If `d_1 in Anc(v)`, the edges `t -> c` (via `v'`), `c -> d_1` (via the viable `c` under `v'`) and the
path `d_1 -> ... -> t` along the ancestors of `v` form a cycle. Otherwise `d_1` is non-viable under `v` and viable under `v'` and the argument recurses one level down (the occurrence subtree under `v'` is finite;
at each level the edge used is witnessed by a viable, hence active, occurrence on the chain below `v'`). The recursion ends in a pruned candidate `d_k in Anc(v)` (it cannot be on the chain, which is in the `v'`-side ancestor set),
giving a cycle `t -> c -> d_1 -> ... -> d_k -> ... -> t`. Contradiction in both cases. Hence the active candidate sets agree. The union `C(rho)` is therefore attained at every active occurrence. QED

**Corollary 1.** Physical rooted trees (structure only) are exactly the rooted trees whose nodes carry templates with: the root is the receiver; a node of template `t` has at most one child per raw slot `rho`,
of a template in `C(rho)`, and a child in every required slot. (Given such a tree, build occurrences top-down: the active candidate occurrence of the chosen template exists under the parent occurrence by Lemma 1.)

**Corollary 2.** On `G` acyclic the ancestor rule is vacuous: a repeated template on a root path would be a cycle of `G`. `copyBounds` (`K_c(t) = [t = c] + sum over slots of max over candidates K_c(d)`) is the exact maximum number
of copies of `c` over trees; Fast's `copies[t]` (also capped by the active occurrence count and by 1 for a self-conflict) is therefore a valid upper bound, as lifting requires.

*Empirical check of Lemma 1 on real data:* `tests/research/acyclicFast.pinned.test.ts` compares the active candidate sets of every (template, raw slot) pair on every nonempty (gun, profile) domain of the pinned
snapshot: 60,689 pairs, no disagreement. Synthetic back-edge worlds (closure cyclic, active graph acyclic: up to 46 of 87 gated cases in a profile) test it where it is not vacuous.

## 5. Constraint families (lifting and projection)

Notation: `U_t = copies[t]`; `owner(rho)` is the template that owns raw slot id `rho` (unique: the blueprint throws `SLOT_ID_COLLISION` otherwise, which is why C1 is a condition and the
oracle's weaker "unique per owner" fixture rule is not enough).

### 5.1 Slot capacity and required occupancy: per owner copy versus aggregate edge counts
Rows: `in_t: n_t = sum over slots holding t of e_{rho,t}`; for a mod-owned slot `sum_c e_{rho,c} <= n_owner` (`=` when required); for a root slot `<= 1` (`= 1` when required).
*Lifting:* count the nodes: each owner copy has at most one child per slot, exactly one in a required slot; every node has exactly one parent slot. *Projection:* process templates in a topological order of the acyclic
`G`; when `t` is reached, all slots whose candidates contain `t` belong to earlier owners, which already have `n_owner` instances by induction; assign the `e_{rho,c}` children of each slot to DISTINCT instances of the owner
(an injection, a bijection when required, possible by the slot row); then `t` receives exactly `sum e_{rho,t} = n_t` instances (the `in_t` row). No per-copy variable is needed because the rows state exactly what a transportation problem
on a DAG needs, and the greedy BFS of `decodeFast` realizes it. Nothing is lost by merging the copies of an owner: capacity and requirement are per-copy but identical for all copies, and every other rule
is copy-agnostic (5.3, 5.4). Items allowed in several slots of one owner (several `e_{rho,c}` into one `n_c`) and templates under several parents (several in-edges) are covered by the same argument.
**Exact.** Tested: 250 of 256 gated adversarial cases have overlapping allowlists in one owner; 148 have a template with required slots under several parents.

### 5.2 Activation and rootedness
Optional slot of a mod: `sum_c e <= n_owner`. Fast has no occurrence variables, so rootedness is not stated but *derived*: by induction on the topological order every installed copy has a parent copy of an earlier template.
On a cyclic graph this induction fails (a cycle of parts could hold each other), which is why `specializeFast` adds a connectivity flow there. **Exact on acyclic `G`.**

### 5.3 Template conflicts and presence
Each conflicting pair lies in a pairwise-conflicting clique of the conflict graph (`cliqueCover`, checked: every clique is a set of pairwise neighbours, every pair is covered), one row `sum z <= 1` per clique; `z_t = 1` iff `n_t >= 1`
for a repeatable template (`n_t <= U z_t`, `z_t <= n_t`), `z_t = n_t` for a single-copy one. This is the ADR 0003 presence rule (`A + A` stays legal when `B` is absent). **Exact.**

### 5.4 Self-cap
A self-listing template has `copies = 1`, a column bound. Multi-copy supply (preset count above one, owned stock) cannot override it. **Exact.** Tested (63 adversarial cases with self-conflict and supply for two or more copies).

### 5.5 Slot conflicts (global occupancy by raw slot id, the blocker's own slot included)
Row `sum_c e_{rho,c} + U z_b <= U` per (blocker `b`, blocked raw id `rho`), `U` the largest possible occupancy. Since every physical slot of raw id `rho` is a slot of a copy of `owner(rho)`, `sum_c e_{rho,c}` is exactly the occupancy of
`PhysicalSlots(rho)`, so the row states "a present blocker empties every slot of that id", including the host slot of the blocker itself and required slots (a blocker in a required slot it blocks bans the blocker, because
the owner would then have an empty required slot). **Exact.** Tested: 140 adversarial cases with slot conflicts, 95 against required slots, 89 against the blocker's own host slot; the two real blockers of the pinned snapshot in real slices.

### 5.6 Includes (item and category chain)
`n_t >= 1`; a category group is `sum of n_t over active templates whose category chain meets the group >= 1`; an unknown or inactive id, or an empty group, is a constant contradiction row (oracle: infeasible). **Exact.**

### 5.7 Caps on additive statistics, magazine and sighting maximum, clamps, MOA
Additive statistics (ergonomics, recoil modifier, weight, accuracy): `sum_t value_t n_t` equals the sum over installed occurrences. Clamp: the three-regime big-M clamp is exact for any sign of the source, with
`M` from the active bounds (valid enclosures of every physical build). Recoil caps are stated without division. Magazine/sighting: "receiver meets it, or some installed template reaches it": `sum n_t >= 1` over templates reaching the limit (maximum over receiver and installed items). **Exact.**

**MOA with barrel COI replacement: the one deviation.** Oracle: effective COI is the LARGEST positive COI among installed items (the intrinsic one only if none), `MOA = COI * (1 - A/100) * K`. Fast: one row per barrel template `b`,
`z_b = 1 => c_b * K * (1 - A/100) <= L`, i.e. the cap of EVERY installed barrel, plus a fallback row for "no barrel". For `A <= 100` the factor `1 - A/100 >= 0`, MOA grows with COI and "the largest barrel meets the cap" is
equivalent to "every installed barrel meets it". For `A > 100` the factor is negative and a SMALLER COI gives a LARGER MOA; if `L < 0` a smaller barrel can miss the cap while the largest meets it (for `L >= 0`, `MOA <= 0 <= L`
holds for all barrels). So Fast is exact unless `L < 0` AND `A > 100` is attainable AND two active barrels with different positive COI can be installed together. The projection direction is unaffected (every Fast point
satisfies the oracle's rule); only LIFTING fails (Fast loses physical builds, so it can even report a wrong infeasible). Minimal fixture and fix: findings 2 above, test `MOA counterexample`. Guard (C3):
`maxMOA == null || maxMOA >= 0 || activeBounds.accuracy.hi <= 100 || at most one distinct positive barrel COI`. The bound must count copies (an item installed four times adds its accuracy four times); `computeActiveBounds` sums per occurrence. Real data: accuracy sum bound 20.0, guard always true.

### 5.8 Acquisition: preset supply, owned stock, supply caps, whole lots, exact wallet
Per template (not per occurrence, so nothing path dependent): the oracle's deficit is `max(0, installed - preset supply of the selected base - owned)`, paid with the exact minimum whole-lot cover over ALL legal offers; a template with no legal
standalone offer is capped by preset + owned supply; the base is the cheapest legal lot of the naked receiver or the preset. Fast: `supcap_t: n_t <= sum_b q_{bt} base_b + owned` (capped); `cover_t: sum_k size_k lot_k >= n_t - sum_b q_{bt} base_b - owned`
with `lot_k` integer (whole lots) and `price_def: price = sum_b cheapest_b base_b + sum lot price * lot_k`. Reductions: *offer dominance* (an offer another offer matches or beats in both lot size and price is dropped): any cover using it can swap it for the
dominating offer at no more cost and no fewer units, so the minimum cover cost is unchanged (there are no per-offer stock limits in the domain; ties keep the earlier offer). *Linear shortcuts*: with no supply and one unit-lot offer, or at most one copy, the cover of
`d` units costs `d * price` (resp. the cheapest lot price for `d <= 1`), exactly. *Lot bounds*: some minimum cover uses at most `ceil(surrogateMax / size_k)` lots of each kind (drop any extra lot: the remaining ones still cover). Hence for a fixed projection the Fast
price can be any cover cost and its minimum is the oracle's spend; the price cap and the objective see the minimum (objective and Tchebycheff deviation are nonincreasing in price, or do not use it when `p = 0`). **Exact.** Tested: 132 adversarial cases with whole-lot barters (lot sizes 2-4,
zero-price lots), 133 with preset copies, 131 with owned stock, 129 with capped templates.

### 5.9 Domain masks and the fixed point
Path independence is Lemma 1 (viability and reachability depend on the ancestor set only through pruned edges, which `G` acyclic rules out); the masks remove only occurrences no feasible build can contain, so lifting loses nothing,
and the empty-domain verdicts (no accessible base, an unfillable root required slot) are exact. **Exact on acyclic `G`** (and on `H` acyclic trivially).

### 5.10 Objective, weighted and Tchebycheff
The objective is a function of (clamped ergonomics, recoil modifier sum, price) and the same scalarization as Precise (`ergo_axis`, `rec_axis`, `price_axis`, the augmented Tchebycheff rows). Per projection the best Fast value is the
oracle score (section 5.8 for price). Pointwise parity over all projections implies the same maximum and the same maximizer set, up to the float resolution (a tie that differs by less than the solver tolerance is reported as undecidable,
never as a tie; the ledger's `decimal-weight` case is such a case and is classified accordingly). **Exact.**

## 6. Hidden assumptions, checked

| Suspect | Result |
| --- | --- |
| per-copy structure lost by aggregate edge counts | none: every rule is per-copy-uniform or global by raw id (5.1, 5.5) |
| slot-id collisions | the oracle allows the same id on two templates (and then matches by id); the blueprint refuses (`SLOT_ID_COLLISION`): C1 |
| preset receivers, root versus mod slots | preset = supply and price only, never placement; root slot has one owner copy (rows `<= 1`/`= 1`) |
| item allowed in several slots of one owner | several edge columns into one `n_c`: exact |
| required slots of a template under several parents | the requirement is per template (`req_rho: sum e = n_t`): exact |
| slot conflicts against required slots / own host slot | exact (5.5) |
| self-conflict with multi-copy supply | column bound 1 (5.4) |
| presence only for repeatable templates | a single-copy template's count is its presence: exact |
| offer dominance, linear shortcuts, copy bounds | proven exact (5.8, Corollary 2); no per-offer stock limits exist in the domain |
| MOA barrels in several positions | the deviation of 5.7 |
| tight caps | solver tolerance admits points that miss a cap by less than 1e-7 relative: numeric layer, see section 9 |
| fixed point of the masks | path independent iff `G` acyclic (Lemma 1) |

## 7. Gate results (long campaign)

`ACYCLIC_FAST_LONG=1`, seeds from 0. A case is *gated* when the oracle enumerated it completely (`oracle_incomplete` otherwise), the request has no TrueErgo/Prevent Overswing
(`ted`), and its active graph is acyclic (`cyclic_active_graph` otherwise). Projections above the enumeration cap (2,500) are sampled by directions and every oracle projection is
pinned in Fast (completeness) instead of compared as a set. *Tolerance boundary*: Fast points that meet a request cap only within the solver's feasibility tolerance; the exact
oracle rejects them, production's validator cuts them out, and they are counted apart, not as mismatches.

| Population | Cases | Gated (nonempty / empty) | Skipped | Oracle projections | Fast points decoded and validated | Pinned | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Ledger (148 non-todo cases) | 148 | 133 (118 / 15) | ted 15 | 419 | 419 (+1 boundary) | 419 | all gates pass; production `solveFast` 123/123 |
| Random worlds (lpFuzz, 1,500 seeds) | 1,500 | 1,242 (841 / 401) | cyclic 213, incomplete 45 | 16,209 | 14,931 | 15,722 | all gates pass |
| Adversarial, six profiles (600 each) | 3,600 | 3,097 (2,093 / 1,004) | cyclic 173, incomplete 330 | 30,452 | 29,454 | 30,244 | all gates pass |
| Adversarial, MOA with accuracy above 100 | 600 | 557 (329 / 228) | incomplete 43 | 3,158 | 2,575 | 3,158 | 65 MOA-family deviations, all 65 repaired by the dominance fix; soundness and pointwise objective pass 495/495 |
| Real-gun slices (pinned raw documents) | 338 | 332 (201 / 131) | incomplete 6 | 44,617 | 28,175 (+210 boundary) | 38,165 | all gates pass; production path 155/155 |
| #39 analogue: 64 blocked-slot subsets x 2 requests | 128 | 128 | | | | | pass |
| #39 two triangles, closest realizable domain, MOA minimal fixture | fixed | | | | | | pass |
| Pinned snapshot scan (172 guns) | 172 | 153 nonempty default domains | | | | | closure acyclic, Lemma 1 (60,689 pairs), accuracy bound 20 |

The six adversarial profiles outside the MOA family: baseline, dense multi-copy, back edges (any), back edges (dominated: closure cyclic, active graph acyclic), back edges (required
slots), MOA with several barrels. Gate totals over ledger, random, the six profiles and real slices: C (emptiness) 4,792/4,792; A sound 3,998/3,998; A complete 3,998/3,998;
A set equality 4,788/4,788 where the enumeration finished; B pointwise 3,998/3,998; B maximizers 3,243/3,243 where a float comparison can separate ties. Largest relative
objective difference per projection: 1.0e-9, the native MIP absolute gap (`nativeSolveOptions`); the gate tolerance is 1e-7.

Structural coverage among the 3,654 gated adversarial cases (a case has several): several slots of one owner 3,584; self-conflict 2,220 (with multi-copy supply 878); pair conflict
2,153; preset copies 2,062; required slots under several parents 1,967; slot conflicts 1,923 (against required slots 1,408, against the blocker's own host slot 1,259); whole-lot
barters 1,861; capped templates 1,824; owned stock 1,675; MOA caps 1,436 (several barrels 1,166, negative cap 287); Tchebycheff 563; tight caps on every limit. Real slices: 131 with
several slots of one owner, 61 with pair conflicts, 35 with preset copies, 20 with slot conflicts (the two real blockers).

## 8. Cyclic graphs (out of scope, information)

300 generated worlds from the back-edge profiles (any, required slots); 43 have a cyclic active graph. Fast differs from the oracle in 18 of them, every time because it admits an
integer point that does not decode to a rooted tree ("counted placements are not reachable from the receiver without repeating an ancestor"); in none does it lose a physical
build. The ledger's one cyclic case, `F03-memoization-context-ancestor`, behaves the same way (Fast enumerates `{t: 1, x: 2}`, which does not decode). So on cyclic graphs the
count model with the connectivity flow remains an outer relaxation whose points need a decoder check, which is ADR 0011's boundary, and the exactness claim needs C4.

## 9. Conclusion and certificate conditions

**Answer: yes, conditionally.** On a weapon whose active template graph is acyclic, `specializeFast`'s integer count/edge model is an exact reformulation of the physical domain
for the projection `pi_sel` (Gates A, B, C), except for the MOA family of section 5.7, which a guard excludes and the dominance rows remove, and which the pinned data cannot meet.
The proof is sections 3 to 5; the gates of section 7 found nothing else in 5,361 gated cases.

Runtime conditions a certified Fast answer needs: (R1) blueprint without error; (R2) `graph.acyclic` of the active graph for this request (`closure acyclic` is a cheaper sufficient
pre-check: all 172 pinned guns); (R3) no TrueErgo/Prevent Overswing (until Fast gets the spatial search over aggregate weight: the weight is an aggregate the count model carries
exactly, so the same theorem should apply node by node, unproved here); (R4) the MOA guard, or the dominance rows, which remove it; (R5) `!matrixFilterRisk` and a qualified native
solve (strict tolerances, presolve off, readback equal) plus rows built through the proof layer (Fast's coefficients are plain doubles today); (R6) infeasible and optimal verdicts
only from qualified solves, with a second opinion for infeasibility (finding 8).

What this does not show: certified answers (the proof layer is missing, R5); anything on cyclic active graphs (section 8) or with TrueErgo/Prevent Overswing; cases the oracle could
not enumerate (`oracle_incomplete`, 424 skipped) beyond the pinned completeness checks; the two real slices stopped at the time cap.
