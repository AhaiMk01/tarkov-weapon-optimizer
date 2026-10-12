// Stage 3 workstream 3.6a: the reference-versus-production validator agreement covers EVERY ledger build and EVERY rejection code (ADR 0013 section 7:
// "full ledger/reference-versus-production validator agreement"). Complements validator.differential.test.ts, which compares the oracle's enumerated
// builds, mutations of seed builds and request variants, and checks the hand-derived rejections against their expected codes. This file closes what
// that one does not state directly:
//
//   1. every HAND-DERIVED ledger build (rejections, accepts, statistic checks, provenance checks and near-cap checks) is judged by BOTH validators under
//      the case request with the full comparator (verdict, code set, exact statistics, per-occurrence sources);
//   2. the same builds and the oracle's enumerated builds are judged again under the validator configuration production PUBLISHES with
//      (`requirePathInstanceIds: true`, as solvePrecise / solveFast prepare it): the verdict is the reference's, plus the production-only
//      INSTANCE_ID_NOT_PATH_DERIVED exactly when a child id is not `parent/slot:item`;
//   3. a coverage table: for every reference violation code, the ledger cases whose hand-derived rejections carry it and how many enumerated builds
//      exercise it; every code is exercised by a compared ledger build (hand-derived or enumerated), and every code a hand-derived rejection names is
//      one of the reference codes;
//   4. the production-only codes are listed with what exercises them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEDGER } from '../ledger/index';
import type { LedgerCase } from '../ledger/index';
import { inspectBuild, resolveFixture, resolveRequest, type ReferenceBuild } from '../oracle/index';
import { preparePhysicalValidator, PRODUCTION_ONLY_VIOLATION_CODES, REFERENCE_VIOLATION_CODES } from '../../src/solver/physical';
import type { PhysicalViolationCode } from '../../src/solver/physical';
import {
  compareVerdicts, enumeratedBuilds, judgeFor, prepareValidatorCase, productionRequestOf, productionVerdict, referenceVerdict, toPhysicalBuild,
} from './validator.differential';

const cases = LEDGER.map(prepareValidatorCase);
const compared = cases.filter(c => c.skipped.length === 0);
const ledgerCase = (id: string): LedgerCase => LEDGER.find(l => l.id === id)!;

interface HandBuild { kind: 'rejection' | 'accept' | 'statCheck' | 'provenance' | 'capCheck'; label: string; build: ReferenceBuild; codes?: readonly string[] }

/** Every build the ledger case itself writes down. */
function handBuilds(c: LedgerCase): HandBuild[] {
  const e = c.expected;
  return [
    ...(e.rejections ?? []).map(r => ({ kind: 'rejection' as const, label: r.label, build: r.build, codes: r.codes })),
    ...(e.accepts ?? []).map(a => ({ kind: 'accept' as const, label: a.label, build: a.build })),
    ...(e.statChecks ?? []).map(s => ({ kind: 'statCheck' as const, label: s.label, build: s.build })),
    ...(e.provenance ?? []).map(p => ({ kind: 'provenance' as const, label: p.label, build: p.build })),
    ...(c.runtimeTolerance.capCheck ? [{ kind: 'capCheck' as const, label: `cap check ${c.runtimeTolerance.capCheck.stat}`, build: c.runtimeTolerance.capCheck.build }] : []),
  ];
}

const pathDerived = (build: ReferenceBuild): boolean => build.placements.every(p => p.childInstanceId === `${p.parentInstanceId}/${p.slotId}:${p.itemId}`);

test('every ledger case is compared (none skipped), so "every ledger build" is every build of all the cases', () => {
  assert.equal(compared.length, LEDGER.length, `skipped: ${cases.filter(c => c.skipped.length > 0).map(c => `${c.id} (${c.skipped.join('; ')})`).join(', ')}`);
});

test('1. every hand-derived ledger build gets the same verdict, code set, exact statistics and sources from both validators', t => {
  const disagreements: string[] = [];
  const kinds = new Map<string, number>();
  for (const c of compared) {
    const judge = judgeFor(c, c.request);
    for (const hb of handBuilds(ledgerCase(c.id))) {
      kinds.set(hb.kind, (kinds.get(hb.kind) ?? 0) + 1);
      const reference = judge.reference(hb.build);
      const difference = compareVerdicts(reference, productionVerdict(judge.production(hb.build)));
      if (difference !== null) disagreements.push(`${c.id} ${hb.kind} "${hb.label}": ${difference}`);
      if (hb.kind === 'rejection') {
        const want = [...new Set(hb.codes)].sort();
        if (JSON.stringify(reference.codes) !== JSON.stringify(want)) disagreements.push(`${c.id} rejection "${hb.label}": the reference reports [${reference.codes.join(',')}], the ledger [${want.join(',')}]`);
      }
      if (hb.kind === 'accept' && !reference.ok) disagreements.push(`${c.id} accept "${hb.label}": the reference rejects it`);
    }
  }
  t.diagnostic(`hand-derived builds compared: ${[...kinds].sort().map(([k, n]) => `${k} x${n}`).join(', ')}`);
  assert.deepEqual(disagreements.slice(0, 20), [], `${disagreements.length} disagreement(s)`);
  assert.ok((kinds.get('rejection') ?? 0) >= 100 && (kinds.get('accept') ?? 0) >= 5, 'the hand-derived population is not vacuous');
});

