# Stage 2 plan: one private correctness cutover

Refs #40. Normative source: ADR 0013 §4–§6 (canonical comment 5982036627), ADR 0010, ADR 0012, and the owner
decisions in `frontend/reference/INTERPRETATIONS.md`. Branch `impl/stage2-correctness-cutover` (off the Stage 1
tip). **Private:** nothing merges to master or deploys while any contract is incomplete. Stage 3 proves the
result; Stage 4 reductions are out of scope here.

## Test seam

The Stage 1 reference is the truth. A differential harness (`frontend/reference/harness/`) maps every ledger
case into production inputs, runs production end to end and compares it with the oracle:

- the admitted public outcome (status, certificate, qualifications, reason);
- the returned build, accepted by the reference validator;
- the objective equal to the exact maximum within the case tolerance, with the projection among the maximizers;
- or emptiness where the ledger expects it.

A **ratchet** baseline records which cases pass. A case that passes must keep passing, and a newly passing case
updates the baseline in the same commit. Stage 2 is done when every ledger case passes and nothing in the
inventory below is left.

## Phases

Each phase is one or more Sonnet subagents with disjoint files, verified (typecheck, single tests, reference
suite, harness ratchet) and committed by the orchestrator.

| Phase | Scope (ADR 0013) | Depends on |
| :--- | :--- | :--- |
| 2.1 Harness | Ledger-to-production differential harness and ratchet baseline | Stage 1 |
| 2.2 Quantities | §4A count-bearing extraction: `extractAllPresets`, GraphQL `count`, adapter count rule (no `?? 1`), `{itemId,count}` presets through types, LP preset supply, reconstruction, structural weight, manifest and shopping list; flip the two Stage 1 todos | 2.1 |
| 2.3 Native surface | §4B pinned reproducible HiGHS WASM and glue build (emsdk in WSL), structured full-precision primals, dual bound, gap and nodes extracted before destroy, parser/readback verification, filtering detection, `mip_max_improving_sols`, no stock fallback | toolchain |
| 2.4 Physical model | §4A occurrence/path identity, template-slot collision assertion, immutable domain masks; emit rules (one accessible base or contradiction, required occupancy, template/self/slot conflicts, supply caps, integer deficit surrogate with decoded d_i); delete FiR, 100M, price stand-ins and buy aliases; chain category matching; camora ammo excluded | 2.2 |
| 2.5 Numerics | §4C: K = 100/2.9089, no Big-M literal, no `toFixed(6)`, signed accuracy, zero-intrinsic and constant MOA rows, outward secants, recoil caps with nonpositive denominators, finite auxiliary ranges, global UB including tolerance-fathomed bounds | 2.4, 2.3 |
| 2.6 Solve and status | §5/§6 transport shapes, statuses, certificates, reasons and precedence; decoder; production validator matching every reference accept/reject; payoff-table reporting | 2.3–2.5 |
| 2.6b Fast TED | Owner decision 2b: TrueErgo/Prevent Overswing on the Fast count model (weight search over its exact aggregate weight), approximate qualification, no silent Precise upgrade | 2.6 |
| 2.10 Certified count model | Decision 2e: Precise on the count model with the proof layer, MOA larger-COI rows, acyclicity guard with occurrence-model fallback, infeasibility second opinion; occurrence model kept as a test cross-check | 2.6b, before 2.9 |
| 2.7 Operations | §4D deadlines and macrotask yields, out-of-band cancel, `owned_items` validation and forwarding, floor discovery then bisection, Explore classification, metadata ops, cache invalidation, `preparePhysicalWeapon` / `prepareSubproblemDomain` / `specializeLP` | 2.6 |
| 2.8 Consumers | §4E client, App and UI components, locales, EFTForge v1 export (supported-only), MethodologyModal | 2.6–2.7 |
| 2.9 Tests and benchmarks | §4E migrate or delete every legacy test and benchmark reader, type-check them through a checked config, pinned native loader everywhere | all |

