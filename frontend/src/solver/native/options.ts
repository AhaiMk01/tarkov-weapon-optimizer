/**
 * Typed HiGHS options.
 *
 * Only the names in `HIGHS_OPTION_TYPES` can be set; anything else is a `HighsOptionError` before it reaches HiGHS. The table
 * is checked against the loaded build (`Highs_getOptionType`) by the loader, so a HiGHS release that renames or retypes an
 * option fails the ABI validation instead of silently ignoring a setting.
 *
 * Matrix filtering. HiGHS drops a constraint-matrix entry whose magnitude is at most `small_matrix_value` (default 1e-9)
 * and treats a magnitude at least `large_matrix_value` (default 1e15) as infinite. Setting these options moves the
 * thresholds (small_matrix_value is clamped to [1e-12, inf)); it does not prove that an arbitrary coefficient survives, so
 * every model that matters must be read back and compared (`readbackModel` / `compareReadback`).
 */

import { HighsOptionError } from './errors';
import type { HighsWasmModule } from './module';
import { HeapScope, readF64, readI32 } from './module';

export type HighsOptionType = 'bool' | 'int' | 'double' | 'string';

/** Every option the wrapper exposes, with the type HiGHS declares for it. */
export const HIGHS_OPTION_TYPES = {
  // Tolerances and limits (double)
  time_limit: 'double',
  mip_rel_gap: 'double',
  mip_abs_gap: 'double',
  mip_feasibility_tolerance: 'double',
  primal_feasibility_tolerance: 'double',
  dual_feasibility_tolerance: 'double',
  small_matrix_value: 'double',
  large_matrix_value: 'double',
  objective_bound: 'double',
  objective_target: 'double',
  infinite_cost: 'double',
  infinite_bound: 'double',
  mip_heuristic_effort: 'double',
  mip_min_logging_interval: 'double',
  // Limits and switches (int)
  mip_max_improving_sols: 'int',
  mip_max_nodes: 'int',
  mip_max_leaves: 'int',
  mip_max_start_nodes: 'int',
  mip_max_stall_nodes: 'int',
  simplex_iteration_limit: 'int',
  threads: 'int',
  random_seed: 'int',
  mip_report_level: 'int',
  // Strategy (string)
  presolve: 'string',
  solver: 'string',
  parallel: 'string',
  run_crossover: 'string',
  // Flags (bool)
  output_flag: 'bool',
  log_to_console: 'bool',
  mip_detect_symmetry: 'bool',
  mip_allow_restart: 'bool',
  solve_relaxation: 'bool',
  allow_unbounded_or_infeasible: 'bool',
} as const satisfies Record<string, HighsOptionType>;

export type HighsOptionName = keyof typeof HIGHS_OPTION_TYPES;

type ValueOfType<T extends HighsOptionType> =
  T extends 'bool' ? boolean : T extends 'string' ? string : number;

/** Options accepted by `solveStructured` / `readbackModel`. */
export type HighsOptions = { [K in HighsOptionName]?: ValueOfType<(typeof HIGHS_OPTION_TYPES)[K]> };

export type HighsOptionValue = boolean | number | string;

/**
 * Options set on every handle before the caller's own: logging off, one thread (wasm builds have no threads; `threads` is
 * pinned so a future threaded build cannot change behaviour silently), and the model-filtering thresholds written out at
 * HiGHS 1.15's defaults so a different default in a later HiGHS cannot change which coefficients survive without a diff here.
 * Entries of the matrix at or below `small_matrix_value` are dropped, entries at or above `large_matrix_value` fail the read,
 * bounds and costs at or above `infinite_bound` / `infinite_cost` become infinite. Read the model back to see what survived.
 */
export const DEFAULT_HIGHS_OPTIONS: HighsOptions = {
  output_flag: false,
  log_to_console: false,
  threads: 1,
  small_matrix_value: 1e-9,
  large_matrix_value: 1e15,
  infinite_bound: 1e20,
  infinite_cost: 1e20,
};

/** `kHighsOptionType`: 0 bool, 1 int, 2 double, 3 string. */
const OPTION_TYPE_CODES: Record<number, HighsOptionType> = { 0: 'bool', 1: 'int', 2: 'double', 3: 'string' };

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

export function isKnownOption(name: string): name is HighsOptionName {
  return Object.prototype.hasOwnProperty.call(HIGHS_OPTION_TYPES, name);
}

