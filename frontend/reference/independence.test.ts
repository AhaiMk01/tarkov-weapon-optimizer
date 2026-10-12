// Stage 1 independence guard (ADR 0010 §1, §5; ADR 0013 §3).
//
// The reference oracle, validator and raw reader are the source of truth for later
// stages, so they must never load production extraction, compatibility maps, LP,
// HiGHS, decoding, scoring/pricing helpers or the production validator. Only files
// named `*.differential.test.ts` (tests) or `*.differential.ts` (helpers shared by
// those tests) may load production code, and only as the system under test that is
// compared against the reference. No other reference file may import a differential
// file, so the oracle can never reach production through a helper.
//
// The scanner itself lives in independenceScan.ts (a pure function over source text).
// This file runs it over the real tree and proves, on in-memory samples, that it
// catches every way of loading a module and does not flag the allowed forms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  guardViolations, isDifferentialFile, isDifferentialHelper, isDifferentialTest, isScannedFile, scanSource, SCANNED_EXTENSIONS,
  type IndependenceViolation, type ScanContext, type ViolationRule,
} from './independenceScan';

const referenceRoot = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(referenceRoot, '..');
const packageName = (JSON.parse(readFileSync(join(frontendRoot, 'package.json'), 'utf8')) as { name: string }).name;
const context: ScanContext = { referenceRoot, packageName };

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === 'node_modules' || name === 'raw') continue;
    if (statSync(full).isDirectory()) out.push(...listSources(full));
    else if (isScannedFile(name)) out.push(full);
  }
  return out;
}

// --- 1. the real tree ---------------------------------------------------------------------------------------------

test('reference code never loads production modules outside differential tests and helpers', () => {
  const files = listSources(referenceRoot);
  assert.ok(files.length > 50, `the scan must actually find the reference files, found ${files.length}`);
  const violations: string[] = [];
  for (const file of files) {
    for (const v of guardViolations(readFileSync(file, 'utf8'), file, context)) {
      violations.push(`${relative(frontendRoot, file)}:${v.line} ${v.rule} ${v.specifier ?? ''} (${v.detail})`);
    }
  }
  assert.deepEqual(violations, []);
});

test('the scan covers every extension that can carry an import, not only .ts', () => {
  for (const name of ['a.ts', 'a.mts', 'a.cts', 'a.tsx', 'a.js', 'a.mjs', 'a.cjs', 'a.jsx']) assert.equal(isScannedFile(name), true, name);
  for (const name of ['a.json', 'README.md', 'a.d.ts.map', 'a.txt']) assert.equal(isScannedFile(name), false, name);
  assert.ok(SCANNED_EXTENSIONS.length >= 8);
});

test('no non-differential file imports a differential file, and differential helpers exist so the rule is exercised', () => {
  const files = listSources(referenceRoot);
  const helpers = files.filter(isDifferentialHelper);
  assert.ok(helpers.length >= 2, `expected the harness helpers (*.differential.ts), found ${helpers.length}`);
  const importers: string[] = [];
  for (const file of files) {
    if (isDifferentialFile(file)) continue;
    for (const v of scanSource(readFileSync(file, 'utf8'), file, context)) {
      if (v.rule === 'differential-import') importers.push(`${relative(frontendRoot, file)}:${v.line} ${v.specifier ?? ''}`);
    }
  }
  assert.deepEqual(importers, []);
});

test('only *.differential.test.ts files are differential tests', () => {
  assert.equal(isDifferentialTest(join(referenceRoot, 'source', 'adapter.differential.test.ts')), true);
  for (const name of ['source/adapter.test.ts', 'source/adapter.differential.ts', 'source/differential.test.ts', 'source/adapter.differential.test.mts']) {
    assert.equal(isDifferentialTest(join(referenceRoot, name)), false, name);
  }
});

test('only *.differential.ts files are differential helpers', () => {
  assert.equal(isDifferentialHelper(join(referenceRoot, 'harness', 'toProduction.differential.ts')), true);
  for (const name of [
    'harness/toProduction.ts', 'harness/differential.ts', 'harness/toProduction.differential.test.ts', 'harness/toProduction.differential.mts',
    'harness/toProduction.differentials.ts', 'harness/toProduction-differential.ts', 'harness/toProduction.differential.json',
  ]) {
    assert.equal(isDifferentialHelper(join(referenceRoot, name)), false, name);
  }
});

