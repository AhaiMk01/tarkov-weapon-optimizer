// The loader: artifact location, SHA-256 verification before any code runs, runtime ABI validation against the committed
// manifest, and typed failure with no fallback to any other HiGHS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  COMMITTED_HIGHS_BUILD, HIGHS_OPTION_TYPES, HighsAbiError, HighsLoadError, loadHighs, sha256Hex, sha256HexSync, validateRuntime,
} from '../../src/solver/native';
import type { HighsBuildIdentity } from '../../src/solver/native';

const publicFile = (name: string): string => fileURLToPath(new URL(`../../public/${name}`, import.meta.url));
const identity = (patch: (copy: HighsBuildIdentity) => void): HighsBuildIdentity => {
  const copy = structuredClone(COMMITTED_HIGHS_BUILD) as HighsBuildIdentity;
  patch(copy);
  return copy;
};

test('loadHighs() loads the committed build and reports what it verified', async () => {
  const runtime = await loadHighs();
  assert.equal(runtime.identity.highsVersion, COMMITTED_HIGHS_BUILD.highs.version);
  assert.equal(runtime.identity.githash, COMMITTED_HIGHS_BUILD.highs.githash);
  assert.ok(COMMITTED_HIGHS_BUILD.highs.commit.startsWith(runtime.identity.githash), 'the runtime githash is a prefix of the pinned commit');
  assert.equal(runtime.identity.sizeofHighsInt, 4);
  assert.equal(runtime.identity.wasmSha256, COMMITTED_HIGHS_BUILD.artifacts['highs.wasm'].sha256);
  assert.equal(runtime.identity.jsSha256, COMMITTED_HIGHS_BUILD.artifacts['highs.js'].sha256);
  for (const name of COMMITTED_HIGHS_BUILD.exportedFunctions) {
    assert.equal(typeof (runtime.module as unknown as Record<string, unknown>)[name], 'function', name);
  }
});

test('each load is a distinct instance with its own memory', async () => {
  const [a, b] = await Promise.all([loadHighs(), loadHighs()]);
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.module.wasmMemory, b.module.wasmMemory);
});

test('the pure-JS SHA-256 fallback agrees with the platform digest and the published test vectors', async () => {
  const vectors: Array<[string, string]> = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ];
  for (const [text, digest] of vectors) {
    const bytes = new TextEncoder().encode(text);
    assert.equal(sha256HexSync(bytes), digest);
    assert.equal(await sha256Hex(bytes), digest);
  }
  const wasm = readFileSync(publicFile('highs.wasm'));
  assert.equal(sha256HexSync(new Uint8Array(wasm)), createHash('sha256').update(wasm).digest('hex'));
  const million = new Uint8Array(1_000_000).fill(0x61);
  assert.equal(sha256HexSync(million), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});

test('ABI failure: a manifest that names a different HiGHS version is rejected with a typed error', async () => {
  await assert.rejects(
    loadHighs({ expected: identity(c => { c.highs.version = '1.8.0'; }) }),
    (e: unknown) => e instanceof HighsAbiError && e.code === 'abi' && e.problems.some(p => /version 1\.15\.1 is not the committed 1\.8\.0/.test(p)),
  );
});

test('ABI failure: a manifest that names a different githash or a githash that is not a prefix of the commit', async () => {
  await assert.rejects(
    loadHighs({ expected: identity(c => { c.highs.githash = 'deadbeefcafe'; }) }),
    (e: unknown) => e instanceof HighsAbiError && e.problems.some(p => /githash 04024d701f79 is not the committed deadbeefcafe/.test(p)) && e.problems.some(p => /not a prefix/.test(p)),
  );
});

test('ABI failure: an exported function the manifest promises but the build lacks, and a wrapper need the manifest does not cover', async () => {
  await assert.rejects(
    loadHighs({ expected: identity(c => { c.exportedFunctions = [...c.exportedFunctions, '_Highs_notInThisBuild']; }) }),
    (e: unknown) => e instanceof HighsAbiError && e.problems.includes('missing exported function _Highs_notInThisBuild'),
  );
  await assert.rejects(
    loadHighs({ expected: identity(c => { c.exportedFunctions = c.exportedFunctions.filter(n => n !== '_Highs_getSolution'); }) }),
    (e: unknown) => e instanceof HighsAbiError && e.problems.some(p => /wrapper needs _Highs_getSolution/.test(p)),
  );
});

