// Stage 3 workstream 3.7: predeclare and FREEZE the MOA floor measurement cases (ADR 0013 section 7) BEFORE any measured run.
//
//   npx tsx benchmarks/stage3-floor/freeze.ts              writes benchmarks/stage3-floor/cases.json (refuses to overwrite it)
//   npx tsx benchmarks/stage3-floor/freeze.ts --addendum   writes cases-addendum.json: the DECLARED POST-HOC addendum (see below), frozen before it
//                                                          ran, from the calibration in calibration.json (calibrate-addendum.ts output)
//
// The file pins: the snapshot SHA-256, the HiGHS build manifest identity (manifest file hash, highs.js / highs.wasm hashes and the HiGHS
// version/commit it declares, plus the hashes of the files actually on disk), node and tsx versions, the source tip, the run plan (repetitions, cache
// states, shards) and the exact `MOAFloorRequest` JSON of every case. `bench.ts` refuses to run when any of these identities differs.
//
// The cases were chosen from the ADR text and the platform list of docs/stage3-plan.md row 3.7, without any pilot floor run. Their "intent" is a
// predeclared expectation, not a result: the measured classification is reported whatever it is.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { MOAFloorRequest } from '../../src/api/client';

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

const addendum = process.argv.includes('--addendum');
const out = here(addendum ? './cases-addendum.json' : './cases.json');
if (existsSync(out)) throw new Error(`${out} already exists: the cases are frozen; delete it deliberately to re-freeze (and say so in the report)`);

const SNAPSHOT_SHA256 = '219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c';
const snapshotPath = here('../snapshot.json');
if (sha256(snapshotPath) !== SNAPSHOT_SHA256) throw new Error('benchmarks/snapshot.json is not the pinned artifact');

const manifestPath = here('../../public/highs-build-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  inputs: { highs: { version: string; commit: string; hConfigGithash: string } };
  artifacts: Record<string, { sha256: string; bytes: number }>;
};

// The acquisition domain of every case: the Phase 2.10 / Stage 3.4 request domain (flea on, every trader at loyalty 4, player level 50, no barters),
// written exactly as the UI's `domainRequestOf` writes a floor request (unset constraints absent, never 0). No `time_limit_ms`: the default 30 s.
const LL4 = { prapor: 4, skier: 4, peacekeeper: 4, mechanic: 4, jaeger: 4, ref: 4 };
const domain = (weaponId: string, extra: Partial<MOAFloorRequest> = {}): MOAFloorRequest => ({
  weapon_id: weaponId,
  ...extra,
  trader_levels: { ...LL4 },
  player_level: 50,
  flea_available: true,
  barter_available: false,
  barter_exclude_dogtags: true,
});

const GUN = {
  M4A1: '5447a9cd4bdc2dbd208b4567',
  AK74N: '5644bd2b4bdc2d3b4c8b4572',
  AKM: '59d6088586f774275f37482f',
  NL545DI: '68c16b9ab6b75a8a480520a6',
  MP5: '5926bb2186f7744b1c6c6e60',
  SR25: '5df8ce05b11454561e39243b',
  M870: '5a7828548dc32e5a9c28b516',
  M45A1: '5f36a0e5fbf956000b716b65',
};

interface FrozenCase {
  id: string;
  group: 'large' | 'control' | 'trueErgo' | 'nonlinear' | 'no_witness' | 'addendum_edge' | 'addendum_infeasible';
  weapon: string;
  intent: string;
  request: MOAFloorRequest;
}

