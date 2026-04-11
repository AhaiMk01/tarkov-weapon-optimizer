import { useTranslation } from 'react-i18next'
import { Card, Statistic, theme } from 'antd'

const { useToken } = theme

interface StatsCardsProps {
  ergonomics: number
  recoilVertical: number
  recoilHorizontal: number
  weight: number
  price: number
  moa?: number
}

export function StatsCards({ ergonomics, recoilVertical, recoilHorizontal, weight, price, moa }: StatsCardsProps) {
  const { t } = useTranslation()
  const { token } = useToken()
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <Card size="small" style={{ flex: '1 1 100px', minWidth: 100 }}>
        <Statistic title={t('sidebar.ergonomics')} value={Math.min(100, Math.max(0, ergonomics)).toFixed(1)} />
      </Card>
      <Card size="small" style={{ flex: '1 1 100px', minWidth: 100 }}>
        <Statistic title={t('ui.vert_recoil')} value={recoilVertical.toFixed(1)} />
      </Card>
      <Card size="small" style={{ flex: '1 1 100px', minWidth: 100 }}>
        <Statistic title={t('ui.horiz_recoil')} value={recoilHorizontal.toFixed(1)} />
      </Card>
      {moa != null && moa > 0 && (
        <Card size="small" style={{ flex: '1 1 100px', minWidth: 100 }}>
          <Statistic title={t('ui.moa_label')} value={moa.toFixed(2)} />
        </Card>
      )}
      <Card size="small" style={{ flex: '1 1 100px', minWidth: 100 }}>
        <Statistic title={t('ui.weight_label')} value={weight.toFixed(2)} suffix={t('ui.weight_unit')} />
      </Card>
      <Card size="small" style={{ flex: '2 1 150px', minWidth: 150 }}>
        <Statistic title={t('ui.total_cost')} value={price.toLocaleString()} prefix="₽" valueStyle={{ color: token.colorWarning }} />
      </Card>
    </div>
  )
}
