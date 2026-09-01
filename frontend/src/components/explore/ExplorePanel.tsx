import { useTranslation } from 'react-i18next'
import { Card, InputNumber, Select, Segmented, Slider, Tooltip, Typography } from 'antd'
import { WeaponSelector } from '../common/WeaponSelector'
import { ModFilter } from '../common/ModFilter'
import { LevelConfig } from '../common/LevelConfig'
import type { Gun, ModInfo, ModCategoryOption } from '../../api/client'
import type { TraderLevels } from '../../solver/types'

/**
 * explorePareto clamps with Math.max(steps, 10), so anything lower is ignored.
 */
const MIN_EXPLORE_STEPS = 10

/**
 * Two of the three sweeps step over ergonomics with
 * stepSize = Math.max(1, range / steps), so once steps passes a weapon's ergo
 * range the step size hits its 1-unit floor and further steps add nothing.
 *
 * 81 is the widest ergo range across all 171 weapons, measured by
 * bench_ergo_range.ts (SVDS 7.62x54R, 10..91; median 33, p95 69). Past it no
 * ergo-axis sweep can gain a point. The recoil-axis sweep has no floor and would
 * keep refining, but this is already far beyond a useful comparison size.
 */
const MAX_EXPLORE_STEPS = 81

interface ExplorePanelProps {
  guns: Gun[]
  selectedGunId: string
  onGunChange: (id: string) => void
  selectedGunIds: string[]
  onGunIdsChange: (ids: string[]) => void
  exploreTradeoff: 'price' | 'recoil' | 'ergo'
  exploreSteps: number
  onExploreStepsChange: (v: number) => void
  onExploreTradeoffChange: (v: 'price' | 'recoil' | 'ergo') => void
  useExploreBudget: boolean
  onUseExploreBudgetChange: (v: boolean) => void
  exploreBudgetValue: number
  onExploreBudgetValueChange: (v: number) => void
  availableMods: ModInfo[]
  loadingMods: boolean
  modCategoryOptions: ModCategoryOption[]
  includedCategories: string[]
  excludedCategories: string[]
  onIncludedCategoriesChange: (v: string[]) => void
  onExcludedCategoriesChange: (v: string[]) => void
  includedModIds: string[]
  excludedModIds: string[]
  onIncludedModIdsChange: (v: string[]) => void
  onExcludedModIdsChange: (v: string[]) => void
  categorySearch: string
  onCategorySearchChange: (v: string) => void
  modSearch: string
  onModSearchChange: (v: string) => void
  fleaAvailable: boolean
  onFleaChange: (v: boolean) => void
  barterAvailable: boolean
  onBarterChange: (v: boolean) => void
  barterExcludeDogtags: boolean
  onBarterExcludeDogsChange: (v: boolean) => void
  playerLevel: number
  onPlayerLevelChange: (v: number) => void
  traderLevels: TraderLevels
  onTraderLevelsChange: (v: TraderLevels) => void
}

export function ExplorePanel(props: ExplorePanelProps) {
  const { t } = useTranslation()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <WeaponSelector
        guns={props.guns}
        selectedGunId={props.selectedGunId}
        onGunChange={props.onGunChange}
        multiple
        selectedGunIds={props.selectedGunIds}
        onGunIdsChange={props.onGunIdsChange}
        hint={t('explore.compare_hint')}
      />
      <Card size="small" title={<span style={{ userSelect: 'none' }}>{t('explore.tradeoff_strategy')}</span>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Select style={{ width: '100%' }} value={props.exploreTradeoff} onChange={props.onExploreTradeoffChange} options={[
            { value: 'price', label: t('ui.tradeoff_ergo_vs_recoil') },
            { value: 'recoil', label: t('ui.tradeoff_ergo_vs_price') },
            { value: 'ergo', label: t('ui.tradeoff_recoil_vs_price') },
          ]} />
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Tooltip title={t('explore.resolution_tooltip')}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('explore.resolution')}
                </Typography.Text>
              </Tooltip>
              <Typography.Text style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                {props.exploreSteps}
              </Typography.Text>
            </div>
            <Slider
              value={props.exploreSteps}
              onChange={props.onExploreStepsChange}
              min={MIN_EXPLORE_STEPS}
              max={MAX_EXPLORE_STEPS}
              step={1}
              tooltip={{ open: false }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {t('explore.resolution_cost', {
                solves: props.exploreSteps * Math.max(1, props.selectedGunIds.length),
              })}
            </Typography.Text>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
             <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {props.exploreTradeoff === 'price' ? t('explore.limit_price') : props.exploreTradeoff === 'recoil' ? t('explore.limit_recoil') : t('explore.limit_ergo')}
                </Typography.Text>
                <Segmented size="small" value={props.useExploreBudget ? 'on' : 'off'} onChange={v => props.onUseExploreBudgetChange(v === 'on')} options={[{ label: t('ui.on', 'On'), value: 'on' }, { label: t('ui.off', 'Off'), value: 'off' }]} />
             </div>
             {props.useExploreBudget && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                   <InputNumber
                     size="small"
                     value={props.exploreBudgetValue}
                     onChange={v => props.onExploreBudgetValueChange(v ?? 0)}
                     min={0}
                     style={{ flex: 1 }}
                     prefix={props.exploreTradeoff === 'price' ? '₽' : undefined}
                   />
                </div>
             )}
          </div>
        </div>
      </Card>
      <ModFilter
        availableMods={props.availableMods}
        loadingMods={props.loadingMods}
        modCategoryOptions={props.modCategoryOptions}
        includedCategories={props.includedCategories}
        excludedCategories={props.excludedCategories}
        onIncludedCategoriesChange={props.onIncludedCategoriesChange}
        onExcludedCategoriesChange={props.onExcludedCategoriesChange}
        includedModIds={props.includedModIds}
        excludedModIds={props.excludedModIds}
        onIncludedModIdsChange={props.onIncludedModIdsChange}
        onExcludedModIdsChange={props.onExcludedModIdsChange}
        categorySearch={props.categorySearch}
        onCategorySearchChange={props.onCategorySearchChange}
        modSearch={props.modSearch}
        onModSearchChange={props.onModSearchChange}
      />
      <LevelConfig
        fleaAvailable={props.fleaAvailable}
        onFleaChange={props.onFleaChange}
        barterAvailable={props.barterAvailable}
        onBarterChange={props.onBarterChange}
        barterExcludeDogtags={props.barterExcludeDogtags}
        onBarterExcludeDogsChange={props.onBarterExcludeDogsChange}
        playerLevel={props.playerLevel}
        onPlayerLevelChange={props.onPlayerLevelChange}
        traderLevels={props.traderLevels}
        onTraderLevelsChange={props.onTraderLevelsChange}
      />
    </div>
  )
}
