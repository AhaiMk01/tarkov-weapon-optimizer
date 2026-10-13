// Exact rational arithmetic over BigInt (ADR 0010 section 2).
//
// A Q is normalized: d > 0 and gcd(|n|, d) = 1, so structural equality of the two
// fields is rational equality. Binary64 leaves enter only through fromBinary64, which
// decodes the exact value of the double (never a decimal-looking approximation).

export interface Q {
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

function make(n: bigint, d: bigint): Q {
  if (d === 0n) throw new RangeError('Q: zero denominator');
  if (n === 0n) return ZERO;
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

function toBigIntArg(v: bigint | number, what: string): bigint {
  if (typeof v === 'bigint') return v;
  if (!Number.isSafeInteger(v)) {
    throw new RangeError(`q(): ${what} must be a safe integer (got ${v}); use fromBinary64 for doubles`);
  }
  return BigInt(v);
}

export const ZERO: Q = Object.freeze({ n: 0n, d: 1n });
export const ONE: Q = Object.freeze({ n: 1n, d: 1n });

/** The rational n/d from integer arguments. Doubles must go through fromBinary64. */
export function q(n: bigint | number, d: bigint | number = 1n): Q {
  return make(toBigIntArg(n, 'numerator'), toBigIntArg(d, 'denominator'));
}

const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);

/** Exact value of a finite binary64, decoded from its bit pattern. Throws on NaN/Infinity. */
export function fromBinary64(x: number): Q {
  if (typeof x !== 'number' || !Number.isFinite(x)) {
    throw new RangeError(`fromBinary64: non-finite input ${String(x)}`);
  }
  f64[0] = x;
  const bits = u64[0];
  const negative = (bits >> 63n) === 1n;
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  if (exponent === 0 && fraction === 0n) return ZERO;
  const mantissa = exponent === 0 ? fraction : (1n << 52n) | fraction;
  // value = mantissa * 2^(e - 1075) for normals; subnormals use e = 1.
  const power = (exponent === 0 ? 1 : exponent) - 1075;
  const signed = negative ? -mantissa : mantissa;
  return power >= 0 ? make(signed << BigInt(power), 1n) : make(signed, 1n << BigInt(-power));
}

export function parseQ(text: string): Q {
  const m = /^(-?\d+)(?:\/(\d+))?$/.exec(text.trim());
  if (!m) throw new RangeError(`parseQ: not a rational literal: ${text}`);
  return make(BigInt(m[1]), m[2] === undefined ? 1n : BigInt(m[2]));
}

export function add(a: Q, b: Q): Q {
  return make(a.n * b.d + b.n * a.d, a.d * b.d);
}
export function sub(a: Q, b: Q): Q {
  return make(a.n * b.d - b.n * a.d, a.d * b.d);
}
export function mul(a: Q, b: Q): Q {
  return make(a.n * b.n, a.d * b.d);
}
export function div(a: Q, b: Q): Q {
  if (b.n === 0n) throw new RangeError('Q: division by zero');
  return make(a.n * b.d, a.d * b.n);
}
export function neg(a: Q): Q {
  return make(-a.n, a.d);
}
export function abs(a: Q): Q {
  return a.n < 0n ? make(-a.n, a.d) : a;
}
export function sum(xs: Iterable<Q>): Q {
  let acc = ZERO;
  for (const x of xs) acc = add(acc, x);
  return acc;
}

export function cmp(a: Q, b: Q): -1 | 0 | 1 {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
}
export const eq = (a: Q, b: Q): boolean => a.n === b.n && a.d === b.d;
export const lt = (a: Q, b: Q): boolean => cmp(a, b) < 0;
export const le = (a: Q, b: Q): boolean => cmp(a, b) <= 0;
export const gt = (a: Q, b: Q): boolean => cmp(a, b) > 0;
export const ge = (a: Q, b: Q): boolean => cmp(a, b) >= 0;
export const min = (a: Q, b: Q): Q => (cmp(a, b) <= 0 ? a : b);
export const max = (a: Q, b: Q): Q => (cmp(a, b) >= 0 ? a : b);
export const sign = (a: Q): -1 | 0 | 1 => (a.n < 0n ? -1 : a.n > 0n ? 1 : 0);
export const isInteger = (a: Q): boolean => a.d === 1n;

function floorBigInt(a: Q): bigint {
  let f = a.n / a.d;
  if (a.n % a.d !== 0n && a.n < 0n) f -= 1n;
  return f;
}

/** Greatest integer <= a, as a Q. */
export function floorQ(a: Q): Q {
  return make(floorBigInt(a), 1n);
}
/** Least integer >= a, as a Q. */
export function ceilQ(a: Q): Q {
  return make(-floorBigInt(neg(a)), 1n);
}
/** floor(x + 1/2): the declared rounding for legal nonnegative barter totals. */
export function roundHalfUp(a: Q): Q {
  return floorQ(add(a, make(1n, 2n)));
}

export function toString(a: Q): string {
  return a.d === 1n ? a.n.toString() : `${a.n}/${a.d}`;
}

function bitLength(v: bigint): number {
  return v === 0n ? 0 : v.toString(2).length;
}

/** Approximate binary64 value for display only. Never feed this back into exact logic. */
export function toNumber(a: Q): number {
  if (a.n === 0n) return 0;
  const negative = a.n < 0n;
  const num = negative ? -a.n : a.n;
  // Scale so the integer quotient carries at least 64 significant bits.
  const shift = Math.max(0, 64 + bitLength(a.d) - bitLength(num));
  const quotient = (num << BigInt(shift)) / a.d;
  let value = Number(quotient);
  let remaining = shift;
  while (remaining > 0) {
    const step = Math.min(remaining, 1000);
    value /= 2 ** step;
    remaining -= step;
  }
  return negative ? -value : value;
}
