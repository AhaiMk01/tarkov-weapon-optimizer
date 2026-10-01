import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';
import { findBrowserExecutable } from '../browser';
import { loadAndVerifySnapshot } from '../snapshot';
import { makeCases } from '../cases';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '../..');

export const PROVENANCE_RECORD = {
  matching_control_revision: '518017b',
  candidate_revision: '2da7e0b',
  wasm_sha256: '57e4abcb4b9e96370ae9e5b9fa1e4a88af23a13e34bd361228f6af0bd76bb20d',
  exact_proof_settings: {
    mip_rel_gap: 0,
    mip_abs_gap: 1e-9,
    mip_feasibility_tolerance: 1e-8,
    primal_feasibility_tolerance: 1e-9,
    dual_feasibility_tolerance: 1e-9,
    presolve: 'on',
    simplex_strategy: 1,
  },
};

export interface BoundTelemetry {
  value: number | null;
  encoding: 'finite' | 'infinity' | 'missing';
}

export interface GapTelemetry {
  absolute: number | null;
  normalized: number | null;
  encoding: 'finite' | 'open' | 'missing';
}

export interface CanonicalCohortSample {
  schemaVersion: 1;
  cohort: 'canonical-spatial-cohort';
  candidate: 'adaptive-envelope' | 'node-option-tuning';
  caseId: string;
  sequence: number;
  pair: number;
  arm: 'control' | 'candidate';
  warmup: boolean;
  order: 'AB' | 'BA';
  startedAt: string;
  elapsedMs: number;
  workerSolveMs: number;
  prepElapsedMs: number;
  status: string;
  termination: string;
  objective: number;
  lowerBound: number;
  upperBound: BoundTelemetry;
  gap: GapTelemetry;
  nodes: number;
  validationPassed: boolean;
  validationErrors: string[];
  cacheState: 'cold' | 'warm';
  fullRequest: any;
  provenance: typeof PROVENANCE_RECORD;
  mechanismTelemetry: {
    candidate: string;
    candidate_active: boolean;
    nodes: number;
    geometric_splits?: number;
    linear_splits?: number;
    proved_bounds_retained?: number;
    tuned_options?: any;
    termination: string;
  };
}

