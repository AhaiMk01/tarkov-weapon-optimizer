// Tests of the comparison itself (compare.differential.ts): decoding a response into a build, and grading on the four
// dimensions. Most tests feed the grader responses synthesized from the oracle's own builds, so "pass" is shown to be
// reachable for every ledger case and each way of being wrong is shown to be caught. A small end-to-end group runs the
// real production solver on one-slot cases it must get right.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SolveParams } from '../../src/solver/types';
import { defineCase, fix, nk, reqSlot, slot } from '../ledger/dsl';
import { LEDGER, type LedgerCase } from '../ledger/index';
import { gt, makeBuild, projectBuild, projectionKey, ROOT_INSTANCE_ID, runOracle, type ReferenceBuild } from '../oracle/index';
import { DIMENSIONS, type DimensionResults, type ModeName } from './scoreboard';
import {
  decodeBuild, gradeCase, gradeOutcome, probeNodeLoader, runProduction, returnsBuild, UNRESOLVED_PARENT,
  type ProductionOutcome, type ProductionResponse,
} from './compare.differential';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = ROOT_INSTANCE_ID;

// --- synthesized responses ----------------------------------------------------------------------------

type Shape = 'placements' | 'pairs';

/** A response that carries the admitted public outcome of the case and, optionally, a build. */
function response(c: LedgerCase, mode: ModeName, build: ReferenceBuild | null, shape: Shape = 'placements', overrides: Record<string, unknown> = {}): ProductionResponse {
  const admitted = c.admitted[mode];
  const outcome: ProductionResponse = {
    status: admitted.status,
    physical_certificate: admitted.physical_certificate,
    model_qualification: admitted.model_qualification,
    moa_qualification: admitted.moa_qualification,
    precision_resolved: mode,
    optimization: { termination: admitted.termination },
    ...(admitted.reason === null ? {} : { reason: admitted.reason }),
    selected_items: [],
    slot_pairs: [],
  };
  if (build) {
    outcome.selected_items = build.placements.map(p => ({ id: p.itemId }));
    outcome.selected_preset = { id: build.base.kind === 'naked' ? c.request.weapon_id : build.base.presetId };
    outcome.slot_pairs = shape === 'placements' ? build.placements.map(p => ({ ...p })) : build.placements.map(p => [p.slotId, p.itemId]);
  }
  return { ...outcome, ...overrides };
}

const asOutcome = (r: ProductionResponse): ProductionOutcome => ({ kind: 'response', response: r });
const verdicts = (r: DimensionResults) => Object.fromEntries(DIMENSIONS.map(d => [d, r[d].verdict]));

const oracleRuns = new Map<string, ReturnType<typeof runOracle>>();
function oracle(c: LedgerCase) {
  let run = oracleRuns.get(c.id);
  if (!run) {
    run = runOracle(c.fixture, c.request);
    oracleRuns.set(c.id, run);
  }
  return run;
}
const maximizerBuild = (c: LedgerCase): ReferenceBuild => {
  const found = oracle(c).builds.find(b => c.expected.maximizers.includes(b.projectionKey));
  assert.ok(found, `${c.id}: the oracle has a build for a maximizer`);
  return found.build;
};
const byId = (id: string) => {
  const c = LEDGER.find(x => x.id === id);
  assert.ok(c, id);
  return c;
};
/** The best-scoring feasible build whose projection is not a maximizer. */
const runnerUpBuild = (c: LedgerCase): ReferenceBuild => {
  const run = oracle(c);
  const others = run.projections.filter(p => !c.expected.maximizers.includes(p.key));
  assert.ok(others.length > 0, `${c.id}: a runner-up exists`);
  const best = others.reduce((a, b) => (gt(b.score, a.score) ? b : a));
  return run.builds.find(b => b.projectionKey === best.key)!.build;
};
const hasDuplicates = (b: ReferenceBuild) => new Set(b.placements.map(p => p.itemId)).size !== b.placements.length;

// --- decodeBuild -----------------------------------------------------------------------------------------

const decodeFixture = fix({
  items: [
    { id: 'host', slots: [slot('hs', ['child'])] },
    { id: 'child' },
    { id: 'other' },
  ],
  weapon: { slots: [slot('s1', ['host']), slot('s2', ['other'])] },
});
const decodeRequest = { weapon_id: 'gun' };
const dr = (extra: Partial<ProductionResponse>): ProductionResponse => ({ status: 'optimal', selected_preset: { id: 'gun' }, selected_items: [], slot_pairs: [], ...extra });

