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
 * refined where one named subcase splits into separately testable behaviors. The coverage test in
 * ledger.test.ts fails when a family or a tag has no case, and when a case uses a tag outside this
 * catalogue.
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
  9: ['one_item_two_required_slots', 'required_copies_insufficient_stock', 'required_copies_sufficient_stock', 'mixed_supply', 'standalone_inaccessible_cap', 'zero_stored_price_not_an_offer', 'zero_cost_legal_offer', 'allocation_order', 'barter_valuation'],
  10: ['no_disconnected_assembly', 'conditional_owner_deactivation', 'retained_alternate_path'],
  11: ['clamp_raw_above_100', 'clamp_raw_below_zero', 'clamp_exact_bounds', 'effective_clamp', 'identity_gear', 'gear_below_one', 'gear_above_one', 'zero_gear', 'all_zero_weights', 'inactive_axes', 'tchebycheff_basic', 'tchebycheff_signed_deviation', 'normalization_floor', 'exact_tie', 'negative_weight_resolves_zero', 'decimal_weight_exactness'],
  12: ['weight_below_3kg', 'weight_at_3kg', 'weight_above_3kg', 'concave_penalty', 'narrow_interval', 'singleton_interval', 'overswing_nonzero_iff_ted_negative', 'prevent_overswing', 'ted_objective'],
  13: ['zero_price_weight', 'budget_deficit', 'multiple_presets', 'exact_tie', 'optional_reduction_counterexample'],
  14: ['instance_identity', 'fractional_weight_0155', 'negative_weight', 'source_quantities'],
};

/** Tags that may appear in any family: the small-gap cases ADR 0013 section 3 asks to supplement exact ties. */
export const CROSS_CUTTING_TAGS: readonly string[] = ['tiny_positive_gap', 'near_cap'];

export const MONOTONICITY: readonly MonotonicityRelation[] = [...MONOTONICITY_F07];

export const LEDGER: readonly LedgerCase[] = [...FAMILY_01, ...FAMILY_02, ...FAMILY_03, ...FAMILY_04, ...FAMILY_05, ...FAMILY_06, ...FAMILY_07, ...FAMILY_08, ...FAMILY_09, ...FAMILY_10, ...FAMILY_11, ...FAMILY_12, ...FAMILY_13, ...FAMILY_14];
