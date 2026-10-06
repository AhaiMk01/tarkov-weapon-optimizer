// The Advanced menu (src/components/common/AdvancedOptions.tsx and its pure rules in advancedDefaults.ts, owner decision 2c) and its quiet traces: the
// defaults and persistence read, when "Allow repeated parts" has anything to act on, the one-copy note that only the Details panel shows, and the
// locale strings of the menu in every language.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { ExploreResponse, OptimizeResponse } from '../../src/api/client';
import {
  ADVANCED_DEFAULTS, ALLOW_REPEATED_PARTS_STORAGE_KEY, isAdvancedDefault, readAllowRepeatedParts, repeatedPartsApply,
} from '../../src/components/common/advancedDefaults';
import { resultViewOf } from '../../src/components/common/resultView';
import { runSingleCopy } from '../../src/components/explore/exploreView';
import type { ExploreWeaponRun } from '../../src/components/explore/exploreView';

test('the menu defaults: Auto, repeated parts off, Sweet Spot off', () => {
  assert.deepEqual(ADVANCED_DEFAULTS, { solverPrecision: 'auto', allowRepeatedParts: false, useTchebycheff: false });
  assert.equal(isAdvancedDefault({ solverPrecision: 'auto', allowRepeatedParts: false, useTchebycheff: false }), true);
  assert.equal(isAdvancedDefault({ solverPrecision: 'auto', allowRepeatedParts: false }), true, 'a panel without Sweet Spot (Explore) has nothing to differ');
  assert.equal(isAdvancedDefault({ solverPrecision: 'fast', allowRepeatedParts: false }), false);
  assert.equal(isAdvancedDefault({ solverPrecision: 'auto', allowRepeatedParts: true }), false);
  assert.equal(isAdvancedDefault({ solverPrecision: 'auto', allowRepeatedParts: false, useTchebycheff: true }), false);
});

test('the stored repeated-parts choice: only the exact string true turns it on, everything else is the default (off)', () => {
  assert.equal(ALLOW_REPEATED_PARTS_STORAGE_KEY, 'allowRepeatedParts');
  assert.equal(readAllowRepeatedParts('true'), true);
  for (const stored of [null, undefined, '', 'false', 'TRUE', '1', 'yes']) assert.equal(readAllowRepeatedParts(stored), false, String(stored));
});

test('Allow repeated parts acts on Fast and Auto; with Precise (which always allows repeats) the control is disabled', () => {
  assert.equal(repeatedPartsApply('fast'), true);
  assert.equal(repeatedPartsApply('auto'), true);
  assert.equal(repeatedPartsApply('precise'), false);
});

// ---------------------------------------------------------------------------------------------------------------------------
// The quiet note
// ---------------------------------------------------------------------------------------------------------------------------

const optimization = { lower_bound: null, upper_bound: null, absolute_gap: null, tolerance: 1e-5, nodes: 0, termination: 'optimal' } as const;
const fastResult = (over: Partial<OptimizeResponse> = {}) => ({
  status: 'optimal' as const, physical_certificate: 'approximate_optimal' as const, model_qualification: 'approximate' as const, moa_qualification: null,
  precision_resolved: 'fast' as const, optimization, ...over,
});

test('the result view carries the one-copy note only for a Fast result that says so; the plain headline is the same with or without it', () => {
  const plain = resultViewOf(fastResult());
  const note = resultViewOf(fastResult({ single_copy: true }));
  assert.equal(plain.singleCopy, false);
  assert.equal(note.singleCopy, true);
  assert.deepEqual({ ...note, singleCopy: false }, plain, 'nothing else about the result changes (headline, tone, meta, authority, bounds)');
  // A Precise result never carries the note, even if a stray field says so.
  const precise = resultViewOf({ ...fastResult({ single_copy: true }), physical_certificate: 'certified_optimal', model_qualification: 'exact', precision_resolved: 'precise' });
  assert.equal(precise.singleCopy, false);
});

