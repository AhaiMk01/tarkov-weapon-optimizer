/**
 * Structured solve and model readback on the pinned native HiGHS build.
 *
 * `NativeHighs.solveStructured` reads an LP text, solves it and marshals every field a decoder or a proof needs OUT of the
 * native handle before it is destroyed: model status code and name, primal solution status, the objective value, the full
 * binary64 column values (never a printed, rounded solution), MIP dual bound / gap / node count and declared telemetry.
 * A field the build cannot supply is `null` and `unavailable[field]` says why; nothing is fabricated. The pretty solution
 * text and the HiGHS log are diagnostics (`log`, `readMessages`), never a primal or proof source.
 *
 * Lifecycle. Each solve owns a fresh HiGHS handle and a private MEMFS path, both released in `finally`. A native call that
 * throws (wasm trap, abort, uncaught C++ exception, out-of-memory) discards the whole wasm instance and surfaces a
 * `SolverError`; the next call instantiates a fresh, ABI-validated one. An instance whose heap grew past
 * `maxRetainedHeapBytes` is recycled the same way (wasm memory never shrinks), which is not an error.
 */

import { ModelReadError, NativeError, NativeUsageError, SolverError } from './errors';
import { loadHighs } from './loadHighs';
import type { HighsRuntime } from './loadHighs';
import { HeapScope, copyF64, copyI32, readF64, readI32, readI64 } from './module';
import type { HighsWasmModule } from './module';
import { applyOptions, readEffectiveOptions, resolveOptions } from './options';
import type { HighsOptionValue, HighsOptions } from './options';
import type { ModelReadback } from './readback';

/** `kHighsModelStatus`, by code. */
export const MODEL_STATUS_NAMES = [
  'NotSet', 'LoadError', 'ModelError', 'PresolveError', 'SolveError', 'PostsolveError', 'ModelEmpty', 'Optimal',
  'Infeasible', 'UnboundedOrInfeasible', 'Unbounded', 'ObjectiveBound', 'ObjectiveTarget', 'TimeLimit',
  'IterationLimit', 'Unknown', 'SolutionLimit', 'Interrupt', 'MemoryLimit', 'HighsInterrupt',
] as const;

export type ModelStatusName = (typeof MODEL_STATUS_NAMES)[number];

/** The text HiGHS prints for each model status (`utilModelStatusToString`); the legacy wrapper returned exactly these. */
export const MODEL_STATUS_TEXT: Readonly<Record<ModelStatusName, string>> = {
  NotSet: 'Not Set', LoadError: 'Load error', ModelError: 'Model error', PresolveError: 'Presolve error',
  SolveError: 'Solve error', PostsolveError: 'Postsolve error', ModelEmpty: 'Empty', Optimal: 'Optimal',
  Infeasible: 'Infeasible', UnboundedOrInfeasible: 'Primal infeasible or unbounded', Unbounded: 'Unbounded',
  ObjectiveBound: 'Bound on objective reached', ObjectiveTarget: 'Target for objective reached',
  TimeLimit: 'Time limit reached', IterationLimit: 'Iteration limit reached', Unknown: 'Unknown',
  SolutionLimit: 'Solution limit reached', Interrupt: 'Interrupted by user', MemoryLimit: 'Memory limit reached',
  HighsInterrupt: 'Interrupted by HiGHS',
};

const SOLUTION_STATUS_NAMES = ['None', 'Infeasible', 'Feasible'] as const;
const RUN_STATUS: Readonly<Record<number, 'Ok' | 'Warning' | 'Error'>> = { 0: 'Ok', 1: 'Warning', [-1]: 'Error' };

export interface StatusValue<N extends string> {
  readonly code: number;
  readonly name: N | 'Unrecognized';
}

export interface SolveExtras {
  /** Also return the per-row activities (`rowValues`). Default false. */
  includeRows?: boolean;
  /** Fetch column and row names from the parsed model (needed for `colIndexByName`). Default true. */
  includeNames?: boolean;
  /** Also return the parsed model (`readback`) of the exact model that was solved. Default false. */
  includeReadback?: boolean;
  /** Turn HiGHS logging on and return its lines in `log` (diagnostic only). Default false. */
  captureLog?: boolean;
}

