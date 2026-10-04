# ADR 0013: Correctness-First Handoff and Adoption Sequence

## Status
Proposed (Refs #40). Revised 2026-10-04 after parent review. Not accepted. The full proposal is [issue comment 5976882470](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/40#issuecomment-5976882470), which replaces comment 5976708799.

## Context
The decision map ([Issue #28](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/28)) has accepted planning contracts for the physical domain, placement, certificates, benchmarks, provisional MOA, numerics, inventory, purchase, the oracle, binary placement, and preparation. Those comments remain normative in full. This ADR only sequences their implementation.

The first handoff proposal adopted inventory and manifest semantics before the API, worker, and UI that read them, treated every deadline as a feasible build, treated every MOA-dependent result as `approximate_optimal`, and described unfinished proofs as already complete. This revision removes those claims. Acceptance of this plan would not complete the oracle, native, browser, or comparative proofs, and it would not authorize a production change.

## Decision

### 1. Four stages, one public correctness cutover

Private commits on a future isolated branch may be incomplete. No intermediate public contract is adopted. There are no shims, legacy aliases, or fake fallbacks. The implementation branch is not created by this ADR. When implementation is separately authorized, it starts from the preserved source baseline, not from a merge or deploy onto reverted `master`.

| Stage | Adoptable result |
| :--- | :--- |
| 1. Independent oracle, raw-source checks, and the 14-family case ledger, including required rejection of invalid fixtures | The oracle and ledger only. The legacy solver is not required to pass before repairs. "Zero validation errors" applies to builds claimed valid, not to negative fixtures. The 14 families are a ledger of subcases, not 14 files |
| 2. Private implementation of the correctness contract together with its types, decoder, worker, client, UI, benchmarks, native evidence surface, and minimal preparation seam | Nothing public |
| 3. Proof of that whole cutover, including numerical, TED, and MOA boundary families, operation transitions, and browser smoke | The cutover, or nothing. A solver that still fails those families is not adopted |
| 4. Optional equivalent reductions against the proved unreduced baseline | Only a candidate that passes Gates A–C and the full comparative contract. Otherwise the Stage 3 baseline stays |

Correctness repairs are judged against the independent oracle and do not need a 5% speedup. Stage 4 candidates include clamp specialization, second-clamp elimination, a proved single-capacity presence substitution, recoil-cap collapse, and measured preparation reuse. A failed or inconclusive performance candidate does not restore the legacy model. There is no automatic production rollback. This plan does not authorize commits, releases, or pushes.

Preparation is split. The ownership seam required to state the correct model is in Stages 2–3. Measured reuse is Stage 4. Endpoint weights `[100,0,0]`, `[0,100,0]`, and `[0,0,100]` produce `10*fE`, `-100*fR`, and `-0.1*fP`. Unit-axis objectives are not substituted. Sub-millisecond assembly figures are targets, not gates. Domain identity is the full preparation ledger, including stable occurrence masks, not a hardcoded parameter count. The decoded deficit is the authoritative `d_i`; the LP emits linear epigraph inequalities and does not emit a nonlinear max row.

### 2. Status and certificates

Use the accepted deadline, MOA, and oracle tables. In particular:

- A deadline with a verified incumbent and no completed proof is `feasible` / `feasible`, with the witness and justified bounds. The upper bound is finite only when a proved bound exists.
- A deadline with no verified incumbent is `incomplete` / `none`, with `lower_bound: null` and a finite upper bound only when proved.
- A qualified optimum or infeasibility that has already completed stays proved after a late deadline or cancellation.
- Hard client cancellation and native runtime failure use their operation error and snapshot contracts. They are not rewritten as feasible builds.
- `approximate_optimal` is only a qualified model optimum: Fast, or precise and MOA-dependent. An unproved MOA incumbent is `feasible` with `provisional_model`. Proved provisional-model infeasibility is public `incomplete` / `none`, and its internal model proof is retained. Fast and MOA-dependent requests keep both qualifiers.
- MOA-floor (`model_proved`, `model_witnessed`, `unresolved`, `model_infeasible`) and the seven-row Explore contract are separate outcomes. Explore does not cache another point's solution or certificate.
- Invalid `owned_items` does not run HiGHS. Optimize returns `incomplete` / `none`. Explore returns `curve_status: 'invalid'` and no points. MOA-floor returns unresolved with a null floor. Metadata fetches, including `getGunsmithTasks`, stay unchanged.

The shipped HiGHS solution object does not provide a MIP dual bound or native gap. A qualified optimality certificate, certified endpoint cache, or trusted comparative claim waits until the integrated native surface returns the fields it uses. A diagnostic log is not a proof, and a time-limit primal is not an upper bound. Provisional MOA correctness is not attested game-engine truth.

### 3. Source-grounded migration

Preserve `extractAllPresets`: `presetItems` is already a string array that retains repeats. Do not replace that extractor. Add independent source quantity checks.

Preserve `computeIdealPointCacheKey`. It already includes feasibility, acquisition, physical-mode, and filter inputs. Extend it with the owned multiset, versions, and certificate provenance. Do not describe or delete it as a weapon-only key. `computeStructuralBoundsCacheKey` remains the narrower unclipped-bounds key. Do not pass `owned_items` through `canonicalizeArray`.

Keep valid parent coupling, including `p - x_owner <= 0` and the single-owner `x_i - x_owner <= 0` rows. Remove the actual single-copy and FiR defects: `presetItemsMap`'s `Set` construction, the decoder sets that place each item id at most once, the `purchasable: false` FiR path and `UNPURCHASABLE_OBJECTIVE_PRICE_MIN_RUB` objective stand-in, and `buy_eq_${i}: buy_i - x_i = 0` where capacity, preset supply, and owned offset have not been proved.

Manifest, shopping-list, and stat readers must handle repeated copies and chosen base cost. A new owned label is not sufficient. The consumers named in the revised handoff move in the same cutover as the model.

### 4. Comparative non-adoption

The Issue #37 contract is normative, including planned denominators, independent workers, versioned identity, artifact digests, paired blocks, and degeneracy. A BCa interval of `[1.01, 1.03]` is Gate 2 `FAIL`. An upper bound of exactly `0.95` is not Gate 3 `PASS`. A zero-variance apparent speedup is `INCONCLUSIVE`.

## Consequences

- Issue #40 stays open for parent acceptance. This ADR does not close Issue #28 and does not declare the map's proofs complete.
- The dense-TED 60-second target stays deferred. Tolerances are not weakened and valid builds are not dropped to manufacture a timeout success.
- Python or CP-SAT output remains differential evidence only. Backend replacement and new cache tiers stay out of scope.
- A later implementation updates docs and the changelog only after browser smoke. This revision changes the planning record only.
