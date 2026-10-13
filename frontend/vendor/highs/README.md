# Native HiGHS WebAssembly build

The solver runs the MIP in the browser (and in Node for tests) on a HiGHS build that this repository produces itself, from
pinned inputs, with a scripted and reproducible build. ADR 0013 section 4B, ADR 0010 section 5, GitHub #30.

| File | Role |
| :--- | :--- |
| `highs.js`, `highs.wasm` | The artifacts (ES module glue and wasm). `frontend/public/` holds the copies the browser loads; these are the vendored copies. |
| `highs-build-manifest.json` | Everything the build was pinned to and produced: versions, commits, flags, exports, SHA-256, host. Identical in `public/` and here. |
| `build/build.sh` | The build. Runs on Linux (tested on Ubuntu 26.04, x86_64). |
| `build/smoke.mjs`, `build/make_manifest.py` | Glue the build runs: a runtime smoke test and the manifest writer. Hashed into the manifest. |
| `build/install-artifacts.mjs` | Verifies a finished build, copies it here and to `public/`, regenerates `src/solver/native/manifestData.ts`. |

There is no highs-js, no npm `highs` package and no pretty-printed solution text in this build. HiGHS's own C API is compiled
to a static library and linked into an ES module that exports exactly the 33 C API functions the TypeScript wrapper
(`src/solver/native/`) calls, plus `_malloc` and `_free`. The wrapper is ours.

## Provenance (pinned inputs)

| Input | Pin | Why |
| :--- | :--- | :--- |
| Emscripten SDK | official `emscripten-core/emsdk` tag `6.0.11`, commit `dd8e25632640cfc1fb570c7fa4cc374e8a5e5a72`; emscripten-releases build `f6264d4a4dd9ba24a9f0a5702835a44d1463de13`; `emcc 6.0.11 (a0014542110d6078c3a1a7941fa1ddb3a2281f16)`; `clang 24.0.0git (llvm-project f718ebe873411a562ef6e5c27da36d75b7aaec98)` | The newest tagged emsdk release on 2026-10-04. The toolchain archive's SHA-256 is recorded in the manifest (`toolchain.emsdkDownloads`). |
| HiGHS | official `ERGO-Code/HiGHS` tag `v1.15.1`, commit `04024d701f79fb8e2f18bc3df0dffc04ef05088` (`Highs_version()` is `1.15.1`, `Highs_githash()` is `04024d701f79`) | The newest tagged release on 2026-10-04. `master` is not a release; patch release 1.15.1 supersedes 1.15.0. |
| Glue we own | `build.sh`, `smoke.mjs`, `make_manifest.py` (SHA-256 in the manifest) and the TypeScript wrapper | |

Host tools used for the committed artifacts: CMake 4.2.3, Ninja 1.13.2, Python 3.14.4, git 2.53. CMake 4 rejects projects that
declare `cmake_minimum_required` below 3.5; neither HiGHS nor its dependencies do, so `-DCMAKE_POLICY_VERSION_MINIMUM` was not needed.

## Build configuration (every flag)

CMake (HiGHS, static library, no threads, no OpenMP, no zlib, no HiPO):
`-DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DBUILD_CXX_EXE=OFF -DBUILD_TESTING=OFF -DBUILD_EXAMPLES=OFF
-DBUILD_SHARED_EXTRAS_LIB=OFF -DFAST_BUILD=ON -DZLIB=OFF -DHIPO=OFF -DHIGHS_NO_DEFAULT_THREADS=ON`, configured through `emcmake`
with Ninja, `CMAKE_{C,CXX}_FLAGS="-O3 -DNDEBUG -fwasm-exceptions -ffile-prefix-map=<root>=/tarkov-highs-build"`.
The manifest records one complete compile command (`build.compileCommandSample`).

Link (`em++ libhighs.a libhighs_extras.a`):
`-O3 -fwasm-exceptions -sWASM_LEGACY_EXCEPTIONS=1 --no-entry -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createHighsModule
-sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=67108864 -sMAXIMUM_MEMORY=4294967296 -sSTACK_SIZE=8388608
-sFORCE_FILESYSTEM=1 -sASSERTIONS=0 -sEXIT_RUNTIME=0`, `-sEXPORTED_FUNCTIONS` = the list in `build.sh`,
`-sEXPORTED_RUNTIME_METHODS=FS,wasmMemory,UTF8ToString,stringToUTF8,lengthBytesUTF8`.

