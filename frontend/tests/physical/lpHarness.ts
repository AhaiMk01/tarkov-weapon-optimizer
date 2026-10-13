// Test harness for the physical LP: prepare a model from a hand-built lookup, solve its text on the PINNED native HiGHS build
// (`src/solver/native`, Phase 2.3: full-precision primals, no npm `highs`), decode.
//
// It owns nothing of the model: it only calls the public seams (`preparePhysicalWeapon`, `prepareSubproblemDomain`, `specializeLP`,
// `decodeSolution`) and adds constraint rows to the emitted text to pin a build, the way a Gate A/B check needs. Every model it emits is also
// checked as text: `parseLpText` (strict, HiGHS-independent) and safe names on prepare, and the model HiGHS actually read back, compared with
// the text, on solve (no dropped coefficient, no infinite bound, no tokenizer surprise).
import assert from 'node:assert/strict';
import {
  preparePhysicalWeapon, prepareSubproblemDomain, type PhysicalBlueprint, type SpatialNode, type SpecializeRequest, type SubproblemDomain, type SubproblemRequest,
} from '../../src/solver/physical';
import { specializeLP, type SpecializedModel } from './occurrence/specializeOccurrence';
import { decodeSolution, type DecodedBuild } from './occurrence/decodeOccurrence';
import {
  compareReadback, getNativeHighs, MODEL_STATUS_TEXT, parseLpText, readbackModel, type HighsOptions, type ModelStatusName,
} from '../../src/solver/native';
import type { ItemLookup } from '../../src/solver/types';

/** Tight tolerances: the model text carries exact coefficients, so the tests hold the solver to them. */
export const STRICT_OPTIONS: HighsOptions = {
  mip_rel_gap: 0,
  mip_abs_gap: 1e-9,
  mip_feasibility_tolerance: 1e-9,
  primal_feasibility_tolerance: 1e-9,
  dual_feasibility_tolerance: 1e-9,
  time_limit: 120,
};

export interface LpSolution {
  /** HiGHS's model status text (`Optimal`, `Infeasible`, ...). */
  status: string;
  /** NaN without a primal solution. */
  objective: number;
  /** Full-precision column values by name. */
  values: Record<string, number>;
}

export async function solveLp(lp: string, options: HighsOptions = STRICT_OPTIONS): Promise<LpSolution> {
  const result = await getNativeHighs().solveStructured(lp, options);
  const values: Record<string, number> = {};
  if (result.colNames !== null && result.colValues !== null) result.colNames.forEach((name, k) => { values[name] = (result.colValues as Float64Array)[k]; });
  return { status: MODEL_STATUS_TEXT[result.modelStatus.name as ModelStatusName], objective: result.objectiveValue ?? Number.NaN, values };
}

/** Names HiGHS's LP reader reads as one name: a letter or underscore, then letters, digits and underscores (never `-` before a digit). */
const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The text of a model is strictly parseable, starts with exactly `Maximize`, and every name is safe. Synchronous. */
export function assertTextIsStrict(lp: string): ReturnType<typeof parseLpText> {
  assert.equal(lp.split('\n', 1)[0], 'Maximize');
  const expected = parseLpText(lp); // throws LpParseError outside the supported subset
  for (const column of expected.columns) assert.match(column.name, SAFE_NAME, `column name ${column.name}`);
  for (const row of expected.rows) assert.match(row.name, SAFE_NAME, `row name ${row.name}`);
  assert.equal(expected.sense, 'max');
  return expected;
}

/** HiGHS reads exactly the model the text states: same columns, rows, coefficients (bit for bit), bounds and integrality. */
export async function assertReadbackMatches(lp: string): Promise<void> {
  const expected = assertTextIsStrict(lp);
  const readback = await readbackModel(lp, STRICT_OPTIONS);
  assert.equal(readback.readStatus, 'ok', `HiGHS adjusted the model while reading it: ${readback.readMessages.join(' | ')}`);
  const comparison = compareReadback(expected, readback);
  assert.ok(comparison.ok, `HiGHS read a different model: ${JSON.stringify(comparison.counts)}; first ${JSON.stringify(comparison.differences[0])}`);
}

export interface Prepared {
  blueprint: PhysicalBlueprint;
  domain: SubproblemDomain;
  model: SpecializedModel;
}

export function prepare(
  lookup: ItemLookup, weaponId: string, request: SpecializeRequest & SubproblemRequest = {}, node?: SpatialNode,
): Prepared {
  const blueprint = preparePhysicalWeapon(lookup, weaponId);
  const domain = prepareSubproblemDomain(blueprint, lookup, request);
  const model = specializeLP(blueprint, domain, request, node);
  assertTextIsStrict(model.lp);
  return { blueprint, domain, model };
}

export interface Solved extends Prepared {
  solution: LpSolution;
  /** Null unless the solver proved optimality. */
  build: DecodedBuild | null;
}

export async function solve(
  lookup: ItemLookup, weaponId: string, request: SpecializeRequest & SubproblemRequest = {}, node?: SpatialNode,
): Promise<Solved> {
  const prepared = prepare(lookup, weaponId, request, node);
  await assertReadbackMatches(prepared.model.lp);
  const solution = await solveLp(prepared.model.lp);
  const build = solution.status === 'Optimal' ? decodeSolution(prepared.model, solution.values) : null;
  return { ...prepared, solution, build };
}

/** Insert constraint rows (`name: expression sense rhs`) in front of the Bounds section of an emitted model. */
export function withRows(lp: string, rows: readonly string[]): string {
  const at = lp.indexOf('\nBounds\n');
  if (at < 0) throw new Error('model text has no Bounds section');
  return `${lp.slice(0, at)}\n${rows.map(r => `  ${r}`).join('\n')}${lp.slice(at)}`;
}
