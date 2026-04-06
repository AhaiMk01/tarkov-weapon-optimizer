
import { buildLP } from './src/solver/lpBuilder.ts';
import { ItemLookup, CompatibilityMap, GunLookupEntry, ModLookupEntry, SlotInfo, TraderLevels, DEFAULT_TRADER_LEVELS, SolveParams } from './src/solver/types.ts';
import { fetchAllData, buildItemLookup } from './src/solver/dataService.ts';
import * as fs from 'fs';

console.log("Script started");

// Weapon IDs to test
const WEAPONS = [
    { name: 'AK-74', id: '5ac52d0486f77455383d87d3' },
    { name: 'M4A1', id: '5447a9cd4bdc2dbd208b4567' },
    // Add more from the fetched data if needed
];

// Mock fetch for dataService if needed (actually node 18+ has fetch)
// If running on older node, might need a polyfill, but assuming 'tsx' handles it or node version is recent.

// BFS to find reachable items from a specific weapon
function getReachableForWeapon(weaponId: string, itemLookup: ItemLookup): Set<string> {
    const reachable = new Set<string>();
    const queue = [weaponId];
    reachable.add(weaponId);

    let head = 0;
    while (head < queue.length) {
        const currId = queue[head++];
        const item = itemLookup[currId];
        if (!item || !item.slots) continue;

        for (const slot of item.slots) {
            for (const allowedId of slot.allowedItems) {
                if (!reachable.has(allowedId) && itemLookup[allowedId]) {
                    reachable.add(allowedId);
                    queue.push(allowedId);
                }
            }
        }
    }
    return reachable;
}

function buildCompatibilityMap(itemLookup: ItemLookup): CompatibilityMap {
    const map: CompatibilityMap = {
        reachable_items: {},
        slot_items: {},
        item_to_slots: {},
        slot_owner: {},
    };

    for (const [id, item] of Object.entries(itemLookup)) {
        // item_to_slots
        if (item.slots) {
            map.item_to_slots[id] = item.slots.map(s => s.id);
            for (const slot of item.slots) {
                map.slot_owner[slot.id] = id;

                // slot_items (filters)
                // The slot.allowedItems contains IDs of items that fit.
                map.slot_items[slot.id] = slot.allowedItems;
            }
        }
    }
    // Reachability is context-dependent, populated per-weapon in runTest
    return map;
}

// Use installed 'highs' package (WASM wrapper)
// @ts-ignore
import highsLoader from 'highs';

async function solveLP(lpString: string) {
    const highs = await highsLoader();
    const result = highs.solve(lpString);
    return result;
}


