import { buildItemLookup } from '../src/solver/dataService.ts';
import { validateBuild } from './validateBuild.ts';
import type { ItemLookup } from '../src/solver/types.ts';
import type { BenchmarkCase, BrowserResult, Snapshot } from './types.ts';
import type { ExploreResponse, OptimizeResponse } from '../src/api/client.ts';

const DB_NAME = 'tarkov-optimizer-cache';
const DB_VERSION = 1;
const STORE_NAME = 'graphql-cache';
const CACHE_VERSION = 15;

function seedIndexedDB(data: { guns: Record<string, unknown>[]; mods: Record<string, unknown>[] }): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME);
    }
  };
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const entry = { timestamp: Date.now(), version: CACHE_VERSION, data };
    store.put(entry, 'json:en:regular');
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  };
  return promise;
}

let worker: Worker | null = null;
let itemLookup: ItemLookup | null = null;
let msgSeq = 1;
const pending = new Map<number, (res: unknown) => void>();

function initWorker(): void {
  if (worker) worker.terminate();
  worker = new Worker(new URL('../src/solver/solver.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent) => {
    const { id, payload } = e.data;
    const resolver = pending.get(id);
    if (resolver) {
      pending.delete(id);
      resolver(payload);
    }
  };
}

const benchmarkHarness = {
  async prepare(snapshot: Snapshot): Promise<{ gunsCount: number; modsCount: number }> {
    itemLookup = buildItemLookup(snapshot.guns, snapshot.mods);
    await seedIndexedDB({ guns: snapshot.guns, mods: snapshot.mods });
    initWorker();

    // Call loadData in worker
    const id = msgSeq++;
    const { promise, resolve } = Promise.withResolvers<unknown>();
    pending.set(id, resolve);
    worker!.postMessage({ type: 'loadData', id, payload: { lang: 'en', gameMode: 'regular' } });
    await promise;

    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.textContent = 'Ready';

    return { gunsCount: snapshot.guns.length, modsCount: snapshot.mods.length };
  },

  async run(caseItem: BenchmarkCase, deadlineMs: number = 60000): Promise<BrowserResult> {
    if (!worker || !itemLookup) throw new Error('Benchmark harness not prepared');

    const id = msgSeq++;
    const t0 = performance.now();

    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout after ${deadlineMs}ms`));
    }, deadlineMs);

    pending.set(id, (payload: unknown) => {
      clearTimeout(timer);
      resolve(payload);
    });

    const requestWithDeadline = { ...caseItem.request, time_limit_ms: deadlineMs };
    worker.postMessage({
      type: caseItem.kind,
      id,
      payload: { lang: 'en', gameMode: 'regular', request: requestWithDeadline },
    });

    const response = await promise as OptimizeResponse | ExploreResponse;
    const elapsedMs = performance.now() - t0;

    let validation = { checked: false, errors: [] as string[] };
    if (caseItem.kind === 'optimize' && 'selected_items' in response) {
      const errors = validateBuild(caseItem.request, response, itemLookup);
      validation = { checked: true, errors };
    }

    return { elapsedMs, response, validation };
  },

  async resetWorker(): Promise<void> {
    initWorker();
  },
};

interface WindowWithBenchmark extends Window {
  benchmark: typeof benchmarkHarness;
}

(window as unknown as WindowWithBenchmark).benchmark = benchmarkHarness;
const statusEl = document.getElementById('status');
if (statusEl) statusEl.textContent = 'Harness loaded';
