#!/usr/bin/env bash
# Reproducible build of the pinned native HiGHS WebAssembly artifact (ADR 0013 section 4B, ADR 0010 section 5).
#
#   HIGHS_BUILD_ROOT=$HOME/tarkov-highs-build/work bash build.sh [--clean]
#
# Inputs are pinned by commit hash below: the Emscripten SDK (official emscripten-core/emsdk), HiGHS (official
# ERGO-Code/HiGHS) and the glue sources in this directory (smoke.mjs, make_manifest.py, this script). Nothing is taken from
# highs-js or from the npm `highs` package: HiGHS's own C API is compiled to a static library and linked straight into an
# ES module whose EXPORTED_FUNCTIONS is exactly the list below. The JavaScript wrapper is ours (src/solver/native).
#
# Outputs, in $HIGHS_BUILD_ROOT/out: highs.js, highs.wasm, highs-build-manifest.json (and runtime-smoke.json, the smoke test's
# report that the manifest embeds). Everything the script writes lives under $HIGHS_BUILD_ROOT: sources, toolchain, Emscripten
# cache and objects. Host requirements: git, cmake >= 3.16, ninja, python3, curl, xz, tar, network access to GitHub and Google's
# emscripten-releases storage.
set -euo pipefail

# ---------------------------------------------------------------------------------------------------------------------
# Pinned inputs
# ---------------------------------------------------------------------------------------------------------------------
# Emscripten SDK 6.0.11: the newest tagged emsdk release at the time of the pin (2026-10-04). A new SDK is a deliberate
# change: bump the tag and the commit together, rebuild, and commit the new artifacts and manifest.
EMSDK_REPO="https://github.com/emscripten-core/emsdk.git"
EMSDK_TAG="6.0.11"
EMSDK_COMMIT="dd8e25632640cfc1fb570c7fa4cc374e8a5e5a72"
EMSCRIPTEN_VERSION="6.0.11"

# HiGHS v1.15.1: the newest tagged release of ERGO-Code/HiGHS at the time of the pin (v1.15.0 -> v1.15.1 are patch
# releases of the 1.15 line; master is not a release). Its githash is reported at runtime as the first 12 hex digits.
HIGHS_REPO="https://github.com/ERGO-Code/HiGHS.git"
HIGHS_TAG="v1.15.1"
HIGHS_COMMIT="04024d701f79feb8e2f18bc3df0dffc04ef05088"
HIGHS_GITHASH_ABBREV=12

# The C API functions the wrapper uses (and nothing else). _malloc/_free are the only non-HiGHS exports: the wrapper
# marshals model arrays through the wasm heap.
EXPORTED_FUNCTIONS=(
  _malloc _free
  _Highs_create _Highs_destroy
  _Highs_version _Highs_versionMajor _Highs_versionMinor _Highs_versionPatch _Highs_githash
  _Highs_getSizeofHighsInt _Highs_getInfinity
  _Highs_readModel
  _Highs_getNumCol _Highs_getNumRow _Highs_getNumNz
  _Highs_getLp _Highs_getColName _Highs_getRowName
  _Highs_setBoolOptionValue _Highs_setIntOptionValue _Highs_setDoubleOptionValue _Highs_setStringOptionValue
  _Highs_getOptionType
  _Highs_getBoolOptionValue _Highs_getIntOptionValue _Highs_getDoubleOptionValue _Highs_getStringOptionValue
  _Highs_run
  _Highs_getModelStatus _Highs_getObjectiveValue _Highs_getSolution
  _Highs_getIntInfoValue _Highs_getDoubleInfoValue _Highs_getInt64InfoValue
  _Highs_getRunTime
)
EXPORTED_RUNTIME_METHODS=(FS wasmMemory UTF8ToString stringToUTF8 lengthBytesUTF8)

