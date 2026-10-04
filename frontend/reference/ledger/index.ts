// The 14-family behavioral ledger (ADR 0013 section 3, ADR 0010 section 4) and its coverage catalogue.

import { FAMILY_01 } from './family01_conflicts';
import { FAMILY_02 } from './family02_required_availability';
import { FAMILY_03 } from './family03_rooted_graph';
import { FAMILY_04 } from './family04_includes_caps';
import { FAMILY_05 } from './family05_bases';
import { FAMILY_06 } from './family06_preset_quantities';
import { FAMILY_07, MONOTONICITY_F07 } from './family07_owned_monotonicity';
import { FAMILY_08 } from './family08_moa';
import { FAMILY_09 } from './family09_supply_multiplicity';
import { FAMILY_10 } from './family10_disconnected_cyclic';
import { FAMILY_11 } from './family11_objectives_clamps';
import { FAMILY_12 } from './family12_ted_numerics';
import { FAMILY_13 } from './family13_epigraph_ties';
import { FAMILY_14 } from './family14_instances';
import type { Family, LedgerCase, MonotonicityRelation } from './types';

export type { Family, LedgerCase, MonotonicityRelation } from './types';

/**
 * Required subcase tags per family: the subcases ADR 0013 section 3 and ADR 0010 section 4 name,
 * refined where one named subcase splits into separately testable behaviors. The coverage tests
 * in ledger.test.ts fail when a family or a tag has no case, and when a case uses a tag outside this
 * catalogue. This catalogue is authored next to the cases, so it cannot vouch for itself: the
 * ADR-wording catalogue (ADR_0013_SECTION_3_SUBCASES) below restates what ADR 0013 section 3 names, checked
 * verbatim against the ADR text, and maps every named subcase to tags here or to an explicit deferral.
 */
export const REQUIRED_SUBCASES: Readonly<Record<Family, readonly string[]>> = {
  1: ['template_pair_exclusion', 'copies_without_partner', 'self_copy_cap', 'physical_slot_conflict', 'legal_alternative_placement'],
  2: ['empty_root_required_slot', 'empty_conditional_slot_owner_off', 'unavailable_candidates', 'conditional_slot_surviving_candidate', 'independent_required_checks', 'market_gating', 'barter_gating'],
  3: ['descendant_removal', 'fixed_point_removal', 'alternative_parents', 'self_loop', 'ancestor_loop', 'indexed_orphan_removal', 'memoization_context'],
  4: ['include_item', 'include_category', 'category_group_structure', 'exclude_item', 'exclude_category', 'impossible_include', 'include_exceeds_capacity', 'magazine_boundary', 'sighting_boundary', 'recoil_final_cap_conversion', 'recoil_cap_nonpositive_denominator', 'other_hard_caps'],
  5: ['inaccessible_naked_accessible_preset', 'no_legal_base', 'no_invented_zero_receiver', 'expensive_legal_offer', 'cheapest_legal_offer', 'preset_only_item_real_spend'],
  6: ['preset_count_gt_one', 'multiple_copies', 'stripping', 'retention', 'base_cost_once', 'no_preset_monopoly'],
  7: ['monotonicity_baseline', 'spend_nonincrease', 'feasible_set_expansion', 'max_score_nondecrease', 'optimum_spend_may_rise'],
  8: ['positive_replacement_barrel', 'optional_fallback', 'required_fallback', 'missing_coi', 'nonpositive_coi', 'zero_intrinsic_coi', 'signed_accuracy', 'negative_suppressor', 'constant_moa_exceeds_cap', 'high_divergence'],
  9: ['one_item_two_required_slots', 'required_copies_insufficient_stock', 'required_copies_sufficient_stock', 'mixed_supply', 'standalone_inaccessible_cap', 'zero_stored_price_not_an_offer', 'zero_cost_legal_offer', 'allocation_order', 'barter_valuation', 'fractional_barter_count', 'barter_lot_granularity'],
  10: ['no_disconnected_assembly', 'conditional_owner_deactivation', 'retained_alternate_path'],
  11: ['clamp_raw_above_100', 'clamp_raw_below_zero', 'clamp_exact_bounds', 'effective_clamp', 'identity_gear', 'gear_below_one', 'gear_above_one', 'zero_gear', 'all_zero_weights', 'inactive_axes', 'tchebycheff_basic', 'tchebycheff_signed_deviation', 'normalization_floor', 'exact_tie', 'negative_weight_resolves_zero', 'decimal_weight_exactness', 'payoff_table_admissibility'],
  12: ['weight_below_3kg', 'weight_at_3kg', 'weight_above_3kg', 'concave_penalty', 'narrow_interval', 'singleton_interval', 'overswing_nonzero_iff_ted_negative', 'prevent_overswing', 'ted_objective'],
  13: ['zero_price_weight', 'budget_deficit', 'multiple_presets', 'exact_tie', 'optional_reduction_counterexample'],
  14: ['instance_identity', 'fractional_weight_0155', 'negative_weight', 'source_quantities'],
};

