import { WeaponSelector } from '../common/WeaponSelector'
import { WeightAdjuster } from '../common/WeightAdjuster'
import { ModFilter } from '../common/ModFilter'
import { LevelConfig } from '../common/LevelConfig'
import type { Gun, ModInfo, ModCategoryOption } from '../../api/client'
import type { TraderLevels } from '../../solver/types'

interface OptimizePanelProps {
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
  ergoWeight: number
  recoilWeight: number
  priceWeight: number
  onWeightChange: (ergo: number, recoil: number, price: number) => void
  useBudget: boolean
  onUseBudgetChange: (v: boolean) => void
  maxPrice: number
  onMaxPriceChange: (v: number) => void
  minErgo: number
  onMinErgoChange: (v: number) => void
  useMinMag: boolean
  onUseMinMagChange: (v: boolean) => void
  minMagCapacity: number
  onMinMagCapacityChange: (v: number) => void
  availableMagCapacities: number[]
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

export function OptimizePanel(props: OptimizePanelProps) {
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
      <WeightAdjuster
        ergoWeight={props.ergoWeight}
        recoilWeight={props.recoilWeight}
        priceWeight={props.priceWeight}
        onWeightChange={props.onWeightChange}
        useBudget={props.useBudget}
        onUseBudgetChange={props.onUseBudgetChange}
        maxPrice={props.maxPrice}
        onMaxPriceChange={props.onMaxPriceChange}
        minErgo={props.minErgo}
        onMinErgoChange={props.onMinErgoChange}
        useMinMag={props.useMinMag}
        onUseMinMagChange={props.onUseMinMagChange}
        minMagCapacity={props.minMagCapacity}
        onMinMagCapacityChange={props.onMinMagCapacityChange}
        availableMagCapacities={props.availableMagCapacities}
      />
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
