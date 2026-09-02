import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App as AntApp, Button, Empty, Input, Modal, Segmented, Select, Space, Typography, theme } from 'antd'
import { CheckOutlined, SearchOutlined } from '@ant-design/icons'
import type { Gun } from '../../api/client'
import { caliberLabel, caliberRank, categoryRank } from './caliberLabels'
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

/** antd tokens are hex; fall back to the raw string for anything else. */
function rgba(color: string, alpha: number): string {
  const hex = color.trim()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex)
  const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  let r: number, g: number, b: number
  if (short) {
    r = parseInt(short[1] + short[1], 16)
    g = parseInt(short[2] + short[2], 16)
    b = parseInt(short[3] + short[3], 16)
  } else if (full) {
    r = parseInt(full[1], 16)
    g = parseInt(full[2], 16)
    b = parseInt(full[3], 16)
  } else {
    return color
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function isDarkColor(color: string): boolean {
  const rgb = rgba(color, 1)
  const m = /rgba?\((\d+), (\d+), (\d+)/.exec(rgb)
  if (!m) return false
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128
}

/**
 * Cursor-tracked spotlight + 3D tilt, driven from one rAF-throttled listener on
 * the scroll container. Rects are cached because reading them per card per frame
 * is what makes this kind of effect drop frames on a 200-card grid; they are
 * invalidated on scroll and on any change to the rendered list.
 *
 * Takes the scroll node itself rather than a ref: antd mounts the modal's portal
 * content in a later render than the one that flips `open`, so an effect keyed on
 * a ref object binds to a null root once and never re-runs. A callback ref stored
 * in state re-renders when the node actually appears.
 */
function useCardProximityEffect(root: HTMLDivElement | null, deps: unknown[]) {
  const cardsRef = useRef<{ card: HTMLElement; rect: DOMRect | null; lit: boolean }[]>([])
  const rafHandle = useRef<number | null>(null)
  const tiltedRef = useRef<HTMLElement | null>(null)

  const measure = useCallback(() => {
    for (const entry of cardsRef.current) entry.rect = entry.card.getBoundingClientRect()
  }, [])

  useLayoutEffect(() => {
    if (!root) return
    const cards = Array.from(root.querySelectorAll<HTMLElement>('.wg-card'))
    cardsRef.current = cards.map(card => ({ card, rect: null, lit: false }))
    measure()

    // Gates the loading shimmer to cards near the viewport, matching what the
    // lazy <img> is actually doing.
    const io = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          entry.target.classList.toggle('wg-in-view', entry.isIntersecting)
        }
      },
      { root, rootMargin: '200px' },
    )
    for (const card of cards) io.observe(card)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, measure, ...deps])

  useEffect(() => {
    if (!root) return
    if (window.matchMedia('(hover: none)').matches) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const MAX_TILT = 7
    const PERSPECTIVE = 1000
    const IMG_SHIFT = 6
    const SHADOW_SHIFT = 11
    const RANGE = 240

    const springBack = (card: HTMLElement) => {
      card.style.transition = 'border-color 0.15s ease, transform 0.6s ease-out'
      card.style.removeProperty('transform')
      const onDone = (e: TransitionEvent) => {
        if (e.propertyName !== 'transform') return
        card.removeEventListener('transitionend', onDone)
        card.style.removeProperty('transition')
      }
      card.addEventListener('transitionend', onDone)
      const settle = (el: HTMLElement | null, dur: string) => {
        if (!el) return
        el.style.transition = `opacity 0.3s ease, transform ${dur} ease-out`
        el.style.removeProperty('transform')
        el.addEventListener('transitionend', () => el.style.removeProperty('transition'), { once: true })
      }
      settle(card.querySelector('img'), '0.6s')
      settle(card.querySelector('.wg-card-shadow'), '0.5s')
    }

    const onMove = (e: MouseEvent) => {
      if (rafHandle.current != null) return
      rafHandle.current = requestAnimationFrame(() => {
        rafHandle.current = null
        for (const entry of cardsRef.current) {
          const { card, rect } = entry
          if (!rect) continue
          const near =
            e.clientX > rect.left - RANGE &&
            e.clientX < rect.right + RANGE &&
            e.clientY > rect.top - RANGE &&
            e.clientY < rect.bottom + RANGE
          if (near) {
            card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`)
            card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`)
            entry.lit = true
          } else if (entry.lit) {
            card.style.removeProperty('--mouse-x')
            card.style.removeProperty('--mouse-y')
            entry.lit = false
          }
        }

        const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('.wg-card') ?? null
        if (tiltedRef.current && tiltedRef.current !== target) {
          springBack(tiltedRef.current)
          tiltedRef.current = null
        }
        if (!target) return

        target.style.removeProperty('transition')
        const r = target.getBoundingClientRect()
        const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2)
        const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2)
        target.style.transform =
          `perspective(${PERSPECTIVE}px) rotateX(${(-dy * MAX_TILT).toFixed(2)}deg) ` +
          `rotateY(${(dx * MAX_TILT).toFixed(2)}deg) translateY(-2px)`

        // Gun and its contact shadow counter-drift at different rates, so the
        // card reads as layered depth rather than a flat image being rotated.
        const img = target.querySelector<HTMLElement>('img')
        if (img) {
          img.style.transition = 'filter 0.25s'
          img.style.transform = `translate3d(${(-dx * IMG_SHIFT).toFixed(2)}px, ${(-dy * IMG_SHIFT).toFixed(2)}px, 0)`
        }
        const shadow = target.querySelector<HTMLElement>('.wg-card-shadow')
        if (shadow) {
          shadow.style.transition = 'opacity 0.25s'
          shadow.style.transform = `translate3d(${(-dx * SHADOW_SHIFT).toFixed(2)}px, ${(-dy * SHADOW_SHIFT).toFixed(2)}px, 0)`
        }
        tiltedRef.current = target
      })
    }

    const onLeave = () => {
      if (tiltedRef.current) {
        springBack(tiltedRef.current)
        tiltedRef.current = null
      }
      for (const entry of cardsRef.current) {
        if (!entry.lit) continue
        entry.card.style.removeProperty('--mouse-x')
        entry.card.style.removeProperty('--mouse-y')
        entry.lit = false
      }
    }

    root.addEventListener('mousemove', onMove)
    root.addEventListener('mouseleave', onLeave)
    root.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      root.removeEventListener('mousemove', onMove)
      root.removeEventListener('mouseleave', onLeave)
      root.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      // A frame scheduled just before the gallery closed would otherwise run and
      // write styles into nodes that are already detached.
      if (rafHandle.current != null) {
        cancelAnimationFrame(rafHandle.current)
        rafHandle.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, measure, ...deps])
}

