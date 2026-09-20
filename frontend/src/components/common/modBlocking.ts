import type { ModInfo, ModCompatibility } from '../../api/client'

const NONE: ReadonlySet<string> = new Set()

/**
 * Parts that provably cannot appear in the same build as everything currently
 * required. Two sound rules, both cheap:
 *
 *   1. it conflicts with a required part;
 *   2. every slot it could occupy is already claimed -- counting only required
 *      parts that have exactly one possible slot, since anything with a choice
 *      of slots does not pin a particular one.
 *
 * This is a necessary condition, not a sufficient one: a part left selectable
 * can still make the build infeasible for reasons only the solver knows (budget,
 * trader level, a constraint elsewhere). Greying out is therefore safe -- it
 * never hides something that would have worked -- but the solver stays the
 * authority on what actually solves.
 *
 * `compat` is one weapon's graph, so this only holds for that weapon. Callers
 * comparing several weapons pass nothing and get no blocking.
 */
export function computeBlockedModIds(
  compat: ModCompatibility | undefined,
  includedIds: string[],
  mods: ModInfo[],
): ReadonlySet<string> {
  if (!compat || includedIds.length === 0) return NONE
  const included = new Set(includedIds)
  const blocked = new Set<string>()

  for (const id of includedIds) {
    for (const other of compat.conflicts[id] ?? []) {
      if (!included.has(other)) blocked.add(other)
    }
  }

  const claimed = new Set<string>()
  for (const id of includedIds) {
    const slots = compat.slots_by_item[id]
    if (slots?.length === 1) claimed.add(slots[0])
  }
  if (claimed.size > 0) {
    for (const mod of mods) {
      if (included.has(mod.id)) continue
      const slots = compat.slots_by_item[mod.id]
      if (slots?.length && slots.every(sl => claimed.has(sl))) blocked.add(mod.id)
    }
  }
  return blocked
}
