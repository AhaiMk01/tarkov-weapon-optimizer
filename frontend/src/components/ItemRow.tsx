import { SettingOutlined, LockOutlined, UnlockOutlined, StopOutlined } from '@ant-design/icons'
import { Tag, Typography, theme, App, Tooltip, Button, Grid } from 'antd'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
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

export type BarterReq = { name: string; count: number; unit_price: number; icon?: string }

function BarterTooltip({ requirements, children }: { requirements?: BarterReq[]; children: React.ReactElement }) {
  if (!requirements?.length) return children
  const lines = requirements.map((r, i) => (
    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
      {r.icon && <img src={r.icon} alt="" style={{ width: 40, height: 40, objectFit: 'contain', flexShrink: 0 }} />}
      <span>{r.count}x {r.name} — ₽{r.unit_price.toLocaleString()}{r.count > 1 ? ` (₽${(r.count * r.unit_price).toLocaleString()})` : ''}</span>
    </div>
  ))
  const total = requirements.reduce((s, r) => s + r.count * r.unit_price, 0)
  const { t } = useTranslation()
  return (
    <Tooltip overlayStyle={{ maxWidth: 400 }} title={<div style={{ fontSize: 13 }}><div style={{ fontWeight: 600, marginBottom: 6 }}>{t('ui.barter_req_label')}:</div>{lines}<div style={{ marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: 6, fontWeight: 600 }}>{t('ui.total_label')}: ₽{total.toLocaleString()}</div></div>}>
      {children}
    </Tooltip>
  )
}

export function TraderIcon({ source, unknownLabel: _unknownLabel, compact, barterRequirements, size = 64 }: { source: string | undefined; unknownLabel: string; compact?: boolean; barterRequirements?: BarterReq[]; size?: number }) {
  const { t } = useTranslation()
  if (!source) return <Text type="secondary" style={compact ? { whiteSpace: 'nowrap' } : undefined}>—</Text>
  if (source === 'not_purchasable') {
    const label = compact ? t('ui.unlisted_label') : t('ui.not_on_market_label')
    return (
      <Text
        type="secondary"
        style={compact ? { whiteSpace: 'nowrap' } : undefined}
        title={t('ui.not_purchasable_tooltip')}
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
      return <BarterTooltip requirements={barterRequirements}><Text type="secondary" style={{ whiteSpace: 'nowrap', cursor: barterRequirements?.length ? 'help' : undefined }}>{traderName} ({t('ui.barter_badge_short')})</Text></BarterTooltip>
    }
    if (trader?.icon) {
      return (
        <BarterTooltip requirements={barterRequirements}>
          <div style={{ position: 'relative', display: 'inline-block', cursor: barterRequirements?.length ? 'help' : undefined }}>
            <img
              src={trader.icon}
              alt={traderName}
              style={{ width: size, height: size, borderRadius: 4, objectFit: 'cover' }}
            />
            <span style={{
              position: 'absolute', bottom: 0, right: 0,
              background: '#faad14', color: '#000', fontSize: size < 40 ? 8 : 10, fontWeight: 700,
              borderRadius: '4px 0 4px 0', padding: size < 40 ? '0 2px' : '1px 4px', lineHeight: 1.2,
            }}>{t('ui.barter_badge_short')}</span>
          </div>
        </BarterTooltip>
      )
    }
    return <BarterTooltip requirements={barterRequirements}><Text type="secondary" style={{ cursor: barterRequirements?.length ? 'help' : undefined }}>{traderName} ({t('ui.barter_badge_long')})</Text></BarterTooltip>
  }
  const key = source.toLowerCase().replace(/\s+/g, '')
  const trader = traderIcons[key]
  if (compact) {
    const label = source === 'fleaMarket' ? 'Flea' : (trader?.name || source)
    return <Text type="secondary" style={{ whiteSpace: 'nowrap' }}>{label}</Text>
  }
  if (trader?.icon) {
    return (
      <img
        src={trader.icon}
        alt={trader.name}
        title={trader.name}
        style={{ width: size, height: size, borderRadius: 4, objectFit: 'cover' }}
      />
    )
  }
  return <Text type="secondary">{source}</Text>
}

