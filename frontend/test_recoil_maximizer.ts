import { solveZ3 } from './src/solver/z3Solver';
import { buildCompatibilityMap } from './src/solver/compatibilityMap';
import type { ItemLookup, GunStats, ModStats, SolveParams } from './src/solver/types';

async function runTest() {
    console.log('Fetching data...');
    let data: any;
    try {
        const response = await fetch('https://api.tarkov.dev/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: `
            {
              items(lang: en) {
                id
                name
                shortName
                basePrice
                types
                conflictingItems { id }
                properties {
                  ... on ItemPropertiesWeapon {
                    defaultPreset { id }
                    presets { id }
                    slots {
                      id
                      name
                      required
                      filters { allowedItems { id } }
                    }
                    ergo: ergonomics
                    recoilVertical
                    recoilHorizontal
                  }
                  ... on ItemPropertiesWeaponMod {
                    ergonomics
                    recoilModifier
                    slots {
                      id
                      name
                      required
                      filters { allowedItems { id } }
                    }
                  }
                  ... on ItemPropertiesBarrel {
                    ergonomics
                    recoilModifier
                    slots {
                      id
                      name
                      required
                      filters { allowedItems { id } }
                    }
                  }
                  ... on ItemPropertiesScope {
                    ergonomics
                    recoilModifier
                    slots {
                      id
                      name
                      required
                      filters { allowedItems { id } }
                    }
                  }
                }
              }
            }
          `
            })
        });
        const resJson = await response.json();
        data = resJson.data;
    } catch (e) {
        console.error('Fetch failed:', e);
        return;
    }

    if (!data || !data.items) {
        console.error('Invalid data received');
        return;
    }

    const lookup: ItemLookup = {};
    for (const item of data.items) {
        const props = item.properties || {};
        const isGun = item.types.includes('gun');

        if (isGun) {
            lookup[item.id] = {
                type: 'gun',
                data: { name: item.name },
                stats: {
                    naked_ergonomics: props.ergo || 0,
                    naked_recoil_v: props.recoilVertical || 0,
                    naked_recoil_h: props.recoilHorizontal || 0,
                    price: item.basePrice || 0,
                    default_ergonomics: 0,
                    default_recoil_v: 0,
                    default_recoil_h: 0,
                    weight: 0,
                    sighting_range: 100,
                    price_source: 'base',
                    fire_modes: [],
                    caliber: '',
                    width: 1,
                    height: 1,
                    accuracy_modifier: 0,
                    fire_rate: 600,
                    default_preset_image: null,
                    category: 'Assault Rifle',
                    category_id: '1',
                    camera_snap: 0,
                    center_of_impact: 0,
                    deviation_max: 0,
                    deviation_curve: 0,
                    recoil_angle: 0,
                    recoil_dispersion: 0
                } as GunStats,
                slots: (props.slots || []).map((s: any) => ({
                    id: s.id,
                    name: s.name,
                    required: !!s.required,
                    allowedItems: s.filters?.allowedItems?.map((i: any) => i.id) || []
                })),
                presets: [],
                all_presets: []
            };
        } else if (item.types.includes('mods')) {
            if (item.id === '68caad12269e10396503acfe') {
                console.log(`[DEBUG] AEM-5 Raw Recoil: ${props.recoilModifier}`);
            }
            lookup[item.id] = {
                type: 'mod',
                data: { name: item.name },
                stats: {
                    ergonomics: props.ergonomics || 0,
                    recoil_modifier: props.recoilModifier || 0,
                    price: item.basePrice || 0,
                    weight: 0,
                    accuracy_modifier: 0,
                    offers: [],
                    price_source: 'base',
                    width: 1,
                    height: 1,
                    min_level_flea: 1,
                    capacity: 0,
                    sighting_range: 0,
                    category: '',
                    category_id: ''
                } as ModStats,
                slots: (props.slots || []).map((s: any) => ({
                    id: s.id,
                    name: s.name,
                    required: !!s.required,
                    allowedItems: s.filters?.allowedItems?.map((i: any) => i.id) || []
                })),
                conflicting_items: item.conflictingItems?.map((i: any) => i.id) || [],
                conflicting_slot_ids: []
            };
        }
    }

    const weaponId = '5447a9cd4bdc2dbd208b4567'; // M4A1
    const cmap = buildCompatibilityMap(weaponId, lookup);

    const params: SolveParams = {
        weaponId,
        itemLookup: lookup,
        compatibilityMap: cmap,
        maxPrice: null,
        recoilWeight: 100,
        ergoWeight: 0,
        priceWeight: 0,
        traderLevels: {
            'prapor': 4,
            'skier': 4,
            'peacekeeper': 4,
            'mechanic': 4,
            'jaeger': 4
        },
        fleaAvailable: true,
    };

    console.log('Solving for Max Recoil Reduction (Recoil Weight = 100)...');
    const result = await solveZ3(params);

    console.log(`Status: ${result.status}`);
    const finalStats = result.final_stats;
    if (finalStats) {
        console.log(`Vertical Recoil: ${finalStats.recoil_vertical}`);
        console.log(`Horizontal Recoil: ${finalStats.recoil_horizontal}`);
    }
    console.log('Selected Items:');
    result.selected_items.forEach((item: any) => {
        console.log(` - ${item.name} (${item.id}) (Recoil: ${item.recoil_modifier})`);
    });
}

runTest();
