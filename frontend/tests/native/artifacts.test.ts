// Provenance of the committed native HiGHS artifacts (ADR 0013 section 4B, GitHub #30): the files the browser loads, the vendored
// copies, the build manifest, the generated identity module and the build script must all agree, and nothing in src/ may fall
// back to another HiGHS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMITTED_HIGHS_BUILD } from '../../src/solver/native';
import { REQUIRED_MODULE_FUNCTIONS } from '../../src/solver/native/module';

const frontend = fileURLToPath(new URL('../../', import.meta.url));
const at = (...parts: string[]): string => join(frontend, ...parts);
const bytes = (path: string): Buffer => readFileSync(path);
const sha256 = (path: string): string => createHash('sha256').update(bytes(path)).digest('hex');

interface Manifest {
  schema: number;
  inputs: {
    emsdk: { repo: string; tag: string; commit: string };
    emscripten: { version: string };
    highs: { repo: string; tag: string; commit: string; version: string; hConfigGithash: string };
    glueSources: Record<string, string>;
  };
  build: { cmakeArgs: string[]; compileFlags: string[]; linkFlags: string[]; exportedFunctions: string[]; exportedRuntimeMethods: string[]; wasmExportCount: number };
  toolchain: { emcc: string; clang: string };
  artifacts: { 'highs.js': { sha256: string; bytes: number }; 'highs.wasm': { sha256: string; bytes: number } };
  runtime: { highsVersion: string; githash: string; sizeofHighsInt: number; smoke: { modelStatus: number; cols: number[]; malformedReadStatus: number } };
  host: { uname: string; distro: string };
  builtAt: string;
}

const manifest = JSON.parse(readFileSync(at('vendor/highs/highs-build-manifest.json'), 'utf8')) as Manifest;

/** Pinned values declared in build.sh (the single place they live). */
function pinned(name: string): string {
  const match = new RegExp(`^${name}="([^"]*)"`, 'm').exec(readFileSync(at('vendor/highs/build/build.sh'), 'utf8'));
  assert.ok(match, `build.sh declares ${name}`);
  return match[1];
}

test('public/ (what the browser loads) and vendor/highs/ hold byte-identical artifacts and manifest', () => {
  for (const name of ['highs.js', 'highs.wasm', 'highs-build-manifest.json']) {
    assert.equal(sha256(at('public', name)), sha256(at('vendor/highs', name)), `${name} differs between public/ and vendor/highs/`);
  }
});

test('the artifact bytes are the ones the manifest hashed', () => {
  for (const name of ['highs.js', 'highs.wasm'] as const) {
    assert.equal(sha256(at('public', name)), manifest.artifacts[name].sha256, name);
    assert.equal(bytes(at('public', name)).length, manifest.artifacts[name].bytes, `${name} size`);
  }
});

test('the generated identity module is exactly what the manifest says (install-artifacts.mjs output)', () => {
  assert.deepEqual(COMMITTED_HIGHS_BUILD, {
    schema: manifest.schema,
    highs: { tag: manifest.inputs.highs.tag, commit: manifest.inputs.highs.commit, version: manifest.inputs.highs.version, githash: manifest.runtime.githash },
    emscripten: { version: manifest.inputs.emscripten.version, emsdkCommit: manifest.inputs.emsdk.commit },
    sizeofHighsInt: manifest.runtime.sizeofHighsInt,
    exportedFunctions: manifest.build.exportedFunctions,
    exportedRuntimeMethods: manifest.build.exportedRuntimeMethods,
    artifacts: manifest.artifacts,
  });
});

