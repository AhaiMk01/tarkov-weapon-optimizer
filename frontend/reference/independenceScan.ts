// Static scanner behind the Stage 1 independence guard (ADR 0010 section 1 and 5, ADR 0013 section 3).
//
// The reference oracle, validator and raw reader are the source of truth for later stages, so they must
// never load production extraction, compatibility maps, LP, HiGHS, decoding, scoring/pricing helpers or the
// production validator. Only files named `*.differential.test.ts` (tests) or `*.differential.ts` (helpers
// shared by those tests, e.g. the ledger-to-production harness) may load production code, and only as the
// system under test that is compared against the reference. The converse rule keeps the exemption from
// leaking: no file outside that set may import a differential file (static, type-only, re-export or literal
// dynamic import), so the oracle can never reach production through a helper.
//
// The scanner parses a file with the TypeScript parser (so comments, strings and regex literals can never
// trigger or hide a finding) and reports every way a module can be pulled in:
//
//   * static `import ... from`, side-effect `import '...'`, `import type`, `export ... from`, `export * from`
//     and `type T = import('...').X`;
//   * dynamic `import(...)`: the argument must be a single string literal (a template literal or any
//     expression cannot be checked statically, so it is itself a violation);
//   * `require`, `createRequire` and `import x = require(...)`: any use at all, because CommonJS loading
//     is not statically checkable here.
//
// A specifier that can be resolved (relative, absolute or `file:`) must resolve inside `reference/`.
// `node:` built-ins are allowed. Bare package names stay allowed (no production code is published as a
// package) with one exception: a bare specifier that names the frontend package itself.
//
// Limits: this is static analysis of the module graph, not a sandbox. Code that builds source text and
// runs it (`eval`, `new Function`) or reads and executes files by other means is outside what it can see.
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export type ViolationRule =
  /** A relative, absolute or `file:` specifier that resolves (or cannot be proved to resolve) outside `reference/`. */
  | 'outside-reference'
  /** `require`, `createRequire` or `import x = require(...)`. */
  | 'require'
  /** A dynamic `import(...)` whose argument is not a single string literal. */
  | 'dynamic-import'
  /** A bare specifier that names the frontend package itself. */
  | 'package-self'
  /** A specifier that resolves to a differential file (`*.differential.ts` or `*.differential.test.ts`). */
  | 'differential-import';

export interface IndependenceViolation {
  rule: ViolationRule;
  /** The module specifier involved, or null when there is none (`require`, a non-literal `import(...)`). */
  specifier: string | null;
  /** 1-based line of the offending construct. */
  line: number;
  detail: string;
}

export interface ScanContext {
  /** Absolute path of `frontend/reference`. */
  referenceRoot: string;
  /** `name` from frontend/package.json. */
  packageName: string;
}

/** Extensions that can carry module imports; every one of them is scanned (not just `.ts`). */
export const SCANNED_EXTENSIONS: readonly string[] = ['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.jsx'];

export function isScannedFile(name: string): boolean {
  return SCANNED_EXTENSIONS.some(ext => name.endsWith(ext));
}

/** A differential test: `*.differential.test.ts`. */
export function isDifferentialTest(file: string): boolean {
  return file.endsWith('.differential.test.ts');
}

/** A differential helper shared by differential tests: `*.differential.ts` (never a `.test.ts`). */
export function isDifferentialHelper(file: string): boolean {
  return file.endsWith('.differential.ts');
}

/** Differential tests and differential helpers are the only files allowed to load production code. */
export function isDifferentialFile(file: string): boolean {
  return isDifferentialTest(file) || isDifferentialHelper(file);
}

/** True when a resolved import target (any extension or none) names a differential module. */
function namesDifferentialModule(target: string): boolean {
  return /\.differential(\.test)?$/.test(target.replace(/\.[cm]?[jt]sx?$/, ''));
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (rel === '') return true;
  if (isAbsolute(rel)) return false; // another drive on Windows
  return rel !== '..' && !rel.startsWith(`..${sep}`);
}

/** Classify one static module specifier written in `file`. Null means allowed. */
function checkSpecifier(spec: string, file: string, context: ScanContext): { rule: ViolationRule; detail: string } | null {
  const outside = (detail: string) => ({ rule: 'outside-reference' as const, detail });
  // A target inside reference/ is fine unless it is a differential module: only differential files may import those.
  const inside = (target: string, outsideDetail: string) => {
    if (!isInside(context.referenceRoot, target)) return outside(outsideDetail);
    if (namesDifferentialModule(target)) {
      return { rule: 'differential-import' as const, detail: `imports the differential module ${target}; only differential files may` };
    }
    return null;
  };
  if (spec.startsWith('node:')) return null;
  if (spec.startsWith('file:')) {
    let target: string;
    try {
      target = fileURLToPath(spec);
    } catch {
      return outside('file: URL cannot be converted to a path');
    }
    return inside(target, `resolves to ${target}`);
  }
  if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')) {
    const target = resolve(dirname(file), spec);
    return inside(target, `resolves to ${target}`);
  }
  if (isAbsolute(spec)) {
    return inside(resolve(spec), 'absolute path outside reference/');
  }
  // A drive-letter or backslash-rooted path that this platform does not treat as absolute cannot be proved inside.
  if (/^[A-Za-z]:[\\/]/.test(spec) || spec.startsWith('\\')) return outside('absolute path that cannot be resolved on this platform');
  if (spec === context.packageName || spec.startsWith(`${context.packageName}/`)) {
    return { rule: 'package-self', detail: `bare specifier names the frontend package "${context.packageName}"` };
  }
  return null; // bare package or unprefixed built-in
}

const FORBIDDEN_IDENTIFIERS: ReadonlySet<string> = new Set(['require', 'createRequire']);

/** True when the identifier only names an object, type or class member, which loads nothing. */
function isMemberDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent)) &&
    parent.name === node
  );
}

/** Scan one source text as if it were the file `file`. Pure: reads nothing from disk. */
export function scanSource(source: string, file: string, context: ScanContext): IndependenceViolation[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const violations: IndependenceViolation[] = [];
  const lineOf = (node: ts.Node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const add = (node: ts.Node, rule: ViolationRule, specifier: string | null, detail: string) =>
    violations.push({ rule, specifier, line: lineOf(node), detail });
  const checkStatic = (node: ts.Node, spec: string) => {
    const problem = checkSpecifier(spec, file, context);
    if (problem) add(node, problem.rule, spec, problem.detail);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      checkStatic(node, node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      checkStatic(node, node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node, 'require', null, 'import x = require(...) is CommonJS loading');
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      checkStatic(node, node.argument.literal.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument !== undefined && ts.isStringLiteral(argument)) checkStatic(node, argument.text);
      else add(node, 'dynamic-import', null, 'the argument of a dynamic import() must be a single string literal');
    } else if (ts.isIdentifier(node) && FORBIDDEN_IDENTIFIERS.has(node.text) && !isMemberDeclarationName(node)) {
      add(node, 'require', null, `${node.text} loads modules outside the statically checked graph`);
    } else if (
      ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) &&
      FORBIDDEN_IDENTIFIERS.has(node.argumentExpression.text)
    ) {
      add(node, 'require', null, `["${node.argumentExpression.text}"] loads modules outside the statically checked graph`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

/**
 * The guard's policy for one file: differential tests and helpers are exempt (they may load production code and
 * each other); every other file is scanned, and importing a differential file counts as a violation there.
 */
export function guardViolations(source: string, file: string, context: ScanContext): IndependenceViolation[] {
  return isDifferentialFile(file) ? [] : scanSource(source, file, context);
}
