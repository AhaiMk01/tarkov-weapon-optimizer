/**
 * Web Worker for running HiGHS solver without blocking the UI.
 *
 * A thin shell: every handler, the request epoch guard, the validation, the caches and the serial dispatch chain live in
 * `workerRuntime.ts`, where they are unit-tested with injected collaborators. The shell only connects it to the worker message port.
 * `cancel` messages reach the runtime through the same `onmessage` but bypass its dispatch chain (they flag the target request at once).
 */

import { createWorkerRuntime } from './workerRuntime.ts';
import type { WorkerInMessage, WorkerOutMessage } from './workerProtocol.ts';

const runtime = createWorkerRuntime({
  post: (message: WorkerOutMessage) => self.postMessage(message),
});

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  runtime.receive(event.data);
};
