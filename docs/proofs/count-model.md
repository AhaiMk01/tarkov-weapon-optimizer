# The certified count model of Precise: domain-wide lifting and projection proof

Status: **Revision 1 (2026-10-12)**, after the adversarial review (`docs/proofs/count-model.review.md`) and the owner decisions of
2026-10-12 (F1, G1, G2, GAP 8a; section 12 maps every review finding to its change). Stage 3, workstream 3.2; ADR 0013 section 7; refs #40.
**Amendment 2026-10-13** (owner, F1 extended to first opinions with a verified build): Proposition F1' in section 4.2, section 13.
Written against branch `impl/stage2-correctness-cutover` at commit `a19041c`; Revision 1 re-cites every `file:line` at the working tree of
the Revision 1 change (base `dae163a` plus the code changes of section 12; no file under `reference/oracle/` changed, so oracle citations
are unchanged). Paths are relative to `frontend/` unless they start with `docs/`.

ADR 0013 section 7 asks for "the mathematical domain-wide lifting/projection proof for repaired precise placement/acquisition and
conservative bounds, including all conflict/required/rootedness/quantity assumptions". This document is that proof for the model
production Precise actually solves since Phase 2.10: the template **count model** built through the proof layer (`specializeCount`),
solved by `solvePrecise`. Finite-fixture gates and real-gun runs are cited in section 11 as corroboration only; no proof step rests on
them.

Places where the code does not support a step as written are marked **GAP** with a severity (affects certificates / affects published
non-certificate bounds / affects completeness only / documentation) and what would close them. Section 10 collects them.

---

## 0. Reading guide and the two claims

The proof separates two claims that are easy to conflate.

1. **Exactness of the target model (Theorem E, section 3.4).** Let `M*` be the count model with every constructed coefficient at its
   exact rational value and no outward padding. For a request that reads no TED, the integer feasible set of `M*` projects (base,
   installed multiset) onto exactly the projections of the physical domain the Stage 1 oracle defines, and on each projection the best
   objective of `M*` equals the oracle's exact score. This is Gates A/B/C stated for the whole declared domain instead of one fixture.
2. **Soundness of production's certificates (Theorem S, section 8).** Production does not solve `M*`; it solves the *emitted* model
   `M^E` (padded right-hand sides, double coefficients, a secant for TED, cuts) with a floating-point MIP solver. What transfers is:
   every physical build lifts into `M^E` (an outer relaxation), every published witness is a physical build, every published bound is
   an upper bound of the physical optimum *under the stated native assumptions*, and a certified infeasibility implies the physical domain
   is empty under the same assumptions. Exactness (claim 1) is what makes the optimum *reachable* by a validated witness; soundness
   (claim 2) only needs lifting.

What is **not** proved, ever, is that HiGHS 1.15.1 is correct. Its correctness enters as named assumptions (section 9.2), exactly as
owner decisions 4, 5, 5a and 5b state them.

### Notation

- `w` the weapon, `r` the request (`SolveParams` after normalization), `tau = resolveTolerance(r.objectiveTolerance)`
  (`src/solver/physical/solvePrecise.ts:360-362`), default `1e-5` (`:319`).
- `Q` the rationals. Every binary64 value `x` of the data or request denotes the exact rational `[x]` it encodes (oracle `fromBinary64`,
  production `ratFromDouble`, `src/solver/physical/exact.ts:61`); INTERPRETATIONS.md choice 3.
- For a build `B`: `n_t(B)` the number of installed copies of template `t`; `e_{rho,c}(B)` the number of copies of `c` installed in a
  physical slot whose raw (template) slot id is `rho`; `o_rho(B) = sum_c e_{rho,c}(B)` the occupancy of raw id `rho`; `b(B)` the base.
  `pi(B) = (b(B), n(B))` is the projection of ADR 0010 section 3; `sigma(B) = (b(B), e(B))` the *signature* (it determines `pi(B)` and
  every `o_rho(B)`).

---

## 1. Definitions

### 1.1 The declared domain

A weapon is in the **declared domain** when `preparePhysicalWeapon(lookup, w)` (`src/solver/physical/blueprint.ts:305-732`) returns
without throwing. In particular:

- **(P1) no slot-id collision**: a raw slot id belongs to exactly one template, and one template does not declare an id twice
  (`blueprint.ts:381-397`, `SLOT_ID_COLLISION`). So `owner(rho)` is a function of the raw id.
- **(P2) acyclic reachable part graph**: let `H` be the directed graph on templates with an edge `t -> c` whenever `c` is a *retained*
  allowed id of some slot of `t` (retained = a `mod` entry of the lookup, or the receiver id; `blueprint.ts:355-368`), restricted to the
  templates reachable from the receiver. The breadth-first unrolling (`blueprint.ts:416-456`) expands every retained candidate of every
  occurrence, never prunes, and throws `CYCLIC_PART_GRAPH` as soon as a candidate equals a template on its own root path
  (`blueprint.ts:439-442`). Hence: the blueprint prepares (with `OCCURRENCE_LIMIT` not hit) **iff** `H` is acyclic. Proof: if `H` has a
  cycle `t -> ... -> t` reachable from the receiver, the unrolling creates an occurrence of `t` (reachable), then the chain of occurrences
  along the cycle (each is expanded because nothing prunes), and the ancestor test fires at the repeat; conversely, if `H` is acyclic, no
  template is its own ancestor on any root path, so the test never fires. An allowlist that names the receiver is a cycle (the receiver is
  an ancestor of everything), as the amendment states.
- **(P3)** no slot mixes ammunition and parts (`MIXED_AMMO_SLOT`, `blueprint.ts:369-379`); ammunition-only slots are removed
  (INTERPRETATIONS.md choice 15); presets are on their own receiver with nonnegative integer counts (`BAD_PRESET`, `blueprint.ts:287-303`).
- **(P4)** at most `DEFAULT_MAX_OCCURRENCES = 4,000,000` item occurrences (`blueprint.ts:54`, `:447-453`). Production never passes another
  limit (`solvePrecise.ts:170`).

A request is **accepted** when `prepareSubproblemDomain` and `specializeCount` accept it (finite caps, levels and weights, a valid
`owned_items` multiset, an ideal point when Tchebycheff is on: `src/solver/physical/specializeFast.ts:346-384`,
`src/solver/physical/ownedItems.ts`, `src/solver/physical/acquisition.ts:49-69`). Malformed input is a typed error, never a verdict, and is
out of scope.

Cyclic data (P2 false) is out of scope: it is an internal error (amendment `docs/adr/amendments/2026-10-12-acyclic-precondition.md`).

### 1.2 The physical domain (the Stage 1 oracle)

The truth is the oracle (`reference/oracle/`). `runOracle` (`reference/oracle/oracle.ts:60-97`) enumerates every accessible base times every
rooted tree of non-excluded items (`reference/oracle/enumerate.ts:59-151`) and keeps exactly the builds `inspectBuild` accepts
(`reference/oracle/validate.ts:71-274`). Since the enumerator generates every structurally legal tree, the physical feasible set is

    F_phys(w, r) = { B = (base, placements) : inspectBuild(B) reports no violation },

with path-derived instance ids `parent/slot:item` (`reference/oracle/build.ts`, `childInstanceId`). A build is accepted iff all of the
following hold (oracle code in brackets; all arithmetic exact in `Q`):

| Rule | Statement | Oracle |
| --- | --- | --- |
| R-base | the base is the naked receiver or a preset of `w`, and has a legal offer | `validate.ts:78-86`, `acquisition.ts:158-180` |
| R-id | child instance ids are unique and are not the root id | `validate.ts:88-105` |
| R-root | every placement's parent is the root or a placed instance, and every placement is reachable from the root | `validate.ts:107-128` |
| R-slot | the parent declares the slot id; the item is in that slot's allowlist | `validate.ts:139-149` |
| R-cap | each physical slot `(parentInstance, slotId)` holds at most one child | `validate.ts:134-138` |
| R-anc | no template repeats an ancestor template (the receiver included) | `validate.ts:150-162` |
| R-req | every required slot of the receiver and of every placed rooted instance is occupied | `validate.ts:165-177` |
| R-tconf | no two present templates conflict (either side listing; the receiver is present) | `validate.ts:179-201` |
| R-self | a self-listing template has at most one copy | `validate.ts:186-188` |
| R-sconf | if `p` is placed and `rho` is in `p`'s conflicting slot ids, no placement (any, `p` itself included) sits in a slot with id `rho` | `validate.ts:202-212` |
| R-excl | no placed item is excluded by id or by a category of its chain | `validate.ts:214-224` |
| R-incl | every included id is placed at least once; every include group has a placed item whose chain meets it | `validate.ts:225-232` |
| R-qcap | per item, units beyond (selected preset supply + owned) need a legal standalone offer | `validate.ts:233-237`, `acquisition.ts:241-315` |
| R-price | `spend <= max_price`, `spend` = cheapest legal base lot + sum over items of the exact minimum whole-lot cover of the deficit `d_i = max(0, n_i - q_{b,i} - own_i)` | `validate.ts:242-244`, `acquisition.ts:128-156` |
| R-ergo | `clamp(raw ergonomics, 0, 100) >= min_ergonomics` | `validate.ts:246-248` |
| R-rec | `nakedV (1 + R) <= max_recoil_v`; `(nakedV + nakedH)(1 + R) <= max_recoil_sum`, `R` the summed recoil modifier | `validate.ts:249-255` |
| R-mag, R-sight | `max(receiver value, installed values) >= limit` | `validate.ts:256-261` |
| R-weight | receiver weight + installed weights `<= max_weight` | `validate.ts:262-264` |
| R-moa | `MOA = COI_eff (1 - A/100) K <= max_moa`, `A` the installed accuracy sum, `COI_eff` the largest positive installed COI or the intrinsic one, `K = 1000000/29089` | `validate.ts:265-267`, `stats.ts:53-64` |
| R-ovs | under Prevent Overswing, `TED = clamp(clamp(raw) f, 0, 100) - q(W) >= 0`, `f = max(0, 1 + equip_ergo_modifier)`, `q(W) = max(0, 100 - 300/W)` | `validate.ts:268-270`, `stats.ts:17-36` |

The **score** (`reference/oracle/score.ts:26-85`): `fE = 10 x (TED if use_true_ergo else clamp(raw, 0, 100))`, `fR = 1000 R`, `fP = spend`;
weighted `score = (e/10) fE - r fR - (p/1000) fP`; augmented Tchebycheff with `c_a = w_a / (sum max(range_a, 1))`,
`score = 0.01 (c_e fE - c_r fR - c_p fP) - max over active axes of the signed deviations`, the payoff table being an input
(INTERPRETATIONS.md choices 9, 16, 17). Weights resolve as `max(0, w)` with defaults `1, 1, 0` (`resolve.ts:227-240`). The MOA model is
the provisional ADR 0006 model in both the oracle and production; a MOA-dependent result is fenced to model-relative statuses
(`src/solver/physical/outcome.ts`), which does not change what is proved here.

`OPT(w, r) = max { score(B) : B in F_phys }` (finite set; `-infinity` when empty).

**Data correspondence.** The oracle reads the reference fixture schema; production reads the production `ItemLookup`. The proof is stated
over the production data with the oracle's rules transported through the bridge (`reference/bridge/`, INTERPRETATIONS.md choices 10 and
15): trader keys canonicalized (`acquisition.ts:47`), the flea gate per item (`domain.ts:147-150`), barter lot prices computed exactly by the
data layer (`src/solver/physical/barterPrice.ts:17-24`), naked receivers trader-only, allowlist entries that are not mods dropped, receiver
magazine capacity 0, category chains. That this transport is faithful is **assumption A-DATA** (section 9.1), corroborated by the bridge
tests, not proved.

### 1.3 The request masks (`src/solver/physical/domain.ts:152-310`)

Per template `t >= 1` (`domain.ts:198-231`):

- `excluded(t)`: id excluded or a category of `t`'s chain excluded;
- `receiverBanned(t)`: the receiver lists `t` or `t` lists the receiver (`blueprint.ts:527-538`);
- legal standalone lots `Lots_t` (offer index, lot size `>= 1` integer, price `>= 0`; `acquisition.ts:83-136`), the supply `q_{b,t}` of every
  accessible preset base `b`, the owned count `own_t`;
- `supply(t)` = `standalone` if `Lots_t` is nonempty, else `capped` if some accessible preset supplies `t` or `own_t > 0`, else `none`.

Template-level reason: active iff not excluded, not receiver-banned and `supply != none` (`domain.ts:224-230`).

Accessible bases `Bases`: the naked receiver if it has a legal offer, then each preset with a legal offer (`domain.ts:171-189`), each with
`price_b` = its cheapest legal stored price.

