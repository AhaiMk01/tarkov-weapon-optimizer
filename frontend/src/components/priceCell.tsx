import { Typography } from 'antd'
import i18n from '../i18n'
import type { ItemDetail } from '../api/client'

const { Text } = Typography

/**
 * Price column content for an installed occurrence — separated from ItemRow so that file only exports components
 * (react-refresh/only-export-components).
 *
 * The charge is per OCCURRENCE (ADR 0013 section 4A): the preset's own stock and an owned copy cost nothing and say so; a paid lot is charged on
 * its first unit and the other units of the lot ride on it at 0, which is labelled too, so no free-looking row is left unexplained.
 */
export function priceCell(item: ItemDetail) {
  const { t } = i18n
  switch (item.acquisition?.source) {
    case 'preset':
      return <span title={t('ui.acq_preset_tooltip')}>₽0 <Text type="secondary">({t('ui.acq_preset')})</Text></span>
    case 'owned':
      return <span title={t('ui.acq_owned_tooltip')}>₽0 <Text type="secondary">({t('ui.acq_owned')})</Text></span>
    case 'offer':
      if (item.price === 0) return <span title={t('ui.acq_lot_tooltip')}>₽0 <Text type="secondary">({t('ui.acq_lot')})</Text></span>
      break
  }
  return `₽${item.price.toLocaleString()}`
}
