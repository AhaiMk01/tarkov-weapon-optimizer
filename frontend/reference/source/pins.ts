// Loads pinned raw upstream documents and the normalized snapshot, verifying SHA-256 first.
//
// Formal runs read bytes that were captured once by pin_raw_sources.ts. This module never
// touches the network and never regenerates anything: a missing or mismatched file is an
// evidence failure that names the remedy (ADR 0013 §1: "No live fallback or silently
// regenerated fixture in formal runs").
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const SOURCE_DIR = here;
export const RAW_DIR = join(here, 'raw');
export const MANIFEST_PATH = join(RAW_DIR, 'manifest.json');
export const SNAPSHOT_PATH = resolve(here, '..', '..', 'benchmarks', 'snapshot.json');

/** SHA-256 of the normalized fixture (ADR 0010 §1, ADR 0013 §1). */
export const SNAPSHOT_SHA256 = '219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c';

const PIN_HINT = 'Run `cd frontend && npx tsx reference/source/pin_raw_sources.ts` (add --force only to deliberately re-pin).';
const SNAPSHOT_HINT =
  'Restore the hashed compressed fixture artifact to frontend/benchmarks/snapshot.json (ADR 0013 §1); it is never regenerated.';

export class PinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PinError';
  }
}

export interface ManifestDocument {
  file: string;
  url: string;
  role: 'adapter-input' | 'supplementary-translation';
  lang: string | null;
  why: string;
  fetchedAt: string;
  httpStatus: number;
  bytes: number;
  sha256: string;
  http: { etag: string | null; lastModified: string | null; serverDate: string | null; contentType: string | null };
}

export interface PinManifest {
  schemaVersion: 1;
  kind: string;
  gameMode: string;
  baseUrl: string;
  capturedAt: string;
  pinScript: string;
  node: string;
  documents: Record<string, ManifestDocument>;
  normalizedSnapshot: {
    path: string;
    sha256: string;
    producedBy: string;
    relationship: string;
  };
  adapterTransformationsUnderTest: string[];
}

export interface PinnedDocument {
  name: string;
  entry: ManifestDocument;
  bytes: Buffer;
  text: string;
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

const manifestCache = new Map<string, PinManifest>();
const documentCache = new Map<string, PinnedDocument>();

export function loadManifest(rawDir: string = RAW_DIR): PinManifest {
  const cached = manifestCache.get(rawDir);
  if (cached) return cached;
  const path = join(rawDir, 'manifest.json');
  if (!existsSync(path)) throw new PinError(`Pin manifest is missing at ${path}. ${PIN_HINT}`);
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as PinManifest;
  if (manifest.schemaVersion !== 1 || typeof manifest.documents !== 'object' || manifest.documents === null) {
    throw new PinError(`Pin manifest at ${path} has an unsupported shape. ${PIN_HINT}`);
  }
  for (const [name, entry] of Object.entries(manifest.documents)) {
    if (typeof entry.file !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256) || !Number.isInteger(entry.bytes)) {
      throw new PinError(`Pin manifest entry "${name}" is malformed. ${PIN_HINT}`);
    }
  }
  manifestCache.set(rawDir, manifest);
  return manifest;
}

/** Read one pinned document and verify its length and SHA-256 against the manifest. */
export function loadPinnedDocument(name: string, rawDir: string = RAW_DIR): PinnedDocument {
  const key = `${rawDir}\u0000${name}`;
  const cached = documentCache.get(key);
  if (cached) return cached;
  const manifest = loadManifest(rawDir);
  const entry = manifest.documents[name];
  if (!entry) throw new PinError(`Document "${name}" is not in the manifest; it was never pinned and is not fetched. ${PIN_HINT}`);
  const path = join(rawDir, entry.file);
  if (!existsSync(path)) throw new PinError(`Pinned raw document "${name}" is missing at ${path}. ${PIN_HINT}`);
  const bytes = readFileSync(path);
  const actual = sha256Hex(bytes);
  if (actual !== entry.sha256 || bytes.byteLength !== entry.bytes) {
    throw new PinError(
      `Pinned raw document "${name}" SHA-256 mismatch: manifest ${entry.sha256} (${entry.bytes} bytes), ` +
      `file ${actual} (${bytes.byteLength} bytes). The file was modified or re-pinned without its manifest. ${PIN_HINT}`,
    );
  }
  const document: PinnedDocument = { name, entry, bytes, text: bytes.toString('utf8') };
  documentCache.set(key, document);
  return document;
}

export function loadPinnedDocuments(rawDir: string = RAW_DIR): Record<string, PinnedDocument> {
  const out: Record<string, PinnedDocument> = {};
  for (const name of Object.keys(loadManifest(rawDir).documents)) out[name] = loadPinnedDocument(name, rawDir);
  return out;
}

export interface SnapshotPin {
  path: string;
  bytes: number;
  sha256: string;
}

/** Verify the normalized fixture's SHA-256 against the ADR pin without parsing it. */
export function verifySnapshot(path: string = SNAPSHOT_PATH, expectedSha256: string = SNAPSHOT_SHA256): SnapshotPin {
  if (!existsSync(path)) throw new PinError(`Normalized snapshot is missing at ${path}. ${SNAPSHOT_HINT}`);
  const bytes = readFileSync(path);
  const sha256 = sha256Hex(bytes);
  if (sha256 !== expectedSha256) {
    throw new PinError(`Normalized snapshot SHA-256 mismatch: expected ${expectedSha256}, file ${sha256}. ${SNAPSHOT_HINT}`);
  }
  return { path, bytes: bytes.byteLength, sha256 };
}

let snapshotCache: { pin: SnapshotPin; snapshot: unknown } | undefined;

/** Verify then parse the normalized snapshot (memoized). */
export function loadPinnedSnapshot(): { pin: SnapshotPin; snapshot: unknown } {
  if (snapshotCache) return snapshotCache;
  const pin = verifySnapshot();
  snapshotCache = { pin, snapshot: JSON.parse(readFileSync(pin.path, 'utf8')) as unknown };
  return snapshotCache;
}
