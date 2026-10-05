// The locale files (frontend/public/locales/*.json; CLAUDE.md "Internationalization", Phase 2.8): all 16 files end with the same key set as zh.json (the
// source of truth), every value is a nonempty string with the same interpolation placeholders as the English text, and every key the UI helpers and
// components ask for exists. Untranslated languages carry the English text (the project's documented fallback), never a missing key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { EFTFORGE_REFUSALS, eftforgeRefusalKey } from '../../src/components/common/eftforgeExport';
import { qualifierKey, allReasonKeys } from '../../src/components/common/resultView';
import type { AuthorityLevel } from '../../src/components/common/resultView';
import { CURVE_STATUSES, curveMeaningKey, curveStatusKey } from '../../src/components/explore/exploreView';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCALES = path.join(FRONTEND, 'public', 'locales');
const EXPECTED = ['cs', 'de', 'en', 'es', 'fr', 'hu', 'it', 'ja', 'ko', 'pl', 'pt', 'ro', 'ru', 'sk', 'tr', 'zh'];

type Tree = { [key: string]: string | Tree };
const flatten = (tree: Tree, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> => {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix === '' ? k : `${prefix}.${k}`;
    if (typeof v === 'object' && v !== null) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
};
const load = (lang: string): Record<string, unknown> => flatten(JSON.parse(readFileSync(path.join(LOCALES, `${lang}.json`), 'utf8')) as Tree);
const placeholders = (text: string): string => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m => m[1]).sort().join(',');

const locales = Object.fromEntries(EXPECTED.map(lang => [lang, load(lang)]));

test('there are exactly the 16 supported locale files', () => {
  assert.deepEqual(readdirSync(LOCALES).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')).sort(), EXPECTED);
});

test('all 16 files have the same key set as zh.json, and every value is a nonempty string', () => {
  const zhKeys = Object.keys(locales.zh).sort();
  assert.ok(zhKeys.length > 300, 'the source of truth is not empty');
  for (const lang of EXPECTED) {
    const keys = Object.keys(locales[lang]).sort();
    assert.deepEqual(keys.filter(k => !(k in locales.zh)), [], `${lang} has keys zh.json does not`);
    assert.deepEqual(zhKeys.filter(k => !(k in locales[lang])), [], `${lang} is missing keys of zh.json`);
    for (const key of keys) {
      const value = locales[lang][key];
      assert.ok(typeof value === 'string' && value.trim() !== '', `${lang} ${key} must be a nonempty string`);
    }
  }
});

test('every translation interpolates the same placeholders as the English text', () => {
  for (const lang of EXPECTED) {
    for (const [key, value] of Object.entries(locales[lang])) {
      assert.equal(placeholders(value as string), placeholders(locales.en[key] as string), `${lang} ${key}`);
    }
  }
});

const LEVELS: AuthorityLevel[] = ['certified_optimal', 'approximate_optimal', 'feasible', 'incomplete', 'certified_infeasible', 'error'];

/** Every key the pure helpers can ask for. */
const helperKeys = (): string[] => [
  ...allReasonKeys(),
  ...LEVELS.flatMap(level => [`results.authority_${level}`, `results.authority_${level}_short`, `results.authority_${level}_detail`]),
  ...(['fast_model', 'provisional_moa'] as const).flatMap(q => [qualifierKey(q), `${qualifierKey(q)}_tooltip`]),
  ...CURVE_STATUSES.flatMap(s => [curveStatusKey(s), curveMeaningKey(s)]),
  ...(['proved', 'witnessed', 'unresolved', 'infeasible'] as const).map(kind => `moa_floor.${kind}`),
  ...EFTFORGE_REFUSALS.map(eftforgeRefusalKey),
  'results.cancelled', 'results.bound_unknown', 'toast.cancelled', 'toast.optimize_approximate', 'toast.optimize_feasible', 'toast.optimize_incomplete',
  'toast.optimize_success', 'toast.optimize_infeasible', 'toast.optimize_failed', 'toast.gunsmith_success', 'toast.gunsmith_infeasible', 'toast.gunsmith_failed',
  'toast.explore_success', 'toast.explore_partial', 'toast.explore_cancelled', 'toast.explore_failed', 'toast.explore_empty', 'toast.explore_infeasible',
  'toast.explore_compare_partial',
];

test('every key the UI helpers can ask for exists in every language: one message per public reason, per authority level, per curve status and per export refusal', () => {
  const keys = helperKeys();
  assert.ok(keys.length > 60);
  for (const lang of EXPECTED) {
    assert.deepEqual(keys.filter(k => !(k in locales[lang])), [], `${lang}`);
  }
});

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

test('every literal t(\'...\') key in the UI source exists in en.json and zh.json (a typo in a new message is caught here, not in the browser)', () => {
  const missing: string[] = [];
  for (const file of sourceFiles(path.join(FRONTEND, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\bt\(\s*'([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)'/g)) {
      const key = match[1];
      if (!(key in locales.en) || !(key in locales.zh)) missing.push(`${path.relative(FRONTEND, file)}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});