test('decode: the receiver id as selected_preset is the naked base, any other id is a preset', () => {
  assert.deepEqual(decodeBuild(decodeFixture, decodeRequest, dr({})).build.base, { kind: 'naked' });
  assert.deepEqual(decodeBuild(decodeFixture, decodeRequest, dr({ selected_preset: { id: 'p1' } })).build.base, { kind: 'preset', presetId: 'p1' });
});

test('decode: [slotId, itemId] pairs are placed under the instance that declares the slot, whatever their order', () => {
  const pairs = [['hs', 'child'], ['s1', 'host'], ['s2', 'other']];
  const decoded = decodeBuild(decodeFixture, decodeRequest, dr({ selected_items: [{ id: 'child' }, { id: 'host' }, { id: 'other' }], slot_pairs: pairs }));
  assert.deepEqual(decoded.issues, []);
  const expected = makeBuild({ kind: 'naked' }, [ROOT, 's1', 'host'], [ROOT, 's2', 'other'], [`${ROOT}/s1:host`, 'hs', 'child']);
  assert.deepEqual(projectionKey(projectBuild(decoded.build)), projectionKey(projectBuild(expected)));
  const child = decoded.build.placements.find(p => p.itemId === 'child');
  assert.equal(child?.parentInstanceId, `${ROOT}/s1:host`);
  assert.equal(child?.childInstanceId, `${ROOT}/s1:host/hs:child`);
});

test('decode: a pair whose slot has no placed owner keeps a placement under an unresolved parent and is reported', () => {
  const decoded = decodeBuild(decodeFixture, decodeRequest, dr({ selected_items: [{ id: 'child' }], slot_pairs: [['hs', 'child']] }));
  assert.equal(decoded.build.placements[0].parentInstanceId, UNRESOLVED_PARENT);
  assert.match(decoded.issues.join(' '), /hs.*no placed owner/);
});

test('decode: a slot id no placed instance declares stays unresolved and is reported', () => {
  const decoded = decodeBuild(decodeFixture, decodeRequest, dr({ selected_items: [{ id: 'other' }], slot_pairs: [['nowhere', 'other']] }));
  assert.equal(decoded.build.placements[0].parentInstanceId, UNRESOLVED_PARENT);
  assert.equal(decoded.issues.length, 1);
});

test('decode: selected_items and slot_pairs must agree; a listed item that is never placed stays in the build, unrooted', () => {
  const decoded = decodeBuild(decodeFixture, decodeRequest, dr({ selected_items: [{ id: 'other' }, { id: 'child' }], slot_pairs: [['s2', 'other']] }));
  assert.match(decoded.issues.join(' '), /child: 1 in selected_items, 0 in slot_pairs/);
  assert.equal(decoded.build.placements.length, 2);
  assert.equal(decoded.build.placements[1].parentInstanceId, UNRESOLVED_PARENT);
  const extra = decodeBuild(decodeFixture, decodeRequest, dr({ selected_items: [], slot_pairs: [['s2', 'other']] }));
  assert.match(extra.issues.join(' '), /other: 0 in selected_items, 1 in slot_pairs/);
});

test('decode: a missing selected_preset or slot_pairs is reported, and the build still reaches the validator', () => {
  const noPreset = decodeBuild(decodeFixture, decodeRequest, { status: 'optimal', selected_items: [], slot_pairs: [] });
  assert.match(noPreset.issues.join(' '), /no selected_preset/);
  assert.equal(noPreset.build.base.kind, 'preset');
  const noPairs = decodeBuild(decodeFixture, decodeRequest, { status: 'optimal', selected_preset: { id: 'gun' } });
  assert.match(noPairs.issues.join(' '), /no slot_pairs/);
});

test('decode: Placement objects (the ADR 0013 section 5 transport) are used as given, including repeated templates', () => {
  const placements = [
    { parentInstanceId: ROOT, slotId: 's1', childInstanceId: 'a', itemId: 'host' },
    { parentInstanceId: ROOT, slotId: 's2', childInstanceId: 'b', itemId: 'other' },
  ];
  const decoded = decodeBuild(decodeFixture, decodeRequest, dr({ selected_items: [{ id: 'host' }, { id: 'other' }], slot_pairs: placements }));
  assert.deepEqual(decoded.issues, []);
  assert.deepEqual(decoded.build.placements, placements);
});

