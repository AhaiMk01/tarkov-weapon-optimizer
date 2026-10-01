import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';
import { findBrowserExecutable } from '../browser';
import { loadAndVerifySnapshot } from '../snapshot';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '../..');

export interface CohortSample {
  schemaVersion: 1;
  cohort: 'formal-spatial-cohort';
  candidate: string;
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
  upperBound: number | null;
  absoluteGap: number | null;
  normalizedGap: number | null;
  nodes: number;
  validationPassed: boolean;
  validationErrors: string[];
  cacheState: string;
  provenance: any;
  mechanismTelemetry: any;
}

async function runCandidateCohort(candidate: 'adaptive-envelope' | 'node-option-tuning', targetCaseId?: string) {
  console.log(`\n================================================================`);
  console.log(`Starting formal cohort for: ${candidate}${targetCaseId ? ` (case: ${targetCaseId})` : ''}`);
  console.log(`================================================================`);

  const { snapshot } = loadAndVerifySnapshot(path.resolve(__dirname, '..'));
  const resultsDir = path.resolve(__dirname, '../results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  const outputFile = path.join(resultsDir, `spatial_cohort_${candidate}.jsonl`);
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

    const m4a1Id = '5447a9cd4bdc2dbd208b4567';
    let cases = [
      {
        id: 'dense-ted',
        request: {
          weapon_id: m4a1Id,
          use_true_ergo: true,
          precise_mode: 'precise',
          time_limit_ms: 60000,
        },
      },
      {
        id: 'dense-overswing',
        request: {
          weapon_id: m4a1Id,
          prevent_overswing: true,
          precise_mode: 'precise',
          time_limit_ms: 60000,
        },
      },
    ];
    if (targetCaseId) cases = cases.filter(c => c.id === targetCaseId);

    let sequence = 0;

    for (const testCase of cases) {
      console.log(`\n--- Case: ${testCase.id} (60s shared deadline) ---`);

      // Both-arm warmups
      console.log('  Executing both-arm warmups...');
      for (const arm of ['control', candidate] as const) {
        const t0 = performance.now();
        const res = await page.evaluate(
          (req: any) => (window as any).smokeHarness.runSmoke(req),
          { ...testCase.request, spatial_candidate: arm }
        );
        const elapsed = performance.now() - t0;
        const sample: CohortSample = {
          schemaVersion: 1,
          cohort: 'formal-spatial-cohort',
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
          upperBound: res.response.mechanism_telemetry?.upper_bound ?? null,
          absoluteGap: res.response.mechanism_telemetry?.absolute_gap ?? null,
          normalizedGap: res.response.mechanism_telemetry?.normalized_gap ?? null,
          nodes: res.response.mechanism_telemetry?.nodes ?? 0,
          validationPassed: res.validationErrors.length === 0,
          validationErrors: res.validationErrors,
          cacheState: 'cold',
          provenance: res.response.provenance,
          mechanismTelemetry: res.response.mechanism_telemetry,
        };
        logStream.write(JSON.stringify(sample) + '\n');
        console.log(`    Warmup [${arm}]: ${res.response.status} (${elapsed.toFixed(0)} ms, ${sample.nodes} nodes)`);
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
          const t0 = performance.now();
          const res = await page.evaluate(
            (req: any) => (window as any).smokeHarness.runSmoke(req),
            { ...testCase.request, spatial_candidate: arm }
          );
          const elapsed = performance.now() - t0;

          const sample: CohortSample = {
            schemaVersion: 1,
            cohort: 'formal-spatial-cohort',
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
            upperBound: res.response.mechanism_telemetry?.upper_bound ?? null,
            absoluteGap: res.response.mechanism_telemetry?.absolute_gap ?? null,
            normalizedGap: res.response.mechanism_telemetry?.normalized_gap ?? null,
            nodes: res.response.mechanism_telemetry?.nodes ?? 0,
            validationPassed: res.validationErrors.length === 0,
            validationErrors: res.validationErrors,
            cacheState: 'cold',
            provenance: res.response.provenance,
            mechanismTelemetry: res.response.mechanism_telemetry,
          };
          logStream.write(JSON.stringify(sample) + '\n');
          console.log(`${res.response.status} (${elapsed.toFixed(0)} ms, nodes: ${sample.nodes}, gap: ${sample.normalizedGap != null ? sample.normalizedGap.toExponential(2) : 'open'})`);
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
    await runCandidateCohort(target, targetCase);
  } else {
    await runCandidateCohort('adaptive-envelope', targetCase);
    await runCandidateCohort('node-option-tuning', targetCase);
  }
}

main().catch(err => {
  console.error('Cohort execution failed:', err);
  process.exit(1);
});
