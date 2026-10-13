/**
 * Exact rational arithmetic over BigInt for the physical build validator (ADR 0010 section 2, INTERPRETATIONS.md choice 3).
 *
 * Every finite binary64 leaf of the lookup and of the request denotes the exact rational value of its double (0.2 is
 * 3602879701896397 / 2^54, never 1/5). Sums, products and comparisons are exact, so a cap is compared with the true value of the
 * statistic and a build one unit in the last place over a cap is rejected. Doubles enter only through {@link ratFromDouble}; a result
 * leaves through {@link ratString} (canonical text) or {@link ratToNumber} (the nearest double, for display and transport only, never
 * fed back into an exact comparison).
 *
 * A `Rat` is normalized: `d > 0` and `gcd(|n|, d) = 1`, so field equality is rational equality. This module is deliberately independent
 * of the LP, its scaling and the decoder: the validator exists to check what they produced.
 */

export interface Rat {
  readonly n: bigint;
  readonly d: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

export const RAT_ZERO: Rat = Object.freeze({ n: 0n, d: 1n });
export const RAT_ONE: Rat = Object.freeze({ n: 1n, d: 1n });

/** The rational n/d (integers only; doubles go through {@link ratFromDouble}). */
export function rat(n: bigint, d: bigint = 1n): Rat {
  if (d === 0n) throw new RangeError('Rat: zero denominator');
  if (n === 0n) return RAT_ZERO;
  let nn = n;
  let dd = d;
  if (dd < 0n) {
    nn = -nn;
    dd = -dd;
  }
  const g = gcd(nn, dd);
  if (g !== 1n) {
    nn /= g;
    dd /= g;
  }
  return Object.freeze({ n: nn, d: dd });
}

/** The integer n as a rational (n must be a safe integer). */
export function ratInt(n: number): Rat {
  if (!Number.isSafeInteger(n)) throw new RangeError(`ratInt: ${String(n)} is not a safe integer`);
  return rat(BigInt(n));
}

const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);

/** The exact value of a finite binary64, decoded from its bit pattern. Throws on NaN and the infinities. */
export function ratFromDouble(x: number): Rat {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new RangeError(`ratFromDouble: non-finite input ${String(x)}`);
  f64[0] = x;
  const bits = u64[0];
  const negative = (bits >> 63n) === 1n;
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  if (exponent === 0 && fraction === 0n) return RAT_ZERO;
  const mantissa = exponent === 0 ? fraction : (1n << 52n) | fraction;
  // value = mantissa * 2^(e - 1075) for normals; subnormals use e = 1.
  const power = (exponent === 0 ? 1 : exponent) - 1075;
  const signed = negative ? -mantissa : mantissa;
  return power >= 0 ? rat(signed << BigInt(power), 1n) : rat(signed, 1n << BigInt(-power));
}

export const ratAdd = (a: Rat, b: Rat): Rat => rat(a.n * b.d + b.n * a.d, a.d * b.d);
export const ratSub = (a: Rat, b: Rat): Rat => rat(a.n * b.d - b.n * a.d, a.d * b.d);
export const ratMul = (a: Rat, b: Rat): Rat => rat(a.n * b.n, a.d * b.d);
export function ratDiv(a: Rat, b: Rat): Rat {
  if (b.n === 0n) throw new RangeError('Rat: division by zero');
  return rat(a.n * b.d, a.d * b.n);
}

export function ratSum(values: Iterable<Rat>): Rat {
  let acc = RAT_ZERO;
  for (const v of values) acc = ratAdd(acc, v);
  return acc;
}

export function ratCmp(a: Rat, b: Rat): -1 | 0 | 1 {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
}
export const ratLt = (a: Rat, b: Rat): boolean => ratCmp(a, b) < 0;
export const ratLe = (a: Rat, b: Rat): boolean => ratCmp(a, b) <= 0;
export const ratGt = (a: Rat, b: Rat): boolean => ratCmp(a, b) > 0;
export const ratGe = (a: Rat, b: Rat): boolean => ratCmp(a, b) >= 0;
export const ratMin = (a: Rat, b: Rat): Rat => (ratCmp(a, b) <= 0 ? a : b);
export const ratMax = (a: Rat, b: Rat): Rat => (ratCmp(a, b) >= 0 ? a : b);

/** floor(x + 1/2): half up. */
export function ratRoundHalfUp(a: Rat): Rat {
  const shifted = ratAdd(a, rat(1n, 2n));
  let floor = shifted.n / shifted.d;
  if (shifted.n % shifted.d !== 0n && shifted.n < 0n) floor -= 1n;
  return rat(floor, 1n);
}

/** Canonical text: `n` for an integer, `n/d` otherwise. */
export const ratString = (a: Rat): string => (a.d === 1n ? a.n.toString() : `${a.n}/${a.d}`);

function bitLength(v: bigint): number {
  return v === 0n ? 0 : v.toString(2).length;
}

/**
 * The double nearest to `a` (ties to even), for display and transport. The quotient carries at least 66 significant bits plus a sticky
 * bit for the remainder, so the single rounding done by `Number(bigint)` is the correct one; scaling by a power of two is exact unless
 * the result is subnormal. Beyond the double range the result is +-Infinity.
 */
export function ratToNumber(a: Rat): number {
  if (a.n === 0n) return 0;
  const negative = a.n < 0n;
  const num = negative ? -a.n : a.n;
  // |a| = quotient * 2^-shift with a 66- or 67-bit quotient, whatever the magnitude of a.
  const shift = 66 - (bitLength(num) - bitLength(a.d));
  let quotient: bigint;
  let sticky: bigint;
  if (shift >= 0) {
    const scaled = num << BigInt(shift);
    quotient = scaled / a.d;
    sticky = scaled % a.d === 0n ? 0n : 1n;
  } else {
    const divisor = a.d << BigInt(-shift);
    quotient = num / divisor;
    sticky = num % divisor === 0n ? 0n : 1n;
  }
  let value = Number((quotient << 1n) | sticky);
  // Scale by 2^-(shift + 1) in exact steps (a power of two is exact until the result becomes subnormal).
  let exponent = -(shift + 1);
  while (exponent !== 0 && value !== 0 && Number.isFinite(value)) {
    const step = Math.max(-1000, Math.min(1000, exponent));
    value *= 2 ** step;
    exponent -= step;
  }
  return negative ? -value : value;
}
