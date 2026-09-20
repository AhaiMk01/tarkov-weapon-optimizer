import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Empty, Input, Modal, Select, Space, Typography, theme } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import type { ModInfo } from '../../api/client'
import { GalleryCard } from './GalleryCard'
import { galleryVars, useCardProximityEffect } from './galleryEffects'
import './WeaponGallery.css'

const { useToken } = theme

/**
 * Visual picker for attachments, built on the same grid as the weapon gallery.
 *
 * The dropdown it supplements only ever showed results once you typed, capped at
 * ten -- so finding a part required already knowing its name. People generally
 * do not: they know the shape ("the red dot with the sharp ears") and the role
 * ("a 1-4x"). Grouping by handbook category and showing every icon in that group
 * turns recall into recognition, and incidentally scopes the search for people
 * who do know the name.
 */

interface ModGalleryProps {
  open: boolean
  onClose: () => void
  mods: ModInfo[]
  /** Parts ruled out by the current picks; see computeBlockedModIds. */
  blockedIds: ReadonlySet<string>
  loading?: boolean
  includedIds: string[]
  excludedIds: string[]
  /** Toggles the mod in/out of the required set. Must be referentially stable:
   *  it is handed straight to a thousand memoised cards. */
  onToggleInclude: (id: string) => void
  /** Toggles the mod in/out of the banned set. Same stability requirement. */
  onToggleExclude: (id: string) => void
  onClearAll: () => void
}

/** Group key for parts with no category at all. A sentinel rather than a word,
 *  because the key doubles as the filter value and must not vary by language. */
const OTHER_GROUP = '__other__'

const fmtPower = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/** "4x", "1-4x", or nothing for parts that are not sights. */
function zoomLabel(mod: ModInfo): string {
  const { zoom_min: lo, zoom_max: hi } = mod
  if (lo == null || hi == null) return ''
  return lo === hi ? `${fmtPower(lo)}x` : `${fmtPower(lo)}-${fmtPower(hi)}x`
}

function groupKeyOf(mod: ModInfo): string {
  const hb = mod.handbook_categories?.[0]
  if (hb) return hb
  const leaf = mod.category?.split(' > ').pop()
  return leaf || OTHER_GROUP
}