# CMake (compile) flags. -fwasm-exceptions: HiGHS catches std::invalid_argument around the LP parser and std::bad_alloc
# around allocation; with exceptions disabled both would abort the module instead of returning an error status. The legacy
# (try/catch opcode) flavour is pinned explicitly: it runs in every browser that runs wasm exceptions at all (Safari 15.2+),
# while the exnref flavour needs Safari 18.4+ / Chrome 137+ / Firefox 131+.
HIGHS_CMAKE_ARGS=(
  -DCMAKE_BUILD_TYPE=Release
  -DBUILD_SHARED_LIBS=OFF
  -DBUILD_CXX_EXE=OFF
  -DBUILD_TESTING=OFF
  -DBUILD_EXAMPLES=OFF
  -DBUILD_SHARED_EXTRAS_LIB=OFF
  -DFAST_BUILD=ON
  -DZLIB=OFF
  -DHIPO=OFF
  -DHIGHS_NO_DEFAULT_THREADS=ON
)
WASM_COMPILE_FLAGS="-O3 -DNDEBUG -fwasm-exceptions"
# Link flags. ALLOW_MEMORY_GROWTH with a 64 MiB start (the legacy artifact's value) and a 4 GiB ceiling, and an 8 MiB stack.
WASM_LINK_FLAGS=(
  -O3 -fwasm-exceptions -sWASM_LEGACY_EXCEPTIONS=1 --no-entry
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createHighsModule
  -sENVIRONMENT=web,worker,node
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=67108864 -sMAXIMUM_MEMORY=4294967296 -sSTACK_SIZE=8388608
  -sFORCE_FILESYSTEM=1 -sASSERTIONS=0 -sEXIT_RUNTIME=0
)