export interface NativeResult {
  readonly runtimeId: number;
  readonly highsVersion: string;
  readonly githash: string;
  /** `warning`: HiGHS adjusted the model while reading it (dropped small entries, treated big bounds as infinite). See `readMessages`. */
  readonly readStatus: 'ok' | 'warning';
  /** HiGHS log lines from reading the model (the only place such warnings are visible). */
  readonly readMessages: readonly string[];
  readonly runStatus: StatusValue<'Ok' | 'Warning' | 'Error'>;
  readonly modelStatus: StatusValue<ModelStatusName>;
  readonly primalSolutionStatus: StatusValue<(typeof SOLUTION_STATUS_NAMES)[number]>;
  /** Objective value of the primal solution, or null when there is none. */
  readonly objectiveValue: number | null;
  readonly model: {
    readonly numCol: number;
    readonly numRow: number;
    readonly numNz: number;
    readonly numInteger: number;
    readonly isMip: boolean;
    readonly sense: 'min' | 'max';
  };
  readonly colNames: readonly string[] | null;
  readonly colIndexByName: ReadonlyMap<string, number>;
  /** Full-precision primal column values in the model's column order; null without a primal solution. */
  readonly colValues: Float64Array | null;
  readonly rowNames: readonly string[] | null;
  readonly rowValues: Float64Array | null;
  /** MIP dual bound in the objective's own sense (an upper bound for a maximization); null for a pure LP. */
  readonly mipDualBound: number | null;
  /** HiGHS's relative gap |primal - dual| / |primal| as a fraction (not a percent); Infinity without a primal bound. */
  readonly mipRelativeGap: number | null;
  /** |objective - dual bound|, computed here from the two values above; null unless both are finite. */
  readonly mipAbsoluteGap: number | null;
  readonly mipNodeCount: number | null;
  readonly simplexIterations: number | null;
  readonly ipmIterations: number | null;
  readonly maxIntegralityViolation: number | null;
  /** HiGHS's own clock in seconds, running since the handle was created: it includes reading the model. */
  readonly runTimeSec: number | null;
  readonly wallMs: { readonly read: number; readonly run: number; readonly total: number };
  /** The value HiGHS holds for every option that was set (what the solve actually used). */
  readonly effectiveOptions: Readonly<Record<string, HighsOptionValue>>;
  readonly readback: ModelReadback | null;
  readonly log: readonly string[];
  /** For every field above that is null (or an empty collection), why. */
  readonly unavailable: Readonly<Record<string, string>>;
}

export type ModelReadbackResult = ModelReadback & {
  readonly readStatus: 'ok' | 'warning';
  readonly readMessages: readonly string[];
  readonly effectiveOptions: Readonly<Record<string, HighsOptionValue>>;
};

export interface NativeHighsConfig {
  /** Produces a ready runtime. Default: `loadHighs()` with the default location. Tests inject wrappers here. */
  loader?: () => Promise<HighsRuntime>;
  /** Recycle the instance after a solve when its wasm heap exceeds this many bytes. Default 768 MiB. */
  maxRetainedHeapBytes?: number;
}

const NAME_BUFFER = 4096;
const CANARY = 0xa5;
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

interface RawLp {
  numCol: number; numRow: number; numNz: number;
  sense: 'min' | 'max'; offset: number;
  colCost: Float64Array; colLower: Float64Array; colUpper: Float64Array;
  rowLower: Float64Array; rowUpper: Float64Array;
  start: Int32Array; index: Int32Array; value: Float64Array; integrality: Int32Array;
}

