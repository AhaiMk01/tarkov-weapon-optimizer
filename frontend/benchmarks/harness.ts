import { buildItemLookup } from '../src/solver/dataService.ts';
import { validateBuild } from './validateBuild.ts';
import { validateExploreCurve } from './exploreValidation.ts';
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

let baselineWorker: Worker | null = null;
let candidateWorker: Worker | null = null;
let itemLookup: ItemLookup | null = null;
let msgSeq = 1;
const pending = new Map<number, (res: unknown) => void>();

function createWorker(variant: 'baseline' | 'candidate'): Worker {
  const workerUrl = variant === 'baseline'
    ? new URL('./baseline/solver.worker.ts', import.meta.url)
    : new URL('../src/solver/solver.worker.ts', import.meta.url);
  const w = new Worker(workerUrl, { type: 'module' });
  w.onmessage = (e: MessageEvent) => {
    const { id, payload } = e.data;
    const resolver = pending.get(id);
    if (resolver) {
      pending.delete(id);
      resolver(payload);
    }
  };
  return w;
}

async function getWorker(variant: 'baseline' | 'candidate' = 'candidate'): Promise<Worker> {
  if (variant === 'baseline') {
    if (!baselineWorker) {
      baselineWorker = createWorker('baseline');
      const id = msgSeq++;
      const { promise, resolve } = Promise.withResolvers<unknown>();
      pending.set(id, resolve);
      baselineWorker.postMessage({ type: 'loadData', id, payload: { lang: 'en', gameMode: 'regular' } });
      await promise;
    }
    return baselineWorker;
  } else {
    if (!candidateWorker) {
      candidateWorker = createWorker('candidate');
      const id = msgSeq++;
      const { promise, resolve } = Promise.withResolvers<unknown>();
      pending.set(id, resolve);
      candidateWorker.postMessage({ type: 'loadData', id, payload: { lang: 'en', gameMode: 'regular' } });
      await promise;
    }
    return candidateWorker;
  }
}

const benchmarkHarness = {
  async prepare(snapshot: Snapshot): Promise<{ gunsCount: number; modsCount: number; coldLoadMs: number }> {
    const t0 = performance.now();
    itemLookup = buildItemLookup(snapshot.guns, snapshot.mods);
    await seedIndexedDB({ guns: snapshot.guns, mods: snapshot.mods });
    // Initialize both worker variants concurrently so they are warm and ready
    await Promise.all([getWorker('baseline'), getWorker('candidate')]);

    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.textContent = 'Ready';
    const coldLoadMs = Math.round(performance.now() - t0);

    return { gunsCount: snapshot.guns.length, modsCount: snapshot.mods.length, coldLoadMs };
  },

  async run(caseItem: BenchmarkCase, deadlineMs: number = 60000, variant: 'baseline' | 'candidate' = 'candidate'): Promise<BrowserResult> {
    const targetWorker = await getWorker(variant);
    if (!itemLookup) throw new Error('Benchmark harness not prepared');

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
    targetWorker.postMessage({
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
      const errors = validateExploreCurve(
        caseItem.request,
        (response as ExploreResponse).points ?? [],
        itemLookup,
      );
      validation = { checked: true, errors };
    }

    return { elapsedMs, response, validation };
  },

  async resetWorker(): Promise<void> {
    if (baselineWorker) { baselineWorker.terminate(); baselineWorker = null; }
    if (candidateWorker) { candidateWorker.terminate(); candidateWorker = null; }
    await Promise.all([getWorker('baseline'), getWorker('candidate')]);
  },

  async clearCache(variant?: 'baseline' | 'candidate'): Promise<void> {
    const targets: Worker[] = [];
    if (!variant || variant === 'baseline') if (baselineWorker) targets.push(baselineWorker);
    if (!variant || variant === 'candidate') if (candidateWorker) targets.push(candidateWorker);
    await Promise.all(targets.map(w => {
      const id = msgSeq++;
      const { promise, resolve } = Promise.withResolvers<unknown>();
      pending.set(id, resolve);
      w.postMessage({ type: 'clearCache', id });
      return promise;
    }));
  },

  async getStatus(variant: 'baseline' | 'candidate' = 'candidate'): Promise<any> {
    const targetWorker = await getWorker(variant);
    const id = msgSeq++;
    const { promise, resolve } = Promise.withResolvers<unknown>();
    pending.set(id, resolve);
    targetWorker.postMessage({ type: 'getStatus', id, payload: { lang: 'en', gameMode: 'regular' } });
    return promise;
  },
};

interface WindowWithBenchmark extends Window {
  benchmark: typeof benchmarkHarness;
}

(window as unknown as WindowWithBenchmark).benchmark = benchmarkHarness;
const statusEl = document.getElementById('status');
if (statusEl) statusEl.textContent = 'Harness loaded';