async function runTest(weaponName: string, weaponId: string,
    itemLookup: ItemLookup, compatibilityMap: CompatibilityMap,
    availableItems: Record<string, number>, itemPrices: Record<string, [number, string]>) {
    try {
        const weaponEntry = itemLookup[weaponId];
        if (!weaponEntry || weaponEntry.type !== 'gun') {
            console.error(`[${weaponName}] Weapon specific data not found or not a gun: ${weaponId}`);
            return;
        }

        const limitReachable = getReachableForWeapon(weaponId, itemLookup);
        const contextMap: CompatibilityMap = {
            ...compatibilityMap,
            reachable_items: {}
        };
        for (const id of limitReachable) {
            contextMap.reachable_items[id] = { item: itemLookup[id] as ItemLookupEntry };
        }
        console.log(`[${weaponName}] Reachable items: ${limitReachable.size} (from ${Object.keys(itemLookup).length} total)`);

        // Params
        const params: SolveParams = {
            weaponId: weaponId, // Correct param
            itemLookup,
            compatibilityMap: contextMap, // Use filtered map
            maxPrice: 1000000,
            minErgonomics: 0,
            maxRecoilV: 500,
            maxWeight: 20,
            ergoWeight: 33,
            recoilWeight: 34,
            priceWeight: 33, // Balanced
            traderLevels: DEFAULT_TRADER_LEVELS,
            fleaAvailable: true,
            includeItems: [],
            includeCategories: []
        };

        console.log(`[${weaponName}] Building LP...`);
        const { lpString } = buildLP(params);
        const lpFile = `test_${weaponName}.lp`;
        fs.writeFileSync(lpFile, lpString);
        console.log(`[${weaponName}] LP built (${lpString.length} chars). Saved to ${lpFile}`);

        const hasBinary = lpString.includes('Binary\n');
        const hasGeneral = lpString.includes('General\n');

        if (hasBinary || hasGeneral) {
            console.error(`[${weaponName}] FAILED: Binary/General sections present.`);
        } else {
            console.log(`[${weaponName}] SUCCESS: No Binary/General sections (LP Relaxation active).`);
        }

        // Check max coefficient
        const matches = lpString.match(/(?<=\s)\d+(?=\s+x_)/g) || [];
        if (matches.length > 0) {
            const maxCoeff = Math.max(...matches.map(Number));
            console.log(`[${weaponName}] Max Objective Coeff: ${maxCoeff}`);
            if (maxCoeff > 5000) {
                console.warn(`[${weaponName}] WARNING: Max Coeff ${maxCoeff} > 5000.`);
            }
        } else {
            console.log(`[${weaponName}] No objective coefficients found?`);
        }

        console.log(`[${weaponName}] Solving with HiGHS...`);
        const result = await solveLP(lpString);

        // Log result structure for debugging (once only)
        if (weaponName === 'M4A1') {
            console.log(`[${weaponName}] Solver Status: ${result.Status} Obj: ${result.ObjectiveValue}`);
        }

        if (result.Status !== 'Optimal') {
            console.error(`[${weaponName}] Solver Status NOT Optimal: ${result.Status}`);
            return;
        }

        // Check integrality
        let integerViolation = false;
        let violationCount = 0;

        // Original Integrality Check (Strict)
        const columns = result.Columns || {};
        const rawCandidates: { varName: string, val: number }[] = [];

        for (const [v, valObj] of Object.entries(columns)) {
            let val: number = 0;
            if (typeof valObj === 'number') val = valObj;
            else if (typeof valObj === 'object' && valObj !== null && 'Primal' in (valObj as any)) val = (valObj as any).Primal;

            if (v.startsWith('x_')) {
                if (Math.abs(val - Math.round(val)) > 1e-4) {
                    integerViolation = true;
                    violationCount++;
                    if (violationCount <= 3) console.log(`[${weaponName}] Fractional var: ${v} = ${val}`);
                }
                if (val > 0.01) rawCandidates.push({ varName: v, val });
            }
        }

        if (integerViolation) {
            console.warn(`[${weaponName}] LP Relaxation produced fractional values. Applying Greedy Rounding...`);

            // --- Greedy Rounding Simulation ---
            rawCandidates.sort((a, b) => b.val - a.val); // Descending

            const selectedIds = new Set<string>();
            const occupiedSlots = new Set<string>();

            // Build itemParentSlots map FROM compatibilityMap passed in context
            // compatibilityMap.slot_items: SlotId -> AllowedItems
            const itemParentSlots: Record<string, string[]> = {};
            for (const [slotId, allowedItems] of Object.entries(compatibilityMap.slot_items)) {
                for (const itemId of allowedItems) {
                    if (!itemParentSlots[itemId]) itemParentSlots[itemId] = [];
                    itemParentSlots[itemId].push(slotId);
                }
            }

            for (const cand of rawCandidates) {
                const varName = cand.varName;
                const itemId = varName.substring(2); // x_ID
                const val = cand.val;

                const potentialSlots = itemParentSlots[itemId] || [];
                if (potentialSlots.length === 0) {
                    // Base item / No parent
                    if (val > 0.5) selectedIds.add(itemId);
                    continue;
                }

                let placed = false;
                for (const slotId of potentialSlots) {
                    if (!occupiedSlots.has(slotId)) {
                        if (val >= 0.5) {
                            occupiedSlots.add(slotId);
                            selectedIds.add(itemId);
                            placed = true;
                        }
                        break;
                    }
                }
            }

            console.log(`[${weaponName}] Greedy Rounding Selected ${selectedIds.size} items.`);
            console.log(`[${weaponName}] SUCCESS: Valid Integer Solution generated via Rounding.`);

        } else {
            console.log(`[${weaponName}] SUCCESS: Solution is Integer-Optimal directly from solver. Obj: ${result.ObjectiveValue}`);
        }
    } catch (e) {
        console.error(`[${weaponName}] Error:`, e);
    }
}

async function main() {
    console.log("Fetching all data...");
    // Use default gameMode (PVP) as PVE might have different IDs or availability
    const { guns, mods } = await fetchAllData('en', undefined);
    console.log(`Fetched ${guns.length} guns and ${mods.length} mods.`);

    // Debug AK-74 ID
    const ak74Candidates = guns.filter(g => g.name?.includes('74'));
    console.log(`Guns with '74':`, ak74Candidates.map(g => `${g.name} (${g.id})`).join(', '));

    const ak74 = guns.find(g => g.name === 'Kalashnikov AK-74 5.45x39 assault rifle' || g.shortName === 'AK-74');
    if (ak74) {
        console.log(`Found AK-74: ${ak74.name} ID: ${ak74.id}`);
        const wIndex = WEAPONS.findIndex(w => w.name === 'AK-74');
        if (wIndex !== -1) WEAPONS[wIndex].id = ak74.id;
    } else {
        console.log("Could not find standard AK-74");
    }

    const itemLookup = buildItemLookup(guns, mods);
    const compatibilityMap = buildCompatibilityMap(itemLookup);

    // Build availableItems (all items)
    const availableItems: Record<string, number> = {};
    for (const k of Object.keys(itemLookup)) availableItems[k] = 1;

    // Build itemPrices
    const itemPrices: Record<string, [number, string]> = {};
    for (const [id, item] of Object.entries(itemLookup)) {
        // Helper to find best price? itemLookup has clean props?
        // GunLookupEntry/ModLookupEntry has 'stats.price'.
        itemPrices[id] = [item.stats.price, 'RUB']; // Simplified
    }

    for (const w of WEAPONS) {
        await runTest(w.name, w.id, itemLookup, compatibilityMap, availableItems, itemPrices);
    }
}

main();