Occurrence masks (`domain.ts:238-289`): **viable** bottom-up (template-level active, and every required slot it owns has a viable candidate),
**contradictions** (no base; a root required slot with no viable candidate), **active** top-down (viable, owner active, domain not empty).

### 1.4 The count model as emitted

`specializeCount(blueprint, domain, r, node?)` (`src/solver/physical/specializeCount.ts:129-138`) asserts Lemma 1 on the domain
(`specializeCount.ts:66-81`) and calls `specializeFast(..., { certified: true })` (`specializeFast.ts:1290-1360`). For an empty domain it
returns a one-row contradiction (`specializeFast.ts:1214-1257`) and production never solves it (`solvePrecise.ts:503-508`).

**Template graph** (`src/solver/physical/templateGraph.ts:61-140`). `T_act` = receiver + templates with an active occurrence (`:66-68`).
For each raw id `rho` owned by an active template: `C(rho)` = the union over active occurrences of the owner of the templates of their active
candidates in their slot of id `rho` (`:74-88`); `rho` is a *graph slot* when `C(rho)` is nonempty (`:93-115`); `req(rho)` its required flag.
`topological` is Kahn's order of `T_act` (`:117-128`); `U_t = maxCopies[t]` (`:147-179`): `U_0 = 1`, and for `c >= 1`
`U_c = max(1, min(activeCount(c), [selfconflict ? 1 : inf], K_c(receiver)))` with `K_c(t) = [t = c] + sum over graph slots rho of t of
max over d in C(rho) of K_c(d)`.

**Columns** (all with finite declared bounds; `src/solver/physical/lpText.ts:98-112` refuses anything else):

| Column | Domain | Kind | Code |
| --- | --- | --- | --- |
| `base_b`, `b in Bases` | [0,1] | binary | `specializeFast.ts:597-600` |
| `n_t`, `t in T_act \ {0}` | [0, U_t] | integer (binary if `U_t = 1`) | `:601-604` |
| `e_rho_c`, graph slot `rho`, `c in C(rho)` | [0, min(U_owner(rho), U_c)] | integer | `:605-616` |
| `z_t` (only for `U_t > 1` and `t` in a conflict clique, a slot-conflict row or the MOA rows) | [0,1] | binary | `:620-632` |
| `lot_t_k` (`lots` mode) | [0, ceil(surrogateMax_t / size_k)] | integer | `:676-682` |
| `raw_ergo, capped_ergo, rec_mod, rec_axis, price_axis, weight, acc_total` | active-range enclosures | continuous | `:808-834` |
| clamp binaries `c1_*`, `c2_*` | [0,1] | binary | `:780-796` |
| `gear_ergo, eff_ergo, ted` (TED requests) | exact enclosures | continuous | `:850-891` |
| `ergo_axis`, `*_n` (power-of-two read-throughs), `tch_t`, `total_obj` | exact or outward enclosures | continuous | `:893-895`, `:1040-1049`, `:1096-1104` |

Here `surrogateMax_t = max(0, U_t - own_t)`.

**Row families** (row names are matched to families by `familyOfRow`, `specializeFast.ts:289-314`, `:464-467`; a row with no variable
left after merging is dropped when true and becomes a `contra_k` row `zero_col >= 1` when false, `:531-562`):

| Family | Rows | Code |
| --- | --- | --- |
| base choice | `sum_b base_b = 1` | `:694-696` |
| parentage | `in_t: n_t - sum_{rho : t in C(rho)} e_rho_t = 0` | `:701-706` |
| slot capacity / required | root `rho`: `sum_c e = 1` if required, `<= 1` if optional and `|C(rho)| > 1` (else the column bound `<= 1`); mod `rho`: `sum_c e - n_owner(rho) = 0` if required, `<= 0` otherwise | `:708-716` |
| presence link | `n_t - U_t z_t <= 0`, `z_t - n_t <= 0` | `:627-629` |
| template conflict | for each clique `K` of `cliqueCover(conflict pairs, T_act)`: `sum_{t in K} pres_t <= 1`, `pres_t = n_t` if `U_t = 1`, else `z_t` | `:730-732`, `:417-461` |
| slot conflict | for each active blocker `t` and blocked raw id `rho` that is a graph slot: `sum_c e_rho_c + V_rho pres_t <= V_rho`, `V_rho = min(U_owner(rho), sum_c max(e_rho_c))` | `:733-745`, `:720-724` |
| includes | `incl_t: n_t >= 1` (an unknown or inactive id: constant false row); `catreq_g: sum_{t active, chain(t) meets g} n_t >= 1` | `:748-762` |
| supply cap | `capped` `t`: `n_t - sum_b q_{b,t} base_b <= own_t` | `:653-657` |
| lot cover | `lots` `t`: `sum_k size_k lot_t_k - n_t + sum_b q_{b,t} base_b >= -own_t` | `:676-687` |
| wallet | `price_axis - sum_b price_b base_b - sum_{linear t} unit_t n_t - sum lot prices x lot = 0` | `:898-902` |
| statistics | `raw_ergo = erg_0 + sum n_t erg_t`; `rec_mod = sum n_t rec_t`; `rec_axis = 1000 rec_mod`; `weight = w_0 + sum n_t w_t` (TED or a weight cap); `acc_total = sum n_t acc_t` (MOA cap) | `:836-842` |
| first clamp | general three-regime clamp `capped_ergo = clamp(raw_ergo, 0, 100)` | `:843`, `:780-796` |
| gear and second clamp | `gear_ergo = f capped_ergo` (one row if `f` is a double, else `f_lo capped <= gear <= f_hi capped`); `eff_ergo = clamp(gear_ergo, 0, 100)` | `:847-864` |
| TED | node rows on `weight`; `ted - eff_ergo + slope weight = -intercept`; `ted >= 0` under Prevent Overswing | `:813-833`, `:865-891` |
| caps | `price_axis <= max_price`; `capped_ergo >= min_ergonomics`; recoil caps padded (below); magazine/sighting `sum_{t: value_t >= L} n_t >= 1` unless the receiver reaches `L`; `weight <= max_weight` | `:906-940` |
| MOA | per active positive-COI template `t`: `(c_t/100) acc - M_t pres_t [+ M_t sum_{coi_b > coi_t} pres_b] >= c_t - L - M_t` padded; fallback `(c_0/100) acc + M_fb sum_b pres_b >= c_0 - L` padded | `:960-983`, `proof.ts:129-176` |
| objective | `total_obj = sum_j c'_j axis_j - tch_t`; Tchebycheff `tch_t + c'_e ergo_axis >= rhs`, `tch_t - c'_a axis_a >= rhs` padded | `:1001-1109`, `proof.ts:297-359` |

Here `c_t = [coi_t] K` (exact), the emitted coefficient of `acc` is the nearest double of `[coi_t] x 10000/29089` (`proof.ts:151-161`),
`M_t` is the smallest double at least the exact need `max(0, max over A in [a_lo, a_hi] of c_t (1 - A/100) - L)`, raised to `1e-6` when
positive (`proof.ts:129-140`). The dominance terms are written iff barrels of different COI are active and (`moaDominance = 'always'` or
`L < 0` and `a_hi > 100`) (`specializeFast.ts:968-970`).

**Padding (the proof layer).** A *constructed* row (a coefficient that is not a binary64 leaf: the recoil-sum coefficient, the MOA
`c/100` coefficients, the Tchebycheff `c_a`) is emitted with right-hand side `paddedRhs` (`proof.ts:92-103`): for target row
`sum a_i y_i (>= | <=) r` with emitted coefficients `a'_i` and column magnitude bounds `B_i`, the need is `r -/+ sum |a'_i - a_i| B_i`
(exact) and the emitted value is the largest double `<=` the need (`>=`) or the smallest `>=` it (`<=`). Every other coefficient is a
binary64 leaf of the data, a small integer, or a power of two, so the text *is* the model there. One constructed right-hand side is padded the
same way: the vertical recoil cap `cap - nakedV` (`specializeFast.ts:915-918`, `paddedRhs` with a zero deficit), which Theorem L treats as a
padded row.

**Target model `M*`.** The same columns and rows with every constructed coefficient at its exact rational value and no padding.

**Texts.** `lp(cuts)` is `M^E` with integer no-good cuts spliced in (`specializeFast.ts:1321`, `src/solver/physical/fastCut.ts:44-102`);
`lpRelaxedEdges()` is the same text with every `e_rho_c` continuous over its declared domain (`specializeFast.ts:1322`, `lpText.ts:150-153`).

**Node.** For a TED request (TrueErgo or Prevent Overswing) the model is specialized on a weight node `[lo, hi]`: rows on `weight`, and the
penalty line of `secantOfPenalty` on the node clipped to the active weight range (`specializeFast.ts:818-833`, `:865-878`,
`src/solver/physical/spatial.ts:81-107`).

---

## 2. Lemma 1 and the structural corollaries

### Lemma 1 (template determinism)

*On the declared domain, for every raw id `rho` and every active occurrence `v` of `owner(rho)`, the set of templates of the active
candidates of `v`'s slot of id `rho` equals `C(rho)`.*

*Proof.* (i) **Unrolled subtrees are template-determined.** For a template `t` let `Tree(t)` be the labelled tree whose root is `t` and
whose root has, for each slot definition of `t` in order, the retained candidates in allowlist order, each with subtree `Tree(c)`. It is
finite because `H` is acyclic (P2). The unrolling appends, for occurrence `v`, the slots `resolveSlotDefs(template(v))` (memoized per
template, `blueprint.ts:344-404`) and, per slot, one candidate occurrence per retained candidate in definition order (`:430-446`); the
ancestor test only throws, it never skips. By induction on the height of `Tree(template(v))`, the subtree at `v` is label-isomorphic to
`Tree(template(v))` (labels: templates, raw slot ids, required flags).

(ii) **Viability is template-determined.** The template-level reason depends on the template only (`domain.ts:198-231`). Viability of `v`
is computed from its template-level reason and the viability of the candidate occurrences of its required slots (`domain.ts:238-255`). By
induction on height and (i), `viable(v) = V(template(v))` for a function `V` of templates.

(iii) **Active candidates.** For `v > 0`, `active(v)` iff the domain is not empty, `viable(v)` and `active(owner(v))` (`domain.ts:275-288`;
`reachable[v]` requires `reason[v] = ACTIVE`, i.e. viable). So for an active `v` and its slot `s` of raw id `rho`, a candidate occurrence `c`
is active iff `V(template(c))`, and the set of active candidate templates is `{ d in Allow_ret(rho) : V(d) }`, which does not depend on `v`.
The union over active occurrences of the owner (nonempty because the owner is active) is that same set: `C(rho)`. QED

The proof is simpler than the research version (`docs/research/acyclic-fast-exactness.md` section 4), which assumed only the *active*
graph acyclic and had to reason about pruned edges; production guarantees the stronger condition (P2), under which the ancestor rule prunes
nothing.

**Code assertion.** `assertCountModelApplies` (`specializeCount.ts:66-81`) checks the conclusion on the very domain: for every active
occurrence and every slot it owns, the distinct active candidate templates equal `C(rho)` (or the empty set when `rho` is no graph slot)
(`specializeCount.ts:87-120`). A failure throws `DOMAIN_INCONSISTENT`, which `solvePrecise` reports as a `SolverError`, never as a fallback
(`solvePrecise.ts:510-515`). The assertion is redundant on the declared domain (Lemma 1), so a failure would mean a defect of the blueprint
or the masks.

### Lemma 2 (the masks lose no physical build)

*If `B in F_phys`, then the domain is not empty and every placement of `B` is at an active occurrence of the blueprint (identifying a
placement with the occurrence of the same path-derived id).*

*Proof.* Each placement's path is a sequence of (raw slot id, allowed item) pairs (R-root, R-slot); every such item is retained (A-DATA),
so the path names an occurrence of the unrolling. Template level: not excluded (R-excl), not receiver-banned (R-tconf: the receiver is
present), and `supply != none` (otherwise any installed copy is a unit beyond preset plus owned supply with no legal offer, violating
R-qcap; preset supply counts only the selected base, which is accessible by R-base, and `domain.ts:207-211` counts every accessible preset).
Viable: by induction on height, every required slot of the occurrence is occupied in `B` (R-req) by a placement whose occurrence is viable.
Active: by induction on depth (R-root). The domain is not empty: `B`'s base is accessible (R-base) and each root required slot holds a
viable placement. QED

### Corollary 1 (trees are template trees)

Let `TT` be the set of finite rooted trees whose root is the receiver and in which a node of template `t` has, for each graph slot `rho` of
`t`, at most one child, of a template in `C(rho)`, and exactly one child when `req(rho)`; children are attached only through graph slots.
Then the map "placements to template tree" is a bijection between the structurally legal trees (R-id to R-req) built of active occurrences
and `TT` (ids are path-derived and determined by the tree).