/** Tags that may appear in any family: the small-gap cases ADR 0013 section 3 asks to supplement exact ties. */
export const CROSS_CUTTING_TAGS: readonly string[] = ['tiny_positive_gap', 'near_cap'];

// ---------------------------------------------------------------------------------------------
// ADR 0013 section 3: every named subcase is covered by a case or explicitly deferred
// ---------------------------------------------------------------------------------------------

/** The stage that owns the evidence a finite exact ledger cannot hold (ADR 0013 section 2 table, section 7). */
export const STAGE_3_NATIVE_NUMERICAL = 'Stage 3 native/numerical evidence';

/**
 * A subcase ADR 0013 section 3 requires that a finite ledger of exact physical builds cannot express. It is
 * not covered here; it is owned by a named later stage, and no case may carry its id as a tag (a deferred
 * subcase that quietly acquired a case would be a stale entry).
 */
export interface DeferredSubcase {
  id: string;
  family: Family | 'cross-cutting';
  /** The ADR's own words for the subcase (checked against the ADR text). */
  adrWording: string;
  ownerStage: string;
  /** Why the ledger cannot express it, and what the ledger does cover of it. */
  reason: string;
}

export const DEFERRED_SUBCASES: readonly DeferredSubcase[] = [
  {
    id: 'hard_secant_domains',
    family: 12,
    adrWording: 'hard secant domains',
    ownerStage: STAGE_3_NATIVE_NUMERICAL,
    reason:
      'The concave weight penalty q(W) = max(0, 100 - 300/W) is bounded below by its secant only inside one weight interval, and ' +
      'which interval, how its endpoints round outward and how the secant error enters each weighted or Tchebycheff coefficient are ' +
      'properties of the solver\'s per-node LP coefficients and floating-point bound arithmetic. A finite exact ledger holds physical ' +
      'builds with their exact TED and score; it cannot express a relaxation\'s coefficient domain. What it can express is covered by ' +
      'family 12 (W below/at/above 3 kg, singleton and narrow intervals, concave penalty, TED objective); the secant arithmetic itself ' +
      'needs the pinned native build and per-node coefficient evidence (ADR 0013 sections 4C and 7, ADR 0007).',
  },
  {
    id: 'mapping_parser_coefficient_errors',
    family: 12,
    adrWording: 'mapping/parser/coefficient errors',
    ownerStage: STAGE_3_NATIVE_NUMERICAL,
    reason:
      'Equality of the emitted and the parsed model (rows, bounds, objective, integrality, coefficients), HiGHS small-coefficient and ' +
      'large-matrix filtering, and very wide price normalization are properties of the pinned native HiGHS build and of the LP text ' +
      'the production builder emits. The oracle never builds or parses an LP, so a ledger of exact physical builds cannot express ' +
      'them. Owned by the Stage 3 parser/readback evidence (ADR 0013 sections 4B and 7).',
  },
  {
    id: 'reported_interval_containment',
    family: 'cross-cutting',
    adrWording: 'reported intervals contain the oracle optimum in the same frame',
    ownerStage: STAGE_3_NATIVE_NUMERICAL,
    reason:
      'A reported lower/upper bound interval is solver output. Each case fixes the exact optimum and the pinned runtime tolerance ' +
      '(runtimeTolerance), but the check that the justified reported interval contains that optimum in the same objective frame can ' +
      'only run against a solver\'s answer (ADR 0013 section 7).',
  },
];

