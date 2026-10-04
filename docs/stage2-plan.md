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
| 2.7 Operations | §4D deadlines and macrotask yields, out-of-band cancel, `owned_items` validation and forwarding, floor discovery then bisection, Explore classification, metadata ops, cache invalidation, `preparePhysicalWeapon` / `prepareSubproblemDomain` / `specializeLP` | 2.6 |
| 2.8 Consumers | §4E client, App and UI components, locales, EFTForge v1 export (supported-only), MethodologyModal | 2.6–2.7 |
| 2.9 Tests and benchmarks | §4E migrate or delete every legacy test and benchmark reader, type-check them through a checked config, pinned native loader everywhere | all |

## Owner decisions carried into Stage 2

- Category filters match the whole category chain (INTERPRETATIONS 5).
- Loaded (camora) ammunition is outside the physical domain (15).
- Tchebycheff: the result reports the payoff table it used; comparisons are made under that table (9, 17).
- Single correctness cutover; floor discovery then bisection; termination means search completion; floor
  queries use a zero objective with `mip_max_improving_sols=1`; unsupported external export disabled.

## Known baseline failures (before Stage 2)

`test_gunsmith_all` (PKP preset purchase), `test_spatial_candidates` (TypeError), `test_worker_deadline`
(missing benchmark manifest). Phase 2.9 resolves or retires them.
