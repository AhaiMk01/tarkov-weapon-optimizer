import { SettingOutlined, LockOutlined, UnlockOutlined, StopOutlined } from '@ant-design/icons'
import { Tag, Typography, theme, App, Tooltip, Button } from 'antd'
import { useTranslation } from 'react-i18next'
import type { ItemDetail } from '../api/client'

const { Text } = Typography
const { useToken } = theme


const base = import.meta.env.BASE_URL || '/'
const traderIcons: Record<string, { icon: string; name: string }> = {
  'prapor': { icon: base + 'traders/prapor.webp', name: 'Prapor' },
  'therapist': { icon: base + 'traders/therapist.webp', name: 'Therapist' },
  'fence': { icon: base + 'traders/fence.webp', name: 'Fence' },
  'skier': { icon: base + 'traders/skier.webp', name: 'Skier' },
  'peacekeeper': { icon: base + 'traders/peacekeeper.webp', name: 'Peacekeeper' },
  'mechanic': { icon: base + 'traders/mechanic.webp', name: 'Mechanic' },
  'ragman': { icon: base + 'traders/ragman.webp', name: 'Ragman' },
  'jaeger': { icon: base + 'traders/jaeger.webp', name: 'Jaeger' },
  'lightkeeper': { icon: base + 'traders/lightkeeper.webp', name: 'Lightkeeper' },
  'ref': { icon: base + 'traders/ref.webp', name: 'Ref' },
  'fleamarket': { icon: base + 'traders/flea-market-portrait.png', name: 'Flea Market' },
}

type BarterReq = { name: string; count: number; unit_price: number; icon?: string }

function BarterTooltip({ requirements, children }: { requirements?: BarterReq[]; children: React.ReactElement }) {
  if (!requirements?.length) return children
  const lines = requirements.map((r, i) => (
    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
      {r.icon && <img src={r.icon} alt="" style={{ width: 24, height: 24, objectFit: 'contain', flexShrink: 0 }} />}
      <span>{r.count}x {r.name} — ₽{r.unit_price.toLocaleString()}{r.count > 1 ? ` (₽${(r.count * r.unit_price).toLocaleString()})` : ''}</span>
    </div>
  ))
  const total = requirements.reduce((s, r) => s + r.count * r.unit_price, 0)
  return (
    <Tooltip title={<div style={{ fontSize: 12 }}><div style={{ fontWeight: 600, marginBottom: 4 }}>Barter requirements:</div>{lines}<div style={{ marginTop: 4, borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: 4 }}>Total: ₽{total.toLocaleString()}</div></div>}>
      {children}
    </Tooltip>
  )
}

export function TraderIcon({ source, unknownLabel: _unknownLabel, compact, barterRequirements }: { source: string | undefined; unknownLabel: string; compact?: boolean; barterRequirements?: BarterReq[] }) {
  if (!source) return <Text type="secondary" style={compact ? { minWidth: 80 } : undefined}>—</Text>
  if (source === 'not_purchasable') {
    const label = compact ? 'Unlisted' : 'Not on market'
    return (
      <Text
        type="secondary"
        style={compact ? { minWidth: 80 } : undefined}
        title="Tarkov.dev has no trader/flea buy row for this item — optimizer uses a reference price only; in-game it may be barter, craft, FiR, events, or API incomplete."
      >
        {label}
      </Text>
    )
  }
  if (source.startsWith('barter:')) {
    const traderKey = source.replace('barter:', '').toLowerCase().replace(/\s+/g, '')
    const trader = traderIcons[traderKey]
    const traderName = trader?.name || source.replace('barter:', '')
    if (compact) {
      return <BarterTooltip requirements={barterRequirements}><Text type="secondary" style={{ minWidth: 80, cursor: barterRequirements?.length ? 'help' : undefined }}>{traderName} (B)</Text></BarterTooltip>
    }
    if (trader?.icon) {
      return (
        <BarterTooltip requirements={barterRequirements}>
          <div style={{ position: 'relative', display: 'inline-block', cursor: barterRequirements?.length ? 'help' : undefined }}>
            <img
              src={trader.icon}
              alt={traderName}
              style={{ width: 64, height: 64, borderRadius: 4, objectFit: 'cover' }}
            />
            <span style={{
              position: 'absolute', bottom: 0, right: 0,
              background: '#faad14', color: '#000', fontSize: 10, fontWeight: 700,
              borderRadius: '4px 0 4px 0', padding: '1px 4px', lineHeight: 1.2,
            }}>B</span>
          </div>
        </BarterTooltip>
      )
    }
    return <BarterTooltip requirements={barterRequirements}><Text type="secondary" style={{ cursor: barterRequirements?.length ? 'help' : undefined }}>{traderName} (Barter)</Text></BarterTooltip>
  }
  const key = source.toLowerCase().replace(/\s+/g, '')
  const trader = traderIcons[key]
  if (compact) {
    return <Text type="secondary" style={{ minWidth: 80 }}>{trader?.name || source}</Text>
  }
  if (trader?.icon) {
    return (
      <img
        src={trader.icon}
        alt={trader.name}
        title={trader.name}
        style={{ width: 64, height: 64, borderRadius: 4, objectFit: 'cover' }}
      />
    )
  }
  return <Text type="secondary">{source}</Text>
}