const exploreResponse = (over: Partial<ExploreResponse> = {}): ExploreResponse => ({
  curve_status: 'complete', points: [], sweep_schedule: [], step_outcomes: [], total_solve_time_ms: 0, precision_request: 'fast', precision_resolved: 'fast',
  model_qualification: 'approximate', moa_qualification: null, ...over,
});
const run = (id: string, response: ExploreResponse | null): ExploreWeaponRun => ({ weaponId: id, weaponName: id, response, phase: 'done' });

test('an Explore run set shows the one-copy note when any sweep ran Fast with one copy of each part', () => {
  assert.equal(runSingleCopy([]), false);
  assert.equal(runSingleCopy([run('a', null)]), false);
  assert.equal(runSingleCopy([run('a', exploreResponse())]), false, 'a Fast sweep that allowed repeats says nothing');
  assert.equal(runSingleCopy([run('a', exploreResponse({ single_copy: true }))]), true);
  assert.equal(runSingleCopy([run('a', exploreResponse()), run('b', exploreResponse({ single_copy: true }))]), true);
  assert.equal(runSingleCopy([run('a', exploreResponse({ single_copy: true, precision_resolved: 'precise', model_qualification: 'exact' }))]), false);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Locale strings
// ---------------------------------------------------------------------------------------------------------------------------

const LOCALES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'locales');
const LANGUAGES = ['cs', 'de', 'en', 'es', 'fr', 'hu', 'it', 'ja', 'ko', 'pl', 'pt', 'ro', 'ru', 'sk', 'tr', 'zh'];
type Tree = { [key: string]: string | Tree };
const locale = (lang: string): Tree => JSON.parse(readFileSync(path.join(LOCALES, `${lang}.json`), 'utf8')) as Tree;
const lookup = (tree: Tree, dotted: string): unknown => dotted.split('.').reduce<unknown>((node, part) => (typeof node === 'object' && node !== null ? (node as Tree)[part] : undefined), tree);

const MENU_KEYS = [
  'advanced.title', 'advanced.solver_precision', 'advanced.allow_repeated_parts', 'advanced.allow_repeated_parts_tooltip',
  'results.one_copy_per_part', 'results.one_copy_per_part_tooltip', 'sidebar.auto', 'sidebar.fast', 'sidebar.precise', 'sidebar.solver_precision_tooltip',
  'optimize.tchebycheff', 'optimize.tchebycheff_tooltip', 'ui.on', 'ui.off', 'ui.reset',
];

test('every string the Advanced menu and the one-copy note ask for exists in all 16 languages', () => {
  for (const lang of LANGUAGES) {
    const tree = locale(lang);
    for (const key of MENU_KEYS) assert.ok(typeof lookup(tree, key) === 'string' && (lookup(tree, key) as string).trim() !== '', `${lang} ${key}`);
  }
});

test('the zh source of truth names the menu plainly, and the methodology paragraph of Fast states the default and the toggle in zh and en', () => {
  const zh = locale('zh');
  const en = locale('en');
  assert.equal(lookup(zh, 'advanced.title'), '高级');
  assert.equal(lookup(en, 'advanced.title'), 'Advanced');
  assert.equal(lookup(en, 'advanced.allow_repeated_parts'), 'Allow repeated parts');
  assert.match(lookup(zh, 'methodology.precision_fast') as string, /每种配件最多只用一件/);
  assert.match(lookup(zh, 'methodology.precision_fast') as string, /允许重复配件/);
  assert.match(lookup(en, 'methodology.precision_fast') as string, /at most one of each part/);
  assert.match(lookup(en, 'methodology.precision_fast') as string, /Allow repeated parts/);
  // The tooltip says what the brief asks: Fast default, Precise always repeats, slightly better builds for extreme settings, a little slower.
  const tip = lookup(en, 'advanced.allow_repeated_parts_tooltip') as string;
  for (const part of [/Fast/, /at most one of each part/, /Precise always allows/, /slightly better/, /a little slower/]) assert.match(tip, part);
  // The Sweet Spot and precision controls moved into the menu and kept their own strings: no duplicate keys were introduced.
  assert.equal(lookup(en, 'optimize.tchebycheff'), 'Sweet Spot Mode (Tchebycheff)');
});
