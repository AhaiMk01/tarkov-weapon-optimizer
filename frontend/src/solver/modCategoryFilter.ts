/**
 * BSG lists some broad buckets (e.g. auxiliary-mod) as taxonomy leaves; hide them from the mod filter UI.
 */
export const BSG_AUXILIARY_MOD_NORMALIZED = 'auxiliary-mod'

/** Include a bsgCategory in the per-weapon mod filter when it is the finest level used on this weapon. */
export function includeCategoryInModFilter(opts: {
  categoryNormalized: string
  childCategoryIds: string[]
  usedCategoryIds: Set<string>
}): boolean {
  if (opts.categoryNormalized === BSG_AUXILIARY_MOD_NORMALIZED) return false
  if (opts.childCategoryIds.length === 0) return true
  return !opts.childCategoryIds.some(cid => opts.usedCategoryIds.has(cid))
}
