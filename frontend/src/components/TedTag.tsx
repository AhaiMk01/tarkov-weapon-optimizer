import type { CSSProperties } from 'react'
import { Tag, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import type { ItemDetail } from '../api/client'
import { isShownTedDelta } from '../solver/trueErgo'

/** TED this part adds to (green) or costs (red) the build: TED(build) - TED(build without it). */
export function TedTag({ item, style, bordered }: { item: ItemDetail; style?: CSSProperties; bordered?: boolean }) {
  const { t } = useTranslation()
  const delta = item.ted_delta
  if (!isShownTedDelta(delta)) return null
  return (
    <Tooltip title={t('ui.ted_part_tooltip')}>
      <Tag color={delta > 0 ? 'green' : 'red'} variant={bordered === false ? 'filled' : undefined} style={style}>
        {t('ui.ted_part_label')}: {delta > 0 ? '+' : ''}{delta.toFixed(1)}
      </Tag>
    </Tooltip>
  )
}
