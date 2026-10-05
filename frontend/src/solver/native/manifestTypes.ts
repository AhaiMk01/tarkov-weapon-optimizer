/** Identity of a native HiGHS build, as committed in `manifestData.ts` and checked by `loadHighs`. */
export interface HighsBuildIdentity {
  schema: number;
  highs: {
    tag: string;
    /** Full 40-hex commit of the HiGHS source the build was made from. */
    commit: string;
    /** `Highs_version()`. */
    version: string;
    /** `Highs_githash()`: the abbreviated commit HiGHS stamped into the library. Must be a prefix of `commit`. */
    githash: string;
  };
  emscripten: { version: string; emsdkCommit: string };
  /** `Highs_getSizeofHighsInt()`; the wrapper's marshalling assumes 4. */
  sizeofHighsInt: number;
  /** The C API functions (and `_malloc`/`_free`) the build exports. */
  exportedFunctions: readonly string[];
  exportedRuntimeMethods: readonly string[];
  artifacts: {
    'highs.js': { sha256: string; bytes: number };
    'highs.wasm': { sha256: string; bytes: number };
  };
}
