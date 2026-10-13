# Amendment: cyclic part data is unsupported

Status: **accepted (owner, 2026-10-12), posted to #40 with the Stage 3 verdict.** Refs #40. Records owner decision 2d as amended on
2026-10-12 (`docs/stage2-plan.md`). It amends ADR 0003 and ADR 0013 section 3, items 3 and 10, and leaves every other decision of those ADRs as
it is.

## Decision being recorded

The owner's words: "we will not have cyclic guns", then "I said there is not cyclic gun" and "we don't need any code related to cyclic handling".
Acyclicity of the part graph is no longer an assumption that the occurrence model makes safe, and it is not a checked, refused case either: cyclic
part data is **unsupported**, and production carries no code for it beyond one internal guard.

- **No refusal.** There is no per-gun check, no public reason, no locale text and no operation-level handling. The closed set of public reasons is
  unchanged by this decision.
- **The internal guard.** The blueprint builder (`preparePhysicalWeapon`) unrolls a gun into its occurrence tree, which only terminates because a
  template never recurs on its own root path. It throws the internal `PhysicalModelError('CYCLIC_PART_GRAPH')` the moment it meets a cycle reachable
  from the receiver, so bad data fails with the generic error of the operation instead of hanging. A loop among parts the receiver cannot reach is
  never expanded and is not an error.
- **Precise runs only on the count model.** On an acyclic part graph the template count model is an exact reformulation of the physical domain
  (docs/research/acyclic-fast-exactness.md, sections 3 to 5), and Precise builds it through the proof layer (decision 2e). The occurrence-level
  model leaves production and stays in the tests as the independent cross-check. Lemma 1 (the active candidates of a slot do not depend on the
  path) is verified on every prepared domain as an internal assertion; a failure is a solver error, never a fallback.
- **Removed from production:** Fast's connectivity flow for cyclic graphs, the cyclic decode search, the occurrence-model fallback, the cyclic
  branches of eligibility and telemetry, and the cycle checks of the model builders.

## Amendment to ADR 0003 (Precise occupancy and rootedness invariants)

- Context item 1 ("Cycle hazards and finite bounding") and Decision principle 2 ("Finite instance universe and branch acyclicity") remain true of the
  domain definition and of the Stage 1 oracle: the oracle enumerates the finite rooted occurrence domain under the no-ancestor-template-repetition
  rule. For production, the rule is superseded as a modelling device: cyclic part data is unsupported (the blueprint throws an internal error on a
  cycle), so on every gun production accepts the rule is vacuous (no template can be its own descendant) and the instance universe is finite without it.
- Principles 1, 3, 4 and 5 (occurrence-specific identity, activation and required occupancy, template/self/slot conflicts and locks, statistics and
  the instance-bound result contract) are unchanged as the definition of the physical domain and of the result. Production states them per template on
  the count model (slot capacity and required occupancy as counts per owner copy, presence-linked template conflicts, slot conflicts by raw slot id),
  which the research report proves equivalent on an acyclic graph; every published build is still a rooted occurrence tree with unique `instanceId`s,
  validated by the independent validator.
- "Physical infeasibility certification requires the exact-domain and native/numerical gates" now also requires the second opinion of decision 5a.

## Amendment to ADR 0013, section 3

- **Item 3 (rooted graph: descendant/fixed-point removal, alternative parents, self/ancestor loops, indexed-orphan removal, memoization context).**
  The subcases stay in the ledger and the oracle keeps solving them. Production's expected outcome for the subcases whose part graph has a cycle
  (`F03-self-loop`, `F03-ancestor-loop-with-sibling-repetition`, `F03-memoization-context-ancestor`, `F03-memoization-context-required-slot`): out of
  scope. The harness does not run production on them (`reference/harness/README.md`, `OUT_OF_SCOPE_CASES`: every dimension `n/a`, feature
  `cyclic_part_graph`), never by editing a ledger expectation. Descendant/fixed-point removal, alternative parents and indexed-orphan removal on acyclic graphs are unchanged.
- **Item 10 (disconnected/cyclic: no disconnected selected assembly, conditional owner deactivation, retained alternate rooted path).** "No
  disconnected selected assembly" and the retained alternate rooted path are unchanged; `F10-no-disconnected-assembly`, whose loop the receiver cannot
  reach, keeps its certified optimum. A cycle behind a deactivated owner (`F10-cycle-behind-deactivated-owner`) is still a cycle of the gun's part
  graph and is out of scope like the item 3 cases: acyclicity is a property of the data, not of one request.
- Stage 3's Gate A/B/C and the domain-wide lifting/projection proof are stated for acyclic guns, the only ones production supports. The internal
  blueprint guard has one unit test; it is not a proof obligation of the count model.

## Evidence at the time of drafting

- All 172 guns of the pinned snapshot have an acyclic part graph (every blueprint prepares); the guard changes no real request.
- Ledger: exactly the five cases above have a cyclic part graph; every other case is in scope.
- The research report's cyclic campaign (section 8: 18 of 43 cyclic worlds where Fast differed from the oracle) stays as history; those worlds and
  generator modes are gone from the tests.
