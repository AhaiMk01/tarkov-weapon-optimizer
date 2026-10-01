import * as fs from 'node:fs';
import * as path from 'node:path';
import puppeteer from 'puppeteer-core';
import type { Browser, Page, CDPSession } from 'puppeteer-core';
import type { BenchmarkCase, BrowserResult, Sample, Snapshot } from './types.ts';

export function findBrowserExecutable(): string {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }
  const roots = [
    process.env['PROGRAMFILES'] || 'C:\\Program Files',
    process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)',
    process.env['LOCALAPPDATA'] || '',
  ].filter(Boolean);

  const candidates = [
    'Google\\Chrome\\Application\\chrome.exe',
    'Microsoft\\Edge\\Application\\msedge.exe',
    'Chromium\\Application\\chrome.exe',
  ];

  for (const root of roots) {
    for (const rel of candidates) {
      const full = path.join(root, rel);
      if (fs.existsSync(full)) return full;
    }
  }

  // Linux / macOS standard paths
  for (const p of ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) {
    if (fs.existsSync(p)) return p;
  }

  throw new Error('No Chromium/Chrome executable found. Set CHROME_BIN environment variable.');
}

export interface BrowserRunnerOptions {
  url?: string;
  executablePath?: string;
  headless?: boolean;
}

interface BenchmarkWindow {
  benchmark: {
    prepare(snapshot: Snapshot): Promise<{ gunsCount: number; modsCount: number; coldLoadMs: number }>;
    run(caseItem: BenchmarkCase, deadlineMs: number, variant?: 'baseline' | 'candidate'): Promise<BrowserResult>;
    clearCache(variant?: 'baseline' | 'candidate'): Promise<void>;
    getStatus(variant?: 'baseline' | 'candidate'): Promise<any>;
  };
}

export class BenchmarkBrowserRunner {
  private url: string;
  private executablePath: string;
  private headless: boolean;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private cdpClient: CDPSession | null = null;
  private runId: string | undefined;
  private sourceRevision: string | undefined;
  public coldLoadMs: number | null = null;

  setRunIdentity(runId: string, sourceRevision: string): void {
    this.runId = runId;
    this.sourceRevision = sourceRevision;
  }

  constructor(opts: BrowserRunnerOptions = {}) {
    this.url = opts.url || 'http://localhost:5173/benchmarks/index.html';
    this.executablePath = opts.executablePath || findBrowserExecutable();
    this.headless = opts.headless !== false;
  }

