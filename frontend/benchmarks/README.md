# Certification Performance Benchmark Suite

Implements the contract defined in [`docs/benchmark-contract.md`](../../docs/benchmark-contract.md) (refs issue [#20](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/20)).

## Architecture

- **Seam**: Measures full end-to-end requests through the browser Web Worker via `benchmarks/index.html` and Puppeteer.
- **Data snapshot**: Frozen snapshot with SHA-256 integrity verification (`snapshot.json` + `manifest.json`), seeded directly into IndexedDB before solves.
- **Validation**: Independent build validator (`validateBuild.ts`) checks all returned builds for physical placement, rooted graph, conflicts, locks/bans, access rules, prices, and exact TED without relying on solver decoding.
- **Report & Classification**: `report.ts` classifies runs according to strict mathematical certification: a run is certified only if independent build validation passes, solver status is `optimal`, and reported MIP gap $\le$ tolerance.

## Usage

### 1. Capture Data Snapshot
```bash
cd frontend && npx tsx benchmarks/run.ts --capture-snapshot
```

### 2. Run Baseline Measurements
With Vite dev server running on port 5173 (`npm run dev --prefix frontend`):
```bash
cd frontend && npx tsx benchmarks/run.ts --runs 5
```

### 3. Filter Specific Cases
```bash
cd frontend && npx tsx benchmarks/run.ts --case dense-linear --runs 3
cd frontend && npx tsx benchmarks/run.ts --case dense-ted --runs 1
```

## Output Artifacts

- `benchmarks/results/samples.jsonl`: Incremental raw JSONL stream of every single run, with outcomes, timings, validation results, and memory metrics.
- `benchmarks/results/report.md`: Markdown summary table of completion rates, certified latencies, medians, and paired speedups.
