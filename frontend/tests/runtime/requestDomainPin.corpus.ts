// The requests the request-domain pin (requestDomainPin.test.ts) holds the derived consumers against: the reuse key, the witness scope and the
// solve parameters of the worker. Each one varies a different group of domain fields, including the awkward ones (unsorted and duplicated ids, mixed-case
// trader names, numbers sent as strings, nulls, a 0% modifier).
import type { OptimizeRequest } from '../../src/api/client';
import type { SolveParams } from '../../src/solver/types';
import type { EndpointControls } from '../../src/solver/reuseKey';

export const KEY_WEAPON = 'weapon-1';

const FULL: OptimizeRequest = {
  weapon_id: KEY_WEAPON,
  max_price: 250000,
  min_ergonomics: 45,
  max_recoil_v: 80,
  max_recoil_sum: 120,
  min_mag_capacity: 30,
  min_sighting_range: 100,
  max_weight: 4.5,
  max_moa: 1.5,
  include_items: ['m2', 'm1', 'm2'],
  exclude_items: ['m3'],
  include_categories: [['b', 'a', 'a'], ['c']],
  exclude_categories: ['z', 'y'],
  prevent_overswing: true,
  equip_ergo_modifier: -0.15,
  use_true_ergo: true,
  ergo_weight: 3,
  recoil_weight: 2,
  price_weight: 0.5,
  use_tchebycheff: true,
  trader_levels: { Prapor: 2, ' Skier ': 3, peacekeeper: 4, mechanic: 0, jaeger: 1, ref: 4 } as unknown as OptimizeRequest['trader_levels'],
  flea_available: false,
  barter_available: true,
  barter_exclude_dogtags: true,
  player_level: 42,
  owned_items: ['b', 'a', 'a'],
  precise_mode: 'auto',
  allow_repeated_parts: true,
  time_limit_ms: 5000,
};

const ALL_TRADERS = { prapor: 4, skier: 4, peacekeeper: 4, mechanic: 4, jaeger: 4, ref: 4 };

export const KEY_REQUESTS: Record<string, OptimizeRequest> = {
  minimal: { weapon_id: KEY_WEAPON },
  full: FULL,
  'same domain, other weights and options': { ...FULL, ergo_weight: 9, recoil_weight: 1, price_weight: 4, use_tchebycheff: false, allow_repeated_parts: false, time_limit_ms: 1 },
  'precise_mode as a boolean': { weapon_id: KEY_WEAPON, precise_mode: true, max_price: 1000 },
  'precise_mode false': { weapon_id: KEY_WEAPON, precise_mode: false },
  'numbers sent as strings': { weapon_id: KEY_WEAPON, max_price: '5000' as unknown as number, player_level: '30' as unknown as number, equip_ergo_modifier: '-0.1' as unknown as number, max_moa: '2' as unknown as number },
  nulls: {
    weapon_id: KEY_WEAPON, max_price: null as unknown as number, min_ergonomics: null as unknown as number, max_moa: null as unknown as number,
    include_items: null as unknown as string[], trader_levels: null as unknown as OptimizeRequest['trader_levels'], player_level: null as unknown as number,
  },
  'zero values': { weapon_id: KEY_WEAPON, max_price: 0, min_ergonomics: 0, min_mag_capacity: 0, max_weight: 0, equip_ergo_modifier: 0, player_level: 0, max_moa: 0 },
  'empty lists': { weapon_id: KEY_WEAPON, include_items: [], exclude_items: [], include_categories: [], exclude_categories: [], owned_items: [] },
  'a category group that is empty': { weapon_id: KEY_WEAPON, include_categories: [['x'], [], ['w', 'v']] },
  'market flags off the defaults': { weapon_id: KEY_WEAPON, flea_available: false, barter_available: true, barter_exclude_dogtags: true, trader_levels: { ...ALL_TRADERS, prapor: 0 } },
  'market flags at the defaults, spelled out': { weapon_id: KEY_WEAPON, flea_available: true, barter_available: false, barter_exclude_dogtags: false },
  'TrueErgo alone': { weapon_id: KEY_WEAPON, use_true_ergo: true, equip_ergo_modifier: -0.2 },
  'Prevent Overswing alone': { weapon_id: KEY_WEAPON, prevent_overswing: true, equip_ergo_modifier: -0.2 },
  'both flags false, spelled out': { weapon_id: KEY_WEAPON, use_true_ergo: false, prevent_overswing: false },
  'a duplicated trader alias': { weapon_id: KEY_WEAPON, trader_levels: { ...ALL_TRADERS, prapor: 3, mechanic: 0, Mechanic: 4 } as OptimizeRequest['trader_levels'] },
  'stash with repeats': { weapon_id: KEY_WEAPON, owned_items: ['z', 'a', 'z', 'm'] },
};