test('2. under the validator configuration production publishes with (path-derived instance ids required), every ledger build keeps the reference verdict', t => {
  const disagreements: string[] = [];
  let builds = 0;
  let notPathDerived = 0;
  for (const c of compared) {
    const fixture = resolveFixture(c.fixture);
    const request = resolveRequest(c.fixture, c.request);
    const strict = preparePhysicalValidator(c.lookup, productionRequestOf(c.request), { requirePathInstanceIds: true });
    const population: { label: string; build: ReferenceBuild }[] = [
      ...handBuilds(ledgerCase(c.id)).map(hb => ({ label: `${hb.kind} "${hb.label}"`, build: hb.build })),
      ...enumeratedBuilds(c).builds.map((build, k) => ({ label: `tree ${k}`, build })),
    ];
    for (const { label, build } of population) {
      builds++;
      const extra: PhysicalViolationCode[] = pathDerived(build) ? [] : ['INSTANCE_ID_NOT_PATH_DERIVED'];
      if (extra.length > 0) notPathDerived++;
      const difference = compareVerdicts(referenceVerdict(fixture, request, build), productionVerdict(strict.validate(toPhysicalBuild(build))), extra);
      if (difference !== null) disagreements.push(`${c.id} [${label}]: ${difference}`);
    }
  }
  t.diagnostic(`${builds} ledger builds judged under requirePathInstanceIds; ${notPathDerived} carry a non-path-derived child id (production-only INSTANCE_ID_NOT_PATH_DERIVED required on exactly those)`);
  assert.deepEqual(disagreements.slice(0, 20), [], `${disagreements.length} disagreement(s)`);
  assert.ok(builds >= 1000);
});

test('3. rejection-code coverage: every reference code is exercised by compared ledger builds; the table of hand-derived rejections per code', t => {
  const handCases = new Map<string, Set<string>>();
  const handCount = new Map<string, number>();
  const enumerated = new Map<string, number>();
  for (const code of REFERENCE_VIOLATION_CODES) { handCases.set(code, new Set()); handCount.set(code, 0); enumerated.set(code, 0); }
  const unknown: string[] = [];
  for (const c of compared) {
    const l = ledgerCase(c.id);
    for (const r of l.expected.rejections ?? []) {
      for (const code of new Set(r.codes)) {
        if (!handCases.has(code)) { unknown.push(`${c.id}: ${code}`); continue; }
        handCases.get(code)!.add(c.id);
        handCount.set(code, handCount.get(code)! + 1);
      }
    }
    const fixture = resolveFixture(c.fixture);
    const request = resolveRequest(c.fixture, c.request);
    for (const build of enumeratedBuilds(c).builds) {
      for (const code of new Set(inspectBuild(fixture, request, build).violations.map(v => v.code))) enumerated.set(code, (enumerated.get(code) ?? 0) + 1);
    }
  }
  assert.deepEqual(unknown, [], 'every code a hand-derived rejection names is a reference code');
  for (const code of REFERENCE_VIOLATION_CODES) {
    const ids = [...handCases.get(code)!].sort();
    t.diagnostic(`${code}: ${handCount.get(code)} hand-derived rejection(s) in ${ids.length} case(s) [${ids.join(', ')}]; ${enumerated.get(code)} enumerated build(s)`);
  }
  // The ledger writes its builds over the fixture's own ids, so three input-shape codes never occur in a ledger build: they are exercised by the
  // mutations of validator.differential.test.ts (b) and by the per-case malformed builds of test 3b below.
  const unexercised = REFERENCE_VIOLATION_CODES.filter(code => handCount.get(code) === 0 && enumerated.get(code) === 0);
  assert.deepEqual(unexercised, [...MALFORMED_ONLY], 'every other reference code is exercised by a compared ledger build (hand-derived or enumerated)');
  const onlyEnumerated = REFERENCE_VIOLATION_CODES.filter(code => handCount.get(code) === 0 && (enumerated.get(code) ?? 0) > 0);
  t.diagnostic(`codes with no hand-derived rejection (exercised by enumerated builds): ${onlyEnumerated.join(', ') || 'none'}`);
  t.diagnostic(`codes in no ledger build (exercised by malformed builds, 3b): ${MALFORMED_ONLY.join(', ')}`);
});

/** Reference codes that need ids the ledger fixtures do not hold: an unknown preset, item or slot. */
const MALFORMED_ONLY = ['BASE_UNKNOWN_PRESET', 'UNKNOWN_ITEM', 'UNKNOWN_SLOT'] as const;

