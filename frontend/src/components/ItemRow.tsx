import { SettingOutlined } from '@ant-design/icons'
import { Tag, Typography, theme, App } from 'antd'
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

function TraderIcon({ source }: { source: string | undefined }) {
  if (!source) return <Tag>未知</Tag>
  const key = source.toLowerCase().replace(/\s+/g, '')
  const trader = traderIcons[key]
  if (trader?.icon) {
    return (
      <img
        src={trader.icon}
        alt={trader.name}
        title={trader.name}
        style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover' }}
      />
    )
  }
  return <Tag>{source}</Tag>
}

interface ItemRowProps {
  item: ItemDetail
  hidePrice?: boolean
  compactMode?: boolean
}

export function ItemRow({ item, hidePrice = false, compactMode = false }: ItemRowProps) {
  const { token } = useToken()
  const { message } = App.useApp()
  const copyToClipboard = (text: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        message.success('已复制')
      }).catch(() => {
        fallbackCopy(text)
      })
    } else {
      fallbackCopy(text)
    }
    function fallbackCopy(t: string) {
      const textArea = document.createElement('textarea')
      textArea.value = t
      textArea.style.position = 'fixed'
      textArea.style.left = '-9999px'
      document.body.appendChild(textArea)
      textArea.select()
      try {
        document.execCommand('copy')
        message.success('已复制')
      } catch {
        message.error('复制失败')
      }
      document.body.removeChild(textArea)
    }
  }
  const clickableStyle = { cursor: 'pointer' }
  if (compactMode) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px 40px 100px', gap: 16, padding: '12px 24px', alignItems: 'center' }}>
        <div style={{ minWidth: 0 }}>
          <Text strong style={{ display: 'block', ...clickableStyle }} onClick={() => copyToClipboard(item.name)}>{item.name}</Text>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {item.ergonomics !== 0 && (
            <Tag color={item.ergonomics > 0 ? 'blue' : 'red'}>
              人机: {item.ergonomics > 0 ? '+' : ''}{item.ergonomics}
            </Tag>
          )}
          {item.recoil_modifier !== 0 && (
            <Tag color={item.recoil_modifier < 0 ? 'green' : 'red'}>
              后坐: {item.recoil_modifier > 0 ? '+' : ''}{(item.recoil_modifier * 100).toFixed(1)}%
            </Tag>
          )}
        </div>
        <TraderIcon source={item.source} />
        {!hidePrice && (
          <Text type="secondary" style={{ textAlign: 'right' }}>
            ₽{item.price.toLocaleString()}
          </Text>
        )}
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 150px 40px 100px', gap: 16, padding: '16px 24px', alignItems: 'center' }}>
      <div style={{ width: 80, height: 64, background: token.colorFillQuaternary, borderRadius: token.borderRadius, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, padding: 4 }}>
        {item.icon ? (
          <img src={item.icon} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        ) : (
          <SettingOutlined style={{ fontSize: 24, color: token.colorTextQuaternary }} />
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        <Text strong style={{ display: 'block', ...clickableStyle }} onClick={() => copyToClipboard(item.name)}>{item.name}</Text>
        <Text type="secondary" style={{ fontSize: 12, ...clickableStyle }} onClick={() => copyToClipboard(item.id)}>ID: {item.id}</Text>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {item.ergonomics !== 0 && (
          <Tag color={item.ergonomics > 0 ? 'blue' : 'red'}>
            人机: {item.ergonomics > 0 ? '+' : ''}{item.ergonomics}
          </Tag>
        )}
        {item.recoil_modifier !== 0 && (
          <Tag color={item.recoil_modifier < 0 ? 'green' : 'red'}>
            后坐: {item.recoil_modifier > 0 ? '+' : ''}{(item.recoil_modifier * 100).toFixed(1)}%
          </Tag>
        )}
        {item.ergonomics === 0 && item.recoil_modifier === 0 && <Text type="secondary">-</Text>}
      </div>
      <TraderIcon source={item.source} />
      {!hidePrice && (
        <Text type="secondary" style={{ textAlign: 'right' }}>
          ₽{item.price.toLocaleString()}
        </Text>
      )}
    </div>
  )
}