function extractLp(module: HighsWasmModule, handle: number): RawLp {
  const heap = new HeapScope(module);
  try {
    const nCol = module._Highs_getNumCol(handle);
    const nRow = module._Highs_getNumRow(handle);
    const nNz = module._Highs_getNumNz(handle);
    const pNumCol = heap.alloc(4), pNumRow = heap.alloc(4), pNumNz = heap.alloc(4), pSense = heap.alloc(4), pOffset = heap.alloc(8);
    const pCost = heap.f64Array(nCol), pColLower = heap.f64Array(nCol), pColUpper = heap.f64Array(nCol);
    const pRowLower = heap.f64Array(nRow), pRowUpper = heap.f64Array(nRow);
    const pStart = heap.i32Array(nCol), pIndex = heap.i32Array(nNz), pValue = heap.f64Array(nNz), pIntegrality = heap.i32Array(nCol);
    const status = module._Highs_getLp(
      handle, 1, pNumCol, pNumRow, pNumNz, pSense, pOffset, pCost, pColLower, pColUpper, pRowLower, pRowUpper,
      pStart, pIndex, pValue, pIntegrality,
    );
    if (status !== 0) throw new Error(`Highs_getLp returned status ${status}`);
    const gotCol = readI32(module, pNumCol), gotRow = readI32(module, pNumRow), gotNz = readI32(module, pNumNz);
    if (gotCol !== nCol || gotRow !== nRow || gotNz > nNz) {
      throw new Error(`Highs_getLp dimensions ${gotCol}x${gotRow}/${gotNz} disagree with ${nCol}x${nRow}/${nNz}`);
    }
    const sense = readI32(module, pSense);
    return {
      numCol: nCol, numRow: nRow, numNz: gotNz,
      sense: sense === -1 ? 'max' : 'min',
      offset: readF64(module, pOffset),
      colCost: copyF64(module, pCost, nCol), colLower: copyF64(module, pColLower, nCol), colUpper: copyF64(module, pColUpper, nCol),
      rowLower: copyF64(module, pRowLower, nRow), rowUpper: copyF64(module, pRowUpper, nRow),
      start: copyI32(module, pStart, nCol), index: copyI32(module, pIndex, gotNz), value: copyF64(module, pValue, gotNz),
      integrality: copyI32(module, pIntegrality, nCol),
    };
  } finally {
    heap.free();
  }
}

function extractNames(
  module: HighsWasmModule, handle: number, count: number,
  getName: (handle: number, index: number, out: number) => number,
): string[] {
  const heap = new HeapScope(module);
  try {
    const buffer = heap.alloc(NAME_BUFFER + 16);
    const canary = buffer + NAME_BUFFER;
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      new Uint8Array(module.wasmMemory.buffer, canary, 8).fill(CANARY);
      const status = getName(handle, i, buffer);
      if (status !== 0) throw new Error(`reading name ${i} returned status ${status}`);
      const tail = new Uint8Array(module.wasmMemory.buffer, canary, 8);
      if (tail.some((b) => b !== CANARY)) throw new Error(`name ${i} overran the ${NAME_BUFFER}-byte name buffer`);
      names.push(module.UTF8ToString(buffer));
    }
    return names;
  } finally {
    heap.free();
  }
}

class InfoReader {
  private readonly module: HighsWasmModule;
  private readonly handle: number;
  private readonly heap: HeapScope;
  private readonly out: number;

  constructor(module: HighsWasmModule, handle: number, heap: HeapScope) {
    this.module = module;
    this.handle = handle;
    this.heap = heap;
    this.out = heap.alloc(8);
  }

  int(name: string): number | null {
    return this.module._Highs_getIntInfoValue(this.handle, this.heap.string(name), this.out) === 0 ? readI32(this.module, this.out) : null;
  }

  double(name: string): number | null {
    return this.module._Highs_getDoubleInfoValue(this.handle, this.heap.string(name), this.out) === 0 ? readF64(this.module, this.out) : null;
  }

  int64(name: string): number | null {
    return this.module._Highs_getInt64InfoValue(this.handle, this.heap.string(name), this.out) === 0 ? readI64(this.module, this.out) : null;
  }
}

function status<N extends string>(code: number, names: readonly N[]): StatusValue<N> {
  return { code, name: names[code] ?? 'Unrecognized' };
}

interface ReadModel {
  readStatus: 'ok' | 'warning';
  readMessages: string[];
  effectiveOptions: Record<string, HighsOptionValue>;
}

export class NativeHighs {
  private readonly loader: () => Promise<HighsRuntime>;
  private readonly maxHeap: number;
  private runtime: HighsRuntime | null = null;
  private loading: Promise<HighsRuntime> | null = null;
  private fileCounter = 0;
  /** Instances created so far (the first load counts). */
  instancesCreated = 0;
  /** Instances thrown away because a native call failed. */
  corruptionDiscards = 0;
  /** Instances recycled because their heap grew too large. */
  heapRecycles = 0;

  constructor(config: NativeHighsConfig = {}) {
    this.loader = config.loader ?? (() => loadHighs());
    this.maxHeap = config.maxRetainedHeapBytes ?? 768 * 1024 * 1024;
  }

  /** The current instance's number, or null when none is loaded. */
  get instanceId(): number | null {
    return this.runtime?.id ?? null;
  }

