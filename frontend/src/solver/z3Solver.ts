import { init as initLowLevel } from 'z3-solver/build/low-level';
import { createApi } from 'z3-solver/build/high-level';
import { Mutex } from 'async-mutex';
// @ts-ignore
import initZ3Factory from 'z3-solver/build/z3-built';

import type { SolveParams } from './types.ts';
import type { OptimizeResponse, ItemDetail, PresetDetail, FinalStats } from '../api/client.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let z3Context: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let z3Loading: Promise<any> | null = null;

const z3Mutex = new Mutex();

export async function initZ3() {
    if (z3Context) return z3Context;
    if (z3Loading) return z3Loading;

    z3Loading = (async () => {
        let z3WasmUrl: string;

        // Check if we are in a Vite environment
        // @ts-ignore
        if (import.meta.env) {
            // @ts-ignore
            const wasmUrl = await import('z3-solver/build/z3-built.wasm?url');
            z3WasmUrl = wasmUrl.default;
        } else {
            // Node/other environment
            // In Node, Emscripten usually finds the wasm next to the JS, 
            // but we can provide a relative path from the current file if needed.
            // For node tests, we'll try to find it in node_modules.
            z3WasmUrl = 'frontend/node_modules/z3-solver/build/z3-built.wasm';
        }

        // Direct init using low-level and high-level APIs to avoid browser.js global check
        // The low-level init expects a function that returns the module (initZ3Factory)
        // We wrap it to pass the locateFile options.
        const lowLevel = await initLowLevel(() => initZ3Factory({
            PTHREAD_POOL_SIZE: 0,
            locateFile: (f: string) => {
                if (f.endsWith('.wasm')) return z3WasmUrl;
                return f;
            }
        }));

        // Disable internal parallelism to avoid pthread crashes in browser
        lowLevel.Z3.global_param_set('parallel.enable', 'false');

        const api = createApi(lowLevel.Z3);
        z3Context = api.Context('main');
        return z3Context;
    })();
    return z3Loading;
}

