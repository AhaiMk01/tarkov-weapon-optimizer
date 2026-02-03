import { useTranslation } from 'react-i18next'
import { Alert, Button } from 'antd'
import { ToolOutlined } from '@ant-design/icons'
import { EmptyState } from '../common/EmptyState'
import { StatsCards } from '../common/StatsCards'
import { BuildManifest } from '../common/BuildManifest'
import type { OptimizeResponse } from '../../api/client'

interface GunsmithResultProps {
  result: OptimizeResponse | null
  compactMode: boolean
  onCompactModeChange: (v: boolean) => void
  optimizing: boolean
  onOptimize: () => void
  onCopy: () => void
  disabled: boolean
}

export function GunsmithResult({ result, compactMode, onCompactModeChange, optimizing, onOptimize, onCopy, disabled }: GunsmithResultProps) {
  const { t } = useTranslation()
  if (!result) {
    return (
      <EmptyState
        icon={<ToolOutlined />}
        description={t('gunsmith.ready_description', '选择枪匠任务，生成满足约束的构建')}
        buttonText={t('gunsmith.optimize_btn', '开始优化')}
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
        message={`${t('results.optimization_status', '优化状态')}: ${t(`results.status_${result.status}`, result.status)}`}
        showIcon
        action={<Button type="primary" icon={<ToolOutlined />} loading={optimizing} onClick={onOptimize}>{t('ui.reoptimize_btn', '重新优化')}</Button>}
      />
      {result.status !== 'infeasible' && result.final_stats && (
        <>
          <StatsCards
            ergonomics={result.final_stats.ergonomics}
            recoilVertical={result.final_stats.recoil_vertical}
            recoilHorizontal={result.final_stats.recoil_horizontal}
            weight={result.final_stats.total_weight}
            price={result.final_stats.total_price}
          />
          <BuildManifest result={result} compactMode={compactMode} onCompactModeChange={onCompactModeChange} onCopy={onCopy} />
        </>
      )}
    </div>
  )
}