  /** The loaded runtime (loading it first when needed). Exposed for ABI inspection and tests. */
  async acquire(): Promise<HighsRuntime> {
    if (this.runtime) return this.runtime;
    this.loading ??= this.loader().then(
      (rt) => { this.runtime = rt; this.instancesCreated++; this.loading = null; return rt; },
      (error) => { this.loading = null; throw error; },
    );
    return this.loading;
  }

  /** Drop the current instance; the next call builds a new one. */
  discard(): void {
    this.runtime = null;
  }

  async solveStructured(lpText: string, options?: HighsOptions, extras: SolveExtras = {}): Promise<NativeResult> {
    if (typeof lpText !== 'string') throw new NativeUsageError('solveStructured expects the LP text as a string');
    let runtime = await this.acquire();
    // Concurrent callers (Sweet Spot's payoff endpoints run at the same time) interleave at that await: another call may have discarded the instance
    // (a trap, a heap recycle) since. Never run on a discarded instance; the check and the native call below are one synchronous step.
    while (this.runtime !== runtime) runtime = await this.acquire();
    return this.guarded(runtime, 'solve', () => this.solveOn(runtime, lpText, options, extras));
  }

  async readbackModel(lpText: string, options?: HighsOptions): Promise<ModelReadbackResult> {
    if (typeof lpText !== 'string') throw new NativeUsageError('readbackModel expects the LP text as a string');
    let runtime = await this.acquire();
    // Concurrent callers (Sweet Spot's payoff endpoints run at the same time) interleave at that await: another call may have discarded the instance
    // (a trap, a heap recycle) since. Never run on a discarded instance; the check and the native call below are one synchronous step.
    while (this.runtime !== runtime) runtime = await this.acquire();
    return this.guarded(runtime, 'readback', () => {
      const m = runtime.module;
      const heap = new HeapScope(m);
      const path = this.nextPath(runtime);
      let handle = 0;
      try {
        handle = m._Highs_create();
        if (handle === 0) throw new Error('Highs_create returned a null handle');
        const model = this.readModelInto(runtime, handle, lpText, options, heap, path, false);
        const lp = extractLp(m, handle);
        return {
          ...this.toReadback(m, handle, lp, true),
          readStatus: model.readStatus,
          readMessages: model.readMessages,
          effectiveOptions: model.effectiveOptions,
        };
      } finally {
        this.release(m, handle, path, heap);
      }
    });
  }

  private nextPath(runtime: HighsRuntime): string {
    return `/model-${runtime.id}-${++this.fileCounter}.lp`;
  }

  /**
   * Run `body` against `runtime`. Typed non-native errors (option, model-read, usage) pass through with the instance kept;
   * anything else means the wasm instance can no longer be trusted: discard it and raise a `SolverError`.
   */
  private guarded<T>(runtime: HighsRuntime, phase: string, body: () => T): T {
    let result: T;
    try {
      result = body();
    } catch (error) {
      if (error instanceof NativeError && !(error instanceof SolverError)) throw error;
      if (this.runtime === runtime) this.runtime = null;
      this.corruptionDiscards++;
      throw error instanceof SolverError ? error : new SolverError(phase, error);
    }
    if (this.runtime === runtime && runtime.module.wasmMemory.buffer.byteLength > this.maxHeap) {
      this.runtime = null;
      this.heapRecycles++;
    }
    return result;
  }

  /** Create the handle, set the options, write the text to MEMFS and read it with logging on to capture HiGHS's warnings. */
  private readModelInto(
    runtime: HighsRuntime, handle: number, lpText: string, options: HighsOptions | undefined, heap: HeapScope, path: string,
    captureLog: boolean,
  ): ReadModel {
    const m = runtime.module;
    const resolved = resolveOptions(captureLog ? { ...options, output_flag: true, log_to_console: true } : options);
    applyOptions(m, handle, resolved);
    m.FS.writeFile(path, lpText);
    runtime.printed.length = 0;
    applyOptions(m, handle, { output_flag: true, log_to_console: true });
    const status = m._Highs_readModel(handle, heap.string(path));
    const readMessages = runtime.printed.splice(0);
    applyOptions(m, handle, { output_flag: resolved.output_flag as boolean, log_to_console: resolved.log_to_console as boolean });
    if (status === -1) {
      const detail = readMessages.filter((line) => /error/i.test(line)).join(' | ') || readMessages.join(' | ');
      throw new ModelReadError(`HiGHS could not read the model: ${detail || 'no message'}`, readMessages);
    }
    return {
      readStatus: status === 0 ? 'ok' : 'warning',
      readMessages,
      effectiveOptions: readEffectiveOptions(m, handle, Object.keys(resolved)),
    };
  }

