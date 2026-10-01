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
let currentVariant: 'baseline' | 'candidate' | null = null;
let itemLookup: ItemLookup | null = null;
let msgSeq = 1;
const pending = new Map<number, (res: unknown) => void>();

async function ensureWorkerVariant(variant: 'baseline' | 'candidate' = 'candidate'): Promise<void> {
  if (worker && currentVariant === variant) return;
  if (worker) worker.terminate();
  currentVariant = variant;
  const workerUrl = variant === 'baseline'
    ? new URL('./baseline/solver.worker.ts', import.meta.url)
    : new URL('../src/solver/solver.worker.ts', import.meta.url);
  worker = new Worker(workerUrl, { type: 'module' });
  worker.onmessage = (e: MessageEvent) => {
    const { id, payload } = e.data;
    const resolver = pending.get(id);
    if (resolver) {
      pending.delete(id);
      resolver(payload);
    }
  };
  // Ensure data loaded in new worker variant
  const id = msgSeq++;
  const { promise, resolve } = Promise.withResolvers<unknown>();
  pending.set(id, resolve);
  worker.postMessage({ type: 'loadData', id, payload: { lang: 'en', gameMode: 'regular' } });
  await promise;
}

const benchmarkHarness = {
  async prepare(snapshot: Snapshot): Promise<{ gunsCount: number; modsCount: number; coldLoadMs: number }> {
    const t0 = performance.now();
    itemLookup = buildItemLookup(snapshot.guns, snapshot.mods);
    await seedIndexedDB({ guns: snapshot.guns, mods: snapshot.mods });
    await ensureWorkerVariant('candidate');

    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.textContent = 'Ready';
    const coldLoadMs = Math.round(performance.now() - t0);

    return { gunsCount: snapshot.guns.length, modsCount: snapshot.mods.length, coldLoadMs };
  },

  async run(caseItem: BenchmarkCase, deadlineMs: number = 60000, variant: 'baseline' | 'candidate' = 'candidate'): Promise<BrowserResult> {
    await ensureWorkerVariant(variant);
    if (!worker || !itemLookup) throw new Error('Benchmark harness not prepared');

    const id = msgSeq++;
    const t0 = performance.now();

    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    // Grace period for worker response postMessage and serialization
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout after ${deadlineMs}ms`));
    }, deadlineMs + 5000);

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
      const errors = validateBuild(caseItem.request as any, response as any, itemLookup);
      validation = { checked: true, errors };
    } else if (caseItem.kind === 'explore' && 'points' in response) {
      // Validate every point in the Explore curve independently
      const errors: string[] = [];
      const expPoints = (response as ExploreResponse).points ?? [];
      for (let pIdx = 0; pIdx < expPoints.length; pIdx++) {
        const pt = expPoints[pIdx];
        const pointErrors = validateBuild(
          { ...caseItem.request as any, min_ergonomics: pt.ergo },
          pt as unknown as OptimizeResponse,
          itemLookup
        );
        for (const err of pointErrors) {
          errors.push(`Point ${pIdx} (E=${pt.ergo}, R=${pt.recoil_v}): ${err}`);
        }
      }
      validation = { checked: true, errors };
    }

    return { elapsedMs, response, validation };
  },

  async resetWorker(variant: 'baseline' | 'candidate' = 'candidate'): Promise<void> {
    if (worker) worker.terminate();
    worker = null;
    currentVariant = null;
    await ensureWorkerVariant(variant);
  },

  async clearCache(): Promise<void> {
    if (!worker) return;
    const id = msgSeq++;
    const { promise, resolve } = Promise.withResolvers<unknown>();
    pending.set(id, resolve);
    worker.postMessage({ type: 'clearCache', id });
    await promise;
  },

  async getStatus(variant: 'baseline' | 'candidate' = 'candidate'): Promise<any> {
    await ensureWorkerVariant(variant);
    if (!worker) return null;
    const id = msgSeq++;
    const { promise, resolve } = Promise.withResolvers<unknown>();
    pending.set(id, resolve);
    worker.postMessage({ type: 'getStatus', id, payload: { lang: 'en', gameMode: 'regular' } });
    return promise;
  },
};

interface WindowWithBenchmark extends Window {
  benchmark: typeof benchmarkHarness;
}

(window as unknown as WindowWithBenchmark).benchmark = benchmarkHarness;
const statusEl = document.getElementById('status');
if (statusEl) statusEl.textContent = 'Harness loaded';
