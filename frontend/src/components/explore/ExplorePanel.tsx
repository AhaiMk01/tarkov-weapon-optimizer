import { useTranslation } from 'react-i18next'
import { Card, Checkbox, InputNumber, Select, Space } from 'antd'
import { WeaponSelector } from '../common/WeaponSelector'
import { ModFilter } from '../common/ModFilter'
import { LevelConfig } from '../common/LevelConfig'
import type { Gun, ModInfo, ModCategoryOption } from '../../api/client'
import type { TraderLevels } from '../../solver/types'

interface ExplorePanelProps {
  guns: Gun[]
  selectedGunId: string
  onGunChange: (id: string) => void
  selectedCategory: string
  onCategoryChange: (category: string) => void
  selectedCaliber: string
  onCaliberChange: (caliber: string) => void
  categories: string[]
  calibers: string[]
  filteredGuns: Gun[]
  exploreTradeoff: 'price' | 'recoil' | 'ergo'
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
        selectedCategory={props.selectedCategory}
        onCategoryChange={props.onCategoryChange}
        selectedCaliber={props.selectedCaliber}
        onCaliberChange={props.onCaliberChange}
        categories={props.categories}
        calibers={props.calibers}
        filteredGuns={props.filteredGuns}
      />
      <Card size="small" title={<span style={{ userSelect: 'none' }}>{t('explore.tradeoff_strategy')}</span>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Select style={{ width: '100%' }} value={props.exploreTradeoff} onChange={props.onExploreTradeoffChange} options={[
            { value: 'price', label: t('ui.tradeoff_ergo_vs_recoil') },
            { value: 'recoil', label: t('ui.tradeoff_ergo_vs_price') },
            { value: 'ergo', label: t('ui.tradeoff_recoil_vs_price') },
          ]} />
          <Space>
            <Checkbox checked={props.useExploreBudget} onChange={e => props.onUseExploreBudgetChange(e.target.checked)}>
              {props.exploreTradeoff === 'price' ? t('explore.limit_price') : props.exploreTradeoff === 'recoil' ? t('explore.limit_recoil') : t('explore.limit_ergo')}
            </Checkbox>
            <InputNumber
              size="small"
              disabled={!props.useExploreBudget}
              value={props.exploreBudgetValue}
              onChange={v => props.onExploreBudgetValueChange(v ?? 0)}
              min={0}
              style={{ width: 120 }}
              addonAfter={props.exploreTradeoff === 'price' ? '₽' : undefined}
            />
          </Space>
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
        playerLevel={props.playerLevel}
        onPlayerLevelChange={props.onPlayerLevelChange}
        traderLevels={props.traderLevels}
        onTraderLevelsChange={props.onTraderLevelsChange}
      />
    </div>
  )
}
