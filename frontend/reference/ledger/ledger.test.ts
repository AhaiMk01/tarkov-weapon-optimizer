// Executes the 14-family ledger against the independent oracle (ADR 0013 section 3).
//
// Every case carries hand-derived expectations; these tests only check that the oracle agrees with
// them, plus the ledger's own structure: schema, coverage of every required subcase, admitted
// outcomes and the owned-stock monotonicity relations.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  abs, computeStats, eq, ge, lt, parseQ, ReferenceInputError, resolveFixture, resolveRequest, runOracle, sub, toString, validateReference, ZERO,
  type BuildStats, type Q, type ValidationResult,
} from '../oracle/index';
import {
  ADR_0013_SECTION_3_SUBCASES, CROSS_CUTTING_TAGS, DEFERRED_SUBCASES, LEDGER, MONOTONICITY, REQUIRED_SUBCASES, STAGE_3_NATIVE_NUMERICAL,
  type AdrSubcase,
} from './index';
import { FAMILIES, type LedgerCase, type StatName } from './types';

const byId = new Map(LEDGER.map(c => [c.id, c] as const));
const describeViolations = (r: ValidationResult) => r.violations.map(v => `${v.code}(${v.detail})`).join('; ') || 'none';
const distinctSorted = (codes: string[]) => [...new Set(codes)].sort();
const statOf = (stats: BuildStats, name: StatName): Q => stats[name];

// --- 1. every case agrees with its hand derivation ----------------------------------------------------------

for (const c of LEDGER) {
  test(`${c.id}: ${c.title}`, { todo: c.todo }, () => {
    const result = runOracle(c.fixture, c.request);
    assert.equal(result.complete, true, 'the finite enumeration must complete (an incomplete search proves nothing)');
    assert.deepEqual(result.projectionKeys, c.expected.projectionKeys, 'complete feasible projection set');
    assert.equal(result.empty, c.expected.empty, 'emptiness');
    assert.equal(result.maxScore === null ? null : toString(result.maxScore), c.expected.maxScore, 'exact maximum score');
    assert.deepEqual(result.maximizers, c.expected.maximizers, 'exact maximizing projections');

    for (const [key, score] of Object.entries(c.expected.scores ?? {})) {
      const record = result.projections.find(p => p.key === key);
      assert.ok(record, `projection ${key} must be feasible to carry a score`);
      assert.equal(toString(record.score), score, `score of ${key}`);
    }
    if (c.expected.physicalBuildCount !== undefined) {
      assert.equal(result.builds.length, c.expected.physicalBuildCount, 'accepted physical builds');
    }
    for (const accepted of c.expected.accepts ?? []) {
      const verdict = validateReference(c.fixture, c.request, accepted.build);
      assert.equal(verdict.ok, true, `${accepted.label} must validate: ${describeViolations(verdict)}`);
    }
    for (const rejection of c.expected.rejections ?? []) {
      const verdict = validateReference(c.fixture, c.request, rejection.build);
      assert.equal(verdict.ok, false, `${rejection.label} must be rejected`);
      assert.deepEqual(distinctSorted(verdict.violations.map(v => v.code)), rejection.codes, `${rejection.label}: ${describeViolations(verdict)}`);
    }
    for (const check of c.expected.provenance ?? []) {
      const { acquisition } = computeStats(resolveFixture(c.fixture), resolveRequest(c.fixture, c.request), check.build);
      const actual = acquisition.occurrences.map(o => ({
        instanceId: o.instanceId,
        source: o.source.kind,
        ...(o.source.kind === 'offer' ? { via: o.source.offer.kind } : {}),
        charged: toString(o.charged),
      }));
      assert.deepEqual(actual, check.occurrences, `${check.label}: per-occurrence provenance`);
    }
    if (c.expected.statChecks?.length) {
      const resolvedFixture = resolveFixture(c.fixture);
      const resolvedRequest = resolveRequest(c.fixture, c.request);
      for (const check of c.expected.statChecks) {
        const stats = computeStats(resolvedFixture, resolvedRequest, check.build);
        for (const [name, value] of Object.entries(check.values) as [StatName, string][]) {
          assert.equal(toString(statOf(stats, name)), value, `${check.label}: ${name}`);
        }
        if (check.overswingNonzero !== undefined) {
          assert.equal(stats.overswingPercent.n !== 0n, check.overswingNonzero, `${check.label}: overswing nonzero`);
        }
      }
    }
  });
}

