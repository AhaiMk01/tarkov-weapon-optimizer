// Pins the raw tarkov.dev JSON API documents used to independently check the
// production adapter (ADR 0010 §1/§5, ADR 0013 §1/§3).
//
//   cd frontend && npx tsx reference/source/pin_raw_sources.ts [--force]
//
// This is the ONLY reference-side code that touches the network. It saves the exact
// response bytes of every document `jsonApiAdapter.ts#fetchAllDataFromJsonApi` reads for
// English (`items`, `items_en`, `barters`, `traders`, `traders_en`) plus the Chinese
// translation documents (`items_zh`, `traders_zh`), which exercise the
// requested-language -> English -> key resolution chain with real data.
//
// Outputs (the raw directory is gitignored except manifest.json):
//   reference/source/raw/<doc>.json   exact response body bytes
//   reference/source/raw/manifest.json  URL, fetch time, byte length and SHA-256 per document
//
// It refuses to overwrite an existing manifest unless --force is given: a re-pin changes
// the pinned bytes, so it must be a deliberate act, never a silent refetch.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SNAPSHOT_SHA256, sha256Hex } from './pins';

const here = dirname(fileURLToPath(import.meta.url));
const rawDir = join(here, 'raw');
const manifestPath = join(rawDir, 'manifest.json');

const BASE_URL = 'https://json.tarkov.dev';
const GAME_MODE = 'regular';

interface DocSpec {
  doc: string;
  role: 'adapter-input' | 'supplementary-translation';
  lang: string | null;
  why: string;
}

// Mirrors the Promise.all in jsonApiAdapter.ts (items, items_<lang>, items_en, barters,
// traders, traders_<lang>, traders_en). For lang = 'en' the primary-language fetches are
// skipped by the adapter, so English needs exactly five documents.
const DOCS: DocSpec[] = [
  { doc: 'items', role: 'adapter-input', lang: null, why: 'items, presets, categories, handbook categories, flea market descriptor' },
  { doc: 'items_en', role: 'adapter-input', lang: 'en', why: 'English translation keys for items, slots, categories' },
  { doc: 'barters', role: 'adapter-input', lang: null, why: 'barter recipes, indexed by offered item' },
  { doc: 'traders', role: 'adapter-input', lang: null, why: 'trader ids, normalized names and translation keys' },
  { doc: 'traders_en', role: 'adapter-input', lang: 'en', why: 'English trader names' },
  { doc: 'items_zh', role: 'supplementary-translation', lang: 'zh', why: 'exercise the requested-language -> English -> key chain' },
  { doc: 'traders_zh', role: 'supplementary-translation', lang: 'zh', why: 'exercise the trader translation fallback chain' },
];

const force = process.argv.includes('--force');

async function fetchBytes(url: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
      const bytes = new Uint8Array(await resp.arrayBuffer());
      return {
        bytes,
        status: resp.status,
        etag: resp.headers.get('etag'),
        lastModified: resp.headers.get('last-modified'),
        serverDate: resp.headers.get('date'),
        contentType: resp.headers.get('content-type'),
      };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(r => setTimeout(r, 2 ** attempt * 1000));
    }
  }
  throw lastError;
}

async function main() {
  if (existsSync(manifestPath) && !force) {
    const existing = JSON.parse(readFileSync(manifestPath, 'utf8')) as { capturedAt?: string };
    console.error(
      `Refusing to re-pin: ${manifestPath} already exists (captured ${existing.capturedAt ?? 'unknown'}).\n` +
      'Re-pinning replaces the evidence baseline. Pass --force to do it deliberately.',
    );
    process.exit(1);
  }
  mkdirSync(rawDir, { recursive: true });

  const documents: Record<string, unknown> = {};
  for (const spec of DOCS) {
    const url = `${BASE_URL}/${GAME_MODE}/${spec.doc}`;
    const fetchedAt = new Date().toISOString();
    const res = await fetchBytes(url);
    // The body must be a JSON envelope with a `data` member, exactly what the adapter requires.
    const envelope = JSON.parse(Buffer.from(res.bytes).toString('utf8')) as { data?: unknown };
    if (!envelope || envelope.data === undefined) throw new Error(`Malformed envelope for ${url}`);
    const file = `${spec.doc}.json`;
    writeFileSync(join(rawDir, file), res.bytes);
    const digest = sha256Hex(res.bytes);
    documents[spec.doc] = {
      file,
      url,
      role: spec.role,
      lang: spec.lang,
      why: spec.why,
      fetchedAt,
      httpStatus: res.status,
      bytes: res.bytes.byteLength,
      sha256: digest,
      http: { etag: res.etag, lastModified: res.lastModified, serverDate: res.serverDate, contentType: res.contentType },
    };
    console.log(`${spec.doc.padEnd(11)} ${String(res.bytes.byteLength).padStart(9)} bytes  sha256 ${digest}`);
  }

  const manifest = {
    schemaVersion: 1,
    kind: 'tarkov.dev JSON API raw source pin',
    gameMode: GAME_MODE,
    baseUrl: BASE_URL,
    capturedAt: new Date().toISOString(),
    pinScript: 'frontend/reference/source/pin_raw_sources.ts',
    node: process.version,
    documents,
    normalizedSnapshot: {
      path: 'frontend/benchmarks/snapshot.json',
      sha256: SNAPSHOT_SHA256,
      producedBy: 'fetchAllData(en, regular) through the production JSON API adapter',
      relationship:
        'NOT byte-linked to these raw documents. The snapshot was captured at a different time ' +
        '(the live JSON API changes continuously) and no raw upstream capture of its source exists, ' +
        'so no byte-level provenance between the snapshot and this pin is claimed. Differential ' +
        'checks run the production adapter on THESE raw documents; checks on the snapshot use only ' +
        'fields the snapshot itself retains.',
    },
    adapterTransformationsUnderTest: [
      'translation resolution (requested language -> English -> key)',
      'categories chain rebuilt from categories[0]',
      'presets/defaultPreset/containsItems/conflictingItems id dereferencing',
      'synthesized flea offer (skipped for noFlea or absent lastLowPrice; price avg24hPrice || lastLowPrice)',
      'trader offers from buyFromTrader',
      'barters indexed by offered item; level = minTraderLevel',
    ],
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`\nWrote ${resolve(manifestPath)}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
