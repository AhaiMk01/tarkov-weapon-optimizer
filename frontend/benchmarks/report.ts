import type { Sample } from './types.ts';
import type { OptimizeResponse } from '../src/api/client.ts';

export interface SampleClassification {
  certified: boolean;
  certificateModel: 'precise' | 'fast' | 'unknown';
  validatedBuild: boolean;
  solverStatus?: string;
  gap?: number;
}

export function classifySample(sample: Sample): SampleClassification {
  if (sample.outcome !== 'response' || !sample.response) {
    return { certified: false, certificateModel: 'unknown', validatedBuild: false };
  }

  // Explore requests currently return points array without top-level certified bounds
  if (sample.request.kind === 'explore' || !('selected_items' in sample.response)) {
    return {
      certified: false,
      certificateModel: 'unknown',
      validatedBuild: false,
      solverStatus: 'status' in sample.response ? String((sample.response as Record<string, unknown>).status) : undefined,
    };
  }

  const optRes = sample.response as OptimizeResponse;
  const validatedBuild = !!sample.validation?.checked && sample.validation.errors.length === 0;
  const certificateModel = (optRes.precision_resolved === 'precise' || optRes.precision_resolved === 'fast')
    ? optRes.precision_resolved
    : 'unknown';

  const opt = optRes.optimization;
  if (!opt || optRes.status !== 'optimal') {
    return {
      certified: false,
      certificateModel,
      validatedBuild,
      solverStatus: optRes.status,
    };
  }

  const gap = opt.upper_bound - opt.lower_bound;
  const isFiniteGap = Number.isFinite(gap) && gap >= -1e-9;
  const withinTol = isFiniteGap && gap <= opt.tolerance + 1e-9;
  const certified = validatedBuild && withinTol && opt.termination === 'optimal';

  return {
    certified,
    certificateModel,
    validatedBuild,
    solverStatus: optRes.status,
    gap: isFiniteGap ? gap : undefined,
  };
}

export interface SummaryGroup {
  variant: 'baseline' | 'candidate';
  caseId: string;
  samples: number;
  certified: number;
  completionRate: number;
  certifiedLatenciesMs: number[];
  medianLatencyMs: number | null;
}

export interface PairedComparison {
  caseId: string;
  repetition: number;
  baselineMs: number;
  candidateMs: number;
  speedup: number;
}

export interface BenchmarkSummary {
  groups: SummaryGroup[];
  pairs: PairedComparison[];
}