test('decode: a malformed slot_pairs entry is reported', () => {
  const decoded = decodeBuild(decodeFixture, decodeRequest, dr({ slot_pairs: [['only-one'], 42, { slotId: 's1' }] }));
  assert.equal(decoded.issues.filter(i => /neither/.test(i)).length, 3);
});

// --- control: a perfect response passes every applicable dimension, for every ledger case -----------------

test('control: a response carrying the admitted outcome and an oracle maximizer passes every dimension of every ledger case, in both modes', () => {
  let nonEmpty = 0;
  let empty = 0;
  for (const c of LEDGER) {
    for (const mode of ['precise', 'fast'] as const) {
      const build = c.expected.empty ? null : maximizerBuild(c);
      const graded = gradeOutcome(c, mode, asOutcome(response(c, mode, build)));
      for (const d of DIMENSIONS) {
        const na = d === 'scoreOptimal' && (mode === 'fast' || c.expected.empty);
        assert.equal(graded[d].verdict, na ? 'n/a' : 'pass', `${c.id} ${mode}.${d}: ${graded[d].reason}`);
      }
    }
    if (c.expected.empty) empty++;
    else nonEmpty++;
  }
  assert.ok(nonEmpty > 100 && empty >= 10, `${nonEmpty} nonempty and ${empty} empty cases were exercised`);
});

test('control: the legacy [slotId, itemId] transport decodes to the same build wherever production could have produced it', () => {
  let checked = 0;
  for (const c of LEDGER) {
    if (c.expected.empty) continue;
    const build = maximizerBuild(c);
    if (hasDuplicates(build)) continue;
    const graded = gradeOutcome(c, 'precise', asOutcome(response(c, 'precise', build, 'pairs')));
    assert.deepEqual(
      [graded.buildValid.verdict, graded.scoreOptimal.verdict, graded.emptiness.verdict, graded.outcomeContract.verdict],
      ['pass', 'pass', 'pass', 'pass'],
      `${c.id}: ${graded.buildValid.reason}`,
    );
    checked++;
  }
  assert.ok(checked > 60, `${checked} cases round-tripped through the legacy shape`);
});

// --- controls: each way of being wrong is caught ---------------------------------------------------------

test('a feasible build that is not a maximizer is valid but not optimal', () => {
  let found = 0;
  for (const c of LEDGER) {
    if (c.expected.empty || c.runtimeTolerance.kind === 'tiny_positive_gap') continue;
    const loser = oracle(c).builds.find(b => !c.expected.maximizers.includes(b.projectionKey));
    if (!loser) continue;
    const graded = gradeOutcome(c, 'precise', asOutcome(response(c, 'precise', loser.build)));
    assert.equal(graded.buildValid.verdict, 'pass', c.id);
    assert.equal(graded.scoreOptimal.verdict, 'fail', c.id);
    assert.match(graded.scoreOptimal.reason, /differs from the exact optimum/);
    assert.equal(graded.emptiness.verdict, 'pass', c.id);
    found++;
  }
  assert.ok(found > 80, `${found} cases have a non-maximizing feasible build`);
});

test('a build the reference validator rejects fails buildValid with the violation code, and cannot be scored', () => {
  const c = byId('F01-template-pair-exclusion');
  const bad = makeBuild({ kind: 'naked' }, [ROOT, 's1', 'a'], [ROOT, 's2', 'b']);
  const graded = gradeOutcome(c, 'precise', asOutcome(response(c, 'precise', bad)));
  assert.equal(graded.buildValid.verdict, 'fail');
  assert.match(graded.buildValid.reason, /TEMPLATE_CONFLICT/);
  assert.equal(graded.buildValid.key, 'validator: TEMPLATE_CONFLICT');
  assert.equal(graded.scoreOptimal.verdict, 'fail');
  assert.equal(graded.scoreOptimal.key, 'no valid build to score');
  assert.equal(graded.emptiness.verdict, 'pass', 'it did return a build for a nonempty case');
});