  private release(m: HighsWasmModule, handle: number, path: string, heap: HeapScope): void {
    // The module may already be dead (that is why we are here); cleanup failures must not mask the original error.
    if (handle) { try { m._Highs_destroy(handle); } catch { /* instance is discarded by the caller */ } }
    try { m.FS.unlink(path); } catch { /* the file may not exist */ }
    try { heap.free(); } catch { /* as above */ }
  }

  private toReadback(m: HighsWasmModule, handle: number, lp: RawLp, withNames: boolean): ModelReadback {
    return {
      sense: lp.sense,
      objectiveOffset: lp.offset,
      numCol: lp.numCol,
      numRow: lp.numRow,
      numNz: lp.numNz,
      colNames: withNames ? extractNames(m, handle, lp.numCol, (h, i, out) => m._Highs_getColName(h, i, out)) : [],
      rowNames: withNames ? extractNames(m, handle, lp.numRow, (h, i, out) => m._Highs_getRowName(h, i, out)) : [],
      colCost: lp.colCost,
      colLower: lp.colLower,
      colUpper: lp.colUpper,
      rowLower: lp.rowLower,
      rowUpper: lp.rowUpper,
      integrality: lp.integrality,
      matrix: { start: lp.start, index: lp.index, value: lp.value },
    };
  }

