// Differential parity of the production occurrence-level validator with the reference validator (Stage 2, phase 2.4b-3a).
//
// ADR 0010 section 5: production `validateBuild` must "reproduce every reference accept and reject, including rooted instance bijection,
// template/self/slot conflicts, categories, required occupancy, acquisition/quantity caps, exact spend, clamp/TED and provisional MOA formulas".
// Every ledger case is mapped into the production lookup and request (validator.differential.ts) and judged by both validators on the same builds:
//
//   (a) every (base, tree) build the oracle enumerates, including the ones its own validator rejects for caps or availability: the same
//       accept/reject, the same violation code set, the same exact statistics and the same per-occurrence acquisition sources;
//   (b) deterministic invalid mutations of seed builds (drop a required child, duplicate an instance id, reparent to a missing parent or into a
//       cycle, add a conflicting or illegal item, swap the item, slot or base, claim a wrong spend) and request mutations (every hard cap at its exact
//       value and one ulp either side, Prevent Overswing and gear, market gating, owned stock, includes and excludes): the same verdict;
//   (c) counts per family, printed as diagnostics, and a non-vacuity check on the comparator and on the code coverage;
//   (d) the hand-derived builds of the ledger itself: rejections with exactly their codes, accepts, exact statistics and provenance.
//
// Any disagreement is a production bug. The two production-only codes (a claimed spend that differs from the exact recomputation) are asserted
// separately: they must appear exactly on a wrong claim and never otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEDGER } from '../ledger/index';
import { parseQ, toNumber, type ReferenceBuild, type ReferenceRequest, type ViolationCode } from '../oracle/index';
import { REFERENCE_VIOLATION_CODES } from '../../src/solver/physical';
import {
  buildMutations, compareVerdicts, enumeratedBuilds, judgeFor, prepareValidatorCase, productionVerdict, requestMutations, spread, type Judge,
  type ValidatorCase, type Verdict,
} from './validator.differential';

// The production code list is the reference's list, verbatim: a union that differs in either direction does not compile.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const sameCodes: Equal<ViolationCode, (typeof REFERENCE_VIOLATION_CODES)[number]> = true;

const cases = LEDGER.map(prepareValidatorCase);
const compared = cases.filter(c => c.skipped.length === 0);
const ledgerCase = (id: string) => LEDGER.find(l => l.id === id)!;

interface Tally {
  cases: number;
  builds: number;
  accepted: number;
  rejected: number;
  mutations: number;
  requestVariants: number;
  disagreements: string[];
}
const families = new Map<number, Tally>();
const tallyOf = (family: number): Tally => {
  let t = families.get(family);
  if (!t) {
    t = { cases: 0, builds: 0, accepted: 0, rejected: 0, mutations: 0, requestVariants: 0, disagreements: [] };
    families.set(family, t);
  }
  return t;
};
const kinds = new Map<string, number>();
const countKind = (kind: string) => kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
const codesSeen = new Map<string, number>();
const countCodes = (verdict: Verdict) => verdict.codes.forEach(code => codesSeen.set(code, (codesSeen.get(code) ?? 0) + 1));

/** Compare one build under one judge; records a disagreement on the tally. */
function check(c: ValidatorCase, judge: Judge, build: ReferenceBuild, label: string, extra: Parameters<typeof compareVerdicts>[2] = [], claimedSpend?: number): Verdict {
  const reference = judge.reference(build);
  const difference = compareVerdicts(reference, productionVerdict(judge.production(build, claimedSpend)), extra);
  if (difference !== null) tallyOf(c.family).disagreements.push(`${c.id} [${label}]: ${difference}`);
  countCodes(reference);
  return reference;
}

test('the harness compares nearly every ledger case and lists the rest', t => {
  const skipped = cases.filter(c => c.skipped.length > 0);
  assert.equal(compared.length + skipped.length, LEDGER.length);
  assert.ok(compared.length >= LEDGER.length - 10, `only ${compared.length} of ${LEDGER.length} cases are compared`);
  const reasons = new Map<string, number>();
  for (const c of skipped) for (const s of c.skipped) reasons.set(s.split(':')[0], (reasons.get(s.split(':')[0]) ?? 0) + 1);
  t.diagnostic(`compared ${compared.length} of ${LEDGER.length} ledger cases; skipped ${skipped.length}: ${[...reasons].map(([k, n]) => `${k} x${n}`).join(', ') || 'none'}`);
  t.diagnostic(`skipped ids: ${skipped.map(c => c.id).join(', ') || 'none'}`);
  const mismatched = compared.filter(c => c.barterPriceMismatches > 0);
  assert.deepEqual(mismatched.map(c => c.id), [], 'every mapped barter lot price is the reference exact rounding (production barterLotPrice), the .5 boundary case included');
});

