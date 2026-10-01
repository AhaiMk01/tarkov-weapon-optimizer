import type { ExploreRequest, ExploreResponse, OptimizeRequest, OptimizeResponse } from '../src/api/client.ts';

export interface RawTask {
  task_name: string;
  weapon_id: string;
  constraints?: Pick<OptimizeRequest, 'min_ergonomics' | 'max_recoil_sum' | 'min_mag_capacity' | 'min_sighting_range' | 'max_weight'>;
  required_item_ids?: string[];
  required_category_group_ids?: string[][];
}
export interface Snapshot {
  schemaVersion: 1;
  lang: 'en';
  gameMode: 'regular';
  guns: Record<string, unknown>[];
  mods: Record<string, unknown>[];
  tasks: RawTask[];
}
export interface BenchmarkCase {
  id: string;
  kind: 'optimize' | 'explore';
  description: string;
  request: OptimizeRequest | ExploreRequest;
}
export interface BrowserResult {
  elapsedMs: number;
  response: OptimizeResponse | ExploreResponse;
  validation: { checked: boolean; errors: string[] };
}
export interface Sample {
  schemaVersion: 1;
  sequence: number;
  caseId: string;
  variant: 'baseline' | 'candidate';
  repetition: number;
  warmup: boolean;
  request: BenchmarkCase;
  startedAt: string;
  coldLoadMs: number | null;
  elapsedMs: number | null;
  deadlineMs: number;
  outcome: 'response' | 'timeout' | 'error';
  response?: OptimizeResponse | ExploreResponse;
  validation?: BrowserResult['validation'];
  error?: string;
  pageErrors: string[];
  memory: { scope: 'page-js-heap-excludes-worker-wasm'; before: number | null; after: number | null };
  experiment?: string;
  endpointCache?: string;
  baselineRevision?: string;
  candidateRevision?: string;
  candidatePatch?: string;
}
