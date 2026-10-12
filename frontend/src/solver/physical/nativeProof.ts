/**
 * Qualification of one native solve (ADR 0007 section 4, ADR 0010 sections 1 and 5, ADR 0013 section 4B, Phase 2.5).
 *
 * A native bound or infeasibility verdict is evidence about the model HiGHS PARSED, not about the text that was emitted. Before either is
 * trusted, the parsed model is verified against the emitted one, on EVERY solve:
 *
 *   1. the emitted text is read back by `parseLpText`, the strict second reader that shares no code with HiGHS, and compared with the model
 *      HiGHS holds (`NativeResult.readback`, taken from the same handle before the run): every row, bound, objective entry, integrality
 *      marker and coefficient, bit for bit. A coefficient HiGHS filtered (small_matrix_value, large_matrix_value, infinite_bound) is a
 *      difference like any other. This replaces the `matrixFilterRisk` plus `readStatus` heuristic: the a-priori flag on the model only
 *      predicts what this check finds;
 *   2. the parsed right-hand side of every CONSTRUCTED row dominates the exact need recorded in `ModelProof.rows` (`>=` rows: parsed lower
 *      bound at most the need, `<=` rows: parsed upper bound at least it), compared exactly, so the allowance that counts is the one HiGHS
 *      holds, not the nominal one the writer meant;
 *   3. the native tolerances in force are the declared ones (`effectiveOptions`), HiGHS did not adjust the model while reading it, and the
 *      solve ran with presolve OFF (HiGHS 1.15.1 with presolve ON reports a suboptimal point as `Optimal` and a feasible model as `Infeasible`:
 *      see nativeSolve.ts, so no claim, bound included, is accepted from a presolved solve);
 *   4. the model's own proof inputs were not withheld at construction (`ModelProof.withheld`).
 *
 * Anything else is UNQUALIFIED: verified builds may still be published, but the bound is unknown (null) and an infeasibility verdict is
 * unresolved with the reason `Required proof prerequisite unavailable`. The check costs one strict parse and one comparison per solve; measured
 * on the pinned snapshot it is about 130 ms for AK-74N (2.1 MB of text, 38k columns) and 300 ms for M4A1 (6.5 MB, 113k columns), against solves
 * that run for seconds to minutes (see `docs/stage2-plan.md` and the Phase 2.5 report), so it runs on every solve, not on a sample.
 *
 * What a qualified bound still assumes (reported, never silently dropped): `NATIVE_FRAME.assumptions`.
 */

import { compareReadback, LpParseError, parseLpText } from '../native';
import type { NativeResult } from '../native';
import { ratCmp, ratFromDouble } from './exact';
import { NATIVE_FEASIBILITY_TOLERANCE, NATIVE_INTEGRALITY_TOLERANCE } from './nativeSolve';
import { HIGHS_LARGE_MATRIX_VALUE, HIGHS_SMALL_MATRIX_VALUE, type BoundEvidence, type ModelProof } from './proof';