test('the exemption covers differential tests and differential helpers, nothing else', () => {
  for (const name of ['source/adapter.differential.test.ts', 'harness/toProduction.differential.ts']) {
    assert.equal(isDifferentialFile(join(referenceRoot, name)), true, name);
  }
  for (const name of ['oracle/oracle.ts', 'oracle/oracle.test.ts', 'harness/scoreboard.ts', 'source/adapter.differential.test.mts', 'harness/x.differential.mts']) {
    assert.equal(isDifferentialFile(join(referenceRoot, name)), false, name);
  }
});

// --- 2. the scanner catches each form (in-memory samples; nothing is written into the tree) ---------------------------

const at = (rel: string) => join(referenceRoot, rel);
const lines = (...parts: string[]) => parts.join('\n');
const prod = join(frontendRoot, 'src', 'solver', 'solver.ts');

interface Sample {
  name: string;
  file: string;
  source: string;
  /** Rules of the expected violations, in source order. */
  rules: ViolationRule[];
}

const VIOLATING: Sample[] = [
  { name: 'static import escaping reference/', file: at('oracle/s.ts'), source: `import { solve } from '../../src/solver/solver';`, rules: ['outside-reference'] },
  { name: 'multi-line named import', file: at('oracle/s.ts'), source: lines('import {', '  a,', '  b,', `} from '../../src/solver/solver';`), rules: ['outside-reference'] },
  { name: 'side-effect import', file: at('oracle/s.ts'), source: `import '../../src/solver/solver';`, rules: ['outside-reference'] },
  { name: 'type-only import', file: at('oracle/s.ts'), source: `import type { X } from '../../src/types';`, rules: ['outside-reference'] },
  { name: 're-export with a name list', file: at('oracle/s.ts'), source: `export { a } from '../../src/solver/a';`, rules: ['outside-reference'] },
  { name: 'export star', file: at('oracle/s.ts'), source: `export * from '../../src/solver/a';`, rules: ['outside-reference'] },
  { name: 'type position import("...")', file: at('oracle/s.ts'), source: `type T = import('../../src/solver/a').Foo;`, rules: ['outside-reference'] },
  { name: 'dynamic import of a literal outside reference/', file: at('oracle/s.ts'), source: `const m = await import('../../src/solver/solver');`, rules: ['outside-reference'] },
  { name: 'dynamic import of a template literal (even without substitution)', file: at('oracle/s.ts'), source: 'const m = await import(`./q`);', rules: ['dynamic-import'] },
  { name: 'dynamic import of a template literal with substitution', file: at('oracle/s.ts'), source: 'const m = await import(`../../src/${name}`);', rules: ['dynamic-import'] },
  { name: 'dynamic import of a variable', file: at('oracle/s.ts'), source: lines(`const spec = './q';`, 'const m = await import(spec);'), rules: ['dynamic-import'] },
  { name: 'dynamic import of a concatenation', file: at('oracle/s.ts'), source: `const m = await import('./' + 'q');`, rules: ['dynamic-import'] },
  { name: 'dynamic import with no argument list to check', file: at('oracle/s.ts'), source: 'const m = await import();', rules: ['dynamic-import'] },
  { name: 'require call', file: at('oracle/s.ts'), source: `const x = require('../../src/solver/solver');`, rules: ['require'] },
  { name: 'require of a harmless-looking module', file: at('oracle/s.ts'), source: `const x = require('node:fs');`, rules: ['require'] },
  { name: 'require passed around as a value', file: at('oracle/s.ts'), source: lines('const load = require;', `load('../../src/a');`), rules: ['require'] },
  { name: 'createRequire import and call', file: at('oracle/s.ts'), source: lines(`import { createRequire } from 'node:module';`, 'const r = createRequire(import.meta.url);'), rules: ['require', 'require'] },
  { name: 'createRequire through a namespace', file: at('oracle/s.ts'), source: lines(`import * as m from 'node:module';`, 'const r = m.createRequire(import.meta.url);'), rules: ['require'] },
  { name: 'createRequire through a dynamic built-in import', file: at('oracle/s.ts'), source: `const { createRequire } = await import('node:module');`, rules: ['require'] },
  { name: 'module.require', file: at('oracle/s.ts'), source: `const x = module.require('../../src/a');`, rules: ['require'] },
  { name: 'string-keyed require', file: at('oracle/s.ts'), source: `const x = globalThis['require']('../../src/a');`, rules: ['require'] },
  { name: 'import x = require(...)', file: at('oracle/s.ts'), source: `import x = require('../../src/a');`, rules: ['require'] },
  { name: 'absolute POSIX specifier', file: at('oracle/s.ts'), source: `import x from '/etc/shadow.js';`, rules: ['outside-reference'] },
  { name: 'absolute path into production code', file: at('oracle/s.ts'), source: `import x from ${JSON.stringify(prod)};`, rules: ['outside-reference'] },
  { name: 'absolute dynamic import into production code', file: at('oracle/s.ts'), source: `const m = await import(${JSON.stringify(prod)});`, rules: ['outside-reference'] },
  { name: 'Windows drive-letter specifier', file: at('oracle/s.ts'), source: `import x from 'C:\\\\prod\\\\x.ts';`, rules: ['outside-reference'] },
  { name: 'Windows drive-letter specifier with forward slashes', file: at('oracle/s.ts'), source: `import x from 'C:/prod/x.ts';`, rules: ['outside-reference'] },
  { name: 'file: URL into production code', file: at('oracle/s.ts'), source: `import x from ${JSON.stringify(pathToFileURL(prod).href)};`, rules: ['outside-reference'] },
  { name: 'file: URL with a remote host', file: at('oracle/s.ts'), source: `import x from 'file://remote-host/share/x.ts';`, rules: ['outside-reference'] },
  { name: 'bare specifier naming the frontend package', file: at('oracle/s.ts'), source: `import { solve } from '${packageName}/src/solver/solver';`, rules: ['package-self'] },
  { name: 'bare specifier that is the frontend package', file: at('oracle/s.ts'), source: `import x from '${packageName}';`, rules: ['package-self'] },
  { name: '.mjs file', file: at('oracle/s.mjs'), source: `import '../../src/solver/solver.js';`, rules: ['outside-reference'] },
  { name: '.cjs file', file: at('oracle/s.cjs'), source: `const x = require('../../src/solver/solver');`, rules: ['require'] },
  { name: '.js file', file: at('oracle/s.js'), source: `import x from '../../src/solver/solver.js';`, rules: ['outside-reference'] },
  { name: '.mts file', file: at('oracle/s.mts'), source: `import type { X } from '../../src/types';`, rules: ['outside-reference'] },
  { name: '.cts file', file: at('oracle/s.cts'), source: `const x = require('../../src/solver/solver');`, rules: ['require'] },
  { name: '.tsx file', file: at('oracle/s.tsx'), source: lines(`import x from '../../src/App';`, 'export const y = <div />;'), rules: ['outside-reference'] },
  { name: 'escape from a deeper directory', file: at('bridge/deep/s.ts'), source: `import x from '../../../src/solver/solver';`, rules: ['outside-reference'] },
  { name: 'escape that first descends inside reference/', file: at('oracle/s.ts'), source: `import x from '../oracle/../../src/solver/solver';`, rules: ['outside-reference'] },
  { name: 'a sibling directory that merely shares the prefix', file: at('oracle/s.ts'), source: `import x from '../../reference-extra/x';`, rules: ['outside-reference'] },
  { name: 'static import of a differential helper', file: at('oracle/s.ts'), source: `import { toProduction } from '../harness/toProduction.differential';`, rules: ['differential-import'] },
  { name: 'static import of a differential helper with its .ts extension', file: at('oracle/s.ts'), source: `import { x } from '../harness/compare.differential.ts';`, rules: ['differential-import'] },
  { name: 'static import of a differential helper with a .js extension', file: at('oracle/s.ts'), source: `import { x } from '../harness/compare.differential.js';`, rules: ['differential-import'] },
  { name: 'static import of a differential test file', file: at('oracle/s.ts'), source: `import '../source/adapter.differential.test';`, rules: ['differential-import'] },
  { name: 'type-only import of a differential helper', file: at('bridge/s.ts'), source: `import type { ProductionInputs } from '../harness/toProduction.differential';`, rules: ['differential-import'] },
  { name: 're-export of a differential helper', file: at('oracle/s.ts'), source: `export { gradeCase } from '../harness/compare.differential';`, rules: ['differential-import'] },
  { name: 'export star of a differential helper', file: at('oracle/s.ts'), source: `export * from '../harness/compare.differential';`, rules: ['differential-import'] },
  { name: 'type position import("...") of a differential helper', file: at('oracle/s.ts'), source: `type T = import('../harness/compare.differential').CaseGrade;`, rules: ['differential-import'] },
  { name: 'dynamic import of a differential helper by literal', file: at('oracle/s.ts'), source: `const m = await import('../harness/compare.differential');`, rules: ['differential-import'] },
  { name: 'sibling import of a differential helper from a non-differential file in the same directory', file: at('harness/scoreboard.ts'), source: `import { gradeCase } from './compare.differential';`, rules: ['differential-import'] },
  { name: 'import of a differential helper through a path that first leaves and re-enters reference/', file: at('oracle/s.ts'), source: `import x from '../../reference/harness/compare.differential';`, rules: ['differential-import'] },
  { name: 'absolute path to a differential helper', file: at('oracle/s.ts'), source: `import x from ${JSON.stringify(join(referenceRoot, 'harness', 'compare.differential.ts'))};`, rules: ['differential-import'] },
  { name: 'file: URL to a differential helper', file: at('oracle/s.ts'), source: `import x from ${JSON.stringify(pathToFileURL(join(referenceRoot, 'harness', 'compare.differential.ts')).href)};`, rules: ['differential-import'] },
  { name: '.mts file importing a differential helper', file: at('oracle/s.mts'), source: `import x from '../harness/compare.differential.ts';`, rules: ['differential-import'] },
  {
    name: 'several violations are all reported, in source order',
    file: at('oracle/s.ts'),
    source: lines(
      `import a from './q';`, `import b from '../../src/a';`, 'const c = await import(`./${x}`);', `const d = require('./q');`,
      `import e from '${packageName}/x';`, `import f from '../harness/compare.differential';`,
    ),
    rules: ['outside-reference', 'dynamic-import', 'require', 'package-self', 'differential-import'],
  },
];