/** Validate one option against the typed table. Throws `HighsOptionError`. */
export function validateOption(name: string, value: unknown): asserts value is HighsOptionValue {
  if (!isKnownOption(name)) {
    throw new HighsOptionError(name, `unknown option (known: ${Object.keys(HIGHS_OPTION_TYPES).join(', ')})`);
  }
  const type = HIGHS_OPTION_TYPES[name];
  switch (type) {
    case 'bool':
      if (typeof value !== 'boolean') throw new HighsOptionError(name, `expected a boolean, got ${describe(value)}`);
      return;
    case 'int':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new HighsOptionError(name, `expected an integer, got ${describe(value)}`);
      }
      if (value < INT32_MIN || value > INT32_MAX) throw new HighsOptionError(name, `${value} does not fit a 32-bit integer`);
      return;
    case 'double':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new HighsOptionError(name, `expected a number (Infinity allowed), got ${describe(value)}`);
      }
      return;
    case 'string':
      if (typeof value !== 'string' || value.length === 0) {
        throw new HighsOptionError(name, `expected a non-empty string, got ${describe(value)}`);
      }
      return;
  }
}

function describe(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : `${typeof value} ${String(value)}`;
}

/** Merge the defaults under the caller's options (an explicit `undefined` keeps the default) and validate every entry. */
export function resolveOptions(options: HighsOptions | undefined): Record<string, HighsOptionValue> {
  const resolved: Record<string, HighsOptionValue> = {};
  for (const source of [DEFAULT_HIGHS_OPTIONS, options ?? {}]) {
    for (const [name, value] of Object.entries(source)) {
      if (value === undefined) continue;
      validateOption(name, value);
      resolved[name] = value;
    }
  }
  return resolved;
}

/** Set every resolved option on a handle. HiGHS returning an error (unknown name, value out of range) is a `HighsOptionError`. */
export function applyOptions(
  module: HighsWasmModule, handle: number, resolved: Readonly<Record<string, HighsOptionValue>>,
): void {
  const heap = new HeapScope(module);
  try {
    for (const [name, value] of Object.entries(resolved)) {
      const namePtr = heap.string(name);
      let status: number;
      switch (HIGHS_OPTION_TYPES[name as HighsOptionName]) {
        case 'bool': status = module._Highs_setBoolOptionValue(handle, namePtr, value ? 1 : 0); break;
        case 'int': status = module._Highs_setIntOptionValue(handle, namePtr, value as number); break;
        case 'double': status = module._Highs_setDoubleOptionValue(handle, namePtr, value as number); break;
        case 'string': status = module._Highs_setStringOptionValue(handle, namePtr, heap.string(value as string)); break;
      }
      if (status === -1) throw new HighsOptionError(name, `HiGHS rejected the value ${describe(value)}`);
    }
  } finally {
    heap.free();
  }
}

/** The value HiGHS holds for each option name after the setters ran (what the solve actually used). */
export function readEffectiveOptions(
  module: HighsWasmModule, handle: number, names: Iterable<string>,
): Record<string, HighsOptionValue> {
  const heap = new HeapScope(module);
  const effective: Record<string, HighsOptionValue> = {};
  try {
    const out = heap.alloc(8);
    const text = heap.alloc(1024);
    for (const name of names) {
      const namePtr = heap.string(name);
      switch (HIGHS_OPTION_TYPES[name as HighsOptionName]) {
        case 'bool':
          if (module._Highs_getBoolOptionValue(handle, namePtr, out) === 0) effective[name] = readI32(module, out) !== 0;
          break;
        case 'int':
          if (module._Highs_getIntOptionValue(handle, namePtr, out) === 0) effective[name] = readI32(module, out);
          break;
        case 'double':
          if (module._Highs_getDoubleOptionValue(handle, namePtr, out) === 0) effective[name] = readF64(module, out);
          break;
        case 'string':
          if (module._Highs_getStringOptionValue(handle, namePtr, text) === 0) effective[name] = module.UTF8ToString(text);
          break;
      }
    }
  } finally {
    heap.free();
  }
  return effective;
}

/** Loader check: every table entry exists in the build with the declared type. Returns the problems found. */
export function checkOptionTable(module: HighsWasmModule, handle: number): string[] {
  const problems: string[] = [];
  const heap = new HeapScope(module);
  try {
    const out = heap.alloc(8);
    for (const [name, type] of Object.entries(HIGHS_OPTION_TYPES)) {
      const status = module._Highs_getOptionType(handle, heap.string(name), out);
      if (status !== 0) {
        problems.push(`option ${name} is unknown to this HiGHS build`);
        continue;
      }
      const actual = OPTION_TYPE_CODES[readI32(module, out)];
      if (actual !== type) problems.push(`option ${name} is ${actual ?? 'of unknown type'} in HiGHS, ${type} in the wrapper table`);
    }
  } finally {
    heap.free();
  }
  return problems;
}
