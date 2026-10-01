import type { BenchmarkCase } from './types.ts';

export type ReuseWorkItem =
  | { kind: 'case'; caseItem: BenchmarkCase }
  | { kind: 'sequence'; id: string; first: BenchmarkCase; second: BenchmarkCase };

/** Pair weight-change Sweet Spot cases so the second request can reuse the first request's endpoints. */
export function planReuseWork(cases: BenchmarkCase[]): ReuseWorkItem[] {
  const byId = new Map(cases.map(item => [item.id, item]));
  const consumed = new Set<string>();
  const plan: ReuseWorkItem[] = [];
  for (const item of cases) {
    if (consumed.has(item.id)) continue;
    const match = /^(.*)-sweet-seq-1$/.exec(item.id);
    const second = match ? byId.get(`${match[1]}-sweet-seq-2`) : undefined;
    if (match && second) {
      consumed.add(item.id);
      consumed.add(second.id);
      plan.push({ kind: 'sequence', id: `${match[1]}-sweet-seq`, first: item, second });
      continue;
    }
    consumed.add(item.id);
    plan.push({ kind: 'case', caseItem: item });
  }
  return plan;
}
