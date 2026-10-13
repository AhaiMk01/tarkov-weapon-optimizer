/**
 * One worker of the native solve pool (`pool.ts`): a browser dedicated Worker nested in the solver worker, or a Node `worker_threads` worker (tests
 * and benchmarks), running the same code. It loads ITS OWN instance of the pinned HiGHS build through `loadHighs` (the same files, the same SHA-256
 * check before any of their code runs, the same ABI validation and known-answer solve; never another HiGHS) and then solves one text at a time with
 * `NativeHighs.solveStructured`, exactly as the in-thread instance does (a fresh handle per solve, recycling after a trap or a grown heap).
 *
 * The protocol is `poolProtocol.ts`. A load failure is reported once (`initError`) and the pool falls back to the in-thread instance.
 */

import { loadHighs } from './loadHighs';
import { NativeHighs } from './native';
import type { HighsRuntime } from './loadHighs';
import { serializeError } from './poolProtocol';
import type { PoolInMessage, PoolOutMessage } from './poolProtocol';

interface Port {
  post(message: PoolOutMessage): void;
  listen(handler: (message: PoolInMessage) => void): void;
}

type WorkerGlobals = {
  WorkerGlobalScope?: unknown;
  postMessage?: (message: unknown) => void;
  addEventListener?: (type: 'message', handler: (event: { data: unknown }) => void) => void;
};

interface NodeParentPort { postMessage(message: unknown): void; on(event: 'message', handler: (message: unknown) => void): void }

/** Dynamic import the bundler must not follow (`node:worker_threads` exists only in Node). */
const dynamicImport = (specifier: string): Promise<unknown> => import(/* @vite-ignore */ specifier);

async function openPort(): Promise<Port> {
  const g = globalThis as WorkerGlobals;
  if (g.WorkerGlobalScope !== undefined && typeof g.postMessage === 'function' && typeof g.addEventListener === 'function') {
    const post = g.postMessage.bind(globalThis);
    const add = g.addEventListener.bind(globalThis);
    return { post: m => post(m), listen: handler => add('message', event => handler(event.data as PoolInMessage)) };
  }
  const threads = (await dynamicImport('node:worker_threads')) as { parentPort: NodeParentPort | null };
  const parent = threads.parentPort;
  if (parent === null) throw new Error('poolWorker.ts must run as a worker');
  return { post: m => parent.postMessage(m), listen: handler => parent.on('message', m => handler(m as PoolInMessage)) };
}

let native: NativeHighs | null = null;
let current: HighsRuntime | null = null;

/** The wasm heap of the instance last loaded (memory never shrinks, so this is the most the instance has held). */
const heapBytes = (): number => current?.module.wasmMemory.buffer.byteLength ?? 0;

function serve(port: Port): void {
  port.listen(message => {
    if (message.type === 'init') {
      const location = message.location;
      native = new NativeHighs({ loader: async () => (current = await loadHighs(location === undefined ? {} : { location })) });
      native.acquire().then(
        rt => port.post({ type: 'ready', highsVersion: rt.identity.highsVersion, wasmSha256: rt.identity.wasmSha256, heapBytes: heapBytes() }),
        error => port.post({ type: 'initError', error: serializeError(error) }),
      );
      return;
    }
    const { id, lpText, options, extras } = message;
    const instance = native;
    if (instance === null) {
      port.post({ type: 'error', id, error: serializeError(new Error('the pool worker was asked to solve before it was initialized')), heapBytes: 0 });
      return;
    }
    instance.solveStructured(lpText, options, extras).then(
      result => port.post({ type: 'result', id, result, heapBytes: heapBytes() }),
      error => port.post({ type: 'error', id, error: serializeError(error), heapBytes: heapBytes() }),
    );
  });
}

// No top-level await: the worker bundle targets engines without it.
void openPort().then(serve);
