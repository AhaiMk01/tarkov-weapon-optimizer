// Shared LP fixtures for the native HiGHS tests.

/** maximize x + y  s.t.  x + 2y <= 4, 0 <= x <= 3.123456789012. Optimum: x = 3.123456789012 (an inexact decimal), y = (4 - x) / 2. */
export const PRECISION_LP = 'Maximize\n obj: x + y\nSubject To\n c1: x + 2 y <= 4\nBounds\n 0 <= x <= 3.123456789012\nEnd\n';
export const PRECISION_X = 3.123456789012;
export const PRECISION_Y = (4 - 3.123456789012) / 2;

/** The README example of the highs-js package: optimum 87.5 at (17.5, 1, 16.5, 2). */
export const HIGHS_JS_README_LP = `Maximize
 obj:
    x1 + 2 x2 + 4 x3 + x4
Subject To
 c1: - x1 + x2 + x3 + 10 x4 <= 20
 c2: x1 - 4 x2 + x3 <= 30
 c3: x2 - 0.5 x4 = 0
Bounds
 0 <= x1 <= 40
 2 <= x4 <= 3
End`;

export const INFEASIBLE_LP = 'Maximize\n obj: x\nSubject To\n c1: x >= 5\n c2: x <= 3\nEnd\n';
export const UNBOUNDED_LP = 'Maximize\n obj: x\nSubject To\n c1: x - y <= 3\nEnd\n';

/** Seeded generator (deterministic across runs and machines). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A 0/1 knapsack MIP with `n` items; hard enough that stopping at the first improving solution is not proven optimality. */
export function knapsackLp(n: number, seed = 1): string {
  const rand = rng(seed);
  const weights: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < n; i++) {
    weights.push(Math.floor(20 + rand() * 80));
    values.push(weights[i] + 10 + Math.floor(rand() * 5));
  }
  const capacity = Math.floor(weights.reduce((a, b) => a + b, 0) / 2);
  const terms = (coefs: number[]): string => coefs.map((c, i) => `${i ? '+ ' : ''}${c} x${i}`).join(' ');
  const names = weights.map((_, i) => `x${i}`).join(' ');
  return `Maximize\n obj: ${terms(values)}\nSubject To\n cap: ${terms(weights)} <= ${capacity}\nBinary\n ${names}\nEnd\n`;
}

/**
 * A random sparse mixed model written the way the model writers write it (`String(n)` numbers, one row per line): continuous,
 * integer and binary columns, all three row senses, finite and infinite bounds, negative and fractional coefficients.
 */
export function randomModelLp(seed: number, columns = 60, rows = 40): string {
  const rand = rng(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
  const number = (): string => String(pick([1, -1, 2, 0.5, -0.25, 3.14159265358979, 1e-7, -1e-6, 12345.6789, 1e9, -7e8, 0.1, 100]));
  const names = Array.from({ length: columns }, (_, j) => `v${j}`);
  const terms = (count: number): string => {
    const used = new Set<number>();
    while (used.size < count) used.add(Math.floor(rand() * columns));
    return [...used].map((j, k) => { const c = number(); return `${k === 0 ? '' : c.startsWith('-') ? '- ' : '+ '}${k === 0 ? c : c.startsWith('-') ? c.slice(1) : c} ${names[j]}`; }).join(' ');
  };
  const lines: string[] = [rand() < 0.5 ? 'Maximize' : 'Minimize', ` obj: ${terms(Math.min(10, columns))}`, 'Subject To'];
  for (let i = 0; i < rows; i++) {
    const op = pick(['<=', '>=', '=']);
    lines.push(` r${i}: ${terms(2 + Math.floor(rand() * 5))} ${op} ${pick([0, 1, -3, 17.5, 1e6, -2.5e-3])}`);
  }
  lines.push('Bounds');
  for (let j = 0; j < columns; j++) {
    const kind = j % 6;
    if (kind === 0) lines.push(` 0 <= ${names[j]} <= 10`);
    else if (kind === 1) lines.push(` -5 <= ${names[j]} <= 7`);
    else if (kind === 2) lines.push(` ${names[j]} free`);
    else if (kind === 3) lines.push(` ${names[j]} >= -2`);
    else if (kind === 4) lines.push(` ${names[j]} <= 1e6`);
  }
  const generals = names.filter((_, j) => j % 6 === 1 || j % 6 === 4);
  const binaries = names.filter((_, j) => j % 6 === 5);
  lines.push('General', ` ${generals.join(' ')}`, 'Binary', ` ${binaries.join(' ')}`, 'End');
  return `${lines.join('\n')}\n`;
}
