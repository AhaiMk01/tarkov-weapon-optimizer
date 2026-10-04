# ADR 0013: Correctness-First Handoff and Adoption Sequence

## Status

**Accepted planning amendment (Refs #40).** [Canonical owner-review amendment](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/40#issuecomment-5982036627) supersedes the withdrawn execution-ready acceptance and explicitly amends the circular #41 bootstrap and mixed termination semantics. Final map acceptance requires the local commit/fixture/bundle persistence receipt. Local planning-only persistence is authorized; solver implementation, native proof, source publishing, pushes and releases are not.

## 1. Authority, source pins and resolved choices

### Normative decisions and precedence

- [Physical/acquisition domain](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/31#issuecomment-5945998692): counts, physical slots, accessible base and required occupancy.
- [Precise occupancy/rootedness](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/32#issuecomment-5955673941): binary occurrences and the separate template/self/slot conflict rules.
- [Exact acquisition/reductions](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/33#issuecomment-5972663056).
- [Bound-safe numerics](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/34#issuecomment-5970763741).
- [Status/deadline/cancellation](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/35#issuecomment-5957714022).
- [Independent oracle/equivalence](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/36#issuecomment-5974832944).
- [Comparative gates](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/37#issuecomment-5963491079).
- [Preparation ownership](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/38#issuecomment-5976600879).
- [Retain binary precise placement](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/39#issuecomment-5975761508).
- [Provisional MOA authority](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/41#issuecomment-5966142296).
- [Owned-item validation/supply](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/42#issuecomment-5971674033).

The linked decisions remain normative except where this owner-review amendment explicitly supersedes the immediate no-lo floor return in #41, mixed search-completion semantics in the previous #40/#35 integration, and tie-sensitive witnessed-floor quality gate. Later #41/#42 still control provisional authority, inventory and operation envelopes; #33 supplies the exact decoded deficit; #38 supplies preparation/endpoint frames. No other adoption, authority or cache scope is expanded. A stale ADR or deployed documentation snapshot never overrides the current canonical resolution.

### Pinned evidence baseline

- Preserved source: backup/pre-revert-2.13 @ a4ab2a5fd189c9451304087641a584d90fc249eb. The earlier reconciliation was initially uncommitted, then saved with the large fixture in the old planning branch. That fixture-bearing history is now **archival only: do not merge or push it**. The owner selected a new docs-only branch `planning/oracle-and-reductions-clean` from pre-fixture planning commit `0e77213`; final receipt pins its full base/tip IDs and verifies the fixture blob is not reachable.
- Normalized fixture SHA-256: 219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c. Preserve it as a separate hashed compressed artifact, not a tracked file or ancestor blob of the mergeable planning branch. Restore it to ignored frontend/benchmarks/snapshot.json only when needed. No regeneration or raw upstream provenance is claimed. Old fixture-bearing bundles remain archival and cannot be used as the mergeable branch.
- Stage 1 must separately identify/hash any raw upstream documents used to independently check adapter transformations; record the normalization/source version and relationship to the normalized fixture. No live fallback or silently regenerated fixture in formal runs. Raw fields retained in the fixture can be independently checked there; missing raw provenance limits the adapter claim rather than being invented.
- Final receipt records the clean docs-only commit/bundle, separately hashed fixture artifact, independent physical-disk backup and actual offline reconstruction. D: and C: share disk0; E: is disk1. Same-drive bundles alone are not backups; independent local disk is not offsite protection. No push/release/source implementation or history rewrite is authorized.

### Owner choices settled in this exchange

1. **Delivery:** retain the selected one complete correctness cutover. Private development phases can be incomplete; no intermediate public contract is adopted. No shims, obsolete aliases or fake fallbacks.
2. **Floor:** replace the circular immediate witnessed-only return with lower-bracket discovery followed by qualified Precise bisection. No invented lo=0 and no analytic lower-bound formula are needed. `model_witnessed` remains the fallback only when the search cannot complete; it is an upper-bound witness, not a minimum.
3. **Benchmark coverage:** the user chose **qualified secondary non-regression gates** for Fast, provisional-MOA and floor cases. Only physically certified precise cases can be primary speedup cases. Section 7 defines the distinct secondary goals, including witnessed-only floor cases, without relabeling them as proofs.
4. **External export:** the user chose **disable unsupported export**. Preserve verified representable EFTForge v1 exports; clearly disable ambiguous/unrepresentable instance/multi-copy export. No invented external version or payload.
5. **Completion:** termination records whether the executed search completed, never proof authority. All completed model searches use `optimal`, including Fast emptiness; unfinished/unstarted searches use `limit`. Proof is carried separately by status, certificate, qualification and reason. UI retry/timeout advice uses the actual reason.
6. **Persistence:** the owner selected a clean docs-only planning branch without rewriting the old branch. Keep the large fixture outside mergeable Git history; preserve old history only as a clearly marked archive. Store current bundle/fixture and archival backup on independent physical disk E:. Never merge/push the old fixture-bearing branch or use push --all/mirror to publish it inadvertently.

## 2. Executable stages and adoption boundary

| Stage | Dependencies | Required deliverables | Adoptable result |
| :--- | :--- | :--- | :--- |
| 1. Independent verification foundation | Source/snapshot pins and domain decisions | Raw reader, exhaustive finite-fixture oracle in exact Q, independent reference validator, source checks and full case ledger | Reference expectations only; legacy production extraction/solver may fail those expectations |
| 2. One private correctness cutover | Stage 1 expectations established | Quantity extraction, physical/acquisition model, exact numerics, pinned native surface/parser, response/types/runtime, decoder/production validator, preparation, client/worker/UI/export and every test/benchmark consumer | Nothing public while any contract is incomplete |
| 3. Prove the unreduced cutover | All Stage 2 deliverables present together | Finite-fixture A/B/C results plus declared-domain lifting/projection proof, native/parser/numerical evidence, operation regressions, expanded type checking and actual browser smoke | The complete corrected baseline, or withhold it |
| 4. Optional exact performance candidates | Versioned oracle-correct Stage 3 baseline | Candidate-specific A/B/C proof, complete consumer migration, primary and qualified secondary comparative gates | Only proved/admissible candidate; FAIL/INCONCLUSIVE keeps the correct baseline |

Stage 2 contains every numerical/TED/MOA prerequisite; none waits until after Stage 3 public adoption. The minimal preparation seam and already authorized sharing/reuse are part of Stage 2. Stage 4 does not undo them on an inconclusive optional candidate. Correctness repair does not require a manufactured 5% speedup. Optional reductions never roll correctness back to the invalid legacy model. No automatic production rollback, branch checkout, release or deployment is part of these gates.

## 3. Stage 1: independent references and complete ledger

### Independence and source checks

Build a **separate test-side reference reader and validator** over pinned source JSON. Neither calls production extraction, compatibilityMap, LP, HiGHS, decoder, scoring/pricing helpers or the production validator. Sharing immutable source bytes is allowed; sharing a defective transformation as the truth is not. Stage 3 compares upgraded production validateBuild with every independent reference accept/reject.

Enumerate the adopted finite rooted occurrence domain, honoring no ancestor-template repetition but allowing siblings/repeated templates. Exact Q evaluation decodes finite binary64 leaves to integer ratios and declared constants to their rational definitions, including K=1000000/29089, ERGO_SCALE=10, SCALE=1000, augmentation=1/100. Tie equality is exact Q equality. Runtime tolerances and outward arithmetic are separate; a small positive gap is never called an exact tie. Stop/incomplete enumeration is not proof of emptiness.

Independently check source cardinality/references, slot IDs, containsItems counts, retained fractional mass and preset multiplicities. The existing extractor **does lose count** even though its array preserves repeated entries. Stage 1 is expected to expose that defect; it does not require the broken extractor to pass before repair. Check relevant JSON adapter dereferencing, categories, translations, synthesized flea offers and barter requirements/valuation against separately pinned raw evidence; state any trusted source assumption explicitly. Malformed/unresolved source is an input/evidence failure, not infeasibility.

### Fourteen-family ledger with required subcases

Each case records source/request, prerequisites, complete finite feasible projections or expected rejection, exact score/tie expectations, requested runtime tolerance, admitted bound/certificate outcome and reference validator result. It is not fourteen files or a source-count test.

1. **Conflicts:** template pair exclusion, self-copy cap, physical slot conflicts and legal alternative placements. Do not conflate those relations.
2. **Required/availability:** empty root required slot, empty conditional mod slot, and unavailable candidates; expected rejection is a pass.
3. **Rooted graph:** descendant/fixed-point removal, alternative parents, self/ancestor loops, indexed-orphan removal and memoization context.
4. **Includes/caps:** item and category includes/exclusions, group structure, magazine/sighting boundaries, recoil final-cap conversion and other hard caps.
5. **Bases:** inaccessible naked/accessible preset, no legal base, expensive but legal offers; no price-zero invented receiver or preset-only arbitrary-price rule.
6. **Preset quantities:** source count>1, multiple copies, stripping **and retention**, base cost once and no forced preset monopoly.
7. **Owned monotonicity:** same-build spend nonincrease, feasible-set expansion and maximum-score nondecrease as stock expands; not a claim that chosen optimum spend cannot rise.
8. **MOA:** positive replacement barrel, optional/required fallback, missing/nonpositive COI, zero intrinsic COI, signed accuracy, constant row and high-divergence provisional model examples.
9. **Supply multiplicity:** repeated required copies with insufficient/sufficient stock, mixed preset/owned/paid supply and exact standalone-inaccessible caps.
10. **Disconnected/cyclic:** no disconnected selected assembly, conditional owner deactivation and retained alternate rooted path.
11. **Objectives/clamps:** every raw/effective clamp regime and boundary, identity/zero gear factor, all-zero weights, inactive axes, signed active Tchebycheff deviations and normalization floors. Resolved weights are nonnegative.
12. **TED/numerics:** W below/at/above 3 kg, singleton/narrow intervals, hard secant domains, mapping/parser/coefficient errors and overswing nonzero iff TED<0.
13. **Epigraph/ties:** zero price weight, exact wallet/budget deficit, multiple presets, exact optimizing ties without epsilon/base penalties, and optional reduction counterexamples.
14. **Instances/source precision:** repeated instance identity and manifest, fractional 0.0155 kg, signed/negative-weight bounds and source quantities.

Well-separated strict-optimum fixtures and exact ties are supplemented by tiny positive-gap and near-cap cases. Justified reported intervals contain the oracle optimum in the same frame; runtime epsilon-optimality does not redefine the exact tie set.

## 4. Stage 2: correctness deliverables and concrete migration inventory

### A. Quantity-preserving data and model

Repair extractAllPresets and request count in the GraphQL fallback. In jsonApiAdapter, remove the unproved `contained.count ?? 1` normalization: require/preserve explicit raw finite nonnegative integer counts. Absent, null or malformed raw counts are source/input errors unless a separately pinned source-schema contract establishes a default; none is adopted here. A default-filled normalized count cannot prove original raw quantity. Preserve validated counts through PresetInfo/PresetDetail using one count-bearing representation, e.g. items of {itemId,count}; repeated entries sum counts. No obsolete unit-only alias or Set loss. Preserve receiver/base identity separately from component supply. Version/invalidate normalized caches after this normalization change; independently check raw provenance rather than trusting old default-filled fixtures.

Migrate dataService, jsonApiAdapter, solver/types, LP preset maps and fallback maps, reconstruction, structuralBounds preset weight, details/manifest/shopping list and fixture readers. Fix later Set consumers too; they are not the extraction defect's only cause.

The physical graph uses occurrence/path identity, template-slot collision assertion across distinct templates, sparse normalized adjacency and stable physical indexes. User filtering uses separate immutable-domain masks, with required-empty/fixed-point/root-reachability rules and surviving alternative paths. Undecided optional parents are not pruned as “unselected.” Retain valid coupling concepts using new occurrence identities, not unchanged single-owner template assumptions.

Emit:

- Exactly one accessible naked or preset base. No accessible base means an explicit contradictory base-choice row, not a free fallback.
- Required root occupancy one; empty root row contradictory. Required mod occupancy equals its owner occurrence; empty row forces that owner off. Do not skip empty required slots during indexing.
- Template conflicts as linked presence exclusions y_A+y_B<=1; self-conflict limits total installed A copies to one; physical slot conflicts x_u+occupancy(s)<=1 for every matched physical slot. Copies of A remain legal when B is absent.
- Inclusion from legal standalone acquisition, selected-base preset supply or owned stock. When no standalone purchase exists: installed_i <= sum_b q_bi*base_b + owned_i. Stock does not grant free base access or override bans/conflicts/required coverage.
- General integer surrogate u_i>=installed_i-selectedPreset_i-owned_i, u_i>=0, with proved finite domains and legal costs; authoritative d_i=max(0,...) is decoded, not the surplus u_i. Exact base-plus-deficit wallet/objective, no fake penalties.

The unreduced Stage 3 baseline keeps the general legal surrogate for tracked quantities. Presence substitution and fully-owned bookkeeping elimination are **optional Stage 4** reductions, requiring exact presence/occurrence linking, physical capacity and preset/owned guards. Do not silently adopt them while building the baseline.

Delete FiR/free-unbuyable logic, arbitrary 100,000,000 preset-only heuristics, objective-price stand-ins, presence-only availability rows and obsolete buy aliases. Keep supply caps even for zero-cost bookkeeping; stored zero is not an offer. Deterministic instance allocation is preset first, owned second, paid remainder in code-unit instanceId order, carrying the actual offer/barter source.

### B. Pinned native build, full precision and parser verification

Stage 2 includes a reproducible scripted WASM **and generated glue** build with pinned HiGHS/highs-js/toolchain inputs, checksums and runtime ABI validation. Identify actual deployed/package/vendor artifact provenance. Remove unqualified stock-package fallback; npm ci must not silently substitute a different proof ABI.

Export/marshal before native handle destruction: structured model status, primal objective/solution status, full-precision column values needed by decoding, native MIP dual bound/gap/node information and declared telemetry. Structured rows/model readback are supplied when their consumers or parser checks require them. Pretty solution text and diagnostic rounded logs remain diagnostics, not primal or proof sources. Preserve native lifecycle/error/corruption recovery and actual-search presolve telemetry provenance; unsupported fields remain null with reason rather than fabricated.

Verify emitted versus parsed model on the pinned build using suitable readback or a justified verified parser equivalence, including rows, bounds, objective, integrality and coefficients. Set/document small/large matrix filtering options explicitly. An option setting alone does not guarantee arbitrary coefficients survive: detect filtering; apply only proved legal rescaling with complete units/error evidence, or withhold proof. Stage 3 checks small coefficients, very wide price normalization, finite auxiliary domains and completed/limited native runs. Input round-trip text is insufficient without the native parser prerequisite.

### C. Full adopted numerical repair, by proof not only examples

Known defects are not “already correct” merely because fixtures miss a last digit. Repair current MOA_K=34.3 literals/constants/readers and locale/methodology descriptions; fixed Big-M; toFixed(6); 0.01% accuracy rounding; zero-intrinsic gating and dropped constant MOA rows; unshifted secants; nominal fixed dual margins/gaps; unsafe floor/display rounding and floor=0 fallbacks; dropped recoil caps with nonpositive denominators; and unproved free auxiliary ranges.

Use the complete #34 arithmetic DAG with upstream/cross uncertainty, finite domains and native row/parser/feasibility allowances. Preserve fractional mass (scaling is allowed with explicit conversion error; integer rounding is not), signed accuracy and barrel fallback. Correct clamp semantics on proved occurrence bounds inside Stage 2; optional regime specialization/second-clamp elimination wait for Stage 4. Remove artificially expanded rawHi and impossible weight-cap expansion. A nontrivial recoil cap with unsupported denominator must not disappear; handle its actual constant/linear condition or withhold proof under the adopted contract.

Native UB correction is valid only for a qualified native bound and proved objective/frame error. Secant uncertainty propagates through each weighted/Tchebycheff coefficient, not as an unscaled extra. Give every auxiliary with nonzero error a finite proved range. LB is a downward enclosure of the verified-incumbent score; the incumbent contribution to UB uses its upward enclosure, not that downward LB. UB includes live **and tolerance-fathomed** node bounds plus incumbent in the same frame. Unknown retained/frontier bounds stay unknown/infinite, transported as null; no finite sibling or time-limit primal hides them.

### D. Runtime, preparation and all operation consumers

One queue-inclusive request epoch deadline, default Optimize/Explore 60000 ms and floor 30000 ms; guards before every stage and after **explicit macrotask** yields. Out-of-band cancel bypasses dispatchChain. Yield between endpoint, spatial, Pareto and floor sub-solves; a microtask await alone does not dispatch worker cancel. Native allowance is positive and at least .001 s only while time remains. Hard termination rejects active/queued promises exactly once with CancellationError, retains published snapshots and starts a fresh worker. Native failure uses typed SolverError envelope, not a normal feasible result.

Validate owned_items (including sparse holes) and snapshot its full <=10000 nonempty-string multiset before hashing/cache/model work. Omitted/[] mean zero stock; do not deduplicate. Forward it and the full acquisition/feasibility domain to direct solve, Explore, floor queries and actual Gunsmith optimize. Floor queries share the floor-resolved Precise domain and price preference; only their MOA cap changes. Each cap trial is its own prepared domain. Missing justified lo **starts discovery**, never immediate witnessed-only return: qualified Precise infeasibility at a probe establishes lo, then bisect. Unresolved/unqualified trials halt with the last upper-bound witness; discovery plus bisection has <=14 trials. Section6 controls; no invented lo=0.

Metadata operations getGunsmithTasks/getInfo/getWeaponMods/getStatus/loadData/clearCache do not require stash input. Reload/replacement/clearCache invalidates affected physical/endpoint state, even if language/game-mode names match. User changed acquisition domain is not a cache hit.

Implement preparePhysicalWeapon, prepareSubproblemDomain and specializeLP with immutable lookup/context/version provenance, stable masks, decode/column/proof metadata and no extra persistent tier. Direct bounds come from unpruned matched physical input; raw physical bounds and request/effective ranges stay separate. Three payoff vectors keep weights [100,0,0], [0,100,0], [0,0,100] and frames 10*fE,-100*fR,-0.1*fP. Derive six coordinates from those vectors, never six global extrema. Existing physical/preference-only endpoint reuse is preserved but Fast/provisional/limit endpoint caching is intentionally removed. Cache only qualified precise MOA-independent certified endpoints meeting current proof/tolerance/provenance; transient request IDs/absolute epoch deadlines are not endpoint-key fields, and current deadline/cancellation remain runtime guards. Retain canonical #38's resolved duration/node/numerical controls and conservative tolerance eligibility; unchanged topology does not authorize expanded control variance. No new solution or full-response tier.

### E. Complete source inventory, type checking and export

Migrate together:

- solver/dataService.ts, jsonApiAdapter.ts, compatibilityMap.ts, types.ts, lpBuilder.ts, structuralBounds.ts, solver.ts, solver.worker.ts, reuseKey.ts and paretoExplorer.ts;
- api/client.ts request/response/error/floor shapes and every direct-entry request generator;
- App.tsx (including handleGunsmithOptimize), OptimizePanel/OptimizeResult, ExplorePanel/ExploreResult, GunsmithPanel/GunsmithResult, WeightAdjuster, BuildManifest, StatsCards, UsingPresetCard, ItemRow, src/components/priceCell.tsx, MethodologyModal and all affected locale strings;
- **test_naked_base_availability**: remove fabricated free-base expectations; require a legal accessible base or qualified model impossibility, with owned mods never creating a free receiver.
- **test_json_api_adapter**: explicit multi-copy counts, repeated-entry accumulation and raw missing/null/malformed quantity rejection; do not repin the removed `?? 1` default as source truth.
- benchmark classifiers/report/exploreValidation/harness/loaders and report.test, test_benchmark_report, test_worker_deadline, test_incumbent_gate, test_true_ergo, test_prevent_overswing, test_spatial_candidates, test_candidate_prune, candidatePrune experiment, test_explore_validation, test_reuse_keys, test_structural_bounds_reuse and other readers found by references;
- test_multi_weapon_verification, compare_bound_strategies and experimentHelper native loaders: all formal proof/comparison uses the pinned qualified ABI, not stock fallback.

This list is a concrete minimum; actual caller/reference inventory completes the clean cutover. Tests and benchmarks outside tsconfig.app's src must be type checked through an appropriate checked configuration, not hidden by the app build. Delete incidental wording/source-wiring tests rather than repin them; keep deterministic consumer-visible regressions for quantities, boundaries, proof state, errors and precedence.

EFTForge v1 is the external {v:1,g,p:[slotId,itemId][]} format, **not** the internal occurrence manifest. Use a deliberate checked projection only for builds whose parent/slot identities and copies are unambiguously representable and verified against that format. Never pass new object slot_pairs blindly or flatten ambiguous repeated parents. Until faithful support is verified, disable ambiguous/unrepresentable instance or multi-copy exports with a localized explanation in both BuildManifest and ExploreResult. Do not invent v2 or silently drop copies. In-app manifest/copy/shopping list stays fully instance-aware even when external export is disabled.

## 5. Merged transport shapes

These are the normative changed fields; unchanged presentation fields remain on their existing ItemDetail/PresetDetail/FinalStats records. Implement one shared contract, no legacy alias. #41/#42 control conflicting older #35 shapes.

```ts
type PrecisionRequest = 'fast' | 'precise' | 'auto';
type PrecisionResolved = 'fast' | 'precise' | null;
type ModelQualification = 'exact' | 'approximate' | null;
type MoaQualification = 'provisional_model' | null;
type SolveStatus = 'optimal' | 'feasible' | 'incomplete' | 'infeasible' | 'error';
type PhysicalCertificate = 'certified_optimal' | 'approximate_optimal' |
  'feasible' | 'certified_infeasible' | 'none';
interface Placement {
  parentInstanceId: string;
  slotId: string;
  childInstanceId: string;
  itemId: string;
}
interface PresetComponent { itemId: string; count: number; }
interface OptimizationMetadata {
  lower_bound: number | null;
  upper_bound: number | null;
  absolute_gap: number | null;
  tolerance: number;
  nodes: number; // outer spatial calls, never fabricated native MIP nodes
  termination: 'optimal' | 'limit';
}
interface OptimizeResponse {
  status: SolveStatus;
  precision_request: PrecisionRequest;
  precision_resolved: PrecisionResolved;
  model_qualification: ModelQualification;
  moa_qualification: MoaQualification;
  physical_certificate: PhysicalCertificate;
  selected_items: ItemDetail[]; // each record has unique instanceId
  selected_item_ids: string[]; // installed multiset, duplicates retained
  selected_preset?: PresetDetail; // items use PresetComponent[]
  slot_pairs: Placement[];
  objective_value: number | null;
  optimization: OptimizationMetadata;
  final_stats?: FinalStats;
  reason?: string;
  solve_time_ms: number;
  ideal_point?: IdealPoint;
  endpoint_cache?: 'hit' | 'miss';
}
interface ExploreStepOutcome {
  target_index: number;
  outcome: 'V' | 'I' | 'U' | 'E';
  point_index: number | null;
  status: SolveStatus;
  physical_certificate: PhysicalCertificate;
  precision_resolved: PrecisionResolved;
  model_qualification: ModelQualification;
  moa_qualification: MoaQualification;
  optimization: OptimizationMetadata;
  reason?: string;
}
interface ExploreResponse {
  curve_status: 'complete' | 'partial' | 'infeasible' | 'invalid';
  points: ExplorePoint[]; // verified optimal/feasible witnesses only
  sweep_schedule: { target_index: number; target_value: number }[];
  step_outcomes: ExploreStepOutcome[]; // one per scheduled target, U if unlaunched
  total_solve_time_ms: number;
  precision_request: PrecisionRequest;
  precision_resolved: PrecisionResolved;
  model_qualification: ModelQualification;
  moa_qualification: MoaQualification;
  reason?: string;
}
interface MOAFloorResponse {
  status: 'model_proved' | 'model_witnessed' | 'unresolved' | 'model_infeasible';
  moa_qualification: 'provisional_model';
  floor: number | null; // achieved raw hi, not game-physical minimum
  display_floor: number | null;
  proved_lower_bound: number | null;
  witness?: WitnessBuild;
  solve_time_ms: number;
  reason?: string;
}
```

ItemDetail gains required instanceId and per-occurrence exact acquisition provenance; PresetDetail/physical PresetInfo carries count-bearing components. WitnessBuild carries achieved_moa, all occurrence records and placements, chosen base and the complete normalized acquisition/feasibility/inventory/model scope. ExplorePoint carries the same qualification/proof and witness fields as its generating valid Optimize result plus existing plotted coordinates; step outcomes refer to that point, not a second copied build. Explore aggregate precision/model are the uniform resolved request mode when known, otherwise null; per-target fields remain authoritative. Its aggregate MOA qualification is provisional_model when the sweep depends on that model, otherwise null.

The API floor request carries the normalized Optimize-domain fields except the MOA cap being searched, plus language/mode and time limit; direct/worker forms forward the same semantics. Defaults are resolved before identity and execution. Every response here has an explicit nullable bound transport; null is unknown/unbounded, never zero by coercion. UI guards nullable values before toPrecision/toFixed. Invalid pre-model input has null resolved precision/model, none certificate, empty manifest, null objective/bounds/gap, nodes0 and termination limit. MOA-independent Optimize/Explore has moa_qualification **null**, never 'n/a'. A floor operation always has provisional_model, including its invalid-input envelope.

## 6. Operation/status/reason and coverage rules

### Optimize and Gunsmith optimization

| Outcome | Public status/certificate | Qualification and termination |
| :--- | :--- | :--- |
| Qualified precise MOA-independent optimum | optimal / certified_optimal | exact; moa null; optimal; verified witness and justified gap |
| Qualified Fast optimum | optimal / approximate_optimal | approximate; preserve moa provisional if dependent; optimal |
| Qualified precise MOA-dependent optimum | optimal / approximate_optimal | exact + provisional_model; optimal |
| Proved precise MOA-independent emptiness | infeasible / certified_infeasible | exact; moa null; optimal |
| Proved precise provisional-model emptiness | incomplete / none | exact + provisional_model; **optimal** internal proof retained |
| Fast MOA-independent model emptiness | incomplete / none | approximate; moa null; **optimal**, executed search completed |
| Fast provisional-model emptiness | incomplete / none | approximate + provisional_model; **optimal**, model search completed without physical authority |
| No qualified proof, verified prior/current witness | feasible / feasible | resolved qualifiers; termination optimal if executed search completed, otherwise limit; retained witness/LB/justified UB |
| No qualified proof or verified witness | incomplete / none | resolved qualifiers when known; termination by search completion; LB null; UB finite only if proved |
| Invalid owned_items before model work | incomplete / none | null unresolved model fields; limit; empty build and null proof values |

`optimization.termination` is search completion only: retain legacy-named `optimal` for completed executed-model search and `limit` for unfinished/unstarted search. No certificate follows from either value. A completed search followed by failed validation/proof qualification remains optimal; an unfinished spatial search is limit even if its last native sub-solve completed. The no-proof rows cover interruption, representation/parser/native proof withholding and rejected decoding independently of clock events. A rejected candidate never erases an earlier witness or completed proof. Full native errors use typed SolverError with completion metadata captured before failure, no fabricated normal result. Hard terminate uses CancellationError and retained snapshots. UI shows time/node/cancel retry advice only from the factual reason, not from limit alone.

Public reason strings: **Approximate model infeasible**, **Provisional MOA model infeasible**, **Fast provisional MOA model infeasible**, **Invalid owned_items format**, **Queue timeout before dispatch**, **Independent build validation failed**, **Required proof prerequisite unavailable**; pure interrupt diagnostics **Cancelled by user**, **Time limit reached**, **Node limit reached**. Locale mappings cover these strings rather than divergent aliases.

Precedence: already completed qualified proof wins and is not downgraded. Entry inventory failure is reported before hash/cache/model work. Otherwise an observed validation/proof-prerequisite failure outranks coincident interrupt flags, while retained witness/proof state still decides the status; pure simultaneous interrupt flags use cancel, deadline, node limit in that order. Queue expiry stops before preparation and uses its operation envelope. Typed native failure is not rewritten to an interrupt result. All diagnostics preserve the factual stop cause, not an invented infeasibility.

### MOA floor

Default time_limit_ms=30000. Resolve floor queries Precise (record requested/resolved mode), weighted price preference with ergo/recoil weights zero and price weight one; no Sweet Spot payoff solves. Price is a secondary witness preference within each cap's unchanged feasible set, not the MOA-floor objective. Accept any independently verified witness, including limited queries; do not wait for price optimality or add extra tie-breaking solves. Equal-price/free-extra witnesses may still vary, and no minimum-part-count guarantee is made. Preserve all caller hard/acquisition constraints except the searched MOA cap. Seed supplies achievable hi only, never a minimum. No witness gives unresolved, or model_infeasible after qualified Precise seed emptiness. Invalid stock/queue expiry has null bounds/display and no witness.

**Discover before bisecting.** An independently proved analytic lo may be used but is not required or promised. With no lo, set d=max(1 MOA,abs(hi)/2), probe t=hi-d, and double d after each verified feasible discovery probe. Update hi only to the smaller independently enclosed achieved MOA, never to an unsupported trial number. Qualified Precise provisional-model infeasibility at t establishes lo=t and switches to bisection t=lo+(hi-lo)/2. This explicitly supersedes #41's immediate no-lo return and makes model_proved reachable without an analytic formula.

**Internal cap contract.** Zero and negative finite thresholds must emit real cap rows; use absence/null checks, not truthiness, positivity guards or UI clamps. The signed provisional model is not assumed globally nonnegative. All native/parser/domain and outward arithmetic gates still apply. Probes use the complete same acquisition/physical request domain, except cap and floor-operation objective/resolved precision.

At most **14 total threshold trials** across discovery and bisection; the seed shares the request's time budget but is not a trial. Only qualified infeasibility raises lo and only independently validated achieved upper enclosures lower hi. Nonfinite/nondecreasing/stalled thresholds, overflow, unqualified/U/E/Fast emptiness, unavailable prerequisite, deadline or cancel stops and retains the best witness/actually proved lo. No initial lo alone is not a stop condition. model_proved requires a full witness and outward-proved finite bracket hi-lo<=.02. Otherwise a retained witness is model_witnessed, explicitly “best witnessed MOA — minimum not proved”; absent witness is unresolved. Completed bracket proof survives late cancellation. These are provisional-model results, not game-physical minimums. Display and actual offset-grid submission must be finite/valid and >=achieved hi, or withheld without discarding the raw witness.

### Explore: total classification and precedence

Require a nonempty valid schedule N>=1. Reject an empty/invalid schedule as invalid/[] before any solve, with a reason; do not vacuously call it complete or infeasible. Invalid stock is invalid/[] with Invalid owned_items format. Queue expiry is invalid/[] with Queue timeout before dispatch. These entry failures do not produce invented per-target proof records.

For an accepted schedule record each target exactly once. V is an independently valid optimal **or feasible** witness. I is **status infeasible + certified_infeasible**, precise/MOA-independent and domain proof-qualified. Fast or provisional-MOA internal model infeasibility is U, not I. Runtime errors are E; steps never launched due to deadline/cancel are U with reason. Rejected decoded builds are not points. Duplicate/dominated displayed builds do not erase coverage records.

1. V=N -> complete.
2. V>=1, I>=1, V+I=N -> complete.
3. V>=1 with U/E -> partial.
4. I=N -> infeasible.
5. V=0 with U/E -> invalid.
6. Cancellation that stopped an unfinished schedule with V>=1 -> partial.
7. Cancellation that stopped an unfinished schedule with V=0 -> invalid.

**Completed-schedule precedence:** a late cancel after all targets have qualified V/I outcomes does not downgrade complete/infeasible. Cancel rows apply only if a target remained unfinished; unlaunched targets are U. Complete is discrete schedule coverage, never continuous Pareto optimality. A feasible valid point is V, not a certified endpoint-cache entry. No cross-point solution or certificate reuse.

## 7. Stage 3 proofs and Stage 4 comparative adoption

### Correctness proof before any baseline adoption

The independent oracle gives complete truth only for each enumerated finite fixture. Precise per-fixture gates:

- A: equality of chosen-base/installed-multiset feasible projections; legal lifts in both directions, not a bijection of tree IDs.
- B: equal exact maximum and every maximizing projected tie. Enumerate model optimum projections with suitable exact exclusion/no-good constraints or a complete equivalent method; one winning native solution is insufficient.
- C: both feasible sets empty together.

Stage 3 additionally supplies the mathematical domain-wide lifting/projection proof for repaired precise placement/acquisition and conservative bounds, including all conflict/required/rootedness/quantity assumptions. Large real-weapon validation and small examples do not replace it. Every optional Stage 4 reduction supplies its own applicable full proof against the already correct baseline and the known counterexamples.

Fast does not get exact Gate A/B/C or physical infeasibility by declaration. Require every **published accepted Fast witness** to validate in the adopted physical domain and every model certificate/failed reconstruction to follow its truthful qualification. No new universal theorem that all raw Fast points project physically is imposed. Precise status uses the qualified native/parser proof and independent reconstruction, not Optimal text alone.

Stage 3 evidence includes full ledger/reference-versus-production validator agreement; parser/readback and structured-primal precision; finite auxiliary and bound-error proof; completed and limit native cases; deadline/cancel/queue/withheld/invalid/validation transitions; full floor/Explore cases; expanded TypeScript checking; deterministic behavioral regressions; and actual browser Optimize, Explore, Gunsmith, manifest/export, nullable status and floor smoke. Docs/changelog for future implementation are updated after that smoke. These proofs are obligations, not already executed by planning.

Stage3 must measure the actual Precise floor workflow at the default 30-second budget and <=14 threshold solves on predeclared real-weapon cases, including large platforms whose ordinary Auto optimization resolves Fast, plus smaller controls. Freeze weapon/request/snapshot/toolchain/cache identities. Report planned denominators, seed time, each discovery/bisection native call, trial count, end-to-end latency, status rates (model_proved/model_witnessed/unresolved/model_infeasible), achieved hi and justified bracket gaps, stop causes and validation. Do not assume 14 MIPs fit or interpret witnessed-only as completed minimum. These measurements characterize usability and inform a separate evidence-backed policy decision; they do not silently extend the budget, switch floor proofs to Fast, relax gaps or require a manufactured speedup for correctness adoption. None has been measured during planning.

### Primary comparative contract and nonempty relevance

The full #37 protocol remains, with canonical semantic identities and actual baseline/candidate source/bundle/wrapper/WASM digests, clean formal artifacts, separate workers and matched cache replay, >=5 predeclared alternating paired attempts, no optional stopping, planned denominators including failures, signed trace spans, 10000 paired BCa resamples/Mulberry32 seed42/jackknife/Type7 and honest degeneracy.

Require **at least one predeclared candidate-relevant physically certified precise primary case**. Fast/Auto->Fast, provisional-MOA and floor cases cannot be primary. No primary set, no evaluable matched primary evidence, or unrelated primaries -> INCONCLUSIVE/non-adoption, not a vacuous PASS.

For physical primary cases: Gate1 validation/oracle/domain FAIL first; Gate2 rate drop, P95>1.05 or valid BCa lower>1 FAIL; Gate3 requires N_both>=5, valid nondegenerate CI upper<.95 and all non-regression checks; otherwise Gate4 INCONCLUSIVE. Upper exactly .95 is not PASS; [1.01,1.03] is FAIL; constant/undefined intervals are not point proof. Infeasible and discrete Explore primary goals remain their case-specific qualified goals from #37, not certified_optimal-only classification. Both arms' failures stay in the planned denominator.

P95 is **Hyndman-Fan Type 7** over all planned attempt latencies. Existing deadline+5000 ms imputation for failed/late unqualified attempts remains for each declared success goal. Latency ratios use only on-time both-success pairs for that same goal; no changing the goal after results.

### User-selected qualified secondary non-regression extension

Declare goals and qualifications before running:

- Fast or precise provisional-MOA optimum goal: validated approximate_optimal, correct precision/model/MOA fields, trusted applicable native/global gap in the declared model/frame and on-time result. Do not count a bare native Optimal, a failed decode or feasible incumbent as that goal.
- Floor **minimum-quality goal**: on-time validated model_proved, full scoped witness, truthful provisional qualification, outward/withheld display and justified model bracket<=.02. lo may be discovered; no analytic bound is required. Every candidate affecting floor search must include a predeclared such case. The bracket controls distance to the same minimum independently of seed/cheap-tie ordering.
- Separate floor **interruption/availability goal**: on-time validated model_witnessed or model_proved with full scope and safe display. This protects retained witnesses, not minimum quality, and cannot substitute for the minimum-quality goal. Label witnessed-upper-bound rate/latency separately from model_proof_rate. Remove candidate-versus-baseline seed-witness .02 deltas; any optional witness-quality target must be independently fixed and justified before runs, never defined by an arbitrary cheap tie.

Secondary cases cannot justify primary speedup. Require zero secondary on-time goal-rate drop, Type7 P95<=1.05, complete validation/authority and applicable output-quality non-regression; a valid significant-slowdown lower CI>1 fails. Use the same paired provenance/BCa procedure and require at least five both-success pairs and a valid nondegenerate interval. No >=5% secondary speedup requirement; with sufficient valid evidence these report PASS_NONREGRESSION even if their CI spans1. Insufficient matched evidence or invalid/degenerate needed CI -> INCONCLUSIVE, not a zero-rate fake pass. No evaluated successes in both arms does not prove protection.

Cross-case adoption requires primary Gate1/2 and secondary non-regression on every declared case, primary Gate3 on **all** declared relevant primaries and no secondary FAIL/INCONCLUSIVE. Add relevant secondary cases for each mode/workflow a candidate affects; exclusions must be explicit and narrow the claim, not silent absent protection. Freeze classifications and percentile conventions in the experiment manifest. An optional failed/inconclusive candidate leaves the validated baseline and accepted ownership/reuse intact.

## 8. Records, verification and authority to proceed

Persist ADR0001–0013 and GLOSSARY on the clean docs-only planning branch from pre-fixture commit0e77213. Keep the ignored fixture outside its Git history, in a separate pinned compressed artifact. Archive the clean branch and baseline without the fixture blob; preserve the previous fixture-bearing history only in the nonmergeable archival bundle. The receipt records source/tip/blob IDs, no-fixture reachability proof, archive/fixture digests and a successful offline restore using both artifacts. Independent-disk E: copies protect against loss of D:'s disk, not site-wide disaster. No deploy/merge/push is implied.

The prior **unlinked 51/51 tally is withdrawn**, not implementation proof or reproducible evidence. No failing snapshot/native/source checks reported by the owner are rerun. Section 9 and the canonical amendment attach the complete current planning-only checker and observed results; it remains finite-domain protocol evidence, not shipped solver/native or outward-error proof. No solver-source/permanent-test/native build or measured performance result is claimed.

After parent verification of these contracts, meaningful floor simulation, clean docs-only commit, independent-disk bundle/fixture artifacts and actual offline reconstruction, accept/index the saved amendment. Source/native/error-bound, termination/count integration regressions and real-weapon floor completion measurements remain Stage3 obligations. No push, remote publication, implementation or release follows; other child decisions and deferred scope remain.

## 9. Reproducible planning-only check

Save the following block as floor-planning-check.mjs and run node floor-planning-check.mjs. This is only a finite-domain **floor-search simulation**, covering discovery/bisection, price-preferred witnesses/equal-price order permutations, zero/negative caps, scope and interruption/budget retention. It is not production solver/native/numerical/game/performance evidence. Self-defined termination/count assertions are removed: those contracts need future integration regressions at the real seams. Complete code is retained for offline reproduction.

```js
// Planning-only finite-domain checker; NOT the production solver or numerical/native proof.
// Save as floor-planning-check.mjs and run: node floor-planning-check.mjs
import assert from 'node:assert/strict';
const TOL = 0.02;
function floor(points, { maxTrials = 14, interruptAt = null, unresolvedAt = null } = {}) {
  const domain = points.filter(p => p.allowed !== false);
  const preferPrice = candidates => candidates.reduce((best, p) => !best || (p.price ?? 0) < (best.price ?? 0) ? p : best, null);
  const seed = preferPrice(domain);
  if (!seed) return { status: 'model_infeasible', hi: null, lo: null, trials: 0, trace: [] };
  let hi = seed.moa, lo = null, d = Math.max(1, Math.abs(hi) / 2), trials = 0;
  const trace = [];
  while (trials < maxTrials && (lo === null || hi - lo > TOL)) {
    if (interruptAt === trials) break;
    const cap = lo === null ? hi - d : lo + (hi - lo) / 2;
    if (!Number.isFinite(cap) || cap >= hi || (lo !== null && cap <= lo)) break;
    trials++;
    if (unresolvedAt === trials) { trace.push({ cap, outcome: 'U' }); break; }
    // Exact finite cap-feasible set; prefer price within it, deliberately retain equal-price order.
    const witness = preferPrice(domain.filter(p => p.moa <= cap));
    trace.push({ cap, outcome: witness ? 'V' : 'I', witness: witness?.id ?? null });
    if (witness) {
      if (!(witness.moa < hi)) break;
      hi = witness.moa;
      if (lo === null) d *= 2;
    } else lo = cap;
  }
  return { status: lo !== null && hi - lo <= TOL ? 'model_proved' : 'model_witnessed', hi, lo, trials, trace };
}
function assertBracket(result, domain) {
  const minimum = Math.min(...domain.filter(p => p.allowed !== false).map(p => p.moa));
  assert.equal(result.status, 'model_proved');
  assert.ok(result.lo <= minimum && minimum <= result.hi);
  assert.ok(result.hi - result.lo <= TOL);
  assert.ok(result.trials > 0 && result.trials <= 14);
}
const points = [
  { id: 'cheap-wide', price: 1, moa: 9 },
  { id: 'cheap-tight', price: 1, moa: 3 },
  { id: 'accurate', price: 8, moa: 1.25 },
];
const a = floor(points), b = floor([points[1], points[0], points[2]]);
assertBracket(a, points); assertBracket(b, points);
assert.equal(a.hi, 1.25); assert.equal(b.hi, 1.25);
assert.ok(a.trace.some(t => t.outcome === 'I'));
const zeroDomain = [{ id: 'wide', moa: 1 }, { id: 'zero', moa: 0 }];
const zero = floor(zeroDomain); assertBracket(zero, zeroDomain);
assert.ok(zero.trace.some(t => t.cap === 0));
assert.ok(zero.trace.some(t => t.cap < 0));
const negativeDomain = [{ id: 'wide', moa: 5 }, { id: 'signed', moa: -1.5 }];
const negative = floor(negativeDomain); assertBracket(negative, negativeDomain);
assert.equal(negative.hi, -1.5);
const scopedDomain = [{ id: 'excluded', moa: 0.125, allowed: false }, { id: 'legal', moa: 3 }, { id: 'accurate', moa: 1.5 }];
const scoped = floor(scopedDomain); assertBracket(scoped, scopedDomain);
assert.equal(scoped.hi, 1.5);
const interrupted = floor(points, { interruptAt: 0 });
assert.equal(interrupted.status, 'model_witnessed'); assert.equal(interrupted.hi, 9); assert.equal(interrupted.lo, null);
const unresolved = floor(points, { unresolvedAt: 2 });
assert.equal(unresolved.status, 'model_witnessed'); assert.equal(unresolved.hi, 3); assert.equal(unresolved.lo, null);
const limited = floor(points, { maxTrials: 1 });
assert.equal(limited.status, 'model_witnessed'); assert.equal(limited.trials, 1); assert.equal(limited.lo, null);
assert.equal(floor([]).status, 'model_infeasible');
const summarize = ({ status, hi, lo, trials }) => ({ status, hi, lo, trials });
console.log(JSON.stringify({ scope: 'planning-only finite-domain checker', tieOrderA: summarize(a), tieOrderB: summarize(b), zero: summarize(zero), negative: summarize(negative), scoped: summarize(scoped), interrupted: summarize(interrupted), unresolved: summarize(unresolved), limited: summarize(limited), checks: 'all assertions passed; no production/native/performance proof' }, null, 2));
```

Observed in a fresh Node process: both cheap-tie orders reached `hi=1.25` in 10 trials with qualified finite fixture brackets (`lo=1.234375` and `1.23828125`); zero reached `[−0.015625,0]` in 9 trials; the signed case reached `[−1.51953125,−1.5]` in 10; the excluded-source case retained the legal minimum `1.5`; interruption, unresolved trial and a one-trial budget returned witnessed upper bounds with null lo, not proved minima. All checker assertions passed. The script's finite oracle supplies its own model-feasibility truth; no shipped solver/native or outward-arithmetic gate is thereby established.
