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
      // Validate every point in the Explore curve independently
      const errors: string[] = [];
      const expPoints = (response as ExploreResponse).points ?? [];
      for (let pIdx = 0; pIdx < expPoints.length; pIdx++) {
        const pt = expPoints[pIdx];
        const weaponEntry = itemLookup[caseItem.request.weapon_id];
        if (weaponEntry?.type !== 'gun') {
          errors.push(`Point ${pIdx}: Unknown weapon ${caseItem.request.weapon_id}`);
          continue;
        }
        const sum = (fn: (stats: any) => number) => (pt.selected_items || []).reduce((acc: number, m: any) => {
          const e = itemLookup[m.id];
          return acc + (e?.type === 'mod' ? fn(e.stats) : 0);
        }, 0);
        const rawErgo = weaponEntry.stats.naked_ergonomics + sum(s => s.ergonomics);
        const ergo = Math.max(0, Math.min(100, rawErgo));
        const weight = weaponEntry.stats.weight + sum(s => s.weight);
        const recoilFactor = 1 + sum(s => s.recoil_modifier);
        const recoilV = weaponEntry.stats.naked_recoil_v * recoilFactor;
        const recoilH = weaponEntry.stats.naked_recoil_h * recoilFactor;
        const effective = Math.max(0, Math.min(100, ergo * (1 + (caseItem.request.equip_ergo_modifier ?? 0))));
        const ted = effective - (weight <= 3 ? 0 : 100 - 300 / weight);
        const barrels = (pt.selected_items || []).filter((m: any) => (itemLookup[m.id] as any)?.stats?.center_of_impact > 0);
        const coi = barrels[0] ? (itemLookup[barrels[0].id] as any).stats.center_of_impact : weaponEntry.stats.center_of_impact;
        const moa = coi * (1 - sum(s => s.accuracy_modifier) / 100) * 34.3;
        const overswing = Math.max(0, Math.min(1, (weight * (1 - effective / 100) - 3) / 4)) * 100;

        const ptRes: OptimizeResponse = {
          status: (pt.status as any) || 'optimal',
          selected_items: pt.selected_items || [],
          selected_preset: pt.selected_preset,
          slot_pairs: pt.slot_pairs,
          objective_value: pt.recoil_v,
          final_stats: {
            ergonomics: ergo,
            recoil_vertical: recoilV,
            recoil_horizontal: recoilH,
            total_price: pt.price,
            total_weight: weight,
            true_ergo_delta: ted,
            moa,
            overswing_pct: overswing,
          },
        };
        const pointErrors = validateBuild(
          { ...caseItem.request as any, min_ergonomics: Math.floor(ergo) },
          ptRes,
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
