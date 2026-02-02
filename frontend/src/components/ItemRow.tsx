import { SettingOutlined } from '@ant-design/icons'
import { Tag, Typography, theme } from 'antd'
import type { ItemDetail } from '../api/client'

const { Text } = Typography
const { useToken } = theme

interface ItemRowProps {
  item: ItemDetail
  hidePrice?: boolean
  compactMode?: boolean
}

export function ItemRow({ item, hidePrice = false, compactMode = false }: ItemRowProps) {
  const { token } = useToken()
  if (compactMode) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px 150px 100px', gap: 16, padding: '12px 24px', alignItems: 'center' }}>
        <div style={{ minWidth: 0 }}>
          <Text strong style={{ display: 'block' }}>{item.name}</Text>
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
        <Tag>{item.source || '未知'}</Tag>
        {!hidePrice && (
          <Text type="secondary" style={{ fontFamily: 'monospace', textAlign: 'right' }}>
            ₽{item.price.toLocaleString()}
          </Text>
        )}
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 150px 120px 100px', gap: 16, padding: '16px 24px', alignItems: 'center' }}>
      <div style={{ width: 80, height: 64, background: token.colorBgLayout, borderRadius: token.borderRadius, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: `1px solid ${token.colorBorderSecondary}`, flexShrink: 0 }}>
        {item.icon ? (
          <img src={item.icon} alt={item.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        ) : (
          <SettingOutlined style={{ fontSize: 24, color: token.colorTextQuaternary }} />
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        <Text strong style={{ display: 'block' }}>{item.name}</Text>
        <Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>ID: {item.id}</Text>
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
      <Tag>{item.source || '未知'}</Tag>
      {!hidePrice && (
        <Text type="secondary" style={{ fontFamily: 'monospace', textAlign: 'right' }}>
          ₽{item.price.toLocaleString()}
        </Text>
      )}
    </div>
  )
}
