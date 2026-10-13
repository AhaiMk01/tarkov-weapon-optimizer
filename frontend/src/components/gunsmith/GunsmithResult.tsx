import { useTranslation } from 'react-i18next'
import { ToolOutlined } from '@ant-design/icons'
import { EmptyState } from '../common/EmptyState'
import { StatsCards } from '../common/StatsCards'
import { BuildManifest } from '../common/BuildManifest'
import { UsingPresetCard } from '../common/UsingPresetCard'
import { CancelButton, FailureAlert, ResultStatusAlert } from '../common/ResultStatus'
import type { Failure } from '../common/failureView'
import { authorityOf } from '../common/resultView'
import { partitionManifest, presetUsage } from '../common/manifest'
import type { OptimizeResponse } from '../../api/client'

interface GunsmithResultProps {
  result: OptimizeResponse | null
  /** A request that was rejected (a native solver failure or an unexpected error); a plain cancel is not one. */
  failure?: Failure | null
  viewMode: 'detailed' | 'compact' | 'table'
  onViewModeChange: (v: 'detailed' | 'compact' | 'table') => void
  optimizing: boolean
  onOptimize: () => void
  onCancel?: () => void
  cancelling?: boolean
  onCopy: () => void
  disabled: boolean
  weaponId?: string
}

export function GunsmithResult({ result, failure, viewMode, onViewModeChange, optimizing, onOptimize, onCancel, cancelling, onCopy, disabled, weaponId }: GunsmithResultProps) {
  const { t } = useTranslation()
  if (!result) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {failure && failure.kind !== 'cancelled' && <FailureAlert failure={failure} />}
        <EmptyState
          icon={<ToolOutlined />}
          description={t('gunsmith.ready_description')}
          buttonText={t('gunsmith.optimize_btn')}
          buttonIcon={<ToolOutlined />}
          loading={optimizing}
          disabled={disabled}
          onAction={onOptimize}
          extra={optimizing && onCancel ? <CancelButton onCancel={onCancel} cancelling={cancelling} /> : undefined}
        />
      </div>
    )
  }
  const hasBuild = authorityOf(result).hasBuild && result.final_stats !== undefined
  const { preset: presetOccurrences } = partitionManifest(result)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {failure && failure.kind !== 'cancelled' && <FailureAlert failure={failure} />}
      <ResultStatusAlert
        result={result}
        running={optimizing}
        onRun={onOptimize}
        onCancel={onCancel}
        cancelling={cancelling}
        runIcon={<ToolOutlined />}
        runLabel={t('ui.reoptimize_btn')}
      />
      {hasBuild && result.final_stats && (
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
              retainedItems={presetOccurrences}
              usage={presetUsage(result)}
              compactMode={viewMode === 'compact' || viewMode === 'table'}
              viewMode={viewMode}
            />
          )}
          <BuildManifest result={result} viewMode={viewMode} onViewModeChange={onViewModeChange} onCopy={onCopy} weaponId={weaponId} />
        </>
      )}
    </div>
  )
}