test('a build with an undecodable placement fails buildValid even though the rest of it is legal', () => {
  const c = byId('F01-template-pair-exclusion');
  const good = maximizerBuild(c);
  const graded = gradeOutcome(c, 'precise', asOutcome(response(c, 'precise', good, 'pairs', { slot_pairs: [['nowhere', 'b'], ...good.placements.map(p => [p.slotId, p.itemId])] })));
  assert.equal(graded.buildValid.verdict, 'fail');
  assert.equal(graded.scoreOptimal.verdict, 'fail');
});

test('infeasible on a nonempty case is a false emptiness and no build; incomplete is no verdict', () => {
  const c = byId('F01-template-pair-exclusion');
  const infeasible = gradeOutcome(c, 'precise', asOutcome({ status: 'infeasible', reason: 'No valid configuration found', selected_items: [] }));
  assert.deepEqual(verdicts(infeasible), { buildValid: 'fail', scoreOptimal: 'fail', emptiness: 'fail', outcomeContract: 'fail' });
  assert.equal(infeasible.emptiness.key, 'false infeasibility');
  const incomplete = gradeOutcome(c, 'precise', asOutcome({ status: 'incomplete', reason: 'Time limit reached', selected_items: [] }));
  assert.equal(incomplete.emptiness.verdict, 'fail');
  assert.equal(incomplete.emptiness.key, 'no verdict (status incomplete)');
});

test('an empty case passes buildValid and emptiness exactly when production returns infeasible and no build', () => {
  const c = LEDGER.find(x => x.expected.empty && !x.moaDependent && !x.request.owned_items?.length);
  assert.ok(c);
  const good = gradeOutcome(c, 'precise', asOutcome(response(c, 'precise', null)));
  assert.deepEqual(verdicts(good), { buildValid: 'pass', scoreOptimal: 'n/a', emptiness: 'pass', outcomeContract: 'pass' });
  const wrong = gradeOutcome(c, 'precise', asOutcome({ status: 'optimal', selected_preset: { id: c.request.weapon_id }, selected_items: [], slot_pairs: [] }));
  assert.equal(wrong.buildValid.verdict, 'fail');
  assert.equal(wrong.emptiness.verdict, 'fail');
  assert.equal(wrong.emptiness.key, 'build returned for an empty case');
  const undetermined = gradeOutcome(c, 'precise', asOutcome({ status: 'error', reason: 'boom', selected_items: [] }));
  assert.equal(undetermined.emptiness.verdict, 'fail', 'an error is not a classification of emptiness');
  assert.equal(undetermined.buildValid.verdict, 'pass', 'no build was returned');
});

test('a provisional-MOA empty case admits incomplete with the admitted reason as its emptiness verdict', () => {
  const c = LEDGER.find(x => x.expected.empty && x.moaDependent);
  assert.ok(c, 'the ledger has an MOA-dependent empty case');
  assert.equal(c.admitted.precise.status, 'incomplete');
  const admitted = gradeOutcome(c, 'precise', asOutcome(response(c, 'precise', null)));
  assert.equal(admitted.emptiness.verdict, 'pass');
  assert.equal(admitted.outcomeContract.verdict, 'pass');
  const otherReason = gradeOutcome(c, 'precise', asOutcome(response(c, 'precise', null, 'placements', { reason: 'Time limit reached' })));
  assert.equal(otherReason.emptiness.verdict, 'fail');
  const infeasible = gradeOutcome(c, 'precise', asOutcome({ status: 'infeasible', selected_items: [] }));
  assert.equal(infeasible.emptiness.verdict, 'pass', 'proved infeasibility is still an emptiness verdict');
  assert.equal(infeasible.outcomeContract.verdict, 'fail', 'but it is not the admitted public outcome');
});

test('a tiny-gap case unresolvable at its tolerance accepts the runner-up within tolerance; a resolvable one does not', () => {
  const unresolvable = byId('F11-decimal-weight-breaks-a-decimal-tie');
  assert.equal(unresolvable.runtimeTolerance.resolvableAtTolerance, false);
  const within = gradeOutcome(unresolvable, 'precise', asOutcome(response(unresolvable, 'precise', runnerUpBuild(unresolvable))));
  assert.equal(within.scoreOptimal.verdict, 'pass');
  assert.match(within.scoreOptimal.reason, /within the runtime tolerance/);

  const resolvable = byId('F13-tiny-positive-gap-objective');
  assert.equal(resolvable.runtimeTolerance.resolvableAtTolerance, true);
  const out = gradeOutcome(resolvable, 'precise', asOutcome(response(resolvable, 'precise', runnerUpBuild(resolvable))));
  assert.equal(out.scoreOptimal.verdict, 'fail', 'a gap above the tolerance is a wrong answer, however small');
});