*Proof.* A structurally legal tree of active occurrences is in `TT` by Lemma 1 (each child's template is an active candidate, hence in
`C(rho)`; a required slot of an active node is a graph slot because the node is viable, so the slot has a viable, hence active, candidate).
Conversely, build the occurrences of a tree of `TT` top-down: the root is active; under an active occurrence of `t`, the candidate occurrence
of a child template `c in C(rho)` exists and is active by Lemma 1. R-anc holds because `H` is acyclic (a repeat on a root path is a cycle of
`H`). QED

### Lemma 3 (copy bounds)

*For every `B in F_phys` and template `t`: `n_t(B) <= U_t`, and `e_{rho,c}(B) <= min(U_owner(rho), U_c)`.*

*Proof.* Distinct copies are distinct active occurrences (Lemma 2), so `n_t <= activeCount(t)`. A self-listing template has `n_t <= 1`
(R-self). By Corollary 1 the tree is in `TT`; by induction in reverse topological order, the number of copies of `c` in the subtree of a node
of template `t` is at most `K_c(t)` (a node holds at most one child per slot). `topological` covers every active template because the
graph is acyclic (every active template other than the receiver has an in-edge, so Kahn's algorithm reaches it), so every `K_c(t)` is
computed (`templateGraph.ts:158-176`). An edge count is bounded by the copies of the owner (one child per slot per copy) and of the child.
QED

**GAP G7 (documentation).** `copyBounds` does not assert that `topological` contains every active template; a template Kahn's algorithm
missed would get `K = 0` and an unsound bound. On the declared domain this cannot happen (Lemma 3), so no certificate is affected; an
assertion `topological.length === |T_act|` would make the dependency explicit.

---

## 3. Lifting and projection

### 3.1 The lifting map

For a node `N = [lo, hi]` (or no node) and `B in F_phys` with `W(B) in N`, define `Lambda(B)`:

- `base_b = 1` for `b = b(B)`; `n_t = n_t(B)`; `e_rho_c = e_{rho,c}(B)`; `z_t = [n_t >= 1]`;
- statistics columns at their exact values (`raw_ergo`, `rec_mod`, `rec_axis`, `weight`, `acc_total`); clamp binaries at a regime of the
  exact value (either regime at a boundary value 0 or 100); `capped_ergo`, `gear_ergo = f capped_ergo` (exact `f`), `eff_ergo`;
  `ted = eff_ergo - (slope W + intercept)`;
- lots: a minimum-cost whole-lot cover of `d_t(B)` over `L_t = nonDominatedLots(Lots_t)` with `lot_t_k <= ceil(surrogateMax_t / size_k)`
  (exists by Lemma A below); `price_axis` the wallet value;
- `ergo_axis = 10 x (ted or capped_ergo)`; read-through columns `axis / 2^k`; `tch_t` = the exact maximum signed deviation over active axes;
  `total_obj` the objective expression; for every cut binary, the value that satisfies its row (Lemma C).

### 3.2 Two arithmetic lemmas

**Lemma N (active ranges are enclosures).** `computeActiveBounds` (`src/solver/physical/bounds.ts:33-83`) returns, for weight, raw
ergonomics, recoil sum and accuracy sum, intervals that contain the exact value of every `B in F_phys`.

*Proof.* The reverse sweep computes, per active occurrence, the floating minimum and maximum over trees of active occurrences of the
statistic of its subtree (required slots add the extreme child, optional slots add `min(0, .)` / `max(0, .)`). Every tree of `B` is such a
tree (Lemma 2). Binary64 addition is monotone in each argument, so the computed minimum is at most the computed value of `B`'s own tree under
the same evaluation order, which differs from the exact value by at most `gamma_m sum_{v in B} |x_v| <= gamma_m absSum` with `m` the number
of terms; `sumEnclosure` (`src/solver/physical/numeric.ts:60-64`) widens by `nextUp((m+1) u absSum)` with `m` the active occurrence count + 1,
and `(m+1) u >= gamma_m = m u / (1 - m u)` whenever `m^2 + m < 2^53`, which (P4) guarantees (`m <= 4,000,002`). Products do not occur;
subnormal sums are exact. The receiver contributes to weight and ergonomics only, as in the oracle (`bounds.ts:48`). QED

**Lemma A (acquisition is exact).** Fix a base `b` and counts `n`. For each `t` let `d_t = max(0, n_t - q_{b,t} - own_t)`.

1. *Dominance.* The minimum whole-lot cover cost of `d_t` over `Lots_t` equals that over `L_t = nonDominatedLots(Lots_t)`
   (`specializeFast.ts:399-410`). An offer is dropped only when an earlier offer in the order (price ascending, size descending) has price
   `<=` and size `>=` (the running `largest` is attained by a kept offer); replacing each dropped lot by its dominator keeps the cover and does
   not raise the cost. Repeated equal offers are dropped likewise.
2. *Lot bounds.* Some minimum cover has `lot_k <= ceil(d_t / size_k) <= ceil(surrogateMax_t / size_k)`: among minimum covers take one with
   the fewest lots; if `lot_k > ceil(d_t/size_k)`, dropping one lot of kind `k` leaves `size_k ceil(d_t/size_k) >= d_t` units and does not
   raise the cost (prices are `>= 0`: trader and flea prices are positive, `acquisition.ts:93-106`; a barter lot price is accepted when
   `>= 0`, `acquisition.ts:102`, and is the barter's positive exact total rounded half-up to an integer, so a total in `(0, 1/2)` is a **free
   lot** of price `0`, `barterPrice.ts:22-23`, oracle `acquisition.ts:79-81`, identically in both; a free lot is still a cost `>= 0`, which is all
   this step uses), contradicting minimality of the lot count. And `d_t <= surrogateMax_t` because `n_t <= U_t` (Lemma 3).
3. *Modes* (`specializeFast.ts:641-690`): `capped` (no legal offer): the oracle allows no paid unit, so the rule is `n_t <= q_{b,t} + own_t`,
   which is the `supcap` row. `covered` (`surrogateMax_t = 0`): `own_t >= U_t >= n_t`, so `d_t = 0`, cost 0, no row needed. `linear`
   (no preset supply, no stock, and either one non-dominated lot of size 1 or `U_t = 1`): `d_t = n_t`; with one non-dominated unit lot every
   legal lot has size 1 and the cheapest price is `lots[0].price`, so the cover costs `n_t x lots[0].price`; with `U_t = 1` a cover of at most
   one unit costs the cheapest lot price, `lots[0].price` (sorted by price). `lots`: the cover row says exactly "the lots deliver at least
   `n_t - q_{b,t} - own_t` units", equivalently at least `d_t` units (lots are nonnegative).
4. *Wallet.* With base binaries summing to one, `price_axis = price_b + sum_t cost_t(lots)`, and `price_b` is the oracle's base price
   (cheapest legal lot of the base). Hence for every model point with base `b` and counts `n`, `price_axis >= spend(b, n)`, with equality at a
   minimum cover, which `Lambda` chooses. The bound `price_axis <= priceUpper` holds at `Lambda(B)` because a minimum cover costs at most
   `sum_k price_k maxLots_k` (plus the base price), and `priceUpper` is the floating sum of these terms widened by `sumEnclosure`
   (`specializeFast.ts:643-689`). Unlike the sums of Lemma N, each term is a floating **product** (`unitPrice * maxCopies`, `:671`;
   `lot.price * lot.maxLots`, `:680`), which adds one rounding of relative size `u` per term. The widening still covers it: a sum of `N`
   rounded products in evaluation order differs from the exact sum by at most `gamma_N` times the sum of absolute values, and `priceTerms`
   (`:644`, `:672`, `:681`) starts at `bases.length >= 1` and counts every product term, so the `m` handed to `sumEnclosure` is at least
   `N` (the number of roundings on any term's path) and `(m+1) u >= gamma_m >= gamma_N` covers it, as in Lemma N (P4 bounds `m`).

There is no explicit deficit surrogate column `u_i`. ADR 0009 principle 1 describes an "unreduced Stage 3 baseline" with `u_i`; the count
model substitutes it into the cover row and applies the dominance, lot-bound and linear reductions, and the decoded deficit `d_i` is never read
from the solver: the validator recomputes it from the placements (`src/solver/physical/validate.ts`, `acquire`-equivalent). Lemma A is the
proof those reductions require. **GAP G6 (documentation):** ADR 0009's baseline text and the emitted form differ; the ADR (or this proof's
reference from it) should record that the count model's acquisition rows are the substituted form.

### 3.3 Lifting (Theorem L)

*Theorem L. On the declared domain, for every accepted request, every node `N` and every `B in F_phys` with `W(B) in N` (all `B` without a
node), `Lambda(B)` satisfies every row and column bound of `M*_N` and of `M^E_N`, and of `lpRelaxedEdges()`, and every cut production
generated (Lemma C).*

*Proof, family by family.*

- **Column bounds.** Counts and edges: Lemma 3. Statistics: Lemma N (the declared domains are exactly those enclosures, `:786-812`).
  `capped_ergo` in `[clamp(lo), clamp(hi)]` by monotonicity of the clamp. `gear` in `gearEnclosure` because `capped >= 0` and
  `f_lo <= f <= f_hi` (`proof.ts:196-202`). `ted` in `differenceEnclosure(eff, lineEnclosure)` (`proof.ts:496-498`, `spatial.ts:126-131`)
  because `W` lies in the clipped node. Lots and `price_axis`: Lemma A. `iScale`/`iAdd` (`numeric.ts:44-54`) round each endpoint once and
  move it one ulp outward, which encloses the exact product or sum; `ratEnclosure` rounds exact rationals outward; so `ergo_axis`,
  `total_obj` and the read-through columns contain their values. The read-through domain is `range / 2^k`, exact endpoint by endpoint:
  this is a precondition, and since Revision 1 it is **asserted**, not assumed: `readThroughRange` (`specializeFast.ts:134-140`, used at
  `:1045`) checks the round trip `scaled * 2^k === range` and throws the internal error `INEXACT_READ_THROUGH` otherwise (an underflow below
  about `2^-1022`), and `exactPowerOfTwoProduct` (`:143-149`, used at `:1057`) checks the coefficient `c 2^k` the same way (no overflow, no
  underflow). So a model is built only when the division is exact (review GAP 8a). `tch_t` in
  `[max_a lo_a, max_a hi_a]` because every deviation lies in its own range (`specializeFast.ts:1076-1097`).
- **Base choice.** One base, accessible (R-base).
- **Parentage `in_t`.** Each copy of `t` has exactly one parent slot (R-root, R-cap), whose raw id `rho` has `t in C(rho)` (Corollary 1).
- **Slot capacity and required occupancy.** For a mod-owned `rho`, the physical slots of id `rho` are exactly the slots of the
  `n_owner(rho)` copies of the owner (P1), each holding at most one child (R-cap) and exactly one when required (R-req); summing gives
  `o_rho <= n_owner` (`=` when required). For a root slot `o_rho <= 1` (`= 1` when required). A required slot of an active template is a graph
  slot (Corollary 1), so no required slot is missing from the rows.
- **Presence link.** `z_t = [n_t >= 1]` satisfies `n_t <= U_t z_t` (Lemma 3) and `z_t <= n_t`.
- **Template conflicts.** Every clique of `cliqueCover` is a set of pairwise conflicting templates: the candidates are the common neighbours
  of the seed pair and are filtered to neighbours of every added member (`specializeFast.ts:442-456`). By R-tconf at most one member is
  present.
- **Slot conflicts.** If the blocker `t` is present then `o_rho(B) = 0` (R-sconf, P1: every slot of id `rho` is a slot of the owner's copies;
  the blocker's own host slot included), so the row reads `0 + V_rho <= V_rho`. If absent, `o_rho <= V_rho` because `o_rho <= n_owner <=
  U_owner` and `o_rho <= sum_c max(e_rho_c)` (Lemma 3).
- **Includes.** R-incl; an included id that names no active template cannot be placed (Lemma 2), so the oracle has no build and the
  constant-false row is consistent with `F_phys` empty. A category group matches only through placed (hence active, Lemma 2) templates.
- **Supply cap, lot cover, wallet.** Lemma A.
- **Statistics.** The rows are equalities over binary64 leaves with integer counts: their real values are the oracle's exact sums
  (fromBinary64 of the same leaves; INTERPRETATIONS.md choice 3).
- **Clamps.** The three-regime clamp with `m = ceil(nextUp(max(|lo|, |hi|, cap) + cap))` (`specializeFast.ts:780-796`): for the regime of the
  exact value every row holds (low: source `<= 0`, target `= 0`; mid: `0 <= source <= cap`, target `=` source; high: source `>= cap`, target
  `= cap`), and the rows of the other regimes are slack because `m >= max(|lo|, |hi|, cap) + cap` (the floating sum is within half an ulp of
  the real one, so `nextUp` of it is at least the real sum). The target bounds `[clamp(lo), clamp(hi)] subset [0, 100]` force `target = 0`
  or `= cap` in the outer regimes, as the rows require.
- **Gear.** `f = max(0, 1 + modifier)` exactly (`proof.ts:190-193`, oracle `resolve.ts:267`); the equality row when `f` is a double, else
  the two neighbour rows enclose `f capped`.
- **TED node.** `W(B) in [lo, hi]` satisfies the node rows exactly (they are rows on the exact weight). Lemma T (section 4.2): the line is
  `<= q` on the clipped node, so `ted(Lambda(B)) = eff - line(W) >= eff - q(W) = TED(B)`; under Prevent Overswing `TED(B) >= 0` (R-ovs)
  gives `ted >= 0`.
- **Caps.** `lim_price`: `price_axis = spend <= max_price` (R-price, Lemma A). `lim_min_ergo`: R-ergo on the first clamp
  (INTERPRETATIONS.md choice 8). Recoil: `nakedV (1 + R) <= capV` iff `nakedV R <= capV - nakedV` (any sign of `nakedV`, no division,
  `:888-904`); the vertical coefficient is the leaf itself; the sum coefficient is the nearest double of `nakedV + nakedH`, and the padding
  covers `|coef' - coef| max|R|` (Lemma N bounds `|R|`), so the emitted row holds at the exact `R` (`proof.ts:92-103`). Magazine/sighting:
  the oracle's maximum reaches `L` iff the receiver does or some installed template does (`:909-916`). Weight: exact.
- **MOA.** Lemma M below.
- **Objective rows.** The deviation rows of `M*` hold at `tch_t = max deviation`; those of `M^E` are padded by
  `|c'_a - c_a| B_axis` in the relaxing direction (`proof.ts:320-333`), so they hold too. `obj_def` and the read-through link rows are
  definitions.
- **Constant rows.** A dropped constant-true row says nothing. A constant-false row is only written when the corresponding oracle rule fails
  for every build (includes of inactive ids, a magazine or sighting minimum no active template reaches, a node disjoint from the active
  weight range, a padded row whose variables vanished: since the emitted row relaxes the target, a false emitted constant row has a false
  target), so it never cuts a physical build.

**Lemma M (MOA rows).** *Let `L = max_moa`, `a = [a_lo, a_hi]` the active accuracy enclosure (Lemma N), `P` the active templates with
`coi > 0`. For every `B in F_phys`, every replacement and fallback row holds at `Lambda(B)`; conversely, every point satisfying the rows of
`M*` satisfies R-moa.*

*Proof.* Write `A = A(B)` and `c_t = [coi_t] K > 0`; R-moa is `c_max (1 - A/100) <= L` with `c_max` the largest `c_t` over installed
`t in P`, or `c_0 (1 - A/100) <= L` when none is installed (`stats.ts:53-64`; production `barrels` are exactly the active templates with
positive COI, `:943`, matching the oracle's "any installed item with COI > 0").

- *Big-M validity.* `M_t >= max over A in a of c_t (1 - A/100) - L` (exact need, rounded up, `proof.ts:129-140`). So a replacement row
  with `pres_t = 0`, or with a present strictly larger barrel (dominance terms add at least `M_t`), reduces to
  `(c_t/100) A >= c_t - L - M_t`, true on `a`. Same for the fallback row with a barrel present (`M_fb` for `c_0`).
- *Binding rows.* With `pres_t = 1` and no strictly larger barrel present, the row is `(c_t/100) A >= c_t - L`, i.e.
  `c_t (1 - A/100) <= L`. With no barrel present the fallback is `c_0 (1 - A/100) <= L`.
- *Dominance mode.* The binding rows are exactly those of the installed barrels of maximal COI (equal COIs bind together and are identical),
  plus the fallback when none is installed: this is R-moa, in both directions.
- *Plain mode* (no dominance terms) is written only when not (`different` and `L < 0` and `a_hi > 100`). It binds the row of every installed
  barrel. Lifting: if all installed barrels have the same COI, the rows coincide with R-moa; if `A <= 100` (implied by `a_hi <= 100`,
  Lemma N), `1 - A/100 >= 0` and `c_t (1 - A/100) <= c_max (1 - A/100) <= L`; if `L >= 0` and `A > 100`, every `c_t (1 - A/100) < 0 <= L`.
  Projection: the rows include the one of the largest installed barrel, so R-moa holds.
- *Padding.* Only the `c/100` coefficient is constructed (the target uses the emitted `M`), and the padding covers
  `|c'/100 - c/100| max|A|` (`proof.ts:157-159`, `:172-174`), so the emitted rows hold wherever the target rows do. A zero intrinsic COI
  gives a fallback row `M_fb sum pres_b >= -L` (or a constant row), which states "some barrel, or `L >= 0`", as R-moa does with
  `c_0 = 0`. QED

This closes the research report's one deviation (section 5.7): the certified model never relies on the guard (C3), it states the oracle's rule.

### 3.4 Projection (Theorem P) and exactness (Theorem E)

**Lemma D (decoder).** *Let `E = (base, e)` be integers such that exactly one base is 1 and, with `n_t := sum_{rho: t in C(rho)} e_{rho,t}`,
every slot/required row and every edge bound holds. Then `placeGreedily` (`src/solver/physical/decodeFast.ts:99-124`) consumes every count
and returns a tree `T in TT` with `sigma(T) = E`; it satisfies R-id, R-root, R-slot, R-cap, R-anc and R-req.*

*Proof.* Process instances breadth first. Claim by induction along `topological`: template `t` receives exactly `n_t` instances and every
slot of `t` has all its counts consumed. The receiver has one instance; a root slot's counts sum to at most 1 (its row, or the column bound
`min(1, U_c) <= 1` when an optional root slot has a single candidate and no row), so the receiver consumes them. For `t` later in the order,
every slot holding `t` belongs to an earlier template (the order is topological, every edge `u -> t` has `u` earlier), whose counts were all
consumed, so `t` received `sum e_{rho,t} = n_t` instances. Each instance takes one child per slot while the slot's remaining count is
positive; after the `n_t` instances of the owner, `min(n_t, sum_c e_{rho,c}) = sum_c e_{rho,c}` children were taken (the slot row), so the
counts of `t`'s slots are consumed. Termination: each step consumes a count. Structure: one child per (instance, slot) (R-cap); the child's
template is in `C(rho)`, a subset of the retained allowlist of `rho`, and `rho` is a slot of the instance's template (P1) (R-slot); a required
slot has `sum_c e = n_owner` (or `= 1` at the root), so each of the `n_owner` instances takes one (R-req; every required slot of an active
template is a graph slot, Corollary 1); ids are `parent/slot:item` and unique (R-id); every instance is created under an existing one (R-root);
no template repeats on a root path because `H` is acyclic (R-anc). `sigma(T) = E` because every count was consumed exactly. QED

**Theorem P (projection).** *For every integer point `x` of `M^E_N` (exact real feasibility), `decodeFast(x)` is defined and returns a build
`T` with `sigma(T) = (base(x), e(x))`, `n(T) = n(x)`, such that `T` satisfies every oracle rule except R-rec, R-moa and R-ovs, which hold up
to the padding of their rows (and, for R-ovs, up to the gear and penalty-line relaxation of section 4.2). For an integer point of `M*_N`
on a node whose line is `q` itself (`hi <= 3`), and for a request that reads no TED, `T in F_phys`.*

*Proof.* `in_t` gives `n(x) = n(E)`, so Lemma D applies. Templates of `T` are active (edges only lead to active templates), so R-excl holds
and no template has `supply = none`. R-base: the base column ranges over accessible bases. R-tconf: every conflict pair of active templates
lies in some clique (every pair is seeded if uncovered, `specializeFast.ts:439-458`) and `pres_t = [n_t >= 1]` (presence link or `n_t`
binary); pairs with the receiver are masked; an inactive side is never present. R-self: `U_t = 1` for a self-listing template
(`templateGraph.ts:161`). R-sconf: `o_rho(T) = sum_c e_rho_c`, and the row with `pres_t = 1` forces it to 0; a blocked raw id that is no
graph slot has no active candidate, so its occupancy is 0. R-incl: the rows. R-qcap: `supcap`. R-price: Lemma A (`spend <= price_axis <=
max_price`). R-ergo, R-mag, R-sight, R-weight: exact rows on exact sums. R-rec, R-moa: the rows of `M*` are the rules exactly (Lemma M); the
emitted rows relax them by their allowance. R-ovs: `ted >= 0` with `ted = eff - line(W) >= TED`, exact when the line is `q` and `f` is a
double. QED

**Theorem E (exactness of the target model).** *For a request that reads no TED, `pi(F_int(M*)) = pi(F_phys)`, `F_int(M*)` is empty iff
`F_phys` is, and for every `B in F_phys`,
`max { obj*(x) : x in F_int(M*), pi(Decode(x)) = pi(B) } = score(B)`. The same holds node by node for a TED request on a node with
`hi <= 3` and a double gear factor. On any other TED node the model's objective is an upper bound per projection (section 4.2).*

*Proof.* `subseteq` and the emptiness equivalence: Theorems L and P. Objective: at `Lambda(B)`, `obj* = score(B)` (the axes are the exact
coordinates, `tch_t` the exact maximum deviation, `price_axis = spend`). For any `x` with the same projection, `ergo_axis` and `rec_axis` are
determined by `n` (the clamp rows determine `capped` up to the boundary, where both regimes give the same value), `price_axis >= spend`
(Lemma A) with a nonpositive coefficient (`-p/1000` or `-0.01 c_p`, `c_p >= 0`), and `tch_t >= ` every active deviation, each nondecreasing
in `price_axis`, with coefficient `-1`; so `obj*(x) <= score(B)`. QED

**Lemma F (validity factors through the signature).** *If `T, T'` are structurally legal (R-id to R-req) and `sigma(T) = sigma(T')`, then
`T in F_phys` iff `T' in F_phys`, and `score(T) = score(T')`.*

*Proof.* Every non-structural rule is a function of the base, the multiset `n` and the raw-id occupancies `o_rho`: R-base (base), R-tconf,
R-self, R-excl, R-incl (`n`), R-sconf (presence of the blocker and `o_rho`), R-qcap and R-price (`acquire` prices each item's deficit from
its count; the per-occurrence allocation order changes labels, not costs: `acquisition.ts:241-315`), R-ergo, R-rec, R-mag, R-sight,
R-weight, R-moa, R-ovs and the score (sums and maxima over the multiset). The signature determines all three. QED

---

## 4. Objective equality, numerics and the TED search

### 4.1 Scaled coefficients and the frame error

The LP objective is in the oracle's frame (`ObjectiveMeta.toOracle = { scale: 1, offset: 0 }`, `specialize.ts:104-105`). `planObjective`
(`proof.ts:297-359`) computes each axis coefficient's exact target (`e/10`, `-r`, `-p/1000`; or `0.01 c_e`, `-0.01 c_r`, `-0.01 c_p` with the
exact `c_a` of `proof.ts:275-291`, identical to `score.ts:46-61`), emits the nearest double, and accumulates

    frameError = roundUp( sum_j |c'_j - c_j| max(|lo_j|, |hi_j|) )

over the axis column domains. An axis whose coefficient HiGHS would filter is read through `axis_n = axis / 2^k` with the exact coefficient
`c' 2^k` (`proof.ts:378-392`, `specializeFast.ts:1040-1062`): the objective function is unchanged. If no `k <= 40` works, `withheld` is set and
every solve is unqualified (`nativeProof.ts:92`).

**Lemma O.** *For every point `x` whose axis columns lie in their domains, `|obj^E(x) - obj*(x)| <= frameError`, where `obj^E` and `obj*`
use the same `tch_t`. Hence `obj^E(Lambda(B)) >= score(B) - frameError` for every `B in F_phys` in the node, and also on TED nodes (where
`obj*(Lambda(B)) >= score(B)` because `ted >= TED`).*

*Proof.* Both are linear in the axes with the same `-tch_t`; the difference is `sum_j (c'_j - c_j) axis_j`. The deviation rows of `M^E` are
padded (Theorem L), so `Lambda(B)` with `tch_t` at the exact maximum deviation is feasible in `M^E`. QED

The constants: `K = 1000000/29089` is an exact rational in the proof layer (`proof.ts:54-56`) and in the oracle (`constants.ts`); both clamps
are over `[0, 100]` in the code (`specialize.ts:24`) and the oracle (`constants.ts`, `ERGO_CLAMP_MAX = 100`). **GAP G6 (documentation):**
ADR 0007 principle 5 still writes the clamp domain as `[0, 1000]`; the oracle and the code agree on 100.

The incumbent is scored from the validator's exact rational statistics (`exactObjectiveScore`, `proof.ts:418-431`, the same formula as
`score.ts:63-81` with the same resolved weights, `solvePrecise.ts:591`), never from solver values; its enclosure
`[roundDown(s), roundUp(s)]` gives the published lower bound (`proof.ts:443-445`).

### 4.2 The TED spatial search

**Lemma T (per-node penalty lines).** *For every node `[lo, hi]` and its clipped interval `[lo', hi']`, the line `l` the model uses satisfies
`l(W) <= q(W)` for every real `W in [lo', hi']`.*

*Proof* (`spatial.ts:81-107`). `hi' <= 3`: `l = 0 = q`. `lo' = hi'`: `l` = the largest double `<= q(lo')`. `lo' < 3 < hi'`: `l = 0 <= q`.
`3 <= lo' < hi'`: `q(W) = 100 - 300/W` is concave on `[3, inf)` (`q'' = -600/W^3 < 0`), so the exact chord lies below `q`; the emitted slope is
the nearest double of the exact slope, and the emitted intercept is the largest double such that the emitted line is at or below the exact
chord at both ends (`:97-101`, exact rationals); a line below the chord at both ends is below it in between. A supplied line is checked in
exact arithmetic at the ends and at 3 kg (`spatial.ts:113-120`, `specialize.ts:128-134`): on each piece `l - q` is convex, so its maximum
is at an end. QED

Consequences: on every node the model's `ted` is at least the exact TED of the build (Theorem L), so the node's optimum (and any qualified
bound of it) bounds the best exact score in the node, and Prevent Overswing is relaxed, never tightened. A *singleton* node (`lo = hi`) and
a node within the free region are `exact` (`spatial.ts:83-90`): the line is `q` up to `shift` (at most one ulp of `q`), so a qualified bound
there exceeds the node optimum by at most `gain x shift` (`specializeFast.ts:1108-1119`), which only makes the bound more conservative. The
`shift` and the gear-neighbour error are reported but need not be added to any bound, because both act in the relaxing direction.

**Node cover.** The roots are the active weight range clipped by `max_weight` and split at 3 kg (`solvePrecise.ts:368-374`); a split gives
the two closed halves `[lo, p]`, `[p, hi]` (`search.ts:186-194`). Every `B in F_phys` has `W(B)` in the active range (Lemma N) and
`W(B) <= max_weight` when capped, so `W(B)` lies in some root and, after every split, in some child: the leaves of the search tree cover
`F_phys` at every moment.

**Proposition F1 (the split-only shortcut is sound and issues nothing).** *Owner decision F1 (2026-10-12): when the first opinion of an inexact
node is a qualified Optimal with no verified build, no rejected point and a split point `p`, and (with an incumbent `I`) its proved bound
`U` satisfies `U - score(I) > tau` (`leadsOnlyToSplit`, `solvePrecise.ts:468-473`, applied by `splitOnly`, `:786-790`, at `:768`, `:826` and
`:881`), the node is returned as the evaluation `split` without a second opinion. Then (i) the node cover is preserved, (ii) the evaluation
contributes no bound, prunes no region and certifies nothing, and (iii) every certificate still rests only on settled verdicts.*

*Proof.* (i) The search handles `split` in one place (`search.ts:341-352`): it splits the node's interval at `p` (clamped) into the two
closed halves `[lo, p']`, `[p', hi]` (`splitInterval`, `:186-194`), which cover the node, and pushes both live; when the interval cannot be
split it pushes the node itself back live and stops (the resolution reason). In both cases every `B` of the node lies in a live node, so
nothing is discarded. (ii) The branch never reads `evaluation.evidence` (Precise sets `evidence: null` anyway, `:789`, and `evaluate`
nulls the evidence of every non-`solved` verdict, `:800-802`); a candidate, which a `split` carries only when `withKept` adds a build
verified by another solve of the node, updates the incumbent like any verified build (`search.ts:337-340`). Each child is created with the
node's OWN bound (`node.bound`), which is the parent's settled bound or unknown, never `U`. It neither fathoms (no `withinTolerance` test,
no join into `fathomed`) nor marks anything infeasible, and the search cannot complete while the children are live. So no published bound,
gap, emptiness or certificate depends on the single solve. (iii) A certificate (optimality or emptiness) needs the search to complete (`:393`), i.e. every node to be
closed as `infeasible` or `solved`, each by a settled verdict (or an exact `provedEmpty`); a `split` closes nothing, so it can only add live
nodes that must themselves be closed that way. The guard in `leadsOnlyToSplit` keeps the full decision-5a rule exactly where the single
solve would have closed the node: a first opinion whose own bound is within `tau` of the incumbent (or has no proved bound while an
incumbent exists) is confirmed as before. When the guard passes, `U - score(I) > tau`, and a settled verdict's bound is the LARGEST
qualified bound of its opinions (`solvePrecise.ts:432-438`), hence `>= U`: had the node been confirmed and settled, it would not have been
within `tau` and would have been split (`search.ts:362-375`), with children inheriting a bound instead of the parent's. The shortcut only
drops that settled bound from the children. QED

The shortcut can make a search split where the confirmed bound would have been within `tau` of a LATER incumbent (the incumbent can improve
after the node was handed out); the children are then solved again, which costs time and loses nothing. It never runs on an exact node
(where a `solved` verdict closes the node and is certificate-bearing) or on a root without an interval.

**Proposition F1' (the shortcut with a witness, owner 2026-10-13).** *Production's rule (`PRECISE_SPLIT_SHORTCUT = 'witness'`,
`leadsOnlyToSplit`, `solvePrecise.ts:498-517`, applied by `splitOnly`, `:832-837`, at `:812`, `:873` and `:928`) also returns `split` without a
second opinion when the first opinion `o` of an inexact node `N` with interval `[lo, hi]` is a qualified Optimal with no rejected point and a
split point `p`, possibly WITH a verified build `B_o`, provided (a) `splitInterval([lo, hi], p)` is not `null`, and (b) `o` has a proved bound
`U` with `U - R > tau`, where `R` is the largest exact score among the incumbent `I` handed out with the node (`SearchNode.incumbentExact`), `B_o`
and every other verified build `K` the evaluation hands the search (the build `withKept` adds from the relaxed try, passed as `others` at `:928`);
with no incumbent and no build the condition holds vacuously (as in F1). The evaluation carries `B_o` as its candidate (`:836`). A MOA floor query
(`stopAtFirstWitness` or `nativeStop`) uses the 2026-10-12 rule (`:826`). Then (i), (ii) and (iii) of Proposition F1 hold, and additionally
(iv) every build the evaluation carries is a valid witness, and (v) no value of `U`, right or wrong, can make the shortcut prune, fathom,
certify or publish anything.*

*Proof.* (i) By (a) the search's `split` branch (`search.ts:344-353`) always takes the two closed halves, never the resolution stop, so the
node is replaced by two live nodes that cover it. (ii) As in F1: the branch never reads `evidence` (it is `null` at the source and nulled again in
`evaluate`, `solvePrecise.ts:849`), and both children are created with `node.bound`, the node's settled-or-unknown inherited bound, never `U`.
(iii) As in F1: `split` closes no node, and a certificate needs every node closed by a settled verdict or an exact `provedEmpty`. (iv) `B_o`
and `K` passed the independent validator and carry the exact rational score of the validator's statistics (`judge`, Theorem S.1, A-VAL
soundness); whether the solve that produced a point was right, wrong or unconfirmed is irrelevant to a validated build, so the search may add
it to the incumbent like any other (`search.ts:340-343`, BEFORE the `split` branch). The published lower bound is the downward enclosure of
the incumbent's exact score and stays `<= OPT`. (v) The decision-5a defect is a wrong Optimal whose bound may be wrong in either direction.
If `U` is too high (above the best score in `N`), the shortcut splits `N`, which is sound by (i) to (iii) for any `U`: splitting needs no
correct bound. If `U` is too low and still `U - R > tau`, the same holds. If `U` is too low with `U - R <= tau` (or `U` is unproved), condition
(b) fails and the full decision-5a rule runs: a second opinion with another seed, a third on disagreement, and a settled bound equal to the
LARGEST qualified bound among the opinions (`settleOpinions`, `:447-478`), so the low `U` can neither fathom the node nor enter a bound. In
every case the only use of `U` is the comparison in (b), and both outcomes of it are sound.