  private solveOn(runtime: HighsRuntime, lpText: string, options: HighsOptions | undefined, extras: SolveExtras): NativeResult {
    const m = runtime.module;
    const heap = new HeapScope(m);
    const path = this.nextPath(runtime);
    const startedAt = now();
    const unavailable: Record<string, string> = {};
    const log: string[] = [];
    let handle = 0;
    try {
      handle = m._Highs_create();
      if (handle === 0) throw new Error('Highs_create returned a null handle');
      const model = this.readModelInto(runtime, handle, lpText, options, heap, path, extras.captureLog === true);
      const readDone = now();

      const lp = extractLp(m, handle);
      const numInteger = lp.integrality.reduce((n, code) => n + (code !== 0 ? 1 : 0), 0);
      const isMip = numInteger > 0;
      const withNames = extras.includeNames !== false;
      const colNames = withNames ? extractNames(m, handle, lp.numCol, (h, i, out) => m._Highs_getColName(h, i, out)) : null;
      const rowNames = withNames && extras.includeRows ? extractNames(m, handle, lp.numRow, (h, i, out) => m._Highs_getRowName(h, i, out)) : null;
      const readback = extras.includeReadback ? this.toReadback(m, handle, lp, true) : null;

      runtime.printed.length = 0;
      const runStarted = now();
      const runCode = m._Highs_run(handle);
      const runDone = now();
      if (extras.captureLog) log.push(...runtime.printed.splice(0));
      else runtime.printed.length = 0;

      const modelStatus = status(m._Highs_getModelStatus(handle), MODEL_STATUS_NAMES);
      const info = new InfoReader(m, handle, heap);
      const primalStatus = status(info.int('primal_solution_status') ?? -1, SOLUTION_STATUS_NAMES);
      const hasPrimal = primalStatus.code === 2;

      let colValues: Float64Array | null = null;
      let rowValues: Float64Array | null = null;
      let objectiveValue: number | null = null;
      if (hasPrimal) {
        const pCols = heap.f64Array(lp.numCol);
        const wantRows = extras.includeRows === true;
        const pRows = wantRows ? heap.f64Array(lp.numRow) : 0;
        // NaN-prefill: a short solution vector would leave NaNs, which is detected instead of read as a value.
        new Float64Array(m.wasmMemory.buffer, pCols, lp.numCol).fill(NaN);
        if (wantRows) new Float64Array(m.wasmMemory.buffer, pRows, lp.numRow).fill(NaN);
        const solStatus = m._Highs_getSolution(handle, pCols, 0, pRows, 0);
        const cols = copyF64(m, pCols, lp.numCol);
        if (solStatus !== 0 || cols.some(Number.isNaN)) {
          unavailable.colValues = `Highs_getSolution returned status ${solStatus} with an incomplete column vector`;
        } else {
          colValues = cols;
        }
        if (wantRows) {
          const rows = copyF64(m, pRows, lp.numRow);
          if (solStatus === 0 && !rows.some(Number.isNaN)) rowValues = rows;
          else unavailable.rowValues = 'Highs_getSolution returned an incomplete row vector';
        }
        objectiveValue = m._Highs_getObjectiveValue(handle);
      } else {
        const why = `no primal solution (primal solution status ${primalStatus.name}, model status ${modelStatus.name})`;
        unavailable.colValues = why;
        unavailable.objectiveValue = why;
        if (extras.includeRows) unavailable.rowValues = why;
      }
      if (extras.includeRows !== true) unavailable.rowValues = 'not requested (SolveExtras.includeRows)';
      if (!withNames) unavailable.colNames = 'not requested (SolveExtras.includeNames=false)';
      if (!(withNames && extras.includeRows)) unavailable.rowNames = 'not requested (names and rows both required)';

      let mipDualBound: number | null = null;
      let mipRelativeGap: number | null = null;
      let mipAbsoluteGap: number | null = null;
      let mipNodeCount: number | null = null;
      if (isMip) {
        mipDualBound = info.double('mip_dual_bound');
        mipRelativeGap = info.double('mip_gap');
        mipNodeCount = info.int64('mip_node_count');
        if (mipDualBound === null) unavailable.mipDualBound = 'HiGHS did not report mip_dual_bound';
        else if (Number.isNaN(mipDualBound)) { mipDualBound = null; unavailable.mipDualBound = 'HiGHS reports NaN'; }
        if (mipRelativeGap === null) unavailable.mipRelativeGap = 'HiGHS did not report mip_gap';
        else if (Number.isNaN(mipRelativeGap)) { mipRelativeGap = null; unavailable.mipRelativeGap = 'HiGHS reports NaN (no primal bound to measure a gap against)'; }
        if (mipNodeCount === null) unavailable.mipNodeCount = 'HiGHS did not report mip_node_count';
        if (objectiveValue !== null && mipDualBound !== null && Number.isFinite(objectiveValue) && Number.isFinite(mipDualBound)) {
          mipAbsoluteGap = Math.abs(mipDualBound - objectiveValue);
        } else {
          unavailable.mipAbsoluteGap = 'needs a finite primal objective and a finite dual bound';
        }
      } else {
        const reason = 'the model has no integer columns (a pure LP has no MIP search)';
        unavailable.mipDualBound = reason;
        unavailable.mipRelativeGap = reason;
        unavailable.mipAbsoluteGap = reason;
        unavailable.mipNodeCount = reason;
      }

      // HiGHS reports -1 for a solver that did not run; that sentinel is not a count.
      let simplexIterations = info.int('simplex_iteration_count');
      let ipmIterations = info.int('ipm_iteration_count');
      if (simplexIterations === null || simplexIterations < 0) { simplexIterations = null; unavailable.simplexIterations = 'the simplex solver did not run'; }
      if (ipmIterations === null || ipmIterations < 0) { ipmIterations = null; unavailable.ipmIterations = 'the interior point solver did not run'; }
      const maxIntegralityViolation = isMip ? info.double('max_integrality_violation') : null;
      if (!isMip) unavailable.maxIntegralityViolation = 'the model has no integer columns';
      const runTimeSec = m._Highs_getRunTime(handle);

      const total = now() - startedAt;
      const colIndexByName = new Map<string, number>();
      colNames?.forEach((name, j) => colIndexByName.set(name, j));
      return {
        runtimeId: runtime.id,
        highsVersion: runtime.identity.highsVersion,
        githash: runtime.identity.githash,
        readStatus: model.readStatus,
        readMessages: model.readMessages,
        runStatus: runCode in RUN_STATUS ? { code: runCode, name: RUN_STATUS[runCode] } : { code: runCode, name: 'Unrecognized' },
        modelStatus,
        primalSolutionStatus: primalStatus,
        objectiveValue,
        model: { numCol: lp.numCol, numRow: lp.numRow, numNz: lp.numNz, numInteger, isMip, sense: lp.sense },
        colNames,
        colIndexByName,
        colValues,
        rowNames,
        rowValues,
        mipDualBound,
        mipRelativeGap,
        mipAbsoluteGap,
        mipNodeCount,
        simplexIterations,
        ipmIterations,
        maxIntegralityViolation,
        runTimeSec,
        wallMs: { read: readDone - startedAt, run: runDone - runStarted, total },
        effectiveOptions: model.effectiveOptions,
        readback,
        log,
        unavailable,
      };
    } finally {
      this.release(m, handle, path, heap);
    }
  }
}