export function ItemTooltip({ item, children }: { item: ItemDetail; children: React.ReactElement }) {
  const { t } = useTranslation()
  const lines: React.ReactNode[] = []
  if (item.capacity) lines.push(<div key="cap">{t('ui.capacity_label')}: {item.capacity} {t('ui.rounds_unit')}</div>)
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
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.sm
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
    <div style={{ display: 'flex', flexDirection: compactMode ? 'row' : 'column', gap: 0, flexShrink: 0 }}>
      {onToggleLock && (
        <Tooltip title={isLocked ? t('ui.lock_action_tooltip_remove') : t('ui.lock_action_tooltip_add')}>
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
        <Tooltip title={isExcluded ? t('ui.ban_action_tooltip_remove') : t('ui.ban_action_tooltip_add')}>
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
    if (isMobile) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
           <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
             {actionBtns}
             <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
               <ItemTooltip item={item}>
                 <Text strong style={{ fontSize: 13, display: 'inline-block', lineHeight: 1.2, whiteSpace: 'normal', wordBreak: 'break-word', ...clickableStyle }} onClick={() => copyToClipboard(item.name)}>{item.name}</Text>
               </ItemTooltip>
               <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                 {item.ergonomics !== 0 && <Tag color={item.ergonomics > 0 ? 'blue' : 'red'} style={{ margin: 0, fontSize: 11 }}>{ergoLabel}: {item.ergonomics > 0 ? '+' : ''}{item.ergonomics}</Tag>}
                 {item.recoil_modifier !== 0 && <Tag color={item.recoil_modifier < 0 ? 'green' : 'red'} style={{ margin: 0, fontSize: 11 }}>{recoilLabel}: {(item.recoil_modifier * 100).toFixed(1)}%</Tag>}
               </div>
             </div>
           </div>
           <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, paddingLeft: hasActions ? 34 : 0 }}>
             <TraderIcon source={item.source} unknownLabel={unknownLabel} compact barterRequirements={item.barter_requirements} />
             {!hidePrice && <Tag color="gold" style={{ margin: 0, fontSize: 11 }}>{priceCell(item)}</Tag>}
           </div>
        </div>
      )
    }
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 8px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
        {actionBtns}
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', gap: 4, alignItems: 'center' }}>
          <ItemTooltip item={item}>
            <Text strong style={{ fontSize: 12, ...truncateStyle, display: 'inline', ...clickableStyle }} onClick={() => copyToClipboard(item.name)}>{item.name}</Text>
          </ItemTooltip>
          {item.ergonomics !== 0 && <Tag color={item.ergonomics > 0 ? 'blue' : 'red'} style={{ margin: 0, fontSize: 11, flexShrink: 0 }}>{ergoLabel}: {item.ergonomics > 0 ? '+' : ''}{item.ergonomics}</Tag>}
          {item.recoil_modifier !== 0 && <Tag color={item.recoil_modifier < 0 ? 'green' : 'red'} style={{ margin: 0, fontSize: 11, flexShrink: 0 }}>{recoilLabel}: {(item.recoil_modifier * 100).toFixed(1)}%</Tag>}
        </div>
        <div style={{ width: 80, textAlign: 'left', flexShrink: 0 }}>
          <TraderIcon source={item.source} unknownLabel={unknownLabel} compact barterRequirements={item.barter_requirements} />
        </div>
        {!hidePrice && <div style={{ width: 70, textAlign: 'right', flexShrink: 0 }}><Tag color="gold" style={{ margin: 0, fontSize: 11 }}>{priceCell(item)}</Tag></div>}
      </div>
    )
  }

  if (isMobile) {
    return (
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${token.colorBorderSecondary}`, display: 'flex', gap: 12, background: 'transparent', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <ItemTooltip item={item}>
            <div style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: token.colorFillQuaternary, borderRadius: 6 }}>
              {item.icon ? (
                <img src={item.icon} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : (
                <SettingOutlined style={{ fontSize: 20, color: token.colorTextQuaternary }} />
              )}
            </div>
          </ItemTooltip>
          {hasActions && (
             <div style={{ display: 'flex', gap: 4, background: token.colorFillAlter, borderRadius: 12, padding: '2px 4px' }}>
                {onToggleLock && (
                  <Button type="text" size="small" icon={<LockOutlined />} onClick={() => onToggleLock(item.id)} style={{ padding: 0, height: 20, width: 20, minWidth: 20, color: isLocked ? token.colorPrimary : token.colorTextSecondary }} />
                )}
                {onToggleExclude && (
                  <Button type="text" size="small" icon={<StopOutlined />} onClick={() => onToggleExclude(item.id)} style={{ padding: 0, height: 20, width: 20, minWidth: 20, color: isExcluded ? token.colorError : token.colorTextSecondary }} />
                )}
             </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <Text strong style={{ fontSize: 13, lineHeight: 1.3, wordBreak: 'break-word', ...clickableStyle }} onClick={() => copyToClipboard(item.name)}>{item.name}</Text>
            {!hidePrice && <Tag color="gold" style={{ margin: 0, flexShrink: 0, border: 'none', background: token.colorFillQuaternary, fontWeight: 600 }}>{priceCell(item)}</Tag>}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
            {item.ergonomics !== 0 && <Tag color={item.ergonomics > 0 ? 'blue' : 'red'} bordered={false} style={{ margin: 0, fontSize: 11, padding: '0 4px', lineHeight: '18px' }}>{ergoLabel}: {item.ergonomics > 0 ? '+' : ''}{item.ergonomics}</Tag>}
            {item.recoil_modifier !== 0 && <Tag color={item.recoil_modifier < 0 ? 'green' : 'red'} bordered={false} style={{ margin: 0, fontSize: 11, padding: '0 4px', lineHeight: '18px' }}>{recoilLabel}: {(item.recoil_modifier * 100).toFixed(1)}%</Tag>}
            {!!item.accuracy_modifier && <Tag color={item.accuracy_modifier > 0 ? 'orange' : 'volcano'} bordered={false} style={{ margin: 0, fontSize: 11, padding: '0 4px', lineHeight: '18px' }}>{t('ui.acc_label')}: {item.accuracy_modifier > 0 ? '+' : ''}{item.accuracy_modifier}%</Tag>}
            {!!item.sighting_range && <Tag color="purple" bordered={false} style={{ margin: 0, fontSize: 11, padding: '0 4px', lineHeight: '18px' }}>{t('ui.sight_label')}: {item.sighting_range}m</Tag>}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
               <TraderIcon source={item.source} unknownLabel={unknownLabel} size={20} barterRequirements={item.barter_requirements} />
               <Text type="secondary" style={{ fontSize: 11, wordBreak: 'break-word' }}>{item.category?.split(/->|>|\//).pop()?.trim()}</Text>
            </div>
            {item.weight ? <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{item.weight.toFixed(2)} {t('ui.weight_unit')}</Text> : null}
          </div>
        </div>
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
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4, overflow: 'hidden' }}>
            {item.ergonomics !== 0 && <Tag color={item.ergonomics > 0 ? 'blue' : 'red'} style={tagStyle}>{ergoLabel}: {item.ergonomics > 0 ? '+' : ''}{item.ergonomics}</Tag>}
            {item.recoil_modifier !== 0 && <Tag color={item.recoil_modifier < 0 ? 'green' : 'red'} style={tagStyle}>{recoilLabel}: {item.recoil_modifier > 0 ? '+' : ''}{(item.recoil_modifier * 100).toFixed(1)}%</Tag>}
            {!!item.accuracy_modifier && <Tag color={item.accuracy_modifier > 0 ? 'orange' : 'volcano'} style={tagStyle}>{t('ui.acc_label')}: {item.accuracy_modifier > 0 ? '+' : ''}{item.accuracy_modifier}%</Tag>}
            {!!item.sighting_range && <Tag color="purple" style={tagStyle}>{t('ui.sight_label')}: {item.sighting_range}m</Tag>}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ width: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <TraderIcon source={item.source} unknownLabel={unknownLabel} barterRequirements={item.barter_requirements} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, width: 80 }}>
          {!hidePrice && <Tag color="gold" style={{ margin: 0, fontWeight: 600 }}>{priceCell(item)}</Tag>}
          {item.weight ? <Tag color="cyan" style={{ margin: 0 }}>{item.weight.toFixed(2)} {t('ui.weight_unit')}</Tag> : null}
        </div>
      </div>
    </div>
  )
}

export function priceCell(item: ItemDetail) {
  const { t } = i18n
  if (item.purchasable === false && item.reference_price_rub != null && item.reference_price_rub > 0) {
    return (
      <span title={t('ui.not_purchasable_tooltip')}>
        0 <Text type="secondary">({t('ui.ref_price_label')} ₽{item.reference_price_rub.toLocaleString()})</Text>
      </span>
    )
  }
  if (item.purchasable === false) {
    return <span title={t('ui.not_purchasable_tooltip')}>0</span>
  }
  return `₽${item.price.toLocaleString()}`
}
