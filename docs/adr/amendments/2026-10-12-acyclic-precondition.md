# Amendment note (DRAFT): acyclic part graphs are a checked precondition

Status: **draft for the owner** (Refs #40). Drafted with Phase 2.10 milestone 2 from owner decision 2d as amended on 2026-10-12
(`docs/stage2-plan.md`). Not posted anywhere; posting it to #40 needs the owner's approval. It amends ADR 0003 and ADR 0013 section 3,
items 3 and 10, and leaves every other decision of those ADRs as it is.

## Decision being recorded

The owner's words: "we will not have cyclic guns". Acyclicity of the part graph is no longer an assumption that the occurrence model makes safe;
it is a property of a gun's data that production checks, and a gun that fails it is unsupported.

- **The check.** The part graph reachable from the receiver has no cycle. The blueprint's unrolling never repeats a template on one root path and
  cuts an allowlist entry exactly when that entry names a template already on the path, so the graph has a cycle iff the blueprint cut an edge
  (`blueprint.stats.prunedAncestorEdges > 0`, `partGraphIsAcyclic`). It is request independent and computed once per gun (memoized blueprint).
  A loop among parts the receiver cannot reach does not count. The no-ancestor-repetition rule stays only as this detector.
- **The refusal.** Every operation refuses such a gun before any solve: Optimize and Gunsmith in every mode (Fast, Precise, Auto, payoff
  endpoints included), Explore and the MOA floor. The public reason is `Unsupported data: cyclic part graph`, a new member of the closed set,
  with the pre-model envelope of each operation (Optimize: `incomplete` / `none`, nothing resolved, termination `limit`; Explore: `invalid`, no
  points; floor: `unresolved`, no witness, `provisional_model`). It is never an infeasibility. The plain sentence a player sees is "This weapon's
  part data isn't supported, so no build can be made for it" (16 locales).
- **Precise runs only on the count model.** On an acyclic part graph the template count model is an exact reformulation of the physical domain
  (docs/research/acyclic-fast-exactness.md, sections 3 to 5), and Precise builds it through the proof layer (decision 2e). The occurrence-level
  model leaves production and stays in the tests as the independent cross-check. Lemma 1 (the active candidates of a slot do not depend on the
  path) is verified on every prepared domain as an internal assertion; a failure is a solver error, never a fallback.
- **Removed from production:** Fast's connectivity flow for cyclic graphs, the cyclic decode search, the occurrence-model fallback, the cyclic
  branches of eligibility and telemetry. A cyclic active graph inside a model builder is an internal fault (`CYCLIC_PART_GRAPH`).

## Amendment to ADR 0003 (Precise occupancy and rootedness invariants)

- Context item 1 ("Cycle hazards and finite bounding") and Decision principle 2 ("Finite instance universe and branch acyclicity") remain true of the
  domain definition and of the Stage 1 oracle: the oracle enumerates the finite rooted occurrence domain under the no-ancestor-template-repetition
  rule. For production, the rule is superseded as a modelling device: a gun whose rule would cut anything is refused as unsupported data, so on every
  supported gun the rule is vacuous (no template can be its own descendant) and the instance universe is finite without it.
- Principles 1, 3, 4 and 5 (occurrence-specific identity, activation and required occupancy, template/self/slot conflicts and locks, statistics and
  the instance-bound result contract) are unchanged as the definition of the physical domain and of the result. Production states them per template on
  the count model (slot capacity and required occupancy as counts per owner copy, presence-linked template conflicts, slot conflicts by raw slot id),
  which the research report proves equivalent on an acyclic graph; every published build is still a rooted occurrence tree with unique `instanceId`s,
  validated by the independent validator.
- "Physical infeasibility certification requires the exact-domain and native/numerical gates" now also requires the second opinion of decision 5a.

## Amendment to ADR 0013, section 3

- **Item 3 (rooted graph: descendant/fixed-point removal, alternative parents, self/ancestor loops, indexed-orphan removal, memoization context).**
  The subcases stay in the ledger and the oracle keeps solving them. Production's expected outcome for the subcases whose part graph has a cycle
  (`F03-self-loop`, `F03-ancestor-loop-with-sibling-repetition`, `F03-memoization-context-ancestor`, `F03-memoization-context-required-slot`) is the
  refusal above, recorded as owner-approved scope in the harness (`reference/harness/README.md`, `OWNER_APPROVED_REFUSALS`), never by editing a
  ledger expectation. Descendant/fixed-point removal, alternative parents and indexed-orphan removal on acyclic graphs are unchanged.
- **Item 10 (disconnected/cyclic: no disconnected selected assembly, conditional owner deactivation, retained alternate rooted path).** "No
  disconnected selected assembly" and the retained alternate rooted path are unchanged; `F10-no-disconnected-assembly`, whose loop the receiver cannot
  reach, keeps its certified optimum. A cycle behind a deactivated owner (`F10-cycle-behind-deactivated-owner`) is still a cycle of the gun's part
  graph and is refused like the item 3 cases: the check is a property of the data, not of one request.
- Stage 3's Gate A/B/C and the domain-wide lifting/projection proof are stated for supported (acyclic) guns; the refusal of cyclic guns is itself a
  checked behavior (unit and harness tests), not a proof obligation of the count model.

## Evidence at the time of drafting

- All 172 guns of the pinned snapshot have an acyclic part graph (no ancestor edge cut); the refusal changes no real request.
- Ledger: exactly the five cases above trip the check; no other case is refused.
- The research report's cyclic campaign (section 8: 18 of 43 cyclic worlds where Fast differed from the oracle) stays as history; those worlds are now
  refusal tests.