*What the rule keeps of the 2026-10-12 decision.* The search updates the incumbent with the evaluation's candidates before it decides, so when
it reaches the `split` branch the incumbent's exact score is `max(score(I), score(B_o), score(K)) = R` (the candidate the search receives is the
better of `B_o` and `K`, `withKept`). Had the node been confirmed and settled, its bound `S` would be `>= U > R + tau` (the largest qualified
bound), so it would not have been within `tau` of the updated incumbent and the search would have split it (`search.ts:362-375`), the
children inheriting `min(node.bound, S)` instead of `node.bound`; had it not settled, the search would have stopped (unresolved). So the rule
fires only where the full rule would split or stop, never where it would fathom (b), close an exact node, certify emptiness (the opinion is an
Optimal with a point, which blocks impossible, G2) or stop at the resolution limit (a). The cost side is the same as F1's: a child without
the parent's settled bound cannot be fathomed by a later incumbent before it is evaluated (measured: `docs/stage3/split-shortcut.md`).
Theorem S is unaffected: its proof uses the node cover, the settled origin of every bound, the validated incumbent and the closure condition
of `completed`, and F1' preserves each. QED

**Certified optimality transfers.** The search (`search.ts:269-395`) keeps every node either live (its inherited bound), closed as
`infeasible`, closed as `solved` (exact, or within `tau` of the incumbent: `:362-369`, `:283-293`), the latter two contributing their bound
to `fathomed`, or replaced by its two live halves (`split`, Proposition F1, `:341-352`). The global upper bound is `join(incumbent, fathomed, live)` (`:300-309`), an unknown bound absorbing (`:158-163`).
`certified` requires no stop and `UB - score(incumbent) <= tau` on exact rationals (`:393`). By the node cover and Theorem B below, each
closed-solved or live node's bound is at least the best exact score in it, and an infeasible node holds no build (Theorem I); hence
`UB >= OPT`, and certified implies `score(incumbent) >= OPT - tau`.

