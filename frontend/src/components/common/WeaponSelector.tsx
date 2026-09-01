import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, Space, Tooltip, Typography, theme } from 'antd'
import { CloseOutlined, PlusOutlined } from '@ant-design/icons'
import type { Gun } from '../../api/client'
import { WeaponGallery } from './WeaponGallery'
import { caliberLabel } from './caliberLabels'

const { useToken } = theme

interface WeaponSelectorProps {
  guns: Gun[]
  selectedGunId: string
  onGunChange: (id: string) => void
  /** Explore: pick 1..n weapons in this same card. Optimize leaves this off. */
  multiple?: boolean
  selectedGunIds?: string[]
  onGunIdsChange?: (ids: string[]) => void
  maxCount?: number
  hint?: string
}

/**
 * The picked weapon doubles as the control that opens the gallery, so there is
 * no separate trigger to keep in sync with it.
 */
function SelectedRow({ gun, onOpen }: { gun: Gun; onOpen: () => void }) {
  const { token } = useToken()
  const [hover, setHover] = useState(false)
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={gun.name}
      onClick={onOpen}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 2,
        padding: '10px 8px 8px',
        cursor: 'pointer',
        border: `1px solid ${hover ? token.colorPrimary : token.colorBorderSecondary}`,
        borderRadius: token.borderRadius,
        background: hover ? token.colorPrimaryBg : token.colorFillQuaternary,
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      {gun.image && (
        <img
          src={gun.image}
          alt=""
          style={{
            width: '100%',
            height: 76,
            objectFit: 'contain',
            marginBottom: 6,
            filter: hover ? 'brightness(1.1)' : undefined,
            transition: 'filter 0.2s',
            userSelect: 'none',
            pointerEvents: 'none',
          }}
        />
      )}
      <div style={{ fontSize: 13, lineHeight: 1.3, width: '100%' }} title={gun.name}>
        {gun.name}
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        {caliberLabel(gun.caliber)}
      </Typography.Text>
    </div>
  )
}

/**
 * Square variant used when several weapons are picked at once (Explore). Stacking
 * full-width cards there costs a lot of sidebar height for what is really just a
 * set of picks, so these read as a compact tray; the name moves to a tooltip.
 */
function SelectedTile({
  gun,
  onOpen,
  onRemove,
}: {
  gun: Gun
  onOpen: () => void
  onRemove: () => void
}) {
  const { token } = useToken()
  const [hover, setHover] = useState(false)
  return (
    <Tooltip title={`${gun.name} · ${caliberLabel(gun.caliber)}`}>
      <div
        role="button"
        tabIndex={0}
        aria-label={gun.name}
        onClick={onOpen}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: 'relative',
          aspectRatio: '1 / 1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 4,
          cursor: 'pointer',
          border: `1px solid ${hover ? token.colorPrimary : token.colorBorderSecondary}`,
          borderRadius: token.borderRadius,
          background: hover ? token.colorPrimaryBg : token.colorFillQuaternary,
          transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        {gun.image && (
          <img
            src={gun.image}
            alt=""
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              filter: hover ? 'brightness(1.1)' : undefined,
              transition: 'filter 0.2s',
              userSelect: 'none',
              pointerEvents: 'none',
            }}
          />
        )}
        <Button
          size="small"
          type="text"
          icon={<CloseOutlined />}
          aria-label={`${gun.name} ✕`}
          onClick={e => {
            e.stopPropagation()
            onRemove()
          }}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 20,
            height: 20,
            minWidth: 20,
            fontSize: 10,
          }}
        />
      </div>
    </Tooltip>
  )
}

/** Square counterpart to AddSlot, so the tray stays on one grid. */
function AddTile({ label, onOpen }: { label: string; onOpen: () => void }) {
  const { token } = useToken()
  const [hover, setHover] = useState(false)
  return (
    <Tooltip title={label}>
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        onClick={onOpen}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          aspectRatio: '1 / 1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          border: `1px dashed ${hover ? token.colorPrimary : token.colorBorder}`,
          borderRadius: token.borderRadius,
          color: hover ? token.colorPrimary : token.colorTextTertiary,
          transition: 'border-color 0.15s, color 0.15s',
        }}
      >
        <PlusOutlined />
      </div>
    </Tooltip>
  )
}

