// Documented source-to-offer rules, written independently of the production adapter and
// extractors. They are the reference side of the differential checks.
//
// This file keeps its OWN rational arithmetic (Rational, gcd, ratAdd, ratMul, decodeBinary64) on
// purpose. It is a second, independent implementation of the barter valuation: the oracle values
// the same barters with oracle/q.ts, and bridge/toFixture.offers.test.ts cross-checks the two on
// every mapped barter of the pinned capture. Merging them would turn that cross-check into a
// self-comparison, so do not "deduplicate" this module against oracle/q.ts.
//
//  * Synthesized flea offer (CLAUDE.md "Data Source", mirroring tarkov-api's items datasource):
//    skipped for `noFlea` items or when `lastLowPrice` is absent/zero; priced
//    `avg24hPrice || lastLowPrice`. (`||`, so a zero or absent average falls back.)
//  * Barter valuation (ADR 0010 §2/§5): total = sum(count * (avg24hPrice ?? basePrice ?? 0)),
//    evaluated EXACTLY over Q on the decoded binary64 leaves; an offer exists iff total > 0 and
//    its integer price is floor(total + 1/2). (`??`, so a zero average does not fall through.)
import { SourceError } from './rawReader';
import type { RawWorld, RefBarter, RefItem } from './rawReader';

/** An exact ratio num/den with den > 0, kept in lowest terms. */
export interface Rational {
  readonly num: bigint;
  readonly den: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

function reduced(num: bigint, den: bigint): Rational {
  if (num === 0n) return { num: 0n, den: 1n };
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}

/** Decode a finite binary64 value to its exact integer ratio (ADR 0010 §2). */
export function decodeBinary64(x: number): Rational {
  if (!Number.isFinite(x)) throw new RangeError(`cannot decode non-finite binary64 value ${x}`);
  if (x === 0) return { num: 0n, den: 1n };
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const sign = bits >> 63n === 1n ? -1n : 1n;
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  const mantissa = exponent === 0 ? fraction : fraction | (1n << 52n);
  const power = exponent === 0 ? -1074 : exponent - 1075;
  const num = power >= 0 ? mantissa << BigInt(power) : mantissa;
  const den = power >= 0 ? 1n : 1n << BigInt(-power);
  return reduced(sign * num, den);
}

export function ratAdd(a: Rational, b: Rational): Rational {
  return reduced(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function ratMul(a: Rational, b: Rational): Rational {
  return reduced(a.num * b.num, a.den * b.den);
}

function floorDiv(a: bigint, b: bigint): bigint {
  let q = a / b;
  if (a % b !== 0n && (a < 0n) !== (b < 0n)) q -= 1n;
  return q;
}

/** floor(x + 1/2) on an exact ratio. */
export function roundHalfUp(x: Rational): bigint {
  return floorDiv(2n * x.num + x.den, 2n * x.den);
}

/** The flea offer the JSON API implies for an item, or null when none is synthesized. */
export function referenceFleaOffer(item: RefItem): { priceRUB: number } | null {
  if (item.noFlea || !item.lastLowPrice) return null;
  return { priceRUB: item.avg24hPrice || item.lastLowPrice || 0 };
}

/** Exact barter cost: sum(count * (avg24hPrice ?? basePrice ?? 0)) over Q. */
export function referenceBarterTotal(world: RawWorld, barter: RefBarter): Rational {
  let total: Rational = { num: 0n, den: 1n };
  for (const requirement of barter.requirements) {
    const source = world.items.get(requirement.itemId);
    if (!source) {
      throw new SourceError(`barter ${barter.id}`, `requirement item "${requirement.itemId}" is unresolved`);
    }
    const unitPrice = source.avg24hPrice ?? source.basePrice ?? 0;
    total = ratAdd(total, ratMul(decodeBinary64(requirement.count), decodeBinary64(unitPrice)));
  }
  return total;
}

/** The priced barter offer, or null when the exact total is not positive (no offer exists). */
export function referenceBarterOffer(world: RawWorld, barter: RefBarter): { priceRUB: number; total: Rational } | null {
  const total = referenceBarterTotal(world, barter);
  if (total.num <= 0n) return null;
  return { priceRUB: Number(roundHalfUp(total)), total };
}