test('3b. the codes no ledger build carries, on every ledger case: an unknown preset base, an unknown item and an unknown slot get the same verdict from both validators', t => {
  const disagreements: string[] = [];
  const exercised = new Map<string, Set<string>>(MALFORMED_ONLY.map(code => [code, new Set<string>()]));
  for (const c of compared) {
    const judge = judgeFor(c, c.request);
    // Legal shapes first (an enumerated tree), so the malformed id is the only structural fault of the variant.
    const seeds = [...enumeratedBuilds(c).builds, ...handBuilds(ledgerCase(c.id)).map(hb => hb.build)];
    const seed = seeds.find(b => b.placements.length > 0) ?? seeds[0];
    if (seed === undefined) continue;
    const variants: { code: (typeof MALFORMED_ONLY)[number]; build: ReferenceBuild }[] = [
      { code: 'BASE_UNKNOWN_PRESET', build: { ...seed, base: { kind: 'preset', presetId: 'ghost-preset' } } },
    ];
    if (seed.placements.length > 0) {
      const [first, ...rest] = seed.placements;
      variants.push({ code: 'UNKNOWN_ITEM', build: { ...seed, placements: [{ ...first, itemId: 'ghost-item' }, ...rest] } });
      variants.push({ code: 'UNKNOWN_SLOT', build: { ...seed, placements: [{ ...first, slotId: 'ghost-slot' }, ...rest] } });
    }
    for (const v of variants) {
      const reference = judge.reference(v.build);
      if (reference.codes.includes(v.code)) exercised.get(v.code)!.add(c.id);
      const difference = compareVerdicts(reference, productionVerdict(judge.production(v.build)));
      if (difference !== null) disagreements.push(`${c.id} ${v.code}: ${difference}`);
    }
  }
  for (const [code, ids] of exercised) t.diagnostic(`${code}: exercised on ${ids.size} ledger case(s)`);
  assert.deepEqual(disagreements.slice(0, 20), [], `${disagreements.length} disagreement(s)`);
  for (const [code, ids] of exercised) assert.ok(ids.size >= 100, `${code} on ${ids.size} cases`);
});

test('4. the production-only codes: CLAIMED_SPEND_MISMATCH from claimed spends (validator.differential.test.ts (b)), INSTANCE_ID_NOT_PATH_DERIVED from the strict configuration (2 above), CLAIMED_ACQUISITION_MISMATCH from a claimed provenance', () => {
  assert.deepEqual([...PRODUCTION_ONLY_VIOLATION_CODES].sort(), ['CLAIMED_ACQUISITION_MISMATCH', 'CLAIMED_SPEND_MISMATCH', 'INSTANCE_ID_NOT_PATH_DERIVED']);
  // CLAIMED_ACQUISITION_MISMATCH: a claimed provenance that differs from the exact recomputation, and none when the claim is the exact one, on every ledger
  // accept that installs at least one part. The physical verdict and the shared codes are unchanged (the reference has no claims).
  let checked = 0;
  for (const c of compared) {
    const validator = preparePhysicalValidator(c.lookup, productionRequestOf(c.request));
    const fixture = resolveFixture(c.fixture);
    const request = resolveRequest(c.fixture, c.request);
    for (const a of ledgerCase(c.id).expected.accepts ?? []) {
      if (a.build.placements.length === 0) continue;
      const physical = toPhysicalBuild(a.build);
      const exact = validator.validate(physical);
      assert.ok(exact.ok && exact.stats !== null, `${c.id} accept "${a.label}"`);
      const claims = exact.stats.acquisition.occurrences.map(o => ({
        instanceId: o.instanceId, itemId: o.itemId, source: o.source, price: o.price,
        ...(o.presetId === null ? {} : { presetId: o.presetId }),
        ...(o.offerIndex === null ? {} : { offerIndex: o.offerIndex }),
        ...(o.offerSource === null ? {} : { offerSource: o.offerSource }),
      }));
      const right = validator.validate({ ...physical, claimed: { acquisition: claims } } as never);
      assert.deepEqual(right.violations.map(v => v.code), [], `${c.id} accept "${a.label}": the exact claim is accepted`);
      const wrong = validator.validate({ ...physical, claimed: { acquisition: claims.slice(1) } } as never);
      assert.deepEqual([...new Set(wrong.violations.map(v => v.code))], ['CLAIMED_ACQUISITION_MISMATCH'], `${c.id} accept "${a.label}": a short claim`);
      assert.equal(compareVerdicts(referenceVerdict(fixture, request, a.build), productionVerdict(wrong), ['CLAIMED_ACQUISITION_MISMATCH']), null, `${c.id} accept "${a.label}"`);
      checked++;
    }
  }
  assert.ok(checked >= 5, `claimed provenance checked on ${checked} accepts`);
});
