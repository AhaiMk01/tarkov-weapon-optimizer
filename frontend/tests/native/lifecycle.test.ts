// Lifecycle: a native failure discards the wasm instance and surfaces a typed SolverError, the next call re-instantiates,
// nothing leaks across solves, an oversized heap is recycled, and typed non-native errors keep the instance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HighsOptionError, ModelReadError, NativeHighs, SolverError, loadHighs } from '../../src/solver/native';
import type { HighsRuntime } from '../../src/solver/native';
import { HIGHS_JS_README_LP, PRECISION_LP, PRECISION_X, knapsackLp } from './fixtures';

/** A runtime whose chosen native function throws on call (the shape of a wasm trap or an aborted instance). */
function sabotaged(runtime: HighsRuntime, fn: '_Highs_run' | '_Highs_readModel' | '_Highs_getLp', thrown: unknown): HighsRuntime {
  const module = new Proxy(runtime.module, {
    get(target, prop, receiver) {
      if (prop === fn) return () => { throw thrown; };
      return Reflect.get(target, prop, receiver);
    },
  });
  return { ...runtime, module };
}

test('a throwing native call becomes a SolverError, discards the instance, and the next call re-instantiates', async () => {
  let loads = 0;
  const native = new NativeHighs({
    loader: async () => {
      const runtime = await loadHighs();
      loads++;
      return loads === 1 ? sabotaged(runtime, '_Highs_run', new WebAssembly.RuntimeError('unreachable')) : runtime;
    },
  });
  const first = await native.acquire();
  assert.equal(native.instanceId, first.id);

  await assert.rejects(
    native.solveStructured(PRECISION_LP),
    (e: unknown) => e instanceof SolverError && e.corrupted && e.phase === 'solve' && /unreachable/.test(e.message) && e.cause instanceof WebAssembly.RuntimeError,
  );
  assert.equal(native.instanceId, null, 'the corrupted instance is discarded');
  assert.equal(native.corruptionDiscards, 1);

  const recovered = await native.solveStructured(PRECISION_LP);
  assert.equal(recovered.modelStatus.name, 'Optimal');
  assert.equal(recovered.colValues![recovered.colIndexByName.get('x')!], PRECISION_X);
  assert.equal(loads, 2, 'a fresh wasm instance was built');
  assert.notEqual(recovered.runtimeId, first.id);
  assert.equal(native.instancesCreated, 2);
  native.discard();
});

test('a REAL wasm trap (an out-of-bounds read inside HiGHS) is handled the same way', async () => {
  let loads = 0;
  const native = new NativeHighs({
    loader: async () => {
      const runtime = await loadHighs();
      loads++;
      if (loads > 1) return runtime;
      const module = new Proxy(runtime.module, {
        get(target, prop, receiver) {
          // Highs_readModel(handle, <address past the end of linear memory>) makes HiGHS read the file name out of bounds.
          if (prop === '_Highs_run') return (handle: number) => target._Highs_readModel(handle, 0xfffffff0);
          return Reflect.get(target, prop, receiver);
        },
      });
      return { ...runtime, module };
    },
  });
  await assert.rejects(
    native.solveStructured(PRECISION_LP),
    (e: unknown) => e instanceof SolverError && e.corrupted && e.cause instanceof WebAssembly.RuntimeError && /out of bounds|unreachable|Aborted/i.test(e.message),
  );
  assert.equal(native.instanceId, null);
  const ok = await native.solveStructured(HIGHS_JS_README_LP);
  assert.equal(ok.objectiveValue, 87.5);
  native.discard();
});

test('non-Error throws (an Emscripten exception pointer, a string) are also typed and discard the instance', async () => {
  for (const thrown of [1234567, 'Aborted(OOM)']) {
    const native = new NativeHighs({ loader: async () => sabotaged(await loadHighs(), '_Highs_readModel', thrown) });
    await assert.rejects(native.solveStructured(PRECISION_LP), (e: unknown) => e instanceof SolverError && e.corrupted && e.phase === 'solve');
    assert.equal(native.instanceId, null);
  }
});

