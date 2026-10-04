// Static scanner behind the Stage 1 independence guard (ADR 0010 section 1 and 5, ADR 0013 section 3).
//
// The reference oracle, validator and raw reader are the source of truth for later stages, so they must
// never load production extraction, compatibility maps, LP, HiGHS, decoding, scoring/pricing helpers or the
// production validator. Only files named `*.differential.test.ts` may load production code, and only as the
// system under test that is compared against the reference.
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
  | 'package-self';

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

/** Differential tests are the only files allowed to load production code. */
export function isDifferentialTest(file: string): boolean {
  return file.endsWith('.differential.test.ts');
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
  if (spec.startsWith('node:')) return null;
  if (spec.startsWith('file:')) {
    let target: string;
    try {
      target = fileURLToPath(spec);
    } catch {
      return outside('file: URL cannot be converted to a path');
    }
    return isInside(context.referenceRoot, target) ? null : outside(`resolves to ${target}`);
  }
  if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')) {
    const target = resolve(dirname(file), spec);
    return isInside(context.referenceRoot, target) ? null : outside(`resolves to ${target}`);
  }
  if (isAbsolute(spec)) {
    return isInside(context.referenceRoot, resolve(spec)) ? null : outside('absolute path outside reference/');
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
