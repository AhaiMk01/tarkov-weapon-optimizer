# ADR 0004: End-to-End Certificate, Status and Deadline Semantics

## Status
Accepted planning contract (Refs #35), merged with later accepted #41/#42 qualification and operation envelopes and the corrected #40 integration choices. Reconciled 2026-10-04; no production/native implementation is claimed.

## Context
The solver serves diverse consumers: direct solve, worker messages, Optimize UI, Explore, Gunsmith, MOA-floor search, and automated benchmark classification. Audits and review findings revealed key semantic requirements:
1. **Source Objective Scaling & Directional Deviations**: `ERGO_SCALE = 10` and `SCALE = 1000` define $fE$ and $fR$. Augmented Tchebycheff scoring in `trueErgo.ts` subtracts directional deviations without an outer zero-clamp, providing directional bonuses when exceeding ideal targets rather than absolute penalties, with `sum = e + r + p || 1` preventing NaN on all-zero weights.
2. **Domain Equivalence Prerequisites on Infeasibility & Optimality**: Physical certification requires request-level proof, exact placement, independent witness validation where applicable, and the Issue #36 mathematical lifting/projection and finite-fixture gates. Precise linear MIPs require qualified native-bound metadata just as spatial solves require a justified global bound.
3. **Cross-Context Clock Skew & Pre-Stage Guards**: Web Window and Web Worker have different `performance.timeOrigin` baselines, requiring normalization to monotonic epoch time, out-of-band cancel dispatch, and strict $\text{remaining\_ms} \le 0$ guards before every stage and after cancellation yields.
4. **MOA Lower Bounds & Instance Witnesses**: Initial lower bound must be certified or remain unproved; bisection must not start with $\text{lo} = \text{null}$; witness builds must carry full instance manifests; and outward rounding proofs are delegated to Issue #34.
5. **Consumer Invariants**: Gunsmith, benchmark nullable gap handling, and Explore curve terminal states must follow explicit, unambiguous transition rules.

## Decision

The [canonical #35 contract](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/35#issuecomment-5957714022) remains normative except where later [MOA authority #41](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/41#issuecomment-5966142296) and [inventory/operation envelopes #42](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/42#issuecomment-5971674033) supersede it. The merged rules below also incorporate the [post-acceptance #40 review](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/40#issuecomment-5977261158) and explicit integration choices; obsolete #35 floor names and the ADR 0001 linear-metadata exemption do not survive.

### 1. Request-Wide Clock, Deadline and Cancellation

- Normalize clocks as `performance.timeOrigin + performance.now()`. The client stamps one epoch deadline at caller entry, including queue time, preparation, endpoints, native sub-solves, reconstruction and validation. Default optimization/Explore budget is 60,000 ms; `computeMOAFloor` defaults to `timeLimitMs = 30000`. No unlimited browser-worker execution.
- At queue expiry, do not launch preparation: Optimize returns `incomplete`, `termination: 'limit'`, no build/proof and `reason: 'Queue timeout before dispatch'`; Explore returns `curve_status: 'invalid'`, `points: []`, the same reason; floor returns `unresolved`, null floor/display/lower-bound/witness and the same reason.
- Check `remaining_ms <= 0` before every stage and after each cancellation yield. Only a strictly positive allowance may launch native work with `max(0.001, remaining_ms / 1000)` seconds. Preserve completed proofs or the last verified incumbent rather than launching one more solve.
- Cancel messages bypass `dispatchChain`. Explicit **macrotask** yields (`setTimeout(resolve, 0)`) between spatial nodes, all three ideal-point solves, Explore steps and floor trials allow cancellation delivery; an `await` that yields only microtasks is insufficient.
- Hard termination rejects active/queued promises exactly once with typed `CancellationError`, recreates the worker and preserves only verified snapshots already published to client state. Runtime failures use the typed error envelope and `SolverError` contract from #35, never a fabricated Optimize build.

### 2. Objective Meaning and Proof Units

Keep `ERGO_SCALE = 10`, `SCALE = 1000`: $fE = 10\,\text{ergonomics/TED}$, $fR = 1000\,\text{summed recoil modifier}$, $fP = \text{exact objective purchase cost in RUB}$ under the accepted acquisition contract. Inaccessible-price heuristics are not acquisition cost.

For resolved non-negative weights, weighted score is:
$$\text{score} = (e/10)fE-rfR-(p/1000)fP.$$

For augmented Tchebycheff, set `sum = e + r + p || 1` and:
$$c_e = \frac{e}{\text{sum}\max(z_E-nad_E,1)},\quad c_r = \frac{r}{\text{sum}\max(nad_R-z_R,1)},\quad c_p = \frac{p}{\text{sum}\max(nad_P-z_P,1)}.$$
Active deviations are $d_E=c_e(z_E-fE)$, $d_R=c_r(fR-z_R)$, $d_P=c_p(fP-z_P)$ for positive respective coefficients; their maximum is zero only when no axis is active.
$$\text{score} = 0.01(c_efE-c_rfR-c_pfP)-\max_{a\in\text{ActiveAxes}}d_a.$$
Preserve signed active deviations without an outer zero-clamp; all-zero weights give score zero. Objective values, lower/upper bounds, correction allowances, gaps and the default `1e-5` tolerance share the declared objective frame. Endpoint scales remain those specified in ADR 0001/0012.

### 3. Proof State, Qualification and Public Status

`model_qualification` records resolved placement (`exact` for Precise, `approximate` for Fast), not independent proof. `moa_qualification` is **`null`** on MOA-independent responses and **`provisional_model`** when a MOA cap/floor is active. Both qualifications survive on combined Fast+MOA requests.

`optimization.termination` describes **search completion only**. Retain the two wire values: legacy-named `optimal` means the executed model/search completed, including Fast or provisional-model emptiness; `limit` means it did not complete (or never started). Neither value grants physical or model proof. Completed native search followed by failed validation/proof qualification retains `optimal`; an unfinished spatial search retains `limit` even if its last native sub-solve completed. UI timeout/retry advice comes from the factual reason, not from `limit` alone. Native failures remain typed errors; completed proof and completion snapshots survive late interruption.

Physical optimality/infeasibility requires all applicable #31/#32/#33 domain/acquisition, #34 numerical/native and [#36 equivalence gates](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/36#issuecomment-5974832944), not a precision label. Every accepted published build, including Fast, must reconstruct and validate independent instance quantities, spend, constraints and rooted placement. This accepted-output obligation does not assert a new universal theorem for all raw Fast model points.

| Completed or interrupted outcome | Public `status` | `optimization.termination` | `physical_certificate` | Qualification / diagnostic |
|---|---|---|---|---|
| Qualified Precise MOA-independent optimum, verified witness | `optimal` | `optimal` | `certified_optimal` | Justified native/global gap within tolerance |
| Qualified Fast optimum, verified witness | `optimal` | `optimal` | `approximate_optimal` | Placement remains approximate |
| Qualified Precise or Fast provisional-MOA optimum, verified witness | `optimal` | `optimal` | `approximate_optimal` | MOA remains provisional; Fast also remains approximate |
| Qualified Precise MOA-independent infeasibility | `infeasible` | `optimal` | `certified_infeasible` | Complete authoritative-domain proof, no witness |
| Completed Fast MOA-independent model infeasibility | `incomplete` | `optimal` | `none` | `Approximate model infeasible` |
| Completed Precise provisional-MOA model infeasibility | `incomplete` | `optimal` | `none` | `Provisional MOA model infeasible` |
| Completed Fast provisional-MOA model infeasibility | `incomplete` | `optimal` | `none` | `Fast provisional MOA model infeasible` |
| Required proof withheld or rejected final decode; earlier verified incumbent exists | `feasible` | `optimal` if search completed, otherwise `limit` | `feasible` | Retain that witness, never publish the rejected candidate |
| Required proof withheld or rejected final decode; no verified incumbent | `incomplete` | `optimal` if search completed, otherwise `limit` | `none` | `lower_bound: null`, no build |
| Invalid `owned_items` input | `incomplete` | `limit` | `none` | `Invalid owned_items format`; null proof bounds, no build, LP/native/cache work |

The no-proof rows cover interruption and proof/validation withholding without a clock event. All completed model-emptiness searches use `optimal`, irrespective of Fast/provisional authority; all unfinished searches use `limit`. Status, certificate, qualifications and reason alone describe proof scope. An already completed qualified proof and search-completion state are never downgraded by a late cancel/limit.

Diagnostic precedence: reject invalid inventory at entry before any downstream work. Once a completed qualified proof exists, retain it. Otherwise an observed independent-validation failure uses `Independent build validation failed` even if expiry/cancel coincides; withheld prerequisite diagnostics likewise must not be hidden by an incidental clock event. Pure interruptions use `Cancelled by user`, then `Time limit reached`, then `Node limit reached` when multiple such flags coincide. Native exceptions still use typed error transport, with already published snapshots retained separately. A reason string never promotes an unproved result.

### 4. Native Prerequisites and Global Bounds

Qualified proof requires the planned pinned/reproducible WASM **and matching glue/ABI** build, recorded core/wrapper/toolchain versions and digests, structured full-precision primal objective/columns, status/dual/gap extraction before native-handle destruction, and parsed-model equivalence/readback. Configure matrix thresholds explicitly and verify no emitted coefficient is filtered or changed outside its proved representation/rescaling frame. Remove the unqualified stock-package fallback. Rounded pretty-output primals, native status text and timeout primal objectives cannot supply proof.

Global spatial upper bounds include **live and tolerance-fathomed** frontier bounds as well as the incumbent:
$$UB_{\text{global}}=\max(UB_{\text{incumbent}},\max_{k\in\text{Live}\cup\text{ToleranceFathomed}}UB_k).$$
All terms use the corrected outward-safe bound/objective frame; the incumbent term encloses its model objective upward, while the proof lower bound encloses it downward. Retain tolerance-fathomed bounds even after removing their nodes from the live queue. An unknown/unbounded region makes the global upper bound unknown. Gap/pruning comparisons are outward-safe under #34, not subtraction of nominal displayed scores.

Transport `lower_bound`, `upper_bound` and `absolute_gap` as `number | null`; no witness/unknown/infinite bounds are null, never zero or coerced in subtraction. Finite zero remains numeric zero. Linear precise optima must emit justified native-bound metadata; a successful spatial interval alone is not a global certificate.

### 5. Explore Schedule and Terminal Matrix

Require a declared nonempty schedule, $N\ge1$. Classify every requested target exactly once: **V** is an independently verified `optimal`/`feasible` witness; **I** is `status: 'infeasible'` **and** `physical_certificate: 'certified_infeasible'`; **U** is unresolved, including Fast/provisional model infeasibility and every unlaunched/missing target; **E** is an error/exception. I requires the precise authoritative-domain proof, never merely an internal model proof.

| Composition across all requested targets | `curve_status` |
|---|---|
| All V ($V=N$) | `complete` |
| V and I only ($V\ge1,I\ge1,U=E=0$) | `complete` |
| $V\ge1$ and ($U\ge1$ or $E\ge1$) | `partial` |
| All I ($I=N$) | `infeasible` |
| Zero V and ($U\ge1$ or $E\ge1$) | `invalid` |
| Cancellation actually stops at least one step, $V\ge1$ | `partial` |
| Cancellation actually stops at least one step, zero V | `invalid` |

Late cancellation after all N terminal outcomes does not override completed `complete`/`infeasible`. `complete` certifies discrete requested coverage only, not a continuous Pareto proof. Invalid inventory and queue-expired requests return `invalid`/`[]` with their reason. Empty schedules fail validation, not vacuously `complete` or `infeasible`.

### 6. Provisional MOA-Floor Search

Floor caller/payload/internal solves carry the same full validated immutable acquisition and feasibility domain: trader/player access, flea/barter/dogtag flags, owned stock, item/category constraints, budget/physical limits, equipment/axis/precision settings and bound provenance. Trials specialize only their MOA cap; do not silently enable market access, lose stock or source a witness from a different request.

- The operation seeks minimum **model MOA**, not minimum spend. Seed and threshold queries use price preference (`ergoWeight = recoilWeight = 0`, `priceWeight = 1`, weighted mode, no Sweet Spot payoff solves); preserve every caller acquisition/physical constraint. Price is secondary to the cap search and never narrows its feasible set. Any independently verified limited-query witness suffices; do not require price optimality or start extra price/tie-breaking solves. Equal-cost builds, including free extras, need not be stable or minimal in part count. Resolve placement Precise even when ordinary optimization requests Fast/Auto. A seed is only achievable hi, not the minimum.
- An independently proved finite analytic lo is optional, not a bootstrap prerequisite. If absent, start **lower-bracket discovery** with `d = max(1 MOA, abs(hi)/2)` and probe `t = hi - d`. A verified witness updates hi to the smaller independently enclosed achieved MOA; double d for the next discovery probe. Qualified Precise provisional-model infeasibility at t establishes lo=t and starts bisection. This explicitly supersedes #41's immediate no-lo return: it does not invent lo=0 or require a new analytic formula.
- With lo, probe `t = lo + (hi-lo)/2`. Witnesses update only hi; qualified Precise model infeasibility updates only lo. Thresholds are internal finite real MOA caps, including zero and negative values: use null/absence checks, not truthiness, UI clamping or an implicit nonnegativity assumption. All coefficient/allowance and exact cap/witness checks remain under ADR 0007. Keep the previous witness if a returned build does not improve its certified achievable upper enclosure.
- Discovery and bisection together use at most **14 threshold solves**, under the one 30,000-ms queue-inclusive budget (seed included in time, not in the 14 trials). A nonfinite/nondecreasing threshold, overflow, lack of verified progress, U/E/Fast-infeasible response, withheld proof or deadline/cancel stops without promoting a bound. Such stops retain the last full verified witness as `model_witnessed` and lo if actually proved. Missing lo alone never stops discovery. No time/proof prerequisite means no new solve.
- `model_proved` requires a verified hi witness, finite qualified lo and outward-proved `hi-lo <= 0.02 MOA`; `model_witnessed` is an upper-bound witness without that proof; `unresolved` has no verified witness; `model_infeasible` is qualified Precise seed-model emptiness. UI says “best witnessed MOA — minimum not proved” for `model_witnessed`, not “minimum floor”. Already completed bracket proof survives late interruption. All bounds remain provisional-model-relative, never game-physical floors.
- Preserve raw hi in `floor`; optional `display_floor` must satisfy `display_floor >= hi` under #34's outward rounding/submission contract or be null. Witness manifest includes unique instances, physical slot pairs, selected preset quantities, acquisition provenance and the full resolved configuration scope.

### 7. Merged Shared Transport Shapes

These are planned shared schemas, not declarations that the preserved code already implements them. `ItemDetail`/`PresetDetail` use the accepted instance/quantity/acquisition contracts; `WitnessBuild` is the full-instance record and resolved scope described above and in #35/#42.

```typescript
export interface OptimizationMetadata {
  lower_bound: number | null;
  upper_bound: number | null;
  absolute_gap: number | null;
  tolerance: number;
  nodes: number;
  termination: 'optimal' | 'limit';
}

export interface OptimizeResponse {
  status: 'optimal' | 'feasible' | 'incomplete' | 'infeasible' | 'error';
  physical_certificate: 'certified_optimal' | 'approximate_optimal' | 'feasible' | 'certified_infeasible' | 'none';
  precision_request: 'fast' | 'precise' | 'auto';
  precision_resolved: 'fast' | 'precise' | null;
  model_qualification: 'exact' | 'approximate' | null;
  moa_qualification: 'provisional_model' | null;
  selected_items: ItemDetail[];
  selected_item_ids: string[]; // multiset projection
  selected_preset?: PresetDetail;
  objective_value: number | null;
  reason?: string;
  final_stats?: FinalStats;
  solve_time_ms: number;
  slot_pairs: { parentInstanceId: string; slotId: string; childInstanceId: string; itemId: string }[];
  optimization: OptimizationMetadata;
  ideal_point?: IdealPoint;
  endpoint_cache?: 'hit' | 'miss';
}

export interface ExplorePoint {
  ergo: number;
  recoil_pct: number;
  recoil_v: number;
  recoil_h: number;
  price: number;
  selected_items: ItemDetail[];
  selected_item_ids: string[];
  slot_pairs: { parentInstanceId: string; slotId: string; childInstanceId: string; itemId: string }[];
  status: 'optimal' | 'feasible'; // only independently verified witnesses become points
  physical_certificate: OptimizeResponse['physical_certificate'];
  precision_resolved: 'fast' | 'precise';
  model_qualification: 'exact' | 'approximate';
  moa_qualification: 'provisional_model' | null;
  reason?: string;
  solve_time_ms: number;
  optimization: OptimizationMetadata;
  point_label?: string;
}

export interface ExploreStepOutcome {
  target_index: number;
  outcome: 'V' | 'I' | 'U' | 'E';
  point_index: number | null;
  status: OptimizeResponse['status'];
  physical_certificate: OptimizeResponse['physical_certificate'];
  precision_resolved: OptimizeResponse['precision_resolved'];
  model_qualification: OptimizeResponse['model_qualification'];
  moa_qualification: 'provisional_model' | null;
  optimization: OptimizationMetadata;
  reason?: string;
}

export interface ExploreResponse {
  curve_status: 'complete' | 'partial' | 'infeasible' | 'invalid';
  points: ExplorePoint[];
  sweep_schedule: { target_index: number; target_value: number }[];
  step_outcomes: ExploreStepOutcome[]; // one per target, U if never launched
  total_solve_time_ms: number;
  precision_request: 'fast' | 'precise' | 'auto';
  precision_resolved: 'fast' | 'precise' | null;
  model_qualification: 'exact' | 'approximate' | null;
  moa_qualification: 'provisional_model' | null;
  reason?: string;
}

export interface MOAFloorResponse {
  status: 'model_proved' | 'model_witnessed' | 'unresolved' | 'model_infeasible';
  moa_qualification: 'provisional_model';
  floor: number | null;
  display_floor: number | null;
  proved_lower_bound: number | null;
  witness?: WitnessBuild;
  solve_time_ms: number;
  reason?: string;
}
```

Invalid inventory returns operation-specific envelopes with `reason: 'Invalid owned_items format'`: Optimize has empty selections/manifest, null objective/proof bounds, null unresolved precision/model fields, nodes zero and termination limit; Explore has invalid/empty points and no invented schedule proof; floor has unresolved/null floor/display/lower-bound and no witness. Metadata still records elapsed time. No endpoint solve or cache lookup launches. `getGunsmithTasks` remains metadata, not an Optimize response; actual Gunsmith optimization forwards the acquisition input and inherits Optimize fences. Error status remains available for diagnostics/classification; native exceptions travel as typed #35 error envelopes, not successful response-shaped fake builds. Explore aggregate precision/model is its uniform resolved request mode when known, otherwise null; per-target qualification is authoritative. Aggregate MOA qualification is provisional when the sweep depends on that model, otherwise null.

### 8. Consumer Migration and Evidence Boundary

Migrate solver/native glue, worker/client/direct adapters, Optimize/Explore/Gunsmith/floor callers, nullable-bound UI and benchmark classifiers together in the accepted single correctness cutover. Public proof requires pinned schema, authority and normalization versions in provenance. No older envelope alias, stock fallback or implicit free/unlimited inventory remains. Neither acceptance of this document nor historical contract smoke checks establish production/native/parser, performance or game-authority proof.

The owner chose supported-only EFTForge export: preserve the external format only where the instance placement is representable and unambiguous; clearly disable unsupported or ambiguous multi-instance/multi-copy exports. Do not invent a replacement external format or serialize misleading template-only pairs.

## Consequences & Downstream Contracts

- **Issue #34 ([accepted numerical authority](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/34#issuecomment-5970763741))**: Implement complete-DAG/parser/native prerequisites and accepted outward floor/submission safety; no new analytic floor guarantee is implied.
- **Issue #36 ([accepted independent equivalence gates](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/36#issuecomment-5974832944))**: Establish implementation evidence for the accepted domain/objective theorem and finite-fixture gates before physical proof; retain [#31 physical/acquisition](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/31#issuecomment-5945998692) and [#32 occupancy/rootedness](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/32#issuecomment-5955673941) source authority.
- **Issue #37 ([accepted telemetry/benchmark contract](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/37#issuecomment-5963491079))**: Record epoch/queue/stage/native provenance and migrate primary/qualified-secondary classification under ADR 0005; historical unsupported telemetry is not a permanent rebuilding prohibition.
