import { useTranslation } from 'react-i18next'
import { Alert, Tag, Button, Typography } from 'antd'
import { ThunderboltOutlined, CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import { EmptyState } from '../common/EmptyState'
import { StatsCards } from '../common/StatsCards'
import { BuildManifest } from '../common/BuildManifest'
import { UsingPresetCard } from '../common/UsingPresetCard'
import { presetSupply } from '../../solver/presetSupply'
import type { OptimizeResponse } from '../../api/client'

const { Text } = Typography

interface OptimizeResultProps {
  result: OptimizeResponse | null
  viewMode: 'detailed' | 'compact' | 'table'
  onViewModeChange: (v: 'detailed' | 'compact' | 'table') => void
  optimizing: boolean
  onOptimize: () => void
  onCopy: () => void
  disabled: boolean
  weaponId?: string
  lockedIds?: string[]
  excludedIds?: string[]
  onToggleLock?: (id: string) => void
  onToggleExclude?: (id: string) => void
}

function precisionResolvedLabel(t: (k: string, opts?: Record<string, string>) => string, mode: 'fast' | 'precise'): string {
  return mode === 'precise' ? t('sidebar.precise') : t('sidebar.fast')
}

export function OptimizeResult({ result, viewMode, onViewModeChange, optimizing, onOptimize, onCopy, disabled, weaponId, lockedIds, excludedIds, onToggleLock, onToggleExclude }: OptimizeResultProps) {
  const { t } = useTranslation()
  if (!result) {
    return (
      <EmptyState
        icon={<ThunderboltOutlined />}
        description={t('optimize.ready_description')}
        buttonText={t('optimize.generate_btn')}
        buttonIcon={<ThunderboltOutlined />}
        loading={optimizing}
        disabled={disabled}
        onAction={onOptimize}
      />
    )
  }
  const presetSupplied = result.selected_preset ? presetSupply(result.selected_preset.items) : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Alert
        type={result.status === 'optimal' ? 'success' : result.status === 'infeasible' ? 'error' : 'warning'}
        message={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, width: '100%' }}>
            <Button type="primary" icon={<ThunderboltOutlined />} loading={optimizing} onClick={onOptimize}>{t('ui.reoptimize_btn')}</Button>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <Text>{t('results.optimization_status')}: {t(`results.status_${result.status}`, { defaultValue: result.status })}</Text>
              {result.solve_time_ms && <Tag color="blue" style={{ margin: 0 }}>{result.solve_time_ms.toFixed(0)} ms</Tag>}
              {result.precision_request === 'auto' && result.precision_resolved && (
                <Tag color="processing" style={{ margin: 0 }} title={t('sidebar.solver_precision_tooltip')}>
                  {t('results.precision_auto_ran', {
                    mode: precisionResolvedLabel(t, result.precision_resolved),
                  })}
                </Tag>
              )}
              {result.reason && <Text type="secondary" style={{ margin: 0 }}>{result.reason}</Text>}
              {/* An unknown bound is null (never 0): show the line only when every number in it is known. */}
              {result.optimization.lower_bound !== null && result.optimization.upper_bound !== null && result.optimization.absolute_gap !== null && (
                <Text type="secondary">
                  {t('results.optimization_bounds', {
                    lower: result.optimization.lower_bound.toPrecision(5),
                    upper: result.optimization.upper_bound.toPrecision(5),
                    gap: result.optimization.absolute_gap.toPrecision(3),
                    tolerance: result.optimization.tolerance.toPrecision(3),
                  })}
                </Text>
              )}
            </div>
          </div>
        }
        icon={result.status === 'optimal' ? <CheckCircleOutlined /> : result.status === 'infeasible' ? <CloseCircleOutlined /> : <ExclamationCircleOutlined />}
        showIcon
        style={{ alignItems: 'center' }}
      />
      {result.status !== 'infeasible' && result.final_stats && (
        <>
          <StatsCards
            ergonomics={result.final_stats.ergonomics}
            recoilVertical={result.final_stats.recoil_vertical}
            recoilHorizontal={result.final_stats.recoil_horizontal}
            weight={result.final_stats.total_weight}
            price={result.final_stats.total_price}
            moa={result.final_stats.moa}
            trueErgoDelta={result.final_stats.true_ergo_delta}
            overswingPct={result.final_stats.overswing_pct}
          />
          {result.selected_preset && (
            <UsingPresetCard
              preset={result.selected_preset}
              retainedItems={result.selected_items.filter(i => presetSupplied!.has(i.id))}
              compactMode={viewMode === 'compact' || viewMode === 'table'}
              viewMode={viewMode}
            />
          )}
          <BuildManifest result={result} viewMode={viewMode} onViewModeChange={onViewModeChange} onCopy={onCopy} weaponId={weaponId} lockedIds={lockedIds} excludedIds={excludedIds} onToggleLock={onToggleLock} onToggleExclude={onToggleExclude} />
        </>
      )}
    </div>
  )
}
