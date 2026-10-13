# Adversarial review of `docs/proofs/count-model.md`

Reviewed at branch `impl/stage2-correctness-cutover`, tip `8126648`. The proof says it was written at `a19041c`. `git diff --stat a19041c 8126648`
touches no file under `frontend/src/` or `frontend/reference/oracle/`, so every source citation below was checked against the same code the
proof cites. This is a read-only review: no proof, code, test, oracle or ledger file was changed.

Verdict scale: **BROKEN** (a counterexample exists), **GAP** (a step is unjustified or misstated, but no counterexample was found), **OK** (checked
and holds), **CITATION** (wrong reference). Severity: affects certificates / affects bounds of uncertified results / completeness only /
documentation.

## Executable checks run for this review

The scripts live outside the repository, in `D:/tarkov_dev/review-scratch-countmodel/`, and were run with `npx tsx` from `frontend/`. Worlds come
from the repo's generators (`reference/harness/lpFuzz.differential.ts` `generateCase`, `tests/physical/randomWorlds.ts`, `countCompare.ts`
`moaWorld`). The oracle is `runOracle`, and production is reached through `toProduction`.

| Script | What it checks | Population | Result |
| --- | --- | --- | --- |
| `tu.mts` | Lemma TU and Theorem R.1 on the **emitted LP text**. Every row with an edge column is an `in_`, `slot_`, `req_` or `sconf_` row. Edge coefficients are exactly -1 (`in_`) or +1 (all others). Each edge sits in exactly one `in_` row and at most one `slot_`/`req_` row. Every `slot_`/`req_`/`sconf_` row's edge support is the whole edge set of one raw slot. Exact (Bareiss) determinants of random square submatrices (size 1 to 7) of the deduplicated edge block. The relaxed text has the same rows, bounds and costs, and loses integrality on exactly the edge columns | 1,169 certified count models (fuzz, fuzz with a TED node, `randomWorld`, `moaWorld`, `randomTedWorld` with a node), 12,180 edge rows, 465,200 determinants | no failure; every determinant is in {-1, 0, 1} |
| `lift.mts` | Lemmas 2, 3, N, D, F and Corollary 1 on **every oracle-accepted build**. Every placement is an edge column. Edge counts are at most `max` and copies at most `U_t`. Weight, raw ergonomics, recoil sum and accuracy sum lie inside `computeActiveBounds`. `decodeFast` of the build's signature succeeds and gives back the same signature. The production validator accepts the decoded tree with the oracle's exact spend | 3 x 352 complete-oracle worlds (plain, MOA-stressed, TED-stressed), 33,542 accepted builds | no failure |
| `e2e.mts` | Theorem S.1 to S.4 **end to end**: production `solvePrecise` (relaxed-first, second opinions, cuts, the real spatial search with secant nodes) against the oracle optimum. It flags an `empty` result with a nonempty oracle, a published score above OPT, a certified score below OPT - tau, a published upper bound below OPT, and a lower bound above OPT | 4 x 360 worlds, tau = 1e-6. Modes: plain; `ted` (TrueErgo and/or Prevent Overswing, gear factors 0.9, 1.3, 0.65 and 1.2, weights around the 3 kg knee, so real secant nodes and splits run); `moa` (accuracy modifiers up to 60 per part, several barrels with distinct COI, `max_moa` set from a build's MOA, negative in 247 of 623 capped worlds); `mix` | 789 certified, 649 empty, 2 incomplete, **0 problems** |
| `g2.mts` | `settleOpinions` on hand-built opinions (G2 and G1) | pure function | G2 and G1 behave exactly as the proof says (output below) |

One harness note for anyone repeating this. `resolveFixture` memoizes per fixture object (`reference/oracle/resolve.ts:117`), and `generateCase`
already resolves the fixture to draw its caps. So mutating a generated fixture in place gives the oracle stale data and production fresh data.
My first `e2e` run showed three apparent "certified below OPT" cases that were exactly this artifact; the scripts now `structuredClone` before
mutating.

---

## Findings

### 1. Lemma TU (section 7): total unimodularity of the edge block

- **Claim attacked.** With every non-edge column fixed, the uncut edge system is a bipartite incidence matrix with duplicated rows plus bounds, so it
  is TU.
- **Checked.** The only writers of edge columns are `emitStructure` (`specializeFast.ts:676-695`) and the `sconf` loop (`:711-723`). Nothing in
  `:744-1109` (statistics, caps, MOA, objective, TED, node) reads an edge. Mixed rows:
  - `in_t` holds `n_t` and edges;
  - `slot_`/`req_` hold edges and `n_owner`;
  - `sconf_t_s` holds edges and `pres_t`, which is `n_t` or `z_t` (never an edge);
  - `tconf`, `incl`, `catreq`, `supcap`, `cover`, `price_def` and the MOA rows hold no edge.

  With the non-edge columns fixed, every right-hand side is an integer (`n`, binaries, `V_rho`, edge `max`). `mergeTerms` never merges an edge
  with another column, because no count-model row lists a column twice. The single-candidate optional root slot has no row, only the column bound
  `min(1, U_c)`. Duplicated rows do not break TU: a square submatrix with two equal rows has determinant 0, and any other square submatrix is a
  submatrix of the incidence matrix. `tu.mts` confirms the structure on the emitted text of 1,169 models, with no determinant outside {-1, 0, 1}.
- **Scope.** The lemma is correctly restricted to uncut texts. `relaxationAgrees` does solve a relaxed text **with** cuts
  (`solvePrecise.ts:703`, `appendCuts(model.lpRelaxedEdges(), cuts)`), and those cut rows are not TU, as G3 says.
- **Where TU is used.** Only for tightness and completeness: Proposition I', Theorem R.2 ("nothing is lost"), R.3, the R.4 veto rationale, and the
  G2 motivation. No soundness step depends on it. Soundness of the relaxed-first path needs only that the relaxed text is a relaxation (R.1).
- **Verdict: OK.** Severity: none.
- **Suggested wording.** "Identity rows" should read "column bounds". Add one sentence saying TU is used only for completeness and tightness.

### 2. Theorem R (relaxed-first keeps certificates)

- **Checked.**
  - R.1: `toStringRelaxing` (`lpText.ts:150-153`) only removes integrality markers and writes `0 <= e <= 1` for relaxed binaries. Confirmed on the
    parsed texts by `tu.mts`: same rows, bounds and costs.
  - R.2: a relaxed point counts as a point only if every edge is within `NATIVE_FEASIBILITY_TOLERANCE` (1e-9) of an integer
    (`solvePrecise.ts:522-528`). It is then decoded (Math.round, `BINARY_READ_TOLERANCE` 1e-5), validated exactly and confirmed on the relaxed
    text (`:759`). The settled bound is the relaxed dual bound, which is valid because the text is a relaxation.
  - R.3: a relaxed Infeasible needs two agreeing qualified verdicts (`:758`, `confirm`). It is sound under A4.
  - R.4: the integer-text Infeasible veto, `knownPoint` (`:818`), applies the uncut relaxed evidence only when `cuts.length === 0`, which is
    exactly the case TU covers.
- **Verdict: OK.**
- **Documentation note.** R.4 says the relaxed bound "is not used for the integer evaluation's settlement". That is true, but the same bound does
  travel as node evidence on the veto path (`:818`, then `:700`). G1 covers it, and R.4 should point to G1.

### 3. Lemma C (no-good cuts lose no physical build) and its dependence on A-VAL

- **Claim attacked.** A cut on the rounded `(base, e)` of a rejected or undecodable integer point removes no `B` in `F_phys`.
- **Checked.**
  - The cut over `model.decision` (base and edge columns only; `n`, `z` and lots are not decision columns) excludes exactly one integer vector
    (`fastCut.ts:44-83`). The interior indicators force `x >= x*+1` or `x <= x*-1`, and that holds in the relaxed text too, because the cut
    binaries stay binary (`appendCuts`, `:86-102`). `Binary` is always the last section of an `LpWriter` text (`lpText.ts:155-166`), so spliced
    binaries never land in `General`.
  - `decodeFast` and the cut both use `Math.round` on the same `values`.
  - A rejection is a function of the signature (Lemma F) only if the production validator reads nothing but `{base, placements}`. That holds:
    `decodeFast` produces exactly that, with no claimed spend or provenance (`decodeFast.ts:1-21`).
  - Overswing-only rejections on inexact nodes are not cut (`:574-579`). On **exact** nodes they are cut, which is valid by Lemma F (see item 9).
  - `lift.mts`: for all 33,542 oracle-accepted builds, the decoded signature tree passes the production validator with the oracle's exact
    spend. That is the completeness direction Lemma C needs, sampled.
- **GAP (documentation).** A-VAL is stated as "accepts a build iff `inspectBuild` does". Taken literally that is false. The production validator
  has production-only rejections that the oracle cannot raise: `INSTANCE_ID_NOT_PATH_DERIVED` under `requirePathInstanceIds: true`, which
  `solvePrecise.ts:474` sets, and `CLAIMED_SPEND_MISMATCH` / `CLAIMED_ACQUISITION_MISMATCH` (`validate.ts:35-37`, `:93-95`). Lemma C only needs A-VAL on
  path-id builds that carry no claims, which is all `decodeFast` produces.
- **Fix.** Restate A-VAL as: "for every build with path-derived instance ids and no claimed spend or provenance, `validate` accepts iff
  `inspectBuild` accepts". Name the completeness half explicitly as the one a certificate depends on through cuts.
- **Verdict: OK with a documentation GAP.**

### 4. G1 (unsettled bounds on uncertified results): is it worse than stated?

- **Can an unsettled bound reach a certified path?** No.
  - An `unresolved` or `failed` evaluation stops the search immediately (`search.ts:329-333`), so `completed` is false and `certified` is false
    (`:355-367`).
  - Live nodes otherwise only inherit bounds from `solved` (settled) parents (`:344-350`) or start unknown (`:259`).
  - Downstream, payoff endpoints require `status === 'optimal'` (`solver.ts:190`), and the MOA floor uses only witnesses and qualified emptiness
    (`moaFloor.ts:271-276`).
- **GAP (bounds of uncertified results): the source list is incomplete.** G1 names three single-solve sources. There are at least two more:
  - `failed` evaluations. `failed(model, first)` (`solvePrecise.ts:678-680`) carries `first.evidence`, the dual bound of the rejected solve. This
    happens at `:806` (16 rejections, no time left, or an unqualified rejection) and at `:811` (`DECODE_FAILED`). The node goes back live with
    that bound (`search.ts:331`), and the bound is published.
  - `stopAtFirstWitness` short-circuits `confirm` with `first.evidence` (`solvePrecise.ts:633-637`). This happens in a MOA floor query; the floor
    does not publish it as a bound today.
- **Demonstration.** `g2.mts` gives `settleOpinions([optimal(bound 7), timeout])` → `{settled:false, verdict:'unresolved', evidence:{nativeDual:7, qualified:true}}`.
  That single bound is what becomes the node's live bound.
- **Fix.** Extend the G1 row with these two sources. The close-out options in G1 stay the same.

### 5. G2 (Infeasible settled against a third opinion with a point)

- **Demonstration.** `g2.mts`: `settleOpinions([infeasible, optimal(point, no build), infeasible])` returns `{settled:true, verdict:'infeasible'}`.
- **Scope note.** The same pattern also fires on the **integer** text, not only the relaxed one. Example: the first opinion is a qualified
  Optimal whose decoded build fails only for overswing on an inexact node (`:576-577`, `candidate: null`). Two later Infeasible verdicts then
  settle the integer text Infeasible. The relaxation-must-agree rule still applies on that path (`:818`), so a wrong verdict still needs two
  agreeing false relaxed verdicts.
- **Verdict: GAP, as stated by the author, sound under A3.** Severity: certificate hardening.

### 6. Lemma 1, Corollary 1, Lemma 3, Lemma D, Theorem P: attempts at a projection or lift counterexample

- **Lemma 1.**
  - (i) The unrolling never skips a retained candidate. Duplicates are removed by `seenAllowed`, and the ancestor test only throws
    (`blueprint.ts:355-368`, `:430-446`).
  - (ii) Viability depends only on the template-level reason and the required slots' candidates (`domain.ts:233-255`).
  - (iii) `occActive` needs reason ACTIVE, i.e. viable, and a reachable owner (`domain.ts:270-289`). The argument holds.
- **Lemma 2.** `supply` counts preset supply over **accessible** presets only (`domain.ts:207-211`), which is what R-qcap needs.
- **Corollary 1 and Lemma D.** I re-derived the decoder argument on the final state of `placeGreedily`.
  - Let `I_t` be the number of instances of `t`. A slot of `t` gives out `min(I_t, S_rho)` children.
  - Induct in topological order, using `in_t` and the slot rows: every slot holding `t` belongs to an earlier template and is fully consumed,
    so `I_t = n_t`.
  - The candidate order only changes labels. A required slot with no active candidate cannot belong to an active template: `buildTemplateGraph`
    throws `DOMAIN_INCONSISTENT` (`templateGraph.ts:97-101`), and viability rules it out.
  - `lift.mts` exercises the lift direction on 33,542 builds: every signature decodes back to itself.
- **Lemma 3.** `copyBounds` (`templateGraph.ts:147-179`) is the stated DP. Kahn's queue starts only from the receiver: every other active
  template has an active owner occurrence, hence an in-edge, so the order covers `T_act` (G7). No copy or edge count exceeded its bound in
  `lift.mts`.
- **Theorem P.**
  - R-sconf: the `sconf` row's support is the whole raw slot (confirmed in `tu.mts`), and P1 makes a slot id equal to one raw id.
  - The receiver's own `conflicting_slot_ids` are ignored by both the oracle (`reference/oracle/validate.ts:202-212` loops over placements) and
    production (`specializeFast.ts:713`, `t >= 1`), consistently.
  - Includes of the receiver id become `incl_unknown_k` and a contradiction, matching `MISSING_INCLUDE_ITEM` (the oracle's `copies` excludes the
    receiver).
- **Verdict: OK.** No counterexample was found by construction or by sampling.

### 7. Lemma A (acquisition)

- **Checked.**
  - Dominance: `nonDominatedLots` sorts by price ascending, size descending, index; it keeps an offer only if it is strictly larger than every
    cheaper-or-equal one. Replacing a dropped lot by its dominator is sound.
  - Lot bound argument.
  - The three modes: `linear` requires no preset supply and no stock (`specializeFast.ts:643-645`); `covered` requires `owned >= U`; `capped`
    is pinned by `supcap`.
  - Wallet.
  - `lift.mts` compares the production validator's exact spend with the oracle's on 33,542 builds, including barters with lots of 2 or 3,
    presets and stash. The end-to-end runs with `price_weight > 0` and price caps found no gap.
- **CITATION / documentation.** "Trader and flea prices are positive, a barter price is the rounded positive total (`acquisition.ts:93-106`)".
  The barter branch accepts `price >= 0` (`acquisition.ts:102`). A total in (0, 1/2) rounds half-up to a **0** lot price
  (`barterPrice.ts:22-23`, oracle `acquisition.ts:79-81`). Lemma A only needs `>= 0`, so nothing breaks; the sentence is wrong.
- **GAP (documentation).** Lemma A.4 says `priceUpper` is an enclosure "by the argument of Lemma N". The terms are floating **products**
  (`lot.price * lot.maxLots`, `unitPrice * maxCopies`, `:649`, `:658`), so each term carries one extra rounding that Lemma N does not cover.
  The bound still holds: `priceTerms` starts at `bases.length >= 1` and counts every product term, so `m` is at least the number of roundings
  on any term's path and `(m+1)u >= gamma_m` still covers it. The proof should say so.
- **Verdict: OK with a citation fix and a documentation GAP.**

### 8. Lemma M (MOA)

- **Checked.**
  - Big-M validity at both ends of the accuracy range for either COI sign (`proof.ts:129-134`).
  - The dominance algebra: a present larger barrel adds at least `M_t`.
  - The `auto` case split (`specializeFast.ts:947`): if `L >= 0` and `A > 100` every row is slack. If `a_hi <= 100` MOA is monotone in COI. The
    case "not different" makes the rows coincide.
  - A zero intrinsic COI with `L < 0` and no barrel becomes a contradiction row, matching the oracle (MOA = 0 > L).
  - Padding covers only `c/100`, which is the only constructed coefficient.
  - Production `barrels` (active templates, COI > 0 as a double) equals the oracle's "installed COI > 0" on the exact value of the same double.
- **Evidence.** `e2e` `moa` mode: 360 worlds, accuracy sums up to about 240, several distinct barrels, `max_moa` negative in 40% of capped
  worlds. Zero discrepancies.
- **Verdict: OK.**

### 9. Section 4 (objective, frame error, TED, secants, node cover)

- **Checked.**
  - `planObjective` / `exactObjectiveScore` match `score.ts` term by term, including the weights' `max(0, .)` and defaults 1, 1, 0
    (oracle `resolve.ts:226-240`).
  - `frameError` is computed exactly over the axis column domains.
  - The deviation rows are padded in the relaxing direction, so `Lambda(B)` with `tch_t` set to the exact maximum deviation is feasible.
  - Lemma O holds.
  - `upperBoundExact` is the exact sum (`proof.ts:470-475`).
  - Lemma T: re-derived the secant's emitted intercept, `roundDown(intercept + min(sd*lo, sd*hi))`, which makes the gap to the chord nonnegative
    at both ends (`spatial.ts:92-106`).
  - Clamps: every regime's rows are slack with `m >= max(|lo|, |hi|, cap) + cap`.
  - Node cover: roots and splits are closed and cover the clipped active range (`search.ts:172-180`, `solvePrecise.ts:347-353`). When
    `maxWeight == lo` the singleton root is consistent with emptiness, because `sumEnclosure` widens strictly unless every weight is 0.
- **GAP (documentation): S.5 vs Theorem E.** S.5 says the model is the target model "on exact TED nodes". `model.exact` (`specializeFast.ts:1309`)
  is also true on singleton `constant_exact` nodes, where the line sits up to one ulp below `q`, and with a non-double gear factor, where
  `gear_def_lo/hi` are inequalities. Theorem E excludes both. Restrict S.5 to "a node with `hi <= 3` and a double gear factor".
- **GAP (completeness only): rejections on exact nodes.** Because `model.exact` ignores the gear neighbours, an overswinging optimum of an
  "exact" node with a non-double factor under Prevent Overswing is cut (`:574-583`), not refined. The cut is valid (TED is a function of the
  signature), but such a node can exhaust `MAX_REJECTIONS_PER_NODE`. Add this to G3.
- **GAP (documentation; affects certificates only on pathological data): the read-through.** The proof says "power-of-two division is exact"
  (section 3.3) and the code says "no denormal at these magnitudes" (`specializeFast.ts:1022`). Neither checks it. If an axis range endpoint
  were below about `2^-982`, `range / 2^k` would underflow, the `*_n` column domain could exclude `Lambda(B)`, and a qualified bound could drop
  below a physical build's score. It is unreachable with game data.
- **Fix.** Assert `scaled.lo * factor === range.lo && scaled.hi * factor === range.hi`, or withhold the proof.
- **Verdict: OK with three GAPs.**

### 10. Sections 5 and 6 (bound and infeasibility soundness; anything certified on fewer opinions than stated)

- **Checked every path that yields `solved` or `infeasible`.**
  - `provedEmpty` (exact, 0 solves; Theorem I.b.1).
  - Relaxed-first Infeasible or Optimal through `confirm` (2 agreeing).
  - Integer `confirm` (2 agreeing), then `relaxationAgrees`, through `confirm` (2) or the edge-free return (`:696`, which returns the already
    settled integer verdict: 2).
  - `settleOpinions` needs a pair that agrees (`:408-421`). The bound is the largest qualified bound of all opinions (`:402-407`).
  - Nothing is certified on fewer than two agreeing qualified solves, except the exact `provedEmpty` and `domain.empty` cases.
- **GAP (documentation): the edge-free model.** Theorem I case 3 says an edge-free integer text "has its relaxed text identical, same argument"
  (A4). The 2026-10-12 decision was motivated by an **integer** text that HiGHS reported Infeasible under every seed. For an edge-free model the
  "relaxation" is that same integer text, so nothing cross-checks the verdict, and the certificate rests on A3 alone (two agreeing solves of an
  integer text). Edge-free models are trivial: no graph slot, base choice only.
- **Fix.** Say in case 3 that the assumption used is A3 on the integer text, not an independent A4 check.
- **Verdict: OK with a documentation GAP.** The other native qualifications (readback equality, allowances, tolerances, thresholds, presolve
  off; `nativeProof.ts:85-153`) are as stated.

### 11. Citations (spot check)

- **Checked about 130 `file:line` references.** Covered: `blueprint.ts`, `domain.ts`, `templateGraph.ts`, `specializeCount.ts`,
  `specializeFast.ts` (all column and row tables), `proof.ts`, `solvePrecise.ts` (every line in sections 5 to 7 and 9.3), `search.ts`,
  `nativeProof.ts`, `nativeSolve.ts`, `decodeFast.ts`, `fastCut.ts`, `lpText.ts`, `bounds.ts`, `numeric.ts`, `spatial.ts`, `rational.ts`,
  `specialize.ts`, the oracle's `validate.ts`, `stats.ts`, `acquisition.ts`, `resolve.ts` and `score.ts`, and commit `f6acab1`. All point at what
  the proof says, apart from the following.
- **CITATION.** `acquisition.ts:93-106` "positive" barter price; see item 7.
- **Documentation.** The padding paragraph in section 1.4 lists only constructed coefficients. The vertical recoil row's right-hand side
  `cap - nakedV` is also constructed and is padded through `paddedRhs` with a zero deficit (`specializeFast.ts:896`). Theorem L treats it
  correctly; section 1.4 should mention it.
- **Documentation.** "`Opinion.point` set at `:518` and `:583`" should read "computed at `:518`, returned at `:519`, `:527`, `:569`, `:577`,
  `:583`". It is read nowhere (confirmed by grep).

---

## Summary table

| # | Location | Verdict | Severity |
| --- | --- | --- | --- |
| 1 | Lemma TU | OK | none (wording) |
| 2 | Theorem R | OK | documentation (R.4 to point to G1) |
| 3 | Lemma C / A-VAL statement | GAP | documentation (restate A-VAL on path-id, claim-free builds) |
| 4 | G1 | GAP (confirmed, scope wider) | bounds of uncertified results (add `failed` evidence and `stopAtFirstWitness`); cannot reach a certificate |
| 5 | G2 | GAP (confirmed, also on integer texts) | certificate hardening, sound under A3 |
| 6 | Lemma 1, Cor. 1, Lemma 3, Lemma D, Thm P | OK | none |
| 7 | Lemma A | CITATION + GAP | documentation (barter price can be 0; product rounding in `priceUpper`) |
| 8 | Lemma M | OK | none |
| 9a | Theorem S.5 vs Theorem E | GAP | documentation |
| 9b | Overswing rejections on exact nodes | GAP | completeness only (add to G3) |
| 9c | Read-through "exact division" | GAP | documentation; certificates only on data with magnitudes below 2^-982 |
| 10 | Theorem I case 3 (edge-free) | GAP | documentation (rests on A3, not an independent A4) |
| 11 | Citations | 1 CITATION, 2 documentation nits | documentation |

No BROKEN finding.

## Overall verdict

- **Theorem E (exactness of the target model): holds** on the declared domain for requests without TED, and node by node for `hi <= 3` with a
  double gear factor.
  - I found no lift or projection counterexample by construction. The decoder, copy-bound, enclosure and acquisition steps each check out against
    the code and survive 33,542 oracle builds round-tripped through the production model and validator.
  - The TU structure the relaxed-first path relies on is present in the emitted matrix.
  - The only correction is S.5's wording, which overstates exactness to every `exact` node.
- **Theorem S (soundness of published certificates and bounds): holds under the stated assumptions** A0, A-DATA, A-VAL (restated as in item 3),
  A-ARITH, A-PARSE and A1 to A4, with decisions 4 and 5b as stated.
  - Every certificate-bearing verdict rests on two agreeing qualified solves or on an exact contradiction.
  - Unsettled single-solve bounds stop the search and so never enter a certificate.
  - In 1,440 end-to-end runs of production `solvePrecise` against the oracle, including the real secant spatial search, MOA rows with A > 100
    and negative caps, and lots, presets and stash, there was no unsound result.
  - The register should gain:
    - the extra G1 sources;
    - the integer-text form of G2;
    - the exact-node overswing cut in G3;
    - the edge-free case of Theorem I (A3 only);
    - the read-through underflow precondition.

  None of these is a counterexample to a certificate under A1 to A4.