export const KEY_CONTROLS: Record<string, EndpointControls | undefined> = {
  none: undefined,
  precise: { precisionResolved: 'precise', timeLimitMs: 60000, maxSpatialNodes: 200, tolerance: 1e-5 },
  fast: { precisionResolved: 'fast', timeLimitMs: 1234, maxSpatialNodes: 7, tolerance: 0.25 },
};

/** The floor request as the runtime hands it to the floor search (the normalized domain minus the cap), for the witness scope. */
type ScopeParams = Omit<SolveParams, 'maxMOA' | 'itemLookup' | 'compatibilityMap'>;

export const SCOPE_PARAMS: Record<string, ScopeParams> = {
  minimal: { weaponId: KEY_WEAPON },
  defaults: {
    weaponId: KEY_WEAPON, useTrueErgo: false, preventOverswing: false, fleaAvailable: true, barterAvailable: false, barterExcludeDogtags: false,
    traderLevels: ALL_TRADERS, playerLevel: 60, ownedItems: [],
  },
  full: {
    weaponId: KEY_WEAPON, maxPrice: 250000, minErgonomics: 45, maxRecoilV: 80, maxRecoilSum: 120, minMagCapacity: 30, minSightingRange: 100, maxWeight: 4.5,
    includeItems: ['m2', 'm1', 'm2'], excludeItems: ['m3'], includeCategories: [['b', 'a', 'a'], ['c']], excludeCategories: ['z', 'y'],
    useTrueErgo: true, preventOverswing: true, equipErgoModifier: -0.15,
    traderLevels: { ...ALL_TRADERS, prapor: 2, mechanic: 0 }, fleaAvailable: false, barterAvailable: true, barterExcludeDogtags: true, playerLevel: 42,
    ownedItems: ['b', 'a', 'a'],
  },
  'zero and null values': {
    weaponId: KEY_WEAPON, maxPrice: 0, minErgonomics: null, maxRecoilV: 0, minMagCapacity: 0, includeItems: null, excludeCategories: null,
    equipErgoModifier: 0, traderLevels: null, playerLevel: 0,
  },
  'a stray maxMOA is not in the scope': { weaponId: KEY_WEAPON, ...({ maxMOA: 3 } as object), maxPrice: 7 },
};

export const SCOPE_CAPS: (number | null)[] = [null, 1.5];

/** The requests the worker turns into solve parameters (Optimize, the Explore base, the floor base). The weapon is added by the test. */
export const RUNTIME_REQUESTS: Record<string, Omit<OptimizeRequest, 'weapon_id'>> = {
  minimal: {},
  full: { ...FULL, weapon_id: undefined } as Omit<OptimizeRequest, 'weapon_id'>,
  'market only': { flea_available: false, barter_available: true, barter_exclude_dogtags: true, player_level: 15, trader_levels: { ...ALL_TRADERS, skier: 2 } },
  'flags and limits': { use_true_ergo: true, prevent_overswing: true, equip_ergo_modifier: 0, max_price: 100, max_moa: 2.5, max_weight: 3, min_sighting_range: 50 },
  'stash and filters': { owned_items: ['b', 'a'], include_items: ['a'], exclude_items: ['b'], include_categories: [['c1', 'c2']], exclude_categories: ['c3'] },
};
