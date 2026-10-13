import { useTranslation } from 'react-i18next'
import { Button, Collapse, Segmented, Space, Tooltip, Typography, theme } from 'antd'
import { QuestionCircleOutlined, UndoOutlined } from '@ant-design/icons'
import type { PrecisionRequest } from '../../api/client'
import { ADVANCED_DEFAULTS, isAdvancedDefault, repeatedPartsApply } from './advancedDefaults'

const { Text } = Typography

const labelStyle = { fontSize: 12 } as const
const rowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' } as const

interface AdvancedOptionsProps {
  solverPrecision: PrecisionRequest
  onSolverPrecisionChange: (v: PrecisionRequest) => void
  allowRepeatedParts: boolean
  onAllowRepeatedPartsChange: (v: boolean) => void
  /** Sweet Spot Mode belongs to Optimize: a panel that has no such request leaves both props out and the row is not shown. */
  useTchebycheff?: boolean
  onUseTchebycheffChange?: (v: boolean) => void
}

/**
 * The power-user menu: a compact section, closed by default, at the end of the optimize and explore side panels. Solver precision first, then
 * "Allow repeated parts" right under it (it only matters to Fast), then Sweet Spot Mode on the Optimize tab. Later options go here too.
 */
export function AdvancedOptions({
  solverPrecision,
  onSolverPrecisionChange,
  allowRepeatedParts,
  onAllowRepeatedPartsChange,
  useTchebycheff,
  onUseTchebycheffChange,
}: AdvancedOptionsProps) {
  const { t } = useTranslation()
  const { token } = theme.useToken()
  const hint = (title: string) => (
    <Tooltip title={title}>
      <QuestionCircleOutlined style={{ color: token.colorTextTertiary, fontSize: 12 }} />
    </Tooltip>
  )
  const onOff = [{ label: t('ui.on'), value: 'on' }, { label: t('ui.off'), value: 'off' }]
  const showSweetSpot = useTchebycheff !== undefined && onUseTchebycheffChange !== undefined
  const atDefaults = isAdvancedDefault({ solverPrecision, allowRepeatedParts, useTchebycheff })
  const reset = () => {
    onSolverPrecisionChange(ADVANCED_DEFAULTS.solverPrecision)
    onAllowRepeatedPartsChange(ADVANCED_DEFAULTS.allowRepeatedParts)
    if (showSweetSpot) onUseTchebycheffChange(ADVANCED_DEFAULTS.useTchebycheff)
  }
  return (
    <Collapse size="small" items={[
      {
        key: 'advanced',
        label: <span style={{ userSelect: 'none' }}>{t('advanced.title')}</span>,
        extra: (
          <Tooltip title={t('ui.reset')}>
            <Button type="text" size="small" icon={<UndoOutlined />} disabled={atDefaults} onClick={(e) => { e.stopPropagation(); reset() }} />
          </Tooltip>
        ),
        children: (
          <Space orientation="vertical" style={{ width: '100%' }}>
            <div style={rowStyle}>
              <Space size={4}>
                <Text type="secondary" style={labelStyle}>{t('advanced.solver_precision')}</Text>
                {hint(t('sidebar.solver_precision_tooltip'))}
              </Space>
              <Segmented
                size="small"
                value={solverPrecision}
                onChange={(v) => onSolverPrecisionChange(v as PrecisionRequest)}
                options={[
                  { label: t('sidebar.auto'), value: 'auto' },
                  { label: t('sidebar.fast'), value: 'fast' },
                  { label: t('sidebar.precise'), value: 'precise' },
                ]}
              />
            </div>
            <div style={rowStyle}>
              <Space size={4}>
                <Text type="secondary" style={labelStyle}>{t('advanced.allow_repeated_parts')}</Text>
                {hint(t('advanced.allow_repeated_parts_tooltip'))}
              </Space>
              <Segmented
                size="small"
                disabled={!repeatedPartsApply(solverPrecision)}
                value={allowRepeatedParts ? 'on' : 'off'}
                onChange={(v) => onAllowRepeatedPartsChange(v === 'on')}
                options={onOff}
              />
            </div>
            {showSweetSpot && (
              <div style={rowStyle}>
                <Space size={4}>
                  <Text type="secondary" style={labelStyle}>{t('optimize.tchebycheff')}</Text>
                  {hint(t('optimize.tchebycheff_tooltip'))}
                </Space>
                <Segmented size="small" value={useTchebycheff ? 'on' : 'off'} onChange={(v) => onUseTchebycheffChange(v === 'on')} options={onOff} />
              </div>
            )}
          </Space>
        ),
      },
    ]} />
  )
}
