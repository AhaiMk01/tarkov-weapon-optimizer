import { useTranslation } from 'react-i18next'
import { Card, Tag, Typography, message, Grid, Tooltip } from 'antd'
import { TraderIcon } from '../ItemRow'
import type { OptimizeResponse } from '../../api/client'

const { Text } = Typography

type Preset = NonNullable<OptimizeResponse['selected_preset']>

function PresetTooltipContent({ preset }: { preset: Preset }) {
  const img = preset.image_large ?? preset.icon
  if (!img) return null
  return (
    <div>
      <img src={img} alt="" style={{ width: 300, height: 160, objectFit: 'contain', display: 'block' }} />
    </div>
  )
}

export function UsingPresetCard({ preset }: { preset: Preset }) {
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
  const tooltipContent = <PresetTooltipContent preset={preset} />
  return (
    <Card size="small" style={{ overflow: 'hidden' }}>
      {contextHolder}
      <div style={{ display: 'flex', gap: isMobile ? 10 : 14, alignItems: 'center', flexWrap: 'wrap' }}>
        {preset.icon && (
          <Tooltip title={tooltipContent} overlayStyle={{ maxWidth: 340 }}>
            <img
              src={preset.icon}
              alt=""
              style={{ width: isMobile ? 80 : 100, height: isMobile ? 50 : 60, objectFit: 'contain', flexShrink: 0 }}
            />
          </Tooltip>
        )}
        <div style={{ flex: 1, minWidth: 150 }}>
          <Tooltip title={tooltipContent} overlayStyle={{ maxWidth: 340 }}>
            <Text
              strong
              style={{ display: 'block', cursor: 'pointer', fontSize: 13, lineHeight: 1.3 }}
              onClick={() => copyText(preset.name)}
            >
              {preset.name}
            </Text>
          </Tooltip>
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
