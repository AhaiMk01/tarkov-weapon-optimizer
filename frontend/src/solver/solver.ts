/**
 * Z3 Solver Integration
 * Wraps Z3 logic for the frontend.
 */

import type { OptimizeResponse } from '../api/client.ts';
import type { SolveParams } from './types.ts';
// Re-export for consumers like test scripts if they import from here
export type { SolveParams } from './types.ts';

import { solveZ3 } from './z3Solver.ts';

export async function solve(params: SolveParams): Promise<OptimizeResponse> {
  try {
    return await solveZ3(params);
  } catch (e: any) {
    console.error("Z3 Solve Error:", e);
    return {
      status: 'infeasible',
      reason: e.message || 'Unknown Z3 error',
      selected_items: [],
      selected_preset: undefined,
      objective_value: 0,
      solve_time_ms: 0,
      final_stats: {
        ergonomics: 0,
        recoil_vertical: 0,
        recoil_horizontal: 0,
        total_price: 0,
        total_weight: 0
      }
    };
  }
}