---

## 5. Bounds

### Theorem B (node bounds)

*Let a node evaluation carry `BoundEvidence` that is qualified, with native dual bound `D` (`nativeProof.ts:160-170`). Under A1 (section
9.2), `UB_N = [D] + [frameError]` (exact, `proof.ts:470-475`) is at least `max { score(B) : B in F_phys, W(B) in N }`.*

*Proof.* Qualification (`nativeProof.ts:85-153`) requires: the parsed model equals the emitted text bit for bit (rows, bounds, objective,
integrality, coefficients; a filtered coefficient is a difference), every padded row's parsed right-hand side dominates its exact need, the
declared tolerances and matrix thresholds are in force, presolve is off, and no proof input was withheld. So the parsed model is `M^E_N`
(with the solved text's cuts, or its relaxed-edge variant). Every `B` in the node lifts to a point of it (Theorem L; Lemma C for cuts;
the relaxed text contains the integer text). By A1, `D >= max obj^E >= obj^E(Lambda(B)) >= score(B) - frameError` (Lemma O). QED

The search turns this into node bounds in one place (`search.ts:143-147`: the tighter of the parent's bound and the proved one; unqualified
evidence leaves the parent's bound, unknown at a root) and composes them in one place (`:158-163`, `:300-309`). Since Revision 1 only a
**settled** verdict reaches that place with evidence: `evaluate` replaces the evidence of every `unresolved`, `failed` or `split` evaluation
by `null` (`solvePrecise.ts:800-802`), and `settleOpinions` returns `null` evidence whenever it does not settle (`:459-460`). So every node
bound, and therefore every published upper bound and gap, is a maximum of bounds each backed by two agreeing qualified solves (A1 and A3),
or unknown (G1 closed, below). Published values are enclosed
upward (`boundToNumber`, `ratRoundUp`), the gap is `roundUp(UB - score)` (`:303-307`), and an unknown bound travels as `null`
(`search.ts:246-252`). The published lower bound is `roundDown(score(incumbent)) <= score(incumbent) <= OPT`.

### What the native assumptions cover, and what they do not

- **Decision 4 (arithmetic noise).** A1 is assumed, but HiGHS's node LP solves are floating point and the pinned build exports no node duals,
  so the dual bound can fall below the exact maximum by an unbounded (observed: up to `5e-12` absolute) amount. Nothing is added for it. The
  certified statement is therefore exactly: `OPT <= UB + eps_native`, with `eps_native` assumed zero and observed tiny
  (`NATIVE_FRAME.assumptions[0]`, `nativeProof.ts:44`).
- **Decision 5b (two-sided integrality shift).** With integrality tolerance `1e-7`, HiGHS may accept a point within `1e-7` of integral and
  close the search with a dual bound *below* the exact optimum by up to (objective sensitivity of the column) x `1e-7`; observed once
  (`1.1e-5`). This is a known deviation from A1, accepted by the owner (`nativeProof.ts:47`). It is not detected unless a verified build of the
  same node beats the bound.
- **The bound sanity guard is sound but not complete, and is not part of the proof.** `judge` withholds a qualified bound that a build verified
  in the same solve beats by more than `max(tau, 1e-9 max(1, |bound|))` (`solvePrecise.ts:604-614`). It can only remove bounds (making the
  result less certified), so it cannot make a bound unsound. It detects only shortfalls that a verified build of the same node exposes, and
  its threshold scales with the request tolerance (with a loose `tau` it accepts large shortfalls). **GAP G8 (documentation):** the code
  comment calls it "a sanity guard on the proof inputs, not an allowance"; that is right, and nothing in the proof may lean on it.
- **Decision 5a (second opinion).** A certificate-bearing node verdict (a qualified Optimal whose bound enters a certified gap, or a qualified
  Infeasible) is settled only by two agreeing qualified solves with different seeds, a third on disagreement (`solvePrecise.ts:409-473`,
  `:676-716`); the settled bound is the *largest* qualified bound among all the node's opinions (`:432-438`), so a disagreeing lower bound
  never wins. The assumption is that two agreeing solves are not wrong the same way (A3).
- **Retry seeds, never throw.** An inconclusive solve (`SolveError`, `PresolveError`, `PostsolveError`) is no opinion (`nativeSolve.ts:179-181`,
  `solvePrecise.ts:663-669`, `:694-701`); running out of seeds leaves the node unresolved (no certificate). This affects completeness only.
- **Limit-stopped solves.** `boundEvidenceOf` takes the MIP dual bound of any qualified solve, including a time- or solution-limited one
  (`nativeProof.ts:162-164`). Since Revision 1 such a bound never reaches the search: a limit stop is no verdict, so it never settles a node,
  and its node keeps only its inherited bound (G1). Its evidence is still read for one purpose: a qualified limit stop that returned a primal
  point blocks an Infeasible settlement (G2).

**G1 (closed in Revision 1, owner decision "Only checked bounds", 2026-10-12).** Before Revision 1 a node that stopped unresolved or failed
could keep the qualified bound of a *single* solve, and that bound was published as `upper_bound` (and gap) of a `feasible` or `incomplete`
result, resting on A1 alone. The sources were (review finding 4 added the last two):

1. a limit-stopped first opinion (`unconfirmed`, `solvePrecise.ts:719-727`, reached at `:880` and, for the relaxed text, `:828`);
2. a second or third opinion that times out, stops on a limit or is not qualified, after a qualified Optimal, and an unresolved disagreement
   (`:704-705`, then `settleOpinions`, `:459-460`);
3. the relaxed first try's bound carried through the fallback into `relaxationAgrees` (`relaxedUncut`, `:830`; the veto return, `:751`) and
   the unresolved return of `relaxationAgrees` (`:774-778`);
4. `failed` evaluations, which carried the rejected solve's dual bound (`failed`, `:729-731`, reached at `:874`, `:879` and `:839`);
5. the `stopAtFirstWitness` short-circuit of a MOA floor query (`:681-688`).

Each now carries `evidence: null` at its source, and `evaluate` enforces the rule once for every verdict other than `solved`
(`:800-802`). A node without a settled verdict therefore keeps its inherited bound: the settled bound of its parent, or unknown at a root.
Because `joinBounds` makes an unknown bound absorbing (`search.ts:158-163`), a search that stops with such a node live publishes **no**
finite upper bound and no gap (`null` on the wire, `transportedBounds`, `:246-252`): this is explicit and intended. The lower bound (the
verified incumbent) is still published. The result Details show an unknown bound as "unknown", never as a number
(`components/common/ResultStatus.tsx:79-96`, `resultView.ts:228-235`). Explore rows and Gunsmith results take their bounds from the same
summary (`solver.ts:247-254`); the MOA floor publishes no upper bound (its `hi` is a validated witness and its `lo` a settled qualified
emptiness, `moaFloor.ts:272-279`).

### What is not proved

- The correctness of HiGHS 1.15.1 (dual bounds, Infeasible verdicts, primal feasibility within tolerances). Every use is behind A1-A4.
- That the strict LP reader (`parseLpText`) and `compareReadback` implement model equality, and that the readback is the model that was solved
  (`NATIVE_FRAME.assumptions[1]`).
- That the production validator agrees with the oracle (A-VAL), and that the data transport is faithful (A-DATA).
- Termination within the deadline, and completeness of any certificate (sections 6 and 7 state the conditions).

---

## 6. Infeasibility

### Theorem I (soundness)

*Under A2-A4 (and with no assumption at all in case (a) and case (b).1), if `solvePrecise` returns `kind: 'empty'`, then `F_phys = empty`.*

*Proof.* `kind: 'empty'` arises in two ways.

(a) `domain.empty` (`solvePrecise.ts:503-508`): no accessible base, or a root required slot with no viable candidate (`domain.ts:258-268`).
By Lemma 2 a physical build would make the domain nonempty. Exact, no native call.

(b) The spatial search completed with no incumbent and nothing fathomed (`search.ts:392`): every leaf node was closed `infeasible`. By the
node cover, it suffices that each `infeasible` verdict implies the node holds no physical build. The verdict comes only from:

1. `model.provedEmpty` (`solvePrecise.ts:794-797`): a constant false row; such rows are implied by the oracle's rules for every build of
   the node (Theorem L, constant rows), so the node is empty. Exact.
2. The relaxed-edge text settled Infeasible by two agreeing qualified verdicts with no verified build among the opinions: in the
   relaxed-first try (`:823-824`) or in `relaxationAgrees` (`:754-762`). The relaxed text contains `Lambda(B)` for every `B` in the node and
   every cut is satisfied by it (Theorem L, Lemma C). Under A4 the relaxed text has no real feasible point, so no `B` exists.
3. An integer text with no edge column settled Infeasible (`:747`). Its relaxed text is the same text, so no independent relaxation check
   exists: the verdict rests on **A3 alone** (two agreeing qualified solves of an integer text), not on an independent A4 check (review
   GAP 8b). This matters only for edge-free models, which are trivial (no graph slot, a base choice only); the 2026-10-12 defect that motivated
   "relaxation must agree" was an integer text WITH edges.

An integer-text Infeasible never becomes a node verdict by itself: `evaluateNative` passes it to `relaxationAgrees` (`:883-889`), which
returns `infeasible` only in cases 2 and 3 above; a known relaxed point or a verified build vetoes it (`:748-752`, `:888`). `withKept` never
changes an infeasible verdict (`:847`). QED

For a MOA-dependent request the same emptiness is reported as model-relative (`incomplete` / `Provisional MOA model infeasible`); the
statement proved is the same, relative to the provisional MOA model that the oracle also uses.

**G2 (closed in Revision 1, owner decision "A found point blocks impossible", 2026-10-12).** Before Revision 1 `settleOpinions` settled
Infeasible on two qualified Infeasible opinions even when a third qualified opinion had returned a primal point without a verified build (a
fractional relaxed point, a point rejected only for overswinging on an inexact node, a rejected boundary point), on the relaxed **and** on the
integer text (review finding 5); `Opinion.point` was computed (`judge`, `solvePrecise.ts:564`, returned at `:565`, `:573`, `:615`, `:623`,
`:629`) and read nowhere. Now `foundPoint` (`:406`) is true for every opinion with verdict `optimal` (which always has a point) and for every
other opinion whose solve was qualified and returned a point (a qualified limit stop with a point), and `settleOpinions` settles Infeasible
only when no opinion has a verified build and none has a found point (`:452-454`); otherwise the node is unresolved with
`Required proof prerequisite unavailable` and no bound (G1). This applies to every text `settleOpinions` judges: the relaxed-first try
(`:824`), the integer text (`:883`) and `relaxationAgrees` (`:757`). A point that validates is already a candidate (a rescue); an unqualified
point proves nothing and does not block. Infeasibility therefore needs, among at most three qualified opinions, two Infeasible verdicts and
no point at all, a strictly stronger condition than A3 requires. Unit test: `settleOpinions([infeasible, optimal-with-point, infeasible])` is
unresolved (`tests/physical/solvePrecise.secondOpinion.test.ts`), and end to end the same sequence on a relaxed text leaves the request
`incomplete`.

### Completeness (what makes a certified infeasibility reachable)

The converse "`F_phys` empty implies certified infeasible" is **not** proved and is false in general. What can be proved:

*Proposition I'. If `F_phys` is empty and the emitted node models have no integer point (in exact arithmetic), and the native solver
answers correctly within the deadline with two agreeing seeds, then production reports `empty`.* By Lemma TU (section 7) the uncut
relaxed-edge text then has no point either, so the relaxed-first try (`:823-824`) settles Infeasible on every node and the search completes
empty.

**GAP G3 (affects completeness only).** `F_phys` empty does not imply that `M^E` has no integer point: `M^E` is an outer relaxation, so a
build that violates an exact recoil or MOA cap by less than its padding, or an overswinging build on a relaxed node, is a model point. Such
points are decoded, rejected by the validator and cut out (Lemma C); after the cuts the integer text may be infeasible while the relaxed text
with the same cuts keeps a fractional point (cut rows break total unimodularity), and `relaxationAgrees` then vetoes the infeasibility
(`:770-778`). The node also fails after `MAX_REJECTIONS_PER_NODE = 16` rejections (`:332`, `:873-874`), and six seeds can run out
(`:348`). One more source of rejections (review GAP 7): `model.exact` is also true on a node whose gear factor is not a double (it ignores
the gear neighbours, `specializeFast.ts:1331`), so under Prevent Overswing an overswinging optimum of such an "exact" node is not a split
point but a rejection, and is cut (`solvePrecise.ts:620-629`). The cut is valid (TED is a function of the signature, Lemma F), but such a
node can exhaust the 16 rejections and fail. In all these cases the result is `incomplete`, never a wrong certificate. *To close (if wanted):* an exact infeasibility proof for
the residual boundary region (e.g. solving the target model `M*` with exact arithmetic on the cut region), out of scope for Stage 3.

---

## 7. Relaxed-first edges

### Lemma TU (the slot assignment is a flow)

*Fix integer values of every column except the edge counts. In a text without cuts, the set of edge vectors `e` that satisfy every row is
a polytope with integral vertices. Consequently, the uncut relaxed-edge text is feasible iff the uncut integer text is, and both have the
same optimal value.*

*Proof.* Edge columns occur only in `in_t` (coefficient `-1`, one row per child template), in the slot or required row of their raw id
(`+1`), and in the slot-conflict rows of their raw id (`+1`) (`specializeFast.ts:698-746`; no statistic, cap, MOA, objective or node row
reads an edge, `:798-1131`). With the other columns fixed these rows read: for each template `t`, `sum_rho e_rho_t = n_t`; for each graph slot
`rho`, `sum_c e_rho_c (<= | =) n_owner` (or 1); for each blocker, `sum_c e_rho_c <= V_rho (1 - pres_t)`; and `0 <= e <= max`. The matrix
has one template-block row and a set of identical slot-block rows per column: the incidence matrix of a bipartite graph with duplicated
rows, plus column bounds, which is totally unimodular (duplicated rows add no new square submatrix with nonzero determinant). The
right-hand sides are integers (counts, binaries, `V_rho`, column bounds). So the polytope is integral, and a nonempty bounded one has an
integral vertex. The objective does not read `e`. QED

Lemma TU is used only for completeness and tightness (Proposition I', Theorem R.2 "nothing is lost", R.3, the R.4 veto rationale and the G2
motivation). No soundness step depends on it: soundness of the relaxed-first path needs only that the relaxed text is a relaxation (R.1).

### Theorem R (relaxed-first preserves every certificate)

1. *The relaxed text is a relaxation.* `toStringRelaxing` only drops integrality markers of the edge columns and keeps their declared bounds
   (`lpText.ts:150-153`). Its qualified dual bound is therefore an upper bound of the integer text's maximum and, by Theorem B, of the node's
   best exact score.
2. *An integral relaxed optimum is an optimum of the integer text.* If every edge of the relaxed point is within `1e-9` of an integer
   (`solvePrecise.ts:568-574`), the point satisfies the integer text within the native tolerances; its value equals the relaxed optimum, which
   is at least the integer optimum, so it is an integer optimum. Its decoded build is validated exactly and scored exactly
   (`:575-617`), and the node is settled by the second opinion on the relaxed text (`:825`), whose bound is the relaxed bound (item 1).
   Lemma TU adds that, without cuts, the relaxed optimum value *equals* the integer optimum value, so nothing is lost in bound tightness.
3. *An infeasible relaxed text certifies the node empty* (Theorem I, case 2); by Lemma TU this loses nothing without cuts.
4. *The fallback preserves certificates.* A fractional or rejected relaxed point, or a stop, falls back to the integer text (`:828-843`); what
   the relaxed try verified (a build, an observed failure) is kept (`kept`, `withKept`, `:814`, `:846-857`), and its bound is not used for the
   integer evaluation's settlement, nor, since Revision 1, as node evidence on the veto path (G1: `relaxedUncut` is a flag, `:830`). An integer-text Infeasible after a relaxed point is vetoed (`:888`): by Lemma TU the two native answers
   contradict each other, so refusing to certify is the correct conservative choice.

### Lemma C (cuts lose no physical build)

*Let the integer text of a node return a qualified point `x` whose rounded decision vector `E = (base, e)` decodes to a rejected build, or
does not decode (`decoded.ok === false`), and let the cut `integerNoGood(E)` be added (`solvePrecise.ts:869-878`). Then no `B in F_phys` has
`sigma(B) = E`, and every point of the text other than those with decision vector `E` still satisfies the cut.*

*Proof.* The cut excludes exactly the integer decision vector `E` (`fastCut.ts:44-83`: a column at a bound contributes its deviation, an
interior column two indicator binaries whose rows force `x_j >= E_j + 1` or `x_j <= E_j - 1`; any other integer vector reaches 1). Both the
cut and `decodeFast` round with `Math.round` (`decodeFast.ts:40`, `fastCut.ts:53`), so they see the same `E`. Suppose `B in F_phys` with
`sigma(B) = E`. Then `E` with `n(E) = n(B)` satisfies the structural rows (Theorem L), so `decodeFast(E)` succeeds (Lemma D) with a tree `T`,
`sigma(T) = E`. By Lemma F, `T in F_phys`, so the validator accepts it (A-VAL, completeness direction: the production validator rejects no
build the oracle accepts; A-VAL is used here exactly in its restated scope, since `decodeFast` produces a build with path-derived instance
ids and no claimed spend or provenance, `decodeFast.ts:1-21`). This contradicts the rejection. Points rejected *only* for overswinging on an inexact node are not cut
(`:574-579`): they refine the node instead. QED

`Lambda(B)` for a valid `B` therefore satisfies every cut (its decision vector differs from every cut vector), including in the relaxed text
with cuts (`appendCuts` keeps the cut binaries binary, `fastCut.ts:86-102`).

Note: Lemma C uses the validator in the *completeness* direction (accepting every oracle-valid build). If the production validator wrongly
rejected a valid build, a cut could remove a physical build, and a later "infeasible" or a bound could be wrong. This is why A-VAL is stated
in both directions (section 9.1). It is stated only for builds with path-derived instance ids and no claims: the production validator has
rejections the oracle cannot raise (`INSTANCE_ID_NOT_PATH_DERIVED` under `requirePathInstanceIds: true`, which Precise sets,
`solvePrecise.ts:520`; `CLAIMED_SPEND_MISMATCH` / `CLAIMED_ACQUISITION_MISMATCH`, `validate.ts:35-37`, `:93-95`), and none of them can fire on
a decoded build.

---

## 8. The main theorem

**Theorem S.** *Let `w` be in the declared domain, `r` accepted, and A-DATA, A-VAL, A-ARITH, A-PARSE, A1-A4 hold. Then
`solvePrecise(r)` (`solvePrecise.ts:475-920`) satisfies:*

1. *Every published build is in `F_phys` and its published score is its exact score.* (`decodeFast` + exact validation, `:575-617`; only
   validated candidates enter the search, `search.ts:337-340`.)
2. *If the result is a certified build, `score(B*) >= OPT - tau`* (section 4.2 with Theorem B; the bounds used are settled, decision 5a).
3. *If the result is `empty`, `F_phys = empty`* (Theorem I).
4. *Every published lower bound is `<= score(B*) <= OPT`; every published finite upper bound is `>= OPT`*, under A1 and A3: every node bound it
   joins comes from a settled verdict (two agreeing qualified solves) or is inherited from one, and any node without one makes the published
   upper bound unknown (`null`), never finite (G1, closed).
5. *For a request without TED, and on a TED node with `hi <= 3` and a double gear factor, the model solved is the target model up to the
   padding, and the target model is an exact reformulation of the physical domain* (Theorem E). This is narrower than `model.exact`
   (`specializeFast.ts:1331`), which is also true on singleton `constant_exact` nodes, whose penalty line sits up to one ulp below `q`, and on
   nodes with a non-double gear factor, whose `gear_def_lo` / `gear_def_hi` rows are inequalities (review GAP 6). On those nodes the model is
   a relaxation in the relaxing direction (Lemma T and Theorem L), which is all soundness needs; `model.exact` there only means "a `solved`
   verdict closes the node", and it makes overswinging optima rejections (G3).

All five statements are subject to the owner-accepted native deviations of decisions 4 and 5b (section 5): "`>= OPT`" means
"`>= OPT - eps_native`" with `eps_native` unquantified, assumed zero and observed below `1e-11` except one `1.1e-5` integrality case that the
sanity guard caught.

---

## 9. Assumptions, code dependencies and scope

### 9.1 Non-native assumptions

| Id | Assumption | Where used | Corroboration |
| --- | --- | --- | --- |
| A0 | Declared domain (P1-P4) and accepted request | everywhere | the blueprint guard; 172/172 pinned guns prepare |
| A-DATA | The oracle's domain, transported through the bridge, is the domain of section 1.2 over the production `ItemLookup` and `SolveParams` (trader canonicalization, per-item flea gate, exact barter prices from the data layer, trader-only receivers, dropped non-mod allowlist entries, removed camora slots, category chains, receiver magazine capacity 0, defaults of weights and levels) | Lemma 2, every rule mapping | `reference/bridge/*.test.ts`, harness |
| A-VAL | For every build with path-derived instance ids and no claimed spend or provenance (every build `decodeFast` produces), `preparePhysicalValidator(...).validate` accepts it iff the oracle's `inspectBuild` does. Soundness (accepts only oracle-valid builds) is what every witness depends on; **completeness** (rejects no oracle-valid build) is what every certificate depends on through the cuts of Lemma C. Production-only rejections (`INSTANCE_ID_NOT_PATH_DERIVED`, `CLAIMED_SPEND_MISMATCH`, `CLAIMED_ACQUISITION_MISMATCH`) are outside this scope and cannot fire on a decoded build | Theorem S.1, Lemma C | validator agreement tests (`f6acab1`); exact-rational reimplementation (`src/solver/physical/validate.ts:1-45`); review `lift.mts`: 33,542 oracle-accepted builds decoded and accepted |
| A-ARITH | IEEE binary64 JavaScript numbers; BigInt rationals are exact; `ratRoundDown`/`ratRoundUp` return the largest double `<=` / smallest `>=` (their loops check the postcondition exactly, `src/solver/physical/rational.ts:37-66`); `ratFromDouble` decodes exactly | proof layer, Lemmas N, A, M, O, T | unit tests of `exact.ts`, `rational.ts` |
| A-PARSE | `parseLpText` + `compareReadback` decide model equality; the readback is the model HiGHS solved | Theorem B, I | `NATIVE_FRAME.assumptions[1]`; `docs/stage3/native-evidence.md` section 1 |

### 9.2 Native assumptions (exactly the stated ones)

| Id | Assumption | Source |
| --- | --- | --- |
| A1 | A qualified solve's MIP dual bound (also at a limit stop) is at least the maximum of the parsed model. Known deviations accepted by the owner: floating-point noise (decision 4) and the two-sided integrality shift (decision 5b) | `nativeProof.ts:44`, `:47`; `docs/stage2-plan.md` decisions 4, 5b |
| A2 | Row feasibility tolerances do not enter an upper bound; primal points are re-validated exactly | `nativeProof.ts:46` |
| A3 | Two agreeing qualified solves (different seeds, presolve off, declared tolerances) are not wrong the same way | `nativeProof.ts:48`; decision 5a |
| A4 | A relaxed-edge text settled Infeasible by two agreeing qualified solves has no feasible point; this is sound but not complete, and a relaxation sharing a false Infeasible is not detected | `nativeProof.ts:49`; decision 5a (2026-10-12) |

No claim is taken from a presolved solve (`nativeProof.ts:148-150`, `nativeSolve.ts:168-211`, decision 5), and statuses that report no verdict
are inconclusive, never infeasibility (`nativeSolve.ts:53-69`).

### 9.3 Code behaviour the proof relies on (Revision 1 working tree, base `dae163a`)

| Behaviour | Location |
| --- | --- |
| Unrolling expands every retained candidate and throws on a repeat (P2) | `blueprint.ts:416-456`, `:439-442` |
| One owner template per raw slot id (P1) | `blueprint.ts:381-397` |
| Template-level masks, viability, contradictions, activity | `domain.ts:198-231`, `:238-255`, `:258-268`, `:270-289` |
| Union candidate sets, Kahn order, copy bounds | `templateGraph.ts:74-115`, `:117-128`, `:147-179` |
| Lemma 1 asserted on every domain, failure is a solver error | `specializeCount.ts:66-120`, `solvePrecise.ts:510-515` |
| Certified mode: no single-copy restriction, proof layer | `specializeFast.ts:379-382`, `specializeCount.ts:133` |
| Columns and bounds | `specializeFast.ts:595-632`, `:676-682`, `:808-834` |
| Supply, cover, wallet | `specializeFast.ts:641-690`, `:898-902` |
| Structure rows | `specializeFast.ts:694-717` |
| Conflict rows, clique cover | `specializeFast.ts:417-461`, `:720-746` |
| Includes | `specializeFast.ts:748-762` |
| Statistics, clamps, gear, TED, node rows | `specializeFast.ts:780-904` |
| Caps (recoil padded) | `specializeFast.ts:906-940` |
| MOA rows and dominance | `specializeFast.ts:960-983`, `proof.ts:129-176` |
| Objective plan, frame error, read-through | `specializeFast.ts:1023-1131`, `proof.ts:275-392` |
| Read-through exactness asserted (GAP 8a) | `specializeFast.ts:134-149`, `:1045`, `:1057` |
| Constant rows dropped or contradictions | `specializeFast.ts:531-562` |
| Relaxed text | `specializeFast.ts:1322`, `lpText.ts:150-153` |
| Active-range enclosures | `bounds.ts:33-83`, `numeric.ts:60-64` |
| Padded right-hand sides | `proof.ts:92-103` |
| Penalty lines | `spatial.ts:81-131` |
| Decoder | `decodeFast.ts:35-124` |
| Cuts | `fastCut.ts:44-102`, `solvePrecise.ts:869-878` |
| Qualification and bound evidence | `nativeProof.ts:85-170` |
| Native options (presolve off, tolerances 1e-9 / 1e-7) | `nativeSolve.ts:100-117`, `solvePrecise.ts:525` |
| Opinions, second opinion, settlement | `solvePrecise.ts:409-473`, `:633-716` |
| A found point blocks impossible (G2) | `solvePrecise.ts:406`, `:452-454` |
| Only checked bounds (G1): no evidence on any non-settled verdict | `solvePrecise.ts:459-460`, `:681-688`, `:719-731`, `:751`, `:774-778`, `:800-802` |
| Split-only shortcut (F1) | `solvePrecise.ts:468-473`, `:786-790`, `:768`, `:826`, `:881`; `search.ts:108-114`, `:341-352` (Revision 1 lines; see section 13) |
| Split-only shortcut with a witness (F1', 2026-10-13) | `solvePrecise.ts:498-517`, `:826-837`, `:812`, `:873`, `:928`, `:849`; `search.ts:340-353` |
| Witness native stop (F2) | `solvePrecise.ts:598`, `:655`, `:681-688`; `moaFloor.ts:254-264` |
| Relaxation must agree | `solvePrecise.ts:743-790`, `:883-889` |
| Relaxed-first strategy | `solvePrecise.ts:357`, `:806-858` |
| Bound sanity guard (not relied on) | `solvePrecise.ts:325-330`, `:604-614` |
| Search: node bounds, join, fathoming, certified, empty | `search.ts:143-163`, `:269-395` |
| Root intervals | `solvePrecise.ts:368-374`, `:893-897` |

### 9.4 Scope

- **In scope:** `solvePrecise` on the declared domain for every accepted request (weighted and Tchebycheff, every cap, includes, excludes,
  presets, stash, barters with whole lots, TrueErgo and Prevent Overswing, MOA caps), and therefore every operation insofar as it consumes a
  `solvePrecise` result (Optimize, Gunsmith optimization, ideal-point endpoint solves, MOA floor trials: `src/solver/solver.ts:332`,
  `src/solver/moaFloor.ts:315`).
- **Out of scope:** cyclic part data (an internal error); `SLOT_ID_COLLISION`, `MIXED_AMMO_SLOT`, `BAD_PRESET`, `OCCURRENCE_LIMIT` and other typed
  input errors; Fast (`solveFast`), beyond its witness contract (every published Fast witness passes the same validator); the correctness of
  HiGHS; the composition logic of the operations themselves (floor bisection, Explore classification, payoff-table derivation), whose
  correctness is ADR 0004 / ADR 0013 section 6 material and rests on the certificates proved here; the admissibility of the payoff table
  (an input, INTERPRETATIONS.md choice 17); game authority of the provisional MOA model.

---

## 10. GAP register

| Id | Severity | Statement | To close |
| --- | --- | --- | --- |
| G1 | **Closed (Revision 1)** | Was: the upper bound of an unresolved or failed node could come from a single qualified solve (five sources, section 5) and was published for `feasible` / `incomplete` results. Now only settled verdicts carry a bound (enforced once in `evaluate`); a node without one makes the published upper bound and gap `null` | Done: owner decision "Only checked bounds" (2026-10-12) |
| G2 | **Closed (Revision 1)** | Was: two qualified Infeasible opinions settled a node against a third qualified opinion with a primal point, on relaxed and integer texts. Now any found point or verified build blocks the Infeasible settlement | Done: owner decision "A found point blocks impossible" (2026-10-12) |
| G3 | Affects completeness only | Certified infeasibility (and optimality) is not complete: padding and tolerance boundary points, cuts that break total unimodularity of the relaxed text, 16 rejections per node (including overswing rejections on `model.exact` nodes with a non-double gear factor, review GAP 7), six seeds | Accepted as is; an exact boundary proof would close it |
| G4 | Assumption (affects the scope of every certificate if wrong) | A-DATA: the bridge transport of the oracle's domain to the production data model is corroborated, not proved | A written mapping proof of `reference/bridge/toFixture.ts`, or accept as tested |
| G5 | Assumption (affects witnesses and, through Lemma C, certificates if wrong) | A-VAL: production validator equals oracle validator in both directions; corroborated by the agreement tests | A side-by-side rule proof of `validate.ts` against `reference/oracle/validate.ts`, or accept as tested |
| G6 | Documentation | ADR 0009 principle 1 describes an explicit `u_i` surrogate; the count model substitutes it into the lot cover with dominance, lot-bound and linear reductions (proved exact in Lemma A). ADR 0007 principle 5 writes clamps over `[0, 1000]`; the code and oracle use 100. ADR 0003 states pairwise or per-instance conflict rows; the count model uses a clique cover of presence rows (proved exact in Theorems L and P) | An amendment note citing this proof |
| G7 | Documentation (robustness) | `copyBounds` relies on Kahn's order covering every active template, without an assertion; true on the declared domain (Lemma 3) | `assert(topological.length === activeTemplateCount)` |
| G8 | Documentation | The bound sanity guard scales with the request tolerance and detects only shortfalls a same-node build exposes; the proof does not rely on it | None needed; keep the comment honest |
| G9 | **Closed (Revision 1)** | Review GAP 8a: the power-of-two read-through was assumed exact; an underflow could exclude a build's value from a scaled column's domain | Done: asserted (`readThroughRange`, `exactPowerOfTwoProduct`), internal error otherwise |
| G10 | Assumption (documentation) | Review GAP 8b: an edge-free integer text's settled Infeasible has no independent relaxation check; it rests on A3 alone | Stated in Theorem I case 3; edge-free models are trivial |

No code defect that makes a published certificate wrong under the stated assumptions was found. G1 and G2, the two places where the code gave
a weaker guarantee than its surrounding comments suggested, are closed in Revision 1; neither was a counterexample to a certificate under
A1-A4.

---

## 11. Corroborating evidence (not proof steps)

- **Gates A/B/C on production Precise** (`reference/harness/countGates.differential.ts`, `countGates.differential.test.ts`): 144 gated
  ledger cases pass (7 owner-approved precision cells from decision 5b, 2 known native-defect cells), the 5 cyclic cases refused; the seeded
  campaign gated 2,171 of 3,200 worlds (868 cyclic refused, 161 oracle-incomplete skipped) with no model failure, 4 native-defect cells and
  2 precision cells (`frontend/s3gates-status.md`). Native defects found there led to the 2026-10-12 decisions (retry seeds; relaxation must
  agree), cited in sections 5 and 6 (`reference/harness/countGates.nativeDefects.differential.test.ts`).
- **Native, parser and numerical evidence** (`docs/stage3/native-evidence.md`): readback equality on the production count model including the
  relaxed text (section 1), full-precision primals and dual bounds (2), filtering detection (3), finite auxiliary domains (4), completed and
  limit-stopped runs (5), the bound-error statement and defect fixture (6), second-opinion paths (7), pinned loader (8), inconclusive solves
  and relaxation agreement (9).
- **Research campaign for the plain Fast count model** (`docs/research/acyclic-fast-exactness.md` section 7): 5,361 gated cases; the MOA
  deviation it found is the one Lemma M closes with the dominance rows.
- **Lemma 1 on real data:** 60,689 (template, slot) pairs of the pinned snapshot agree (`tests/research/acyclicFast.pinned.test.ts`); the
  production assertion runs on every domain.
- **Phase 2.10 measurement:** 172 pinned guns certified in both profiles with the same optimum as the occurrence model wherever both certified
  (`docs/stage2-plan.md`, decision 2d, Phase 2.10 result).

---

## 12. Revision 1 (2026-10-12)

Revision 1 answers the adversarial review (`docs/proofs/count-model.review.md`, findings numbered as there) and records the owner decisions
of 2026-10-12 (F1, G1, G2, GAP 8a). Code changes are in `src/solver/physical/solvePrecise.ts`, `search.ts`, `specializeFast.ts`,
`errors.ts` and `src/solver/moaFloor.ts`; no oracle, ledger or baseline file changed. Every `file:line` of this document was re-cited at the
Revision 1 working tree (the cited lines moved by the code changes; oracle and unchanged files keep their lines).

| Review finding | Verdict there | Change in Revision 1 |
| --- | --- | --- |
| 1. Lemma TU | OK (wording) | "identity rows" now reads "column bounds"; a sentence says TU is used only for completeness and tightness (section 7). |
| 2. Theorem R | OK (R.4 to point to G1) | R.4 says the relaxed bound no longer travels as node evidence on the veto path (`relaxedUncut` is a flag; G1). |
| 3. Lemma C / A-VAL | GAP (documentation) | A-VAL restated for builds with path-derived instance ids and no claimed spend or provenance; the completeness half is named as the one certificates depend on through cuts; the production-only rejections are listed and shown not to fire on decoded builds (section 7 note, section 9.1). |
| 4. G1, scope wider | GAP (bounds of uncertified results) | **Closed by code** (owner decision "Only checked bounds"): all five single-solve sources (limit-stopped first opinion; timed-out, limit-stopped or unqualified second opinion and unresolved disagreements; relaxed try carried through the fallback and `relaxationAgrees`' unresolved return; `failed` evaluations with the rejected solve's dual bound; the `stopAtFirstWitness` short-circuit) carry no evidence, and `evaluate` enforces it once for every non-`solved` verdict. A node without a settled verdict keeps its inherited bound; a live unknown bound makes the published upper bound and gap `null`, explicitly. Section 5 (G1), Theorem S.4, section 10. |
| 5. G2, also on integer texts | GAP (certificate hardening) | **Closed by code** (owner decision "A found point blocks impossible"): `foundPoint` (an Optimal, or a qualified solve with a primal point) or a verified build blocks the Infeasible settlement in `settleOpinions`, on every text it judges (relaxed-first, integer, `relaxationAgrees`). Section 6 (G2), section 10. Test: `[infeasible, optimal-with-point, infeasible]` is unresolved. |
| 6. Lemma 1, Cor. 1, Lemma 3, Lemma D, Theorem P | OK | none. |
| 7. Lemma A | CITATION + GAP | Barter lot prices are `>= 0` (accepted at `acquisition.ts:102`), with the free-lot rounding remark (a total in `(0, 1/2)` rounds half-up to `0`, identically in production and oracle); `priceUpper` is justified through `priceTerms`, which counts every product term, so the `sumEnclosure` widening covers the extra product rounding (Lemma A items 2 and 4). |
| 8. Lemma M | OK | none. |
| 9a. S.5 vs Theorem E | GAP (documentation) | Theorem S.5 now reads "a TED node with `hi <= 3` and a double gear factor", and says what `model.exact` additionally covers (singleton `constant_exact` nodes up to one ulp below `q`, non-double gear factors) and why that is still sound (relaxing direction). |
| 9b. Overswing rejections on exact nodes | GAP (completeness only) | Added to G3: such points are cut, not refined, and can exhaust the 16 rejections. |
| 9c. Read-through "exact division" | GAP (documentation; certificates only on pathological data) | **Closed by code** (GAP 8a): `readThroughRange` asserts the round trip `scaled * 2^k === range` and `exactPowerOfTwoProduct` the coefficient product; failure is the internal error `INEXACT_READ_THROUGH` (Theorem L; register G9). Test: `tests/physical/readThrough.test.ts`. |
| 10. Theorem I case 3 (edge-free) | GAP (documentation) | Case 3 now says the verdict rests on A3 alone, not on an independent A4 check (GAP 8b; register G10). |
| 11. Citations | 1 CITATION, 2 nits | The barter citation is fixed (item 7); section 1.4 mentions the padded vertical recoil right-hand side; the `Opinion.point` citation now lists where it is computed and returned, and that it is read (G2). |

New in Revision 1, not from the review:

- **Proposition F1 (owner decision F1, "skip the second solve for splits").** A first opinion that leads only to a split (a qualified Optimal of
  an inexact node with no verified build, no rejected point and a split point, whose bound would not fathom the node against the incumbent) is
  returned as a `split` evaluation without a second opinion. Section 4.2 proves that a split discards nothing (the closed halves cover the
  node), that the evaluation contributes no bound, prunes nothing and certifies nothing (the search never reads its evidence; the children
  inherit the node's own bound), and that every certificate still rests on settled verdicts; a first opinion whose bound would fathom keeps
  the full decision-5a rule. Measured effect: Stage 3 floor finding F1 resolved (`docs/stage3/floor-measurement.md`).
- **Witness native stop (owner decision F2).** A floor witness's `nativeStop` is the HiGHS status of the solve that produced it
  (`VerifiedBuild.nativeStatus`), and the first-witness short-circuit's reason is that solve's real stop. Not a proof step (a trace
  diagnostic); listed in section 9.3.
- **Theorem S.4** no longer carries the G1 caveat: every published finite upper bound rests on settled verdicts (A1 and A3).

---

## 13. Amendment of 2026-10-13: the split-only shortcut with a witness

Owner decision (2026-10-13, amending F1). The F1 shortcut required "no verified build"; nearly every TrueErgo node finds one (the relaxed-edge
optimum is integral), so F1 fired on 0 of 730 TrueErgo nodes while second opinions were about half of TrueErgo time
(`docs/stage3/ted-seed.md`). Proposition F1' (section 4.2) admits a first opinion with a verified build when its bound is more than `tau` above
the incumbent, its own build and any other build the evaluation brings, and the interval can be split at its split point; the build is kept
as a witness, the bound is not used. Floor queries keep the 2026-10-12 rule. The 2026-10-12 rule stays selectable (`splitShortcut: 'f1'`) as
the measured baseline. Theorem S is unaffected; no oracle, ledger or baseline file changed. Code: `src/solver/physical/solvePrecise.ts`
(`leadsOnlyToSplit`, `splitOnly`, `PRECISE_SPLIT_SHORTCUT`, telemetry `splitWitnessNodes`), comments in `search.ts`. Tests:
`tests/physical/solvePrecise.splitWitness.test.ts`. Measurement: `docs/stage3/split-shortcut.md` (172 pinned guns, identical certificates,
scores and published bounds). Line citations of sections 4.2 and 9.3 that name F1' are at this amendment's working tree; the Revision 1
citations of Proposition F1 are left as written.


## 14. Amendment of 2026-10-13: concurrent payoff endpoints

Sweet Spot computes its payoff table from three endpoint solves with weights `(100, 0, 0)`, `(0, 100, 0)` and `(0, 0, 100)`
(`src/solver/solver.ts`, `computePayoff`). Measurement: `docs/stage3/sweet-spot.md`.

**Concurrent endpoints.** The three endpoints now run at the same time (`computePayoff`, `PayoffOptions.concurrent`). This changes no solve:
each endpoint is an independent `solvePrecise` call, each native solve depends only on its text and options (`docs/stage3/parallel-pool.md`,
determinism argument), and the outcomes are read in weight order, so the error reported is the one of the first failing endpoint, as before.
Nothing in this document depends on the order of the endpoint solves. Theorem S, the node cover and Propositions F1 / F1' are unaffected.
