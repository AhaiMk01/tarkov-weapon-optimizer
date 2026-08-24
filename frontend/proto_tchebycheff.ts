/**
 * PROTOTYPE — augmented Tchebycheff scalarization on the M4A1.
 *
 * Questions this answers:
 *   1. Does the augmented Tchebycheff MIP solve correctly in HiGHS, and how
 *      slow is it vs the weighted-sum LP?
 *   2. Does its LP relaxation stay integral (weighted sum does), or does
 *      branch-and-bound actually kick in?
 *   3. Does it reach Pareto builds ("unsupported points") that NO weighted-sum
 *      weight vector can produce?
 *
 * Method: build the normal LP once, recover the exact per-item recoil/price
 * objective coefficients by inverting the obj_def rows (unit weights make the
 * inversion trivial), then text-transform the LP: replace the objective with
 * `max −1000·t + ρ·(normalized goodness)` and add rows
 *   t ≥ λ_i/range_i · (z*_i − f_i)   for each axis,
 * with f_ergo = capped_ergo, f_recoil = Σ r_i x_i (aux rec_tot),
 * f_price = Σ p_i buy_i + Σ bp_b base_b (aux pri_tot).
 *
 * Run: cd frontend && npx tsx proto_tchebycheff.ts
 */

import { fetchAllData, buildItemLookup } from './src/solver/dataService.ts';
import { buildCompatibilityMap } from './src/solver/compatibilityMap.ts';
import { buildLP } from './src/solver/lpBuilder.ts';
import { solve } from './src/solver/solver.ts';
import type { ItemLookup, SolveParams, GunLookupEntry, ModStats } from './src/solver/types.ts';
import { DEFAULT_TRADER_LEVELS } from './src/solver/types.ts';

const RHO = 0.01;        // augmentation strength (on normalized goodness)
const OBJ_SCALE = 1000;  // scales the whole objective so coefficients clear HiGHS's small-value threshold

function fmt(x: number): string {
  // fixed-point, trimmed — avoids e-notation in the LP text
  if (Number.isInteger(x)) return String(x);
  return x.toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
}
function term(coef: number, v: string): string {
  return coef >= 0 ? `+ ${fmt(coef)} ${v}` : `- ${fmt(-coef)} ${v}`;
}

