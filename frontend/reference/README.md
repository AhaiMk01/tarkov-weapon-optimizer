# Stage 1 independent reference (`frontend/reference`)

Refs #40, ADR 0010 and ADR 0013 section 3.

This directory is the **independent reference** for the Tarkov Weapon Mod Optimizer: an exact-rational
oracle, a 14-family behavioral ledger with hand-derived expectations, a raw-source reader with pinned
upstream documents, and a bridge that turns real data into oracle fixtures. It is the yardstick the Stage 2
solver rewrite is measured against in Stage 3. It is test-side code: nothing in the app imports it.

## Layout

| Directory | What it holds |
| :--- | :--- |
| `oracle/` | Exact-Q enumerator, reference validator, statistics, scoring and acquisition model for finite fixtures (`runOracle`, `validateReference`), plus the Tchebycheff payoff-table admissibility check (`payoffTables`, `checkIdealPoint`; `INTERPRETATIONS.md` choice 17). Public surface: `oracle/index.ts`. |
| `source/` | Pinned raw tarkov.dev JSON documents, the independent reader for them, source checks and the differential checks of the production adapter and extractors. See `source/README.md`. |
| `ledger/` | The 14-family ledger (`ledger/family*.ts`), its authoring DSL, the coverage catalogue (required subcases, ADR 0013 section 3 wording, deferred subcases) and the test that runs it against the oracle. |
| `bridge/` | `fixtureForWeapon` / `sliceFixture`: maps the raw reader's world into the oracle's fixture schema, plus real-data cases. See `bridge/README.md`. |
| `independence.test.ts`, `independenceScan.ts` | The independence guard and its scanner (below). |
| `INTERPRETATIONS.md` | Numbered list of every choice the ADRs leave open. The ledger cites these as "interpretation N". |

Ledger expectations are **hand-derived**: each case carries its derivation (with the arithmetic) and the oracle
only checks it. Never update an expected value to match oracle output without re-deriving it independently.

## Independence rule

Reference code must not load production code (`frontend/src/**`, `frontend/benchmarks/**`) or anything
outside `frontend/reference/`. Only files named `*.differential.test.ts` may, and only as the system under test
that is compared against the reference. `independence.test.ts` enforces this with a TypeScript-parser scan of
every `.ts/.mts/.cts/.tsx/.js/.mjs/.cjs/.jsx` file:

* any relative, absolute or `file:` specifier (static `import`, side-effect `import '...'`, `import type`,
  `export ... from`, `import('...')` types and dynamic `import('...')`) that resolves outside `reference/` fails;
* any dynamic `import(...)` whose argument is not a single string literal fails (template literals included);
* any `require`, `createRequire` or `import x = require(...)` fails;
* `node:` built-ins and bare package names are allowed, except a bare specifier that names the frontend package itself.

The scanner is a pure function (`scanSource` in `independenceScan.ts`); the test also runs it over in-memory
samples of every forbidden and allowed form, so the guard is proved to catch what it claims to.

## Running

```bash
cd frontend
npm run test:reference                       # the whole reference suite (node:test through tsx)
npx tsx --test reference/ledger/*.test.ts    # one area
npx tsc -b --pretty false                    # typecheck (includes reference/)
npx eslint reference
```

Node 21 or newer is required (the raw reader uses `JSON.parse` source-text access). Two tests in `source/` are
reported as `todo`: they assert the Stage 2 repairs (preset count preservation, rejecting an absent count) and
are expected to pass only after Stage 2; see `source/README.md`.

## Fresh checkouts: the pinned raw documents are not in git

`source/raw/*.json` (about 21 MB of upstream documents) is **gitignored**; only `source/raw/manifest.json`
(URL, size and SHA-256 per document) is committed. A fresh checkout therefore has no raw bytes, and every test
that loads a pin fails with a `PinError` naming the remedy until they are restored. `oracle/`, `ledger/` and the
independence guard do not need them; `source/` and `bridge/` do. Restore the pins one of two ways:

1. **Restore the archived bytes** into `frontend/reference/source/raw/`. The files must match the manifest
   exactly; `pins.ts` verifies length and SHA-256 before it reads anything. This is the way to reproduce the
   recorded evidence. The current capture is archived locally (independent disk, not offsite) as
   `E:/tarkov-planning-evidence/raw-jsonapi-regular-20261004-manifest-79953f6cd30f.tar.gz`
   (SHA-256 `3fbb82c517ea0fa69a77874887894d7790ba4e7348215afd18a1bd9b5e50495d`); extract it with
   `tar -C frontend/reference/source/raw -xzf <archive>`.
2. **Re-pin** with `npx tsx reference/source/pin_raw_sources.ts --force`. This fetches the live API again, so the
   bytes, the manifest hashes **and the exact finding counts that the source and bridge tests pin on purpose**
   (presets losing counts, fractional barters, slot-id uniqueness and so on) will change. Treat it as replacing the
   evidence baseline: review every changed count before accepting it. Without `--force` the script refuses to
   overwrite an existing manifest.

The normalized fixture `frontend/benchmarks/snapshot.json` is separate: it is verified against its recorded
SHA-256 and never regenerated; restore the hashed artifact if it is missing (ADR 0013 section 1).

## Related

* `INTERPRETATIONS.md`: every interpretation choice, with where production differs and which cases exercise it.
* `source/README.md`: raw documents, reader rules, findings on the pinned capture, trusted and untrusted adapter
  transformations, the two Stage 2 todos.
* `bridge/README.md`: the raw-to-fixture mapping, slicing and the real-data cases.
* ADR 0010 (oracle and equivalence gates) and ADR 0013 (correctness-first handoff, section 3 for Stage 1).
