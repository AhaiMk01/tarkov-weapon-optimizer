import { buildItemLookup, CACHE_VERSION } from '../../src/solver/dataService';
import { validateBuild } from '../../src/solver/validateBuild';
import type { ItemLookup } from '../../src/solver/types';
import type { OptimizeResponse } from '../../src/api/client';

const DB_NAME = 'tarkov-optimizer-cache';
const DB_VERSION = 1;
const STORE_NAME = 'graphql-cache';

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
const pending = new Map<number, (res: any) => void>();

function getWorker(): Worker {
  if (!worker) {
    const workerUrl = new URL('./candidate.worker.ts', import.meta.url);
    worker = new Worker(workerUrl, { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const { id, payload } = e.data;
      const resolver = pending.get(id);
      if (resolver) {
        pending.delete(id);
        resolver(payload);
      }
    };
  }
  return worker;
}

const smokeHarness = {
  async seed(snapshot: { guns: any[]; mods: any[] }): Promise<void> {
    itemLookup = buildItemLookup(snapshot.guns, snapshot.mods);
    await seedIndexedDB({ guns: snapshot.guns, mods: snapshot.mods });
  },

  async runSmoke(request: any): Promise<any> {
    const w = getWorker();
    const id = msgSeq++;
    const { promise, resolve } = Promise.withResolvers<any>();
    pending.set(id, resolve);
    w.postMessage({
      type: 'optimize',
      id,
      payload: { lang: 'en', gameMode: 'regular', request },
    });
    const response = await promise;
    let validationErrors: string[] = [];
    if (itemLookup && response.selected_items?.length > 0) {
      validationErrors = validateBuild(request, response as OptimizeResponse, itemLookup);
    }
    return {
      response,
      validationErrors,
    };
  },
};

(window as any).smokeHarness = smokeHarness;
const statusEl = document.getElementById('status');
if (statusEl) statusEl.textContent = 'Harness ready';
