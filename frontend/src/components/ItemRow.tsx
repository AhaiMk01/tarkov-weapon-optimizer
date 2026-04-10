import { SettingOutlined } from '@ant-design/icons'
import { Tag, Typography, theme, App, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import type { ItemDetail } from '../api/client'

const { Text } = Typography
const { useToken } = theme

/** Grid track for per-item price (locale-formatted ₽ can be wide; ref lines need more room) */
const PRICE_COLUMN = 'minmax(11rem, max-content)'
const priceCellWrapStyle = { textAlign: 'right' as const, whiteSpace: 'nowrap' as const, justifySelf: 'end' as const }

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
      {r.icon && <img src={r.icon} alt="" style={{ width: 24, height: 24, objectFit: 'contain', flexShrink: 0, background: 'rgba(255,255,255,0.08)', borderRadius: 2 }} />}
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
  if (item.category) lines.push(<div key="cat" style={{ fontWeight: 600, marginBottom: 2 }}>{item.category}</div>)
  if (item.weight) lines.push(<div key="w">Weight: {item.weight.toFixed(2)} kg</div>)
  if (item.accuracy_modifier) lines.push(<div key="acc">Accuracy (MOA): {item.accuracy_modifier > 0 ? '+' : ''}{item.accuracy_modifier}%</div>)
  if (item.capacity) lines.push(<div key="cap">Capacity: {item.capacity} rounds</div>)
  if (item.sighting_range) lines.push(<div key="sr">Sighting range: {item.sighting_range}m</div>)
  const tooltipImg = item.image_large ?? item.icon
  if (!lines.length && !tooltipImg) return children
  const content = (
    <div style={{ fontSize: 12 }}>
      {tooltipImg && <img src={tooltipImg} alt="" style={{ width: 128, height: 128, objectFit: 'contain', display: 'block', margin: '0 auto 6px', background: 'rgba(255,255,255,0.06)', borderRadius: 4 }} />}
      {lines}
    </div>
  )
  return <Tooltip title={content}>{children}</Tooltip>
}

interface ItemRowProps {
  item: ItemDetail
  hidePrice?: boolean
  compactMode?: boolean
}

export function ItemRow({ item, hidePrice = false, compactMode = false }: ItemRowProps) {
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
  if (compactMode) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: `1fr auto auto ${PRICE_COLUMN}`, gap: 8, padding: '8px 16px', alignItems: 'center', minWidth: 520 }}>
        <div style={{ minWidth: 200 }}>
          <ItemTooltip item={item}>
            <Text strong style={{ display: 'block', ...truncateStyle, ...clickableStyle }} onClick={() => copyToClipboard(item.name)}>{item.name}</Text>
          </ItemTooltip>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {item.ergonomics !== 0 && (
            <Tag color={item.ergonomics > 0 ? 'blue' : 'red'} style={tagStyle}>
              {ergoLabel}: {item.ergonomics > 0 ? '+' : ''}{item.ergonomics}
            </Tag>
          )}
          {item.recoil_modifier !== 0 && (
            <Tag color={item.recoil_modifier < 0 ? 'green' : 'red'} style={tagStyle}>
              {recoilLabel}: {item.recoil_modifier > 0 ? '+' : ''}{(item.recoil_modifier * 100).toFixed(1)}%
            </Tag>
          )}
        </div>
        <TraderIcon source={item.source} unknownLabel={unknownLabel} compact barterRequirements={item.barter_requirements} />
        <Text type="secondary" style={priceCellWrapStyle}>
          {hidePrice ? '-' : priceCell(item)}
        </Text>
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `64px 1fr auto 64px ${PRICE_COLUMN}`, gap: 8, padding: 16, alignItems: 'center', minWidth: 560 }}>
      <ItemTooltip item={item}>
        <div style={{ width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
          {item.icon ? (
            <img src={item.icon} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <SettingOutlined style={{ fontSize: 24, color: token.colorTextQuaternary }} />
          )}
        </div>
      </ItemTooltip>
      <div style={{ minWidth: 200 }}>
        <ItemTooltip item={item}>
          <Text strong style={{ display: 'block', ...truncateStyle, ...clickableStyle }} onClick={() => copyToClipboard(item.name)}>{item.name}</Text>
        </ItemTooltip>
        <Text type="secondary" style={{ fontSize: 12, ...truncateStyle, ...clickableStyle }} title={item.id} onClick={() => copyToClipboard(item.id)}>ID: {item.id}</Text>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {item.ergonomics !== 0 && (
          <Tag color={item.ergonomics > 0 ? 'blue' : 'red'} style={tagStyle}>
            {ergoLabel}: {item.ergonomics > 0 ? '+' : ''}{item.ergonomics}
          </Tag>
        )}
        {item.recoil_modifier !== 0 && (
          <Tag color={item.recoil_modifier < 0 ? 'green' : 'red'} style={tagStyle}>
            {recoilLabel}: {item.recoil_modifier > 0 ? '+' : ''}{(item.recoil_modifier * 100).toFixed(1)}%
          </Tag>
        )}
        {item.ergonomics === 0 && item.recoil_modifier === 0 && <Text type="secondary">-</Text>}
      </div>
      <TraderIcon source={item.source} unknownLabel={unknownLabel} barterRequirements={item.barter_requirements} />
      <Text type="secondary" style={priceCellWrapStyle}>
        {hidePrice ? '-' : priceCell(item)}
      </Text>
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