const primaryCases: FrozenCase[] = [
  { id: 'L1-M4A1', group: 'large', weapon: 'M4A1', intent: 'large platform, plain floor (ordinary Auto plain resolves Precise here)', request: domain(GUN.M4A1) },
  { id: 'L2-AK74N', group: 'large', weapon: 'AK-74N', intent: 'large platform, plain floor', request: domain(GUN.AK74N) },
  { id: 'L3-AKM', group: 'large', weapon: 'AKM', intent: 'large platform, plain floor', request: domain(GUN.AKM) },
  { id: 'L4-NL545DI', group: 'large', weapon: 'NL545 DI', intent: 'large platform, plain floor', request: domain(GUN.NL545DI) },
  { id: 'C1-MP5', group: 'control', weapon: 'MP5', intent: 'smaller control, plain floor', request: domain(GUN.MP5) },
  { id: 'C2-SR25', group: 'control', weapon: 'SR-25', intent: 'smaller control (DMR), plain floor', request: domain(GUN.SR25) },
  { id: 'C3-M870', group: 'control', weapon: 'M870', intent: 'smaller control (shotgun), plain floor', request: domain(GUN.M870) },
  { id: 'C4-M45A1', group: 'control', weapon: 'M45A1', intent: 'smaller control (pistol), plain floor', request: domain(GUN.M45A1) },
  {
    id: 'T1-M4A1-TE-PO', group: 'trueErgo', weapon: 'M4A1',
    intent: 'TrueErgo-flavoured floor on a large platform (ordinary Auto with TrueErgo resolves Fast; the floor stays Precise): TrueErgo + Prevent Overswing, gear -25%. The floor drops the TrueErgo objective (constant zero) but keeps TED >= 0 as a hard constraint, so the spatial weight search runs',
    request: domain(GUN.M4A1, { use_true_ergo: true, prevent_overswing: true, equip_ergo_modifier: -0.25 }),
  },
  {
    id: 'T2-NL545DI-TE-PO', group: 'trueErgo', weapon: 'NL545 DI',
    intent: 'TrueErgo-flavoured floor on a large platform: TrueErgo + Prevent Overswing, gear -15%',
    request: domain(GUN.NL545DI, { use_true_ergo: true, prevent_overswing: true, equip_ergo_modifier: -0.15 }),
  },
  {
    id: 'R1-SR25-PO', group: 'nonlinear', weapon: 'SR-25',
    intent: 'nonlinear rejected-candidate path: heavy DMR with Prevent Overswing at gear -30%, where TED >= 0 is expected to bind near the accuracy-optimal builds, so decoded candidates that overswing are expected to be rejected by the exact validator and cut (telemetry rejectedCandidates)',
    request: domain(GUN.SR25, { prevent_overswing: true, equip_ergo_modifier: -0.3 }),
  },
  {
    id: 'N1-SR25-PO-60', group: 'no_witness', weapon: 'SR-25',
    intent: 'difficult infeasible / no-witness candidate: Prevent Overswing at gear -60% on a heavy DMR (TED >= 0 then needs raw ergonomics well above what an SR-25 is expected to reach at its weight); the seed itself must find a TED-feasible build or prove emptiness through the nonlinear weight search, and may spend the whole deadline',
    request: domain(GUN.SR25, { prevent_overswing: true, equip_ergo_modifier: -0.6 }),
  },
  {
    id: 'N2-AKM-ERGO80-60K', group: 'no_witness', weapon: 'AKM',
    intent: 'difficult infeasible / no-witness candidate: AKM with minimum ergonomics 80 under a 60,000 RUB budget (expected to be at or beyond the reachable combination); the seed may prove emptiness, find a build, or spend the deadline',
    request: domain(GUN.AKM, { max_price: 60000, min_ergonomics: 80 }),
  },
];

/**
 * The post-hoc addendum, declared as such: the primary run showed that no primary case spends the deadline (N1's premise was wrong, N2's seed
 * emptiness is fast). These cases put the minimum ergonomics AT (edge-feasible: only ergonomics-optimal builds qualify) and just ABOVE (infeasible)
 * the certified budgeted maximum ergonomics of two large platforms, measured by production Precise Optimize (calibrate-addendum.ts), never by a floor.
 * They are reported separately and never mixed into the primary denominators.
 */
function addendumCases(): FrozenCase[] {
  const calibration = JSON.parse(readFileSync(here('./calibration.json'), 'utf8')) as Record<string, { status: string; certificate: string; ergonomics: number | null }>;
  const max = (key: string): number => {
    const c = calibration[key];
    if (c === undefined || c.certificate !== 'certified_optimal' || c.ergonomics === null) throw new Error(`calibration ${key} is not a certified maximum`);
    return c.ergonomics;
  };
  const m4 = max('M4A1 @ 100000');
  const ak = max('AK-74N @ 60000');
  const above = (x: number): number => Math.round((x + 0.05) * 100) / 100;
  return [
    { id: 'X1-M4A1-EDGE', group: 'addendum_edge', weapon: 'M4A1', intent: `edge-feasible: budget 100,000 RUB and minimum ergonomics ${m4} = the certified maximum ergonomics under that budget (only ergonomics-optimal builds are witnesses)`, request: domain(GUN.M4A1, { max_price: 100000, min_ergonomics: m4 }) },
    { id: 'X2-M4A1-ABOVE', group: 'addendum_infeasible', weapon: 'M4A1', intent: `infeasible: budget 100,000 RUB and minimum ergonomics ${above(m4)}, just above the certified maximum ${m4}; the seed must prove emptiness or spend the deadline`, request: domain(GUN.M4A1, { max_price: 100000, min_ergonomics: above(m4) }) },
    { id: 'X3-AK74N-EDGE', group: 'addendum_edge', weapon: 'AK-74N', intent: `edge-feasible: budget 60,000 RUB and minimum ergonomics ${ak} = the certified maximum ergonomics under that budget`, request: domain(GUN.AK74N, { max_price: 60000, min_ergonomics: ak }) },
    { id: 'X4-AK74N-ABOVE', group: 'addendum_infeasible', weapon: 'AK-74N', intent: `infeasible: budget 60,000 RUB and minimum ergonomics ${above(ak)}, just above the certified maximum ${ak}`, request: domain(GUN.AK74N, { max_price: 60000, min_ergonomics: above(ak) }) },
  ];
}
const cases: FrozenCase[] = addendum ? addendumCases() : primaryCases;