async function main() {
  console.log('fetching...');
  const { guns, mods } = await fetchAllData('en', 'regular');
  const lookup: ItemLookup = buildItemLookup(guns, mods);

  let weaponId = '';
  for (const [id, entry] of Object.entries(lookup)) {
    if (entry.type === 'gun' && ((entry.data as Record<string, unknown>).name as string ?? '').includes('M4A1')) {
      weaponId = id;
      break;
    }
  }
  if (!weaponId) throw new Error('M4A1 not found');
  const weapon = lookup[weaponId] as GunLookupEntry;
  const cmap = buildCompatibilityMap(weaponId, lookup);
  const base: SolveParams = {
    weaponId, itemLookup: lookup, compatibilityMap: cmap,
    traderLevels: DEFAULT_TRADER_LEVELS, fleaAvailable: true,
  };

  // ---- 1. Base LP with unit weights; invert obj_def rows for coefficients ----
  const lp = buildLP({ ...base, ergoWeight: 1, recoilWeight: 1, priceWeight: 1 });
  const objCoef: Record<string, number> = {};
  for (const line of lp.lpString.split('\n')) {
    const m = line.match(/^\s*obj_def_\d+:\s*obj_sub_\d+\s*(.*?)=\s*0\s*$/);
    if (!m) continue;
    const termRe = /([+-])\s*([0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
    let t: RegExpExecArray | null;
    while ((t = termRe.exec(m[1]))) {
      // row carries the NEGATED objective term
      objCoef[t[3]] = -((t[1] === '-' ? -1 : 1) * parseFloat(t[2]));
    }
  }
  if (Math.abs((objCoef['capped_ergo'] ?? 0) - 1000) > 1e-9) {
    throw new Error(`extraction broken: capped_ergo coeff = ${objCoef['capped_ergo']}, expected 1000`);
  }
  // with unit weights: x_i coeff = −10000·r_i − 1 ; buy_i = −10·p_i ; base_b = −10·bp_b
  const nItems = lp.nItems;
  const recoil: number[] = [0];
  const price: number[] = [0];
  for (let i = 1; i <= nItems; i++) {
    recoil.push(-((objCoef[`x_${i}`] ?? -1) + 1) / 10000);
    price.push(-(objCoef[`buy_${i}`] ?? 0) / 10);
  }
  const basePrice: number[] = [];
  for (let b = 1; b <= lp.nBases; b++) basePrice.push(-(objCoef[`base_${b}`] ?? 0) / 10);

  // spot-check the inversion against raw item stats
  let checked = 0;
  for (let i = 1; i <= nItems && checked < 8; i++) {
    const entry = lookup[lp.indexToItem[i]];
    if (entry?.type !== 'mod') continue;
    const expect = Math.round((entry.stats as ModStats).recoil_modifier * 1000);
    if (Math.abs(recoil[i] - expect) > 1e-6) {
      throw new Error(`recoil inversion mismatch at x_${i}: got ${recoil[i]}, stats say ${expect}`);
    }
    checked++;
  }
  console.log(`coefficient inversion OK (${checked} spot-checks); nItems=${nItems} nBases=${lp.nBases}`);

  // ---- 2. Payoff table → ideal z* and nadir estimates ----
  const evalStats = (r: Awaited<ReturnType<typeof solve>>) => {
    const s = r.final_stats!;
    const recSum = r.selected_items.reduce((a, it) => a + Math.round((it.recoil_modifier ?? 0) * 1000), 0);
    return { fE: Math.min(100, Math.max(0, s.ergonomics)) * 10, fR: recSum, fP: s.total_price, rv: s.recoil_vertical };
  };
  const endpoints = await Promise.all([
    solve({ ...base, ergoWeight: 100, recoilWeight: 0, priceWeight: 0 }),
    solve({ ...base, ergoWeight: 0, recoilWeight: 100, priceWeight: 0 }),
    solve({ ...base, ergoWeight: 0, recoilWeight: 0, priceWeight: 100 }),
  ]);
  for (const e of endpoints) if (e.status !== 'optimal') throw new Error('endpoint solve failed: ' + e.reason);
  const pay = endpoints.map(evalStats);
  const zE = Math.max(...pay.map(p => p.fE)), nadE = Math.min(...pay.map(p => p.fE));
  const zR = Math.min(...pay.map(p => p.fR)), nadR = Math.max(...pay.map(p => p.fR));
  const zP = Math.min(...pay.map(p => p.fP)), nadP = Math.max(...pay.map(p => p.fP));
  const rgE = Math.max(zE - nadE, 1), rgR = Math.max(nadR - zR, 1), rgP = Math.max(nadP - zP, 1);
  console.log(`ideal: ergo×10=${zE} recoilSum=${zR} price=${zP}`);
  console.log(`nadir: ergo×10=${nadE} recoilSum=${nadR} price=${nadP}`);

  // ---- 3. Weighted-sum reachable set: simplex grid, step 10 (66 combos) ----
  type Build = { sig: string; ergo: number; rv: number; price: number; from: string };
  const wsBuilds = new Map<string, Build>();
  const sigOf = (ids: string[], baseId: string) => [...ids].sort().join(',') + '|' + baseId;
  let wsMs = 0, wsCount = 0;
  const t0 = performance.now();
  for (let e = 0; e <= 100; e += 10) {
    for (let r = 0; r + e <= 100; r += 10) {
      const p = 100 - e - r;
      const res = await solve({ ...base, ergoWeight: e, recoilWeight: r, priceWeight: p });
      wsCount++;
      wsMs += res.solve_time_ms ?? 0;
      if (res.status !== 'optimal' || !res.final_stats) continue;
      const sig = sigOf(res.selected_items.map(i => i.id), res.selected_preset?.id ?? 'naked');
      if (!wsBuilds.has(sig)) {
        wsBuilds.set(sig, {
          sig,
          ergo: Math.min(100, Math.max(0, res.final_stats.ergonomics)),
          rv: res.final_stats.recoil_vertical,
          price: res.final_stats.total_price,
          from: `w=(${e},${r},${p})`,
        });
      }
    }
  }
  console.log(`\nweighted-sum grid: ${wsCount} solves, ${wsBuilds.size} distinct builds, total ${Math.round(performance.now() - t0)} ms (solver-only ${Math.round(wsMs)} ms)`);

  // ---- 4. Tchebycheff LP text builder ----
  const lines = lp.lpString.split('\n');
  const objLineIdx = lines.findIndex(l => l.trim() === 'obj: total_obj');
  const subjIdx = lines.findIndex(l => l.trim() === 'Subject To');
  const boundsIdx = lines.findIndex(l => l.trim() === 'Bounds');
  if (objLineIdx < 0 || subjIdx < 0 || boundsIdx < 0) throw new Error('LP anatomy not found');

  // chunked aux definitions rec_tot = Σ r_i x_i, pri_tot = Σ p_i buy_i + Σ bp_b base_b
  const CH = 50;
  const recTerms: [number, string][] = [];
  for (let i = 1; i <= nItems; i++) if (recoil[i] !== 0) recTerms.push([recoil[i], `x_${i}`]);
  const priTerms: [number, string][] = [];
  for (let i = 1; i <= nItems; i++) if (price[i] !== 0) priTerms.push([price[i], `buy_${i}`]);
  for (let b = 1; b <= lp.nBases; b++) if (basePrice[b - 1] !== 0) priTerms.push([basePrice[b - 1], `base_${b}`]);

  const auxRows: string[] = [];
  const chunkDef = (terms: [number, string][], name: string): string[] => {
    const subs: string[] = [];
    for (let c = 0; c * CH < terms.length; c++) {
      const sub = `${name}_sub_${c}`;
      subs.push(sub);
      const body = terms.slice(c * CH, (c + 1) * CH).map(([coef, v]) => term(-coef, v)).join(' ');
      auxRows.push(`  ${name}_def_${c}: ${sub} ${body} = 0`);
    }
    auxRows.push(`  ${name}_link: ${name}_tot ${subs.map(s => `- ${s}`).join(' ')} = 0`);
    return subs;
  };
  const recSubs = chunkDef(recTerms, 'rec');
  const priSubs = chunkDef(priTerms, 'pri');

  const freeBounds = ['  -inf <= rec_tot <= inf', '  -inf <= pri_tot <= inf',
    ...recSubs.map(s => `  -inf <= ${s} <= inf`), ...priSubs.map(s => `  -inf <= ${s} <= inf`)];

  function tchLP(le: number, lr: number, lpw: number): string {
    // Normalized-gap formulation for numerical sanity: g_i = (z*_i − f_i)/range_i
    // (∈ [0, ~1.5]), defined by equality rows with O(range) coefficients; the
    // t-rows and objective then carry only O(1) coefficients.
    const s = le + lr + lpw;
    const LE = le / s, LR = lr / s, LPc = lpw / s;

    const gapRows = [
      `  gap_e_def: ${fmt(rgE)} g_e + capped_ergo = ${fmt(zE)}`,
      `  gap_r_def: ${fmt(rgR)} g_r - rec_tot = ${fmt(-zR)}`,
      `  gap_p_def: ${fmt(rgP)} g_p - pri_tot = ${fmt(-zP)}`,
    ];
    const tchRows: string[] = [];
    if (LE > 0) tchRows.push(`  tch_e: tch_t - ${fmt(LE)} g_e >= 0`);
    if (LR > 0) tchRows.push(`  tch_r: tch_t - ${fmt(LR)} g_r >= 0`);
    if (LPc > 0) tchRows.push(`  tch_p: tch_t - ${fmt(LPc)} g_p >= 0`);

    const objTerms: string[] = [`- ${OBJ_SCALE} tch_t`];
    if (LE > 0) objTerms.push(term(-OBJ_SCALE * RHO * LE, 'g_e'));
    if (LR > 0) objTerms.push(term(-OBJ_SCALE * RHO * LR, 'g_r'));
    if (LPc > 0) objTerms.push(term(-OBJ_SCALE * RHO * LPc, 'g_p'));

    const out = [...lines];
    out[objLineIdx] = '  obj: ' + objTerms.join(' ');
    out.splice(subjIdx + 1, 0, ...auxRows, ...gapRows, ...tchRows);
    // note: subjIdx computed on original array; obj line is before Subject To, index unaffected
    out.splice(out.findIndex(l => l.trim() === 'Bounds') + 1, 0, ...freeBounds);
    return out.join('\n');
  }

  // ---- 5. Solve Tchebycheff MIPs over a λ grid (step 25 → 15 combos) ----
  // Use the CUSTOM build the app actually ships (public/highs.js + highs.wasm,
  // raised memory/stack) — the stock npm build crashes on several λ vectors.
  // Loaded with the same CJS-shim trick solver.ts uses in the browser.
  const fsMod = await import('fs');
  const { createRequire } = await import('module');
  const nodeRequire = createRequire(import.meta.url);
  const jsSource = fsMod.readFileSync('public/highs.js', 'utf8');
  const wasmBinary = new Uint8Array(fsMod.readFileSync('public/highs.wasm'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const highsLoader: any = (() => {
    const exports = {} as Record<string, unknown>;
    const module = { exports };
    new Function('module', 'exports', 'require', '__dirname', '__filename', jsSource)(
      module, exports, nodeRequire, process.cwd(), 'highs.js');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loader = module.exports as any;
    return () => loader({ wasmBinary });
  })();
  console.log('\nusing custom HiGHS build from public/ (the one the app ships)');
  // The WASM instance can abort after repeated large solves — use a fresh
  // instance per solve, with one retry, and dump the LP on a genuine failure.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function solveText(text: string): Promise<any> {
    const optionVariants = [{}, { presolve: 'off' }];
    let lastErr: unknown = null;
    for (const opts of optionVariants) {
      const h = await highsLoader();
      try {
        return h.solve(text, opts);
      } catch (e) {
        lastErr = e;
      }
    }
    const fs = await import('fs');
    fs.writeFileSync('failed_tch.lp', text);
    throw new Error(`HiGHS failed with all option variants (LP dumped to failed_tch.lp): ${lastErr}`);
  }

  // true build ergo from selected items (capped_ergo sits at 0 when λ_ergo = 0)
  const ergoOfIds = (ids: string[]): number => {
    let e = weapon.stats.naked_ergonomics;
    for (const id of ids) {
      const entry = lookup[id];
      if (entry?.type === 'mod') e += (entry.stats as ModStats).ergonomics || 0;
    }
    return Math.min(100, Math.max(0, e));
  };

  type TchResult = Build & { lambda: string; ms: number; frac: number };
  const tchResults: TchResult[] = [];
  for (let e = 0; e <= 100; e += 25) {
    for (let r = 0; r + e <= 100; r += 25) {
      const p = 100 - e - r;
      const text = tchLP(e, r, p);
      const t1 = performance.now();
      let res;
      try {
        res = await solveText(text);
      } catch (err) {
        console.log(`λ=(${e},${r},${p}): SOLVER CRASH — ${err instanceof Error ? err.message.split('\n')[0] : err}`);
        continue;
      }
      const ms = performance.now() - t1;
      if (res.Status !== 'Optimal') {
        console.log(`λ=(${e},${r},${p}): ${res.Status}`);
        continue;
      }
      const cols = res.Columns ?? {};
      const ids: string[] = [];
      let frac = 0;
      for (let i = 1; i <= nItems; i++) {
        const v = cols[`x_${i}`]?.Primal ?? 0;
        if (Math.abs(v - Math.round(v)) > 1e-6) frac++;
        if (v > 0.5) ids.push(lp.indexToItem[i]);
      }
      let baseId = 'naked';
      for (let b = 1; b <= lp.nBases; b++) {
        if ((cols[`base_${b}`]?.Primal ?? 0) > 0.5) { baseId = lp.baseIds[b - 1]; break; }
      }
      const ergo = ergoOfIds(ids);
      const recTot = cols['rec_tot']?.Primal ?? 0;
      const priTot = cols['pri_tot']?.Primal ?? 0;
      const rv = weapon.stats.naked_recoil_v * (1 + recTot / 1000);
      tchResults.push({
        sig: sigOf(ids, baseId === 'naked' ? weaponId : baseId),
        ergo, rv, price: priTot, from: '', lambda: `λ=(${e},${r},${p})`, ms, frac,
      });
      console.log(`λ=(${e},${r},${p}): ergo=${ergo.toFixed(1)} rv=${rv.toFixed(1)} price=${Math.round(priTot)} | ${Math.round(ms)} ms, frac x's=${frac}`);
    }
  }

  // ---- 6. LP-relaxation probe at the central λ: strip Binary, bound [0,1] ----
  {
    const text = tchLP(34, 33, 33);
    const relLines = text.split('\n');
    const binIdx = relLines.findIndex(l => l.trim() === 'Binary');
    const endIdx = relLines.findIndex(l => l.trim() === 'End');
    const binVars = relLines.slice(binIdx + 1, endIdx).join(' ').trim().split(/\s+/).filter(Boolean);
    const rel = [
      ...relLines.slice(0, binIdx),
      ...relLines.slice(endIdx),
    ];
    rel.splice(rel.findIndex(l => l.trim() === 'Bounds') + 1, 0, ...binVars.map(v => `  0 <= ${v} <= 1`));
    const t1 = performance.now();
    const res = await solveText(rel.join('\n'));
    const ms = performance.now() - t1;
    let frac = 0;
    if (res.Status === 'Optimal') {
      for (const v of binVars) {
        const val = res.Columns?.[v]?.Primal ?? 0;
        if (Math.abs(val - Math.round(val)) > 1e-6) frac++;
      }
    }
    console.log(`\nLP relaxation @ λ=(34,33,33): ${res.Status}, ${frac}/${binVars.length} binaries fractional, ${Math.round(ms)} ms`);

    // baseline: relaxation of the plain weighted-sum LP (same treatment)
    const wsLines = lp.lpString.split('\n');
    const wbi = wsLines.findIndex(l => l.trim() === 'Binary');
    const wei = wsLines.findIndex(l => l.trim() === 'End');
    const wVars = wsLines.slice(wbi + 1, wei).join(' ').trim().split(/\s+/).filter(Boolean);
    const wrel = [...wsLines.slice(0, wbi), ...wsLines.slice(wei)];
    wrel.splice(wrel.findIndex(l => l.trim() === 'Bounds') + 1, 0, ...wVars.map(v => `  0 <= ${v} <= 1`));
    const wres = await solveText(wrel.join('\n'));
    let wfrac = 0;
    if (wres.Status === 'Optimal') {
      for (const v of wVars) {
        const val = wres.Columns?.[v]?.Primal ?? 0;
        if (Math.abs(val - Math.round(val)) > 1e-6) wfrac++;
      }
    }
    console.log(`LP relaxation of weighted-sum (unit weights): ${wres.Status}, ${wfrac}/${wVars.length} binaries fractional`);
  }

  // ---- 7. Novelty + dominance vs the weighted-sum set ----
  const wsList = [...wsBuilds.values()];
  console.log(`\n--- Tchebycheff builds vs weighted-sum reachable set ---`);
  // stat-comparison tolerances: the two sides derive stats differently
  // (raw float sums vs LP-scaled integers), so exact eps would misclassify
  const E_ERGO = 0.15, E_RV = 0.25, E_PRICE = 50;
  let novel = 0, novelNondominated = 0;
  for (const t of tchResults) {
    const inWS = wsBuilds.has(t.sig);
    let label: string;
    if (inWS) {
      label = 'reachable by weighted sum';
    } else {
      // a different item signature with the same stats is NOT an unsupported point
      const statTwin = wsList.some(w =>
        Math.abs(w.ergo - t.ergo) < E_ERGO && Math.abs(w.rv - t.rv) < E_RV && Math.abs(w.price - t.price) < E_PRICE);
      const dominated = wsList.some(w =>
        w.ergo >= t.ergo - E_ERGO && w.rv <= t.rv + E_RV && w.price <= t.price + E_PRICE &&
        (w.ergo > t.ergo + E_ERGO || w.rv < t.rv - E_RV || w.price < t.price - E_PRICE));
      novel++;
      if (statTwin) label = 'novel signature, stat-equal to a WS build';
      else if (dominated) label = 'novel but WS-dominated';
      else { novelNondominated++; label = 'NOVEL & non-dominated (unsupported point)'; }
    }
    const interior = !t.lambda.includes('(0,') && !t.lambda.includes(',0,') && !t.lambda.includes(',0)');
    console.log(`${t.lambda}${interior ? ' [interior λ]' : ''}: ${label}`);
  }
  const tchMs = tchResults.map(t => t.ms);
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(a.length, 1);
  console.log(`\nsummary: ${tchResults.length} Tch solves, avg ${Math.round(avg(tchMs))} ms (max ${Math.round(Math.max(...tchMs))} ms)` +
    ` | WS avg ${Math.round(wsMs / Math.max(wsCount, 1))} ms` +
    ` | ${novel} novel builds, ${novelNondominated} of them non-dominated`);
}

main().catch(e => { console.error(e); process.exit(1); });