const ALLOWED: Sample[] = [
  {
    name: 'relative imports and re-exports inside reference/',
    file: at('bridge/s.ts'),
    source: lines(`import { q } from '../oracle/q';`, `import type { T } from '../oracle/index';`, `export * from './slice';`, `export { a } from '../source/pins';`, `import './side';`),
    rules: [],
  },
  {
    name: 'node: built-ins, static and dynamic',
    file: at('oracle/s.ts'),
    source: lines(`import { test } from 'node:test';`, `import fs from 'node:fs';`, `import 'node:process';`, `const m = await import('node:path');`),
    rules: [],
  },
  {
    name: 'bare package names (production code is not published as a package)',
    file: at('oracle/s.ts'),
    source: lines(`import ts from 'typescript';`, `import lz from 'lz-string';`, `import x from '@scope/pkg/sub';`, `import fsx from 'fs';`, `import y from '${packageName}-utils';`),
    rules: [],
  },
  {
    name: 'dynamic import of a literal that resolves inside reference/',
    file: at('oracle/s.ts'),
    source: lines(`const a = await import('./q');`, `const b = await import('../source/pins.ts');`),
    rules: [],
  },
  {
    name: 'absolute and file: specifiers that resolve inside reference/',
    file: at('oracle/s.ts'),
    source: lines(
      `import a from ${JSON.stringify(join(referenceRoot, 'oracle', 'index.ts'))};`,
      `import b from ${JSON.stringify(pathToFileURL(join(referenceRoot, 'oracle', 'q.ts')).href)};`,
      `const c = await import(${JSON.stringify(join(referenceRoot, 'source', 'pins.ts'))});`,
    ),
    rules: [],
  },
  {
    name: 'import attributes',
    file: at('oracle/s.ts'),
    source: lines(`import data from './x.json' with { type: 'json' };`, `const d = await import('./x.json', { with: { type: 'json' } });`),
    rules: [],
  },
  {
    name: 'near-miss names that are not differential files',
    file: at('harness/s.ts'),
    source: lines(
      `import a from './differential';`,
      `import b from './toProduction.differentials';`,
      `import c from './toProduction-differential';`,
      `import d from './notdifferential';`,
      `import e from './toProduction.differential.json' with { type: 'json' };`,
      `import f from './differential.test';`,
      `import g from './toProduction';`,
    ),
    rules: [],
  },
  {
    name: 'comments and strings that merely mention a differential import',
    file: at('oracle/s.ts'),
    source: lines(`// import x from '../harness/compare.differential';`, `const note = "import x from '../harness/compare.differential'";`, `export const ok = note;`),
    rules: [],
  },
  {
    name: 'comments, strings, regex literals and member names that merely mention the forbidden words',
    file: at('oracle/s.ts'),
    source: lines(
      `// import x from '../../src/solver/solver';`,
      `/* const y = require('z'); await import('../../src/a'); createRequire */`,
      `const text = "import x from '../../src/a'; require('b'); createRequire";`,
      'const note = `import(\'../../src/a\') and require(x)`;',
      `const re = /require\\(['"]|import\\(/;`,
      `const obj = { require: true, createRequire: 1 };`,
      `interface Opts { require: boolean; createRequire(): void }`,
      `class K { require = 1; createRequire() {} }`,
      `export const ok = [text, note, re, obj, new K()];`,
    ),
    rules: [],
  },
];

