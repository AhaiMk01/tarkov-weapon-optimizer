import { SettingOutlined } from '@ant-design/icons'
import { Tag, Typography, theme, App } from 'antd'
import { useTranslation } from 'react-i18next'
import type { ItemDetail } from '../api/client'

const { Text } = Typography
const { useToken } = theme

const traderIcons: Record<string, { icon: string; name: string }> = {
  'prapor': { icon: '/traders/prapor.webp', name: 'Prapor' },
  'therapist': { icon: '/traders/therapist.webp', name: 'Therapist' },
  'fence': { icon: '/traders/fence.webp', name: 'Fence' },
  'skier': { icon: '/traders/skier.webp', name: 'Skier' },
  'peacekeeper': { icon: '/traders/peacekeeper.webp', name: 'Peacekeeper' },
  'mechanic': { icon: '/traders/mechanic.webp', name: 'Mechanic' },
  'ragman': { icon: '/traders/ragman.webp', name: 'Ragman' },
  'jaeger': { icon: '/traders/jaeger.webp', name: 'Jaeger' },
  'lightkeeper': { icon: '/traders/lightkeeper.webp', name: 'Lightkeeper' },
  'ref': { icon: '/traders/ref.webp', name: 'Ref' },
  'fleamarket': { icon: '/traders/flea-market-portrait.png', name: 'Flea Market' },
}

function TraderIcon({ source, unknownLabel, compact }: { source: string | undefined; unknownLabel: string; compact?: boolean }) {
  if (!source) return <Text type="secondary" style={compact ? { minWidth: 80 } : undefined}>{unknownLabel}</Text>
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
    const successMsg = t('toast.copied', 'Copied')
    const failMsg = t('toast.copy_failed', 'Copy failed')
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
  const ergoLabel = t('item.ergo', 'Ergo')
  const recoilLabel = t('item.recoil', 'Recoil')
  const unknownLabel = t('ui.unknown', 'Unknown')
  if (compactMode) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) auto auto 64px', gap: 8, padding: '8px 16px', alignItems: 'center' }}>
        <div style={{ minWidth: 200 }}>
          <Text strong style={{ display: 'block', ...truncateStyle, ...clickableStyle }} title={item.name} onClick={() => copyToClipboard(item.name)}>{item.name}</Text>
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
        <TraderIcon source={item.source} unknownLabel={unknownLabel} compact />
        <Text type="secondary" style={{ textAlign: 'right' }}>
          {hidePrice ? '-' : `₽${item.price.toLocaleString()}`}
        </Text>
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '64px minmax(200px, 1fr) auto 64px 64px', gap: 8, padding: 16, alignItems: 'center' }}>
      <div style={{ width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
        {item.icon ? (
          <img src={item.icon} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <SettingOutlined style={{ fontSize: 24, color: token.colorTextQuaternary }} />
        )}
      </div>
      <div style={{ minWidth: 200 }}>
        <Text strong style={{ display: 'block', ...truncateStyle, ...clickableStyle }} title={item.name} onClick={() => copyToClipboard(item.name)}>{item.name}</Text>
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
      <TraderIcon source={item.source} unknownLabel={unknownLabel} />
      <Text type="secondary" style={{ textAlign: 'right' }}>
        {hidePrice ? '-' : `₽${item.price.toLocaleString()}`}
      </Text>
    </div>
  )
}
