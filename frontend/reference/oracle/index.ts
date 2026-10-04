// Public surface of the independent reference oracle (Stage 1, ADR 0010 / ADR 0013 section 3).
// Reference code never imports production modules; see reference/independence.test.ts.

export * from './q';
export * from './constants';
export * from './domain';
export { resolveFixture, resolveRequest, traderLevelOf, matchesCategory, isExcludedByRequest, codeUnitCompare } from './resolve';
export type {
  ResolvedFixture, ResolvedRequest, ResolvedTemplate, ResolvedWeapon, ResolvedPreset, ResolvedSlot, ResolvedOffer,
  ResolvedObjective, ResolvedWeights, ResolvedIdealPoint, ResolvedBarterRequirement,
} from './resolve';
export * from './build';
export * from './enumerate';
export * from './acquisition';
export * from './stats';
export * from './score';
export * from './validate';
export * from './oracle';
