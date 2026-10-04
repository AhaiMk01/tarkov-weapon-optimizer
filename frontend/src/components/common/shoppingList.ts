import type { OptimizeResponse } from '../../api/client'
import { presetSupply } from '../../solver/presetSupply'

/**
 * One line per selected part for the copied build list. A part the base preset supplies in quantity
 * carries its count ("×2"), since buying that preset hands over that many copies; a single copy
 * is just the name.
 */
export function shoppingListLines(result: Pick<OptimizeResponse, 'selected_items' | 'selected_preset'>): string[] {
  const supplied = result.selected_preset ? presetSupply(result.selected_preset.items) : null
  return result.selected_items.map(item => {
    const copies = supplied?.get(item.id)
    return copies !== undefined && copies > 1 ? `${item.name} ×${copies}` : item.name
  })
}
