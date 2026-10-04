import type { CSSProperties } from 'react'
import { Tag, Tooltip, theme } from 'antd'
import { useTranslation } from 'react-i18next'

/**
 * "×N" badge for a part a factory preset supplies in quantity (count > 1). A single copy is the
 * unremarkable case and renders nothing. Colors come from antd tokens so light/dark both work.
 */
export function QuantityTag({ count, style }: { count: number | undefined; style?: CSSProperties }) {
  const { t } = useTranslation()
  const { token } = theme.useToken()
  if (count === undefined || !(count > 1)) return null
  return (
    <Tooltip title={t('ui.preset_supply_copies', { count })}>
      <Tag
        style={{
          margin: 0,
          flexShrink: 0,
          fontWeight: 600,
          color: token.colorPrimary,
          background: token.colorPrimaryBg,
          borderColor: token.colorPrimaryBorder,
          ...style,
        }}
      >
        ×{count}
      </Tag>
    </Tooltip>
  )
}