// --- 2. coverage: every family and every required subcase has a case ------------------------------------------

test('coverage: all 14 families and every required subcase of ADR 0013 section 3 have a case', () => {
  for (const family of FAMILIES) {
    assert.ok(LEDGER.some(c => c.family === family), `family ${family} has no case`);
    for (const tag of REQUIRED_SUBCASES[family]) {
      assert.ok(LEDGER.some(c => c.family === family && c.subcases.includes(tag)), `family ${family} lacks subcase ${tag}`);
    }
  }
  for (const tag of CROSS_CUTTING_TAGS) {
    assert.ok(LEDGER.some(c => c.subcases.includes(tag)), `no case carries the cross-cutting tag ${tag}`);
  }
});

test('coverage: no case uses a subcase tag outside the catalogue (typos hide gaps)', () => {
  for (const c of LEDGER) {
    const known = new Set([...REQUIRED_SUBCASES[c.family], ...CROSS_CUTTING_TAGS]);
    for (const tag of c.subcases) assert.ok(known.has(tag), `${c.id}: unknown subcase tag ${tag}`);
    assert.ok(c.subcases.length > 0, `${c.id}: no subcase tag`);
  }
});

// --- 2b. ADR 0013 section 3 coverage is checked against the ADR text, not against the ledger's own catalogue --------
//
// REQUIRED_SUBCASES is written next to the cases, so "every tag has a case" cannot notice a subcase the ADR names
// and the catalogue forgot. ADR_0013_SECTION_3_SUBCASES restates the ADR's own wording; these tests read the ADR,
// check the wording verbatim, flag any ADR text no entry accounts for, and require every named subcase to be covered
// by a case or explicitly deferred with a reason and an owner stage.