## Owner decisions carried into Stage 2

- Category filters match the whole category chain (INTERPRETATIONS 5).
- Loaded (camora) ammunition is outside the physical domain (15).
- Tchebycheff: the result reports the payoff table it used; comparisons are made under that table (9, 17).
- Single correctness cutover; floor discovery then bisection; termination means search completion; floor
  queries use a zero objective with `mip_max_improving_sols=1`; unsupported external export disabled.
- Native build host: `zpahai@10.147.20.119`, only `~/tarkov-highs-build`, no sudo; never the lab hosts.
- **Results are plain by default, details on demand (owner, 2026-10-05, Phase 2.8b).** A regular player sees the build and,
  only when something is off, one plain sentence; "best" only for a proved optimum. Authority wording, model tags,
  bounds, gap, tolerance, MOA-model caveats and Explore coverage live in a collapsed Details section.

### Performance policy (owner, 2026-10-04)

Measured on the pinned snapshot (60 s limit): the exact model with presolve off proves every gun up to 13,122
occurrences in at most about 14 s (as fast as the legacy model at the default settings up to about the 90th
percentile); the AK family and M4A1 do not finish. Fast (template model) solves every gun in about 1 s or less but
is approximate. Decisions:

1. **Auto chooses by size.** Precise up to `AUTO_PRECISE_MAX_OCCURRENCES` (15,000), Fast above, clearly
   qualified as approximate (implemented in 2.4b-3b).
2. **No progressive "Fast first, then exact" result.** Rejected by the owner: a Precise request returns only its
   own Precise result (optimal, feasible with honest bounds at the deadline, or incomplete). No early Fast witness
   is streamed or shown for it.
2a. **Auto stays size-based after the Fast rebuild (owner, 2026-10-05).** Even though the 2.4c Fast model matched
   the certified exact optimum on all 384 pinned-gun builds (median 30 ms), Fast remains `approximate` without a
   certificate. **First Stage 4 candidate:** prove that the Fast count/edge model is an exact reformulation on
   acyclic template graphs (all 172 pinned guns are acyclic) with a lifting/projection proof plus Gates A–C and
   the comparative gates; ADR 0011's cyclic counterexamples bound its scope. If adopted, acyclic weapons get
   certified answers at Fast speed. Research complete (2026-10-05, `docs/research/acyclic-fast-exactness.md`):
   conditionally exact on acyclic active graphs; the adoption steps are listed there.
2b. **Fast supports TrueErgo and Prevent Overswing (owner, 2026-10-05).** A Fast request (or Auto resolving to Fast)
   with TED runs the weight search on the Fast count model and returns a Fast, approximate answer; it is never silently
   upgraded to Precise (Phase 2.6b). Precise keeps its own certified TED search.
2c. **Fast uses one copy per part by default (owner, 2026-10-05).** A request option `allowRepeatedParts` (default false)
   lets Fast install several copies of one template; Precise always allows repeats. Measured on the pinned snapshot: no
   balanced-weight optimum uses a repeated part; 10% of pure-recoil and 5% of pure-ergo optima do. The ledger harness and
   the research gates run Fast with repeats allowed, so they keep measuring the full count model. The toggle lives in a
   new power-user ("Advanced") menu that will host such options (owner, 2026-10-05).
2d. **Part graphs are assumed acyclic (owner, 2026-10-06).** No pinned gun has a cycle (172 of 172: the no-ancestor-repetition
   rule prunes nothing, `blueprint.stats.prunedAncestorEdges === 0`), and the owner believes the game does not allow one. The
   cycle handling stays as is for now (Precise's ancestor rule keeps the occurrence tree finite; Fast adds its connectivity flow
   only on a cyclic graph; cyclic test worlds stay). In Stage 4, when certified Fast lands, acyclicity becomes a checked
   precondition: a cyclic gun is refused as unsupported data with a clear error, and the cycle code is removed with it.
