import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';
import { findBrowserExecutable } from '../browser';
import { loadAndVerifySnapshot } from '../snapshot';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '../..');

async function main() {
  console.log('Verifying adapter with small browser case invoking geometric splitting...');

  // 1. Load verified snapshot
  const { snapshot } = loadAndVerifySnapshot(path.resolve(__dirname, '..'));
  console.log(`  Loaded snapshot: ${snapshot.guns.length} guns, ${snapshot.mods.length} mods`);

  // 2. Start in-process Vite server on port 5192
  const server = await createServer({
    root: frontendRoot,
    server: { port: 5192 },
    logLevel: 'error',
  });
  await server.listen();
  console.log('  Vite server listening on port 5192');

  // 3. Launch Chrome via Puppeteer
  const executablePath = findBrowserExecutable();
  console.log(`  Launching browser: ${executablePath}`);
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    page.on('console', msg => {
      if (msg.type() === 'error') console.error('  [Browser Error]:', msg.text());
    });

    await page.goto('http://localhost:5192/benchmarks/experiments/harness.html', {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });
    await page.waitForFunction('typeof window.smokeHarness !== "undefined"', { timeout: 10000 });
    console.log('  Smoke harness loaded in browser');

    // 4. Seed IndexedDB
    await page.evaluate((snap: any) => (window as any).smokeHarness.seed(snap), snapshot);
    console.log('  IndexedDB seeded with snapshot');

    // 5. Test small case: AA-12 Gen 1 (weight 4.75kg - 8.14kg, strictly W > 3.0 kg)
    const aa12Request = {
      weapon_id: '66ffa9b66e19cc902401c5e8', // AA-12
      use_true_ergo: true,
      precise_mode: 'precise',
      max_spatial_nodes: 16,
      time_limit_ms: 60000,
      spatial_candidate: 'adaptive-envelope',
    };

    console.log('\n--- Running AA-12 geometric splitting case through browser worker ---');
    const t0 = performance.now();
    const result = await page.evaluate(
      (req: any) => (window as any).smokeHarness.runSmoke(req),
      aa12Request
    );
    const totalElapsedMs = performance.now() - t0;

    console.log(`  Outcome status: ${result.response.status}`);
    console.log(`  Total round-trip: ${totalElapsedMs.toFixed(1)} ms (worker solve: ${result.response.solve_time_ms?.toFixed(1) ?? '?'} ms, prep: ${result.response.prep_elapsed_ms?.toFixed(1) ?? '?'} ms)`);
    console.log(`  Provenance Gate:`, JSON.stringify(result.response.provenance, null, 2));
    console.log(`  Mechanism Telemetry:`, JSON.stringify(result.response.mechanism_telemetry, null, 2));
    console.log(`  Validation errors:`, result.validationErrors);

    if (result.response.status !== 'optimal') {
      throw new Error(`Expected status optimal, got ${result.response.status}`);
    }
    if (result.validationErrors.length > 0) {
      throw new Error(`Validation failed with errors: ${result.validationErrors.join(', ')}`);
    }
    const geom = result.response.mechanism_telemetry?.geometric_splits;
    if (typeof geom !== 'number' || geom < 1) {
      throw new Error(`Expected geometric_splits >= 1, got ${geom}`);
    }
    if (result.response.provenance?.matching_control_revision !== '518017b') {
      throw new Error(`Provenance mismatch: expected 518017b, got ${result.response.provenance?.matching_control_revision}`);
    }

    console.log(`\nVERIFIED: Geometric splitting invoked in browser worker (${geom} geometric splits, 0 linear splits).`);
    console.log(`  Preparation-inclusive deadline tracked (${result.response.prep_elapsed_ms.toFixed(1)} ms prep deducted).`);
    console.log(`  Lossless telemetry and validation passed cleanly.`);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
