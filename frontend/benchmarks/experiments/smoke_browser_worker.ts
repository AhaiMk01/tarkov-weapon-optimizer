import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';
import { findBrowserExecutable } from '../browser';
import { loadAndVerifySnapshot } from '../snapshot';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '../..');

async function main() {
  console.log('Starting browser worker smoke test for spatial candidates...');

  // 1. Load verified snapshot
  const { snapshot } = loadAndVerifySnapshot(path.resolve(__dirname, '..'));
  console.log(`  Loaded snapshot: ${snapshot.guns.length} guns, ${snapshot.mods.length} mods`);

  // 2. Start in-process Vite server on port 5190
  const server = await createServer({
    root: frontendRoot,
    server: { port: 5190 },
    logLevel: 'error',
  });
  await server.listen();
  console.log('  Vite server listening on port 5190');

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

    await page.goto('http://localhost:5190/benchmarks/experiments/harness.html', {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });
    await page.waitForFunction('typeof window.smokeHarness !== "undefined"', { timeout: 10000 });
    console.log('  Smoke harness loaded in browser');

    // 4. Seed IndexedDB
    await page.evaluate((snap: any) => (window as any).smokeHarness.seed(snap), snapshot);
    console.log('  IndexedDB seeded with snapshot');

    // 5. Test cases for smoke run
    // M4A1 in Prevent Overswing mode with maxSpatialNodes: 2, timeLimitMs: 60000
    const m4a1Request = {
      weapon_id: '5447a9cd4bdc2dbd208b4567', // M4A1
      prevent_overswing: true,
      max_spatial_nodes: 2,
      time_limit_ms: 60000,
    };

    const candidates: Array<'adaptive-envelope' | 'node-option-tuning' | 'control'> = [
      'adaptive-envelope',
      'node-option-tuning',
      'control',
    ];

    for (const cand of candidates) {
      console.log(`\n--- Smoking ${cand} through browser worker ---`);
      const t0 = performance.now();
      const result = await page.evaluate(
        (req: any) => (window as any).smokeHarness.runSmoke(req),
        { ...m4a1Request, spatial_candidate: cand }
      );
      const totalElapsedMs = performance.now() - t0;

      console.log(`  Outcome status: ${result.response.status}`);
      console.log(`  Total round-trip: ${totalElapsedMs.toFixed(1)} ms (worker: ${result.response.worker_elapsed_ms?.toFixed(1) ?? '?'} ms)`);
      console.log(`  Mechanism Telemetry:`, JSON.stringify(result.response.mechanism_telemetry, null, 2));
      console.log(`  Validation errors count: ${result.validationErrors.length}`);
      if (result.validationErrors.length > 0) {
        console.error(`  Errors:`, result.validationErrors);
        throw new Error(`Smoke test failed validation for ${cand}`);
      }
      if (result.response.status !== 'optimal' && result.response.status !== 'feasible') {
        throw new Error(`Smoke test returned unexpected status: ${result.response.status}`);
      }
      console.log(`  ${cand} smoke PASSED.`);
    }

    console.log('\nAll candidates smoked through browser worker successfully!');
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch(err => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
