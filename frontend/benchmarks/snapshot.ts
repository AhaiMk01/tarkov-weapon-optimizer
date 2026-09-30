import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fetchAllData } from '../src/solver/dataService.ts';
import type { Snapshot, RawTask } from './types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface SnapshotManifest {
  schemaVersion: 1;
  createdAt: string;
  sha256: string;
  bytes: number;
  gunsCount: number;
  modsCount: number;
  tasksCount: number;
}

export function computeSha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export async function captureSnapshot(outputDir: string = __dirname): Promise<{ snapshotPath: string; manifestPath: string; manifest: SnapshotManifest }> {
  console.log('Fetching live snapshot data (en/regular)...');
  const data = await fetchAllData('en', 'regular');

  const tasksPath = path.resolve(__dirname, '../public/tasks.json');
  let tasks: RawTask[] = [];
  if (fs.existsSync(tasksPath)) {
    tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
  }

  const snapshot: Snapshot = {
    schemaVersion: 1,
    lang: 'en',
    gameMode: 'regular',
    guns: data.guns,
    mods: data.mods,
    tasks,
  };

  const jsonStr = JSON.stringify(snapshot, null, 2);
  const hash = computeSha256(jsonStr);

  const manifest: SnapshotManifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    sha256: hash,
    bytes: Buffer.byteLength(jsonStr, 'utf8'),
    gunsCount: snapshot.guns.length,
    modsCount: snapshot.mods.length,
    tasksCount: snapshot.tasks.length,
  };

  const snapshotPath = path.join(outputDir, 'snapshot.json');
  const manifestPath = path.join(outputDir, 'manifest.json');

  fs.writeFileSync(snapshotPath, jsonStr, 'utf8');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`Snapshot saved to ${snapshotPath} (${manifest.bytes} bytes, sha256: ${manifest.sha256})`);
  return { snapshotPath, manifestPath, manifest };
}

export function loadAndVerifySnapshot(dir: string = __dirname): { snapshot: Snapshot; manifest: SnapshotManifest } {
  const snapshotPath = path.join(dir, 'snapshot.json');
  const manifestPath = path.join(dir, 'manifest.json');

  if (!fs.existsSync(snapshotPath) || !fs.existsSync(manifestPath)) {
    throw new Error(`Snapshot or manifest not found in ${dir}. Run snapshot capture first.`);
  }

  const rawJson = fs.readFileSync(snapshotPath, 'utf8');
  const manifest: SnapshotManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const actualHash = computeSha256(rawJson);
  if (actualHash !== manifest.sha256) {
    throw new Error(`Snapshot SHA256 mismatch! Expected ${manifest.sha256}, got ${actualHash}`);
  }

  const snapshot: Snapshot = JSON.parse(rawJson);
  return { snapshot, manifest };
}
