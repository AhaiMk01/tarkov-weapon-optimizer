import { useTranslation } from 'react-i18next'
import { Card, Statistic, Tooltip, Typography, theme } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'

const { useToken } = theme

interface StatsCardsProps {
  ergonomics: number
  recoilVertical: number
  recoilHorizontal: number
  weight: number
  price: number
  moa?: number
  trueErgoDelta?: number
  /** Aim-in kick strength, 0-100. Shown only while the build overswings. */
  overswingPct?: number
}

export function StatsCards({ ergonomics, recoilVertical, recoilHorizontal, weight, price, moa, trueErgoDelta, overswingPct }: StatsCardsProps) {
  const { t } = useTranslation()
  const { token } = useToken()
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <Card size="small" style={{ flex: '1 1 100px', minWidth: 100 }}>
        <Statistic title={t('sidebar.ergonomics')} value={Math.min(100, Math.max(0, ergonomics)).toFixed(1)} />
      </Card>
      {trueErgoDelta != null && (
        <Card size="small" style={{ flex: '1 1 100px', minWidth: 100 }}>
          <Statistic
            // TED is nonnegative exactly when the model predicts no overswing.
            title={trueErgoDelta >= 0 ? t('ui.ted_label_ok') : t('ui.ted_label_over')}
            value={trueErgoDelta > 0 ? `+${trueErgoDelta.toFixed(1)}` : trueErgoDelta.toFixed(1)}
            styles={{ content: { color: trueErgoDelta >= 0 ? token.colorSuccess : token.colorError } }}
          />
          {trueErgoDelta < 0 && overswingPct != null && (
            <Typography.Text type="danger" style={{ fontSize: 12 }}>
              {t('ui.overswing_severity', { pct: Math.round(overswingPct) })}
            </Typography.Text>
          )}
        </Card>
      )}
      <Card size="small" style={{ flex: '1 1 100px', minWidth: 100 }}>
        <Statistic title={t('ui.vert_recoil')} value={recoilVertical.toFixed(1)} />
      </Card>
      <Card size="small" style={{ flex: '1 1 100px', minWidth: 100 }}>
        <Statistic title={t('ui.horiz_recoil')} value={recoilHorizontal.toFixed(1)} />
      </Card>
      {moa != null && moa > 0 && (
        <Card size="small" style={{ flex: '1 1 100px', minWidth: 100 }}>
          {/* The displayed MOA is the provisional model's value (ADR 0006), not a measured in-game figure: the label is plain, the caveat is in the info tooltip. */}
          <Statistic
            title={
              <span>
                {t('ui.moa_label')}{' '}
                <Tooltip title={t('ui.moa_provisional_tooltip')}>
                  <InfoCircleOutlined style={{ color: token.colorTextTertiary, fontSize: 12 }} />
                </Tooltip>
              </span>
            }
            value={moa.toFixed(3)}
          />
        </Card>
      )}
      <Card size="small" style={{ flex: '1 1 100px', minWidth: 100 }}>
        <Statistic title={t('ui.weight_label')} value={weight.toFixed(2)} suffix={t('ui.weight_unit')} />
      </Card>
      <Card size="small" style={{ flex: '2 1 150px', minWidth: 150 }}>
        <Statistic title={t('ui.total_cost')} value={price.toLocaleString()} prefix="₽" styles={{ content: { color: token.colorWarning } }} />
      </Card>
    </div>
  )
}
