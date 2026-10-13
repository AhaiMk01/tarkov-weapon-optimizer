/**
 * The surface of the Emscripten module built by vendor/highs/build/build.sh: exactly the HiGHS C API functions listed in
 * the manifest's `build.exportedFunctions`, plus the runtime helpers named in `exportedRuntimeMethods`. Pointers and
 * `HighsInt` are 32-bit numbers (the loader verifies `Highs_getSizeofHighsInt() === 4`).
 */

export interface HighsWasmFS {
  writeFile(path: string, data: string | Uint8Array): void;
  unlink(path: string): void;
}

export interface HighsWasmModule {
  _malloc(size: number): number;
  _free(ptr: number): void;

  _Highs_create(): number;
  _Highs_destroy(highs: number): void;

  _Highs_version(): number;
  _Highs_versionMajor(): number;
  _Highs_versionMinor(): number;
  _Highs_versionPatch(): number;
  _Highs_githash(): number;
  _Highs_getSizeofHighsInt(highs: number): number;
  _Highs_getInfinity(highs: number): number;

  _Highs_readModel(highs: number, filename: number): number;
  _Highs_getNumCol(highs: number): number;
  _Highs_getNumRow(highs: number): number;
  _Highs_getNumNz(highs: number): number;
  _Highs_getLp(
    highs: number, aFormat: number, numCol: number, numRow: number, numNz: number, sense: number, offset: number,
    colCost: number, colLower: number, colUpper: number, rowLower: number, rowUpper: number,
    aStart: number, aIndex: number, aValue: number, integrality: number,
  ): number;
  _Highs_getColName(highs: number, col: number, name: number): number;
  _Highs_getRowName(highs: number, row: number, name: number): number;

  _Highs_setBoolOptionValue(highs: number, option: number, value: number): number;
  _Highs_setIntOptionValue(highs: number, option: number, value: number): number;
  _Highs_setDoubleOptionValue(highs: number, option: number, value: number): number;
  _Highs_setStringOptionValue(highs: number, option: number, value: number): number;
  _Highs_getOptionType(highs: number, option: number, type: number): number;
  _Highs_getBoolOptionValue(highs: number, option: number, value: number): number;
  _Highs_getIntOptionValue(highs: number, option: number, value: number): number;
  _Highs_getDoubleOptionValue(highs: number, option: number, value: number): number;
  _Highs_getStringOptionValue(highs: number, option: number, value: number): number;

  _Highs_run(highs: number): number;
  _Highs_getModelStatus(highs: number): number;
  _Highs_getObjectiveValue(highs: number): number;
  _Highs_getSolution(highs: number, colValue: number, colDual: number, rowValue: number, rowDual: number): number;
  _Highs_getIntInfoValue(highs: number, info: number, value: number): number;
  _Highs_getDoubleInfoValue(highs: number, info: number, value: number): number;
  _Highs_getInt64InfoValue(highs: number, info: number, value: number): number;
  _Highs_getRunTime(highs: number): number;

  FS: HighsWasmFS;
  wasmMemory: WebAssembly.Memory;
  UTF8ToString(ptr: number): string;
  stringToUTF8(text: string, ptr: number, maxBytes: number): number;
  lengthBytesUTF8(text: string): number;
}

/**
 * Options Emscripten's factory accepts that the loader sets. `instantiateWasm` hands the glue the already hash-verified,
 * already compiled module (this build does not read a `wasmBinary` option), so no second fetch or file read can substitute
 * different bytes.
 */
export interface HighsModuleArgs {
  instantiateWasm: (
    imports: WebAssembly.Imports,
    receiveInstance: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
  ) => unknown;
  locateFile: (file: string) => string;
  print: (line: string) => void;
  printErr: (line: string) => void;
}

export type HighsModuleFactory = (args: HighsModuleArgs) => Promise<HighsWasmModule>;

