import { WeaponSelector } from '../common/WeaponSelector'
import { WeightAdjuster } from '../common/WeightAdjuster'
import { ModFilter } from '../common/ModFilter'
import { LevelConfig } from '../common/LevelConfig'
import { AdvancedOptions } from '../common/AdvancedOptions'
import type { Gun, ModInfo, ModCompatibility, ModCategoryOption, PrecisionRequest } from '../../api/client'
import type { TraderLevels } from '../../solver/types'
import type { FloorView } from '../common/floorView'

interface OptimizePanelProps {
  guns: Gun[]
  selectedGunId: string
  onGunChange: (id: string) => void
  ergoWeight: number
  recoilWeight: number
  priceWeight: number
  onWeightChange: (ergo: number, recoil: number, price: number) => void
  useTrueErgo: boolean
  onUseTrueErgoChange: (v: boolean) => void
  /** Sweet Spot Mode: shown in the Advanced menu. */
  useTchebycheff: boolean
  onUseTchebycheffChange: (v: boolean) => void
  solverPrecision: PrecisionRequest
  onSolverPrecisionChange: (v: PrecisionRequest) => void
  allowRepeatedParts: boolean
  onAllowRepeatedPartsChange: (v: boolean) => void
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
  useMOA: boolean
  onUseMOAChange: (v: boolean) => void
  maxMOA: number
  onMaxMOAChange: (v: number) => void
  moaRange: { base: number; min: number; max: number }
  useExactMOAFloor: boolean
  onUseExactMOAFloorChange: (v: boolean) => void
  preventOverswing: boolean
  onPreventOverswingChange: (v: boolean) => void
  equipErgoPenalty: number
  onEquipErgoPenaltyChange: (v: number) => void
  computingMOAFloor: boolean
  moaFloor: FloorView | null
  moaFloorError: string | null
  onCancelMOAFloor: () => void
  cancellingMOAFloor: boolean
  onRetryMOAFloor: () => void
  availableMods: ModInfo[]
  modCompat?: ModCompatibility
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
  onToggleModInclude: (id: string) => void
  onToggleModExclude: (id: string) => void
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

export function OptimizePanel(props: OptimizePanelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <WeaponSelector
        guns={props.guns}
        selectedGunId={props.selectedGunId}
        onGunChange={props.onGunChange}
      />
      <WeightAdjuster
        ergoWeight={props.ergoWeight}
        recoilWeight={props.recoilWeight}
        priceWeight={props.priceWeight}
        onWeightChange={props.onWeightChange}
        useTrueErgo={props.useTrueErgo}
        onUseTrueErgoChange={props.onUseTrueErgoChange}
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
        useMOA={props.useMOA}
        onUseMOAChange={props.onUseMOAChange}
        maxMOA={props.maxMOA}
        onMaxMOAChange={props.onMaxMOAChange}
        preventOverswing={props.preventOverswing}
        onPreventOverswingChange={props.onPreventOverswingChange}
        equipErgoPenalty={props.equipErgoPenalty}
        onEquipErgoPenaltyChange={props.onEquipErgoPenaltyChange}
        moaRange={props.moaRange}
        useExactMOAFloor={props.useExactMOAFloor}
        onUseExactMOAFloorChange={props.onUseExactMOAFloorChange}
        computingMOAFloor={props.computingMOAFloor}
        moaFloor={props.moaFloor}
        moaFloorError={props.moaFloorError}
        onCancelMOAFloor={props.onCancelMOAFloor}
        cancellingMOAFloor={props.cancellingMOAFloor}
        onRetryMOAFloor={props.onRetryMOAFloor}
      />
      <ModFilter
        availableMods={props.availableMods}
        modCompat={props.modCompat}
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
        onToggleModInclude={props.onToggleModInclude}
        onToggleModExclude={props.onToggleModExclude}
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
      <AdvancedOptions
        solverPrecision={props.solverPrecision}
        onSolverPrecisionChange={props.onSolverPrecisionChange}
        allowRepeatedParts={props.allowRepeatedParts}
        onAllowRepeatedPartsChange={props.onAllowRepeatedPartsChange}
        useTchebycheff={props.useTchebycheff}
        onUseTchebycheffChange={props.onUseTchebycheffChange}
      />
    </div>
  )
}