# ---------------------------------------------------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${HIGHS_BUILD_ROOT:-$SCRIPT_DIR/work}"
case "$WORK" in /*) ;; *) WORK="$PWD/$WORK" ;; esac
JOBS="${HIGHS_BUILD_JOBS:-$(nproc)}"
SRC="$WORK/src"; BUILD="$WORK/build"; OUT="$WORK/out"; EMSDK_DIR="$WORK/emsdk"; HIGHS_DIR="$SRC/HiGHS"

if [[ "${1:-}" == "--clean" ]]; then
  echo ">> clean: removing $WORK"
  rm -rf "$WORK"
fi
mkdir -p "$WORK" "$SRC" "$BUILD" "$OUT"

# Deterministic tool environment. EM_CACHE keeps Emscripten's compiled system libraries inside the build root.
export LC_ALL=C TZ=UTC
export EM_CACHE="$WORK/em_cache"
export EMSDK_QUIET=1 EMSDK_KEEP_DOWNLOADS=1
export CMAKE_GENERATOR=Ninja

log() { echo ">> $*"; }
need() { command -v "$1" >/dev/null || { echo "missing host tool: $1" >&2; exit 1; }; }
for t in git cmake ninja python3 curl xz tar; do need "$t"; done

# fetch_pinned <repo> <commit> <dir>: shallow-fetch exactly one commit and verify HEAD.
fetch_pinned() {
  local repo="$1" commit="$2" dir="$3"
  if [[ -d "$dir/.git" ]] && [[ "$(git -C "$dir" rev-parse HEAD 2>/dev/null)" == "$commit" ]]; then
    log "$dir already at $commit"
    return
  fi
  rm -rf "$dir"; mkdir -p "$dir"
  git -C "$dir" init -q
  git -C "$dir" remote add origin "$repo"
  git -C "$dir" fetch -q --depth 1 origin "$commit"
  git -C "$dir" checkout -q --detach FETCH_HEAD
  local got; got="$(git -C "$dir" rev-parse HEAD)"
  [[ "$got" == "$commit" ]] || { echo "pinned commit mismatch for $repo: wanted $commit got $got" >&2; exit 1; }
}

# ---------------------------------------------------------------------------------------------------------------------
# 1. Emscripten SDK
# ---------------------------------------------------------------------------------------------------------------------
log "emsdk $EMSDK_TAG ($EMSDK_COMMIT)"
fetch_pinned "$EMSDK_REPO" "$EMSDK_COMMIT" "$EMSDK_DIR"
if [[ ! -f "$EMSDK_DIR/.tarkov-installed-$EMSCRIPTEN_VERSION" ]]; then
  (cd "$EMSDK_DIR" && ./emsdk install "$EMSCRIPTEN_VERSION" && ./emsdk activate "$EMSCRIPTEN_VERSION")
  touch "$EMSDK_DIR/.tarkov-installed-$EMSCRIPTEN_VERSION"
fi
# shellcheck disable=SC1091
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null
EMCC_VERSION_LINE="$(emcc --version | head -n1)"
[[ "$EMCC_VERSION_LINE" == *"$EMSCRIPTEN_VERSION"* ]] || { echo "unexpected emcc: $EMCC_VERSION_LINE" >&2; exit 1; }
CLANG_BIN="$EMSDK_DIR/upstream/bin/clang"
CLANG_VERSION_LINE="$("$CLANG_BIN" --version | head -n1)"
EM_NODE="${EMSDK_NODE:-$(command -v node || true)}"
[[ -x "$EM_NODE" ]] || { echo "no node binary from emsdk" >&2; exit 1; }
log "emcc: $EMCC_VERSION_LINE"
log "clang: $CLANG_VERSION_LINE"
log "node (emsdk): $("$EM_NODE" --version)"

# ---------------------------------------------------------------------------------------------------------------------
# 2. HiGHS
# ---------------------------------------------------------------------------------------------------------------------
log "HiGHS $HIGHS_TAG ($HIGHS_COMMIT)"
fetch_pinned "$HIGHS_REPO" "$HIGHS_COMMIT" "$HIGHS_DIR"
# HiGHS stamps `git describe --always` into HConfig.h (HIGHS_GITHASH). Pin its abbreviation length so the stamp is the
# same on every machine.
git -C "$HIGHS_DIR" config core.abbrev "$HIGHS_GITHASH_ABBREV"
export SOURCE_DATE_EPOCH
SOURCE_DATE_EPOCH="$(git -C "$HIGHS_DIR" log -1 --format=%ct)"
HIGHS_VERSION="$(python3 - "$HIGHS_DIR/Version.txt" <<'PY'
import re, sys
t = dict(re.findall(r'^(HIGHS_\w+)=(\d+)', open(sys.argv[1]).read(), re.M))
print('%s.%s.%s' % (t['HIGHS_MAJOR'], t['HIGHS_MINOR'], t['HIGHS_PATCH']))
PY
)"
[[ "$HIGHS_TAG" == "v$HIGHS_VERSION" ]] || { echo "tag $HIGHS_TAG does not match Version.txt $HIGHS_VERSION" >&2; exit 1; }

# Path-independent output: strip the build root from __FILE__, debug info and diagnostics.
PREFIX_MAP="-ffile-prefix-map=$WORK=/tarkov-highs-build"
[[ -n "${HIGHS_KEEP_OBJECTS:-}" ]] || rm -rf "$BUILD/highs"   # HIGHS_KEEP_OBJECTS=1: developer shortcut, never for the committed artifacts
log "configure"
emcmake cmake -S "$HIGHS_DIR" -B "$BUILD/highs" "${HIGHS_CMAKE_ARGS[@]}" \
  -DCMAKE_C_FLAGS="$WASM_COMPILE_FLAGS $PREFIX_MAP" \
  -DCMAKE_CXX_FLAGS="$WASM_COMPILE_FLAGS $PREFIX_MAP" \
  -DCMAKE_C_FLAGS_RELEASE="" -DCMAKE_CXX_FLAGS_RELEASE="" \
  ${HIGHS_EXTRA_CMAKE_ARGS:-} 2>&1 | tee "$BUILD/configure.log" | tail -n 25
log "build libhighs.a (-j$JOBS)"
cmake --build "$BUILD/highs" --target highs -j "$JOBS" 2>&1 | tee "$BUILD/build.log" | tail -n 5
LIBHIGHS="$(find "$BUILD/highs" -name 'libhighs.a' | head -n1)"
[[ -f "$LIBHIGHS" ]] || { echo "libhighs.a not produced" >&2; exit 1; }
# HighsExternalApi.cpp links the (here empty, HiPO-less) built-in extras library statically.
LIBEXTRAS="$(find "$BUILD/highs" -name 'libhighs_extras.a' | head -n1)"
[[ -f "$LIBEXTRAS" ]] || { echo "libhighs_extras.a not produced" >&2; exit 1; }
# One representative compile command as ninja ran it: the effective flags after CMake added its own.
# (Written to a file first: `grep -m1` closing a pipe would SIGPIPE ninja and trip `set -o pipefail`.)
ninja -C "$BUILD/highs" -t commands highs > "$BUILD/commands.txt"
COMPILE_SAMPLE="$(grep -m1 'lp_data/Highs.cpp' "$BUILD/commands.txt" | sed "s#$WORK#<build-root>#g")"
HIGHS_GITHASH_STAMP="$(grep -h 'define HIGHS_GITHASH' "$BUILD/highs/HConfig.h" | sed 's/.*"\(.*\)".*/\1/')"
log "libhighs.a: $LIBHIGHS (HIGHS_GITHASH=$HIGHS_GITHASH_STAMP)"
[[ "$HIGHS_COMMIT" == "$HIGHS_GITHASH_STAMP"* ]] || { echo "HConfig githash $HIGHS_GITHASH_STAMP is not a prefix of $HIGHS_COMMIT" >&2; exit 1; }

