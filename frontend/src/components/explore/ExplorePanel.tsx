import { useTranslation } from 'react-i18next'
import { Card, Select } from 'antd'
import { WeaponSelector } from '../common/WeaponSelector'
import { ModFilter } from '../common/ModFilter'
import { LevelConfig } from '../common/LevelConfig'
import type { Gun, ModInfo } from '../../api/client'

interface TraderLevels {
  prapor: number
  skier: number
  peacekeeper: number
  mechanic: number
  jaeger: number
}

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
  availableMods: ModInfo[]
  loadingMods: boolean
  modCategories: string[]
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
      <Card size="small" title={<span style={{ userSelect: 'none' }}>{t('explore.tradeoff_strategy', '权衡策略')}</span>}>
        <Select style={{ width: '100%' }} value={props.exploreTradeoff} onChange={props.onExploreTradeoffChange} options={[
          { value: 'price', label: t('ui.tradeoff_ergo_vs_recoil', '人机 vs 后坐 (忽略价格)') },
          { value: 'recoil', label: t('ui.tradeoff_ergo_vs_price', '人机 vs 价格 (忽略后坐)') },
          { value: 'ergo', label: t('ui.tradeoff_recoil_vs_price', '后坐 vs 价格 (忽略人机)') },
        ]} />
      </Card>
      <ModFilter
        availableMods={props.availableMods}
        loadingMods={props.loadingMods}
        modCategories={props.modCategories}
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
        playerLevel={props.playerLevel}
        onPlayerLevelChange={props.onPlayerLevelChange}
        traderLevels={props.traderLevels}
        onTraderLevelsChange={props.onTraderLevelsChange}
      />
    </div>
  )
}