/** How the ledger answers one subcase named by the ADR: tags that have cases, or a deferral by id. */
export type AdrDisposition = { covers: readonly string[] } | { deferred: string };

export interface AdrSubcase {
  family: Family | 'cross-cutting';
  /** The ADR's own words (the test checks they occur verbatim in the ADR 0013 section 3 item for this family). */
  wording: string;
  disposition: AdrDisposition;
}

const covered = (family: Family | 'cross-cutting', wording: string, ...covers: string[]): AdrSubcase => ({ family, wording, disposition: { covers } });
const deferred = (family: Family | 'cross-cutting', wording: string, id: string): AdrSubcase => ({ family, wording, disposition: { deferred: id } });

/**
 * Every subcase ADR 0013 section 3 names for the fourteen families (and its closing paragraph on small gaps and
 * reported intervals), in the ADR's wording, each either covered by REQUIRED_SUBCASES tags that have cases or
 * deferred with a reason and an owner stage. A tag in REQUIRED_SUBCASES that no entry here maps is a refinement
 * of a named subcase or comes from ADR 0010 section 4.
 */
export const ADR_0013_SECTION_3_SUBCASES: readonly AdrSubcase[] = [
  covered(1, 'template pair exclusion', 'template_pair_exclusion'),
  covered(1, 'self-copy cap', 'self_copy_cap'),
  covered(1, 'physical slot conflicts', 'physical_slot_conflict'),
  covered(1, 'legal alternative placements', 'legal_alternative_placement'),

  covered(2, 'empty root required slot', 'empty_root_required_slot'),
  covered(2, 'empty conditional mod slot', 'empty_conditional_slot_owner_off'),
  covered(2, 'unavailable candidates', 'unavailable_candidates'),

  covered(3, 'descendant/fixed-point removal', 'descendant_removal', 'fixed_point_removal'),
  covered(3, 'alternative parents', 'alternative_parents'),
  covered(3, 'self/ancestor loops', 'self_loop', 'ancestor_loop'),
  covered(3, 'indexed-orphan removal', 'indexed_orphan_removal'),
  covered(3, 'memoization context', 'memoization_context'),

  covered(4, 'item and category includes/exclusions', 'include_item', 'include_category', 'exclude_item', 'exclude_category'),
  covered(4, 'group structure', 'category_group_structure'),
  covered(4, 'magazine/sighting boundaries', 'magazine_boundary', 'sighting_boundary'),
  covered(4, 'recoil final-cap conversion', 'recoil_final_cap_conversion'),
  covered(4, 'other hard caps', 'other_hard_caps'),

  covered(5, 'inaccessible naked/accessible preset', 'inaccessible_naked_accessible_preset'),
  covered(5, 'no legal base', 'no_legal_base'),
  covered(5, 'expensive but legal offers', 'expensive_legal_offer'),
  covered(5, 'no price-zero invented receiver', 'no_invented_zero_receiver'),
  covered(5, 'preset-only arbitrary-price rule', 'preset_only_item_real_spend'),

  covered(6, 'source count>1', 'preset_count_gt_one'),
  covered(6, 'multiple copies', 'multiple_copies'),
  covered(6, 'stripping and retention', 'stripping', 'retention'),
  covered(6, 'base cost once', 'base_cost_once'),
  covered(6, 'no forced preset monopoly', 'no_preset_monopoly'),

  covered(7, 'same-build spend nonincrease', 'spend_nonincrease'),
  covered(7, 'feasible-set expansion', 'feasible_set_expansion'),
  covered(7, 'maximum-score nondecrease', 'max_score_nondecrease'),
  covered(7, 'not a claim that chosen optimum spend cannot rise', 'optimum_spend_may_rise'),

  covered(8, 'positive replacement barrel', 'positive_replacement_barrel'),
  covered(8, 'optional/required fallback', 'optional_fallback', 'required_fallback'),
  covered(8, 'missing/nonpositive COI', 'missing_coi', 'nonpositive_coi'),
  covered(8, 'zero intrinsic COI', 'zero_intrinsic_coi'),
  covered(8, 'signed accuracy', 'signed_accuracy'),
  covered(8, 'constant row', 'constant_moa_exceeds_cap'),
  covered(8, 'high-divergence provisional model examples', 'high_divergence'),

  covered(9, 'repeated required copies with insufficient/sufficient stock', 'required_copies_insufficient_stock', 'required_copies_sufficient_stock'),
  covered(9, 'mixed preset/owned/paid supply', 'mixed_supply'),
  covered(9, 'exact standalone-inaccessible caps', 'standalone_inaccessible_cap'),

  covered(10, 'no disconnected selected assembly', 'no_disconnected_assembly'),
  covered(10, 'conditional owner deactivation', 'conditional_owner_deactivation'),
  covered(10, 'retained alternate rooted path', 'retained_alternate_path'),

  covered(11, 'every raw/effective clamp regime and boundary', 'clamp_raw_above_100', 'clamp_raw_below_zero', 'clamp_exact_bounds', 'effective_clamp'),
  covered(11, 'identity/zero gear factor', 'identity_gear', 'zero_gear'),
  covered(11, 'all-zero weights', 'all_zero_weights'),
  covered(11, 'inactive axes', 'inactive_axes'),
  covered(11, 'signed active Tchebycheff deviations', 'tchebycheff_signed_deviation'),
  covered(11, 'normalization floors', 'normalization_floor'),
  covered(11, 'Resolved weights are nonnegative', 'negative_weight_resolves_zero'),

  covered(12, 'W below/at/above 3 kg', 'weight_below_3kg', 'weight_at_3kg', 'weight_above_3kg'),
  covered(12, 'singleton/narrow intervals', 'singleton_interval', 'narrow_interval'),
  deferred(12, 'hard secant domains', 'hard_secant_domains'),
  deferred(12, 'mapping/parser/coefficient errors', 'mapping_parser_coefficient_errors'),
  covered(12, 'overswing nonzero iff TED<0', 'overswing_nonzero_iff_ted_negative'),

  covered(13, 'zero price weight', 'zero_price_weight'),
  covered(13, 'exact wallet/budget deficit', 'budget_deficit'),
  covered(13, 'multiple presets', 'multiple_presets'),
  covered(13, 'exact optimizing ties without epsilon/base penalties', 'exact_tie'),
  covered(13, 'optional reduction counterexamples', 'optional_reduction_counterexample'),

  covered(14, 'repeated instance identity and manifest', 'instance_identity'),
  covered(14, 'fractional 0.0155 kg', 'fractional_weight_0155'),
  covered(14, 'signed/negative-weight bounds', 'negative_weight'),
  covered(14, 'source quantities', 'source_quantities'),

  covered('cross-cutting', 'tiny positive-gap and near-cap cases', 'tiny_positive_gap', 'near_cap'),
  deferred('cross-cutting', 'reported intervals contain the oracle optimum in the same frame', 'reported_interval_containment'),
];

export const MONOTONICITY: readonly MonotonicityRelation[] = [...MONOTONICITY_F07];

export const LEDGER: readonly LedgerCase[] = [...FAMILY_01, ...FAMILY_02, ...FAMILY_03, ...FAMILY_04, ...FAMILY_05, ...FAMILY_06, ...FAMILY_07, ...FAMILY_08, ...FAMILY_09, ...FAMILY_10, ...FAMILY_11, ...FAMILY_12, ...FAMILY_13, ...FAMILY_14];
