#!/usr/bin/env python3
"""Write highs-build-manifest.json (to stdout) for a finished build. Called by build.sh, which exports the HB_* variables.

Layout (schema 1):
  inputs     what the build was pinned to (deterministic)
  build      flags and the exported function list (deterministic)
  toolchain  tool versions that produced the artifacts
  artifacts  SHA-256 and size of highs.js / highs.wasm, plus the sources of the glue we own
  runtime    what the produced module reports about itself (version string, githash, HighsInt size)
  host       the machine it was built on
  builtAt    wall-clock build time (the only field that differs between two identical builds)
"""
import hashlib
import json
import os
import platform
import subprocess
import sys
import time

E = os.environ


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(*cmd):
    return subprocess.run(cmd, capture_output=True, text=True, check=False).stdout.strip()


out = E["HB_OUT"]
script_dir = E["HB_SCRIPT_DIR"]
smoke = json.load(open(os.path.join(out, "runtime-smoke.json")))

# The module must export exactly the requested C API functions: no more (surface we did not review), no fewer.
requested = sorted(E["HB_EXPORTED_FUNCTIONS"].split())
if sorted(smoke["moduleFunctionExports"]) != requested:
    sys.exit(
        "exported function set differs from the request: extra=%s missing=%s"
        % (
            sorted(set(smoke["moduleFunctionExports"]) - set(requested)),
            sorted(set(requested) - set(smoke["moduleFunctionExports"])),
        )
    )

# emsdk downloads (kept because build.sh sets EMSDK_KEEP_DOWNLOADS=1): record the archive hashes so a swapped toolchain
# download is visible.
emsdk_dir = E["HB_EMSDK_DIR"]
downloads = {}
archive_dir = os.path.join(emsdk_dir, "downloads")
if os.path.isdir(archive_dir):
    for name in sorted(os.listdir(archive_dir)):
        p = os.path.join(archive_dir, name)
        if os.path.isfile(p):
            downloads[name] = {"sha256": sha256_file(p), "bytes": os.path.getsize(p)}
releases_tag = ""
try:
    tags = json.load(open(os.path.join(emsdk_dir, "emscripten-releases-tags.json")))
    releases_tag = tags["releases"].get(E["HB_EMSCRIPTEN_VERSION"], "")
except Exception:  # noqa: BLE001 - provenance is best effort, the pinned commit is what matters
    pass

os_release = {}
try:
    for line in open("/etc/os-release"):
        if "=" in line:
            k, v = line.rstrip("\n").split("=", 1)
            os_release[k] = v.strip('"')
except OSError:
    pass

manifest = {
    "schema": 1,
    "inputs": {
        "emsdk": {"repo": E["HB_EMSDK_REPO"], "tag": E["HB_EMSDK_TAG"], "commit": E["HB_EMSDK_COMMIT"]},
        "emscripten": {"version": E["HB_EMSCRIPTEN_VERSION"], "emscriptenReleasesHash": releases_tag},
        "highs": {
            "repo": E["HB_HIGHS_REPO"],
            "tag": E["HB_HIGHS_TAG"],
            "commit": E["HB_HIGHS_COMMIT"],
            "version": E["HB_HIGHS_VERSION"],
            "hConfigGithash": E["HB_HIGHS_GITHASH_STAMP"],
        },
        "sourceDateEpoch": int(E["HB_SOURCE_DATE_EPOCH"]),
        "glueSources": {
            name: sha256_file(os.path.join(script_dir, name))
            for name in ("build.sh", "smoke.mjs", "make_manifest.py")
        },
    },
    "build": {
        "cmakeArgs": E["HB_CMAKE_ARGS"].split(),
        "compileFlags": E["HB_COMPILE_FLAGS"].split(),
        "compileCommandSample": E["HB_COMPILE_SAMPLE"],
        "linkFlags": E["HB_LINK_FLAGS"].split(),
        "exportedFunctions": E["HB_EXPORTED_FUNCTIONS"].split(),
        "exportedRuntimeMethods": E["HB_EXPORTED_RUNTIME_METHODS"].split(),
        # wasm-level export names are minified by emcc -O3; the JS-visible list above is the checked one.
        "wasmExportCount": len(smoke["wasmExports"]),
    },
    "toolchain": {
        "emcc": E["HB_EMCC_VERSION"],
        "clang": E["HB_CLANG_VERSION"],
        "emsdkNode": E["HB_NODE_VERSION"],
        "cmake": E["HB_CMAKE_VERSION"],
        "ninja": E["HB_NINJA_VERSION"],
        "python": E["HB_PYTHON_VERSION"],
        "emsdkDownloads": downloads,
    },
    "artifacts": {
        "highs.js": smoke["artifacts"]["highs.js"],
        "highs.wasm": smoke["artifacts"]["highs.wasm"],
    },
    "runtime": {
        "highsVersion": smoke["runtime"]["highsVersion"],
        "githash": smoke["runtime"]["githash"],
        "sizeofHighsInt": smoke["runtime"]["sizeofHighsInt"],
        "smoke": smoke["runtime"]["smoke"],
    },
    "host": {
        "uname": " ".join(p for p in platform.uname() if p),
        "distro": os_release.get("PRETTY_NAME", ""),
        "cpuCount": os.cpu_count(),
    },
    "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}

json.dump(manifest, sys.stdout, indent=2, sort_keys=False)
sys.stdout.write("\n")
