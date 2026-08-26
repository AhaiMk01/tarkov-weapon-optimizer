import { Typography } from 'antd'
import i18n from '../i18n'
import type { ItemDetail } from '../api/client'

const { Text } = Typography

/**
 * Price column content for an item — separated from ItemRow so that file only
 * exports components (react-refresh/only-export-components).
 */
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