* **Memory:** growth enabled, 64 MiB initial (the legacy artifact's value), 4 GiB ceiling, 8 MiB stack.
* **C++ exceptions are on** (`-fwasm-exceptions`, the legacy try/catch-opcode flavour pinned explicitly: it runs in every browser that
  runs wasm exceptions at all, Safari 15.2+; the exnref flavour needs Safari 18.4+, Chrome 137+, Firefox 131+). HiGHS catches
  `std::invalid_argument` around its LP parser and `std::bad_alloc` around allocation; with exceptions off, a malformed LP or an
  allocation failure would abort the module.
* **Threads:** none (`HIGHS_NO_DEFAULT_THREADS`; the wrapper also sets `threads=1`).
* **Exports:** `_malloc _free _Highs_create _Highs_destroy _Highs_version _Highs_versionMajor _Highs_versionMinor _Highs_versionPatch
  _Highs_githash _Highs_getSizeofHighsInt _Highs_getInfinity _Highs_readModel _Highs_getNumCol _Highs_getNumRow _Highs_getNumNz
  _Highs_getLp _Highs_getColName _Highs_getRowName _Highs_set{Bool,Int,Double,String}OptionValue _Highs_getOptionType
  _Highs_get{Bool,Int,Double,String}OptionValue _Highs_run _Highs_getModelStatus _Highs_getObjectiveValue _Highs_getSolution
  _Highs_get{Int,Double,Int64}InfoValue _Highs_getRunTime`. The build fails if the module exports a different set.

## Current artifacts and superseded ones

| Artifact | SHA-256 | Bytes |
| :--- | :--- | ---: |
| `highs.js` (ES module glue) | `52e09bb470bd7eb388df891d1910477b32c24ba5820aceb9df5bade5ef7c6a7e` | 65,744 |
| `highs.wasm` | `e035d2aa6b6426511c4231604a79fc87bf0eeb1675eddf12580e639daecaa2ed` | 3,595,678 |

Superseded (do not restore; `tests/native/artifacts.test.ts` fails if they reappear):

| Artifact | SHA-256 | Provenance |
| :--- | :--- | :--- |
| legacy `highs.wasm` (`public/` and `vendor/`) | `57e4abcb4b9e96370ae9e5b9fa1e4a88af23a13e34bd361228f6af0bd76bb20d` | A custom highs-js 1.8.0 build with `INITIAL_MEMORY=64MB`, `ALLOW_TABLE_GROWTH`, `STACK_SIZE=8MB`; built from a local checkout with no recorded commit, toolchain or HiGHS version; 12 C API exports, no info getters |
| legacy `highs.js` as committed (LF) | `30ee42a1e6d090aa61f656cfaedd073c3d03c83fa975815ea4e647f293ab4903` | highs-js CommonJS wrapper (pretty-text parser) |
| legacy `highs.js` after a Windows `core.autocrlf` checkout | `48edecd6f80286614e9ae89e310a32c5febd25f41acd51964f5082e26336c1b1` | the same file with CRLF line endings: the hash a working tree showed. `frontend/.gitattributes` now marks the artifacts `-text` |
| npm `highs@1.8.0` `build/highs.js`, `build/highs.wasm` | `e8725005171b3dd3dd7888fc417297f8ec671861c507805d504c857efe56ef0c`, `1e38c12d46fb759c9c332ee13703d70be8d4b2e2beb13796372e9ac4b63da355` | stock package; still installed for legacy scripts and benchmark readers until Phase 2.6 / 2.9 remove them, never loaded by `src/` |

## Reproducibility

The build was run twice from clean, concurrently, in two different absolute directories (`~/tarkov-highs-build/work-a` and
`~/tarkov-highs-build/work-b-with-a-longer-path`), each with a fresh emsdk install, a fresh HiGHS clone and a full recompile.
`highs.js` and `highs.wasm` (and the manifest) came out **byte-identical**. An earlier build in a third directory, with the same
inputs, produced the same two hashes. Reproducibility depends on: pinned commits, pinned `core.abbrev` for the stamped githash,
`-ffile-prefix-map` for the build root, `SOURCE_DATE_EPOCH` from the HiGHS commit, `EM_CACHE` inside the build root (so nothing is ever
written outside it), and `LC_ALL=C TZ=UTC`.
WebAssembly arithmetic is IEEE-754 binary64 without fused operations, so the same model gives the same answer in Node and in every browser.

## Rebuild

```bash
# on a Linux host with git, cmake, ninja, python3, curl, xz (about 10 minutes on 16 cores, about 2.2 GB of disk)
scp -r frontend/vendor/highs/build host:src
ssh host 'HIGHS_BUILD_ROOT=$HOME/highs-build bash src/build.sh --clean'
scp 'host:highs-build/out/*' /tmp/highs-out/
node frontend/vendor/highs/build/install-artifacts.mjs /tmp/highs-out     # verifies SHA-256, installs, regenerates manifestData.ts
cd frontend && npx tsx --test "tests/native/*.test.ts"
```

Changing any pin, flag or glue file changes the manifest's `glueSources` hashes, so the committed artifacts must be rebuilt and
re-installed in the same commit (`artifacts.test.ts` enforces it). `HIGHS_KEEP_OBJECTS=1` skips the clean compile for experiments only.

## Runtime verification

`loadHighs()` (`src/solver/native/loadHighs.ts`) fetches `highs.js` and `highs.wasm` (browser: same origin under the Vite base; Node:
`public/`), checks **both SHA-256 hashes against the committed manifest before any of the code runs**, compiles the verified wasm bytes
itself and hands them to the glue (this build does not read a `wasmBinary` option), then validates the ABI: every exported function, the
version string and numeric version, the githash (and that it prefixes the pinned commit), `HighsInt` is 4 bytes, `Highs_getInfinity()` is
`Infinity`, every entry of the typed option table exists with its declared type, and a known-answer solve returns the exact double
`3.123456789012`. Any mismatch is a `HighsAbiError`; an unreadable file is a `HighsLoadError`. There is no fallback to the stock package or
any other HiGHS. It was exercised in Node, and in Chromium from the Vite dev server and from a production bundle under a non-root base
path, on the main thread and in a module worker.

## Things to know about the model text (found while building this)

* **Filtering.** HiGHS drops a constraint-matrix entry with magnitude at most `small_matrix_value` (default `1e-9`; range `[1e-12, inf)`) and
  fails the read for one at least `large_matrix_value` (default `1e15`); bounds at or above `infinite_bound` (`1e20`) become infinite. The
  read returns a *warning* for a dropped entry and says so only in the log (`NativeResult.readMessages`). Setting the options moves the
  thresholds; it does not prove an arbitrary coefficient survives. Use `readbackModel` + `compareReadback`, which report every missing,
  extra and changed coefficient, objective entry, bound and integrality marker and name the filter that explains it. Unlike the legacy 1.8
  artifact, this build keeps a `5e-10` objective coefficient; a `5e-10` matrix coefficient is dropped under the default setting and kept
  under `small_matrix_value: 1e-12`.
* **The LP reader is lenient.** Text before the first section keyword is ignored (a garbage file reads as an empty model, status
  `ModelEmpty`); `Maximise` is not a keyword; `x_-1` is read as the column `x_` followed by the number `-1`. The legacy model writer emitted
  `x_-1` 106 times in the AK-74 model, so HiGHS solved a different model than the one written. `parseLpText` (an independent strict parser)
  rejects all of these.
* **Time limit.** `time_limit` runs on HiGHS's clock, which starts when the handle is created, so it includes reading the model.
* **MIP bound.** `mip_dual_bound` is in the objective's own sense (an upper bound for a maximization); `mip_gap` is a fraction, not a percent.
* **`mip_max_improving_sols=1`** stops with model status `SolutionLimit` (16), distinct from `Optimal` (7) and `TimeLimit` (13), and returns
  the incumbent and the proven dual bound. HiGHS returns run status `Warning` for every limit stop.
