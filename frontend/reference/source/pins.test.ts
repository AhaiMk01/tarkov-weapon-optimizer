// Seam: pins.ts -- pinned raw documents and the normalized snapshot are verified by hash
// before any reference code reads them (ADR 0013 §1/§3). Formal runs never refetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MANIFEST_PATH,
  PinError,
  RAW_DIR,
  SNAPSHOT_SHA256,
  loadManifest,
  loadPinnedDocument,
  loadPinnedDocuments,
  sha256Hex,
  verifySnapshot,
} from './pins';

const ADAPTER_ENGLISH_DOCS = ['items', 'items_en', 'barters', 'traders', 'traders_en'];

test('the normalized snapshot constant is the ADR 0010/0013 pin', () => {
  assert.equal(SNAPSHOT_SHA256, '219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c');
});

test('manifest lists every English document the production adapter fetches', () => {
  const manifest = loadManifest();
  assert.equal(manifest.gameMode, 'regular');
  for (const doc of ADAPTER_ENGLISH_DOCS) {
    const entry = manifest.documents[doc];
    assert.ok(entry, `manifest has no entry for ${doc}`);
    assert.equal(entry.url, `https://json.tarkov.dev/regular/${doc}`);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.ok(entry.bytes > 0);
  }
  assert.equal(manifest.normalizedSnapshot.sha256, SNAPSHOT_SHA256);
});

test('manifest states that no byte-level provenance links the pin to the normalized snapshot', () => {
  const { normalizedSnapshot } = loadManifest();
  assert.match(normalizedSnapshot.relationship, /NOT byte-linked/);
  assert.match(normalizedSnapshot.relationship, /different time/);
});

test('every pinned raw document verifies against its manifest hash and length', () => {
  const docs = loadPinnedDocuments();
  for (const [name, doc] of Object.entries(docs)) {
    assert.equal(sha256Hex(doc.bytes), doc.entry.sha256, name);
    assert.equal(doc.bytes.byteLength, doc.entry.bytes, name);
    assert.equal(doc.text.length > 0, true, name);
  }
  assert.deepEqual(
    Object.keys(docs).sort(),
    Object.keys(loadManifest().documents).sort(),
  );
});

test('the normalized snapshot matches the pinned SHA-256', () => {
  const pin = verifySnapshot();
  assert.equal(pin.sha256, SNAPSHOT_SHA256);
  assert.ok(pin.bytes > 1_000_000);
});

test('a tampered raw document is refused with a message that names the pin script', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pins-tamper-'));
  try {
    copyFileSync(MANIFEST_PATH, join(dir, 'manifest.json'));
    const original = readFileSync(join(RAW_DIR, 'traders_en.json'));
    const tampered = Buffer.from(original);
    tampered[tampered.length - 2] ^= 0x01;
    writeFileSync(join(dir, 'traders_en.json'), tampered);
    assert.throws(
      () => loadPinnedDocument('traders_en', dir),
      (error: unknown) =>
        error instanceof PinError && /SHA-256 mismatch/.test(error.message) && /pin_raw_sources/.test(error.message),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing raw document is refused with a message that names the pin script', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pins-missing-'));
  try {
    copyFileSync(MANIFEST_PATH, join(dir, 'manifest.json'));
    assert.throws(
      () => loadPinnedDocument('items', dir),
      (error: unknown) => error instanceof PinError && /missing/.test(error.message) && /pin_raw_sources/.test(error.message),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a document the manifest does not list is refused, never fetched', () => {
  assert.throws(
    () => loadPinnedDocument('items_fr'),
    (error: unknown) => error instanceof PinError && /not in the manifest/.test(error.message),
  );
});

test('a snapshot file with the wrong hash is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pins-snapshot-'));
  try {
    const file = join(dir, 'snapshot.json');
    writeFileSync(file, '{"not":"the pinned snapshot"}');
    assert.throws(
      () => verifySnapshot(file),
      (error: unknown) => error instanceof PinError && /SHA-256 mismatch/.test(error.message),
    );
    assert.throws(
      () => verifySnapshot(join(dir, 'absent.json')),
      (error: unknown) => error instanceof PinError && /missing/.test(error.message),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
