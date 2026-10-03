# Certification performance benchmark contract

Decision source: https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/20

## Goal and scope

Primary goal: reduce time to certified optimum without weakening accuracy or changing the feasible-build set. First validated build latency is secondary. This contract specifies future measurements; it does not claim measured improvements or implement a runner.

Cover Fast, Precise, Auto, TrueErgo, Prevent Overswing, augmented Tchebycheff, Explore and Gunsmith. Fast certificates describe its restricted model, not exact placement. Compare like models and objectives; a restricted-model result cannot upper-bound the exact optimum.

## Agreed measurement seams

Measure complete requests through the browser Web Worker, including ideal-point endpoint solves. Separate data loading, model construction and solver time wherever instrumentation permits; explicitly report unavailable breakdowns rather than infer them. Use direct solve() calls for exhaustive small-graph correctness checks, not as browser performance substitutes.

## Reproducible procedure

- Freeze one game-data snapshot and record its checksum. Baseline and candidate consume identical bytes, without live price refresh during runs.
- Record source revisions, browser version, OS/hardware, WASM binary checksum, request settings, numerical tolerances and deadlines. Hold them constant except for the intended code change.
- Run baseline and candidate serially on the same machine. After one warm-up for each, run five alternating baseline/candidate pairs per case. Preserve individual samples and execution order.
- Separate cold initialization/data loading from warmed request measurements. Do not run concurrent solves that compete for resources.
- Include dense and sparse weapons, unrestricted and restricted trader/flea access, preset purchases, locked/excluded parts, and tight budget/weight limits. Exercise combinations of nonlinear modes and Sweet Spot, not only isolated toggles.
- Freeze exact case payloads before candidate comparisons. Select valid weapon/item/task IDs from the snapshot, not stale hand-written IDs.

## Measurements

Report per case and mode: time to certified optimum, completion rate, solver status, objective, certificate model, tolerance, remaining valid bound/gap at the deadline, and memory where measurable. Record first validated build latency when observable. Mark unavailable metrics explicitly.

Retain timeouts and incomplete runs in the denominator. A timeout is a censored observation, not a completed solve at the deadline. Summarize timings of completed paired cases separately from completion rates and deadline gaps. Do not hide mode-specific regressions in an aggregate average. For Explore, report complete-curve latency and per-point certification; a partial curve is not a completed request.

## Correctness gates

- Independently validate complete slot placement, required slots, parent connectivity, conflicts, explicit locks/bans, access/purchase accounting, hard numerical limits and exact TED.
- Compare small graphs against exhaustive feasible selections and optima. Include two interchangeable slots accepting A and B, required slots, alternative parents, conflicts, retained preset parts, clamped ergonomics and the 3 kg TED boundary.
- Never accept false infeasibility, an invalid build, or optimality unsupported by valid bounds at the unchanged tolerance.
- Equal printed objectives do not prove equal selections or validity. Different tied optima are acceptable if independently valid and equivalent under the specified objective.

## Acceptance and handoff

Correctness gates are mandatory. Require repeatable certification-time improvement and report regressions separately for every mode. Numerical speedup and allowed-regression thresholds remain pending baseline measurements; they must be agreed before judging a candidate, not fitted afterward. Five pairs provide local evidence, not a universal latency guarantee.

The baseline measurement work must produce the snapshot manifest, exact case matrix, environment record and raw samples. Those artifacts support a subsequent decision on numerical targets. Neither this contract nor its approval authorizes solver changes, deployment or pushing commits.