/** Function exports the wrapper calls. The loader rejects a build that lacks any of them. */
export const REQUIRED_MODULE_FUNCTIONS = [
  '_malloc', '_free',
  '_Highs_create', '_Highs_destroy',
  '_Highs_version', '_Highs_versionMajor', '_Highs_versionMinor', '_Highs_versionPatch', '_Highs_githash',
  '_Highs_getSizeofHighsInt', '_Highs_getInfinity',
  '_Highs_readModel', '_Highs_getNumCol', '_Highs_getNumRow', '_Highs_getNumNz',
  '_Highs_getLp', '_Highs_getColName', '_Highs_getRowName',
  '_Highs_setBoolOptionValue', '_Highs_setIntOptionValue', '_Highs_setDoubleOptionValue', '_Highs_setStringOptionValue',
  '_Highs_getOptionType',
  '_Highs_getBoolOptionValue', '_Highs_getIntOptionValue', '_Highs_getDoubleOptionValue', '_Highs_getStringOptionValue',
  '_Highs_run', '_Highs_getModelStatus', '_Highs_getObjectiveValue', '_Highs_getSolution',
  '_Highs_getIntInfoValue', '_Highs_getDoubleInfoValue', '_Highs_getInt64InfoValue',
  '_Highs_getRunTime',
] as const;

/** Runtime helpers the wrapper uses (`exportedRuntimeMethods` in the manifest). */
export const REQUIRED_RUNTIME_MEMBERS = ['FS', 'wasmMemory', 'UTF8ToString', 'stringToUTF8', 'lengthBytesUTF8'] as const;

/**
 * Scoped wasm-heap allocations. Everything allocated through one scope is released by `free()`, which the solver calls in a
 * `finally` so a throwing call cannot leak into the next solve. Views are created on demand: memory growth detaches old
 * `ArrayBuffer`s, so a typed array must never be held across a native call.
 */
export class HeapScope {
  private readonly module: HighsWasmModule;
  private readonly pointers: number[] = [];

  constructor(module: HighsWasmModule) {
    this.module = module;
  }

  alloc(bytes: number): number {
    const ptr = this.module._malloc(Math.max(8, Math.ceil(bytes / 8) * 8));
    if (ptr === 0) throw new Error(`wasm heap allocation of ${bytes} bytes failed`);
    this.pointers.push(ptr);
    new Uint8Array(this.module.wasmMemory.buffer, ptr, Math.max(8, Math.ceil(bytes / 8) * 8)).fill(0);
    return ptr;
  }

  string(text: string): number {
    const bytes = this.module.lengthBytesUTF8(text) + 1;
    const ptr = this.alloc(bytes);
    this.module.stringToUTF8(text, ptr, bytes);
    return ptr;
  }

  f64Array(count: number): number {
    return this.alloc(8 * count);
  }

  i32Array(count: number): number {
    return this.alloc(4 * count);
  }

  free(): void {
    for (const ptr of this.pointers.splice(0)) this.module._free(ptr);
  }
}

export function readF64(module: HighsWasmModule, ptr: number): number {
  return new Float64Array(module.wasmMemory.buffer, ptr, 1)[0];
}

export function readI32(module: HighsWasmModule, ptr: number): number {
  return new Int32Array(module.wasmMemory.buffer, ptr, 1)[0];
}

/** A copy (never a view) of `count` doubles starting at `ptr`. */
export function copyF64(module: HighsWasmModule, ptr: number, count: number): Float64Array {
  return new Float64Array(module.wasmMemory.buffer, ptr, count).slice();
}

export function copyI32(module: HighsWasmModule, ptr: number, count: number): Int32Array {
  return new Int32Array(module.wasmMemory.buffer, ptr, count).slice();
}

/** A signed 64-bit integer written by `Highs_getInt64InfoValue`, as a number (exact below 2^53). */
export function readI64(module: HighsWasmModule, ptr: number): number {
  const words = new Int32Array(module.wasmMemory.buffer, ptr, 2);
  const lo = words[0] >>> 0;
  const hi = words[1];
  return hi * 4294967296 + lo;
}