test('the manifest records the pins declared in build.sh, and the glue sources it hashed are the committed ones', () => {
  assert.equal(manifest.inputs.emsdk.commit, pinned('EMSDK_COMMIT'));
  assert.equal(manifest.inputs.emsdk.tag, pinned('EMSDK_TAG'));
  assert.equal(manifest.inputs.emscripten.version, pinned('EMSCRIPTEN_VERSION'));
  assert.equal(manifest.inputs.highs.commit, pinned('HIGHS_COMMIT'));
  assert.equal(manifest.inputs.highs.tag, pinned('HIGHS_TAG'));
  assert.match(manifest.inputs.highs.commit, /^[0-9a-f]{40}$/);
  assert.match(manifest.inputs.emsdk.commit, /^[0-9a-f]{40}$/);
  for (const [name, digest] of Object.entries(manifest.inputs.glueSources)) {
    assert.equal(sha256(at('vendor/highs/build', name)), digest, `${name} was edited after the committed artifacts were built`);
  }
  assert.deepEqual(Object.keys(manifest.inputs.glueSources).sort(), ['build.sh', 'make_manifest.py', 'smoke.mjs']);
});

test('the build is the documented one: HiGHS version, githash prefix, tag, 32-bit HighsInt, exact smoke answer, flags', () => {
  assert.equal(manifest.inputs.highs.tag, `v${manifest.inputs.highs.version}`);
  assert.equal(manifest.runtime.highsVersion, manifest.inputs.highs.version);
  assert.ok(manifest.inputs.highs.commit.startsWith(manifest.runtime.githash));
  assert.equal(manifest.inputs.highs.hConfigGithash, manifest.runtime.githash);
  assert.equal(manifest.runtime.sizeofHighsInt, 4);
  assert.equal(manifest.runtime.smoke.modelStatus, 7);
  assert.equal(manifest.runtime.smoke.cols[0], 3.123456789012, 'the build returns exact primals');
  assert.equal(manifest.runtime.smoke.malformedReadStatus, -1, 'C++ exceptions are enabled: a malformed LP is an error status, not an abort');
  for (const flag of ['-sALLOW_MEMORY_GROWTH=1', '-sSTACK_SIZE=8388608', '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-fwasm-exceptions', '-sWASM_LEGACY_EXCEPTIONS=1']) {
    assert.ok(manifest.build.linkFlags.includes(flag), `link flag ${flag}`);
  }
  assert.ok(manifest.build.cmakeArgs.includes('-DBUILD_SHARED_LIBS=OFF'));
  assert.ok(manifest.build.cmakeArgs.includes('-DHIGHS_NO_DEFAULT_THREADS=ON'));
  assert.match(manifest.toolchain.emcc, new RegExp(manifest.inputs.emscripten.version.replaceAll('.', '\\.')));
  assert.match(manifest.builtAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
});

test('the module exports exactly the C API functions the wrapper uses, and the committed wasm has the declared export count', async () => {
  assert.deepEqual([...REQUIRED_MODULE_FUNCTIONS].sort(), [...manifest.build.exportedFunctions].sort());
  const script = readFileSync(at('vendor/highs/build/build.sh'), 'utf8');
  const listed = /EXPORTED_FUNCTIONS=\(([^)]*)\)/.exec(script)![1].split(/\s+/).filter(Boolean);
  assert.deepEqual(listed, manifest.build.exportedFunctions);
  assert.ok(manifest.build.exportedFunctions.every(n => n === '_malloc' || n === '_free' || n.startsWith('_Highs_')));
  const compiled = await WebAssembly.compile(new Uint8Array(bytes(at('public/highs.wasm'))));
  assert.equal(WebAssembly.Module.exports(compiled).length, manifest.build.wasmExportCount);
});

test('the glue is an ES module (not the CommonJS highs-js wrapper) and the wasm is not a superseded artifact', () => {
  const js = bytes(at('public/highs.js')).toString('utf8');
  assert.ok(js.trimEnd().endsWith('export default createHighsModule;'));
  assert.ok(!js.includes('module.exports'));
  const superseded = new Set([
    '57e4abcb4b9e96370ae9e5b9fa1e4a88af23a13e34bd361228f6af0bd76bb20d', // legacy custom highs.wasm (highs-js 1.8.0 build), == public and vendor
    '1e38c12d46fb759c9c332ee13703d70be8d4b2e2beb13796372e9ac4b63da355', // node_modules/highs/build/highs.wasm (stock npm package)
    '30ee42a1e6d090aa61f656cfaedd073c3d03c83fa975815ea4e647f293ab4903', // legacy highs.js as committed (LF)
    '48edecd6f80286614e9ae89e310a32c5febd25f41acd51964f5082e26336c1b1', // the same file after a Windows autocrlf checkout
  ]);
  for (const name of ['highs.js', 'highs.wasm']) assert.ok(!superseded.has(sha256(at('public', name))), `${name} is a superseded artifact`);
});

