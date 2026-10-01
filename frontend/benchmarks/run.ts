import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureSnapshot, loadAndVerifySnapshot } from './snapshot.ts';
import { makeCases } from './cases.ts';
import { BenchmarkBrowserRunner, findBrowserExecutable } from './browser.ts';
import { formatMarkdownReport, summarize } from './report.ts';
import { planReuseWork } from './reusePlan.ts';
import type { BenchmarkCase, Sample } from './types.ts';

function sourceIdentity(repoRoot: string): { sha: string; label: string; dirty: boolean } {
  const sha = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim();
  const dirty = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' }).trim().length > 0;
  return { sha, label: `${sha.slice(0, 12)}${dirty ? '+dirty' : ''}`, dirty };
}

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

  const experiment = String(flags['experiment'] || (flags['reuse-pairs'] ? 'reuse' : (flags['initial-candidate-pairs'] ? 'initial-candidate' : (flags['branch-ordering-pairs'] ? 'branch-ordering' : (flags['retention-pairs'] ? 'retention' : (flags['pairs'] ? 'bounds' : 'single'))))));
  const isRetention = experiment === 'retention';
  const isBranchOrdering = experiment === 'branch-ordering';
  const isInitialCandidate = experiment === 'initial-candidate';
  const isReuse = experiment === 'reuse';
  const isExperiment = isRetention || isBranchOrdering || isInitialCandidate || isReuse;
  const pairsFlag = flags['reuse-pairs'] || flags['initial-candidate-pairs'] || flags['branch-ordering-pairs'] || flags['retention-pairs'] || flags['pairs'];
  const isPairedMode = Boolean(pairsFlag) || isExperiment;
  const pairCount = typeof pairsFlag === 'number' ? Number(pairsFlag) : (typeof pairsFlag === 'string' ? Number(pairsFlag) : 5);
  const variant: 'baseline' | 'candidate' = (flags['candidate'] || flags['variant'] === 'candidate') ? 'candidate' : 'baseline';
  const runs = isPairedMode ? pairCount : (Number(flags['runs']) || 5);
  const targetCase = flags['case'] ? String(flags['case']) : null;
  const endpointCacheMode = String(flags['endpoint-cache'] || 'warm') as 'warm' | 'cold';
  const cacheState = String(flags['cache-state'] || 'cold') as 'cold' | 'warm';
  const cohort = String(flags['cohort'] || (isExperiment && pairCount >= 5 ? 'formal' : 'pilot')) as 'pilot' | 'formal';
  const repoRoot = path.resolve(__dirname, '../..');
  const source = sourceIdentity(repoRoot);
  const runId = `${experiment}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const outDir = path.resolve(__dirname, String(flags['output'] || path.join('results', 'runs', runId)));
  fs.mkdirSync(outDir, { recursive: true });

  const baselineRevision = isReuse ? '52b2ae9' : 'ed7099e';
  const candidateRevision = isReuse
    ? source.label
    : (isInitialCandidate
      ? 'initial-candidate.patch'
      : (isBranchOrdering
        ? 'branch-ordering-candidate.patch'
        : (isRetention ? 'retention-candidate.patch' : undefined)));
  const candidatePatch = isInitialCandidate
    ? 'frontend/benchmarks/experiments/initial-candidate.patch'
    : (isBranchOrdering
      ? 'frontend/benchmarks/experiments/branch-ordering-candidate.patch'
      : (isRetention ? 'frontend/benchmarks/experiments/retention-candidate.patch' : undefined));
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

  const defaultExperimentCases = isReuse
    ? ['sparse-sweet-seq-1', 'sparse-sweet-seq-2', 'sparse-explore', 'dense-restricted']
    : ['dense-overswing', 'dense-ted', 'dense-ted-sweet'];
  const allCases = makeCases(snapshot);
  const targetCaseList = targetCase ? targetCase.split(',').map(s => s.trim()).filter(Boolean) : [];
  const cases = targetCaseList.length > 0
    ? allCases.filter(c => targetCaseList.some(tc => c.id === tc || c.id.includes(tc)))
    : (isExperiment ? allCases.filter(c => defaultExperimentCases.includes(c.id)) : allCases);

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
  let workerBaselineRevision: string | undefined;
  let workerCandidateRevision: string | undefined;
  runner.setRunIdentity(runId, source.sha);

  try {
    await runner.start();
    console.log('Browser harness ready. Preparing IndexedDB and worker...');
    const prep = await runner.prepare(snapshot);
    console.log(`Harness initialized with ${prep.gunsCount} guns, ${prep.modsCount} mods.`);
    if (isRetention) {
      const statusPayload = await runner.getStatus();
      const hasCapability = Boolean((statusPayload as any)?.capabilities?.retain_limit_incumbent);
      if (!hasCapability) {
        throw new Error(
          'Retention experiment requested, but active worker does not report retain_limit_incumbent capability. ' +
          'Refusing to run identical-policy comparison. Please ensure solver has candidate implementation.'
        );
      }
      console.log('Verified active worker supports retain_limit_incumbent capability.');
    } else if (isBranchOrdering) {
      const statusPayload = await runner.getStatus();
      const hasCapability = Boolean((statusPayload as any)?.capabilities?.branch_ordering);
      if (!hasCapability) {
        throw new Error(
          'Branch ordering experiment requested, but active worker does not report branch_ordering capability. ' +
          'Refusing to run identical-policy comparison. Please ensure solver has candidate implementation.'
        );
      }
      console.log('Verified active worker supports branch_ordering capability.');
    } else if (isInitialCandidate) {
      const statusPayload = await runner.getStatus();
      const hasCapability = Boolean((statusPayload as any)?.capabilities?.initial_candidate);
      if (!hasCapability) {
        throw new Error(
          'Initial candidate experiment requested, but active worker does not report initial_candidate capability. ' +
          'Refusing to run identical-policy comparison. Please ensure solver has candidate implementation.'
        );
      }
      console.log('Verified active worker supports initial_candidate capability.');
    } else if (isReuse) {
      const baseStat = await runner.getStatus('baseline');
      const candStat = await runner.getStatus('candidate');
      const baseRev = baseStat?.revision;
      const candRev = candStat?.revision;
      if (baseRev !== '52b2ae9') {
        throw new Error(`Reuse experiment requested, but baseline worker reports revision "${baseRev}" (expected "52b2ae9").`);
      }
      if (!candRev || candRev === '52b2ae9') {
        throw new Error(`Reuse experiment requested, but candidate worker reports revision "${candRev}" (expected candidate build).`);
      }
      workerBaselineRevision = String(baseRev);
      workerCandidateRevision = String(candRev);
      console.log(`Verified independent builds: baseline=${baseRev}, candidateWorker=${candRev}, source=${source.label}`);
    }

    const work = isReuse
      ? planReuseWork(cases)
      : cases.map(caseItem => ({ kind: 'case' as const, caseItem }));

    for (const workItem of work) {
      if (workItem.kind === 'sequence') {
        const withBounds = (item: BenchmarkCase) => ({ ...item, request: { ...item.request, bounds_mode: 'structural' as const } });
        const firstCase = withBounds(workItem.first);
        const secondCase = withBounds(workItem.second);
        for (let rep = 1; rep <= runs; rep++) {
          const order: Array<'baseline' | 'candidate'> = rep % 2 === 1 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
          process.stdout.write(`  [sequence ${workItem.id} ${rep}/${runs}] `);
          for (const arm of order) {
            await runner.clearCache(arm);
            const s1 = await runner.runCase(firstCase, {
              variant: arm, repetition: rep, warmup: false, sequence: seq++, deadlineMs: 60000,
              experiment, cohort, endpointCache: 'sequence-start', baselineRevision,
              candidateRevision, candidatePatch: isExperiment ? candidatePatch : undefined,
            });
            allSamples.push(s1);
            samplesFile.write(JSON.stringify(s1) + '\n');
            const s2 = await runner.runCase(secondCase, {
              variant: arm, repetition: rep, warmup: false, sequence: seq++, deadlineMs: 60000,
              experiment, cohort, endpointCache: 'sequence-follow', baselineRevision,
              candidateRevision, candidatePatch: isExperiment ? candidatePatch : undefined,
            });
            allSamples.push(s2);
            samplesFile.write(JSON.stringify(s2) + '\n');
            process.stdout.write(`${arm} w1 ${s1.outcome} ${s1.elapsedMs != null ? s1.elapsedMs.toFixed(0) : '?'}ms/${s1.endpointReuse ?? 'n/a'} w2 ${s2.outcome} ${s2.elapsedMs != null ? s2.elapsedMs.toFixed(0) : '?'}ms/${s2.endpointReuse ?? 'n/a'} | `);
          }
          console.log('');
        }
        continue;
      }
      const caseItem = workItem.caseItem;
      const isSweet = Boolean((caseItem.request as any)?.use_tchebycheff);
      const epCache = isSweet ? endpointCacheMode : 'not-applicable';

      if (isPairedMode) {
        const baseCase = isReuse
          ? { ...caseItem, request: { ...caseItem.request, bounds_mode: 'structural' as const } }
          : (isInitialCandidate
            ? { ...caseItem, request: { ...caseItem.request, bounds_mode: 'structural' as const, precise_mode: 'precise' as const, initial_candidate: false } }
            : (isBranchOrdering
              ? { ...caseItem, request: { ...caseItem.request, bounds_mode: 'structural' as const, precise_mode: 'precise' as const, branch_ordering: 'lighter-first' as const } }
              : (isRetention
                ? { ...caseItem, request: { ...caseItem.request, bounds_mode: 'structural' as const, precise_mode: 'precise' as const, retain_limit_incumbent: false } }
                : { ...caseItem, request: { ...caseItem.request, bounds_mode: 'naive' as const } })));

        const candCase = isReuse
          ? { ...caseItem, request: { ...caseItem.request, bounds_mode: 'structural' as const } }
          : (isInitialCandidate
            ? { ...caseItem, request: { ...caseItem.request, bounds_mode: 'structural' as const, precise_mode: 'precise' as const, initial_candidate: true } }
            : (isBranchOrdering
              ? { ...caseItem, request: { ...caseItem.request, bounds_mode: 'structural' as const, precise_mode: 'precise' as const, branch_ordering: 'heavier-first' as const } }
              : (isRetention
                ? { ...caseItem, request: { ...caseItem.request, bounds_mode: 'structural' as const, precise_mode: 'precise' as const, retain_limit_incumbent: true } }
                : { ...caseItem, request: { ...caseItem.request, bounds_mode: 'structural' as const } })));

        // In experiment mode (retention or branch-ordering), warmups are excluded: five alternating pairs only.
        if (!isExperiment) {
          process.stdout.write('  [warmup baseline] ... ');
          const warmBase = await runner.runCase(baseCase, { variant: 'baseline', repetition: 0, warmup: true, sequence: seq++, deadlineMs: 60000, experiment, endpointCache: epCache });
          samplesFile.write(JSON.stringify(warmBase) + '\n');
          process.stdout.write(`${warmBase.outcome} (${warmBase.elapsedMs != null ? warmBase.elapsedMs.toFixed(0) : '?'}ms) | [warmup candidate] ... `);
          const warmCand = await runner.runCase(candCase, { variant: 'candidate', repetition: 0, warmup: true, sequence: seq++, deadlineMs: 60000, experiment, endpointCache: epCache });
          samplesFile.write(JSON.stringify(warmCand) + '\n');
          console.log(`${warmCand.outcome} (${warmCand.elapsedMs != null ? warmCand.elapsedMs.toFixed(0) : '?'}ms)`);
        }

        let endpointCacheStatus = epCache;
        if (isPairedMode && isSweet && endpointCacheMode === 'warm' && !(isReuse && cacheState === 'cold')) {
          process.stdout.write('  [pre-warming both endpoint caches] ... ');
          let bothCertified = true;
          for (const [armVariant, armCase] of [['baseline', baseCase], ['candidate', candCase]] as const) {
            await runner.clearCache(armVariant);
            const prewarmSample = await runner.runCase(armCase, {
              variant: armVariant,
              repetition: 0,
              warmup: true,
              sequence: seq++,
              deadlineMs: 60000,
              experiment,
              cohort,
              endpointCache: 'prewarm',
              baselineRevision,
              candidateRevision: isExperiment ? candidateRevision : undefined,
              candidatePatch: isExperiment ? candidatePatch : undefined,
            });
            samplesFile.write(JSON.stringify(prewarmSample) + '\n');
            const certified = prewarmSample.outcome === 'response' && (prewarmSample.response as any)?.ideal_point != null;
            if (!certified) bothCertified = false;
            process.stdout.write(`${armVariant} ${certified ? 'certified' : 'uncertified'} `);
          }
          if (!bothCertified) {
            console.log('FAILED. Marking cache as failed-prewarm-cold.');
            endpointCacheStatus = 'failed-prewarm-cold';
          } else {
            let bothHit = true;
            for (const [armVariant, armCase] of [['baseline', baseCase], ['candidate', candCase]] as const) {
              const probe = await runner.runCase(armCase, {
                variant: armVariant,
                repetition: 0,
                warmup: true,
                sequence: seq++,
                deadlineMs: 0,
                experiment,
                cohort,
                endpointCache: 'warm-probe',
                baselineRevision,
                candidateRevision: isExperiment ? candidateRevision : undefined,
                candidatePatch: isExperiment ? candidatePatch : undefined,
              });
              samplesFile.write(JSON.stringify(probe) + '\n');
              const observed = probe.endpointReuse;
              const reason = String((probe.response as { reason?: string } | undefined)?.reason ?? '');
              const hit = observed === 'hit' || reason.includes('before search');
              if (!hit) bothHit = false;
              process.stdout.write(`${armVariant} probe ${observed ?? reason} `);
            }
            endpointCacheStatus = bothHit ? 'warm-verified' : 'warm-unverified';
            console.log(bothHit ? 'both caches hit' : 'reuse not verified');
          }
        }

        for (let rep = 1; rep <= runs; rep++) {
          // Counterbalance pair order: odd reps A/B (baseline first), even reps B/A (candidate first)
          const baselineFirst = rep % 2 === 1;
          const firstCase = baselineFirst ? baseCase : candCase;
          const secondCase = baselineFirst ? candCase : baseCase;
          const firstVariant = baselineFirst ? 'baseline' : 'candidate';
          const secondVariant = baselineFirst ? 'candidate' : 'baseline';

          if (isReuse && cacheState === 'cold') {
            await runner.clearCache();
          } else if (isExperiment && isSweet && endpointCacheMode === 'cold') {
            await runner.clearCache();
          }
          process.stdout.write(`  [pair ${rep}/${runs}] ${firstVariant} ... `);
          const firstSample = await runner.runCase(firstCase, {
            variant: firstVariant,
            repetition: rep,
            warmup: false,
            sequence: seq++,
            deadlineMs: 60000,
            experiment,
            cohort,
            endpointCache: isReuse ? cacheState : endpointCacheStatus,
            baselineRevision,
            candidateRevision: isExperiment ? candidateRevision : undefined,
            candidatePatch: isExperiment ? candidatePatch : undefined,
          });
          allSamples.push(firstSample);
          samplesFile.write(JSON.stringify(firstSample) + '\n');
          process.stdout.write(`${firstSample.outcome} (${firstSample.elapsedMs != null ? firstSample.elapsedMs.toFixed(0) : '?'}ms) | ${secondVariant} ... `);

          if (isReuse && cacheState === 'cold') {
            await runner.clearCache();
          } else if (isExperiment && isSweet && endpointCacheMode === 'cold') {
            await runner.clearCache();
          }
          const secondSample = await runner.runCase(secondCase, {
            variant: secondVariant,
            repetition: rep,
            warmup: false,
            sequence: seq++,
            deadlineMs: 60000,
            experiment,
            cohort,
            endpointCache: isReuse ? cacheState : endpointCacheStatus,
            baselineRevision,
            candidateRevision: isExperiment ? candidateRevision : undefined,
            candidatePatch: isExperiment ? candidatePatch : undefined,
          });
          allSamples.push(secondSample);
          samplesFile.write(JSON.stringify(secondSample) + '\n');
          console.log(`${secondSample.outcome} (${secondSample.elapsedMs != null ? secondSample.elapsedMs.toFixed(0) : '?'}ms)`);
        }
      } else {
        process.stdout.write('  [warmup] ... ');
        const warmupSample = await runner.runCase(caseItem, { variant, repetition: 0, warmup: true, sequence: seq++, deadlineMs: 60000, experiment });
        samplesFile.write(JSON.stringify(warmupSample) + '\n');
        console.log(`${warmupSample.outcome} (${warmupSample.elapsedMs != null ? warmupSample.elapsedMs.toFixed(0) : '?'}ms)`);

        for (let rep = 1; rep <= runs; rep++) {
          process.stdout.write(`  [rep ${rep}/${runs}] ... `);
          const sample = await runner.runCase(caseItem, {
            variant,
            repetition: rep,
            warmup: false,
            sequence: seq++,
            deadlineMs: 60000,
            experiment,
            cohort,
          });
          allSamples.push(sample);
          samplesFile.write(JSON.stringify(sample) + '\n');
          console.log(`${sample.outcome} (${sample.elapsedMs != null ? sample.elapsedMs.toFixed(0) : '?'}ms)`);
        }
      }
    }
  } finally {
    samplesFile.end();
    await runner.close();
  }

  const meta: Record<string, unknown> = {
    experiment,
    runId,
    cohort,
    endpointCache: endpointCacheMode,
    cacheState,
    date: new Date().toISOString(),
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpus: os.cpus()[0]?.model ?? 'unknown',
    browser: browserPath,
    snapshotSha256: manifest.sha256,
    gunsCount: manifest.gunsCount,
    modsCount: manifest.modsCount,
    tasksCount: manifest.tasksCount,
    sourceRevision: source.sha,
    sourceLabel: source.label,
    sourceDirty: source.dirty,
    baselineRevision,
    candidateRevision,
    workerBaselineRevision,
    workerCandidateRevision,
    memoryNote: 'Page JS heap is Performance.getMetrics on the page target. Worker figure is the sum of Runtime.getHeapUsage.usedSize on solver worker targets. That is the worker V8 heap, not a separate ideal-point cache size and not a separate HiGHS WebAssembly.Memory reservation.',
  };

  const summary = summarize(allSamples);
  const reportMd = formatMarkdownReport(summary, meta, allSamples);
  fs.writeFileSync(reportPath, reportMd, 'utf8');

  console.log('\n' + reportMd);
  console.log(`\nRaw samples saved to ${samplesPath}`);
  console.log(`Summary report saved to ${reportPath}`);
}

main().catch(err => {
  console.error('Benchmark execution error:', err);
  process.exit(1);
});