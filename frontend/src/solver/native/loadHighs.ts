/**
 * Loader for the pinned native HiGHS build (vendor/highs/build).
 *
 * `loadHighs()` fetches (browser: same-origin URLs under the Vite base; Node: files under `public/`) the two artifacts,
 * hashes both against the committed identity BEFORE running any of their code, instantiates the module, and then validates
 * the ABI of what actually came up: exported functions, version string, githash (a prefix of the pinned commit), HighsInt
 * width, the typed option table, and a known-answer solve. Any mismatch is a `HighsAbiError`; a missing or unreadable file
 * is a `HighsLoadError`. There is no fallback to another HiGHS: a stock npm build or a stale cached copy fails here.
 *
 * Production `src/` must not import `node:*` statically (the bundle also runs in the browser), so the Node modules are
 * reached through dynamic imports whose specifier the bundler cannot see.
 */

import { COMMITTED_HIGHS_BUILD } from './manifestData';
import type { HighsBuildIdentity } from './manifestTypes';
import { HighsAbiError, HighsLoadError } from './errors';
import type { HighsModuleFactory, HighsWasmModule } from './module';
import { HeapScope, REQUIRED_MODULE_FUNCTIONS, REQUIRED_RUNTIME_MEMBERS, copyF64 } from './module';
import { applyOptions, checkOptionTable } from './options';
import { sha256Hex } from './sha256';

export interface LoadHighsConfig {
  /**
   * Where `highs.js` and `highs.wasm` live. Browser: a URL (absolute, or relative to the page) of the directory, with or
   * without the trailing slash. Node: a directory path. Defaults to the configured base URL in the browser and to
   * `<frontend>/public` in Node.
   */
  location?: string;
  /** wasm bytes supplied by the caller (tests, embedders). They are hashed exactly like fetched ones. */
  wasmBytes?: Uint8Array;
  /** The identity to validate against. Defaults to the committed build. */
  expected?: HighsBuildIdentity;
}

/** What the loaded build reported about itself. */
export interface LoadedIdentity {
  highsVersion: string;
  githash: string;
  sizeofHighsInt: number;
  jsSha256: string;
  wasmSha256: string;
}

/** One instantiated, ABI-validated wasm instance. Solves create and destroy their own HiGHS handles on it. */
export interface HighsRuntime {
  /** Monotonic instance number (a re-instantiation after corruption gets a new one). */
  readonly id: number;
  readonly module: HighsWasmModule;
  readonly identity: LoadedIdentity;
  /** Lines the module printed (HiGHS log output when logging is on). Cleared by whoever reads it. */
  readonly printed: string[];
}

let nextRuntimeId = 1;
let defaultBaseUrl = '/';

/** Browser default location: `import.meta.env.BASE_URL`, supplied by the app (the bundler only rewrites it in app code). */
export function setHighsBaseUrl(baseUrl: string): void {
  defaultBaseUrl = baseUrl;
}

type NodeGlobals = {
  process?: { versions?: { node?: string } };
  window?: unknown;
  WorkerGlobalScope?: unknown;
};

function isNode(): boolean {
  const g = globalThis as NodeGlobals;
  return typeof g.process?.versions?.node === 'string' && g.window === undefined && g.WorkerGlobalScope === undefined;
}

/** Dynamic import the bundler must not follow (Node built-ins and file URLs only exist at runtime in Node). */
function dynamicImport(specifier: string): Promise<unknown> {
  return import(/* @vite-ignore */ specifier);
}

// The few Node APIs used, declared locally: the browser tsconfig has no Node types.
interface NodeFsPromises { readFile(path: string): Promise<Uint8Array> }
interface NodePath { resolve(...parts: string[]): string; dirname(path: string): string; join(...parts: string[]): string }
interface NodeUrl { fileURLToPath(url: string): string; pathToFileURL(path: string): { href: string } }

