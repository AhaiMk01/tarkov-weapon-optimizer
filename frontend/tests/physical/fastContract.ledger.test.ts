// The Fast contract on the Stage 1 ledger (Stage 3 workstream 3.4; ADR 0013 section 7: "Fast does not get exact Gate A/B/C or physical infeasibility
// by declaration. Require every published accepted Fast witness to validate in the adopted physical domain and every model certificate/failed
// reconstruction to follow its truthful qualification").
//
// Every ledger case is mapped into production's inputs (the Stage 2 harness mapping, `reference/harness/toProduction.differential.ts`) and solved by
// production's public `solve()` in Fast mode, in six variants: the case's own request, TrueErgo forced on, Prevent Overswing forced on, each with one
// copy per part (production's default, decision 2c) and with repeats allowed. The forced flags are set on the REFERENCE request before mapping, so the
// production request and the reference validator see the same problem. For every response:
//   - the outcome honours the Fast contract (`fastContract.check.ts`): approximate, never certified, never `infeasible`, section 6 pairs, closed reasons;
//   - a published build passes the production validator AND the independent reference validator (`validateReference`, decoded the way the harness
//     decodes it, with no decoding issue);
//   - a case the oracle proves empty never gets a build, and its Fast outcome is `incomplete` / `none`, not a certificate;
//   - the owner-approved cyclic cases are refused as unsupported data in every variant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve } from '../../src/solver/solver';
import { PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import { LEDGER } from '../../reference/ledger/index';
import type { LedgerCase } from '../../reference/ledger/index';
import { validateReference } from '../../reference/oracle/index';
import type { ReferenceRequest } from '../../reference/oracle/index';
import { decodeBuild } from '../../reference/harness/compare.differential';
import type { ProductionResponse } from '../../reference/harness/compare.differential';
import { OWNER_APPROVED_REFUSALS } from '../../reference/harness/scoreboard';
import { toProduction } from '../../reference/harness/toProduction.differential';
import { checkFastContract, returnsBuild } from './fastContract.check';

type Ted = 'asIs' | 'trueErgo' | 'preventOverswing';
const TED_VARIANTS: readonly Ted[] = ['asIs', 'trueErgo', 'preventOverswing'];

const requestOf = (c: LedgerCase, ted: Ted): ReferenceRequest => {
  if (ted === 'trueErgo') return { ...c.request, use_true_ergo: true };
  if (ted === 'preventOverswing') return { ...c.request, prevent_overswing: true };
  return c.request;
};

interface Row { id: string; ted: Ted; repeats: boolean; status: string; certificate: string; reason: string | null; build: boolean; failures: string[] }

const rows: Row[] = [];
const unsupported: string[] = [];
const started = performance.now();
const quiet = { error: console.error, warn: console.warn, log: console.log };
console.error = console.warn = console.log = () => {};
try {
  for (const c of LEDGER) {
    for (const ted of TED_VARIANTS) {
      const request = requestOf(c, ted);
      const inputs = toProduction(c.fixture, request, { preciseMode: false, timeLimitMs: 20_000, objectiveTolerance: c.runtimeTolerance.absolute });
      if (inputs.unsupported.length > 0) {
        if (ted === 'asIs') unsupported.push(c.id);
        continue;
      }
      for (const repeats of [false, true]) {
        const params = { ...inputs.params, preciseMode: false, precisionRequest: 'fast' as const, allowRepeatedParts: repeats };
        const failures: string[] = [];
        const r = await solve(params);
        failures.push(...checkFastContract(params, r).violations);
        if (returnsBuild(r)) {
          const decoded = decodeBuild(c.fixture, request, r as unknown as ProductionResponse);
          if (decoded.issues.length > 0) failures.push(`reference decoding: ${decoded.issues.join('; ')}`);
          const ref = validateReference(c.fixture, request, decoded.build);
          if (ref.violations.length > 0) failures.push(`reference validator: ${JSON.stringify(ref.violations.slice(0, 3))}`);
          if (ted === 'asIs' && c.expected.empty) failures.push('a build for a case the oracle proves empty');
        }
        if (ted === 'asIs' && c.expected.empty && !(r.status === 'incomplete' && r.physical_certificate === 'none')) {
          failures.push(`empty case reported ${r.status}/${r.physical_certificate}`);
        }
        if (Object.hasOwn(OWNER_APPROVED_REFUSALS, c.id) && r.reason !== PUBLIC_REASONS.unsupportedCyclicPartGraph) {
          failures.push(`owner-approved cyclic case not refused: ${r.status} ${r.reason ?? ''}`);
        }
        rows.push({ id: c.id, ted, repeats, status: r.status, certificate: r.physical_certificate, reason: r.reason ?? null, build: returnsBuild(r), failures });
      }
    }
  }
} finally {
  console.error = quiet.error;
  console.warn = quiet.warn;
  console.log = quiet.log;
}
const wallMs = performance.now() - started;

const tally = (key: (r: Row) => string) => [...rows.reduce((m, r) => m.set(key(r), (m.get(key(r)) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);

test('Fast contract on the ledger (informational tally)', t => {
  t.diagnostic(`${rows.length} Fast solves over ${LEDGER.length} cases (6 variants each, ${unsupported.length} cases unmappable) in ${(wallMs / 1000).toFixed(1)} s`);
  t.diagnostic(`outcomes: ${tally(r => `${r.status}/${r.certificate}${r.reason ? ` (${r.reason})` : ''}`).map(([k, n]) => `${k} ${n}`).join('; ')}`);
  t.diagnostic(`unmappable (not run): ${unsupported.join(', ') || 'none'}`);
});

test('every ledger case runs in all six Fast variants (except unmappable ones), and most publish a build', () => {
  assert.ok(LEDGER.length >= 140);
  assert.equal(rows.length, (LEDGER.length - unsupported.length) * 6, 'TED forcing must not make a mappable case unmappable');
  assert.ok(rows.filter(r => r.build).length >= rows.length / 2, `${rows.filter(r => r.build).length} builds`);
  // the suite exercises the qualifications it guards: emptiness, approximate optima, the refusals
  assert.ok(rows.some(r => r.status === 'incomplete' && r.reason === PUBLIC_REASONS.approximateModelInfeasible));
  assert.ok(rows.some(r => r.status === 'incomplete' && r.reason === PUBLIC_REASONS.fastProvisionalMoaModelInfeasible));
  assert.ok(rows.some(r => r.status === 'optimal' && r.certificate === 'approximate_optimal'));
  assert.ok(rows.some(r => r.reason === PUBLIC_REASONS.unsupportedCyclicPartGraph));
});

test('every published Fast build passes the production and the reference validator; every Fast outcome is truthfully qualified', () => {
  const bad = rows.filter(r => r.failures.length > 0).map(r => `${r.id} [${r.ted}, ${r.repeats ? 'repeats' : 'single copy'}]: ${r.failures.join(' | ')}`);
  assert.deepEqual(bad, []);
});

test('no Fast outcome carries a certificate or reports infeasibility', () => {
  assert.deepEqual(rows.filter(r => r.certificate === 'certified_optimal' || r.certificate === 'certified_infeasible' || r.status === 'infeasible').map(r => r.id), []);
});
