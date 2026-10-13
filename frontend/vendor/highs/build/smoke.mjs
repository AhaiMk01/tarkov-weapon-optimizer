// Runtime smoke test for a freshly built highs.js / highs.wasm. Dependency-free (plain Node ES module) so it runs under the
// Node that ships with emsdk. Prints one JSON document on stdout (consumed by make_manifest.py) and exits non-zero on any
// failed check. The TypeScript loader in src/solver/native performs the same ABI checks against the committed manifest.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const out = process.argv[2];
if (!out) throw new Error('usage: smoke.mjs <out-dir>');
const wasmPath = join(out, 'highs.wasm');
const jsPath = join(out, 'highs.js');
const wasmBytes = readFileSync(wasmPath);
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

const wasmModule = await WebAssembly.compile(wasmBytes);
const wasmExports = WebAssembly.Module.exports(wasmModule).map((e) => `${e.kind}:${e.name}`).sort();

const { default: create } = await import(pathToFileURL(jsPath).href);
const lines = [];
// This build does not honour a `wasmBinary` option; the wrapper hands over a compiled module through instantiateWasm.
const mod = await create({
  instantiateWasm: (imports, receive) => {
    WebAssembly.instantiate(wasmModule, imports).then((instance) => receive(instance, wasmModule));
    return {};
  },
  print: (s) => lines.push(s),
  printErr: (s) => lines.push(s),
});

const cstr = (p) => mod.UTF8ToString(p);
const allocString = (s) => {
  const n = mod.lengthBytesUTF8(s) + 1;
  const p = mod._malloc(n);
  mod.stringToUTF8(s, p, n);
  return p;
};
const f64 = (p) => new Float64Array(mod.wasmMemory.buffer, p, 1)[0];
const i32 = (p) => new Int32Array(mod.wasmMemory.buffer, p, 1)[0];

const info = {
  highsVersion: cstr(mod._Highs_version()),
  versionMajor: mod._Highs_versionMajor(),
  versionMinor: mod._Highs_versionMinor(),
  versionPatch: mod._Highs_versionPatch(),
  githash: cstr(mod._Highs_githash()),
  sizeofHighsInt: mod._Highs_getSizeofHighsInt(0),
};
const h = mod._Highs_create();
info.infinity = String(mod._Highs_getInfinity(h));

// LP: maximize x + y  s.t.  x + 2y <= 4, 0 <= x <= 3.123456789012  (optimum 3.561728394506 at x=3.123456789012)
const lp = 'Maximize\n obj: x + y\nSubject To\n c1: x + 2 y <= 4\nBounds\n 0 <= x <= 3.123456789012\nEnd\n';
mod.FS.writeFile('/smoke.lp', lp);
const fp = allocString('/smoke.lp');
const optOutput = allocString('output_flag');
const optLog = allocString('log_to_console');
mod._Highs_setBoolOptionValue(h, optOutput, 0);
mod._Highs_setBoolOptionValue(h, optLog, 0);
const readStatus = mod._Highs_readModel(h, fp);
const runStatus = mod._Highs_run(h);
const modelStatus = mod._Highs_getModelStatus(h);
const numCol = mod._Highs_getNumCol(h);
const colPtr = mod._malloc(8 * numCol);
mod._Highs_getSolution(h, colPtr, 0, 0, 0);
const cols = Array.from(new Float64Array(mod.wasmMemory.buffer, colPtr, numCol));
info.smoke = { readStatus, runStatus, modelStatus, numCol, objective: mod._Highs_getObjectiveValue(h), cols };
mod._Highs_destroy(h);

// A malformed LP must come back as an error status (C++ exceptions are enabled), not abort the module.
const h2 = mod._Highs_create();
mod._Highs_setBoolOptionValue(h2, optOutput, 0);
mod._Highs_setBoolOptionValue(h2, optLog, 0);
mod.FS.writeFile('/bad.lp', 'Maximize\n obj: x +\nSubject To\n c1: x <= <= 4\nEnd\n');
const badStatus = mod._Highs_readModel(h2, allocString('/bad.lp'));
info.smoke.malformedReadStatus = badStatus;
mod._Highs_destroy(h2);

check(info.sizeofHighsInt === 4, `HighsInt must be 32-bit, got ${info.sizeofHighsInt} bytes`);
check(info.highsVersion === `${info.versionMajor}.${info.versionMinor}.${info.versionPatch}`, 'version string disagrees with version numbers');
check(readStatus === 0, `readModel status ${readStatus}`);
check(runStatus === 0, `run status ${runStatus}`);
check(modelStatus === 7, `model status ${modelStatus} (expected 7 = Optimal)`);
check(cols[0] === 3.123456789012, `x = ${cols[0]} is not the exact double 3.123456789012`);
check(Math.abs(info.smoke.objective - 3.561728394506) < 1e-12, `objective ${info.smoke.objective}`);
check(badStatus === -1, `malformed LP read status ${badStatus} (expected -1 = error)`);

const exported = Object.keys(mod).filter((k) => k.startsWith('_') && typeof mod[k] === 'function').sort();
const result = {
  schema: 1,
  artifacts: {
    'highs.js': { sha256: sha256(readFileSync(jsPath)), bytes: readFileSync(jsPath).length },
    'highs.wasm': { sha256: sha256(wasmBytes), bytes: wasmBytes.length },
  },
  runtime: info,
  wasmExports,
  moduleFunctionExports: exported,
  nodeVersion: process.version,
  failures,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length) {
  process.stderr.write(`SMOKE FAILED:\n${failures.join('\n')}\n`);
  process.exit(1);
}
