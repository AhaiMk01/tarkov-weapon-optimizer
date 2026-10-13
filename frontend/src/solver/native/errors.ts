/**
 * Typed errors of the native HiGHS surface.
 *
 * Every failure of this module is one of these classes, so a caller can tell "the artifact is not the proof ABI"
 * (`HighsAbiError`), "the file could not be fetched or instantiated" (`HighsLoadError`), "bad option" (`HighsOptionError`),
 * "HiGHS could not parse the model" (`ModelReadError`) and "the native call blew up" (`SolverError`) apart without
 * matching message text. None of them is ever swallowed into a fallback solver.
 */

export type NativeErrorCode = 'abi' | 'load' | 'option' | 'model-read' | 'native-call' | 'usage';

export class NativeError extends Error {
  readonly code: NativeErrorCode;

  constructor(code: NativeErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/** The loaded artifact is not the build the committed manifest names (or is not a HiGHS build at all). */
export class HighsAbiError extends NativeError {
  /** Every individual check that failed, in check order. */
  readonly problems: readonly string[];

  constructor(problems: readonly string[], options?: { cause?: unknown }) {
    super('abi', `HiGHS artifact failed ABI validation: ${problems.join('; ')}`, options);
    this.problems = problems;
  }
}

/** The artifact could not be located, fetched, hashed or instantiated. */
export class HighsLoadError extends NativeError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('load', message, options);
  }
}

/** An unknown option name, or a value HiGHS or the typed table rejects. */
export class HighsOptionError extends NativeError {
  readonly option: string;

  constructor(option: string, message: string) {
    super('option', `HiGHS option "${option}": ${message}`);
    this.option = option;
  }
}

/** HiGHS returned an error status while reading the model text. The instance is still usable. */
export class ModelReadError extends NativeError {
  /** HiGHS log lines captured by re-reading the model with logging on (diagnostic only). */
  readonly log: readonly string[];

  constructor(message: string, log: readonly string[]) {
    super('model-read', message);
    this.log = log;
  }
}

/**
 * A native call threw (a wasm trap, an uncaught C++ exception, an abort, an out-of-memory failure) or left the module in
 * a state that cannot be trusted. The wasm instance has been discarded; the next call builds a fresh one.
 */
export class SolverError extends NativeError {
  readonly phase: string;
  /** True when the wasm instance was discarded because of this failure. */
  readonly corrupted: boolean;

  constructor(phase: string, cause: unknown, corrupted = true) {
    super('native-call', `HiGHS native call failed during ${phase}: ${describeThrown(cause)}`, { cause });
    this.phase = phase;
    this.corrupted = corrupted;
  }
}

/** A programming error in the caller (wrong argument shape); never a solver outcome. */
export class NativeUsageError extends NativeError {
  constructor(message: string) {
    super('usage', message);
  }
}

/** Emscripten and wasm throw non-Error values (numbers, pointers); render all of them. */
export function describeThrown(thrown: unknown): string {
  if (thrown instanceof Error) return `${thrown.name}: ${thrown.message}`;
  if (typeof thrown === 'number') return `native exception pointer ${thrown}`;
  return String(thrown);
}
