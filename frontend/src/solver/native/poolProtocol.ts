/**
 * The messages between the native solve pool (`pool.ts`) and one pool worker (`poolWorker.ts`), and the round trip of the typed native errors.
 *
 * A pool worker owns one instance of the pinned HiGHS build, loaded by the same `loadHighs` (same files, same SHA-256 check before any of their code
 * runs, same ABI validation). It solves one text at a time with `NativeHighs.solveStructured` and returns the `NativeResult` by structured clone
 * (its `Map` and typed arrays survive the clone). A typed error is sent as its fields and rebuilt as the same class on the other side, so the
 * callers' `instanceof SolverError` rules (the presolve policy, the search's typed-error path) see exactly what an in-thread solve would throw.
 */

import { HighsAbiError, HighsLoadError, HighsOptionError, ModelReadError, NativeError, NativeUsageError, SolverError, describeThrown } from './errors';
import type { NativeErrorCode } from './errors';
import type { HighsOptions } from './options';
import type { NativeResult, SolveExtras } from './native';

export type PoolInMessage =
  /** Load the pinned build. `location`: the browser base URL of `highs.js` / `highs.wasm` (Node: undefined, the default `public/`). */
  | { type: 'init'; location?: string }
  | { type: 'solve'; id: number; lpText: string; options: HighsOptions; extras: SolveExtras };

export type PoolOutMessage =
  | { type: 'ready'; highsVersion: string; wasmSha256: string; heapBytes: number }
  | { type: 'initError'; error: SerializedError }
  | { type: 'result'; id: number; result: NativeResult; heapBytes: number }
  | { type: 'error'; id: number; error: SerializedError; heapBytes: number };

export interface SerializedError {
  name: string;
  message: string;
  /** `NativeError.code` when the error was a typed native error. */
  code?: NativeErrorCode;
  phase?: string;
  corrupted?: boolean;
  log?: readonly string[];
  problems?: readonly string[];
  option?: string;
}

export function serializeError(error: unknown): SerializedError {
  if (!(error instanceof Error)) return { name: 'Error', message: describeThrown(error) };
  const out: SerializedError = { name: error.name, message: error.message };
  if (error instanceof NativeError) out.code = error.code;
  if (error instanceof SolverError) { out.phase = error.phase; out.corrupted = error.corrupted; }
  if (error instanceof ModelReadError) out.log = [...error.log];
  if (error instanceof HighsAbiError) out.problems = [...error.problems];
  if (error instanceof HighsOptionError) out.option = error.option;
  return out;
}

/** Give a plain error the prototype and fields of its typed class (its message is kept exactly as the worker produced it). */
function retype<T extends Error>(prototype: T, message: string, fields: Record<string, unknown>): T {
  const error = new Error(message) as Error & Record<string, unknown>;
  Object.setPrototypeOf(error, prototype);
  for (const [key, value] of Object.entries(fields)) Object.defineProperty(error, key, { value, enumerable: true, writable: false });
  return error as unknown as T;
}

export function deserializeError(e: SerializedError): Error {
  const base = { name: e.name, code: e.code };
  switch (e.code) {
    case 'native-call': return retype(SolverError.prototype, e.message, { ...base, phase: e.phase ?? 'solve', corrupted: e.corrupted ?? true });
    case 'model-read': return retype(ModelReadError.prototype, e.message, { ...base, log: e.log ?? [] });
    case 'abi': return retype(HighsAbiError.prototype, e.message, { ...base, problems: e.problems ?? [] });
    case 'load': return retype(HighsLoadError.prototype, e.message, base);
    case 'option': return retype(HighsOptionError.prototype, e.message, { ...base, option: e.option ?? '' });
    case 'usage': return retype(NativeUsageError.prototype, e.message, base);
    default: {
      const error = new Error(e.message);
      error.name = e.name;
      return error;
    }
  }
}