async function readArtifactsNode(config: LoadHighsConfig): Promise<{ js: Uint8Array; wasm: Uint8Array; jsUrl: string }> {
  const fs = (await dynamicImport('node:fs/promises')) as NodeFsPromises;
  const path = (await dynamicImport('node:path')) as NodePath;
  const url = (await dynamicImport('node:url')) as NodeUrl;
  const here = import.meta.url;
  const relativePublic = '../../../public';
  const dir = config.location ?? path.resolve(path.dirname(url.fileURLToPath(here)), relativePublic);
  const jsPath = path.join(dir, 'highs.js');
  const wasmPath = path.join(dir, 'highs.wasm');
  try {
    const [js, wasm] = await Promise.all([fs.readFile(jsPath), config.wasmBytes ?? fs.readFile(wasmPath)]);
    return { js: new Uint8Array(js), wasm: new Uint8Array(wasm), jsUrl: url.pathToFileURL(jsPath).href };
  } catch (error) {
    throw new HighsLoadError(`cannot read the HiGHS artifacts from ${dir}`, { cause: error });
  }
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'same-origin' });
  } catch (error) {
    throw new HighsLoadError(`cannot fetch ${url}`, { cause: error });
  }
  if (!response.ok) throw new HighsLoadError(`cannot fetch ${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function readArtifactsBrowser(config: LoadHighsConfig): Promise<{ js: Uint8Array; wasm: Uint8Array }> {
  const base = config.location ?? defaultBaseUrl;
  const dir = base.endsWith('/') ? base : `${base}/`;
  const [js, wasm] = await Promise.all([fetchBytes(`${dir}highs.js`), config.wasmBytes ?? fetchBytes(`${dir}highs.wasm`)]);
  return { js, wasm };
}

/** Import the (already hash-verified) glue as an ES module. */
async function importGlue(js: Uint8Array, nodeFileUrl: string | undefined): Promise<HighsModuleFactory> {
  let namespace: { default?: unknown };
  try {
    if (nodeFileUrl !== undefined) {
      // Emscripten's Node path derives its script directory from import.meta.url, which must be a file: URL.
      namespace = (await dynamicImport(nodeFileUrl)) as { default?: unknown };
    } else {
      const exact = js.buffer.slice(js.byteOffset, js.byteOffset + js.byteLength) as ArrayBuffer;
      const blobUrl = URL.createObjectURL(new Blob([exact], { type: 'text/javascript' }));
      try {
        namespace = (await dynamicImport(blobUrl)) as { default?: unknown };
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    }
  } catch (error) {
    throw new HighsLoadError('the HiGHS glue module failed to load', { cause: error });
  }
  if (typeof namespace.default !== 'function') throw new HighsLoadError('highs.js has no default export (not the pinned ES module build)');
  return namespace.default as HighsModuleFactory;
}

const CANARY_LP = 'Maximize\n obj: x + y\nSubject To\n c1: x + 2 y <= 4\nBounds\n 0 <= x <= 3.123456789012\nEnd\n';
const CANARY_X = 3.123456789012;
const CANARY_OBJECTIVE = 3.561728394506;

/** Known-answer solve: proves the instance parses LP text, solves, and returns full-precision primals. */
function canarySolve(module: HighsWasmModule, handle: number, problems: string[]): void {
  const heap = new HeapScope(module);
  const path = '/abi-canary.lp';
  try {
    applyOptions(module, handle, { output_flag: false, log_to_console: false, threads: 1 });
    module.FS.writeFile(path, CANARY_LP);
    const readStatus = module._Highs_readModel(handle, heap.string(path));
    if (readStatus !== 0) problems.push(`canary model read returned status ${readStatus}`);
    const runStatus = module._Highs_run(handle);
    const modelStatus = module._Highs_getModelStatus(handle);
    const numCol = module._Highs_getNumCol(handle);
    if (runStatus !== 0 || modelStatus !== 7 || numCol !== 2) {
      problems.push(`canary solve returned run status ${runStatus}, model status ${modelStatus}, ${numCol} columns (expected 0, 7, 2)`);
      return;
    }
    const cols = heap.f64Array(numCol);
    module._Highs_getSolution(handle, cols, 0, 0, 0);
    const x = copyF64(module, cols, numCol)[0];
    if (x !== CANARY_X) problems.push(`canary primal is ${x}, not the exact double ${CANARY_X}`);
    const objective = module._Highs_getObjectiveValue(handle);
    if (Math.abs(objective - CANARY_OBJECTIVE) > 1e-12) problems.push(`canary objective is ${objective}, expected ${CANARY_OBJECTIVE}`);
  } finally {
    try { module.FS.unlink(path); } catch { /* file may not exist if writeFile failed */ }
    heap.free();
  }
}

/** Every ABI check against `expected`. Returns the problems found; empty means the instance is the pinned build. */
export function validateRuntime(
  module: HighsWasmModule, expected: HighsBuildIdentity, hashes: { js: string; wasm: string },
): { problems: string[]; identity: LoadedIdentity } {
  const problems: string[] = [];
  const anyModule = module as unknown as Record<string, unknown>;

  if (hashes.js !== expected.artifacts['highs.js'].sha256) {
    problems.push(`highs.js SHA-256 ${hashes.js} is not the committed ${expected.artifacts['highs.js'].sha256}`);
  }
  if (hashes.wasm !== expected.artifacts['highs.wasm'].sha256) {
    problems.push(`highs.wasm SHA-256 ${hashes.wasm} is not the committed ${expected.artifacts['highs.wasm'].sha256}`);
  }

  for (const name of expected.exportedFunctions) {
    if (typeof anyModule[name] !== 'function') problems.push(`missing exported function ${name}`);
  }
  for (const name of REQUIRED_MODULE_FUNCTIONS) {
    if (!expected.exportedFunctions.includes(name)) problems.push(`the wrapper needs ${name}, which the committed manifest does not export`);
    else if (typeof anyModule[name] !== 'function') problems.push(`missing exported function ${name}`);
  }
  for (const name of REQUIRED_RUNTIME_MEMBERS) {
    if (anyModule[name] === undefined) problems.push(`missing runtime member ${name}`);
  }

  const identity: LoadedIdentity = {
    highsVersion: '', githash: '', sizeofHighsInt: -1, jsSha256: hashes.js, wasmSha256: hashes.wasm,
  };
  if (problems.length) return { problems, identity };

  identity.highsVersion = module.UTF8ToString(module._Highs_version());
  identity.githash = module.UTF8ToString(module._Highs_githash());
  const numeric = `${module._Highs_versionMajor()}.${module._Highs_versionMinor()}.${module._Highs_versionPatch()}`;
  if (identity.highsVersion !== numeric) problems.push(`Highs_version() is ${identity.highsVersion} but the version numbers say ${numeric}`);
  if (identity.highsVersion !== expected.highs.version) {
    problems.push(`HiGHS version ${identity.highsVersion} is not the committed ${expected.highs.version}`);
  }
  if (identity.githash !== expected.highs.githash) {
    problems.push(`HiGHS githash ${identity.githash} is not the committed ${expected.highs.githash}`);
  }
  if (!expected.highs.commit.startsWith(expected.highs.githash)) {
    problems.push(`committed githash ${expected.highs.githash} is not a prefix of the committed commit ${expected.highs.commit}`);
  }

  const handle = module._Highs_create();
  if (handle === 0) {
    problems.push('Highs_create returned a null handle');
    return { problems, identity };
  }
  try {
    identity.sizeofHighsInt = module._Highs_getSizeofHighsInt(handle);
    if (identity.sizeofHighsInt !== 4 || expected.sizeofHighsInt !== 4) {
      problems.push(`HighsInt is ${identity.sizeofHighsInt} bytes (committed ${expected.sizeofHighsInt}); the wrapper marshals 32-bit integers`);
    }
    const infinity = module._Highs_getInfinity(handle);
    if (infinity !== Infinity) problems.push(`Highs_getInfinity() is ${infinity}, expected Infinity`);
    problems.push(...checkOptionTable(module, handle));
    if (!problems.length) canarySolve(module, handle, problems);
  } finally {
    module._Highs_destroy(handle);
  }
  return { problems, identity };
}

/**
 * Load, hash-check, instantiate and ABI-validate the pinned HiGHS build. Resolves to a ready instance or rejects with a
 * `HighsLoadError` / `HighsAbiError`.
 */
export async function loadHighs(config: LoadHighsConfig = {}): Promise<HighsRuntime> {
  const expected = config.expected ?? COMMITTED_HIGHS_BUILD;
  let js: Uint8Array;
  let wasm: Uint8Array;
  let nodeFileUrl: string | undefined;
  if (isNode()) {
    const artifacts = await readArtifactsNode(config);
    ({ js, wasm } = artifacts);
    nodeFileUrl = artifacts.jsUrl;
  } else {
    ({ js, wasm } = await readArtifactsBrowser(config));
  }

  const [jsSha256, wasmSha256] = await Promise.all([sha256Hex(js), sha256Hex(wasm)]);
  const hashProblems: string[] = [];
  if (jsSha256 !== expected.artifacts['highs.js'].sha256) {
    hashProblems.push(`highs.js SHA-256 ${jsSha256} is not the committed ${expected.artifacts['highs.js'].sha256}`);
  }
  if (wasmSha256 !== expected.artifacts['highs.wasm'].sha256) {
    hashProblems.push(`highs.wasm SHA-256 ${wasmSha256} is not the committed ${expected.artifacts['highs.wasm'].sha256}`);
  }
  // Refuse to run code that is not the committed artifact (the glue is executable, so this precedes the import).
  if (hashProblems.length) throw new HighsAbiError(hashProblems);

  const factory = await importGlue(js, nodeFileUrl);
  const printed: string[] = [];
  const sink = (line: string): void => { printed.push(line); if (printed.length > 5000) printed.splice(0, 2500); };
  let compiled: WebAssembly.Module;
  try {
    compiled = await WebAssembly.compile(wasm as unknown as ArrayBuffer);
  } catch (error) {
    throw new HighsLoadError('highs.wasm does not compile (the engine lacks a feature the build needs, or the file is damaged)', { cause: error });
  }
  let module: HighsWasmModule;
  try {
    let failInstantiation: (reason: unknown) => void = () => undefined;
    const instantiationFailed = new Promise<never>((_, reject) => { failInstantiation = reject; });
    const ready = factory({
      instantiateWasm: (imports, receiveInstance) => {
        WebAssembly.instantiate(compiled, imports).then((instance) => receiveInstance(instance, compiled), failInstantiation);
        return {};
      },
      locateFile: (file) => file,
      print: sink,
      printErr: sink,
    });
    // The glue's promise never settles when instantiation fails, so race it against our own failure signal.
    module = await Promise.race([ready, instantiationFailed]);
  } catch (error) {
    throw new HighsLoadError('the HiGHS wasm module failed to instantiate', { cause: error });
  }

  const { problems, identity } = validateRuntime(module, expected, { js: jsSha256, wasm: wasmSha256 });
  if (problems.length) throw new HighsAbiError(problems);
  return { id: nextRuntimeId++, module, identity, printed };
}