export async function solveZ3(params: SolveParams): Promise<OptimizeResponse> {
    return await z3Mutex.runExclusive(async () => {
        const startTime = performance.now();
        const Context = await initZ3();
        const { Optimize, Bool, Int, Real, Not, If, Or } = Context; // Context IS the z3 context object

        const opt = new Optimize();
        const itemLookup = params.itemLookup;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const itemVars: Record<string, any> = {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const presetVars: Record<string, any> = {};

        console.log('[Z3] Building model...');

        // 1. Define Variables
        // Items -> Boolean (Selected or not)
        // We only care about reachable items from compatibility map to keep problem size small
        const reachableIds = Object.keys(params.compatibilityMap.reachable_items);

        // Ensure weapon root is included
        if (!reachableIds.includes(params.weaponId)) {
            reachableIds.push(params.weaponId);
        }

        for (const id of reachableIds) {
            itemVars[id] = Bool.const(`x_${id}`);
        }

        // Presets (Bases) -> Boolean
        // We need to know which preset/base is selected to apply base price/stats correctly
        const weapon = itemLookup[params.weaponId];
        if (weapon.type !== 'gun') {
            throw new Error(`Weapon ID ${params.weaponId} is not a gun!`);
        }

        if (weapon.type === 'gun') {
            // Add 'naked' base
            presetVars['naked'] = Bool.const('base_naked');

            // Add definitions for presets
            const presets = [...(weapon.presets || []), ...(weapon.all_presets || [])];
            for (const p of presets) {
                presetVars[p.id] = Bool.const(`base_${p.id}`);
            }
        }

        // 2. Constraints

        // C1: Select exactly one base (preset or naked)
        const baseExprs = Object.values(presetVars);

        // Helper: BoolToInt
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b2i = (b: any) => If(b, Int.val(1), Int.val(0));

        let baseSum = Int.val(0);
        for (const b of baseExprs) {
            baseSum = baseSum.add(b2i(b));
        }
        opt.add(baseSum.eq(1));

        // C2: Item Dependencies & Conflicts
        // Constraint 3: Conflicting items
        for (const [id, entry] of Object.entries(params.itemLookup)) {
            const itemBool = itemVars[id];
            if (!itemBool) continue; // Should not happen if iteration correct

            if (entry.type === 'mod' && entry.conflicting_items) {
                for (const confId of entry.conflicting_items) {
                    if (itemVars[confId]) {
                        // x_A => NOT x_B
                        opt.add(ApiImplies(Context, itemBool, Not(itemVars[confId])));
                    }
                }
            }
        }

        // Constraint 1 & 2: Placement-based mutex and dependency

        // Constraint: Included items
        if (params.includeItems) {
            for (const reqId of params.includeItems) {
                if (itemVars[reqId]) {
                    opt.add(itemVars[reqId]);
                } else {
                    console.warn(`[Z3 Warning] Included item ${reqId} not reachable/in vars`);
                }
            }
        }
        /* ... logic ... */

        // First pass: identify which slots each item can go into (only considering available parents)
        const itemToValidSlots: Record<string, { slotId: string, ownerId: string, isBase: boolean }[]> = {};
        for (const i of Object.keys(itemVars)) {
            itemToValidSlots[i] = [];
        }

        const slotItems = params.compatibilityMap.slot_items; // SlotID -> [ItemIDs]

        for (const [slotId, items] of Object.entries(slotItems)) {
            const ownerId = params.compatibilityMap.slot_owner[slotId];
            const isBase = ownerId === params.weaponId;

            // Check if slot owner is available (either weapon, or available mod)
            const ownerAvailable = isBase || ownerId in itemVars;

            if (ownerAvailable) {
                for (const itemId of items) {
                    if (itemId in itemVars) {
                        itemToValidSlots[itemId].push({ slotId, ownerId, isBase });
                    }
                }
            }
        }


        // C3: Slot Logic (Parent -> Child)
        const slotMap = params.compatibilityMap.slot_items; // SlotID -> [ItemIDs]
        const slotOwner = params.compatibilityMap.slot_owner; // SlotID -> OwnerItemID

        // Constraint 1: Mutex - At most one item in each slot
        for (const [slotId, allowedItems] of Object.entries(slotMap)) {
            const ownerId = slotOwner[slotId];
            if (!ownerId || !itemVars[ownerId]) continue;

            const curSlotItems: any[] = [];
            for (const childId of (allowedItems as string[])) {
                if (itemVars[childId]) curSlotItems.push(itemVars[childId]);
            }

            if (curSlotItems.length > 0) {
                let slotSum = Int.val(0);
                for (const b of curSlotItems) slotSum = slotSum.add(b2i(b));
                opt.add(slotSum.le(1));

                // Required slot enforcement
                const ownerEntry = params.itemLookup[ownerId];
                const slotEntry = ownerEntry.slots.find(s => s.id === slotId);
                if (slotEntry?.required) {
                    opt.add(ApiImplies(Context, itemVars[ownerId], slotSum.ge(1)));
                }
            } else {
                const ownerEntry = params.itemLookup[ownerId];
                const slotEntry = ownerEntry.slots.find(s => s.id === slotId);
                if (slotEntry?.required) {
                    opt.add(Not(itemVars[ownerId]));
                }
            }
        }

        // Constraint 2: Dependency - If item selected, at least one valid parent must be selected
        for (const id of reachableIds) {
            if (id === params.weaponId) continue;
            const validSlots = itemToValidSlots[id];
            if (validSlots.length > 0) {
                const parentOptions = validSlots.map(s => itemVars[s.ownerId]).filter(x => !!x);
                if (parentOptions.length > 0) {
                    opt.add(ApiImplies(Context, itemVars[id], Or(...parentOptions)));
                } else {
                    // No reachable parents!? Should have been caught by BFS, but for safety:
                    opt.add(Not(itemVars[id]));
                }
            } else {
                // No slots allowed this item?
                opt.add(Not(itemVars[id]));
            }
        }

        // C4: Weapon Itself must be selected
        // Since 'base' logic handles presets, and base implies weapon?
        // Actually, we must bind base selection to weapon selection.
        // Ideally: base_naked => x_Weapon
        // But since "x_Weapon" is the root of everything, and we forced exactly one base...
        // We should simplify: Just Force x_Weapon to be true.
        if (itemVars[params.weaponId]) {
            opt.add(itemVars[params.weaponId]);
        } else {
            console.error("Weapon Root ID not in reachable set!");
        }

        // 3. Objectives & Stats
        let totalErgo = Real.val(weapon.stats.naked_ergonomics);
        let totalRecoilMod = Real.val(0);
        let totalWeight = Real.val(weapon.stats.weight); // Kg
        let totalPrice = Real.val(0);

        // Base Prices
        for (const [baseId, baseVar] of Object.entries(presetVars)) {
            let pPrice = 0;
            if (baseId === 'naked') pPrice = weapon.stats.price;
            else {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const p = (weapon.presets || []).find((x: any) => x.id === baseId) || (weapon.all_presets || []).find((x: any) => x.id === baseId);
                pPrice = p ? p.price : 999999;
            }
            totalPrice = totalPrice.add(If(baseVar, Real.val(pPrice), Real.val(0)));
        }

        // Item Stats
        for (const id of reachableIds) {
            if (id === params.weaponId) continue;
            const entry = params.itemLookup[id]; // Safe lookup

            let iPrice = 0;
            let iErgo = 0;
            let iRec = 0;
            let iW = 0;

            if (entry.type === 'mod') {
                iPrice = entry.stats.price || 0;
                iErgo = entry.stats.ergonomics || 0;
                iRec = entry.stats.recoil_modifier || 0;
                iW = entry.stats.weight || 0;
            } else if (entry.type === 'gun') {
                iPrice = entry.stats.price || 0;
                iErgo = entry.stats.naked_ergonomics || 0;
                iRec = 0;
                iW = entry.stats.weight || 0;
            }

            const isSelected = itemVars[id];

            // Conditional addition
            totalErgo = totalErgo.add(If(isSelected, Real.val(iErgo), Real.val(0)));
            totalRecoilMod = totalRecoilMod.add(If(isSelected, Real.val(iRec), Real.val(0)));
            totalWeight = totalWeight.add(If(isSelected, Real.val(iW), Real.val(0)));
            totalPrice = totalPrice.add(If(isSelected, Real.val(iPrice), Real.val(0)));
        }

        // Constraints on Stats (from params)
        if (params.minErgonomics) opt.add(totalErgo.ge(params.minErgonomics));
        if (params.maxWeight) opt.add(totalWeight.le(params.maxWeight));
        if (params.maxRecoilV) {
            const limit = params.maxRecoilV;
            const baseV = weapon.stats.naked_recoil_v;
            const reqMod = (limit / baseV) - 1;
            opt.add(totalRecoilMod.le(reqMod));
        }

        // 4. Objective Function
        const wErgo = params.ergoWeight || 0;
        const wRecoil = params.recoilWeight || 0;
        const wPrice = params.priceWeight || 0;

        const objExpr = (
            totalErgo.mul(wErgo)
                .add(totalRecoilMod.mul(-100 * wRecoil)) // Scaling: -100 * RecoilMod (e.g. -0.3 * -100 = +30 score)
                .add(totalPrice.mul(-0.01 * wPrice))
        );

        opt.maximize(objExpr);

        console.log('[Z3] Solving...');
        const result_status = await opt.check();
        console.log('[Z3] Status:', result_status);

        if (result_status !== 'sat') {
            return {
                status: 'infeasible',
                reason: result_status === 'unsat' ? 'No solution found' : 'Unknown error',
                selected_items: [],
                selected_preset: undefined,
                objective_value: 0,
                solve_time_ms: performance.now() - startTime
            };
        }

        const model = opt.model();

        // Decode solution
        const selectedIds: string[] = [];
        for (const [id, boolVar] of Object.entries(itemVars)) {
            if (model.eval(boolVar).toString() === 'true') {
                selectedIds.push(id);
            }
        }

        let selectedPresetId: string | undefined;
        for (const [pid, boolVar] of Object.entries(presetVars)) {
            if (model.eval(boolVar).toString() === 'true') {
                selectedPresetId = pid;
                break;
            }
        }

        // Helper to parse Z3 rational strings (e.g. "120", "(- 5)", "(/ 1 2)", "(- (/ 1 2))")
        function parseZ3Num(expr: any): number {
            const s = expr.toString().trim();

            function parse(str: string): number {
                str = str.trim();
                if (str.startsWith('(- ') && str.endsWith(')')) {
                    return -parse(str.slice(3, -1));
                }
                if (str.startsWith('(/ ') && str.endsWith(')')) {
                    const inner = str.slice(3, -1).trim();
                    let splitIdx = -1;
                    let depth = 0;
                    for (let i = 0; i < inner.length; i++) {
                        if (inner[i] === '(') depth++;
                        if (inner[i] === ')') depth--;
                        if (depth === 0 && inner[i] === ' ') {
                            splitIdx = i;
                            break;
                        }
                    }
                    if (splitIdx !== -1) {
                        const n = inner.substring(0, splitIdx);
                        const d = inner.substring(splitIdx + 1);
                        return parse(n) / parse(d);
                    }
                }
                if (str.includes('/') && !str.startsWith('(')) {
                    const [n, d] = str.split('/');
                    return Number(n) / Number(d);
                }
                return Number(str);
            }

            try {
                return parse(s);
            } catch (e) {
                console.error("Parse Error for:", s, e);
                return 0; // Fallback
            }
        }

        const finalStats: FinalStats = {
            ergonomics: parseZ3Num(model.eval(totalErgo)),
            recoil_vertical: weapon.stats.naked_recoil_v * (1 + parseZ3Num(model.eval(totalRecoilMod))),
            recoil_horizontal: weapon.stats.naked_recoil_h * (1 + parseZ3Num(model.eval(totalRecoilMod))),
            total_price: parseZ3Num(model.eval(totalPrice)),
            total_weight: parseZ3Num(model.eval(totalWeight)),
        };

        // Build detailed items
        const detailedItems: ItemDetail[] = selectedIds.map(itemId => {
            const entry = itemLookup[itemId];
            if (!entry) return { id: itemId, name: 'Unknown', price: 0, ergonomics: 0, recoil_modifier: 0 };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data = entry.data as Record<string, unknown>;
            const icon = (data.iconLink ?? data.iconLinkFallback ?? data.imageLink ?? data.image512pxLink) as string | undefined;

            if (entry.type === 'mod') {
                const modStats = entry.stats; // ModStats
                return {
                    id: itemId,
                    name: (data.name as string) ?? 'Unknown',
                    price: modStats.price || 0,
                    icon,
                    source: modStats.price_source ?? 'Unknown',
                    ergonomics: modStats.ergonomics || 0,
                    recoil_modifier: modStats.recoil_modifier || 0,
                };
            }

            // Gun as item
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const gunStats = entry.stats as any; // GunStats
            return {
                id: itemId,
                name: (data.name as string) ?? 'Unknown',
                price: gunStats.price || 0,
                icon,
                source: gunStats.price_source ?? 'Unknown',
                ergonomics: gunStats.naked_ergonomics || 0,
                recoil_modifier: 0, // Guns don't have recoil modifier usually
            };
        });

        let baseDetail: PresetDetail | undefined;
        if (selectedPresetId && selectedPresetId !== 'naked') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const p = (weapon.presets || []).find((x: any) => x.id === selectedPresetId) || (weapon.all_presets || []).find((x: any) => x.id === selectedPresetId);
            if (p) {
                baseDetail = {
                    id: p.id,
                    name: p.name,
                    price: p.price,
                    items: p.items || []
                };
            }
        }

        return {
            status: 'optimal',
            selected_items: detailedItems,
            selected_preset: baseDetail,
            objective_value: 0, // model.eval(objectiveHandle).toString(),
            final_stats: finalStats,
            solve_time_ms: performance.now() - startTime
        };
    });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ApiImplies(Context: any, a: any, b: any) {
    return Context.Or(Context.Not(a), b);
}
