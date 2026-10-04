// Stage 1 independence guard (ADR 0010 §1, §5; ADR 0013 §3).
//
// The reference oracle, validator and raw reader are the source of truth for later
// stages, so they must never load production extraction, compatibility maps, LP,
// HiGHS, decoding, scoring/pricing helpers or the production validator. Only files
// named `*.differential.test.ts` may load production code, and only as the system
// under test that is compared against the reference.
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
  isDifferentialTest, isScannedFile, scanSource, SCANNED_EXTENSIONS,
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

test('reference code never loads production modules outside differential tests', () => {
  const files = listSources(referenceRoot);
  assert.ok(files.length > 50, `the scan must actually find the reference files, found ${files.length}`);
  const violations: string[] = [];
  for (const file of files) {
    if (isDifferentialTest(file)) continue;
    for (const v of scanSource(readFileSync(file, 'utf8'), file, context)) {
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

test('only *.differential.test.ts files are exempt from the guard', () => {
  assert.equal(isDifferentialTest(join(referenceRoot, 'source', 'adapter.differential.test.ts')), true);
  for (const name of ['source/adapter.test.ts', 'source/adapter.differential.ts', 'source/differential.test.ts', 'source/adapter.differential.test.mts']) {
    assert.equal(isDifferentialTest(join(referenceRoot, name)), false, name);
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
  { name: 'multi-line named import', file: at('oracle/s.ts'), source: lines('import {', '  a,', '  b,', `} from '../../src/solver/lpBuilder';`), rules: ['outside-reference'] },
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
  {
    name: 'several violations are all reported, in source order',
    file: at('oracle/s.ts'),
    source: lines(`import a from './q';`, `import b from '../../src/a';`, 'const c = await import(`./${x}`);', `const d = require('./q');`, `import e from '${packageName}/x';`),
    rules: ['outside-reference', 'dynamic-import', 'require', 'package-self'],
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
    source: lines(`import ts from 'typescript';`, `import { Highs } from 'highs';`, `import x from '@scope/pkg/sub';`, `import fsx from 'fs';`, `import y from '${packageName}-utils';`),
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
  assert.ok(VIOLATING.length >= 30 && ALLOWED.length >= 6);
  const seen = new Set(VIOLATING.flatMap(s => s.rules));
  for (const rule of ['outside-reference', 'require', 'dynamic-import', 'package-self'] as const) assert.ok(seen.has(rule), rule);
});
