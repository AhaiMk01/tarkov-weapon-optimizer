import { useTranslation } from 'react-i18next'
import { Card, Statistic, theme } from 'antd'

const { useToken } = theme

interface StatsCardsProps {
  ergonomics: number
  recoilVertical: number
  recoilHorizontal: number
  weight: number
  price: number
}

export function StatsCards({ ergonomics, recoilVertical, recoilHorizontal, weight, price }: StatsCardsProps) {
  const { t } = useTranslation()
  const { token } = useToken()
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <Card size="small" style={{ flex: '1 1 100px', minWidth: 100 }}>
        <Statistic title={t('sidebar.ergonomics', '人机工效')} value={Math.min(100, Math.max(0, ergonomics)).toFixed(1)} />
      </Card>
      <Card size="small" style={{ flex: '1 1 100px', minWidth: 100 }}>
        <Statistic title={t('ui.vert_recoil', '垂直后坐')} value={recoilVertical.toFixed(0)} />
      </Card>
      <Card size="small" style={{ flex: '1 1 100px', minWidth: 100 }}>
        <Statistic title={t('ui.horiz_recoil', '水平后坐')} value={recoilHorizontal.toFixed(0)} />
      </Card>
      <Card size="small" style={{ flex: '1 1 100px', minWidth: 100 }}>
        <Statistic title={t('ui.weight_label', '重量')} value={weight.toFixed(2)} suffix="kg" />
      </Card>
      <Card size="small" style={{ flex: '2 1 150px', minWidth: 150 }}>
        <Statistic title={t('ui.total_cost', '总价')} value={price.toLocaleString()} prefix="₽" valueStyle={{ color: token.colorWarning }} />
      </Card>
    </div>
  )
}
