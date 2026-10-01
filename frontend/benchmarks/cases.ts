import { buildItemLookup } from '../src/solver/dataService.ts';
import { buildCompatibilityMap } from '../src/solver/compatibilityMap.ts';
import type { OptimizeRequest, SolverPrecisionMode } from '../src/api/client.ts';
import type { BenchmarkCase, Snapshot } from './types.ts';

export function makeCases(snapshot: Snapshot): BenchmarkCase[] {
  const lookup = buildItemLookup(snapshot.guns, snapshot.mods);
  const guns = snapshot.guns.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const dense = guns.find(g => /\bM4A1\b/i.test(String(g.name)));
  if (!dense) throw new Error('Snapshot has no M4A1; cannot construct the agreed dense case');
  const ranked = guns.filter(g => g.id !== dense.id).map(g => ({ gun: g, size: Object.keys(buildCompatibilityMap(g.id, lookup).reachable_items).length }))
    .filter(g => g.size > 1).sort((a, b) => a.size - b.size || String(a.gun.id).localeCompare(String(b.gun.id)));
  const sparse = ranked[0]?.gun;
  if (!sparse) throw new Error('Snapshot has no sparse weapon with attachments');
  const access: OptimizeRequest['trader_levels'] = { prapor: 4, skier: 4, peacekeeper: 4, mechanic: 4, jaeger: 4, ref: 4 };
  const base = (weapon: string): OptimizeRequest => ({ weapon_id: weapon, ergo_weight: 1, recoil_weight: 1, price_weight: 0.5,
    flea_available: true, barter_available: false, barter_exclude_dogtags: true, player_level: 50, trader_levels: { ...access }, equip_ergo_modifier: 0 });
  const cases: BenchmarkCase[] = [];
  const add = (id: string, description: string, request: OptimizeRequest) => cases.push({ id, description, kind: 'optimize', request });
  const modes: SolverPrecisionMode[] = ['fast', 'precise', 'auto'];
  const toggles = [
    ['linear', {}], ['ted', { use_true_ergo: true }], ['overswing', { prevent_overswing: true }],
    ['sweet', { use_tchebycheff: true }], ['ted-sweet', { use_true_ergo: true, use_tchebycheff: true }],
    ['overswing-sweet', { prevent_overswing: true, use_tchebycheff: true }],
    ['ted-overswing', { use_true_ergo: true, prevent_overswing: true }],
    ['ted-overswing-sweet', { use_true_ergo: true, prevent_overswing: true, use_tchebycheff: true }],
  ] as const;
  for (const [label, gun] of [['dense', dense], ['sparse', sparse]] as const) {
    for (const mode of modes) add(`${label}-${mode}-linear`, `${gun.name}; linear ${mode}`, { ...base(gun.id), precise_mode: mode });
    // Nonlinear modes force precise placement in production, irrespective of the requested precision.
    for (const [name, flags] of toggles.slice(1)) add(`${label}-${name}`, `${gun.name}; ${name}`, { ...base(gun.id), precise_mode: 'precise', ...flags });
    add(`${label}-restricted`, `${gun.name}; LL2, no flea, no Ref, barters enabled`, { ...base(gun.id), precise_mode: 'precise', flea_available: false,
      trader_levels: { prapor: 2, skier: 2, peacekeeper: 2, mechanic: 2, jaeger: 2, ref: 0 }, player_level: 20, barter_available: true });
    const reachable = Object.keys(buildCompatibilityMap(gun.id, lookup).reachable_items).sort();
    const preset = lookup[gun.id];
    if (!preset || preset.type !== 'gun') throw new Error('Missing weapon lookup');
    const retained = preset.presets.flatMap(p => p.items).filter(id => reachable.includes(id)).sort();
    const locked = retained[0] ?? reachable[0];
    const banned = reachable.find(id => id !== locked);
    if (!locked || !banned) throw new Error(`No lock/ban candidates for ${gun.id}`);
    add(`${label}-locks-bans`, `${gun.name}; snapshot-derived retained part lock and reachable part ban`, {
      ...base(gun.id), precise_mode: 'precise', include_items: [locked], exclude_items: [banned],
    });
    const prices = preset.presets.filter(p => p.price > 0).map(p => p.price).sort((a, b) => a - b);
    if (!prices.length) throw new Error(`No priced preset for tight-budget case ${gun.id}`);
    add(`${label}-tight`, `${gun.name}; cheapest preset budget and tight weight (feasibility is not presumed)`, {
      ...base(gun.id), precise_mode: 'precise', max_price: Math.floor(prices[0]), max_weight: Math.max(0.1, Math.round((preset.stats.weight + 1) * 100) / 100),
      use_true_ergo: true, prevent_overswing: true,
    });
    // Sweet Spot repeated preference weight adjustment sequence (Refs #25)
    // Feasibility domain is unchanged; only preference weights change across seq-1 and seq-2
    add(`${label}-sweet-seq-1`, `${gun.name}; Sweet Spot initial solve (ergo priority, w=[100, 0, 0])`, {
      ...base(gun.id), precise_mode: 'precise', use_true_ergo: true, use_tchebycheff: true,
      ergo_weight: 100, recoil_weight: 0, price_weight: 0,
    });
    add(`${label}-sweet-seq-2`, `${gun.name}; Sweet Spot weight adjustment (recoil priority, w=[0, 100, 0], same constraints)`, {
      ...base(gun.id), precise_mode: 'precise', use_true_ergo: true, use_tchebycheff: true,
      ergo_weight: 0, recoil_weight: 100, price_weight: 0,
    });
    cases.push({ id: `${label}-explore`, description: `${gun.name}; full 10-step curve; public API omits point certificates`, kind: 'explore',
      request: { ...base(gun.id), precise_mode: 'precise', ignore: 'price', steps: 10 } });
  }
  // Select a gun with no buyable bare receiver and a priced preset, so any successful build must buy a preset.
  const presetGun = guns.find(g => {
    const entry = lookup[g.id];
    return entry?.type === 'gun' && entry.stats.offers.length === 0 && entry.presets.some(p => p.price > 0 && p.purchasable);
  });
  if (!presetGun) throw new Error('Snapshot has no preset-only purchasable gun for mandatory preset coverage');
  add('preset-purchase', `${presetGun.name}; no bare-receiver offers, priced presets available`, { ...base(presetGun.id), precise_mode: 'precise' });
  const task = snapshot.tasks.find(t => lookup[t.weapon_id]?.type === 'gun' &&
    (t.required_item_ids ?? []).every(id => !!lookup[id]) && Object.keys(t.constraints ?? {}).length > 0);
  if (!task) throw new Error('Snapshot has no valid real Gunsmith task');
  add('gunsmith', task.task_name, { ...base(task.weapon_id), ...task.constraints, precise_mode: true,
    ...((task.required_item_ids?.length ?? 0) > 0 ? { include_items: task.required_item_ids } : {}),
    ...((task.required_category_group_ids?.length ?? 0) > 0 ? { include_categories: task.required_category_group_ids } : {}),
  });
  return cases;
}