test('outcome contract: every admitted field is compared, and each missing or wrong one is named', () => {
  const c = byId('F01-template-pair-exclusion');
  const build = maximizerBuild(c);
  const today = gradeOutcome(c, 'precise', asOutcome({
    status: 'optimal', selected_items: build.placements.map(p => ({ id: p.itemId })), selected_preset: { id: 'gun' }, slot_pairs: build.placements.map(p => ({ ...p })),
  }));
  assert.equal(today.outcomeContract.verdict, 'fail');
  assert.equal(today.outcomeContract.key, 'outcome: missing physical_certificate, model_qualification, moa_qualification, precision_resolved, termination');

  const wrong = gradeOutcome(c, 'precise', asOutcome(response(c, 'precise', build, 'placements', { physical_certificate: 'feasible', status: 'feasible' })));
  assert.equal(wrong.outcomeContract.verdict, 'fail');
  assert.match(wrong.outcomeContract.reason, /status: expected "optimal", got "feasible"/);
  assert.match(wrong.outcomeContract.reason, /physical_certificate: expected "certified_optimal", got "feasible"/);

  const nulls = gradeOutcome(c, 'precise', asOutcome(response(c, 'precise', build, 'placements', { moa_qualification: undefined })));
  assert.match(nulls.outcomeContract.key ?? '', /missing moa_qualification/, 'moa_qualification must be an explicit null, not absent');

  const reason = gradeOutcome(c, 'precise', asOutcome(response(c, 'precise', build, 'placements', { reason: 'No valid configuration found' })));
  assert.match(reason.outcomeContract.reason, /reason: expected null, got "No valid configuration found"/);

  const fastAsPrecise = gradeOutcome(c, 'fast', asOutcome(response(c, 'precise', build)));
  assert.equal(fastAsPrecise.outcomeContract.verdict, 'fail', 'a Fast request that resolved Precise is not the admitted Fast outcome');
  assert.match(fastAsPrecise.outcomeContract.reason, /precision_resolved/);
});

test('an unsupported mapping fails every applicable dimension with the reason, and is graded the same in both modes', () => {
  const c = LEDGER.find(x => (x.request.owned_items ?? []).length > 0 && !x.expected.empty);
  assert.ok(c);
  const outcome: ProductionOutcome = { kind: 'unsupported', unsupported: [{ feature: 'owned_items', detail: 'owned_items has 1 entry' }] };
  for (const mode of ['precise', 'fast'] as const) {
    const graded = gradeOutcome(c, mode, outcome);
    for (const d of DIMENSIONS) {
      if (d === 'scoreOptimal' && mode === 'fast') assert.equal(graded[d].verdict, 'n/a');
      else {
        assert.equal(graded[d].verdict, 'fail', `${mode}.${d}`);
        assert.match(graded[d].reason, /^unsupported: owned_items has 1 entry/);
        assert.equal(graded[d].key, 'unsupported: owned_items');
      }
    }
  }
  const empty = LEDGER.find(x => x.expected.empty)!;
  assert.equal(gradeOutcome(empty, 'precise', outcome).scoreOptimal.verdict, 'n/a', 'an empty case has no optimum, supported or not');
});

test('a production crash fails every applicable dimension and names the exception', () => {
  const c = byId('F01-template-pair-exclusion');
  const graded = gradeOutcome(c, 'precise', { kind: 'threw', message: 'TypeError: x is undefined\n    at somewhere' });
  for (const d of DIMENSIONS) {
    assert.equal(graded[d].verdict, 'fail', d);
    assert.equal(graded[d].reason, 'production threw: TypeError: x is undefined');
  }
});

// --- gradeCase -------------------------------------------------------------------------------------------

test('gradeCase does not run a case with an unsupported feature, and records the feature ids', async () => {
  const c = LEDGER.find(x => (x.request.owned_items ?? []).length > 0)!;
  let calls = 0;
  const graded = await gradeCase(c, { runner: async () => { calls++; return { kind: 'threw', message: 'must not run' }; } });
  assert.equal(calls, 0);
  assert.deepEqual(graded.unsupported, ['owned_items']);
  assert.equal(graded.observed.precise, 'unsupported');
  assert.equal(graded.precise.emptiness.verdict, 'fail');
});