/** The native tolerance frame the proofs are stated in: what `nativeSolveOptions` sets and `DEFAULT_HIGHS_OPTIONS` pins. */
export const NATIVE_FRAME = {
  primalFeasibilityTolerance: NATIVE_FEASIBILITY_TOLERANCE,
  dualFeasibilityTolerance: NATIVE_FEASIBILITY_TOLERANCE,
  /** The integrality tolerance (`mip_feasibility_tolerance`), 1e-7 on every solve (owner decision 5b). */
  mipFeasibilityTolerance: NATIVE_INTEGRALITY_TOLERANCE,
  smallMatrixValue: HIGHS_SMALL_MATRIX_VALUE,
  largeMatrixValue: HIGHS_LARGE_MATRIX_VALUE,
  /** Accepted, not proved. A qualified bound is only as sound as these. */
  assumptions: [
    'HiGHS reports a MIP dual bound that is an upper bound of the maximum of the parsed model. The floating-point error of the node LP solves (observed on the ledger: a dual bound 5e-12 below an exact optimum of 2500, about 2e-15 relative) and the dual-feasibility slack (at most the dual feasibility tolerance times the column ranges) are NOT added: neither can be bounded without node duals, which the pinned build does not export. The largest shortfall seen is reported as `boundShortfall`, and a shortfall beyond `BOUND_SANITY_RELATIVE` withholds the bound.',
    'The parsed model equals the model that was solved: the readback is taken from the same handle, after the read and before the run.',
    'Row feasibility tolerances do not enter an upper bound: a bound is a dual quantity, and a primal point that uses the tolerance is re-validated exactly and cut out when it fails (fastCut.ts).',
    'The integrality tolerance (1e-7, owner decision 5b) moves a dual bound by at most about (the objective sensitivity of an integer column) x 1e-7, in EITHER direction: a point within it of integral is accepted as integral. Raised bounds only cost certificates; a lowered one (observed once, ledger case F04-near-cap-min-ergonomics-gap-2e-20: 1.1e-5 below the exact optimum) is caught only when a verified build of the same node beats it by more than `BOUND_SANITY_RELATIVE` (the bound is then withheld). A lowered bound that no verified build exposes is not detected. Every accepted point is re-validated exactly.',
    'One solve of HiGHS 1.15.1 is not trusted alone with a certificate: every certificate-bearing verdict is confirmed by a second solve with another random seed and a third on a disagreement (owner decision 5a, solvePrecise.ts). The certificate assumes that two agreeing solves are not wrong the same way.',
  ],
} as const;

export interface NativeAssessment {
  /** All of the checks below passed: the bound and an infeasibility verdict of this solve may be used. */
  qualified: boolean;
  /** Why not, one entry per failed check (empty when qualified). */
  reasons: readonly string[];
  readback: {
    /** The parsed model was available and compared. */
    compared: boolean;
    ok: boolean;
    differences: number;
    /** Differences a documented HiGHS filter explains (small or large matrix value, infinite bound). */
    filtered: number;
    counts: Readonly<Record<string, number>>;
  };
  allowances: { checked: number; violated: number };
  tolerancesInForce: boolean;
  /** The solve ran with presolve off (the only setting whose optimality claim and bound are accepted). */
  presolveOff: boolean;
}

export interface AssessInput {
  /** The exact text that was solved (cuts included). */
  lpText: string;
  proof: ModelProof;
}

const NUMERIC_OPTION = (result: NativeResult, name: string): number | null => {
  const value = (result.effectiveOptions as NativeResult['effectiveOptions'] | undefined)?.[name];
  return typeof value === 'number' ? value : null;
};