test('a failure while marshalling the model back (getLp) is also corruption, in solve and in readback', async () => {
  const native = new NativeHighs({ loader: async () => sabotaged(await loadHighs(), '_Highs_getLp', new WebAssembly.RuntimeError('memory access out of bounds')) });
  await assert.rejects(native.solveStructured(PRECISION_LP), SolverError);
  assert.equal(native.instanceId, null);
  await assert.rejects(native.readbackModel(PRECISION_LP), (e: unknown) => e instanceof SolverError && e.phase === 'readback');
});

test('a failed load is retried on the next call, not cached', async () => {
  let attempts = 0;
  const native = new NativeHighs({ loader: async () => { attempts++; if (attempts === 1) throw new Error('network down'); return loadHighs(); } });
  await assert.rejects(native.solveStructured(PRECISION_LP), /network down/);
  assert.equal(native.instanceId, null);
  const ok = await native.solveStructured(PRECISION_LP);
  assert.equal(ok.modelStatus.name, 'Optimal');
  assert.equal(attempts, 2);
  native.discard();
});

test('typed non-native errors (option, model-read) do not discard the instance', async () => {
  const native = new NativeHighs();
  const id = (await native.acquire()).id;
  await assert.rejects(native.solveStructured(PRECISION_LP, { not_an_option: 1 } as never), HighsOptionError);
  // HiGHS's reader ignores unrecognised text before the first section, so the garbage must follow a real section to be an error.
  await assert.rejects(native.solveStructured('Maximize\n obj: x\nSubject To\n c1: x <= 4\nGarbage here\nmore garbage'), ModelReadError);
  assert.equal(native.instanceId, id);
  assert.equal(native.corruptionDiscards, 0);
  native.discard();
});

test('no state leaks across solves: results are independent and the wasm heap does not grow with the number of solves', async () => {
  const native = new NativeHighs();
  const lps = [PRECISION_LP, HIGHS_JS_README_LP, knapsackLp(40), 'Maximize\n obj: x\nSubject To\n c1: x >= 5\n c2: x <= 3\nEnd\n'];
  const expected = ['Optimal', 'Optimal', 'Optimal', 'Infeasible'];
  const runtime = await native.acquire();
  const heapSizes: number[] = [];
  for (let round = 0; round < 40; round++) {
    const i = round % lps.length;
    const result = await native.solveStructured(lps[i], undefined, { includeRows: true, includeReadback: true });
    assert.equal(result.modelStatus.name, expected[i], `round ${round}`);
    if (i === 0) assert.equal(result.colValues![result.colIndexByName.get('x')!], PRECISION_X);
    if (i === 1) assert.equal(result.objectiveValue, 87.5);
    if (round >= 8) heapSizes.push(runtime.module.wasmMemory.buffer.byteLength);
  }
  assert.equal(native.instanceId, runtime.id, 'the same instance served every round');
  assert.equal(Math.max(...heapSizes), Math.min(...heapSizes), 'wasm memory is flat once warm (nothing leaks per solve)');
  native.discard();
});

test('an error in one solve does not poison the next solve on the same instance', async () => {
  const native = new NativeHighs();
  await assert.rejects(native.solveStructured('Maximize\n obj: x\nSubject To\n c1: 1e16 x <= 4\nEnd\n'), ModelReadError);
  const ok = await native.solveStructured(HIGHS_JS_README_LP);
  assert.equal(ok.objectiveValue, 87.5);
  assert.deepEqual(ok.readMessages.filter(line => /error|warning/i.test(line)), [], 'the earlier failure left no warning behind');
  native.discard();
});

test('an instance whose heap passed the retention limit is recycled (not an error) and the next solve is on a new instance', async () => {
  const native = new NativeHighs({ maxRetainedHeapBytes: 1 });
  const first = await native.solveStructured(PRECISION_LP);
  assert.equal(native.instanceId, null);
  assert.equal(native.heapRecycles, 1);
  assert.equal(native.corruptionDiscards, 0);
  const second = await native.solveStructured(PRECISION_LP);
  assert.notEqual(first.runtimeId, second.runtimeId);
  assert.equal(second.modelStatus.name, 'Optimal');
  native.discard();
});

test('discard() on demand: the next call builds a fresh instance (the app does this when its own post-processing fails)', async () => {
  const native = new NativeHighs();
  const a = await native.solveStructured(PRECISION_LP);
  native.discard();
  const b = await native.solveStructured(PRECISION_LP);
  assert.notEqual(a.runtimeId, b.runtimeId);
  native.discard();
});