# ---------------------------------------------------------------------------------------------------------------------
# 3. Link the ES module
# ---------------------------------------------------------------------------------------------------------------------
join_by_comma() { local IFS=,; echo "$*"; }
EXPORTED_FUNCTIONS_ARG="$(join_by_comma "${EXPORTED_FUNCTIONS[@]}")"
EXPORTED_RUNTIME_ARG="$(join_by_comma "${EXPORTED_RUNTIME_METHODS[@]}")"
rm -f "$OUT/highs.js" "$OUT/highs.wasm" "$OUT/highs-build-manifest.json"
log "link"
em++ "$LIBHIGHS" "$LIBEXTRAS" -o "$OUT/highs.js" "${WASM_LINK_FLAGS[@]}" $PREFIX_MAP \
  "-sEXPORTED_FUNCTIONS=$EXPORTED_FUNCTIONS_ARG" "-sEXPORTED_RUNTIME_METHODS=$EXPORTED_RUNTIME_ARG" 2>&1 | tail -n 20
[[ -f "$OUT/highs.js" && -f "$OUT/highs.wasm" ]] || { echo "link did not produce highs.js/highs.wasm" >&2; exit 1; }

# ---------------------------------------------------------------------------------------------------------------------
# 4. Runtime smoke test and manifest
# ---------------------------------------------------------------------------------------------------------------------
log "runtime smoke test"
"$EM_NODE" "$SCRIPT_DIR/smoke.mjs" "$OUT" > "$OUT/runtime-smoke.json"
cat "$OUT/runtime-smoke.json"

log "manifest"
export HB_EMSDK_TAG="$EMSDK_TAG" HB_EMSDK_COMMIT="$EMSDK_COMMIT" HB_EMSDK_REPO="$EMSDK_REPO" HB_EMSDK_DIR="$EMSDK_DIR"
export HB_EMSCRIPTEN_VERSION="$EMSCRIPTEN_VERSION" HB_EMCC_VERSION="$EMCC_VERSION_LINE" HB_CLANG_VERSION="$CLANG_VERSION_LINE"
export HB_NODE_VERSION="$("$EM_NODE" --version)"
export HB_HIGHS_TAG="$HIGHS_TAG" HB_HIGHS_COMMIT="$HIGHS_COMMIT" HB_HIGHS_REPO="$HIGHS_REPO" HB_HIGHS_VERSION="$HIGHS_VERSION"
export HB_HIGHS_GITHASH_STAMP="$HIGHS_GITHASH_STAMP" HB_SOURCE_DATE_EPOCH="$SOURCE_DATE_EPOCH"
export HB_CMAKE_VERSION="$(cmake --version | head -n1)" HB_NINJA_VERSION="$(ninja --version)" HB_PYTHON_VERSION="$(python3 --version)"
export HB_CMAKE_ARGS="${HIGHS_CMAKE_ARGS[*]} ${HIGHS_EXTRA_CMAKE_ARGS:-}"
export HB_COMPILE_SAMPLE="$COMPILE_SAMPLE"
export HB_COMPILE_FLAGS="$WASM_COMPILE_FLAGS" HB_LINK_FLAGS="${WASM_LINK_FLAGS[*]}"
export HB_EXPORTED_FUNCTIONS="${EXPORTED_FUNCTIONS[*]}" HB_EXPORTED_RUNTIME_METHODS="${EXPORTED_RUNTIME_METHODS[*]}"
export HB_SCRIPT_DIR="$SCRIPT_DIR" HB_OUT="$OUT" HB_BUILD_ROOT="$WORK" HB_LIBHIGHS="$LIBHIGHS"
python3 "$SCRIPT_DIR/make_manifest.py" > "$OUT/highs-build-manifest.json"

log "done"
sha256sum "$OUT/highs.js" "$OUT/highs.wasm" "$OUT/highs-build-manifest.json"
