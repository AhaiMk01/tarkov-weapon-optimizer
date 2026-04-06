import { useTranslation } from 'react-i18next'
import { Card, Tag, Space, Typography, message, Grid } from 'antd'
import { TraderIcon } from '../ItemRow'
import type { OptimizeResponse } from '../../api/client'

const { Text, Title } = Typography

function PresetPurchaseLine({ preset }: { preset: NonNullable<OptimizeResponse['selected_preset']> }) {
  const { t } = useTranslation()
  const unknown = preset.purchase_label || t('ui.preset_source_unknown')
  return (
    <div style={{ marginTop: 6 }}>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>{t('ui.preset_purchase_at')}</Text>
      <TraderIcon source={preset.source} unknownLabel={unknown} compact />
    </div>
  )
}

export function UsingPresetCard({ preset }: { preset: NonNullable<OptimizeResponse['selected_preset']> }) {
  const { t } = useTranslation()
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  const [messageApi, contextHolder] = message.useMessage()
  const copyText = (text: string) => {
    const successMsg = t('toast.copied')
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => messageApi.success(successMsg))
    } else {
      const textArea = document.createElement('textarea')
      textArea.value = text
      textArea.style.position = 'fixed'
      textArea.style.left = '-9999px'
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      messageApi.success(successMsg)
    }
  }
  return (
    <Card size="small">
      {contextHolder}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 8 : 12, alignItems: isMobile ? 'stretch' : 'flex-start' }}>
        {preset.icon && (
          <img
            src={preset.icon}
            alt=""
            style={
              isMobile
                ? { width: '100%', maxHeight: 220, objectFit: 'contain' }
                : { width: 132, height: 132, minWidth: 132, objectFit: 'contain', flexShrink: 0 }
            }
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Space size={4} wrap>
            <Text type="secondary">{t('ui.base_preset_used')}</Text>
            <Tag color="gold" style={{ margin: 0 }}>₽{preset.price.toLocaleString()}</Tag>
          </Space>
          <PresetPurchaseLine preset={preset} />
          <Title level={5} style={{ margin: '8px 0 0', cursor: 'pointer' }} onClick={() => copyText(preset.name)}>{preset.name}</Title>
        </div>
      </div>
    </Card>
  )
}