export function summarize(samples: Sample[]): BenchmarkSummary {
  // Exclude warmups for formal statistics
  const nonWarmup = samples.filter(s => !s.warmup);

  // Group by variant and caseId
  const groupMap = new Map<string, { variant: 'baseline' | 'candidate'; caseId: string; samples: Sample[] }>();
  for (const s of nonWarmup) {
    const key = `${s.variant}:${s.caseId}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, { variant: s.variant, caseId: s.caseId, samples: [] });
    }
    groupMap.get(key)!.samples.push(s);
  }

  const groups: SummaryGroup[] = [];
  for (const entry of groupMap.values()) {
    const totalCount = entry.samples.length;
    const certifiedLatenciesMs: number[] = [];
    let certifiedCount = 0;

    for (const s of entry.samples) {
      const cls = classifySample(s);
      if (cls.certified && s.elapsedMs != null) {
        certifiedCount++;
        certifiedLatenciesMs.push(s.elapsedMs);
      }
    }

    certifiedLatenciesMs.sort((a, b) => a - b);
    let medianLatencyMs: number | null = null;
    if (certifiedLatenciesMs.length > 0) {
      const mid = Math.floor(certifiedLatenciesMs.length / 2);
      medianLatencyMs = certifiedLatenciesMs.length % 2 === 1
        ? certifiedLatenciesMs[mid]
        : (certifiedLatenciesMs[mid - 1] + certifiedLatenciesMs[mid]) / 2;
    }

    groups.push({
      variant: entry.variant,
      caseId: entry.caseId,
      samples: totalCount,
      certified: certifiedCount,
      completionRate: totalCount > 0 ? certifiedCount / totalCount : 0,
      certifiedLatenciesMs,
      medianLatencyMs,
    });
  }

  // Compute paired comparisons sequentially per case (preserves pairs across multiple runs)
  const baselinesByCase = new Map<string, Sample[]>();
  const candidatesByCase = new Map<string, Sample[]>();

  for (const s of nonWarmup) {
    if (s.variant === 'baseline') {
      if (!baselinesByCase.has(s.caseId)) baselinesByCase.set(s.caseId, []);
      baselinesByCase.get(s.caseId)!.push(s);
    } else if (s.variant === 'candidate') {
      if (!candidatesByCase.has(s.caseId)) candidatesByCase.set(s.caseId, []);
      candidatesByCase.get(s.caseId)!.push(s);
    }
  }

  const pairs: PairedComparison[] = [];
  for (const [caseId, baseList] of baselinesByCase) {
    const candList = candidatesByCase.get(caseId) || [];
    const count = Math.min(baseList.length, candList.length);
    for (let i = 0; i < count; i++) {
      const baseSample = baseList[i];
      const candSample = candList[i];
      const baseCls = classifySample(baseSample);
      const candCls = classifySample(candSample);

      if (baseCls.certified && candCls.certified && baseSample.elapsedMs != null && candSample.elapsedMs != null) {
        pairs.push({
          caseId,
          repetition: baseSample.repetition,
          baselineMs: baseSample.elapsedMs,
          candidateMs: candSample.elapsedMs,
          speedup: candSample.elapsedMs > 0 ? baseSample.elapsedMs / candSample.elapsedMs : 1,
        });
      }
    }
  }

  return { groups, pairs };
}

export function formatMarkdownReport(summary: BenchmarkSummary, meta?: Record<string, unknown>, rawSamples?: Sample[]): string {
  const lines: string[] = [];
  lines.push('# Benchmark Summary Report');
  lines.push('');
  if (meta) {
    lines.push('## Environment & Metadata');
    for (const [k, v] of Object.entries(meta)) {
      lines.push(`- **${k}**: ${JSON.stringify(v)}`);
    }
    lines.push('');
  }

  lines.push('## Per-Case Group Summary');
  lines.push('| Variant | Case ID | Samples | Certified | Completion Rate | Median Latency (ms) |');
  lines.push('|---|---|---:|---:|---:|---:|');
  for (const g of summary.groups) {
    lines.push(`| ${g.variant} | ${g.caseId} | ${g.samples} | ${g.certified} | ${(g.completionRate * 100).toFixed(1)}% | ${g.medianLatencyMs != null ? g.medianLatencyMs.toFixed(1) : 'N/A'} |`);
  }
  lines.push('');

  if (summary.pairs.length > 0) {
    lines.push('## Paired Completed Comparisons');
    lines.push('| Case ID | Repetition | Baseline (ms) | Candidate (ms) | Speedup |');
    lines.push('|---|---:|---:|---:|---:|');
    for (const p of summary.pairs) {
      lines.push(`| ${p.caseId} | ${p.repetition} | ${p.baselineMs.toFixed(1)} | ${p.candidateMs.toFixed(1)} | ${p.speedup.toFixed(2)}x |`);
    }
    lines.push('');
  }

  if (rawSamples && rawSamples.length > 0) {
    const nonWarmup = rawSamples.filter(s => !s.warmup);
    if (nonWarmup.length > 0) {
      lines.push('## Detailed Sample Outcomes');
      lines.push('| Case ID | Rep | Variant | Outcome | Status | Termination | Validated | Gap | Bound Range | Elapsed (ms) |');
      lines.push('|---|---:|---|---|---|---|:---:|---:|---:|---:|');
      for (const s of nonWarmup) {
        const resp = s.response as (OptimizeResponse | undefined);
        const opt = resp?.optimization;
        const status = resp?.status ?? (s.outcome === 'timeout' ? 'timeout' : 'N/A');
        const term = opt?.termination ?? 'N/A';
        const val = s.validation?.checked ? (s.validation.errors.length === 0 ? 'yes' : `errors(${s.validation.errors.length})`) : 'no';
        const gap = opt?.absolute_gap != null ? opt.absolute_gap.toExponential(2) : (opt ? 'inf' : 'N/A');
        const lo = opt?.lower_bound != null ? opt.lower_bound.toFixed(2) : '?';
        const hi = opt?.upper_bound != null ? opt.upper_bound.toFixed(2) : 'inf';
        const bounds = opt ? `[${lo}, ${hi}]` : 'N/A';
        const elapsed = s.elapsedMs != null ? s.elapsedMs.toFixed(1) : (s.outcome === 'timeout' ? `>=${s.deadlineMs}` : 'N/A');
        lines.push(`| ${s.caseId} | ${s.repetition} | ${s.variant} | ${s.outcome} | ${status} | ${term} | ${val} | ${gap} | ${bounds} | ${elapsed} |`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