// `npx tsx --version` prints the tsx version first, then node's.
const tsxVersion = (): string => execSync('npx tsx --version', { encoding: 'utf8', cwd: here('../..') }).split('\n').map(l => l.trim()).find(l => l.startsWith('tsx ')) ?? 'unknown';
let gitTip = 'unknown';
let gitDirtySrc = 'unknown';
let srcTree = 'unknown';
try {
  gitTip = execSync('git rev-parse HEAD', { encoding: 'utf8', cwd: here('../..') }).trim();
  // The production source identity: the git tree of frontend/src at the tip (test-only commits by other workstreams do not change it).
  srcTree = execSync('git rev-parse HEAD:frontend/src', { encoding: 'utf8', cwd: here('../..') }).trim();
  gitDirtySrc = execSync('git status --porcelain -- src reference public/highs.js public/highs.wasm public/highs-build-manifest.json', { encoding: 'utf8', cwd: here('../..') }).trim() || 'clean';
} catch { /* recorded as unknown */ }

const frozen = {
  schema: 1,
  workstream: 'Stage 3 workstream 3.7 (ADR 0013 section 7, MOA floor measurement)',
  ...(addendum ? { postHoc: 'DECLARED POST-HOC ADDENDUM: designed after the primary run (cases.json) showed no case spending the deadline; calibrated by production Precise Optimize (calibration.json), frozen before this addendum ran; reported separately from the primary denominators.' } : {}),
  frozenAt: new Date().toISOString(),
  identities: {
    snapshot: { path: 'frontend/benchmarks/snapshot.json', sha256: SNAPSHOT_SHA256 },
    highs: {
      manifestPath: 'frontend/public/highs-build-manifest.json',
      manifestSha256: sha256(manifestPath),
      version: manifest.inputs.highs.version,
      commit: manifest.inputs.highs.commit,
      hConfigGithash: manifest.inputs.highs.hConfigGithash,
      artifacts: manifest.artifacts,
      onDisk: { 'highs.js': sha256(here('../../public/highs.js')), 'highs.wasm': sha256(here('../../public/highs.wasm')) },
    },
    toolchain: { node: process.version, tsx: tsxVersion(), platform: `${process.platform}-${process.arch}` },
    source: { gitTip, srcTree, srcStatus: gitDirtySrc },
  },
  policy: {
    note: 'Production constants, not chosen here: default budget 30000 ms (DEFAULT_FLOOR_TIME_LIMIT_MS), at most 14 threshold trials (MOA_FLOOR_MAX_TRIALS), bracket tolerance 0.02 MOA, native stop mip_max_improving_sols=1, Precise. bench.ts asserts them at run time.',
    timeLimitMs: 30000, maxTrials: 14, bracketTolerance: 0.02, nativeStop: { mip_max_improving_sols: 1 },
  },
  plan: {
    repetitions: 3,
    cacheStates: ['cold', 'warm'],
    cacheStateDefinition: {
      cold: 'first floor request of a fresh node process: no HiGHS instance, no blueprint memo, no compatibility map (the item lookup is built from the snapshot before the request is sent, as a loaded IndexedDB/JSON data set would be)',
      warm: 'the identical request sent again to the same worker runtime right after the cold one finished: HiGHS instantiated, blueprint memoized on the same lookup, compatibility map cached; no result cache exists for floors',
    },
    shards: 8,
    plannedRequests: cases.length * 3 * 2,
    denominatorRule: 'every planned request counts in every rate, including errors, crashes and missing results',
  },
  cases,
};

writeFileSync(out, `${JSON.stringify(frozen, null, 2)}\n`);
console.log(`froze ${cases.length} cases (${frozen.plan.plannedRequests} planned requests) -> ${out}`);