/** Dashed slot shown when nothing is picked yet, or when more picks are allowed. */
function AddSlot({ label, onOpen }: { label: string; onOpen: () => void }) {
  const { token } = useToken()
  const [hover, setHover] = useState(false)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        minHeight: 46,
        cursor: 'pointer',
        border: `1px dashed ${hover ? token.colorPrimary : token.colorBorder}`,
        borderRadius: token.borderRadius,
        color: hover ? token.colorPrimary : token.colorTextTertiary,
        fontSize: 13,
        transition: 'border-color 0.15s, color 0.15s',
      }}
    >
      <PlusOutlined />
      {label}
    </div>
  )
}

export function WeaponSelector({
  guns,
  selectedGunId,
  onGunChange,
  multiple = false,
  selectedGunIds,
  onGunIdsChange,
  maxCount,
  hint,
}: WeaponSelectorProps) {
  const { t } = useTranslation()
  const [galleryOpen, setGalleryOpen] = useState(false)

  const selectedIds = multiple
    ? (selectedGunIds ?? [])
    : (selectedGunId ? [selectedGunId] : [])
  const selectedGuns = selectedIds
    .map(id => guns.find(g => g.id === id))
    .filter((g): g is Gun => g != null)
  const canAddMore = multiple && (maxCount == null || selectedIds.length < maxCount)

  const addId = (id: string) => {
    if (!id || selectedIds.includes(id)) return
    if (maxCount != null && selectedIds.length >= maxCount) return
    onGunIdsChange?.([...selectedIds, id])
  }

  const removeId = (id: string) => {
    onGunIdsChange?.(selectedIds.filter(wid => wid !== id))
  }

  // One state update for a whole group: toggling ids one at a time through
  // onGunIdsChange would read a stale selectedIds for every call after the first.
  const setMany = (ids: string[], select: boolean) => {
    if (!multiple) return
    let next = select
      ? [...new Set([...selectedIds, ...ids])]
      : selectedIds.filter(id => !ids.includes(id))
    if (maxCount != null) next = next.slice(0, maxCount)
    onGunIdsChange?.(next)
  }

  const pickFromGallery = (id: string) => {
    if (multiple) {
      if (selectedIds.includes(id)) removeId(id)
      else addId(id)
    } else {
      onGunChange(id)
    }
  }

  const clearAll = () => onGunIdsChange?.([])
  const open = () => setGalleryOpen(true)

  return (
    <Card
      title={<span style={{ userSelect: 'none' }}>{t('sidebar.select_weapon')}</span>}
      size="small"
      extra={
        multiple && selectedIds.length > 0 ? (
          <Button size="small" type="text" danger onClick={clearAll}>
            {t('gallery.clear_all')}
          </Button>
        ) : undefined
      }
    >
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        {multiple ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(78px, 1fr))',
              gap: 8,
            }}
          >
            {selectedGuns.map(gun => (
              <SelectedTile
                key={gun.id}
                gun={gun}
                onOpen={open}
                onRemove={() => removeId(gun.id)}
              />
            ))}
            {canAddMore && (
              <AddTile
                label={
                  selectedGuns.length === 0
                    ? t('gallery.nothing_selected')
                    : t('gallery.add_weapon')
                }
                onOpen={open}
              />
            )}
          </div>
        ) : (
          <>
            {selectedGuns.map(gun => (
              <SelectedRow key={gun.id} gun={gun} onOpen={open} />
            ))}
            {selectedGuns.length === 0 && (
              <AddSlot label={t('gallery.nothing_selected')} onOpen={open} />
            )}
          </>
        )}

        {multiple && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {hint ?? (maxCount == null
              ? t('gallery.selected_count_nomax', { count: selectedIds.length })
              : t('gallery.selected_count', { count: selectedIds.length, max: maxCount }))}
          </Typography.Text>
        )}
      </Space>

      <WeaponGallery
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        guns={guns}
        multiple={multiple}
        selectedIds={selectedIds}
        onPick={pickFromGallery}
        onPickMany={setMany}
        onClearAll={clearAll}
        maxCount={maxCount}
      />
    </Card>
  )
}
