import { useTranslation } from 'react-i18next'
import { Card, Tag, Typography, message, Grid } from 'antd'
import { TraderIcon } from '../ItemRow'
import type { OptimizeResponse } from '../../api/client'

const { Text } = Typography

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
  const unknown = t('ui.unknown')
  return (
    <Card size="small" style={{ overflow: 'hidden' }}>
      {contextHolder}
      <div style={{ display: 'flex', gap: isMobile ? 10 : 14, alignItems: 'center', flexWrap: 'wrap' }}>
        {preset.icon && (
          <img
            src={preset.icon}
            alt=""
            style={{ width: isMobile ? 80 : 100, height: isMobile ? 50 : 60, objectFit: 'contain', flexShrink: 0 }}
          />
        )}
        <div style={{ flex: 1, minWidth: 150 }}>
          <Text
            strong
            style={{ display: 'block', cursor: 'pointer', fontSize: 13, lineHeight: 1.3 }}
            title={preset.name}
            onClick={() => copyText(preset.name)}
          >
            {preset.name}
          </Text>
          <Text type="secondary" style={{ fontSize: 11 }}>{t('ui.base_preset_used')}</Text>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <TraderIcon source={preset.source} unknownLabel={unknown} compact barterRequirements={preset.barter_requirements} />
          <Tag color="gold" style={{ margin: 0, fontWeight: 600 }}>₽{preset.price.toLocaleString()}</Tag>
        </div>
      </div>
    </Card>
  )
}