test('(a) every build the oracle enumerates gets the reference verdict, code set, statistics and sources', () => {
  for (const c of compared) {
    const { builds, complete } = enumeratedBuilds(c);
    assert.ok(complete, `${c.id}: the enumeration is complete`);
    const judge = judgeFor(c, c.request);
    const t = tallyOf(c.family);
    t.cases++;
    builds.forEach((build, k) => {
      const verdict = check(c, judge, build, `tree ${k}`);
      t.builds++;
      if (verdict.ok) t.accepted++;
      else t.rejected++;
    });
  }
  const failures = [...families.values()].flatMap(t => t.disagreements);
  assert.deepEqual(failures.slice(0, 20), [], `${failures.length} disagreement(s)`);
  assert.ok([...families.values()].reduce((n, t) => n + t.builds, 0) >= 900, 'the enumerated population is not vacuous');
});

test('(b) invalid mutations of seed builds and request mutations keep the verdict', () => {
  for (const c of compared) {
    const t = tallyOf(c.family);
    const caseJudge = judgeFor(c, c.request);
    const { builds } = enumeratedBuilds(c);
    const expected = ledgerCase(c.id).expected;
    const seeds: ReferenceBuild[] = [
      ...(expected.accepts ?? []).map(a => a.build),
      ...(expected.rejections ?? []).map(r => r.build),
      ...spread(builds, 10),
    ];
    for (const seed of seeds) {
      const stats = caseJudge.stats(seed);
      const exactSpend = stats ? toNumber(stats.spend) : null;
      for (const mutation of buildMutations(c, seed, exactSpend)) {
        t.mutations++;
        countKind(mutation.kind);
        const extra = mutation.kind === 'claim-spend-wrong' ? (['CLAIMED_SPEND_MISMATCH'] as const) : [];
        check(c, caseJudge, mutation.build, mutation.kind, extra, mutation.claimedSpend);
      }
    }
    const cache = new Map<string, Judge>();
    for (const seed of spread(seeds, 4)) {
      const stats = caseJudge.stats(seed);
      for (const variant of requestMutations(c, stats)) {
        const key = JSON.stringify(variant.request);
        let judge = cache.get(key);
        if (!judge) {
          judge = judgeFor(c, variant.request as ReferenceRequest);
          cache.set(key, judge);
        }
        t.requestVariants++;
        countKind(`request:${variant.kind}`);
        check(c, judge, seed, `${variant.kind} ${variant.label}`);
      }
    }
  }
  const failures = [...families.values()].flatMap(t => t.disagreements);
  assert.deepEqual(failures.slice(0, 20), [], `${failures.length} disagreement(s)`);
});

test('(c) counts per family and the code coverage', t => {
  const rows = [...families.entries()].sort((a, b) => a[0] - b[0]).map(([f, x]) =>
    `F${String(f).padStart(2, '0')}: ${x.cases} cases, ${x.builds} enumerated builds (${x.accepted} accepted, ${x.rejected} rejected), ${x.mutations} build mutations, ${x.requestVariants} request variants, ${x.disagreements.length} disagreements`);
  for (const row of rows) t.diagnostic(row);
  const total = [...families.values()].reduce((n, x) => ({ builds: n.builds + x.builds, mutations: n.mutations + x.mutations, requests: n.requests + x.requestVariants }), { builds: 0, mutations: 0, requests: 0 });
  t.diagnostic(`total: ${total.builds} enumerated builds, ${total.mutations} build mutations, ${total.requests} request variants`);
  t.diagnostic(`operators: ${[...kinds].sort().map(([k, n]) => `${k} x${n}`).join(', ')}`);
  t.diagnostic(`reference codes exercised: ${[...codesSeen].sort().map(([k, n]) => `${k} x${n}`).join(', ')}`);
  assert.ok(total.mutations >= 5000 && total.requests >= 5000, 'the mutation populations are not vacuous');
  assert.equal(sameCodes, true);
  const missing = REFERENCE_VIOLATION_CODES.filter(code => !codesSeen.has(code));
  assert.deepEqual(missing, [], 'every reference violation code is exercised by some compared build');
});