  async start(): Promise<void> {
    this.browser = await puppeteer.launch({
      executablePath: this.executablePath,
      headless: this.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    this.page = await this.browser.newPage();
    await this.page.goto(this.url, { waitUntil: 'networkidle0', timeout: 30000 });
    await this.page.waitForFunction('typeof window.benchmark !== "undefined"', { timeout: 10000 });
  }

  async prepare(snapshot: Snapshot): Promise<{ gunsCount: number; modsCount: number; coldLoadMs: number }> {
    if (!this.page) throw new Error('Browser runner not started');
    const res = await this.page.evaluate(
      (snap: Snapshot) => (window as unknown as BenchmarkWindow).benchmark.prepare(snap),
      snapshot,
    );
    this.coldLoadMs = res.coldLoadMs;
    return res;
  }

  async clearCache(variant?: 'baseline' | 'candidate'): Promise<void> {
    if (!this.page) throw new Error('Browser runner not started');
    await this.page.evaluate(
      (v?: 'baseline' | 'candidate') => (window as unknown as BenchmarkWindow).benchmark.clearCache(v),
      variant,
    );
  }

  private async workerJsHeap(): Promise<number | null> {
    if (!this.browser) return null;
    // Dedicated module workers are target type "other", and the Performance domain
    // is not available on those sessions. Runtime.getHeapUsage is.
    const targets = this.browser.targets().filter(target => target.url().includes('solver.worker'));
    let sum = 0;
    let attached = 0;
    for (const target of targets) {
      try {
        const session = await target.createCDPSession();
        const usage = await session.send('Runtime.getHeapUsage') as { usedSize?: number };
        if (typeof usage.usedSize === 'number' && Number.isFinite(usage.usedSize)) {
          sum += usage.usedSize;
          attached++;
        }
        await session.detach().catch(() => undefined);
      } catch {
        // Leave the gap explicit when a worker session cannot be evaluated.
      }
    }
    return attached > 0 ? sum : null;
  }

  async getStatus(variant: 'baseline' | 'candidate' = 'candidate'): Promise<any> {
    if (!this.page) throw new Error('Browser runner not started');
    return this.page.evaluate((v: 'baseline' | 'candidate') => (window as unknown as BenchmarkWindow).benchmark.getStatus(v), variant);
  }

  async runCase(
    caseItem: BenchmarkCase,
    opts: {
      variant: 'baseline' | 'candidate';
      repetition: number;
      warmup: boolean;
      sequence: number;
      deadlineMs?: number;
      experiment?: string;
      cohort?: 'pilot' | 'formal';
      endpointCache?: string;
      baselineRevision?: string;
      candidateRevision?: string;
      candidatePatch?: string;
      runId?: string;
      sourceRevision?: string;
    },
  ): Promise<Sample> {
    if (!this.page) throw new Error('Browser runner not started');
    const deadlineMs = opts.deadlineMs ?? 60000;
    const startedAt = new Date().toISOString();
    const pageErrors: string[] = [];

    const onPageError = (err: unknown) => {
      pageErrors.push(String(err));
    };
    this.page.on('pageerror', onPageError);

    let outcome: Sample['outcome'] = 'response';
    let result: BrowserResult | null = null;
    let error: string | undefined;

    if (!this.cdpClient && this.page) {
      this.cdpClient = await this.page.createCDPSession();
      await this.cdpClient.send('Performance.enable');
    }

    let beforeHeap: number | null = null;
    if (this.cdpClient) {
      try {
        const m = await this.cdpClient.send('Performance.getMetrics');
        const h = m.metrics.find(x => x.name === 'JSHeapUsedSize');
        if (h) beforeHeap = h.value;
      } catch {}
    }
    const workerBefore = await this.workerJsHeap();

    try {
      result = await this.page.evaluate(
        (c: BenchmarkCase, d: number, v: 'baseline' | 'candidate') => (window as unknown as BenchmarkWindow).benchmark.run(c, d, v),
        caseItem,
        deadlineMs,
        opts.variant,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('Timeout') || msg.includes('timeout')) {
        outcome = 'timeout';
      } else {
        outcome = 'error';
      }
      error = msg;
    } finally {
      this.page.off('pageerror', onPageError);
    }

    let afterHeap: number | null = null;
    if (this.cdpClient) {
      try {
        const m = await this.cdpClient.send('Performance.getMetrics');
        const h = m.metrics.find(x => x.name === 'JSHeapUsedSize');
        if (h) afterHeap = h.value;
      } catch {}
    }
    const workerAfter = await this.workerJsHeap();

    return {
      schemaVersion: 1,
      sequence: opts.sequence,
      caseId: caseItem.id,
      variant: opts.variant,
      repetition: opts.repetition,
      warmup: opts.warmup,
      request: caseItem,
      startedAt,
      coldLoadMs: this.coldLoadMs,
      elapsedMs: result ? result.elapsedMs : null,
      deadlineMs,
      outcome,
      response: result ? result.response : undefined,
      validation: result ? result.validation : undefined,
      error,
      pageErrors,
      memory: {
        scope: 'page-js-heap-excludes-worker-wasm',
        before: beforeHeap,
        after: afterHeap,
        workerJsHeapBefore: workerBefore,
        workerJsHeapAfter: workerAfter,
      },
      experiment: opts.experiment,
      cohort: opts.cohort,
      endpointCache: opts.endpointCache,
      endpointReuse: result?.response && 'endpoint_cache' in result.response
        ? (result.response as { endpoint_cache?: 'hit' | 'miss' }).endpoint_cache
        : undefined,
      runId: opts.runId ?? this.runId,
      sourceRevision: opts.sourceRevision ?? this.sourceRevision,
      baselineRevision: opts.baselineRevision,
      candidateRevision: opts.candidateRevision,
      candidatePatch: opts.candidatePatch,
    };
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}
