import { useTranslation } from 'react-i18next'
import { ThunderboltOutlined } from '@ant-design/icons'
import { EmptyState } from '../common/EmptyState'
import { StatsCards } from '../common/StatsCards'
import { BuildManifest } from '../common/BuildManifest'
import { UsingPresetCard } from '../common/UsingPresetCard'
import { CancelButton, FailureAlert, ResultStatusAlert } from '../common/ResultStatus'
import type { OptimizeRun } from '../../runs/runState'
import { authorityOf } from '../common/resultView'
import { partitionManifest, presetUsage } from '../common/manifest'

interface OptimizeResultProps {
  /** The request's phase, its last accepted result, and its failure (a native solver failure or an unexpected error; a plain cancel is not one). */
  run: OptimizeRun
  viewMode: 'detailed' | 'compact' | 'table'
  onViewModeChange: (v: 'detailed' | 'compact' | 'table') => void
  onOptimize: () => void
  onCancel?: () => void
  cancelling?: boolean
  onCopy: () => void
  disabled: boolean
  weaponId?: string
  lockedIds?: string[]
  excludedIds?: string[]
  onToggleLock?: (id: string) => void
  onToggleExclude?: (id: string) => void
}

export function OptimizeResult({ run, viewMode, onViewModeChange, onOptimize, onCancel, cancelling, onCopy, disabled, weaponId, lockedIds, excludedIds, onToggleLock, onToggleExclude }: OptimizeResultProps) {
  const { t } = useTranslation()
  const { result, failure } = run
  const optimizing = run.phase === 'running'
  if (!result) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {failure && failure.kind !== 'cancelled' && <FailureAlert failure={failure} />}
        <EmptyState
          icon={<ThunderboltOutlined />}
          description={t('optimize.ready_description')}
          buttonText={t('optimize.generate_btn')}
          buttonIcon={<ThunderboltOutlined />}
          loading={optimizing}
          disabled={disabled}
          onAction={onOptimize}
          extra={optimizing && onCancel ? <CancelButton onCancel={onCancel} cancelling={cancelling} /> : undefined}
        />
      </div>
    )
  }
  // A build is shown whenever a verified one is published (optimal or feasible), with the proof state of its own status above it.
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
        runIcon={<ThunderboltOutlined />}
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
          <BuildManifest result={result} viewMode={viewMode} onViewModeChange={onViewModeChange} onCopy={onCopy} weaponId={weaponId} lockedIds={lockedIds} excludedIds={excludedIds} onToggleLock={onToggleLock} onToggleExclude={onToggleExclude} />
        </>
      )}
    </div>
  )
}