test('(d) the hand-derived builds of the ledger: rejections with exactly their codes, accepts, exact statistics, provenance', () => {
  const problems: string[] = [];
  let rejections = 0, accepts = 0, statChecks = 0, provenance = 0;
  for (const c of compared) {
    const expected = ledgerCase(c.id).expected;
    const judge = judgeFor(c, c.request);
    for (const r of expected.rejections ?? []) {
      rejections++;
      const codes = [...new Set(judge.production(r.build).violations.map(v => v.code))].sort();
      if (JSON.stringify(codes) !== JSON.stringify([...r.codes].sort())) problems.push(`${c.id} rejection "${r.label}": expected [${r.codes.join(',')}], production [${codes.join(',')}]`);
    }
    for (const a of expected.accepts ?? []) {
      accepts++;
      const result = judge.production(a.build);
      if (!result.ok) problems.push(`${c.id} accept "${a.label}": production rejects with [${result.violations.map(v => v.code).join(',')}]`);
    }
    for (const sc of expected.statChecks ?? []) {
      statChecks++;
      const stats = judge.production(sc.build).stats;
      if (!stats) { problems.push(`${c.id} stats "${sc.label}": production has no statistics`); continue; }
      for (const [name, value] of Object.entries(sc.values)) {
        const actual = (stats.exact as Record<string, string>)[name];
        if (actual !== value) problems.push(`${c.id} stats "${sc.label}" ${name}: expected ${value}, production ${actual}`);
      }
      if (sc.overswingNonzero !== undefined && (stats.exact.overswingPercent !== '0') !== sc.overswingNonzero) problems.push(`${c.id} stats "${sc.label}": overswing nonzero should be ${sc.overswingNonzero}`);
    }
    for (const pc of expected.provenance ?? []) {
      provenance++;
      const stats = judge.production(pc.build).stats;
      if (!stats) { problems.push(`${c.id} provenance "${pc.label}": production has no statistics`); continue; }
      const actual = stats.acquisition.occurrences;
      if (actual.length !== pc.occurrences.length) { problems.push(`${c.id} provenance "${pc.label}": ${actual.length} occurrences, expected ${pc.occurrences.length}`); continue; }
      let charged = 0;
      pc.occurrences.forEach((want, k) => {
        const got = actual[k];
        const via: string | undefined = got.offerSource === null ? undefined : got.offerSource === 'fleaMarket' ? 'flea' : got.offerSource.startsWith('barter:') ? 'barter' : 'trader';
        if (got.instanceId !== want.instanceId || got.source !== want.source || (want.via ?? undefined) !== via) {
          problems.push(`${c.id} provenance "${pc.label}" #${k}: expected ${want.instanceId} ${want.source}/${want.via ?? '-'}, production ${got.instanceId} ${got.source}/${via ?? '-'}`);
        }
        charged += got.price - toNumber(parseQ(want.charged));
      });
      if (charged !== 0) problems.push(`${c.id} provenance "${pc.label}": the charges do not add up to the expected ones (off by ${charged})`);
    }
  }
  assert.deepEqual(problems.slice(0, 20), [], `${problems.length} problem(s)`);
  assert.ok(rejections >= 100 && accepts >= 5 && statChecks >= 50 && provenance >= 5, `the ledger builds are not vacuous (${rejections}/${accepts}/${statChecks}/${provenance})`);
});

test('the comparator is not vacuous: a wrong verdict, code, statistic or source is detected', () => {
  const base: Verdict = { ok: false, codes: ['MAX_PRICE_EXCEEDED'], stats: { spend: '5100' }, sources: ['offer'] };
  assert.equal(compareVerdicts(base, { ...base }), null);
  assert.match(compareVerdicts(base, { ...base, ok: true, codes: [] }) ?? '', /codes/);
  assert.match(compareVerdicts(base, { ...base, codes: ['MAX_WEIGHT_EXCEEDED'] }) ?? '', /codes/);
  assert.match(compareVerdicts(base, { ...base, stats: { spend: '5101' } }) ?? '', /spend/);
  assert.match(compareVerdicts(base, { ...base, stats: null }) ?? '', /statistics/);
  assert.match(compareVerdicts(base, { ...base, sources: ['owned'] }) ?? '', /sources/);
  assert.match(compareVerdicts(base, { ...base, codes: ['CLAIMED_SPEND_MISMATCH', 'MAX_PRICE_EXCEEDED'] }) ?? '', /production-only/);
  assert.equal(compareVerdicts(base, { ...base, codes: ['CLAIMED_SPEND_MISMATCH', 'MAX_PRICE_EXCEEDED'] }, ['CLAIMED_SPEND_MISMATCH']), null);
  assert.match(compareVerdicts(base, { ...base }, ['CLAIMED_SPEND_MISMATCH']) ?? '', /did not report/);
  // An accepted reference build must stay accepted unless a production-only code is expected.
  const accepted: Verdict = { ok: true, codes: [], stats: { spend: '5000' }, sources: [] };
  assert.equal(compareVerdicts(accepted, { ...accepted, ok: false, codes: ['CLAIMED_SPEND_MISMATCH'] }, ['CLAIMED_SPEND_MISMATCH']), null);
});
