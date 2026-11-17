import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, Grid, theme } from 'antd'
import { HelpTip } from './HelpTip'

interface BuildSummaryProps {
  ergonomics: number
  recoilVertical: number
  recoilHorizontal: number
  weight: number
  price: number
  moa?: number
  trueErgoDelta?: number
  /** Aim-in kick strength, 0-100. Shown only while the build overswings. */
  overswingPct?: number
  weaponName?: string
  weaponImage?: string
}

const IMAGE_BOX = { width: 280, height: 150 }

export function BuildSummary({ ergonomics, recoilVertical, recoilHorizontal, weight, price, moa, trueErgoDelta, overswingPct, weaponName, weaponImage }: BuildSummaryProps) {
  const { t } = useTranslation()
  const { token } = theme.useToken()
  const isMobile = !Grid.useBreakpoint().md

  const dd: CSSProperties = { margin: 0 }
  const big = (label: string, value: ReactNode, color?: string) => (
    <div style={{ minWidth: 0 }}>
      <dt style={{ fontSize: 12, color: token.colorTextSecondary }}>{label}</dt>
      <dd style={{ ...dd, fontSize: isMobile ? 22 : 30, lineHeight: 1.25, fontWeight: 600, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere', color }}>{value}</dd>
    </div>
  )
  const small = (label: ReactNode, value: ReactNode, color?: string) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
      <dt style={{ color: token.colorTextSecondary }}>{label}</dt>
      <dd style={{ ...dd, fontVariantNumeric: 'tabular-nums', color }}>{value}</dd>
    </div>
  )

  const tedColor = trueErgoDelta != null && trueErgoDelta < 0 ? token.colorError : token.colorSuccess

  return (
    <Card size="small" styles={{ body: { padding: isMobile ? 12 : 16 } }}>
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 12 : 20, alignItems: isMobile ? 'stretch' : 'flex-start' }}>
        {weaponImage && (
          <div
            style={{
              flexShrink: 0,
              width: isMobile ? '100%' : IMAGE_BOX.width,
              height: isMobile ? 140 : IMAGE_BOX.height,
              borderRadius: token.borderRadius,
              background: token.colorFillQuaternary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img src={weaponImage} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: isMobile ? 10 : 14 }}>
          {weaponName && (
            <h2 style={{ margin: 0, fontSize: isMobile ? 18 : 20, lineHeight: 1.3, fontWeight: 600, overflowWrap: 'anywhere' }}>{weaponName}</h2>
          )}
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', columnGap: isMobile ? 8 : 24 }}>
            {big(t('sidebar.ergonomics'), Math.min(100, Math.max(0, ergonomics)).toFixed(1))}
            {big(t('ui.vert_recoil'), recoilVertical.toFixed(1))}
            {big(t('ui.total_cost'), `₽${price.toLocaleString()}`, token.colorWarning)}
          </dl>
          <dl style={{ margin: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 20px', fontSize: 13 }}>
            {small(t('ui.horiz_recoil'), recoilHorizontal.toFixed(1))}
            {small(t('ui.weight_label'), `${weight.toFixed(2)} ${t('ui.weight_unit')}`)}
            {moa != null && moa > 0 && (
              // The displayed MOA is the provisional model's value (ADR 0006), not a measured in-game figure: the label is plain, the caveat is in the info tooltip.
              small(
                <span>
                  {t('ui.moa_label')}{' '}
                  <HelpTip icon="info" tone="tertiary" title={t('ui.moa_provisional_tooltip')} />
                </span>,
                moa.toFixed(3),
              )
            )}
            {trueErgoDelta != null && (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '2px 6px', flexWrap: 'wrap' }}>
                <dt style={{ color: token.colorTextSecondary }}>
                  {/* TED is nonnegative exactly when the model predicts no overswing. */}
                  {trueErgoDelta >= 0 ? t('ui.ted_label_ok') : t('ui.ted_label_over')}
                </dt>
                <dd style={{ ...dd, fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: tedColor }}>
                  {trueErgoDelta > 0 ? `+${trueErgoDelta.toFixed(1)}` : trueErgoDelta.toFixed(1)}
                </dd>
                {trueErgoDelta < 0 && overswingPct != null && (
                  <dd style={{ ...dd, color: token.colorError }}>{t('ui.overswing_severity', { pct: Math.round(overswingPct) })}</dd>
                )}
              </div>
            )}
          </dl>
        </div>
      </div>
    </Card>
  )
}
