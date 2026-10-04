// Completeness report (a runnable script, not a test): which real weapons of the pinned capture can the oracle
// enumerate exhaustively?  Stage 1 deliverable of the raw-source -> oracle bridge (refs #40).
//
//   cd frontend && npx tsx reference/bridge/completeness.report.ts [--maxNodes N] [--maxTrees N] [--json]
//
// For every gun it builds the full-closure fixture and attempts structural tree enumeration (enumerateTrees) under
// the oracle's own default caps (about a minute in total), reporting the closure size, an exact tree-count DP, and whether the enumeration completed. It also
// does the same for each gun's preset-derived slices (the mods of one real factory preset, which is a valid build
// and therefore a nonempty micro-domain). An enumeration that hits a cap is INCOMPLETE and proves nothing; only a
// completed enumeration may be used as an exhaustive check, and oracle runs multiply trees by accessible bases.
import { enumerateTrees, type ReferenceFixture, type ReferenceSlot } from '../oracle/index';
import { loadPinnedWorld } from '../source/pinnedWorld';
import { sliceFixture } from './slice';
import { fixtureForWeapon } from './toFixture';

interface Row {
  gunId: string;
  name: string;
  items: number;
  slots: number;
  presets: number;
  /** Exact tree count by DP (null when the closure is cyclic and the DP is only a bound). */
  trees: bigint;
  dagExact: boolean;
  complete: boolean;
  nodes: number;
  enumerated: number;
}

const args = process.argv.slice(2);
const flag = (name: string, fallback: number): number => {
  const at = args.indexOf(name);
  return at >= 0 && at + 1 < args.length ? Number(args[at + 1]) : fallback;
};
// Defaults equal the oracle's own enumeration caps (enumerate.ts), so "complete" here means "runOracle can enumerate it as is".
const maxNodes = flag('--maxNodes', 5_000_000);
const maxTrees = flag('--maxTrees', 500_000);
const asJson = args.includes('--json');

/** Rooted-occurrence tree count: product over slots of (optional ? 1 : 0) + sum over candidates of the candidate's own count. */
function countTrees(fixture: ReferenceFixture, weaponId: string): { trees: bigint; dagExact: boolean } {
  const items = new Map(fixture.items.map(i => [i.id, i]));
  const memo = new Map<string, bigint>();
  const active = new Set<string>();
  let dagExact = true;
  const ofSlots = (slots: ReferenceSlot[] | undefined): bigint => {
    let product = 1n;
    for (const slot of slots ?? []) {
      let total = slot.required === true ? 0n : 1n;
      for (const id of new Set(slot.allowedItemIds)) total += ofItem(id);
      product *= total;
    }
    return product;
  };
  const ofItem = (id: string): bigint => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    if (active.has(id)) {
      dagExact = false; // a template below itself: the enumerator would prune it, this DP ignores the candidate
      return 0n;
    }
    const item = items.get(id);
    if (!item) return 0n;
    active.add(id);
    const count = ofSlots(item.slots);
    active.delete(id);
    memo.set(id, count);
    return count;
  };
  const weapon = fixture.weapons.find(w => w.id === weaponId);
  return { trees: weapon ? ofSlots(weapon.slots) : 0n, dagExact };
}

function attempt(fixture: ReferenceFixture, gunId: string, name: string, presets: number): Row {
  const { trees, dagExact } = countTrees(fixture, gunId);
  const result = enumerateTrees(fixture, gunId, { maxNodes, maxTrees });
  return {
    gunId, name, items: fixture.items.length,
    slots: (fixture.weapons[0].slots?.length ?? 0) + fixture.items.reduce((n, i) => n + (i.slots?.length ?? 0), 0),
    presets, trees, dagExact, complete: result.complete, nodes: result.nodes, enumerated: result.trees.length,
  };
}

const magnitude = (n: bigint): string => (n === 0n ? '0' : n < 1_000_000n ? n.toString() : `1e${n.toString().length - 1}`);
/** Decimal digit count, the bucket key for the order-of-magnitude histogram (0 has none). */
const digits = (n: bigint): number => (n === 0n ? 0 : n.toString().length);
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const started = performance.now();
const { world } = loadPinnedWorld('en');
const guns = [...world.items.values()].filter(i => i.types.includes('gun'));

const full: Row[] = [];
const slices: (Row & { presetId: string })[] = [];
let disagreements = 0;
const omittedBarterIds = new Set<string>();
let fixtureItems = 0;
for (const gun of guns) {
  const { fixture, provenance } = fixtureForWeapon(world, gun.id);
  for (const omitted of provenance.omitted) omittedBarterIds.add(omitted.barterId);
  fixtureItems += fixture.items.length;
  const row = attempt(fixture, gun.id, gun.normalizedName, provenance.closure.presets);
  full.push(row);
  if (row.complete && row.dagExact && BigInt(row.enumerated) !== row.trees) disagreements++;

  const itemIds = new Set(fixture.items.map(i => i.id));
  for (const preset of fixture.presets ?? []) {
    const keep = preset.components.map(c => c.itemId).filter(id => itemIds.has(id));
    const sliced = sliceFixture(fixture, { keepItemIds: [...new Set(keep)], keepPresetIds: [preset.id] });
    const sliceRow = attempt(sliced.fixture, gun.id, gun.normalizedName, 1);
    slices.push({ ...sliceRow, presetId: preset.id });
    if (sliceRow.complete && sliceRow.dagExact && BigInt(sliceRow.enumerated) !== sliceRow.trees) disagreements++;
  }
}
const seconds = ((performance.now() - started) / 1000).toFixed(1);