/**
 * Own component so the entrance animation runs once per mount.
 * Keeping `wg-card-entering` in the parent's className string meant that any
 * change to the selected state rewrote the attribute and restarted the
 * animation, so picking a card (or selecting a whole group) made it blink out
 * and fade back in. Holding it as state, cleared on animationend, is immune to
 * that: the class only comes back on a real remount.
 */
function GunCard({
  gun,
  index,
  selected,
  blocked,
  meta,
  showCheck,
  onPick,
}: {
  gun: Gun
  index: number
  selected: boolean
  blocked: boolean
  meta: string
  showCheck: boolean
  onPick: () => void
}) {
  const [entering, setEntering] = useState(true)
  return (
    <div
      className={`wg-card${entering ? ' wg-card-entering' : ''}${selected ? ' wg-selected' : ''}`}
      style={{
        animationDelay: entering ? `${Math.min(index, 24) * 22}ms` : undefined,
        opacity: blocked ? 0.45 : undefined,
        cursor: blocked ? 'not-allowed' : undefined,
      }}
      role="button"
      tabIndex={0}
      aria-pressed={showCheck ? selected : undefined}
      aria-label={gun.name}
      onClick={onPick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPick()
        }
      }}
      onAnimationEnd={() => setEntering(false)}
    >
      <div className="wg-card-shadow" aria-hidden="true" />
      {gun.image ? (
        <img
          src={gun.image}
          alt=""
          loading="lazy"
          onLoad={e => e.currentTarget.classList.add('wg-loaded')}
          onError={e => e.currentTarget.classList.add('wg-loaded')}
        />
      ) : (
        <div className="wg-card-img-slot" aria-hidden="true" />
      )}
      <div className="wg-name">{gun.name}</div>
      <div className="wg-meta">{meta}</div>
      <div className="wg-card-light" aria-hidden="true" />
      <div className="wg-card-corners" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      {showCheck && selected && (
        <span className="wg-check">
          <CheckOutlined />
        </span>
      )}
    </div>
  )
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

  const dark = isDarkColor(token.colorBgBase)
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

  const handlePick = (gun: Gun) => {
    if (multiple && atLimit && !selectedIds.includes(gun.id)) return
    onPick(gun.id)
    if (!multiple) onClose()
  }

  const vars = {
    '--wg-accent': token.colorPrimary,
    '--wg-accent-ring': rgba(token.colorPrimary, 0.75),
    '--wg-on-accent': token.colorWhite,
    '--wg-card-bg': dark ? token.colorBgContainer : token.colorBgLayout,
    '--wg-border': token.colorBorderSecondary,
    '--wg-name': token.colorText,
    '--wg-muted': token.colorTextTertiary,
    '--wg-selected-bg': token.colorPrimaryBg,
    '--wg-scroll-bg': token.colorBgElevated,
    '--wg-card-shadow': dark
      ? '0 6px 12px -2px rgba(0, 0, 0, 0.7)'
      : '0 4px 10px -3px rgba(0, 0, 0, 0.18)',
    '--wg-card-wash': dark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
    '--wg-light-strong': dark ? 'rgba(255, 248, 224, 0.05)' : 'rgba(255, 255, 255, 0.6)',
    '--wg-light-weak': dark ? 'rgba(255, 248, 224, 0.016)' : 'rgba(255, 255, 255, 0.2)',
    '--wg-contact-shadow': dark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.22)',
    '--wg-shimmer-a': token.colorFillSecondary,
    '--wg-shimmer-b': token.colorFillTertiary,
  } as React.CSSProperties

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
                    <GunCard
                      key={gun.id}
                      gun={gun}
                      index={i}
                      selected={selected}
                      blocked={multiple && atLimit && !selected}
                      meta={groupMode === 'caliber' ? gun.category : caliberLabel(gun.caliber)}
                      showCheck={multiple}
                      onPick={() => handlePick(gun)}
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
