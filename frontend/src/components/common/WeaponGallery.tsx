import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App as AntApp, Button, Empty, Input, Modal, Segmented, Select, Space, Typography, theme } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import type { Gun } from '../../api/client'
import { caliberLabel, caliberRank, categoryRank } from './caliberLabels'
import { GalleryCard } from './GalleryCard'
import { galleryVars, useCardProximityEffect } from './galleryEffects'
import './WeaponGallery.css'

const { useToken } = theme

type GroupMode = 'caliber' | 'category'

/** Group "select all" past this many weapons needs a confirm: a precise
 *  comparison is ~11 solves per weapon at ~21s each. */
const SELECT_ALL_WARN_AT = 12

interface WeaponGalleryProps {
  open: boolean
  onClose: () => void
  guns: Gun[]
  /** Explore picks several weapons; Optimize picks one and closes. */
  multiple?: boolean
  selectedIds: string[]
  /** Single mode: called with the picked id. Multi mode: called to toggle an id. */
  onPick: (id: string) => void
  /** Multi mode bulk apply, so a whole group lands in one state update. */
  onPickMany?: (ids: string[], select: boolean) => void
  /** Multi mode: drop every pick at once. */
  onClearAll?: () => void
  maxCount?: number
}

export function WeaponGallery({
  open,
  onClose,
  guns,
  multiple = false,
  selectedIds,
  onPick,
  onPickMany,
  onClearAll,
  maxCount,
}: WeaponGalleryProps) {
  const { t } = useTranslation()
  const { token } = useToken()
  // Static Modal.confirm renders outside the ConfigProvider tree and so ignores
  // the active theme -- it comes up in default light on a dark app. The App
  // instance is themed.
  const { modal } = AntApp.useApp()
  const [search, setSearch] = useState('')
  const [groupMode, setGroupMode] = useState<GroupMode>('caliber')
  // Caliber/class narrowing lives here rather than in the sidebar: it is a way of
  // reading this grid, not app state, so it must not disturb the current pick.
  const [caliberFilter, setCaliberFilter] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)

  const atLimit = maxCount != null && selectedIds.length >= maxCount
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matched = guns.filter(g => {
      if (caliberFilter && caliberLabel(g.caliber) !== caliberFilter) return false
      if (categoryFilter && g.category !== categoryFilter) return false
      if (!q) return true
      return (
        g.name.toLowerCase().includes(q) ||
        g.caliber.toLowerCase().includes(q) ||
        caliberLabel(g.caliber).toLowerCase().includes(q) ||
        g.category.toLowerCase().includes(q)
      )
    })
    const bucket = new Map<string, Gun[]>()
    for (const gun of matched) {
      const key = (groupMode === 'caliber' ? caliberLabel(gun.caliber) : gun.category) || '—'
      const list = bucket.get(key)
      if (list) list.push(gun)
      else bucket.set(key, [gun])
    }
    const rank = groupMode === 'caliber' ? caliberRank : categoryRank
    return Array.from(bucket.entries())
      .map(([name, list]) => ({
        name,
        guns: [...list].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
  }, [guns, search, groupMode, caliberFilter, categoryFilter])

  const total = groups.reduce((n, g) => n + g.guns.length, 0)

  const caliberOptions = useMemo(() => {
    const labels = [...new Set(guns.map(g => caliberLabel(g.caliber)))]
    return labels
      .sort((a, b) => caliberRank(a) - caliberRank(b) || a.localeCompare(b))
      .map(value => ({ value, label: value }))
  }, [guns])

  const categoryOptions = useMemo(() => {
    const names = [...new Set(guns.map(g => g.category))].filter(Boolean)
    return names
      .sort((a, b) => categoryRank(a) - categoryRank(b) || a.localeCompare(b))
      .map(value => ({ value, label: value }))
  }, [guns])

  // Stagger only when the whole list changes shape, not on every selection.
  const staggerKey = `${groupMode}:${search}:${caliberFilter ?? ''}:${categoryFilter ?? ''}`
  useCardProximityEffect(scrollEl, [staggerKey, guns])

  useEffect(() => {
    scrollEl?.scrollTo({ top: 0 })
  }, [scrollEl, staggerKey])

  const handlePick = (id: string) => {
    if (multiple && atLimit && !selectedIds.includes(id)) return
    onPick(id)
    if (!multiple) onClose()
  }

  const vars = galleryVars(token)

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width="min(1280px, 94vw)"
      centered
      destroyOnHidden
      title={
        <Space>
          <span>{t('gallery.title')}</span>
          <Typography.Text type="secondary" style={{ fontWeight: 400, fontSize: 13 }}>
            {t('gallery.count', { count: total })}
          </Typography.Text>
        </Space>
      }
      footer={
        multiple ? (
          <Space>
            {onClearAll && (
              <Button danger disabled={selectedIds.length === 0} onClick={onClearAll}>
                {t('gallery.clear_all')}
              </Button>
            )}
            <Typography.Text type="secondary">
              {maxCount == null
                ? t('gallery.selected_count_nomax', { count: selectedIds.length })
                : t('gallery.selected_count', {
                    count: selectedIds.length,
                    max: maxCount,
                  })}
            </Typography.Text>
            <Button type="primary" onClick={onClose}>
              {t('gallery.done')}
            </Button>
          </Space>
        ) : null
      }
      styles={{ body: { display: 'flex', flexDirection: 'column', height: '72vh', minHeight: 0 } }}
    >
      <div className="wg-root" style={{ ...vars, flex: 1, minHeight: 0 }}>
        <div className="wg-toolbar">
          <Input
            allowClear
            autoFocus
            prefix={<SearchOutlined />}
            placeholder={t('gallery.search_placeholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <Select
            allowClear
            value={categoryFilter}
            onChange={v => setCategoryFilter(v ?? null)}
            placeholder={t('ui.weapon_category')}
            options={categoryOptions}
            style={{ minWidth: 150 }}
          />
          <Select
            allowClear
            value={caliberFilter}
            onChange={v => setCaliberFilter(v ?? null)}
            placeholder={t('ui.caliber_type')}
            options={caliberOptions}
            style={{ minWidth: 130 }}
          />
          <Segmented<GroupMode>
            value={groupMode}
            onChange={setGroupMode}
            options={[
              { label: t('gallery.by_caliber'), value: 'caliber' },
              { label: t('gallery.by_category'), value: 'category' },
            ]}
          />
        </div>

        <div className="wg-scroll" ref={setScrollEl} style={{ flex: 1, minHeight: 0 }}>
          {total === 0 ? (
            <Empty description={t('gallery.no_match')} style={{ marginTop: 48 }}>
              <Button
                onClick={() => {
                  setSearch('')
                  setCaliberFilter(null)
                  setCategoryFilter(null)
                }}
              >
                {t('gallery.clear_filters')}
              </Button>
            </Empty>
          ) : (
            groups.map(group => (
              <div className="wg-grid" key={`${staggerKey}:${group.name}`}>
                <div className="wg-group-header">
                  {group.name}
                  <span className="wg-group-count">{group.guns.length}</span>
                  {multiple && onPickMany && (
                    <Button
                      size="small"
                      type="link"
                      className="wg-group-action"
                      onClick={() => {
                        const ids = group.guns.map(g => g.id)
                        const allSelected = ids.every(id => selectedSet.has(id))
                        if (allSelected) {
                          onPickMany(ids, false)
                          return
                        }
                        const nextCount = new Set([...selectedIds, ...ids]).size
                        if (nextCount > SELECT_ALL_WARN_AT) {
                          modal.confirm({
                            title: t('gallery.select_all_confirm_title'),
                            content: t('gallery.select_all_confirm', { count: nextCount }),
                            okText: t('gallery.select_all'),
                            onOk: () => onPickMany(ids, true),
                          })
                          return
                        }
                        onPickMany(ids, true)
                      }}
                    >
                      {group.guns.every(g => selectedSet.has(g.id))
                        ? t('gallery.deselect_all')
                        : t('gallery.select_all')}
                    </Button>
                  )}
                </div>
                {group.guns.map((gun, i) => {
                  const selected = selectedSet.has(gun.id)
                  return (
                    <GalleryCard
                      key={gun.id}
                      itemId={gun.id}
                      name={gun.name}
                      image={gun.image}
                      index={i}
                      state={selected ? 'on' : 'none'}
                      blocked={multiple && atLimit && !selected}
                      meta={groupMode === 'caliber' ? gun.category : caliberLabel(gun.caliber)}
                      showBadge={multiple}
                      onPick={handlePick}
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
