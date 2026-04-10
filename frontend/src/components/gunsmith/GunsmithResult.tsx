import { useTranslation } from 'react-i18next'
import { Alert, Button } from 'antd'
import { ToolOutlined } from '@ant-design/icons'
import { EmptyState } from '../common/EmptyState'
import { StatsCards } from '../common/StatsCards'
import { BuildManifest } from '../common/BuildManifest'
import { UsingPresetCard } from '../common/UsingPresetCard'
import type { OptimizeResponse } from '../../api/client'

interface GunsmithResultProps {
  result: OptimizeResponse | null
  compactMode: boolean
  onCompactModeChange: (v: boolean) => void
  optimizing: boolean
  onOptimize: () => void
  onCopy: () => void
  disabled: boolean
  weaponId?: string
}

export function GunsmithResult({ result, compactMode, onCompactModeChange, optimizing, onOptimize, onCopy, disabled, weaponId }: GunsmithResultProps) {
  const { t } = useTranslation()
  if (!result) {
    return (
      <EmptyState
        icon={<ToolOutlined />}
        description={t('gunsmith.ready_description')}
        buttonText={t('gunsmith.optimize_btn')}
        buttonIcon={<ToolOutlined />}
        loading={optimizing}
        disabled={disabled}
        onAction={onOptimize}
      />
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Alert
        type={result.status === 'optimal' ? 'success' : result.status === 'infeasible' ? 'error' : 'warning'}
        message={`${t('results.optimization_status')}: ${t(`results.status_${result.status}`, { defaultValue: result.status })}`}
        showIcon
        action={<Button type="primary" icon={<ToolOutlined />} loading={optimizing} onClick={onOptimize}>{t('ui.reoptimize_btn')}</Button>}
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
          />
          {result.selected_preset && (
            <UsingPresetCard
              preset={result.selected_preset}
              retainedItems={result.selected_items.filter(i => result.selected_preset!.items.includes(i.id))}
              compactMode={compactMode}
            />
          )}
          <BuildManifest result={result} compactMode={compactMode} onCompactModeChange={onCompactModeChange} onCopy={onCopy} weaponId={weaponId} />
        </>
      )}
    </div>
  )
}