2e. **Precise is rebuilt on the count model now, before 2.9 (owner, 2026-10-06; amends ADR 0013's order, Phase 2.10).**
   On an acyclic part graph (decision 2d) Precise drops its path-qualified occurrence variables: slot capacity, parent
   activation and the domain filters are stated per template exactly as in Fast (exact there: research report, sections 4
   and 5), and every row goes through the proof layer, so Precise keeps its certificates. Adds the MOA larger-COI rows,
   an acyclicity guard (a cyclic gun keeps the occurrence model) and a second opinion before any certified infeasibility.
   The occurrence model stays in the tests as an independent cross-check. Stage 3 proves the rebuilt Precise.
3. **Stage 4 candidate, not now:** use the validated Fast build as an initial solution for the exact MIP
   (requires exporting `Highs_setSolution` in a pinned rebuild; ADR 0001 lists hot start as deferred). Adopted
   only through the Stage 4 proof and comparative gates.
4. **Native arithmetic noise is a stated assumption (owner, 2026-10-05).** The pinned build exports no node
   duals, so HiGHS's own floating-point error cannot be bounded. Observed: on 7 ledger cases the qualified dual
   bound sat 1e-15 to 5e-12 below the exact score of a build verified in the same node. Stage 2 records this in
   `NATIVE_FRAME.assumptions`, measures it in `telemetry.boundShortfall`, and withholds any bound whose shortfall
   exceeds `max(tolerance, 1e-9·max(1,|bound|))`; no allowance is added, so cases certify at 1e-9. Stage 4
   revisits a proved allowance with a rebuild that exports the needed duals.
5. **No optimality or infeasibility claim from a presolved solve, on any model.** HiGHS 1.15.1 presolve produced
   both a false Infeasible (exact model) and a false Optimal (Fast model); fixtures in
   `tests/physical/solverDefects/`. Precise and Fast both solve with presolve off.
5a. **A second opinion on every certificate (owner, 2026-10-06).** HiGHS 1.15.1 with presolve off also returned a wrong
   Optimal with a wrong dual bound (about 1 in 10,000 solves, both models; fixture
   `tests/physical/solverDefects/count_presolve_off_wrong_optimal.lp`). Every solve that backs a certificate is repeated with
   another random seed: the upper bound is the larger of the two qualified bounds, the incumbent the best verified build,
   an infeasibility needs both verdicts. On a disagreement a third seed breaks the tie (owner): the bound is the largest
   qualified bound of all solves, a certificate needs two agreeing solves, and a timeout withholds the certificate.
5b. **Integrality tolerance 1e-7, primal and dual 1e-9 (owner, 2026-10-06).** On that fixture only the integrality
   tolerance matters (likely: HiGHS rounds a derived integer bound such as 1.9999999982 down under 1e-9 and cuts off the
   optimum). A looser integrality tolerance can only enlarge a bound and every candidate is validated exactly, so the
   certificates keep their footing; the dual tolerance that a bound depends on stays 1e-9. Always 1e-7, whatever the request
   tolerance (owner): it removed every wrong-optimum disagreement in the Phase 2.10 campaigns (19,000 worlds, both models),
   and a seed-only second opinion missed one case. Cost accepted by the owner: about 1% of solves report a bound up to 1e-7
   high, so a ledger case at the 1e-9 runtime tolerance can drop from certified to feasible; those cases are recorded in the
   baseline as owner-approved, never by editing a ledger expectation.
6. Precise solves use presolve off (`PRECISE_PRESOLVE`); template conflicts are the dominant structural cost and
   the first target for exact Stage 4 reformulations (a clique-cover strengthening was measured and did not help).

## Known baseline failures (before Stage 2)

`test_gunsmith_all` (PKP preset purchase), `test_spatial_candidates` (TypeError), `test_worker_deadline`
(missing benchmark manifest). Phase 2.9 resolves or retires them.