/** Verify one solve against the text and the proof record of its model (see the module comment). Never throws on a bad model: it reports. */
export function assessNativeResult(input: AssessInput, result: NativeResult): NativeAssessment {
  const reasons: string[] = [];
  const readback: { compared: boolean; ok: boolean; differences: number; filtered: number; counts: Record<string, number> } = {
    compared: false, ok: false, differences: 0, filtered: 0, counts: {},
  };
  const allowances = { checked: 0, violated: 0 };

  if (input.proof.withheld !== null) reasons.push(`a proof input was withheld at construction: ${input.proof.withheld}`);
  if (result.readStatus !== 'ok') reasons.push(`HiGHS adjusted the model while reading it: ${result.readMessages.join(' | ') || 'no message'}`);

  const parsed = result.readback;
  if (parsed === null) {
    reasons.push('no model readback was returned, so the parsed model cannot be compared with the emitted text');
  } else {
    let expected: ReturnType<typeof parseLpText> | null = null;
    try {
      expected = parseLpText(input.lpText);
    } catch (error) {
      if (!(error instanceof LpParseError)) throw error;
      reasons.push(`the emitted text is outside the strict subset the independent parser reads: ${error.message}`);
    }
    if (expected !== null) {
      const smallMatrixValue = NUMERIC_OPTION(result, 'small_matrix_value') ?? HIGHS_SMALL_MATRIX_VALUE;
      const largeMatrixValue = NUMERIC_OPTION(result, 'large_matrix_value') ?? HIGHS_LARGE_MATRIX_VALUE;
      const comparison = compareReadback(expected, parsed, { smallMatrixValue, largeMatrixValue });
      readback.compared = true;
      readback.ok = comparison.ok;
      readback.differences = comparison.differences.length;
      readback.filtered = comparison.filtered;
      readback.counts = { ...comparison.counts };
      if (!comparison.ok) {
        const first = comparison.differences[0];
        reasons.push(`HiGHS holds a different model than the text states: ${JSON.stringify(comparison.counts)}, ${comparison.filtered} filtered, first ${JSON.stringify(first)}`);
      }
    }
    if (input.proof.rows.length > 0) {
      const rowIndex = new Map<string, number>();
      parsed.rowNames.forEach((name, i) => rowIndex.set(name, i));
      for (const row of input.proof.rows) {
        allowances.checked++;
        const i = rowIndex.get(row.row);
        const bound = i === undefined ? Number.NaN : row.relation === '>=' ? parsed.rowLower[i] : parsed.rowUpper[i];
        const dominates = Number.isFinite(bound) && (row.relation === '>=' ? ratCmp(ratFromDouble(bound), row.need) <= 0 : ratCmp(ratFromDouble(bound), row.need) >= 0);
        if (!dominates) {
          allowances.violated++;
          reasons.push(`row ${row.row}: the parsed right-hand side ${String(bound)} does not dominate the exact need`);
        }
      }
    }
  }

  // Each tolerance at most its declared value: primal and dual feasibility 1e-9, integrality 1e-7 (owner decision 5b; a stricter one is fine).
  const declared = { primal_feasibility_tolerance: NATIVE_FEASIBILITY_TOLERANCE, dual_feasibility_tolerance: NATIVE_FEASIBILITY_TOLERANCE, mip_feasibility_tolerance: NATIVE_INTEGRALITY_TOLERANCE } as const;
  const tolerancesInForce = (Object.keys(declared) as (keyof typeof declared)[]).every(name => {
    const value = NUMERIC_OPTION(result, name);
    return value !== null && value <= declared[name];
  });
  if (!tolerancesInForce) reasons.push('the native feasibility tolerances in force are not the declared ones');
  const thresholdsInForce = NUMERIC_OPTION(result, 'small_matrix_value') === HIGHS_SMALL_MATRIX_VALUE
    && NUMERIC_OPTION(result, 'large_matrix_value') === HIGHS_LARGE_MATRIX_VALUE;
  if (!thresholdsInForce) reasons.push('the matrix thresholds in force are not the declared ones');
  const presolve = (result.effectiveOptions as NativeResult['effectiveOptions'] | undefined)?.presolve;
  const presolveOff = presolve === 'off';
  if (!presolveOff) reasons.push(`the solve ran with presolve ${typeof presolve === 'string' ? presolve : 'in an unreported state'}: HiGHS 1.15.1 with presolve on can report a suboptimal point as Optimal, so a presolved solve is a witness at most`);

  return { qualified: reasons.length === 0, reasons, readback, allowances, tolerancesInForce: tolerancesInForce && thresholdsInForce, presolveOff };
}

/**
 * The bound evidence of one solve: the native MIP dual bound (the model's objective IS the oracle's: axis scaling changes columns, not the
 * objective frame), the qualification of the solve and the proved frame error of the model's objective. A model with no integer column has no MIP bound; its
 * optimal LP objective is its own bound (a primal objective of an INTERRUPTED solve, or of a MIP, is never used as one).
 */
export function boundEvidenceOf(proof: ModelProof, result: NativeResult, assessment: NativeAssessment): BoundEvidence {
  let native: number | null = null;
  const dual = result.mipDualBound;
  if (dual !== null && Number.isFinite(dual)) native = dual;
  else if (!result.model.isMip && result.modelStatus.name === 'Optimal' && result.objectiveValue !== null && Number.isFinite(result.objectiveValue)) native = result.objectiveValue;
  return {
    nativeDual: native,
    qualified: assessment.qualified,
    frameError: proof.objective?.frameError ?? 0,
  };
}