export function ModGallery({
  open,
  onClose,
  mods,
  blockedIds,
  loading,
  includedIds,
  excludedIds,
  onToggleInclude,
  onToggleExclude,
  onClearAll,
}: ModGalleryProps) {
  const { t } = useTranslation()
  const { token } = useToken()
  const [search, setSearch] = useState('')
  // The grid is the expensive part; deferring it keeps the input responsive
  // while a thousand cards re-filter behind it.
  const deferredSearch = useDeferredValue(search)
  const [groupFilter, setGroupFilter] = useState<string | null>(null)
  const [zoomFilter, setZoomFilter] = useState<string | null>(null)
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)

  const includedSet = useMemo(() => new Set(includedIds), [includedIds])
  const excludedSet = useMemo(() => new Set(excludedIds), [excludedIds])

  const groupLabel = useCallback(
    (key: string) => (key === OTHER_GROUP ? t('gallery.mod_group_other') : key),
    [t],
  )

  /** Every group present in the weapon's reachable mods, for the scope dropdown.
   *  Built before search so narrowing the text does not empty the filter. */
  const groupOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of mods) {
      const g = groupKeyOf(m)
      counts.set(g, (counts.get(g) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || groupLabel(a[0]).localeCompare(groupLabel(b[0])))
      .map(([key, n]) => ({ value: key, label: `${groupLabel(key)} (${n})` }))
  }, [mods, groupLabel])

  /** Powers actually present in this weapon's sights, so the control never offers
   *  a magnification that would return nothing. */
  const zoomOptions = useMemo(() => {
    const powers = new Set<number>()
    let anyVariable = false
    let anyNonMagnifying = false
    for (const m of mods) {
      if (m.zoom_min == null || m.zoom_max == null) continue
      powers.add(m.zoom_min)
      powers.add(m.zoom_max)
      if (m.zoom_min !== m.zoom_max) anyVariable = true
      if (m.zoom_max <= 1) anyNonMagnifying = true
    }
    // "1x" means non-magnifying sights only (see the filter below), so the low
    // end of a 1-6x must not conjure a 1x option that then matches nothing.
    if (!anyNonMagnifying) powers.delete(1)
    if (powers.size === 0) return []
    const opts = [...powers]
      .sort((a, b) => a - b)
      .map(p => ({ value: String(p), label: `${fmtPower(p)}x` }))
    if (anyVariable) opts.push({ value: 'variable', label: t('gallery.zoom_variable') })
    return opts
  }, [mods, t])

  // The scope survives closing the modal (you are usually coming back to the same
  // category) and therefore also survives a weapon change, where it may name a
  // group or power the new weapon does not have. Rather than reset state from an
  // effect, a filter only applies while it is still one of the options -- so it
  // cannot empty the grid, and it comes back if the old weapon does.
  const activeGroup = groupFilter != null && groupOptions.some(o => o.value === groupFilter) ? groupFilter : null
  const activeZoom = zoomFilter != null && zoomOptions.some(o => o.value === zoomFilter) ? zoomFilter : null

  const groups = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    const matched = mods.filter(m => {
      if (activeGroup && groupKeyOf(m) !== activeGroup) return false
      if (activeZoom) {
        const lo = m.zoom_min
        const hi = m.zoom_max
        if (lo == null || hi == null) return false
        // "1x" is the exception: it means non-magnifying sights (red dots,
        // irons), so a 1-6x stays out of it. Every other power matches any sight
        // whose range reaches it, so a 2-7x shows under 2x, 4x and 7x alike.
        if (activeZoom === '1') {
          if (hi > 1) return false
        } else if (activeZoom === 'variable') {
          if (lo === hi) return false
        } else {
          const want = Number(activeZoom)
          if (!(lo <= want && want <= hi)) return false
        }
      }
      if (!q) return true
      return m.name.toLowerCase().includes(q)
    })

    const byGroup = new Map<string, ModInfo[]>()
    for (const m of matched) {
      const g = groupKeyOf(m)
      const list = byGroup.get(g)
      if (list) list.push(m)
      else byGroup.set(g, [m])
    }

    // Every category keeps its own header, however small. Folding the small ones
    // into "Other" buried real slots -- a weapon with only two barrels still has
    // a Barrels category -- and contradicted the card meta, which named the true
    // category anyway. Size-descending order already sinks them to the bottom.
    const kept = [...byGroup.entries()].map(([key, list]) => ({ key, mods: list }))
    kept.sort((a, b) => b.mods.length - a.mods.length || a.key.localeCompare(b.key))
    for (const g of kept) g.mods.sort((a, b) => a.name.localeCompare(b.name))
    return kept
  }, [mods, deferredSearch, activeGroup, activeZoom])

  const total = groups.reduce((n, g) => n + g.mods.length, 0)
  const staggerKey = `${deferredSearch}|${activeGroup ?? ''}|${activeZoom ?? ''}`

  useCardProximityEffect(scrollEl, [staggerKey, open, mods])

  // Matches WeaponGallery: changing the scope returns you to the top.
  useEffect(() => {
    scrollEl?.scrollTo({ top: 0 })
  }, [scrollEl, staggerKey])

  const vars = galleryVars(token)
  const banLabel = t('gallery.mod_ban')
  const unbanLabel = t('gallery.mod_unban')
  const blockedTitle = t('gallery.mod_blocked')

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width="min(1280px, 94vw)"
      centered
      destroyOnHidden
      title={
        <Space>
          <span>{t('gallery.mods_title')}</span>
          <Typography.Text type="secondary" style={{ fontWeight: 400, fontSize: 13 }}>
            {t('gallery.mods_count', { count: total })}
          </Typography.Text>
        </Space>
      }
      footer={
        <Space>
          <Button
            danger
            disabled={includedIds.length === 0 && excludedIds.length === 0}
            onClick={onClearAll}
          >
            {t('gallery.clear_all')}
          </Button>
          {blockedIds.size > 0 && (
            <Typography.Text type="secondary">
              {t('gallery.mods_blocked_count', { count: blockedIds.size })}
            </Typography.Text>
          )}
          <Typography.Text type="secondary">
            {t('gallery.mods_selected', {
              included: includedIds.length,
              excluded: excludedIds.length,
            })}
          </Typography.Text>
          <Button type="primary" onClick={onClose}>
            {t('gallery.done')}
          </Button>
        </Space>
      }
      styles={{ body: { display: 'flex', flexDirection: 'column', height: '72vh', minHeight: 0 } }}
    >
      <div className="wg-root" style={{ ...vars, flex: 1, minHeight: 0 }}>
        <div className="wg-toolbar">
          <Input
            allowClear
            autoFocus
            prefix={<SearchOutlined />}
            placeholder={t('gallery.mods_search_placeholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            value={activeGroup}
            onChange={v => setGroupFilter(v ?? null)}
            placeholder={t('gallery.mod_category')}
            options={groupOptions}
            style={{ minWidth: 220 }}
          />
          {zoomOptions.length > 0 && (
            <Select
              allowClear
              value={activeZoom}
              onChange={v => setZoomFilter(v ?? null)}
              placeholder={t('gallery.zoom')}
              options={zoomOptions}
              style={{ minWidth: 120 }}
            />
          )}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('gallery.mods_hint')}
          </Typography.Text>
        </div>

        <div className="wg-scroll" ref={setScrollEl} style={{ flex: 1, minHeight: 0 }}>
          {total === 0 ? (
            <Empty
              description={loading ? t('gallery.mods_loading') : t('gallery.no_match')}
              style={{ marginTop: 48 }}
            >
              {!loading && (
                <Button
                  onClick={() => {
                    setSearch('')
                    setGroupFilter(null)
                    setZoomFilter(null)
                  }}
                >
                  {t('gallery.clear_filters')}
                </Button>
              )}
            </Empty>
          ) : (
            groups.map(group => (
              <div className="wg-grid" key={`${staggerKey}:${group.key}`}>
                <div className="wg-group-header">
                  {groupLabel(group.key)}
                  <span className="wg-group-count">{group.mods.length}</span>
                </div>
                {group.mods.map((mod, i) => {
                  const state = includedSet.has(mod.id)
                    ? 'on'
                    : excludedSet.has(mod.id)
                      ? 'off'
                      : 'none'
                  const isBlocked = blockedIds.has(mod.id)
                  // Same element in the same place whether or not it is blocked.
                  // Wrapping only the blocked ones in a Tooltip changed the
                  // element type, so every card that became blocked remounted
                  // and replayed its entrance.
                  return (
                    <GalleryCard
                      key={mod.id}
                      itemId={mod.id}
                      name={mod.name}
                      image={mod.icon}
                      index={i}
                      state={state}
                      meta={zoomLabel(mod)}
                      showBadge
                      blocked={isBlocked}
                      title={isBlocked ? blockedTitle : undefined}
                      onPick={isBlocked ? undefined : onToggleInclude}
                      onAction={onToggleExclude}
                      actionLabel={state === 'off' ? unbanLabel : banLabel}
                    />
                  )
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  )
}
