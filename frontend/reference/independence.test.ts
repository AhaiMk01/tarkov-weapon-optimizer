// Stage 1 independence guard (ADR 0010 §1, §5; ADR 0013 §3).
//
// The reference oracle, validator and raw reader are the source of truth for later
// stages, so they must never import production extraction, compatibility maps, LP,
// HiGHS, decoding, scoring/pricing helpers or the production validator. Only files
// named `*.differential.test.ts` may import production code, and only as the system
// under test that is compared against the reference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const referenceRoot = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(referenceRoot, '..');

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === 'node_modules' || name === 'raw') continue;
    if (statSync(full).isDirectory()) out.push(...listTs(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const importPattern = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

test('reference code never imports production modules outside differential tests', () => {
  const violations: string[] = [];
  for (const file of listTs(referenceRoot)) {
    if (file.endsWith('.differential.test.ts')) continue;
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(importPattern)) {
      const spec = match[1] ?? match[2];
      if (!spec || !spec.startsWith('.')) continue;
      const target = resolve(dirname(file), spec);
      if (!target.startsWith(referenceRoot)) {
        violations.push(`${relative(frontendRoot, file)} -> ${spec}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});