const fullComplete = full.filter(r => r.complete);
const sliceComplete = slices.filter(r => r.complete);
// Worst-case oracle builds for a full gun = trees x (1 naked + presets); the oracle default cap is 500,000 builds.
const oracleFeasible = (r: Row) => r.complete && r.trees * BigInt(1 + r.presets) <= 500_000n;

if (asJson) {
  const replacer = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);
  console.log(JSON.stringify({ maxNodes, maxTrees, full, slices }, replacer, 1));
} else {
  console.log('Bridge completeness report: pinned capture 2026-10-04 (regular), English');
  console.log(`caps: maxNodes=${maxNodes}, maxTrees=${maxTrees}; elapsed ${seconds} s`);
  console.log('');
  console.log(`guns: ${guns.length}; fixture item records over all guns: ${fixtureItems}; distinct fractional-count barters omitted (see README): ${omittedBarterIds.size}`);
  console.log(`closure items per gun: min ${Math.min(...full.map(r => r.items))}, median ${median(full.map(r => r.items))}, max ${Math.max(...full.map(r => r.items))}`);
  console.log(`closure template slots per gun: min ${Math.min(...full.map(r => r.slots))}, median ${median(full.map(r => r.slots))}, max ${Math.max(...full.map(r => r.slots))}`);
  console.log(`closures that are not a DAG (DP is only a bound): ${full.filter(r => !r.dagExact).length}`);
  console.log('');
  console.log(`FULL CLOSURE: enumeration complete for ${fullComplete.length} of ${full.length} guns under the caps`);
  console.log(`  of which oracle-feasible (trees x (1 + presets) <= 500000 builds): ${full.filter(oracleFeasible).length}`);
  for (const r of fullComplete.sort((a, b) => Number(a.trees - b.trees))) {
    console.log(`  complete  ${r.name.padEnd(52)} items ${String(r.items).padStart(4)}  trees ${r.trees.toString().padStart(8)}  presets ${r.presets}`);
  }
  // buckets of three decades: bucket k holds tree counts below 1e(3k)
  const byBucket = new Map<number, number>();
  for (const r of full) {
    const bucket = Math.ceil(digits(r.trees) / 3);
    byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + 1);
  }
  const smallest =[...full].sort((a, b) => (a.trees < b.trees ? -1 : a.trees > b.trees ? 1 : 0))[0];
  const largest = [...full].sort((a, b) => (a.trees < b.trees ? 1 : a.trees > b.trees ? -1 : 0))[0];
  console.log(`  smallest tree count: ${smallest.name} = ${smallest.trees}; largest: ${largest.name} = ~${magnitude(largest.trees)}`);
  console.log('  exact rooted-tree counts over all guns (DP), in buckets of three decades:');
  for (const [k, n] of [...byBucket.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`    ${k === 0 ? 'no build (0 trees)' : `< 1e${3 * k}`}: ${n} guns`);
  }
  console.log(`  guns whose receiver has no slots at all (one trivial tree): ${full.filter(r => r.slots === 0).length}`);
  console.log('');
  console.log(`PRESET-DERIVED SLICES (the mods of one real factory preset, valid by construction): ${slices.length} slices`);
  console.log(`  enumeration complete for ${sliceComplete.length} of ${slices.length} under the caps`);
  const sliceGuns = new Set(sliceComplete.map(r => r.gunId));
  const gunsWithAny = guns.filter(g => sliceGuns.has(g.id)).length;
  console.log(`  guns with at least one enumerable preset slice: ${gunsWithAny} of ${guns.length}`);
  const sizes = sliceComplete.map(r => Number(r.trees)).sort((a, b) => a - b);
  console.log(`  complete slices: trees min ${sizes[0]}, median ${sizes[Math.floor(sizes.length / 2)]}, max ${sizes[sizes.length - 1]}`);
  const withoutPresets = full.filter(r => r.presets === 0).map(r => r.name);
  console.log(`  guns with no preset at all, hence no slice (${withoutPresets.length}): ${withoutPresets.join(', ')}`);
  const incomplete = slices.filter(r => !r.complete);
  console.log(`  slices that hit a cap (${incomplete.length}): ${incomplete.map(r => `${r.name} preset ${r.presetId} (items ${r.items}, trees ~${magnitude(r.trees)})`).join('; ') || 'none'}`);
  console.log('');
  console.log(`DP versus enumerator on every completed enumeration (exact DAG): ${disagreements === 0 ? 'agree' : `${disagreements} DISAGREEMENTS`}`);
}
process.exitCode = disagreements === 0 ? 0 : 1;
