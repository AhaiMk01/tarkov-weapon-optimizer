import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureSnapshot, loadAndVerifySnapshot } from './snapshot.ts';
import { makeCases } from './cases.ts';
import { BenchmarkBrowserRunner, findBrowserExecutable } from './browser.ts';
import { formatMarkdownReport, summarize } from './report.ts';
import type { Sample } from './types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(args: string[]) {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[name] = args[++i];
      } else {
        flags[name] = true;
      }
    }
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  if (flags['capture-snapshot']) {
    await captureSnapshot(__dirname);
    return;
  }

  const outDir = path.resolve(__dirname, String(flags['output'] || 'results'));
  fs.mkdirSync(outDir, { recursive: true });

  const runs = Number(flags['runs']) || 5;
  const targetCase = flags['case'] ? String(flags['case']) : null;
  const url = String(flags['url'] || 'http://localhost:5173/benchmarks/index.html');
  const browserPath = flags['browser'] ? String(flags['browser']) : findBrowserExecutable();

  console.log('Loading snapshot and manifest...');
  let snapshotData;
  try {
    snapshotData = loadAndVerifySnapshot(__dirname);
  } catch {
    console.log('Snapshot missing or invalid, capturing fresh snapshot...');
    await captureSnapshot(__dirname);
    snapshotData = loadAndVerifySnapshot(__dirname);
  }

  const { snapshot, manifest } = snapshotData;
  console.log(`Verified snapshot sha256: ${manifest.sha256}`);

  const allCases = makeCases(snapshot);
  const cases = targetCase
    ? allCases.filter(c => c.id === targetCase || c.id.includes(targetCase))
    : allCases;

  if (cases.length === 0) {
    throw new Error(`No cases matched filter "${targetCase}". Available: ${allCases.map(c => c.id).join(', ')}`);
  }

  console.log(`Running benchmark on ${cases.length} cases (runs: ${runs}, browser: ${browserPath})...`);

  const runner = new BenchmarkBrowserRunner({
    url,
    executablePath: browserPath,
    headless: true,
  });

  const samplesPath = path.join(outDir, 'samples.jsonl');
  const reportPath = path.join(outDir, 'report.md');
  const samplesFile = fs.createWriteStream(samplesPath, { flags: 'a', encoding: 'utf8' });

  const allSamples: Sample[] = [];
  let seq = 1;

  try {
    await runner.start();
    console.log('Browser harness ready. Preparing IndexedDB and worker...');
    const prep = await runner.prepare(snapshot);
    console.log(`Harness initialized with ${prep.gunsCount} guns, ${prep.modsCount} mods.`);

    for (const caseItem of cases) {
      console.log(`\n=== Case: ${caseItem.id} (${caseItem.description}) ===`);

      // 1. Warm-up run
      process.stdout.write('  [warmup] ... ');
      const warmupSample = await runner.runCase(caseItem, {
        variant: 'baseline',
        repetition: 0,
        warmup: true,
        sequence: seq++,
        deadlineMs: 60000,
      });
      samplesFile.write(JSON.stringify(warmupSample) + '\n');
      console.log(`${warmupSample.outcome} (${warmupSample.elapsedMs != null ? warmupSample.elapsedMs.toFixed(0) : '?'}ms)`);

      // 2. Measured repetitions
      for (let rep = 1; rep <= runs; rep++) {
        process.stdout.write(`  [rep ${rep}/${runs}] ... `);
        const sample = await runner.runCase(caseItem, {
          variant: 'baseline',
          repetition: rep,
          warmup: false,
          sequence: seq++,
          deadlineMs: 60000,
        });
        allSamples.push(sample);
        samplesFile.write(JSON.stringify(sample) + '\n');
        console.log(`${sample.outcome} (${sample.elapsedMs != null ? sample.elapsedMs.toFixed(0) : '?'}ms)`);
      }
    }
  } finally {
    samplesFile.end();
    await runner.close();
  }

  const meta = {
    date: new Date().toISOString(),
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpus: os.cpus()[0]?.model ?? 'unknown',
    browser: browserPath,
    snapshotSha256: manifest.sha256,
    gunsCount: manifest.gunsCount,
    modsCount: manifest.modsCount,
    tasksCount: manifest.tasksCount,
  };

  const summary = summarize(allSamples);
  const reportMd = formatMarkdownReport(summary, meta);
  fs.writeFileSync(reportPath, reportMd, 'utf8');

  console.log('\n' + reportMd);
  console.log(`\nRaw samples saved to ${samplesPath}`);
  console.log(`Summary report saved to ${reportPath}`);
}

main().catch(err => {
  console.error('Benchmark execution error:', err);
  process.exit(1);
});