test('ABI failure: a different HighsInt width is rejected', async () => {
  await assert.rejects(
    loadHighs({ expected: identity(c => { c.sizeofHighsInt = 8; }) }),
    (e: unknown) => e instanceof HighsAbiError && e.problems.some(p => /HighsInt is 4 bytes \(committed 8\)/.test(p)),
  );
});

test('wrong artifact hashes are refused before the glue runs: the committed SHA-256 is part of the manifest', async () => {
  await assert.rejects(
    loadHighs({ expected: identity(c => { c.artifacts['highs.wasm'].sha256 = '0'.repeat(64); }) }),
    (e: unknown) => e instanceof HighsAbiError && e.problems.some(p => /highs\.wasm SHA-256 [0-9a-f]{64} is not the committed 0{64}/.test(p)),
  );
  await assert.rejects(
    loadHighs({ expected: identity(c => { c.artifacts['highs.js'].sha256 = '1'.repeat(64); }) }),
    (e: unknown) => e instanceof HighsAbiError && e.problems.some(p => /highs\.js SHA-256/.test(p)),
  );
  // One flipped byte of the supplied wasm.
  const tampered = new Uint8Array(readFileSync(publicFile('highs.wasm')));
  tampered[tampered.length - 1] ^= 0xff;
  await assert.rejects(loadHighs({ wasmBytes: tampered }), (e: unknown) => e instanceof HighsAbiError && /highs\.wasm SHA-256/.test(e.message));
});

test('a stock or foreign build cannot pass: a different wasm with a consistent manifest still fails the export/version checks', async () => {
  // Hash-consistent but wrong build: pretend the committed identity describes a foreign wasm (an empty, valid module). Its exports are not ours.
  // (The stock npm `highs` package is no longer installed, Phase 2.9; any foreign module stands in for it.)
  const foreign = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  const digest = createHash('sha256').update(foreign).digest('hex');
  await assert.rejects(
    loadHighs({ wasmBytes: foreign, expected: identity(c => { c.artifacts['highs.wasm'].sha256 = digest; }) }),
    (e: unknown) => e instanceof HighsAbiError || e instanceof HighsLoadError,
    'the pinned glue cannot instantiate a foreign wasm; there is no fallback',
  );
});

test('a missing artifact directory is a typed load error, not a silent fallback', async () => {
  await assert.rejects(
    loadHighs({ location: fileURLToPath(new URL('./does-not-exist/', import.meta.url)) }),
    (e: unknown) => e instanceof HighsLoadError && e.code === 'load' && /cannot read the HiGHS artifacts/.test(e.message),
  );
});

test('validateRuntime reports every problem at once', async () => {
  const runtime = await loadHighs();
  const { problems } = validateRuntime(runtime.module, identity(c => {
    c.highs.version = '0.0.0';
    c.highs.githash = 'ffffffffffff';
    c.sizeofHighsInt = 2;
  }), { js: runtime.identity.jsSha256, wasm: runtime.identity.wasmSha256 });
  assert.ok(problems.length >= 4, problems.join('; '));
});

test('the option table matches the build: every name exists with the declared type (checked on every load)', async () => {
  // loadHighs() already runs checkOptionTable; this documents the table size and fails loudly if it ever shrinks silently.
  assert.ok(Object.keys(HIGHS_OPTION_TYPES).length >= 30);
  for (const name of ['time_limit', 'mip_rel_gap', 'mip_abs_gap', 'mip_max_improving_sols', 'small_matrix_value', 'large_matrix_value', 'presolve', 'log_to_console']) {
    assert.ok(name in HIGHS_OPTION_TYPES, name);
  }
  await loadHighs();
});