test('line endings of the hashed files are protected from checkout conversion', () => {
  const attributes = readFileSync(at('.gitattributes'), 'utf8');
  for (const line of ['public/highs.js -text', 'public/highs.wasm -text', 'public/highs-build-manifest.json -text', 'vendor/highs/** -text']) {
    assert.ok(attributes.split(/\r?\n/).includes(line), `.gitattributes lacks "${line}"`);
  }
  for (const name of ['build.sh', 'smoke.mjs', 'make_manifest.py']) {
    assert.ok(!bytes(at('vendor/highs/build', name)).includes(13), `${name} contains CR bytes`);
  }
});

/** All .ts/.tsx files below `dir`. */
function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...sources(path));
    else if (/\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

test('production src/ never imports node built-ins statically in the native surface, and nothing (src, tests, benchmarks) loads another HiGHS', () => {
  const nodeBuiltin = /^\s*(?:import|export)\b[^'"]*\bfrom\s+['"](?:node:[^'"]+|fs|path|url|module|crypto|os|child_process)['"]/m;
  for (const file of sources(at('src/solver/native'))) {
    assert.ok(!nodeBuiltin.test(readFileSync(file, 'utf8')), `${relative(frontend, file)} imports a node built-in statically`);
  }
  const anotherHighs = /(?:from\s+['"]highs['"]|import\(\s*['"]highs['"]\s*\)|require\(\s*['"]highs['"]\s*\)|node_modules\/highs)/;
  for (const file of sources(at('src'))) {
    const text = readFileSync(file, 'utf8');
    assert.ok(!/stock npm package|Fallback to stock/i.test(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), `${relative(frontend, file)} contains a stock fallback`);
  }
  assert.ok(existsSync(at('src/solver/native/loadHighs.ts')));
  // Phase 2.9: every test and benchmark goes through the pinned loader as well, and the npm package is not a dependency.
  for (const file of [...sources(at('src')), ...sources(at('tests')), ...sources(at('benchmarks'))]) {
    if (file === fileURLToPath(import.meta.url)) continue; // this file names the package as history (superseded hashes) and in the pattern
    assert.ok(!anotherHighs.test(readFileSync(file, 'utf8')), `${relative(frontend, file)} references the stock highs package`);
  }
  const pkg = JSON.parse(readFileSync(at('package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    assert.ok(!(pkg[field] !== undefined && 'highs' in pkg[field]), `package.json ${field} still lists the stock highs package`);
  }
});

test('solver.ts reaches HiGHS only through the native surface (no direct highs.solve, no silent catch around loading, no legacy shim)', () => {
  assert.ok(!existsSync(at('src/solver/native/legacy.ts')), 'the legacySolve shim was deleted in Phase 2.9');
  const solver = readFileSync(at('src/solver/solver.ts'), 'utf8');
  assert.ok(!/highs\.solve\(/.test(solver));
  assert.ok(!/loadHiGHS|HighsInstance|highsCorrupted/.test(solver));
  assert.ok(/from '\.\/native'/.test(solver));
  // Phase 2.4b-3b: the structured solve is the only way in; the deprecated legacy shim is gone (Phase 2.9) and nothing names it.
  const policy = readFileSync(at('src/solver/physical/nativeSolve.ts'), 'utf8');
  assert.ok(/solveStructured\(/.test(policy) && /from '\.\.\/native'/.test(policy));
  for (const file of sources(at('src'))) {
    assert.ok(!/legacySolve/.test(readFileSync(file, 'utf8')), `${relative(frontend, file)} still uses the deprecated legacySolve shim`);
  }
});