function ItemTooltip({ item, children }: { item: ItemDetail; children: React.ReactElement }) {
  const lines: React.ReactNode[] = []
  if (item.capacity) lines.push(<div key="cap">Capacity: {item.capacity} rounds</div>)
  const tooltipImg = item.image_large ?? item.icon
  if (!lines.length && !tooltipImg) return children
  const content = (
    <div style={{ fontSize: 12 }}>
      {tooltipImg && <img src={tooltipImg} alt="" style={{ width: 200, height: 140, objectFit: 'contain', display: 'block', margin: '0 auto 6px' }} />}
      {lines}
    </div>
  )
  return <Tooltip title={content} overlayStyle={{ maxWidth: 240 }}>{children}</Tooltip>
}

interface ItemRowProps {
  item: ItemDetail
  hidePrice?: boolean
  compactMode?: boolean
  lockedIds?: string[]
  excludedIds?: string[]
  onToggleLock?: (id: string) => void
  onToggleExclude?: (id: string) => void
}

export function ItemRow({ item, hidePrice = false, compactMode = false, lockedIds, excludedIds, onToggleLock, onToggleExclude }: ItemRowProps) {
  const { t } = useTranslation()
  const { token } = useToken()
  const { message } = App.useApp()
  const copyToClipboard = (text: string) => {
    const successMsg = t('toast.copied')
    const failMsg = t('toast.copy_failed')
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        message.success(successMsg)
      }).catch(() => {
        fallbackCopy(text)
      })
    } else {
      fallbackCopy(text)
    }
    function fallbackCopy(txt: string) {
      const textArea = document.createElement('textarea')
      textArea.value = txt
      textArea.style.position = 'fixed'
      textArea.style.left = '-9999px'
      document.body.appendChild(textArea)
      textArea.select()
      try {
        document.execCommand('copy')
        message.success(successMsg)
      } catch {
        message.error(failMsg)
      }
      document.body.removeChild(textArea)
    }
  }
  const truncateStyle = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }
  const clickableStyle = { cursor: 'pointer' }
  const tagStyle = { margin: 0, minWidth: 90, textAlign: 'center' as const }
  const ergoLabel = t('item.ergo')
  const recoilLabel = t('item.recoil')
  const unknownLabel = t('ui.unknown')
  const isLocked = lockedIds?.includes(item.id) ?? false
  const isExcluded = excludedIds?.includes(item.id) ?? false
  const hasActions = !!(onToggleLock || onToggleExclude)
  const actionBtns = hasActions ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flexShrink: 0 }}>
      {onToggleLock && (
        <Tooltip title={isLocked ? 'Unlock (remove from required)' : 'Lock (require in next build)'}>
          <Button
            type={isLocked ? 'primary' : 'text'}
            size="small"
            icon={isLocked ? <LockOutlined /> : <UnlockOutlined />}
            onClick={() => onToggleLock(item.id)}
            style={{ padding: '0 4px', ...(isLocked ? {} : { color: token.colorTextSecondary }) }}
          />
        </Tooltip>
      )}
      {onToggleExclude && (
        <Tooltip title={isExcluded ? 'Unban (remove from excluded)' : 'Ban (exclude from next build)'}>
          <Button
            type={isExcluded ? 'primary' : 'text'}
            danger={isExcluded}
            size="small"
            icon={<StopOutlined />}
            onClick={() => onToggleExclude(item.id)}
            style={{ padding: '0 4px', ...(isExcluded ? {} : { color: token.colorTextSecondary }) }}
          />
        </Tooltip>
      )}
    </div>
  ) : null
  const hasTags = item.ergonomics !== 0 || item.recoil_modifier !== 0 || !!item.accuracy_modifier || !!item.sighting_range

  if (compactMode) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 8px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
        {actionBtns}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text strong style={{ fontSize: 12, ...truncateStyle, ...clickableStyle }} title={item.name} onClick={() => copyToClipboard(item.name)}>{item.name}</Text>
        </div>
        {item.ergonomics !== 0 && <Tag color={item.ergonomics > 0 ? 'blue' : 'red'} style={{ margin: 0, fontSize: 11 }}>{ergoLabel}: {item.ergonomics > 0 ? '+' : ''}{item.ergonomics}</Tag>}
        {item.recoil_modifier !== 0 && <Tag color={item.recoil_modifier < 0 ? 'green' : 'red'} style={{ margin: 0, fontSize: 11 }}>{recoilLabel}: {(item.recoil_modifier * 100).toFixed(1)}%</Tag>}
        <div style={{ width: 64, textAlign: 'center', flexShrink: 0 }}>
          <TraderIcon source={item.source} unknownLabel={unknownLabel} compact barterRequirements={item.barter_requirements} />
        </div>
        {!hidePrice && <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap', minWidth: 60, textAlign: 'right' }}>{priceCell(item)}</Text>}
      </div>
    )
  }

  return (
    <div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 8, padding: '8px 12px', background: token.colorBgElevated, display: 'flex', gap: 10, alignItems: 'center' }}>
      {actionBtns}
      <ItemTooltip item={item}>
        <div style={{ width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, background: token.colorFillQuaternary, borderRadius: 4 }}>
          {item.icon ? (
            <img src={item.icon} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <SettingOutlined style={{ fontSize: 24, color: token.colorTextQuaternary }} />
          )}
        </div>
      </ItemTooltip>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text strong style={{ display: 'block', fontSize: 13, ...truncateStyle, ...clickableStyle }} title={item.name} onClick={() => copyToClipboard(item.name)}>{item.name}</Text>
        {item.category && <Text type="secondary" style={{ fontSize: 11, ...truncateStyle, display: 'block' }}>{item.category}</Text>}
        {hasTags && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
            {item.ergonomics !== 0 && <Tag color={item.ergonomics > 0 ? 'blue' : 'red'} style={tagStyle}>{ergoLabel}: {item.ergonomics > 0 ? '+' : ''}{item.ergonomics}</Tag>}
            {item.recoil_modifier !== 0 && <Tag color={item.recoil_modifier < 0 ? 'green' : 'red'} style={tagStyle}>{recoilLabel}: {item.recoil_modifier > 0 ? '+' : ''}{(item.recoil_modifier * 100).toFixed(1)}%</Tag>}
            {!!item.accuracy_modifier && <Tag color={item.accuracy_modifier > 0 ? 'green' : 'red'} style={tagStyle}>Acc: {item.accuracy_modifier > 0 ? '+' : ''}{item.accuracy_modifier}%</Tag>}
            {!!item.sighting_range && <Tag color="purple" style={tagStyle}>Sight: {item.sighting_range}m</Tag>}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <div style={{ width: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <TraderIcon source={item.source} unknownLabel={unknownLabel} barterRequirements={item.barter_requirements} />
        </div>
        <div style={{ width: 70, textAlign: 'right' }}>{item.weight ? <Tag color="cyan" style={{ margin: 0 }}>{item.weight.toFixed(2)} kg</Tag> : null}</div>
        {!hidePrice && <div style={{ width: 90, textAlign: 'right' }}><Tag color="gold" style={{ margin: 0, fontWeight: 600 }}>{priceCell(item)}</Tag></div>}
      </div>
    </div>
  )
}

function priceCell(item: ItemDetail) {
  if (item.purchasable === false && item.reference_price_rub != null && item.reference_price_rub > 0) {
    return (
      <span title="BSG reference only — not counted in build price">
        0 <Text type="secondary">(ref ₽{item.reference_price_rub.toLocaleString()})</Text>
      </span>
    )
  }
  if (item.purchasable === false) {
    return <span title="Not counted in build price">0</span>
  }
  return `₽${item.price.toLocaleString()}`
}
