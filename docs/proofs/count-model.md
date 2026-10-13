# The certified count model of Precise: domain-wide lifting and projection proof

Status: **draft for adversarial review** (Stage 3, workstream 3.2; ADR 0013 section 7; refs #40). Written against branch
`impl/stage2-correctness-cutover` at commit `a19041c`. Every `file:line` below is at that commit; paths are relative to `frontend/`
unless they start with `docs/`. Documentation only: no code, test, oracle or ledger was changed.

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
  (`src/solver/physical/solvePrecise.ts:339-341`), default `1e-5` (`:298`).
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
  limit (`solvePrecise.ts:155`).

A request is **accepted** when `prepareSubproblemDomain` and `specializeCount` accept it (finite caps, levels and weights, a valid
`owned_items` multiset, an ideal point when Tchebycheff is on: `src/solver/physical/specializeFast.ts:324-362`,
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
(`specializeCount.ts:66-81`) and calls `specializeFast(..., { certified: true })` (`specializeFast.ts:1268-1338`). For an empty domain it
returns a one-row contradiction (`specializeFast.ts:1192-1235`) and production never solves it (`solvePrecise.ts:457-462`).

**Template graph** (`src/solver/physical/templateGraph.ts:61-140`). `T_act` = receiver + templates with an active occurrence (`:66-68`).
For each raw id `rho` owned by an active template: `C(rho)` = the union over active occurrences of the owner of the templates of their active
candidates in their slot of id `rho` (`:74-88`); `rho` is a *graph slot* when `C(rho)` is nonempty (`:93-115`); `req(rho)` its required flag.
`topological` is Kahn's order of `T_act` (`:117-128`); `U_t = maxCopies[t]` (`:147-179`): `U_0 = 1`, and for `c >= 1`
`U_c = max(1, min(activeCount(c), [selfconflict ? 1 : inf], K_c(receiver)))` with `K_c(t) = [t = c] + sum over graph slots rho of t of
max over d in C(rho) of K_c(d)`.

**Columns** (all with finite declared bounds; `src/solver/physical/lpText.ts:98-112` refuses anything else):

| Column | Domain | Kind | Code |
| --- | --- | --- | --- |
| `base_b`, `b in Bases` | [0,1] | binary | `specializeFast.ts:575-578` |
| `n_t`, `t in T_act \ {0}` | [0, U_t] | integer (binary if `U_t = 1`) | `:579-582` |
| `e_rho_c`, graph slot `rho`, `c in C(rho)` | [0, min(U_owner(rho), U_c)] | integer | `:583-594` |
| `z_t` (only for `U_t > 1` and `t` in a conflict clique, a slot-conflict row or the MOA rows) | [0,1] | binary | `:598-610` |
| `lot_t_k` (`lots` mode) | [0, ceil(surrogateMax_t / size_k)] | integer | `:654-660` |
| `raw_ergo, capped_ergo, rec_mod, rec_axis, price_axis, weight, acc_total` | active-range enclosures | continuous | `:786-812` |
| clamp binaries `c1_*`, `c2_*` | [0,1] | binary | `:758-774` |
| `gear_ergo, eff_ergo, ted` (TED requests) | exact enclosures | continuous | `:828-869` |
| `ergo_axis`, `*_n` (power-of-two read-throughs), `tch_t`, `total_obj` | exact or outward enclosures | continuous | `:871-873`, `:1018-1027`, `:1074-1082` |

Here `surrogateMax_t = max(0, U_t - own_t)`.

**Row families** (row names are matched to families by `familyOfRow`, `specializeFast.ts:267-292`, `:442-445`; a row with no variable
left after merging is dropped when true and becomes a `contra_k` row `zero_col >= 1` when false, `:509-540`):

| Family | Rows | Code |
| --- | --- | --- |
| base choice | `sum_b base_b = 1` | `:672-674` |
| parentage | `in_t: n_t - sum_{rho : t in C(rho)} e_rho_t = 0` | `:679-684` |
| slot capacity / required | root `rho`: `sum_c e = 1` if required, `<= 1` if optional and `|C(rho)| > 1` (else the column bound `<= 1`); mod `rho`: `sum_c e - n_owner(rho) = 0` if required, `<= 0` otherwise | `:686-694` |
| presence link | `n_t - U_t z_t <= 0`, `z_t - n_t <= 0` | `:605-607` |
| template conflict | for each clique `K` of `cliqueCover(conflict pairs, T_act)`: `sum_{t in K} pres_t <= 1`, `pres_t = n_t` if `U_t = 1`, else `z_t` | `:708-710`, `:395-439` |
| slot conflict | for each active blocker `t` and blocked raw id `rho` that is a graph slot: `sum_c e_rho_c + V_rho pres_t <= V_rho`, `V_rho = min(U_owner(rho), sum_c max(e_rho_c))` | `:711-723`, `:698-702` |
| includes | `incl_t: n_t >= 1` (an unknown or inactive id: constant false row); `catreq_g: sum_{t active, chain(t) meets g} n_t >= 1` | `:726-740` |
| supply cap | `capped` `t`: `n_t - sum_b q_{b,t} base_b <= own_t` | `:631-635` |
| lot cover | `lots` `t`: `sum_k size_k lot_t_k - n_t + sum_b q_{b,t} base_b >= -own_t` | `:654-665` |
| wallet | `price_axis - sum_b price_b base_b - sum_{linear t} unit_t n_t - sum lot prices x lot = 0` | `:876-880` |
| statistics | `raw_ergo = erg_0 + sum n_t erg_t`; `rec_mod = sum n_t rec_t`; `rec_axis = 1000 rec_mod`; `weight = w_0 + sum n_t w_t` (TED or a weight cap); `acc_total = sum n_t acc_t` (MOA cap) | `:814-820` |
| first clamp | general three-regime clamp `capped_ergo = clamp(raw_ergo, 0, 100)` | `:821`, `:758-774` |
| gear and second clamp | `gear_ergo = f capped_ergo` (one row if `f` is a double, else `f_lo capped <= gear <= f_hi capped`); `eff_ergo = clamp(gear_ergo, 0, 100)` | `:825-842` |
| TED | node rows on `weight`; `ted - eff_ergo + slope weight = -intercept`; `ted >= 0` under Prevent Overswing | `:791-811`, `:843-869` |
| caps | `price_axis <= max_price`; `capped_ergo >= min_ergonomics`; recoil caps padded (below); magazine/sighting `sum_{t: value_t >= L} n_t >= 1` unless the receiver reaches `L`; `weight <= max_weight` | `:884-918` |
| MOA | per active positive-COI template `t`: `(c_t/100) acc - M_t pres_t [+ M_t sum_{coi_b > coi_t} pres_b] >= c_t - L - M_t` padded; fallback `(c_0/100) acc + M_fb sum_b pres_b >= c_0 - L` padded | `:938-961`, `proof.ts:129-176` |
| objective | `total_obj = sum_j c'_j axis_j - tch_t`; Tchebycheff `tch_t + c'_e ergo_axis >= rhs`, `tch_t - c'_a axis_a >= rhs` padded | `:1001-1109`, `proof.ts:297-359` |

Here `c_t = [coi_t] K` (exact), the emitted coefficient of `acc` is the nearest double of `[coi_t] x 10000/29089` (`proof.ts:151-161`),
`M_t` is the smallest double at least the exact need `max(0, max over A in [a_lo, a_hi] of c_t (1 - A/100) - L)`, raised to `1e-6` when
positive (`proof.ts:129-140`). The dominance terms are written iff barrels of different COI are active and (`moaDominance = 'always'` or
`L < 0` and `a_hi > 100`) (`specializeFast.ts:946-948`).

**Padding (the proof layer).** A *constructed* row (a coefficient that is not a binary64 leaf: the recoil-sum coefficient, the MOA
`c/100` coefficients, the Tchebycheff `c_a`) is emitted with right-hand side `paddedRhs` (`proof.ts:92-103`): for target row
`sum a_i y_i (>= | <=) r` with emitted coefficients `a'_i` and column magnitude bounds `B_i`, the need is `r -/+ sum |a'_i - a_i| B_i`
(exact) and the emitted value is the largest double `<=` the need (`>=`) or the smallest `>=` it (`<=`). Every other coefficient is a
binary64 leaf of the data, a small integer, or a power of two, so the text *is* the model there.

**Target model `M*`.** The same columns and rows with every constructed coefficient at its exact rational value and no padding.

**Texts.** `lp(cuts)` is `M^E` with integer no-good cuts spliced in (`specializeFast.ts:1299`, `src/solver/physical/fastCut.ts:44-102`);
`lpRelaxedEdges()` is the same text with every `e_rho_c` continuous over its declared domain (`specializeFast.ts:1300`, `lpText.ts:150-153`).

**Node.** For a TED request (TrueErgo or Prevent Overswing) the model is specialized on a weight node `[lo, hi]`: rows on `weight`, and the
penalty line of `secantOfPenalty` on the node clipped to the active weight range (`specializeFast.ts:796-811`, `:843-856`,
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
(`solvePrecise.ts:464-469`). The assertion is redundant on the declared domain (Lemma 1), so a failure would mean a defect of the blueprint
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
   (`specializeFast.ts:377-388`). An offer is dropped only when an earlier offer in the order (price ascending, size descending) has price
   `<=` and size `>=` (the running `largest` is attained by a kept offer); replacing each dropped lot by its dominator keeps the cover and does
   not raise the cost. Repeated equal offers are dropped likewise.
2. *Lot bounds.* Some minimum cover has `lot_k <= ceil(d_t / size_k) <= ceil(surrogateMax_t / size_k)`: among minimum covers take one with
   the fewest lots; if `lot_k > ceil(d_t/size_k)`, dropping one lot of kind `k` leaves `size_k ceil(d_t/size_k) >= d_t` units and does not
   raise the cost (prices are `>= 0`: trader and flea prices are positive, a barter price is the rounded positive total, `acquisition.ts:93-106`),
   contradicting minimality of the lot count. And `d_t <= surrogateMax_t` because `n_t <= U_t` (Lemma 3).
3. *Modes* (`specializeFast.ts:619-668`): `capped` (no legal offer): the oracle allows no paid unit, so the rule is `n_t <= q_{b,t} + own_t`,
   which is the `supcap` row. `covered` (`surrogateMax_t = 0`): `own_t >= U_t >= n_t`, so `d_t = 0`, cost 0, no row needed. `linear`
   (no preset supply, no stock, and either one non-dominated lot of size 1 or `U_t = 1`): `d_t = n_t`; with one non-dominated unit lot every
   legal lot has size 1 and the cheapest price is `lots[0].price`, so the cover costs `n_t x lots[0].price`; with `U_t = 1` a cover of at most
   one unit costs the cheapest lot price, `lots[0].price` (sorted by price). `lots`: the cover row says exactly "the lots deliver at least
   `n_t - q_{b,t} - own_t` units", equivalently at least `d_t` units (lots are nonnegative).
4. *Wallet.* With base binaries summing to one, `price_axis = price_b + sum_t cost_t(lots)`, and `price_b` is the oracle's base price
   (cheapest legal lot of the base). Hence for every model point with base `b` and counts `n`, `price_axis >= spend(b, n)`, with equality at a
   minimum cover, which `Lambda` chooses. The bound `price_axis <= priceUpper` holds at `Lambda(B)` because a minimum cover costs at most
   `sum_k price_k maxLots_k`, and `priceUpper` is the floating sum of these terms widened by `sumEnclosure` (`:667`), an enclosure by the
   argument of Lemma N.

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
  `total_obj` and the read-through columns (power-of-two division is exact) contain their values. `tch_t` in
  `[max_a lo_a, max_a hi_a]` because every deviation lies in its own range (`specializeFast.ts:1054-1075`).
- **Base choice.** One base, accessible (R-base).
- **Parentage `in_t`.** Each copy of `t` has exactly one parent slot (R-root, R-cap), whose raw id `rho` has `t in C(rho)` (Corollary 1).
- **Slot capacity and required occupancy.** For a mod-owned `rho`, the physical slots of id `rho` are exactly the slots of the
  `n_owner(rho)` copies of the owner (P1), each holding at most one child (R-cap) and exactly one when required (R-req); summing gives
  `o_rho <= n_owner` (`=` when required). For a root slot `o_rho <= 1` (`= 1` when required). A required slot of an active template is a graph
  slot (Corollary 1), so no required slot is missing from the rows.
- **Presence link.** `z_t = [n_t >= 1]` satisfies `n_t <= U_t z_t` (Lemma 3) and `z_t <= n_t`.
- **Template conflicts.** Every clique of `cliqueCover` is a set of pairwise conflicting templates: the candidates are the common neighbours
  of the seed pair and are filtered to neighbours of every added member (`specializeFast.ts:420-434`). By R-tconf at most one member is
  present.
- **Slot conflicts.** If the blocker `t` is present then `o_rho(B) = 0` (R-sconf, P1: every slot of id `rho` is a slot of the owner's copies;
  the blocker's own host slot included), so the row reads `0 + V_rho <= V_rho`. If absent, `o_rho <= V_rho` because `o_rho <= n_owner <=
  U_owner` and `o_rho <= sum_c max(e_rho_c)` (Lemma 3).
- **Includes.** R-incl; an included id that names no active template cannot be placed (Lemma 2), so the oracle has no build and the
  constant-false row is consistent with `F_phys` empty. A category group matches only through placed (hence active, Lemma 2) templates.
- **Supply cap, lot cover, wallet.** Lemma A.
- **Statistics.** The rows are equalities over binary64 leaves with integer counts: their real values are the oracle's exact sums
  (fromBinary64 of the same leaves; INTERPRETATIONS.md choice 3).
- **Clamps.** The three-regime clamp with `m = ceil(nextUp(max(|lo|, |hi|, cap) + cap))` (`specializeFast.ts:758-774`): for the regime of the
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
lies in some clique (every pair is seeded if uncovered, `specializeFast.ts:417-436`) and `pres_t = [n_t >= 1]` (presence link or `n_t`
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
`c' 2^k` (`proof.ts:378-392`, `specializeFast.ts:1018-1040`): the objective function is unchanged. If no `k <= 40` works, `withheld` is set and
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
`score.ts:63-81` with the same resolved weights, `solvePrecise.ts:545`), never from solver values; its enclosure
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
there exceeds the node optimum by at most `gain x shift` (`specializeFast.ts:1086-1097`), which only makes the bound more conservative. The
`shift` and the gear-neighbour error are reported but need not be added to any bound, because both act in the relaxing direction.

**Node cover.** The roots are the active weight range clipped by `max_weight` and split at 3 kg (`solvePrecise.ts:347-353`); a split gives
the two closed halves `[lo, p]`, `[p, hi]` (`search.ts:172-180`). Every `B in F_phys` has `W(B)` in the active range (Lemma N) and
`W(B) <= max_weight` when capped, so `W(B)` lies in some root and, after every split, in some child: the leaves of the search tree cover
`F_phys` at every moment.

**Certified optimality transfers.** The search (`search.ts:255-369`) keeps every node either live (its inherited bound), closed as
`infeasible`, or closed as `solved` (exact, or within `tau` of the incumbent: `:336-343`, `:269-279`), the latter two contributing their bound
to `fathomed`. The global upper bound is `join(incumbent, fathomed, live)` (`:286-295`), an unknown bound absorbing (`:144-149`).
`certified` requires no stop and `UB - score(incumbent) <= tau` on exact rationals (`:367`). By the node cover and Theorem B below, each
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

The search turns this into node bounds in one place (`search.ts:129-133`: the tighter of the parent's bound and the proved one; unqualified
evidence leaves the parent's bound, unknown at a root) and composes them in one place (`:144-149`, `:286-295`). Published values are enclosed
upward (`boundToNumber`, `ratRoundUp`), the gap is `roundUp(UB - score)` (`:289-293`), and an unknown bound travels as `null`
(`search.ts:232-238`). The published lower bound is `roundDown(score(incumbent)) <= score(incumbent) <= OPT`.

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
  in the same solve beats by more than `max(tau, 1e-9 max(1, |bound|))` (`solvePrecise.ts:558-568`). It can only remove bounds (making the
  result less certified), so it cannot make a bound unsound. It detects only shortfalls that a verified build of the same node exposes, and
  its threshold scales with the request tolerance (with a loose `tau` it accepts large shortfalls). **GAP G8 (documentation):** the code
  comment calls it "a sanity guard on the proof inputs, not an allowance"; that is right, and nothing in the proof may lean on it.
- **Decision 5a (second opinion).** A certificate-bearing node verdict (a qualified Optimal whose bound enters a certified gap, or a qualified
  Infeasible) is settled only by two agreeing qualified solves with different seeds, a third on disagreement (`solvePrecise.ts:380-427`,
  `:630-666`); the settled bound is the *largest* qualified bound among all the node's opinions (`:401-407`), so a disagreeing lower bound
  never wins. The assumption is that two agreeing solves are not wrong the same way (A3).
- **Retry seeds, never throw.** An inconclusive solve (`SolveError`, `PresolveError`, `PostsolveError`) is no opinion (`nativeSolve.ts:179-181`,
  `solvePrecise.ts:617-623`, `:644-651`); running out of seeds leaves the node unresolved (no certificate). This affects completeness only.
- **Limit-stopped solves.** `boundEvidenceOf` takes the MIP dual bound of any qualified solve, including a time- or solution-limited one
  (`nativeProof.ts:162-164`); such a bound bounds a *live* node. A1 is assumed for interrupted solves as well.

**GAP G1 (affects published non-certificate bounds).** Decision 5a's second opinion guards only certificate-bearing verdicts. A node that
stops unresolved can keep the qualified bound of a *single* solve: a limit-stopped first opinion (`solvePrecise.ts:812`, `unconfirmed`), a
second opinion that times out after a qualified Optimal (`:654-655`, then `settleOpinions` keeps the first bound, `:419-426`), or a relaxed
first try whose bound is carried through the fallback (`:762`, used by `relaxationAgrees`, `:700`). That bound is published as `upper_bound` of
a `feasible` or `incomplete` result. It is sound under A1, but A1 alone is exactly what decision 5a says is violated about once in 10,000
solves (a wrong Optimal with a wrong dual bound). So a published non-certificate upper bound carries a weaker guarantee than a certificate.
*To close:* either state this in `NATIVE_FRAME.assumptions` and the result Details ("the upper bound of an uncertified result rests on one
solve"), or publish only settled (two-opinion) bounds and report `null` otherwise.

### What is not proved

- The correctness of HiGHS 1.15.1 (dual bounds, Infeasible verdicts, primal feasibility within tolerances). Every use is behind A1-A4.
- That the strict LP reader (`parseLpText`) and `compareReadback` implement model equality, and that the readback is the model that was solved
  (`NATIVE_FRAME.assumptions[1]`).
- That the production validator agrees with the oracle (A-VAL), and that the data transport is faithful (A-DATA).
- Termination within the deadline, and completeness of any certificate (sections 6 and 7 state the conditions).

---

## 6. Infeasibility

### Theorem I (soundness)

*Under A2-A4 (and with no assumption at all in cases (a) and (b)), if `solvePrecise` returns `kind: 'empty'`, then `F_phys = empty`.*

*Proof.* `kind: 'empty'` arises in two ways.

(a) `domain.empty` (`solvePrecise.ts:457-462`): no accessible base, or a root required slot with no viable candidate (`domain.ts:258-268`).
By Lemma 2 a physical build would make the domain nonempty. Exact, no native call.

(b) The spatial search completed with no incumbent and nothing fathomed (`search.ts:366`): every leaf node was closed `infeasible`. By the
node cover, it suffices that each `infeasible` verdict implies the node holds no physical build. The verdict comes only from:

1. `model.provedEmpty` (`solvePrecise.ts:731-734`): a constant false row; such rows are implied by the oracle's rules for every build of
   the node (Theorem L, constant rows), so the node is empty. Exact.
2. The relaxed-edge text settled Infeasible by two agreeing qualified verdicts with no verified build among the opinions: in the
   relaxed-first try (`:757-758`) or in `relaxationAgrees` (`:703-711`). The relaxed text contains `Lambda(B)` for every `B` in the node and
   every cut is satisfied by it (Theorem L, Lemma C). Under A4 the relaxed text has no real feasible point, so no `B` exists.
3. An integer text with no edge column settled Infeasible (`:696`): its relaxed text is identical, same argument.

An integer-text Infeasible never becomes a node verdict by itself: `evaluateNative` passes it to `relaxationAgrees` (`:813-819`), which
returns `infeasible` only in cases 2 and 3 above; a known relaxed point or a verified build vetoes it (`:697-701`, `:818`). `withKept` never
changes an infeasible verdict (`:779`). QED

For a MOA-dependent request the same emptiness is reported as model-relative (`incomplete` / `Provisional MOA model infeasible`); the
statement proved is the same, relative to the provisional MOA model that the oracle also uses.

**GAP G2 (certificate hardening; sound under A3).** `settleOpinions` settles Infeasible when two qualified opinions say Infeasible, even if a
third qualified opinion returned an Optimal *with a primal point* (fractional relaxed point or rejected point, so no verified build)
(`solvePrecise.ts:408-421`). Concretely, on a relaxed-edge text: seed 0 says Infeasible; seed 11 says Optimal with a fractional edge point
(`judge` returns `verdict: 'optimal', candidate: null`, `:522-528`); seed 29 says Infeasible; then seeds 0 and 29 agree and the node is
certified empty. Under A3 (two agreeing solves are not both wrong) this is sound. But a primal point within `1e-9` of a relaxed text whose
integer counterpart is feasible whenever the relaxation is (Lemma TU) is positive evidence against emptiness, and the code already records it
(`Opinion.point`, set at `:518` and `:583`, read nowhere). *To close:* treat a qualified opinion with `point === true` like a verified build in
`settleOpinions` (no Infeasible settlement against it), or record the majority rule explicitly as part of A3.

### Completeness (what makes a certified infeasibility reachable)

The converse "`F_phys` empty implies certified infeasible" is **not** proved and is false in general. What can be proved:

*Proposition I'. If `F_phys` is empty and the emitted node models have no integer point (in exact arithmetic), and the native solver
answers correctly within the deadline with two agreeing seeds, then production reports `empty`.* By Lemma TU (section 7) the uncut
relaxed-edge text then has no point either, so the relaxed-first try (`:757-758`) settles Infeasible on every node and the search completes
empty.

**GAP G3 (affects completeness only).** `F_phys` empty does not imply that `M^E` has no integer point: `M^E` is an outer relaxation, so a
build that violates an exact recoil or MOA cap by less than its padding, or an overswinging build on a relaxed node, is a model point. Such
points are decoded, rejected by the validator and cut out (Lemma C); after the cuts the integer text may be infeasible while the relaxed text
with the same cuts keeps a fractional point (cut rows break total unimodularity), and `relaxationAgrees` then vetoes the infeasibility
(`:718-726`). The node also fails after `MAX_REJECTIONS_PER_NODE = 16` rejections (`:311`, `:805-806`), and six seeds can run out
(`:327`). In all these cases the result is `incomplete`, never a wrong certificate. *To close (if wanted):* an exact infeasibility proof for
the residual boundary region (e.g. solving the target model `M*` with exact arithmetic on the cut region), out of scope for Stage 3.

---

## 7. Relaxed-first edges

### Lemma TU (the slot assignment is a flow)

*Fix integer values of every column except the edge counts. In a text without cuts, the set of edge vectors `e` that satisfy every row is
a polytope with integral vertices. Consequently, the uncut relaxed-edge text is feasible iff the uncut integer text is, and both have the
same optimal value.*

*Proof.* Edge columns occur only in `in_t` (coefficient `-1`, one row per child template), in the slot or required row of their raw id
(`+1`), and in the slot-conflict rows of their raw id (`+1`) (`specializeFast.ts:676-724`; no statistic, cap, MOA, objective or node row
reads an edge, `:776-1109`). With the other columns fixed these rows read: for each template `t`, `sum_rho e_rho_t = n_t`; for each graph slot
`rho`, `sum_c e_rho_c (<= | =) n_owner` (or 1); for each blocker, `sum_c e_rho_c <= V_rho (1 - pres_t)`; and `0 <= e <= max`. The matrix
has one template-block row and a set of identical slot-block rows per column: the incidence matrix of a bipartite graph with duplicated
rows, plus identity rows, which is totally unimodular (duplicated rows add no new square submatrix with nonzero determinant). The
right-hand sides are integers (counts, binaries, `V_rho`, column bounds). So the polytope is integral, and a nonempty bounded one has an
integral vertex. The objective does not read `e`. QED

### Theorem R (relaxed-first preserves every certificate)

1. *The relaxed text is a relaxation.* `toStringRelaxing` only drops integrality markers of the edge columns and keeps their declared bounds
   (`lpText.ts:150-153`). Its qualified dual bound is therefore an upper bound of the integer text's maximum and, by Theorem B, of the node's
   best exact score.
2. *An integral relaxed optimum is an optimum of the integer text.* If every edge of the relaxed point is within `1e-9` of an integer
   (`solvePrecise.ts:522-528`), the point satisfies the integer text within the native tolerances; its value equals the relaxed optimum, which
   is at least the integer optimum, so it is an integer optimum. Its decoded build is validated exactly and scored exactly
   (`:529-571`), and the node is settled by the second opinion on the relaxed text (`:759`), whose bound is the relaxed bound (item 1).
   Lemma TU adds that, without cuts, the relaxed optimum value *equals* the integer optimum value, so nothing is lost in bound tightness.
3. *An infeasible relaxed text certifies the node empty* (Theorem I, case 2); by Lemma TU this loses nothing without cuts.
4. *The fallback preserves certificates.* A fractional or rejected relaxed point, or a stop, falls back to the integer text (`:760-775`); what
   the relaxed try verified (a build, an observed failure) is kept (`kept`, `withKept`, `:748`, `:778-789`), and its bound is not used for the
   integer evaluation's settlement. An integer-text Infeasible after a relaxed point is vetoed (`:818`): by Lemma TU the two native answers
   contradict each other, so refusing to certify is the correct conservative choice.

### Lemma C (cuts lose no physical build)

*Let the integer text of a node return a qualified point `x` whose rounded decision vector `E = (base, e)` decodes to a rejected build, or
does not decode (`decoded.ok === false`), and let the cut `integerNoGood(E)` be added (`solvePrecise.ts:801-810`). Then no `B in F_phys` has
`sigma(B) = E`, and every point of the text other than those with decision vector `E` still satisfies the cut.*

*Proof.* The cut excludes exactly the integer decision vector `E` (`fastCut.ts:44-83`: a column at a bound contributes its deviation, an
interior column two indicator binaries whose rows force `x_j >= E_j + 1` or `x_j <= E_j - 1`; any other integer vector reaches 1). Both the
cut and `decodeFast` round with `Math.round` (`decodeFast.ts:40`, `fastCut.ts:53`), so they see the same `E`. Suppose `B in F_phys` with
`sigma(B) = E`. Then `E` with `n(E) = n(B)` satisfies the structural rows (Theorem L), so `decodeFast(E)` succeeds (Lemma D) with a tree `T`,
`sigma(T) = E`. By Lemma F, `T in F_phys`, so the validator accepts it (A-VAL, completeness direction: the production validator rejects no
build the oracle accepts). This contradicts the rejection. Points rejected *only* for overswinging on an inexact node are not cut
(`:574-579`): they refine the node instead. QED

`Lambda(B)` for a valid `B` therefore satisfies every cut (its decision vector differs from every cut vector), including in the relaxed text
with cuts (`appendCuts` keeps the cut binaries binary, `fastCut.ts:86-102`).

Note: Lemma C uses the validator in the *completeness* direction (accepting every oracle-valid build). If the production validator wrongly
rejected a valid build, a cut could remove a physical build, and a later "infeasible" or a bound could be wrong. This is why A-VAL is stated
in both directions (section 9.1).

---

## 8. The main theorem

**Theorem S.** *Let `w` be in the declared domain, `r` accepted, and A-DATA, A-VAL, A-ARITH, A-PARSE, A1-A4 hold. Then
`solvePrecise(r)` (`solvePrecise.ts:429-850`) satisfies:*

1. *Every published build is in `F_phys` and its published score is its exact score.* (`decodeFast` + exact validation, `:529-571`; only
   validated candidates enter the search, `search.ts:323-326`.)
2. *If the result is a certified build, `score(B*) >= OPT - tau`* (section 4.2 with Theorem B; the bounds used are settled, decision 5a).
3. *If the result is `empty`, `F_phys = empty`* (Theorem I).
4. *Every published lower bound is `<= score(B*) <= OPT`; every published finite upper bound is `>= OPT`*, the latter under A1 for every solve
   whose bound it uses (GAP G1 for unsettled bounds).
5. *For a request without TED, and on exact TED nodes, the model solved is the target model up to the padding, and the target model is an
   exact reformulation of the physical domain* (Theorem E).

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
| A-VAL | `preparePhysicalValidator(...).validate` accepts a build iff the oracle's `inspectBuild` does (soundness for witnesses; completeness for Lemma C) | Theorem S.1, Lemma C | validator agreement tests (`f6acab1`); exact-rational reimplementation (`src/solver/physical/validate.ts:1-45`) |
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

### 9.3 Code behaviour the proof relies on (at `a19041c`)

| Behaviour | Location |
| --- | --- |
| Unrolling expands every retained candidate and throws on a repeat (P2) | `blueprint.ts:416-456`, `:439-442` |
| One owner template per raw slot id (P1) | `blueprint.ts:381-397` |
| Template-level masks, viability, contradictions, activity | `domain.ts:198-231`, `:238-255`, `:258-268`, `:270-289` |
| Union candidate sets, Kahn order, copy bounds | `templateGraph.ts:74-115`, `:117-128`, `:147-179` |
| Lemma 1 asserted on every domain, failure is a solver error | `specializeCount.ts:66-120`, `solvePrecise.ts:464-469` |
| Certified mode: no single-copy restriction, proof layer | `specializeFast.ts:357-360`, `specializeCount.ts:133` |
| Columns and bounds | `specializeFast.ts:573-610`, `:654-660`, `:786-812` |
| Supply, cover, wallet | `specializeFast.ts:619-668`, `:876-880` |
| Structure rows | `specializeFast.ts:672-695` |
| Conflict rows, clique cover | `specializeFast.ts:395-439`, `:698-724` |
| Includes | `specializeFast.ts:726-740` |
| Statistics, clamps, gear, TED, node rows | `specializeFast.ts:758-882` |
| Caps (recoil padded) | `specializeFast.ts:884-918` |
| MOA rows and dominance | `specializeFast.ts:938-961`, `proof.ts:129-176` |
| Objective plan, frame error, read-through | `specializeFast.ts:1001-1109`, `proof.ts:275-392` |
| Constant rows dropped or contradictions | `specializeFast.ts:509-540` |
| Relaxed text | `specializeFast.ts:1300`, `lpText.ts:150-153` |
| Active-range enclosures | `bounds.ts:33-83`, `numeric.ts:60-64` |
| Padded right-hand sides | `proof.ts:92-103` |
| Penalty lines | `spatial.ts:81-131` |
| Decoder | `decodeFast.ts:35-124` |
| Cuts | `fastCut.ts:44-102`, `solvePrecise.ts:801-810` |
| Qualification and bound evidence | `nativeProof.ts:85-170` |
| Native options (presolve off, tolerances 1e-9 / 1e-7) | `nativeSolve.ts:100-117`, `solvePrecise.ts:479` |
| Opinions, second opinion, settlement | `solvePrecise.ts:380-427`, `:587-666` |
| Relaxation must agree | `solvePrecise.ts:692-727`, `:813-819` |
| Relaxed-first strategy | `solvePrecise.ts:336`, `:740-790` |
| Bound sanity guard (not relied on) | `solvePrecise.ts:304-309`, `:558-568` |
| Search: node bounds, join, fathoming, certified, empty | `search.ts:129-149`, `:255-369` |
| Root intervals | `solvePrecise.ts:347-353`, `:823-827` |

### 9.4 Scope

- **In scope:** `solvePrecise` on the declared domain for every accepted request (weighted and Tchebycheff, every cap, includes, excludes,
  presets, stash, barters with whole lots, TrueErgo and Prevent Overswing, MOA caps), and therefore every operation insofar as it consumes a
  `solvePrecise` result (Optimize, Gunsmith optimization, ideal-point endpoint solves, MOA floor trials: `src/solver/solver.ts:332`,
  `src/solver/moaFloor.ts:313`).
- **Out of scope:** cyclic part data (an internal error); `SLOT_ID_COLLISION`, `MIXED_AMMO_SLOT`, `BAD_PRESET`, `OCCURRENCE_LIMIT` and other typed
  input errors; Fast (`solveFast`), beyond its witness contract (every published Fast witness passes the same validator); the correctness of
  HiGHS; the composition logic of the operations themselves (floor bisection, Explore classification, payoff-table derivation), whose
  correctness is ADR 0004 / ADR 0013 section 6 material and rests on the certificates proved here; the admissibility of the payoff table
  (an input, INTERPRETATIONS.md choice 17); game authority of the provisional MOA model.

---

## 10. GAP register

| Id | Severity | Statement | To close |
| --- | --- | --- | --- |
| G1 | Affects published non-certificate bounds | The upper bound of an unresolved node can come from a single qualified solve (limit stop, a second opinion that timed out, a relaxed try carried through the fallback) and is published for `feasible` / `incomplete` results; decision 5a's second opinion covers certificate-bearing verdicts only | State it in `NATIVE_FRAME.assumptions` and the Details text, or publish only settled bounds (`null` otherwise) |
| G2 | Certificate hardening (sound under A3) | Two qualified Infeasible opinions settle a node even against a third qualified opinion that returned a primal point (`Opinion.point` is set and never read) | Treat `point === true` like a verified build in `settleOpinions`, or record the majority rule in A3 |
| G3 | Affects completeness only | Certified infeasibility (and optimality) is not complete: padding and tolerance boundary points, cuts that break total unimodularity of the relaxed text, 16 rejections per node, six seeds | Accepted as is; an exact boundary proof would close it |
| G4 | Assumption (affects the scope of every certificate if wrong) | A-DATA: the bridge transport of the oracle's domain to the production data model is corroborated, not proved | A written mapping proof of `reference/bridge/toFixture.ts`, or accept as tested |
| G5 | Assumption (affects witnesses and, through Lemma C, certificates if wrong) | A-VAL: production validator equals oracle validator in both directions; corroborated by the agreement tests | A side-by-side rule proof of `validate.ts` against `reference/oracle/validate.ts`, or accept as tested |
| G6 | Documentation | ADR 0009 principle 1 describes an explicit `u_i` surrogate; the count model substitutes it into the lot cover with dominance, lot-bound and linear reductions (proved exact in Lemma A). ADR 0007 principle 5 writes clamps over `[0, 1000]`; the code and oracle use 100. ADR 0003 states pairwise or per-instance conflict rows; the count model uses a clique cover of presence rows (proved exact in Theorems L and P) | An amendment note citing this proof |
| G7 | Documentation (robustness) | `copyBounds` relies on Kahn's order covering every active template, without an assertion; true on the declared domain (Lemma 3) | `assert(topological.length === activeTemplateCount)` |
| G8 | Documentation | The bound sanity guard scales with the request tolerance and detects only shortfalls a same-node build exposes; the proof does not rely on it | None needed; keep the comment honest |

No code defect that makes a published certificate wrong under the stated assumptions was found. G1 and G2 are the two places where the code
gives a weaker guarantee than its surrounding comments suggest; neither is a counterexample to a certificate under A1-A4.

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