export async function runCanonicalCohort(
  candidate: 'adaptive-envelope' | 'node-option-tuning',
  targetCaseId?: string
) {
  console.log(`\n================================================================`);
  console.log(`Starting CANONICAL formal cohort for: ${candidate}${targetCaseId ? ` (case: ${targetCaseId})` : ''}`);
  console.log(`================================================================`);

  const { snapshot } = loadAndVerifySnapshot(path.resolve(__dirname, '..'));
  const resultsDir = path.resolve(__dirname, '../results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  const outputFile = path.join(resultsDir, `canonical_cohort_${candidate}.jsonl`);
  const logStream = fs.createWriteStream(outputFile, { flags: targetCaseId ? 'a' : 'w', encoding: 'utf8' });

  const port = candidate === 'adaptive-envelope' ? 5195 : 5196;
  const server = await createServer({
    root: frontendRoot,
    server: { port },
    logLevel: 'error',
  });
  await server.listen();

  const browser = await puppeteer.launch({
    executablePath: findBrowserExecutable(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${port}/benchmarks/experiments/harness.html`, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });
    await page.waitForFunction('typeof window.smokeHarness !== "undefined"', { timeout: 10000 });
    await page.evaluate((snap: any) => (window as any).smokeHarness.seed(snap), snapshot);

    // 1. Extract canonical requests from makeCases(snapshot)
    const benchmarkCases = makeCases(snapshot);
    const dtCase = benchmarkCases.find(c => c.id === 'dense-ted');
    const doCase = benchmarkCases.find(c => c.id === 'dense-overswing');

    if (!dtCase || !doCase) {
      throw new Error('Canonical cases dense-ted or dense-overswing missing from makeCases(snapshot)');
    }

    let cases = [dtCase, doCase];
    if (targetCaseId) cases = cases.filter(c => c.id === targetCaseId);

    let sequence = 0;

    for (const testCase of cases) {
      console.log(`\n--- Case: ${testCase.id} (${testCase.description}) ---`);
      console.log(`  Canonical Request:`, JSON.stringify(testCase.request, null, 2));

      // Both-arm warmups
      console.log('  Executing both-arm warmups...');
      for (const arm of ['control', candidate] as const) {
        const fullReq = {
          ...testCase.request,
          time_limit_ms: 60000,
          spatial_candidate: arm,
        };
        const t0 = performance.now();
        const res = await page.evaluate(
          (req: any) => (window as any).smokeHarness.runSmoke(req),
          fullReq
        );
        const elapsed = performance.now() - t0;

        const ubVal = res.response.mechanism_telemetry?.upper_bound ?? res.response.optimization?.upper_bound;
        const ubEnc: BoundTelemetry = ubVal === Infinity
          ? { value: null, encoding: 'infinity' }
          : (ubVal != null && Number.isFinite(ubVal))
            ? { value: ubVal, encoding: 'finite' }
            : { value: null, encoding: 'missing' };

        const normGap = res.response.mechanism_telemetry?.normalized_gap ?? (ubEnc.encoding === 'finite' && res.response.objective_value != null ? (ubEnc.value! - res.response.objective_value) / Math.max(1, Math.abs(res.response.objective_value)) : null);
        const absGap = res.response.mechanism_telemetry?.absolute_gap ?? (ubEnc.encoding === 'finite' && res.response.objective_value != null ? Math.max(0, ubEnc.value! - res.response.objective_value) : null);
        const gapEnc: GapTelemetry = (ubEnc.encoding === 'finite' && normGap != null && Number.isFinite(normGap))
          ? { absolute: absGap, normalized: normGap, encoding: 'finite' }
          : (ubEnc.encoding === 'infinity' || ubEnc.encoding === 'missing')
            ? { absolute: null, normalized: null, encoding: 'open' }
            : { absolute: null, normalized: null, encoding: 'missing' };

        const geomSplits = res.response.mechanism_telemetry?.geometric_splits ?? 0;
        const isCandActive = arm === 'candidate'
          ? (candidate === 'adaptive-envelope' ? geomSplits > 0 : true)
          : false;

        const sample: CanonicalCohortSample = {
          schemaVersion: 1,
          cohort: 'canonical-spatial-cohort',
          candidate,
          caseId: testCase.id,
          sequence: ++sequence,
          pair: 0,
          arm: arm === 'control' ? 'control' : 'candidate',
          warmup: true,
          order: 'AB',
          startedAt: new Date().toISOString(),
          elapsedMs: elapsed,
          workerSolveMs: res.response.solve_time_ms ?? elapsed,
          prepElapsedMs: res.response.prep_elapsed_ms ?? 0,
          status: res.response.status,
          termination: res.response.mechanism_telemetry?.termination ?? res.response.status,
          objective: res.response.objective_value ?? 0,
          lowerBound: res.response.mechanism_telemetry?.lower_bound ?? res.response.objective_value ?? 0,
          upperBound: ubEnc,
          gap: gapEnc,
          nodes: res.response.mechanism_telemetry?.nodes ?? 0,
          validationPassed: res.validationErrors.length === 0,
          validationErrors: res.validationErrors,
          cacheState: 'cold',
          fullRequest: fullReq,
          provenance: PROVENANCE_RECORD,
          mechanismTelemetry: {
            candidate: arm,
            candidate_active: isCandActive,
            nodes: res.response.mechanism_telemetry?.nodes ?? 0,
            geometric_splits: geomSplits,
            linear_splits: res.response.mechanism_telemetry?.linear_splits ?? 0,
            proved_bounds_retained: res.response.mechanism_telemetry?.proved_bounds_retained ?? 0,
            tuned_options: arm === 'candidate' && candidate === 'node-option-tuning' ? PROVENANCE_RECORD.exact_proof_settings : undefined,
            termination: res.response.mechanism_telemetry?.termination ?? res.response.status,
          },
        };
        logStream.write(JSON.stringify(sample) + '\n');
        console.log(`    Warmup [${arm}]: ${res.response.status} (${elapsed.toFixed(0)} ms, ${sample.nodes} nodes, obj: ${sample.objective.toFixed(2)}, active: ${isCandActive})`);
      }

      // 5 Counterbalanced Alternating Pairs: AB, BA, AB, BA, AB
      const pairOrders: Array<['control', typeof candidate] | [typeof candidate, 'control']> = [
        ['control', candidate],
        [candidate, 'control'],
        ['control', candidate],
        [candidate, 'control'],
        ['control', candidate],
      ];

      for (let pIdx = 0; pIdx < pairOrders.length; pIdx++) {
        const pairNum = pIdx + 1;
        const order = pairOrders[pIdx];
        const orderLabel = order[0] === 'control' ? 'AB' : 'BA';
        console.log(`  Pair ${pairNum}/5 (Order ${orderLabel}):`);

        for (const arm of order) {
          const armLabel = arm === 'control' ? 'control' : 'candidate';
          process.stdout.write(`    [${armLabel}] ... `);
          const fullReq = {
            ...testCase.request,
            time_limit_ms: 60000,
            spatial_candidate: arm,
          };
          const t0 = performance.now();
          const res = await page.evaluate(
            (req: any) => (window as any).smokeHarness.runSmoke(req),
            fullReq
          );
          const elapsed = performance.now() - t0;

          const ubVal = res.response.mechanism_telemetry?.upper_bound ?? res.response.optimization?.upper_bound;
          const ubEnc: BoundTelemetry = ubVal === Infinity
            ? { value: null, encoding: 'infinity' }
            : (ubVal != null && Number.isFinite(ubVal))
              ? { value: ubVal, encoding: 'finite' }
              : { value: null, encoding: 'missing' };

          const normGap = res.response.mechanism_telemetry?.normalized_gap ?? (ubEnc.encoding === 'finite' && res.response.objective_value != null ? (ubEnc.value! - res.response.objective_value) / Math.max(1, Math.abs(res.response.objective_value)) : null);
          const absGap = res.response.mechanism_telemetry?.absolute_gap ?? (ubEnc.encoding === 'finite' && res.response.objective_value != null ? Math.max(0, ubEnc.value! - res.response.objective_value) : null);
          const gapEnc: GapTelemetry = (ubEnc.encoding === 'finite' && normGap != null && Number.isFinite(normGap))
            ? { absolute: absGap, normalized: normGap, encoding: 'finite' }
            : (ubEnc.encoding === 'infinity' || ubEnc.encoding === 'missing')
              ? { absolute: null, normalized: null, encoding: 'open' }
              : { absolute: null, normalized: null, encoding: 'missing' };

          const geomSplits = res.response.mechanism_telemetry?.geometric_splits ?? 0;
          const isCandActive = arm === 'candidate'
            ? (candidate === 'adaptive-envelope' ? geomSplits > 0 : true)
            : false;

          const sample: CanonicalCohortSample = {
            schemaVersion: 1,
            cohort: 'canonical-spatial-cohort',
            candidate,
            caseId: testCase.id,
            sequence: ++sequence,
            pair: pairNum,
            arm: armLabel,
            warmup: false,
            order: orderLabel,
            startedAt: new Date().toISOString(),
            elapsedMs: elapsed,
            workerSolveMs: res.response.solve_time_ms ?? elapsed,
            prepElapsedMs: res.response.prep_elapsed_ms ?? 0,
            status: res.response.status,
            termination: res.response.mechanism_telemetry?.termination ?? res.response.status,
            objective: res.response.objective_value ?? 0,
            lowerBound: res.response.mechanism_telemetry?.lower_bound ?? res.response.objective_value ?? 0,
            upperBound: ubEnc,
            gap: gapEnc,
            nodes: res.response.mechanism_telemetry?.nodes ?? 0,
            validationPassed: res.validationErrors.length === 0,
            validationErrors: res.validationErrors,
            cacheState: 'cold',
            fullRequest: fullReq,
            provenance: PROVENANCE_RECORD,
            mechanismTelemetry: {
              candidate: arm,
              candidate_active: isCandActive,
              nodes: res.response.mechanism_telemetry?.nodes ?? 0,
              geometric_splits: geomSplits,
              linear_splits: res.response.mechanism_telemetry?.linear_splits ?? 0,
              proved_bounds_retained: res.response.mechanism_telemetry?.proved_bounds_retained ?? 0,
              tuned_options: arm === 'candidate' && candidate === 'node-option-tuning' ? PROVENANCE_RECORD.exact_proof_settings : undefined,
              termination: res.response.mechanism_telemetry?.termination ?? res.response.status,
            },
          };
          logStream.write(JSON.stringify(sample) + '\n');
          console.log(`${res.response.status} (${elapsed.toFixed(0)} ms, nodes: ${sample.nodes}, obj: ${sample.objective.toFixed(2)}, UB: ${ubEnc.encoding === 'finite' ? ubEnc.value!.toFixed(2) : ubEnc.encoding}, gap: ${gapEnc.encoding}, active: ${isCandActive})`);
        }
      }
    }

    console.log(`\nCohort for ${candidate} complete. Samples saved to ${outputFile}`);
  } finally {
    logStream.end();
    await browser.close();
    await server.close();
  }
}

async function main() {
  const target = process.argv[2] as 'adaptive-envelope' | 'node-option-tuning';
  const targetCase = process.argv[3];
  if (target === 'adaptive-envelope' || target === 'node-option-tuning') {
    await runCanonicalCohort(target, targetCase);
  } else {
    await runCanonicalCohort('adaptive-envelope', targetCase);
    await runCanonicalCohort('node-option-tuning', targetCase);
  }
}

main().catch(err => {
  console.error('Cohort execution failed:', err);
  process.exit(1);
});
