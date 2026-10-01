import * as fs from 'node:fs';
import * as path from 'node:path';
import puppeteer from 'puppeteer-core';
import type { Browser, Page } from 'puppeteer-core';
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
    prepare(snapshot: Snapshot): Promise<{ gunsCount: number; modsCount: number }>;
    run(caseItem: BenchmarkCase, deadlineMs: number): Promise<BrowserResult>;
    clearCache(): Promise<void>;
  };
}

export class BenchmarkBrowserRunner {
  private url: string;
  private executablePath: string;
  private headless: boolean;
  private browser: Browser | null = null;
  private page: Page | null = null;

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

  async prepare(snapshot: Snapshot): Promise<{ gunsCount: number; modsCount: number }> {
    if (!this.page) throw new Error('Browser runner not started');
    return this.page.evaluate(
      (snap: Snapshot) => (window as unknown as BenchmarkWindow).benchmark.prepare(snap),
      snapshot,
    );
  }

  async clearCache(): Promise<void> {
    if (!this.page) throw new Error('Browser runner not started');
    await this.page.evaluate(() => (window as unknown as BenchmarkWindow).benchmark.clearCache());
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
      endpointCache?: string;
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

    try {
      result = await this.page.evaluate(
        (c: BenchmarkCase, d: number) => (window as unknown as BenchmarkWindow).benchmark.run(c, d),
        caseItem,
        deadlineMs,
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

    return {
      schemaVersion: 1,
      sequence: opts.sequence,
      caseId: caseItem.id,
      variant: opts.variant,
      repetition: opts.repetition,
      warmup: opts.warmup,
      request: caseItem,
      startedAt,
      coldLoadMs: null,
      elapsedMs: result ? result.elapsedMs : null,
      deadlineMs,
      outcome,
      response: result ? result.response : undefined,
      validation: result ? result.validation : undefined,
      error,
      pageErrors,
      memory: { scope: 'page-js-heap-excludes-worker-wasm', before: null, after: null },
      experiment: opts.experiment,
      endpointCache: opts.endpointCache,
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