const rulesOf = (violations: IndependenceViolation[]) => violations.map(v => v.rule);
const describeAll = (violations: IndependenceViolation[]) => violations.map(v => `${v.rule}@${v.line}: ${v.detail}`).join('; ') || 'none';

for (const sample of VIOLATING) {
  test(`scanner catches: ${sample.name}`, () => {
    const violations = scanSource(sample.source, sample.file, context);
    assert.deepEqual(rulesOf(violations), sample.rules, describeAll(violations));
  });
}

for (const sample of ALLOWED) {
  test(`scanner allows: ${sample.name}`, () => {
    const violations = scanSource(sample.source, sample.file, context);
    assert.deepEqual(rulesOf(violations), [], describeAll(violations));
  });
}

// --- 3. the policy: who is exempt (differential tests and helpers), who is scanned (everyone else) ---------------------

interface PolicySample {
  name: string;
  file: string;
  source: string;
  rules: ViolationRule[];
}

const POLICY: PolicySample[] = [
  { name: 'a differential helper may import production code', file: at('harness/toProduction.differential.ts'), source: `import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';`, rules: [] },
  { name: 'a differential helper may import a production type', file: at('harness/toProduction.differential.ts'), source: `import type { SolveParams } from '../../src/solver/types';`, rules: [] },
  { name: 'a differential helper may load production through a non-literal dynamic import', file: at('harness/compare.differential.ts'), source: lines(`const SPEC = '../../src/solver/solver.ts';`, 'const m = await import(SPEC);'), rules: [] },
  { name: 'a differential helper may import another differential helper', file: at('harness/compare.differential.ts'), source: `import { toProduction } from './toProduction.differential';`, rules: [] },
  { name: 'a differential test may import a differential helper', file: at('harness/ledger.differential.test.ts'), source: lines(`import { gradeCase } from './compare.differential';`, `import { solve } from '../../src/solver/solver';`), rules: [] },
  { name: 'a differential test may still import production code', file: at('source/adapter.differential.test.ts'), source: `import { fetchAllDataFromJsonApi } from '../../src/solver/jsonApiAdapter';`, rules: [] },
  { name: 'a plain test file may not import production code', file: at('harness/scoreboard.test.ts'), source: `import { solve } from '../../src/solver/solver';`, rules: ['outside-reference'] },
  { name: 'a plain reference file may not import a differential helper', file: at('harness/scoreboard.ts'), source: `import { gradeCase } from './compare.differential';`, rules: ['differential-import'] },
  { name: 'a plain test file may not import a differential test', file: at('oracle/oracle.test.ts'), source: `import '../source/adapter.differential.test';`, rules: ['differential-import'] },
  { name: 'a plain file named near a differential one is scanned like any other', file: at('harness/toProduction.differentials.ts'), source: `import { x } from '../../src/solver/solver';`, rules: ['outside-reference'] },
  { name: 'a .mts file named like a differential helper is not exempt', file: at('harness/toProduction.differential.mts'), source: `import { x } from '../../src/solver/solver';`, rules: ['outside-reference'] },
];