const ADR_0013_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/adr/0013-correctness-first-handoff-and-adoption-sequence.md');
const normalizeAdr = (text: string) => text.replace(/\*\*|`|\$/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

function adrSection3(): { whole: string; items: Map<number, string> } {
  const text = readFileSync(ADR_0013_PATH, 'utf8').replace(/\r\n/g, '\n');
  const start = text.indexOf('### Fourteen-family ledger with required subcases');
  assert.ok(start >= 0, 'ADR 0013 section 3 (fourteen-family ledger) not found: re-reconcile the ledger catalogue with the ADR');
  const end = text.indexOf('\n## ', start);
  const section = text.slice(start, end < 0 ? undefined : end);
  const items = new Map<number, string>();
  for (const match of section.matchAll(/^(\d+)\. \*\*[^*]+:\*\* (.*)$/gm)) items.set(Number(match[1]), normalizeAdr(match[2]));
  return { whole: normalizeAdr(section), items };
}

/** Gaps in a coverage mapping: a subcase whose tags have no case, or whose deferral is missing or incomplete. */
function coverageGaps(entries: readonly AdrSubcase[], cases: readonly LedgerCase[]): string[] {
  const gaps: string[] = [];
  const used = new Set<string>();
  for (const entry of entries) {
    const label = `${entry.family === 'cross-cutting' ? 'cross-cutting' : `family ${entry.family}`}: ${entry.wording}`;
    const d = entry.disposition;
    if ('covers' in d) {
      const known = entry.family === 'cross-cutting' ? CROSS_CUTTING_TAGS : REQUIRED_SUBCASES[entry.family];
      if (d.covers.length === 0) gaps.push(`${label}: covers nothing`);
      for (const tag of d.covers) {
        if (!known.includes(tag)) gaps.push(`${label}: tag ${tag} is not in the catalogue`);
        else if (!cases.some(c => (entry.family === 'cross-cutting' || c.family === entry.family) && c.subcases.includes(tag))) gaps.push(`${label}: no case carries ${tag}`);
      }
    } else {
      used.add(d.deferred);
      const deferral = DEFERRED_SUBCASES.find(x => x.id === d.deferred);
      if (!deferral) gaps.push(`${label}: deferral ${d.deferred} is not declared`);
      else {
        if (deferral.family !== entry.family) gaps.push(`${label}: deferral names another family`);
        if (normalizeAdr(deferral.adrWording) !== normalizeAdr(entry.wording)) gaps.push(`${label}: deferral quotes other ADR wording`);
        if (deferral.reason.trim().length < 80) gaps.push(`${label}: deferral has no real reason`);
        if (!deferral.ownerStage.startsWith('Stage ')) gaps.push(`${label}: deferral names no owner stage`);
      }
    }
  }
  for (const deferral of DEFERRED_SUBCASES) if (!used.has(deferral.id)) gaps.push(`deferral ${deferral.id} is not referenced by any ADR subcase`);
  return gaps;
}

test('ADR 0013 section 3 names fourteen families and the ledger catalogue quotes each family item verbatim', () => {
  const { whole, items } = adrSection3();
  assert.deepEqual([...items.keys()], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  for (const entry of ADR_0013_SECTION_3_SUBCASES) {
    const haystack = entry.family === 'cross-cutting' ? whole : items.get(entry.family)!;
    assert.ok(haystack.includes(normalizeAdr(entry.wording)), `ADR wording not found verbatim: ${entry.family}: ${entry.wording}`);
  }
  for (const family of FAMILIES) assert.ok(ADR_0013_SECTION_3_SUBCASES.some(e => e.family === family), `family ${family} has no ADR subcase entry`);
});

test('ADR 0013 section 3 text that no catalogue entry accounts for is flagged (a new or forgotten subcase cannot slip in)', () => {
  const { items } = adrSection3();
  // Remarks of the ADR items that are procedure or caution rather than subcases; anything else left over is an unmapped subcase.
  const remarks: Record<number, string> = {
    1: 'do not conflate those relations',
    2: 'expected rejection is a pass',
    7: 'as stock expands',
  };
  for (const [family, item] of items) {
    let rest = item;
    const wordings = ADR_0013_SECTION_3_SUBCASES.filter(e => e.family === family).map(e => normalizeAdr(e.wording)).sort((a, b) => b.length - a.length);
    for (const wording of wordings) rest = rest.split(wording).join(' ');
    rest = rest.replace(/[.,;:()]/g, ' ').replace(/\b(and|or)\b/g, ' ').replace(/\s+/g, ' ').trim();
    assert.equal(rest, remarks[family] ?? '', `family ${family}: ADR text not accounted for by a catalogue entry`);
  }
});

test('coverage: every ADR 0013 section 3 subcase is covered by a case or explicitly deferred with a reason and an owner stage', () => {
  assert.deepEqual(coverageGaps(ADR_0013_SECTION_3_SUBCASES, LEDGER), []);
});

test('coverage: the gap check can fail (an uncovered tag, an undeclared or hollow deferral are all reported)', () => {
  const withoutSelfCopy = LEDGER.filter(c => !c.subcases.includes('self_copy_cap'));
  assert.deepEqual(coverageGaps(ADR_0013_SECTION_3_SUBCASES, withoutSelfCopy), ['family 1: self-copy cap: no case carries self_copy_cap']);
  const hollow: AdrSubcase[] = [{ family: 12, wording: 'hard secant domains', disposition: { deferred: 'no_such_deferral' } }];
  assert.ok(coverageGaps(hollow, LEDGER).some(g => g.includes('is not declared')));
  assert.ok(coverageGaps([], LEDGER).some(g => g.includes('is not referenced')), 'an orphan deferral is flagged');
});

test('deferred subcases: owned by Stage 3 native/numerical evidence, never also a covered tag, and no case carries them', () => {
  assert.deepEqual(DEFERRED_SUBCASES.filter(d => d.family === 12).map(d => d.id), ['hard_secant_domains', 'mapping_parser_coefficient_errors']);
  const catalogueTags = new Set([...Object.values(REQUIRED_SUBCASES).flat(), ...CROSS_CUTTING_TAGS]);
  for (const deferral of DEFERRED_SUBCASES) {
    assert.equal(deferral.ownerStage, STAGE_3_NATIVE_NUMERICAL, deferral.id);
    assert.equal(catalogueTags.has(deferral.id), false, `${deferral.id} is both deferred and a required tag`);
    assert.equal(LEDGER.some(c => c.subcases.includes(deferral.id)), false, `a case carries the deferred id ${deferral.id}: remove the deferral`);
  }
});

test('coverage: at least two tiny-positive-gap or near-cap cases, so no tie is claimed for a small exact gap', () => {
  const gapCases = LEDGER.filter(c => c.runtimeTolerance.kind !== 'well_separated');
  assert.ok(gapCases.length >= 2, `only ${gapCases.length} tiny-gap/near-cap cases`);
  assert.ok(gapCases.some(c => c.runtimeTolerance.kind === 'tiny_positive_gap'));
  assert.ok(gapCases.some(c => c.runtimeTolerance.kind === 'near_cap'));
  assert.ok(gapCases.some(c => c.runtimeTolerance.resolvableAtTolerance), 'a gap case the pinned tolerance can resolve');
});

// --- 3. schema sanity -----------------------------------------------------------------------------------------

/** Independent restatement of the admitted-outcome table (ADR 0013 section 6); not shared with outcomes.ts. */
const ADMITTED_TABLE: Record<string, [status: string, certificate: string, model: string, moa: string | null, reason: string | null]> = {
  'precise/independent/nonempty': ['optimal', 'certified_optimal', 'exact', null, null],
  'precise/independent/empty': ['infeasible', 'certified_infeasible', 'exact', null, null],
  'fast/independent/nonempty': ['optimal', 'approximate_optimal', 'approximate', null, null],
  'fast/independent/empty': ['incomplete', 'none', 'approximate', null, 'Approximate model infeasible'],
  'precise/moa/nonempty': ['optimal', 'approximate_optimal', 'exact', 'provisional_model', null],
  'precise/moa/empty': ['incomplete', 'none', 'exact', 'provisional_model', 'Provisional MOA model infeasible'],
  'fast/moa/nonempty': ['optimal', 'approximate_optimal', 'approximate', 'provisional_model', null],
  'fast/moa/empty': ['incomplete', 'none', 'approximate', 'provisional_model', 'Fast provisional MOA model infeasible'],
};

function checkAdmitted(c: LedgerCase): void {
  for (const mode of ['precise', 'fast'] as const) {
    const key = `${mode}/${c.moaDependent ? 'moa' : 'independent'}/${c.expected.empty ? 'empty' : 'nonempty'}`;
    const [status, certificate, model, moa, reason] = ADMITTED_TABLE[key];
    const outcome = c.admitted[mode];
    assert.deepEqual(
      [outcome.status, outcome.physical_certificate, outcome.model_qualification, outcome.moa_qualification, outcome.reason],
      [status, certificate, model === 'exact' || model === 'approximate' ? model : null, moa, reason],
      `${c.id}: admitted ${key}`,
    );
    assert.equal(outcome.termination, 'optimal', `${c.id}: a completed search terminates optimal, emptiness included`);
    if (mode === 'fast') {
      assert.notEqual(outcome.physical_certificate, 'certified_optimal');
      assert.notEqual(outcome.physical_certificate, 'certified_infeasible');
    }
  }
}

test('schema: ids, expectations and admitted outcomes are consistent', () => {
  assert.equal(new Set(LEDGER.map(c => c.id)).size, LEDGER.length, 'unique case ids');
  for (const c of LEDGER) {
    const where = c.id;
    assert.equal(c.id.startsWith(`F${String(c.family).padStart(2, '0')}-`), true, `${where}: id carries its family prefix`);
    assert.ok(c.derivation.trim().length > 40, `${where}: a derivation is required`);
    assert.ok(c.prerequisites.trim().length > 0 && c.source.trim().length > 0 && c.title.trim().length > 0, `${where}: prose fields`);
    assert.ok(c.adrRefs.length > 0, `${where}: ADR references`);
    const e = c.expected;
    assert.deepEqual([...e.projectionKeys].sort(), e.projectionKeys, `${where}: projection keys sorted`);
    assert.equal(new Set(e.projectionKeys).size, e.projectionKeys.length, `${where}: projection keys distinct`);
    assert.equal(e.empty, e.projectionKeys.length === 0, `${where}: emptiness matches the feasible set`);
    assert.equal(e.maxScore === null, e.empty, `${where}: a maximum exists exactly when something is feasible`);
    assert.equal(e.maximizers.length === 0, e.empty, `${where}: maximizers exist exactly when something is feasible`);
    for (const key of e.maximizers) assert.ok(e.projectionKeys.includes(key), `${where}: maximizer ${key} is feasible`);
    assert.deepEqual([...e.maximizers].sort(), e.maximizers, `${where}: maximizers sorted`);
    if (e.maxScore !== null) assert.equal(toString(parseQ(e.maxScore)), e.maxScore, `${where}: maxScore is a canonical rational`);
    for (const [key, score] of Object.entries(e.scores ?? {})) {
      assert.ok(e.projectionKeys.includes(key), `${where}: scored projection ${key} is feasible`);
      assert.equal(toString(parseQ(score)), score, `${where}: score ${score} canonical`);
      if (e.maxScore !== null) assert.ok(ge(parseQ(e.maxScore), parseQ(score)), `${where}: no listed score exceeds the maximum`);
    }
    for (const key of e.maximizers) {
      if (e.scores && key in e.scores) assert.equal(e.scores[key], e.maxScore, `${where}: a listed maximizer scores the maximum`);
    }
    for (const r of e.rejections ?? []) {
      assert.ok(r.codes.length > 0, `${where}/${r.label}: a rejection names at least one code`);
      assert.deepEqual(distinctSorted(r.codes), r.codes, `${where}/${r.label}: codes sorted and distinct`);
    }
    for (const check of e.statChecks ?? []) {
      for (const value of Object.values(check.values)) assert.equal(toString(parseQ(value)), value, `${where}/${check.label}: canonical ${value}`);
    }
    for (const check of e.provenance ?? []) {
      assert.ok(check.occurrences.length > 0, `${where}/${check.label}: provenance lists the occurrences`);
      const ids = check.occurrences.map(o => o.instanceId);
      assert.deepEqual([...ids].sort(), ids, `${where}/${check.label}: provenance in code-unit instanceId order`);
      for (const o of check.occurrences) {
        assert.equal(toString(parseQ(o.charged)), o.charged, `${where}/${check.label}: canonical ${o.charged}`);
        assert.equal(o.source === 'offer', o.via !== undefined, `${where}/${check.label}: only paid occurrences name an offer kind`);
        if (o.source !== 'offer') assert.equal(o.charged, '0', `${where}/${check.label}: preset, owned and unavailable units are charged 0`);
      }
    }
    assert.equal(c.moaDependent, c.request.max_moa !== undefined && c.request.max_moa !== null, `${where}: MOA dependence follows max_moa`);
    assert.equal(c.request.weapon_id, 'gun', `${where}: weapon`);
    checkAdmitted(c);
    const t = c.runtimeTolerance;
    assert.ok(t.absolute > 0 && Number.isFinite(t.absolute), `${where}: tolerance is positive`);
    if (t.kind === 'well_separated') assert.equal(t.gap, null, `${where}: no gap`);
    else {
      assert.ok(t.gap !== null && parseQ(t.gap).n > 0n, `${where}: a tiny-gap case states its exact positive gap`);
      assert.equal(toString(parseQ(t.gap)), t.gap, `${where}: gap canonical`);
    }
  }
});

test('schema: tiny-gap and near-cap cases state a gap the oracle confirms exactly', () => {
  for (const c of LEDGER) {
    const t = c.runtimeTolerance;
    if (t.kind === 'well_separated' || c.todo) continue;
    const gap = parseQ(t.gap!);
    if (t.kind === 'tiny_positive_gap') {
      const result = runOracle(c.fixture, c.request);
      const top = result.maxScore!;
      let runnerUp: Q | null = null;
      for (const p of result.projections) if (lt(p.score, top) && (runnerUp === null || ge(p.score, runnerUp))) runnerUp = p.score;
      assert.ok(runnerUp !== null, `${c.id}: needs a runner-up`);
      assert.equal(toString(sub(top, runnerUp)), toString(gap), `${c.id}: best minus runner-up`);
    } else {
      assert.ok(t.capCheck, `${c.id}: near-cap cases carry a capCheck`);
      const { build, stat, value, cap } = t.capCheck;
      const stats = computeStats(resolveFixture(c.fixture), resolveRequest(c.fixture, c.request), build);
      assert.equal(toString(statOf(stats, stat)), value, `${c.id}: hand-derived ${stat}`);
      assert.equal(toString(abs(sub(parseQ(value), parseQ(cap)))), toString(gap), `${c.id}: |value - cap|`);
      assert.ok((c.expected.rejections ?? []).length > 0, `${c.id}: the over-cap neighbour is a named rejection`);
    }
    assert.equal(t.resolvableAtTolerance, Number(gap.n) / Number(gap.d) > t.absolute, `${c.id}: resolvable flag`);
  }
});

// --- 4. owned-stock monotonicity (family 7) ---------------------------------------------------------------------

function multiset(items: readonly string[] | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of items ?? []) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

for (const relation of MONOTONICITY) {
  test(`owned monotonicity: ${relation.smaller} -> ${relation.larger}`, () => {
    const small = byId.get(relation.smaller);
    const large = byId.get(relation.larger);
    assert.ok(small && large, 'both cases exist');
    assert.equal(small.fixture, large.fixture, 'the two cases share one fixture');
    const withoutStock = (c: LedgerCase) => {
      const { owned_items: _ignored, ...rest } = c.request;
      return rest;
    };
    assert.deepEqual(withoutStock(small), withoutStock(large), 'requests differ only in owned_items');
    const a = multiset(small.request.owned_items);
    const b = multiset(large.request.owned_items);
    for (const [id, n] of a) assert.ok((b.get(id) ?? 0) >= n, `the larger stash contains every ${id} of the smaller`);

    // (b) feasible-set expansion, on projections and on every physical build
    for (const key of small.expected.projectionKeys) assert.ok(large.expected.projectionKeys.includes(key), `${key} stays feasible`);
    const smallRun = runOracle(small.fixture, small.request);
    for (const accepted of smallRun.builds) {
      const verdict = validateReference(large.fixture, large.request, accepted.build);
      assert.equal(verdict.ok, true, `a build feasible with the smaller stash stays feasible: ${describeViolations(verdict)}`);
    }

    // (c) the maximum score does not drop; an empty set counts as minus infinity
    if (small.expected.maxScore !== null) {
      assert.ok(large.expected.maxScore !== null, 'the larger stash cannot become infeasible');
      assert.ok(ge(parseQ(large.expected.maxScore), parseQ(small.expected.maxScore)), 'maximum score non-decrease');
    }

    // (a) same-build spend does not rise; the chosen optimum's spend is deliberately not constrained
    const resolvedFixture = resolveFixture(large.fixture);
    const largeRequest = resolveRequest(large.fixture, large.request);
    for (const accepted of smallRun.builds) {
      const spendLarge = computeStats(resolvedFixture, largeRequest, accepted.build).spend;
      assert.ok(ge(accepted.stats.spend, spendLarge), `spend of ${accepted.projectionKey}: ${toString(accepted.stats.spend)} -> ${toString(spendLarge)}`);
    }
  });
}

test('monotonicity relations are tagged on the larger case and cover all three properties', () => {
  assert.ok(MONOTONICITY.length >= 3, 'at least a chain of relations');
  for (const relation of MONOTONICITY) {
    const large = byId.get(relation.larger)!;
    assert.equal(large.family, 7);
    for (const tag of ['spend_nonincrease', 'feasible_set_expansion', 'max_score_nondecrease']) {
      assert.ok(large.subcases.includes(tag), `${large.id} carries ${tag}`);
    }
  }
});

// --- 5. invariants that hold on every accepted build of every case --------------------------------------------------

test('every accepted build satisfies the normative invariants', () => {
  const hundred = parseQ('100');
  for (const c of LEDGER) {
    if (c.todo) continue;
    const result = runOracle(c.fixture, c.request);
    for (const accepted of result.builds) {
      const s = accepted.stats;
      const ids = accepted.build.placements.map(p => p.childInstanceId);
      assert.equal(new Set(ids).size, ids.length, `${c.id}: unique instance ids`);
      assert.equal((s.overswingPercent.n !== 0n), lt(s.ted, ZERO), `${c.id}: overswing nonzero iff TED < 0`);
      assert.ok(ge(s.ergonomics, ZERO) && ge(hundred, s.ergonomics), `${c.id}: displayed ergonomics within [0, 100]`);
      assert.ok(ge(s.effectiveErgonomics, ZERO) && ge(hundred, s.effectiveErgonomics), `${c.id}: effective ergonomics within [0, 100]`);
      assert.ok(eq(s.spend, s.acquisition.spend), `${c.id}: spend is the acquisition spend`);
      if (c.request.max_price !== undefined && c.request.max_price !== null) {
        assert.ok(ge(resolveRequest(c.fixture, c.request).maxPrice!, s.spend), `${c.id}: spend within max_price`);
      }
    }
  }
});

// --- 6. malformed input is an input failure, never emptiness ---------------------------------------------------------

test('malformed requests are input errors, not infeasibility (ADR 0013 section 3)', () => {
  const base = LEDGER[0];
  const codesOf = (request: object) => {
    try {
      runOracle(base.fixture, { ...base.request, ...request });
    } catch (error) {
      assert.ok(error instanceof ReferenceInputError, 'a typed input error');
      return error.issues.map(i => i.code);
    }
    return null;
  };
  assert.deepEqual(codesOf({ use_tchebycheff: true, ideal_point: null }), ['MISSING_IDEAL_POINT'], 'interpretation 9: Tchebycheff needs an ideal point');
  assert.deepEqual(codesOf({ owned_items: ['a', ''] }), ['BAD_OWNED_ITEMS'], 'an empty stash entry is invalid');
  assert.deepEqual(codesOf({ weapon_id: 'no-such-gun' }), ['UNKNOWN_WEAPON']);
  assert.equal(codesOf({}), null, 'the unmodified request runs');
});

test('the ledger is not trivially small', () => {
  assert.ok(LEDGER.length >= 60, `only ${LEDGER.length} cases`);
});
