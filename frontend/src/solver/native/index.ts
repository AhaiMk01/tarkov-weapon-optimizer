/**
 * Native HiGHS surface (Phase 2.3): the pinned, reproducible WASM build, its ABI-validating loader and the structured
 * solve / readback API. See vendor/highs/README.md for provenance and `ADR 0013 section 4B` for the contract.
 */

export * from './errors';
export { COMMITTED_HIGHS_BUILD } from './manifestData';
export type { HighsBuildIdentity } from './manifestTypes';
export { loadHighs, setHighsBaseUrl, validateRuntime } from './loadHighs';
export type { HighsRuntime, LoadHighsConfig, LoadedIdentity } from './loadHighs';
export { HIGHS_OPTION_TYPES, DEFAULT_HIGHS_OPTIONS, validateOption, resolveOptions } from './options';
export type { HighsOptionName, HighsOptionType, HighsOptionValue, HighsOptions } from './options';
export { NativeHighs, MODEL_STATUS_NAMES, MODEL_STATUS_TEXT } from './native';
export type {
  ModelReadbackResult, ModelStatusName, NativeHighsConfig, NativeResult, SolveExtras, StatusValue,
} from './native';
export { compareReadback, parseLpText, LpParseError } from './readback';
export type {
  CompareOptions, ExpectedColumn, ExpectedModel, ExpectedRow, FilterCause, ModelReadback, ReadbackComparison,
  ReadbackDifference,
} from './readback';
export { discardNativeHighs, getNativeHighs, readbackModel, solveStructured } from './instance';
export { sha256Hex, sha256HexSync } from './sha256';