for (const sample of POLICY) {
  test(`guard policy: ${sample.name}`, () => {
    const violations = guardViolations(sample.source, sample.file, context);
    assert.deepEqual(rulesOf(violations), sample.rules, describeAll(violations));
  });
}

test('scanner reports the line and the specifier of each violation', () => {
  const source = lines(`import ok from './q';`, '', `import {`, '  a,', `} from '../../src/solver/solver';`, '', `const m = await import(name);`);
  const violations = scanSource(source, at('oracle/s.ts'), context);
  assert.deepEqual(violations.map(v => [v.rule, v.line, v.specifier]), [
    ['outside-reference', 3, '../../src/solver/solver'],
    ['dynamic-import', 7, null],
  ]);
});

test('the guard fails on a violation planted in a copy of a real reference file', () => {
  // Same file, same relative position: the unmodified text is clean, the text with one added import is not.
  const file = at('oracle/acquisition.ts');
  const real = readFileSync(file, 'utf8');
  assert.deepEqual(scanSource(real, file, context), []);
  const planted = scanSource(`${real}\nimport '../../src/solver/solver';\n`, file, context);
  assert.deepEqual(rulesOf(planted), ['outside-reference']);
});

test('the sample tables are not trivially small and every rule is exercised', () => {
  assert.ok(VIOLATING.length >= 30 && ALLOWED.length >= 6 && POLICY.length >= 8);
  const seen = new Set(VIOLATING.flatMap(s => s.rules));
  for (const rule of ['outside-reference', 'require', 'dynamic-import', 'package-self', 'differential-import'] as const) assert.ok(seen.has(rule), rule);
});