test('gradeCase runs Precise then Fast with the matching precision flag and the case tolerance', async () => {
  const c = byId('F01-template-pair-exclusion');
  const seen: SolveParams[] = [];
  const graded = await gradeCase(c, { runner: async params => { seen.push(params); return { kind: 'threw', message: 'stub' }; } });
  assert.deepEqual(seen.map(p => p.preciseMode), [true, false]);
  assert.ok(seen.every(p => p.objectiveTolerance === c.runtimeTolerance.absolute && p.weaponId === c.request.weapon_id));
  assert.deepEqual([graded.observed.precise, graded.observed.fast], ['threw', 'threw']);
});

// --- production end to end -----------------------------------------------------------------------------

process.chdir(frontendRoot); // solver.ts resolves the custom HiGHS build against the working directory

const choice = defineCase({
  id: 'smoke-required-choice',
  family: 4,
  subcases: [],
  title: 'smoke: one required slot, two choices',
  adrRefs: [],
  prerequisites: 'receiver ergonomics 0',
  source: 'required slot s accepts a (+3) or b (+4)',
  derivation: 'score = clamped ergonomics: b = 4 is the maximum',
  fixture: fix({ items: [{ id: 'a', ergonomics: 3 }, { id: 'b', ergonomics: 4 }], weapon: { slots: [reqSlot('s', ['a', 'b'])] } }),
  request: { recoil_weight: 0 },
  feasible: [nk('a'), nk('b')],
  maxScore: '4',
  maximizers: [nk('b')],
});
const tooCheap = defineCase({
  id: 'smoke-price-cap-below-base',
  family: 4,
  subcases: [],
  title: 'smoke: a price cap below the receiver price',
  adrRefs: [],
  prerequisites: 'the receiver costs 1000 RUB',
  source: 'max_price 10',
  derivation: 'no base fits the cap, so nothing is feasible',
  fixture: fix({ items: [{ id: 'a', ergonomics: 3 }], weapon: { slots: [slot('s', ['a'])] } }),
  request: { max_price: 10 },
  feasible: [],
  maxScore: null,
  maximizers: [],
});

test('production end to end: a required one-slot choice is solved to the exact optimum, and the missing contract fields are what fails', async () => {
  const graded = await gradeCase(choice);
  assert.equal(graded.observed.precise, 'optimal');
  assert.deepEqual(verdicts(graded.precise), { buildValid: 'pass', scoreOptimal: 'pass', emptiness: 'pass', outcomeContract: 'fail' }, JSON.stringify(graded.precise));
  assert.match(graded.precise.outcomeContract.key ?? '', /missing physical_certificate/);
  assert.equal(graded.fast.buildValid.verdict, 'pass');
  assert.equal(graded.fast.scoreOptimal.verdict, 'n/a');
});

test('production end to end: an infeasible price cap is reported infeasible with no build', async () => {
  const graded = await gradeCase(tooCheap);
  assert.equal(graded.observed.precise, 'infeasible');
  assert.deepEqual(verdicts(graded.precise), { buildValid: 'pass', scoreOptimal: 'n/a', emptiness: 'pass', outcomeContract: 'fail' }, JSON.stringify(graded.precise));
});

test('runProduction turns a thrown exception into a crash outcome instead of propagating it', async () => {
  const outcome = await runProduction(null as unknown as SolveParams);
  assert.equal(outcome.kind, 'threw');
  assert.equal(returnsBuild({ status: 'optimal' }), true);
  assert.equal(returnsBuild({ status: 'incomplete' }), false);
});

test('the Node HiGHS loader probe tells the custom build from the silent stock fallback', () => {
  const here = probeNodeLoader(frontendRoot);
  assert.equal(here.path, 'custom');
  assert.match(here.wasmSha256 ?? '', /^[0-9a-f]{64}$/);
  const empty = mkdtempSync(join(tmpdir(), 'harness-loader-probe-'));
  try {
    const elsewhere = probeNodeLoader(empty);
    assert.equal(elsewhere.path, 'stock-fallback');
    assert.equal(elsewhere.wasmSha256, null);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});
