declare const __APP_VERSION__: string;

import { lazy, Suspense, useState, useEffect, useMemo, useRef, useCallback, useSyncExternalStore, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfigProvider, Layout, Select, Segmented, Spin, message, App as AntApp, theme, Typography, Tag, Space, Grid, Dropdown, Button, Tooltip } from 'antd'
import { ThunderboltOutlined, BarChartOutlined, ToolOutlined, MoonOutlined, MenuOutlined, BlockOutlined, GithubOutlined, CloudOutlined, HistoryOutlined, ReloadOutlined, BulbOutlined } from '@ant-design/icons'
import { getInfo, optimize, explore, getWeaponMods, getGunsmithTasks, computeMOAFloor, clearDataCache } from './api/client'
import type { Gun, OptimizeResponse, ModInfo, ModCompatibility, ModCategoryOption, GunsmithTask, GameMode, PrecisionRequest } from './api/client'
import { exploreRequestOf, floorRequestKey, floorRequestOf, gunsmithRequestOf, optimizeRequestOf } from './api/requestDomain'
import type { RequestDomainState } from './api/requestDomain'
import { ResponsiveLayout } from './layouts/ResponsiveLayout'
import { shoppingListLines } from './components/common/shoppingList'
import { useRequestController } from './components/common/useRequestController'
import { authorityOf, qualifierKey } from './components/common/resultView'
import { ALLOW_REPEATED_PARTS_STORAGE_KEY, readAllowRepeatedParts } from './components/common/advancedDefaults'
import { moaSliderRange } from './components/common/floorView'
import type { ExploreTradeoff } from './runs/runState'
import { createRunLifecycle } from './runs/runLifecycle'
import { OptimizePanel } from './components/optimize/OptimizePanel'
import { OptimizeResult } from './components/optimize/OptimizeResult'
import { ExplorePanel } from './components/explore/ExplorePanel'
import { GunsmithPanel } from './components/gunsmith/GunsmithPanel'
import { GunsmithResult } from './components/gunsmith/GunsmithResult'
import { FLAGS, type FlagCode } from './flags'
import { amoledDarkToken } from './theme/amoledDark'
import { darkPaletteTokens, type DarkPaletteId } from './theme/darkPalettes'
import { onColor } from './theme/contrast'
import { lightPaletteTokens, type LightPaletteId } from './theme/lightPalettes'
import { includeCategoryInModFilter } from './solver/modCategoryFilter'
import { DEFAULT_TRADER_LEVELS, TRADER_DISABLED, type TraderLevels } from './solver/types'

const { Header, Content, Footer } = Layout
const { Text, Link } = Typography

/** Author GitHub profile (footer link). */
const GITHUB_PROFILE_URL = 'https://github.com/AhaiMk01'
/** Game item / mod API and site credit. */
const TARKOV_DEV_URL = 'https://tarkov.dev'
const { useToken } = theme

const ChangelogModal = lazy(() => import('./components/common/ChangelogModal').then(m => ({ default: m.ChangelogModal })))
const MethodologyModal = lazy(() => import('./components/common/MethodologyModal').then(m => ({ default: m.MethodologyModal })))
const ExploreResult = lazy(() => import('./components/explore/ExploreResult').then(m => ({ default: m.ExploreResult })))

const Flag = ({ country, style, className }: { country: FlagCode; style?: CSSProperties; className?: string }) => (
  <img src={FLAGS[country]} width={20} height={15} alt="" className={className} style={{ width: '1.333333em', height: '1em', ...style }} />
)

const languages: { code: string; name: string; country: FlagCode }[] = [
  { code: 'en', name: 'English', country: 'us' },
  { code: 'ru', name: 'Русский', country: 'ru' },
  { code: 'zh', name: '中文', country: 'cn' },
  { code: 'es', name: 'Español', country: 'es' },
  { code: 'de', name: 'Deutsch', country: 'de' },
  { code: 'fr', name: 'Français', country: 'fr' },
  { code: 'it', name: 'Italiano', country: 'it' },
  { code: 'ja', name: '日本語', country: 'jp' },
  { code: 'ko', name: '한국어', country: 'kr' },
  { code: 'pl', name: 'Polski', country: 'pl' },
  { code: 'pt', name: 'Português', country: 'br' },
  { code: 'tr', name: 'Türkçe', country: 'tr' },
  { code: 'cs', name: 'Čeština', country: 'cz' },
  { code: 'hu', name: 'Magyar', country: 'hu' },
  { code: 'ro', name: 'Română', country: 'ro' },
  { code: 'sk', name: 'Slovenčina', country: 'sk' },
]

/** Current theme preference (canonical localStorage key). */
const THEME_STORAGE_KEY = 'theme'
/** Legacy keys — read once for migration, removed on save. */
const THEME_CHOICE_LEGACY = 'themeChoice'
const THEME_MODE_LEGACY = 'themeMode'
const AUTO_DARK_PALETTE_KEY = 'autoDarkPalette'
const AUTO_LIGHT_PALETTE_KEY = 'autoLightPalette'
const LEVEL_CONFIG_STORAGE_KEY = 'levelConfig'

/** PvP = `regular`, PvP season = `pvp-season`, PvE = `pve` (matches API / Tarkov.dev). */
const GAME_MODE_STORAGE_KEY = 'mode'
const GAME_MODE_LEGACY_KEY = 'gameMode'

const TRADER_LEVEL_KEYS: (keyof TraderLevels)[] = ['prapor', 'skier', 'peacekeeper', 'mechanic', 'jaeger', 'ref']

function readStoredGameMode(): GameMode {
  const fromMode = localStorage.getItem(GAME_MODE_STORAGE_KEY)
  const fromLegacy = localStorage.getItem(GAME_MODE_LEGACY_KEY)
  const raw = fromMode ?? fromLegacy
  const result: GameMode = raw === 'pve' || raw === 'pvp-season' ? raw : 'regular'
  if (!fromMode && fromLegacy) {
    try {
      localStorage.setItem(GAME_MODE_STORAGE_KEY, result)
      localStorage.removeItem(GAME_MODE_LEGACY_KEY)
    } catch {
      /* ignore */
    }
  }
  return result
}

function readStoredLevelConfig(): { playerLevel: number; fleaAvailable: boolean; barterAvailable: boolean; barterExcludeDogtags: boolean; traderLevels: TraderLevels } {
  const fallback = { playerLevel: 60, fleaAvailable: true, barterAvailable: false, barterExcludeDogtags: true, traderLevels: { ...DEFAULT_TRADER_LEVELS } }
  try {
    const raw = localStorage.getItem(LEVEL_CONFIG_STORAGE_KEY)
    if (!raw) return fallback
    const o = JSON.parse(raw) as {
      playerLevel?: unknown
      fleaAvailable?: unknown
      barterAvailable?: unknown
      barterExcludeDogtags?: unknown
      traderLevels?: Record<string, unknown>
    }
    const traderLevels = { ...DEFAULT_TRADER_LEVELS }
    if (o.traderLevels && typeof o.traderLevels === 'object') {
      for (const k of TRADER_LEVEL_KEYS) {
        const v = o.traderLevels[k as string]
        // TRADER_DISABLED (0) is a valid stored value — a trader the user turned
        // off must stay off across reloads, so the floor here is 0, not 1.
        if (typeof v === 'number' && Number.isInteger(v) && v >= TRADER_DISABLED && v <= 4) {
          traderLevels[k] = v
        }
      }
    }
    let playerLevel = fallback.playerLevel
    if (typeof o.playerLevel === 'number' && Number.isFinite(o.playerLevel)) {
      playerLevel = Math.max(1, Math.min(79, Math.round(o.playerLevel)))
    }
    const fleaAvailable = typeof o.fleaAvailable === 'boolean' ? o.fleaAvailable : fallback.fleaAvailable
    const barterAvailable = typeof o.barterAvailable === 'boolean' ? o.barterAvailable : fallback.barterAvailable
    const barterExcludeDogtags = typeof o.barterExcludeDogtags === 'boolean' ? o.barterExcludeDogtags : fallback.barterExcludeDogtags
    return { playerLevel, fleaAvailable, barterAvailable, barterExcludeDogtags, traderLevels }
  } catch {
    return fallback
  }
}

export type ThemeChoice =
  | 'light_primer'
  | 'light_paper'
  | 'light_latte'
  | 'auto'
  | 'amoled'
  | 'dark_onedark'
  | 'dark_github'
  | 'dark_tokyo'

function choiceToDarkPalette(c: ThemeChoice): DarkPaletteId | null {
  if (c === 'dark_onedark') return 'onedark'
  if (c === 'dark_github') return 'github'
  if (c === 'dark_tokyo') return 'tokyo'
  return null
}

function choiceToLightPalette(c: ThemeChoice): LightPaletteId | null {
  if (c === 'light_primer') return 'primer'
  if (c === 'light_paper') return 'paper'
  if (c === 'light_latte') return 'latte'
  return null
}

function normalizeStoredThemeRaw(raw: string | null): ThemeChoice {
  if (!raw) return 'dark_onedark'
  // Light themes disabled — fall back to dark
  if (raw === 'light_primer' || raw === 'light_paper' || raw === 'light_latte' || raw === 'light') return 'dark_onedark'
  if (raw === 'auto') return 'dark_onedark'
  if (raw === 'amoled') return raw
  if (raw === 'dark_onedark' || raw === 'dark_github' || raw === 'dark_tokyo') return raw
  if (raw === 'dark') return 'dark_onedark'
  return 'dark_onedark'
}

function readStoredThemeChoice(): ThemeChoice {
  const fromTheme = localStorage.getItem(THEME_STORAGE_KEY)
  const fromLegacy =
    localStorage.getItem(THEME_CHOICE_LEGACY) ?? localStorage.getItem(THEME_MODE_LEGACY)
  const result = normalizeStoredThemeRaw(fromTheme ?? fromLegacy)
  if (!fromTheme && fromLegacy) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, result)
      localStorage.removeItem(THEME_CHOICE_LEGACY)
      localStorage.removeItem(THEME_MODE_LEGACY)
    } catch {
      /* ignore quota / private mode */
    }
  }
  return result
}

function readStoredAutoDarkPalette(): DarkPaletteId {
  const raw = localStorage.getItem(AUTO_DARK_PALETTE_KEY)
  if (raw === 'github' || raw === 'tokyo' || raw === 'onedark') return raw
  return 'onedark'
}

function readStoredAutoLightPalette(): LightPaletteId {
  const raw = localStorage.getItem(AUTO_LIGHT_PALETTE_KEY)
  if (raw === 'primer' || raw === 'paper' || raw === 'latte') return raw
  return 'primer'
}

function initialAutoDarkPalette(): DarkPaletteId {
  return choiceToDarkPalette(readStoredThemeChoice()) ?? readStoredAutoDarkPalette()
}

function initialAutoLightPalette(): LightPaletteId {
  return choiceToLightPalette(readStoredThemeChoice()) ?? readStoredAutoLightPalette()
}

function modCategoryOptionsFrom(mods: ModInfo[]): ModCategoryOption[] {
  const usedIds = new Set(mods.map(m => m.category_id).filter(Boolean))
  const byId = new Map<string, { name: string; normalized: string; childIds: string[] }>()
  for (const m of mods) {
    if (!m.category_id || !m.category) continue
    if (!byId.has(m.category_id)) {
      const displayName = (m.handbook_categories && m.handbook_categories.length > 0)
        ? m.handbook_categories[0]
        : (m.category.split(' > ').pop() || m.category)
      byId.set(m.category_id, {
        name: displayName,
        normalized: m.category_normalized ?? '',
        childIds: m.category_child_ids ?? [],
      })
    }
  }
  return [...byId.entries()]
    .filter(([, meta]) =>
      includeCategoryInModFilter({
        categoryNormalized: meta.normalized,
        childCategoryIds: meta.childIds,
        usedCategoryIds: usedIds,
      }),
    )
    .map(([id, meta]) => ({ id, name: meta.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function AppContent({
  themeChoice,
  setThemeChoice,
}: {
  themeChoice: ThemeChoice
  setThemeChoice: (c: ThemeChoice) => void
}) {
  const { t, i18n } = useTranslation()
  const { token } = useToken()
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  const [messageApi, contextHolder] = message.useMessage()
  const [gameMode, setGameMode] = useState<GameMode>(() => readStoredGameMode())
  const [guns, setGuns] = useState<Gun[]>([])
  const [selectedGunId, setSelectedGunId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [availableMods, setAvailableMods] = useState<ModInfo[]>([])
  const [modCompat, setModCompat] = useState<ModCompatibility>({ conflicts: {}, slots_by_item: {} })
  const [loadingMods, setLoadingMods] = useState(false)
  const [ergoWeight, setErgoWeight] = useState(33)
  const [recoilWeight, setRecoilWeight] = useState(34)
  const [priceWeight, setPriceWeight] = useState(33)
  const [useTrueErgo, setUseTrueErgo] = useState<boolean>(() => (localStorage.getItem('useTrueErgo') ?? localStorage.getItem('useEvoErgo')) === 'true')
  const [useTchebycheff, setUseTchebycheff] = useState<boolean>(() => localStorage.getItem('useTchebycheff') === 'true')
  const [useBudget, setUseBudget] = useState(false)
  const [maxPrice, setMaxPrice] = useState(200000)
  const [minErgo, setMinErgo] = useState(0)
  const [useMinMag, setUseMinMag] = useState(false)
  const [minMagCapacity, setMinMagCapacity] = useState(0)
  const [useMOA, setUseMOA] = useState(false)
  const [preventOverswing, setPreventOverswing] = useState<boolean>(() => localStorage.getItem('preventOverswing') === 'true')
  const [equipErgoPenalty, setEquipErgoPenalty] = useState<number>(() => Number(localStorage.getItem('equipErgoPenalty') ?? 0))
  const [maxMOA, setMaxMOA] = useState(0)
  const [useExactMOAFloor, setUseExactMOAFloor] = useState<boolean>(() => localStorage.getItem('useExactMOAFloor') !== 'false')
  /** Raised by the Retry button: asks the floor again for an unchanged domain after a cancel or a failure. */
  const [floorRetry, setFloorRetry] = useState(0)
  const [includedModIds, setIncludedModIds] = useState<string[]>([])
  const [excludedModIds, setExcludedModIds] = useState<string[]>([])
  const [modSearch, setModSearch] = useState('')
  const [includedCategories, setIncludedCategories] = useState<string[]>([])
  const [excludedCategories, setExcludedCategories] = useState<string[]>([])
  const [categorySearch, setCategorySearch] = useState('')
  const initialLevelConfig = useMemo(() => readStoredLevelConfig(), [])
  const [playerLevel, setPlayerLevel] = useState(initialLevelConfig.playerLevel)
  const [fleaAvailable, setFleaAvailable] = useState(initialLevelConfig.fleaAvailable)
  const [barterAvailable, setBarterAvailable] = useState(initialLevelConfig.barterAvailable)
  const [barterExcludeDogtags, setBarterExcludeDogtags] = useState(initialLevelConfig.barterExcludeDogtags)
  const [solverPrecision, setSolverPrecision] = useState<PrecisionRequest>(() => {
    const s = localStorage.getItem('solverPrecision')
    if (s === 'fast' || s === 'precise' || s === 'auto') return s
    return 'auto'
  })
  /** Advanced menu, Fast only: allow several copies of one part (default off: one copy of each part). Precise ignores it. */
  const [allowRepeatedParts, setAllowRepeatedParts] = useState<boolean>(() => readAllowRepeatedParts(localStorage.getItem(ALLOW_REPEATED_PARTS_STORAGE_KEY)))
  const [traderLevels, setTraderLevels] = useState(initialLevelConfig.traderLevels)
  const [activeTab, setActiveTab] = useState<string>('optimize')
  const [viewMode, setViewMode] = useState<'detailed' | 'compact' | 'table'>(() => {
    const s = localStorage.getItem('viewMode')
    if (s === 'detailed' || s === 'compact' || s === 'table') return s
    // Migration from old compactMode
    if (localStorage.getItem('compactMode') === 'true') return 'compact'
    return 'detailed'
  })
  const [exploreTradeoff, setExploreTradeoff] = useState<ExploreTradeoff>('price')
  /** Sweep granularity per weapon. Costs roughly one solve per step, per weapon,
   *  so it multiplies with the number of weapons being compared. */
  const [exploreSteps, setExploreSteps] = useState(10)
  const [exploreWeaponIds, setExploreWeaponIds] = useState<string[]>([])
  const [exploreAvailableMods, setExploreAvailableMods] = useState<ModInfo[]>([])
  const [loadingExploreMods, setLoadingExploreMods] = useState(false)
  const exploreModsRequestSeq = useRef(0)
  const [useExploreBudget, setUseExploreBudget] = useState(false)
  const [exploreBudgetValue, setExploreBudgetValue] = useState<number>(0)
  const [gunsmithTasks, setGunsmithTasks] = useState<GunsmithTask[]>([])
  const [selectedTaskName, setSelectedTaskName] = useState<string>('')
  const modsRequestSeq = useRef(0)
  const [changelogOpen, setChangelogOpen] = useState<boolean | null>(null)
  const [methodologyOpen, setMethodologyOpen] = useState<boolean | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const messageApiRef = useRef(messageApi)
  messageApiRef.current = messageApi
  const tRef = useRef(t)
  tRef.current = t
  const optimizeCtl = useRequestController()
  const exploreCtl = useRequestController()
  const gunsmithCtl = useRequestController()
  const floorCtl = useRequestController()
  /** The run lifecycle (`runs/`): sequences every Optimize, Explore, Gunsmith and MOA floor request; the component renders what it holds. */
  const [runs] = useState(() => createRunLifecycle({
    api: { optimize, explore, computeMOAFloor },
    controllers: { optimize: optimizeCtl, explore: exploreCtl, gunsmith: gunsmithCtl, floor: floorCtl },
    // A finished request says what its result's headline says: never "complete" for anything but a proved optimum.
    announce: toast => { messageApiRef.current[toast.type](tRef.current(toast.key, toast.params)) },
    logError: (message, error) => console.error(message, error),
    setTimer: (fn, ms) => {
      const timer = setTimeout(fn, ms)
      return () => clearTimeout(timer)
    },
  }))
  const { optimize: optimizeRun, explore: exploreRun, gunsmith: gunsmithRun, floor } = useSyncExternalStore(runs.subscribe, runs.getState)

  const handleForceRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await clearDataCache()
      messageApi.success(t('toast.refresh_done'))
      setTimeout(() => window.location.reload(), 400)
    } catch (err) {
      console.error('Force refresh failed', err)
      messageApi.error(t('toast.refresh_failed'))
      setRefreshing(false)
    }
  }

  useEffect(() => {
    localStorage.setItem(GAME_MODE_STORAGE_KEY, gameMode)
    localStorage.removeItem(GAME_MODE_LEGACY_KEY)
  }, [gameMode])
  useEffect(() => { localStorage.setItem('viewMode', viewMode) }, [viewMode])
  useEffect(() => { localStorage.setItem('solverPrecision', solverPrecision) }, [solverPrecision])
  useEffect(() => { localStorage.setItem(ALLOW_REPEATED_PARTS_STORAGE_KEY, String(allowRepeatedParts)) }, [allowRepeatedParts])
  useEffect(() => { localStorage.setItem('useExactMOAFloor', String(useExactMOAFloor)) }, [useExactMOAFloor])
  useEffect(() => { localStorage.setItem('useTrueErgo', String(useTrueErgo)); localStorage.removeItem('useEvoErgo') }, [useTrueErgo])
  useEffect(() => { localStorage.setItem('useTchebycheff', String(useTchebycheff)) }, [useTchebycheff])
  useEffect(() => { localStorage.setItem('preventOverswing', String(preventOverswing)) }, [preventOverswing])
  useEffect(() => { localStorage.setItem('equipErgoPenalty', String(equipErgoPenalty)) }, [equipErgoPenalty])
  useEffect(() => {
    localStorage.setItem(
      LEVEL_CONFIG_STORAGE_KEY,
      JSON.stringify({ playerLevel, fleaAvailable, barterAvailable, barterExcludeDogtags, traderLevels }),
    )
  }, [playerLevel, fleaAvailable, barterAvailable, barterExcludeDogtags, traderLevels])
  // Canonical theme list. Icon and text are kept apart so the same entry can
  // render as a full-width Select row (mobile sheet) and as a bare icon on the
  // header's compact trigger button.
  const themeOptions = useMemo(
    () => [
      // Light themes disabled — item images lack transparent backgrounds
      // { value: 'light_primer' as const, icon: <SunOutlined />, label: t('ui.theme_light_primer') },
      // { value: 'light_paper' as const, icon: <ReadOutlined />, label: t('ui.theme_light_paper') },
      // { value: 'light_latte' as const, icon: <CoffeeOutlined />, label: t('ui.theme_light_latte') },
      { value: 'dark_onedark' as const, icon: <MoonOutlined />, label: t('ui.theme_dark_onedark') },
      { value: 'dark_github' as const, icon: <GithubOutlined />, label: t('ui.theme_dark_github') },
      { value: 'dark_tokyo' as const, icon: <CloudOutlined />, label: t('ui.theme_dark_tokyo') },
      { value: 'amoled' as const, icon: <BlockOutlined />, label: t('ui.theme_amoled') },
      // { value: 'auto' as const, icon: <SyncOutlined />, label: t('ui.theme_auto') },
    ],
    [t],
  )
  const gameModeOptions = [
    { label: t('ui.pvp'), value: 'regular' },
    { label: t('ui.pvp_season'), value: 'pvp-season', tooltip: t('ui.pvp_season_tooltip') },
    { label: t('ui.pve'), value: 'pve' },
  ]
  const themeSelectOptions = useMemo(
    () => themeOptions.map(o => ({ value: o.value, label: <Space size={6}>{o.icon}{o.label}</Space> })),
    [themeOptions],
  )
  const activeTheme = themeOptions.find(o => o.value === themeChoice) ?? themeOptions[0]
  const activeLanguage = languages.find(l => i18n.language?.startsWith(l.code)) ?? languages[0]
  useEffect(() => {
    document.title = t('app.title')
    document.documentElement.lang = i18n.language?.split('-')[0] || 'en'
  }, [t, i18n.language])

  useEffect(() => {
    setLoading(true)
    runs.clearResults()
    const lang = i18n.language || 'en'
    const startTime = Date.now()
    const minLoadTime = 500
    Promise.all([getInfo(gameMode, lang), getGunsmithTasks(gameMode, lang)])
      .then(([infoData, tasksData]) => {
        setGuns(infoData.guns)
        if (infoData.guns.length > 0) {
          const first = infoData.guns[0].id
          setSelectedGunId(first)
          setExploreWeaponIds(prev => {
            if (prev.length > 1) {
              const valid = prev.filter(id => infoData.guns.some(g => g.id === id))
              return valid.length > 0 ? valid : [first]
            }
            return [first]
          })
        }
        setGunsmithTasks(tasksData.tasks)
        if (tasksData.tasks.length > 0) setSelectedTaskName(tasksData.tasks[0].task_name)
        const elapsed = Date.now() - startTime
        const remaining = Math.max(0, minLoadTime - elapsed)
        setTimeout(() => setLoading(false), remaining)
      })
      .catch(err => {
        console.error('Failed to fetch data', err)
        setLoading(false)
        messageApiRef.current.error(t('toast.load_failed'))
      })
    // t follows i18n.language (already a dependency)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- avoid redundant effect re-runs
  }, [gameMode, i18n.language])

  // The request domain of the current controls, shared by Optimize, Explore and the MOA floor. The floor is asked about the SAME hard constraints and
  // acquisition settings as Optimize (everything except the MOA cap it searches), not just the weapon id.
  const domainState = useMemo<RequestDomainState>(() => ({
    weaponId: selectedGunId,
    useBudget,
    maxPrice,
    minErgo,
    useMinMag,
    minMagCapacity,
    useTrueErgo,
    preventOverswing,
    equipErgoPenalty,
    includedModIds,
    excludedModIds,
    includedCategories,
    excludedCategories,
    traderLevels,
    playerLevel,
    fleaAvailable,
    barterAvailable,
    barterExcludeDogtags,
  }), [selectedGunId, useBudget, maxPrice, minErgo, useMinMag, minMagCapacity, useTrueErgo, preventOverswing, equipErgoPenalty, includedModIds, excludedModIds,
    includedCategories, excludedCategories, traderLevels, playerLevel, fleaAvailable, barterAvailable, barterExcludeDogtags])
  const floorRequest = useMemo(() => floorRequestOf(domainState), [domainState])
  const floorKey = floorRequestKey(floorRequest, gameMode, i18n.language || 'en')

  // The MOA floor only drives the MOA control, so it is asked while that control is on, about the full request domain. A change of the domain asks
  // again (after a short pause, so dragging a slider does not start a solve per tick) and cancels the answer in flight.
  useEffect(
    () => runs.watchFloor(selectedGunId && useMOA && useExactMOAFloor ? floorRequest : null, gameMode, i18n.language || 'en'),
    // The key covers every input of the request; the request object itself is rebuilt with the state and must not restart the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [floorKey, useMOA, useExactMOAFloor, floorRetry],
  )

  useEffect(() => {
    if (!selectedGunId) return
    const seq = ++modsRequestSeq.current
    setLoadingMods(true)
    getWeaponMods(selectedGunId, gameMode, i18n.language || 'en', { withCompat: true })
      .then(data => {
        if (seq !== modsRequestSeq.current) return
        setAvailableMods(data.mods)
        setModCompat({ conflicts: data.conflicts ?? {}, slots_by_item: data.slots_by_item ?? {} })
        setLoadingMods(false)
      })
      .catch(err => {
        console.error('Failed to fetch mods', err)
        if (seq !== modsRequestSeq.current) return
        setLoadingMods(false)
      })
  }, [selectedGunId, gameMode, i18n.language])

  useEffect(() => {
    const ids = (exploreWeaponIds && exploreWeaponIds.length > 1)
      ? [...new Set(exploreWeaponIds)]
      : []
    if (ids.length <= 1) {
      exploreModsRequestSeq.current += 1
      setExploreAvailableMods([])
      setLoadingExploreMods(false)
      return
    }
    const seq = ++exploreModsRequestSeq.current
    setLoadingExploreMods(true)
    Promise.all(ids.map(id => getWeaponMods(id, gameMode, i18n.language || 'en')))
      .then(results => {
        if (seq !== exploreModsRequestSeq.current) return
        const byId = new Map<string, ModInfo>()
        for (const data of results) {
          for (const mod of data.mods) byId.set(mod.id, mod)
        }
        setExploreAvailableMods([...byId.values()])
        setLoadingExploreMods(false)
      })
      .catch(err => {
        console.error('Failed to fetch explore mods', err)
        if (seq !== exploreModsRequestSeq.current) return
        setLoadingExploreMods(false)
      })
  }, [exploreWeaponIds, gameMode, i18n.language])

  const exploreFilterAnchor = exploreWeaponIds[0] ?? selectedGunId
  useEffect(() => {
    setIncludedModIds([])
    setExcludedModIds([])
    setIncludedCategories([])
    setExcludedCategories([])
  }, [exploreFilterAnchor, gameMode, i18n.language])

  const modCategoryOptions = useMemo(() => modCategoryOptionsFrom(availableMods), [availableMods])
  const exploreComparing = exploreWeaponIds.length > 1
  const exploreFilterMods = exploreComparing ? exploreAvailableMods : availableMods
  const exploreModCategoryOptions = useMemo(() => modCategoryOptionsFrom(exploreFilterMods), [exploreFilterMods])
  const availableMagCapacities = useMemo(() => {
    const caps = availableMods.filter(m => m.capacity && m.capacity > 0).map(m => m.capacity!)
    return [...new Set(caps)].sort((a, b) => a - b)
  }, [availableMods])
  const selectedGun = guns.find(g => g.id === selectedGunId)
  const moaRange = useMemo(() => {
    const baseMOA = selectedGun?.base_moa ?? 0
    if (baseMOA <= 0) return { base: 0, min: 0, max: 0 }
    // Effective base MOA can be replaced by a barrel mod's centerOfImpact (stored as base_moa on mods).
    // Widest achievable range: combine barrel-COI extremes with accuracy-modifier extremes.
    const bestByCategory: Record<string, number> = {}
    const worstByCategory: Record<string, number> = {}
    let minBarrelMOA = Infinity
    let maxBarrelMOA = -Infinity
    for (const m of availableMods) {
      const acc = m.accuracy_modifier ?? 0
      if (acc !== 0) {
        const cat = m.category_id || 'unknown'
        if (acc > 0) bestByCategory[cat] = Math.max(bestByCategory[cat] ?? 0, acc)
        if (acc < 0) worstByCategory[cat] = Math.min(worstByCategory[cat] ?? 0, acc)
      }
      const barrelMOA = m.base_moa ?? 0
      if (barrelMOA > 0) {
        if (barrelMOA < minBarrelMOA) minBarrelMOA = barrelMOA
        if (barrelMOA > maxBarrelMOA) maxBarrelMOA = barrelMOA
      }
    }
    const bestMod = Object.values(bestByCategory).reduce((s, v) => s + v, 0)
    const worstMod = Object.values(worstByCategory).reduce((s, v) => s + v, 0)
    // If the weapon has any replaceable-barrel mod with a COI, its barrel slot is (almost always) required,
    // so the weapon's intrinsic COI is unreachable. Use only barrel COIs as the achievable base range.
    const hasReplaceableBarrel = minBarrelMOA < Infinity
    const effMin = hasReplaceableBarrel ? minBarrelMOA : baseMOA
    const effMax = hasReplaceableBarrel ? maxBarrelMOA : baseMOA
    const effBase = hasReplaceableBarrel ? minBarrelMOA : baseMOA
    // If the solver answered the floor (a result of the provisional MOA model), its display_floor is the lower end: it respects slot-graph
    // reachability, conflicts and the caller's constraints, and is already an outward 2-decimal value that is never below the achieved floor, so it
    // is used as it is. Otherwise fall back to the theoretical per-category sum (an estimate that may be unreachable), rounded up.
    const approxMin = Math.max(0, effMin * (1 - bestMod / 100))
    return {
      base: Math.round(effBase * 100) / 100,
      ...moaSliderRange(floor.view?.sliderMin ?? null, approxMin, effMax * (1 - worstMod / 100)),
    }
  }, [selectedGun, availableMods, floor.view])
  // The cap actually used: never below the lower end of the control. A floor that arrives after the user picked a value moves that end up, and a cap
  // below it could only report "no build under the MOA limit"; the control shows the same value.
  const effectiveMaxMOA = Math.max(maxMOA, moaRange.min)
  const selectedTask = gunsmithTasks.find(t => t.task_name === selectedTaskName)

  // Seed a default pick once data lands, and recover if the current id vanishes
  // across a language/game-mode reload. The category/caliber narrowing that used
  // to drive this now lives inside the weapon gallery as pure view state.
  useEffect(() => {
    if (exploreWeaponIds.length > 1) return
    if (guns.length > 0 && !guns.find(g => g.id === selectedGunId)) {
      const nextId = guns[0].id
      setSelectedGunId(nextId)
      setExploreWeaponIds(prev => prev.length <= 1 ? [nextId] : prev)
    }
  }, [guns, selectedGunId, exploreWeaponIds])

  const handleOptimize = () => {
    if (!selectedGunId) return
    void runs.run('optimize', () => optimizeRequestOf(domainState, {
      ergoWeight,
      recoilWeight,
      priceWeight,
      useTchebycheff,
      maxMoa: useMOA ? effectiveMaxMOA : null,
      precision: solverPrecision,
      allowRepeatedParts,
    }), gameMode, () => i18n.language || 'en')
  }

  const clearOptimizeGunExtras = () => {
    runs.clearOptimizeResult()
    setMinMagCapacity(0)
    setUseMOA(false)
    setMaxMOA(0)
    setUseMinMag(false)
  }

  const handleExploreWeaponIdsChange = (ids: string[]) => {
    const next = [...new Set(ids.filter(Boolean))]
    setExploreWeaponIds(next)
    if (next.length === 0) return
    if (next.length === 1) {
      if (next[0] !== selectedGunId) {
        setSelectedGunId(next[0])
        clearOptimizeGunExtras()
      }
      return
    }
    if (selectedGunId && !next.includes(selectedGunId)) {
      setSelectedGunId(next[0])
      clearOptimizeGunExtras()
    }
  }

  const handleExplore = () => {
    void runs.explore({
      weaponIds: exploreWeaponIds,
      tradeoff: exploreTradeoff,
      weaponName: id => guns.find(g => g.id === id)?.name ?? id,
      requestOf: id => exploreRequestOf({ ...domainState, weaponId: id }, {
        ignore: exploreTradeoff,
        steps: exploreSteps,
        maxMoa: useMOA ? effectiveMaxMOA : null,
        precision: solverPrecision,
        allowRepeatedParts,
        axisLimit: useExploreBudget ? exploreBudgetValue : null,
      }),
      gameMode,
      lang: i18n.language || 'en',
    })
  }

  const handleGunsmithOptimize = () => {
    if (!selectedTask) return
    void runs.run('gunsmith', () => gunsmithRequestOf(domainState, selectedTask, allowRepeatedParts), gameMode, () => i18n.language || 'en')
  }

  // Required and banned are one tri-state per part, so each toggle also clears
  // the other list -- otherwise a part could sit in both and the solve went
  // infeasible. Shared by the build manifest and the mod gallery; stable
  // identities because the gallery passes them to memoised cards.
  const toggleLock = useCallback((id: string) => {
    setIncludedModIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    setExcludedModIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev)
  }, [])
  const toggleExclude = useCallback((id: string) => {
    setExcludedModIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    setIncludedModIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev)
  }, [])

  const copyToClipboard = (content: string) => {
    const successMsg = t('toast.copied')
    const failMsg = t('toast.copy_failed')
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(content).then(() => messageApi.success(successMsg)).catch(() => fallbackCopy(content))
    } else {
      fallbackCopy(content)
    }
    function fallbackCopy(text: string) {
      const textArea = document.createElement('textarea')
      textArea.value = text
      textArea.style.position = 'fixed'
      textArea.style.left = '-9999px'
      document.body.appendChild(textArea)
      textArea.select()
      try {
        document.execCommand('copy')
        messageApi.success(successMsg)
      } catch {
        messageApi.error(failMsg)
      }
      document.body.removeChild(textArea)
    }
  }

  /** The words of the copied list. The list keeps the per-occurrence provenance (preset / owned / bought) and the true spend. */
  const shoppingLabels = {
    base: t('ui.shopping_base'),
    ownedBase: t('ui.owned_receiver_short'),
    preset: t('ui.acq_preset'),
    owned: t('ui.acq_owned'),
    barter: t('ui.barter_badge_long'),
    unknownSource: t('ui.unknown'),
  }

  /** The status line of a copied build: its authority, and the model it ran on, so a copied approximate or feasible build is not mistaken for a proved one. */
  const authorityLine = (res: OptimizeResponse) => {
    const authority = authorityOf(res)
    const caveats = authority.qualifiers.map(q => t(qualifierKey(q)))
    return `${t('results.optimization_status')}: ${t(authority.titleKey)}${caveats.length > 0 ? ` (${caveats.join(', ')})` : ''}`
  }

  const copyBuild = () => {
    const result = optimizeRun.result
    if (!result || !result.final_stats) return
    const lines = [
      `${selectedGun?.name} - ${t('ui.build_manifest')}`,
      authorityLine(result),
      '',
      `${t('sidebar.ergonomics')}: ${result.final_stats.ergonomics.toFixed(1)} | ${t('ui.vert_recoil')}: ${result.final_stats.recoil_vertical.toFixed(1)} | ${t('ui.horiz_recoil')}: ${result.final_stats.recoil_horizontal.toFixed(1)} | ${t('ui.weight_label')}: ${result.final_stats.total_weight.toFixed(2)}kg | ${t('ui.total_cost')}: ~ ₽${result.final_stats.total_price.toLocaleString()}`,
      '',
      `${t('ui.table_items')}:`,
      ...shoppingListLines(result, shoppingLabels)
    ]
    copyToClipboard(lines.join('\n'))
  }

  const copyGunsmithBuild = () => {
    const gunsmithResult = gunsmithRun.result
    if (!gunsmithResult || !gunsmithResult.final_stats || !selectedTask) return
    const lines = [
      `${selectedTask.task_name} - ${selectedTask.weapon_name}`,
      authorityLine(gunsmithResult),
      '',
      `${t('sidebar.ergonomics')}: ${gunsmithResult.final_stats.ergonomics.toFixed(1)} | ${t('ui.vert_recoil')}: ${gunsmithResult.final_stats.recoil_vertical.toFixed(1)} | ${t('ui.horiz_recoil')}: ${gunsmithResult.final_stats.recoil_horizontal.toFixed(1)} | ${t('ui.weight_label')}: ${gunsmithResult.final_stats.total_weight.toFixed(2)}kg | ${t('ui.total_cost')}: ~ ₽${gunsmithResult.final_stats.total_price.toLocaleString()}`,
      '',
      `${t('ui.table_items')}:`,
      ...shoppingListLines(gunsmithResult, shoppingLabels)
    ]
    copyToClipboard(lines.join('\n'))
  }

  const handleGunChange = (id: string) => {
    setSelectedGunId(id)
    setExploreWeaponIds(prev => prev.length <= 1 ? [id] : prev)
    clearOptimizeGunExtras()
  }

  const commonPanelProps = {
    guns,
    selectedGunId,
    onGunChange: handleGunChange,
    availableMods,
    modCompat,
    loadingMods,
    modCategoryOptions,
    includedCategories,
    excludedCategories,
    onIncludedCategoriesChange: setIncludedCategories,
    onExcludedCategoriesChange: setExcludedCategories,
    includedModIds,
    excludedModIds,
    onIncludedModIdsChange: setIncludedModIds,
    onExcludedModIdsChange: setExcludedModIds,
    onToggleModInclude: toggleLock,
    onToggleModExclude: toggleExclude,
    categorySearch,
    onCategorySearchChange: setCategorySearch,
    modSearch,
    onModSearchChange: setModSearch,
    fleaAvailable,
    onFleaChange: setFleaAvailable,
    barterAvailable,
    onBarterChange: setBarterAvailable,
    barterExcludeDogtags,
    onBarterExcludeDogsChange: setBarterExcludeDogtags,
    playerLevel,
    onPlayerLevelChange: setPlayerLevel,
    traderLevels,
    onTraderLevelsChange: setTraderLevels,
    solverPrecision,
    onSolverPrecisionChange: setSolverPrecision,
    allowRepeatedParts,
    onAllowRepeatedPartsChange: setAllowRepeatedParts,
  }

  const tabItems = [
    {
      key: 'optimize',
      label: <span style={{ userSelect: 'none' }}><ThunderboltOutlined /> {t('tabs.optimize')}</span>,
      children: (
        <ResponsiveLayout
          left={
            <OptimizePanel
              {...commonPanelProps}
              ergoWeight={ergoWeight}
              recoilWeight={recoilWeight}
              priceWeight={priceWeight}
              onWeightChange={(e, r, p) => { setErgoWeight(e); setRecoilWeight(r); setPriceWeight(p) }}
              useTrueErgo={useTrueErgo}
              onUseTrueErgoChange={setUseTrueErgo}
              useTchebycheff={useTchebycheff}
              onUseTchebycheffChange={setUseTchebycheff}
              useBudget={useBudget}
              onUseBudgetChange={setUseBudget}
              maxPrice={maxPrice}
              onMaxPriceChange={setMaxPrice}
              minErgo={minErgo}
              onMinErgoChange={setMinErgo}
              useMinMag={useMinMag}
              onUseMinMagChange={setUseMinMag}
              minMagCapacity={minMagCapacity}
              onMinMagCapacityChange={setMinMagCapacity}
              availableMagCapacities={availableMagCapacities}
              useMOA={useMOA}
              onUseMOAChange={(v) => { setUseMOA(v); if (v && maxMOA === 0) setMaxMOA(moaRange.base) }}
              maxMOA={effectiveMaxMOA}
              onMaxMOAChange={setMaxMOA}
              preventOverswing={preventOverswing}
              onPreventOverswingChange={setPreventOverswing}
              equipErgoPenalty={equipErgoPenalty}
              onEquipErgoPenaltyChange={setEquipErgoPenalty}
              moaRange={moaRange}
              useExactMOAFloor={useExactMOAFloor}
              onUseExactMOAFloorChange={setUseExactMOAFloor}
              floor={floor}
              onCancelMOAFloor={floorCtl.cancel}
              cancellingMOAFloor={floorCtl.cancelling}
              onRetryMOAFloor={() => setFloorRetry(n => n + 1)}
            />
          }
          right={
            <OptimizeResult
              run={optimizeRun}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onOptimize={handleOptimize}
              onCancel={optimizeCtl.cancel}
              cancelling={optimizeCtl.cancelling}
              onCopy={copyBuild}
              disabled={!selectedGunId}
              weaponId={selectedGunId}
              weaponName={selectedGun?.name}
              weaponImage={selectedGun?.image}
              lockedIds={includedModIds}
              excludedIds={excludedModIds}
              onToggleLock={toggleLock}
              onToggleExclude={toggleExclude}
            />
          }
        />
      ),
    },
    {
      key: 'explore',
      label: <span style={{ userSelect: 'none' }}><BarChartOutlined /> {t('tabs.explore')}</span>,
      children: (
        <ResponsiveLayout
          left={
            <ExplorePanel
              {...commonPanelProps}
              availableMods={exploreFilterMods}
              // One weapon's slot graph says nothing about the others, so blocking
              // is only offered when the list is a single weapon's.
              modCompat={exploreComparing ? undefined : modCompat}
              loadingMods={exploreComparing ? loadingExploreMods : loadingMods}
              modCategoryOptions={exploreModCategoryOptions}
              selectedGunIds={exploreWeaponIds}
              onGunIdsChange={handleExploreWeaponIdsChange}
              exploreTradeoff={exploreTradeoff}
              onExploreTradeoffChange={setExploreTradeoff}
              exploreSteps={exploreSteps}
              onExploreStepsChange={setExploreSteps}
              useExploreBudget={useExploreBudget}
              onUseExploreBudgetChange={setUseExploreBudget}
              exploreBudgetValue={exploreBudgetValue}
              onExploreBudgetValueChange={setExploreBudgetValue}
            />
          }
          right={
            <Suspense fallback={<Spin style={{ display: 'block', margin: '48px auto' }} />}>
              <ExploreResult
                run={exploreRun}
                onExplore={handleExplore}
                onCancelExplore={() => { if (exploreRun.phase === 'running') exploreCtl.cancel() }}
                cancellingExplore={exploreCtl.cancelling}
                disabled={exploreWeaponIds.length === 0}
                weaponId={exploreWeaponIds[0]}
              />
            </Suspense>
          }
        />
      ),
    },
    {
      key: 'gunsmith',
      label: <span style={{ userSelect: 'none' }}><ToolOutlined /> {t('tabs.gunsmith')}</span>,
      children: (
        <ResponsiveLayout
          left={
            <GunsmithPanel
              gunsmithTasks={gunsmithTasks}
              selectedTaskName={selectedTaskName}
              onTaskNameChange={setSelectedTaskName}
              selectedTask={selectedTask}
              fleaAvailable={fleaAvailable}
              onFleaChange={setFleaAvailable}
              barterAvailable={barterAvailable}
              onBarterChange={setBarterAvailable}
              barterExcludeDogtags={barterExcludeDogtags}
              onBarterExcludeDogsChange={setBarterExcludeDogtags}
              playerLevel={playerLevel}
              onPlayerLevelChange={setPlayerLevel}
              traderLevels={traderLevels}
              onTraderLevelsChange={setTraderLevels}
            />
          }
          right={
            <GunsmithResult
              run={gunsmithRun}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onOptimize={handleGunsmithOptimize}
              onCancel={gunsmithCtl.cancel}
              cancelling={gunsmithCtl.cancelling}
              onCopy={copyGunsmithBuild}
              disabled={!selectedTask}
              weaponId={selectedTask?.weapon_id}
              weaponName={selectedTask?.weapon_name}
              weaponImage={selectedTask?.weapon_image}
            />
          }
        />
      ),
    },
  ]

  const mainModeAccent = useMemo(() => {
    switch (activeTab) {
      case 'explore':
        return { primary: token.colorInfo, bg: token.colorInfoBg, border: token.colorInfo }
      case 'gunsmith':
        return { primary: token.colorSuccess, bg: token.colorSuccessBg, border: token.colorSuccess }
      default:
        return { primary: token.colorWarning, bg: token.colorWarningBg, border: token.colorWarning }
    }
  }, [activeTab, token])

  const mainModeNavWrapStyle: CSSProperties = useMemo(
    () => ({
      borderRadius: token.borderRadiusLG,
      padding: 2,
      background: mainModeAccent.bg,
      border: `1px solid ${mainModeAccent.border}`,
      boxShadow: `0 0 0 1px ${mainModeAccent.border}1a, 0 2px 10px ${mainModeAccent.border}24`,
    }),
    [mainModeAccent, token.borderRadiusLG],
  )

  const mainModeNavOptions = [
    {
      value: 'optimize',
      label: <span style={{ userSelect: 'none', whiteSpace: 'nowrap' }}><ThunderboltOutlined /> {t('tabs.optimize')}</span>,
    },
    {
      value: 'explore',
      label: <span style={{ userSelect: 'none', whiteSpace: 'nowrap' }}><BarChartOutlined /> {t('tabs.explore')}</span>,
    },
    {
      value: 'gunsmith',
      label: <span style={{ userSelect: 'none', whiteSpace: 'nowrap' }}><ToolOutlined /> {t('tabs.gunsmith')}</span>,
    },
  ]

  return (
    <AntApp>
      {contextHolder}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', flexDirection: 'column', gap: 16, background: token.colorBgLayout }}>
          <Spin size="large" />
          <Text type="secondary">{t('ui.initializing')}</Text>
        </div>
      ) : (
      <Layout style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
        <Header style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 24px', height: 'auto', lineHeight: 'normal', background: token.colorBgContainer, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }} onClick={() => window.location.reload()}>
              <img src={import.meta.env.BASE_URL + 'favicon.svg'} alt="" style={{ width: 24, height: 24, display: 'block', pointerEvents: 'none' }} draggable={false} />
              <h1 style={{ fontSize: 18, fontWeight: 600, lineHeight: 1, margin: 0 }}>{t('app.title')}</h1>
              <Tag color="orange" style={{ margin: 0 }}>v{__APP_VERSION__}</Tag>
            </div>
            {!isMobile && (
              <span className="app-main-mode-nav" data-active-mode={activeTab} style={{ ...mainModeNavWrapStyle, display: 'inline-flex' }}>
                <ConfigProvider theme={{ token: { colorPrimary: mainModeAccent.primary } }}>
                  <Segmented aria-label={t('ui.main_mode')} value={activeTab} onChange={setActiveTab} options={mainModeNavOptions} />
                </ConfigProvider>
              </span>
            )}
            <div style={{ marginLeft: 'auto', flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
            {isMobile ? (
              <Dropdown
                trigger={['click']}
                popupRender={() => (
                  <div style={{ padding: 12, background: token.colorBgElevated, borderRadius: 8, boxShadow: token.boxShadowSecondary, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <Button block icon={<ReloadOutlined spin={refreshing} />} onClick={handleForceRefresh} loading={refreshing}>{t('ui.refresh_data')}</Button>
                    <Segmented block aria-label={t('ui.game_mode')} value={gameMode} onChange={(v) => setGameMode(v as GameMode)} options={gameModeOptions} />
                    <Select
                      aria-label={t('ui.theme')}
                      style={{ width: '100%' }}
                      popupMatchSelectWidth={false}
                      value={themeChoice}
                      onChange={(v) => setThemeChoice(v as ThemeChoice)}
                      options={themeSelectOptions}
                    />
                    <Select aria-label={t('ui.language')} style={{ width: '100%' }} value={languages.find(l => i18n.language?.startsWith(l.code))?.code || 'en'} onChange={(v) => i18n.changeLanguage(v)} options={languages.map(l => ({ value: l.code, label: <span><Flag country={l.country} style={{ marginRight: 6 }} />{l.name}</span> }))} />
                  </div>
                )}
              >
                <Button icon={<MenuOutlined />} aria-label={t('ui.menu')} />
              </Dropdown>
            ) : (
              <Space wrap style={{ justifyContent: 'flex-end' }}>
                <Tooltip title={t('ui.refresh_data_tooltip')}>
                  <Button icon={<ReloadOutlined spin={refreshing} />} onClick={handleForceRefresh} loading={refreshing} aria-label={t('ui.refresh_data')} />
                </Tooltip>
                <Segmented aria-label={t('ui.game_mode')} value={gameMode} onChange={(v) => setGameMode(v as GameMode)} options={gameModeOptions} />
                {/* Theme and language collapse to icon triggers: the two full
                    Selects cost ~430px of header width and wrapped the row on
                    narrow desktops. The current choice stays readable as the
                    button's icon, with the name in its tooltip. */}
                {/* Tooltip must sit OUTSIDE Dropdown: Dropdown clones its single
                    child to inject the trigger handler, and a Tooltip in between
                    swallows the click so the menu never opens. */}
                <Tooltip title={activeTheme.label}>
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      selectable: true,
                      selectedKeys: [themeChoice],
                      items: themeOptions.map(o => ({ key: o.value, icon: o.icon, label: o.label })),
                      onClick: ({ key }) => setThemeChoice(key as ThemeChoice),
                    }}
                  >
                    <Button icon={activeTheme.icon} aria-label={activeTheme.label} />
                  </Dropdown>
                </Tooltip>
                <Tooltip title={activeLanguage.name}>
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      selectable: true,
                      selectedKeys: [activeLanguage.code],
                      style: { maxHeight: 360, overflowY: 'auto' },
                      items: languages.map(l => ({
                        key: l.code,
                        icon: <Flag country={l.country} />,
                        label: l.name,
                      })),
                      onClick: ({ key }) => i18n.changeLanguage(key),
                    }}
                  >
                    <Button icon={<Flag country={activeLanguage.country} />} aria-label={activeLanguage.name} />
                  </Dropdown>
                </Tooltip>
              </Space>
            )}
            </div>
          </div>
          {isMobile && (
            <span className="app-main-mode-nav" data-active-mode={activeTab} style={{ ...mainModeNavWrapStyle, display: 'block', width: '100%', boxSizing: 'border-box' }}>
              <ConfigProvider theme={{ token: { colorPrimary: mainModeAccent.primary } }}>
                <Segmented block size="small" aria-label={t('ui.main_mode')} style={{ width: '100%' }} value={activeTab} onChange={setActiveTab} options={mainModeNavOptions} />
              </ConfigProvider>
            </span>
          )}
        </Header>
        <Content
          className={isMobile ? 'main-content' : undefined}
          style={{ flex: 1, minHeight: 0, padding: isMobile ? '16px 0' : 16, overflowX: 'hidden', overflowY: isMobile ? 'auto' : 'hidden', background: token.colorBgLayout, display: 'flex', flexDirection: 'column' }}
        >
          <div style={{ padding: isMobile ? '0 16px' : 0, height: isMobile ? 'auto' : '100%', display: 'flex', flexDirection: 'column', flex: 1 }}>
            {tabItems.find(i => i.key === activeTab)?.children}
          </div>
        </Content>
        <Footer
          style={{
            flexShrink: 0,
            margin: 0,
            padding: '12px 16px',
            background: token.colorBgContainer,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: '8px 16px', fontSize: 13, color: token.colorTextSecondary }}>
            <span>{t('ui.footer_copyright', { year: new Date().getFullYear() })}</span>
            <span style={{ opacity: 0.3 }}>•</span>
            <Link href={GITHUB_PROFILE_URL} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <GithubOutlined aria-hidden />
              {t('ui.footer_github')}
            </Link>
            <span style={{ opacity: 0.3 }}>•</span>
            <Button type="link" size="small" icon={<BulbOutlined aria-hidden />} style={{ padding: 0, height: 'auto', fontSize: 'inherit', gap: 4 }} onClick={() => setMethodologyOpen(true)}>
              {t('ui.methodology_title')}
            </Button>
            <span style={{ opacity: 0.3 }}>•</span>
            <Button type="link" size="small" icon={<HistoryOutlined aria-hidden />} style={{ padding: 0, height: 'auto', fontSize: 'inherit', gap: 4 }} onClick={() => setChangelogOpen(true)}>
              {t('ui.changelog_title')}
            </Button>
            <span style={{ opacity: 0.3 }}>•</span>
            <span>
              {t('ui.footer_data_from')}{' '}
              <Link href={TARKOV_DEV_URL} target="_blank" rel="noopener noreferrer">
                Tarkov.dev
              </Link>
            </span>
            <span style={{ opacity: 0.3 }}>•</span>
            <span>Made with ❤️</span>
          </div>
        </Footer>
        <Suspense fallback={null}>
          {changelogOpen !== null && <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />}
          {methodologyOpen !== null && <MethodologyModal open={methodologyOpen} onClose={() => setMethodologyOpen(false)} />}
        </Suspense>
      </Layout>
      )}
    </AntApp>
  )
}

function App() {
  const [themeChoice, setThemeChoiceState] = useState<ThemeChoice>(readStoredThemeChoice)
  const [autoDarkPalette, setAutoDarkPalette] = useState<DarkPaletteId>(initialAutoDarkPalette)
  const [autoLightPalette, setAutoLightPalette] = useState<LightPaletteId>(initialAutoLightPalette)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [])

  const setThemeChoice = (c: ThemeChoice) => {
    setThemeChoiceState(c)
    localStorage.setItem(THEME_STORAGE_KEY, c)
    localStorage.removeItem(THEME_CHOICE_LEGACY)
    localStorage.removeItem(THEME_MODE_LEGACY)
    const darkP = choiceToDarkPalette(c)
    if (darkP) {
      localStorage.setItem(AUTO_DARK_PALETTE_KEY, darkP)
      setAutoDarkPalette(darkP)
    }
    const lightP = choiceToLightPalette(c)
    if (lightP) {
      localStorage.setItem(AUTO_LIGHT_PALETTE_KEY, lightP)
      setAutoLightPalette(lightP)
    }
  }

  const useAmoled = themeChoice === 'amoled'
  const isExplicitDark = choiceToDarkPalette(themeChoice) !== null
  const isDark =
    isExplicitDark || useAmoled || (themeChoice === 'auto' && systemDark)
  const effectiveDarkWhenColored: DarkPaletteId =
    choiceToDarkPalette(themeChoice) ?? (themeChoice === 'auto' && systemDark ? autoDarkPalette : 'onedark')

  const effectiveLightPalette: LightPaletteId =
    choiceToLightPalette(themeChoice) ?? (themeChoice === 'auto' && !systemDark ? autoLightPalette : 'primer')

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', useAmoled ? 'amoled' : isDark ? 'dark' : 'light')
    if (!useAmoled && isDark) {
      root.setAttribute('data-dark-palette', effectiveDarkWhenColored)
      root.removeAttribute('data-light-palette')
    } else if (!isDark) {
      root.removeAttribute('data-dark-palette')
      root.setAttribute('data-light-palette', effectiveLightPalette)
    } else {
      root.removeAttribute('data-dark-palette')
      root.removeAttribute('data-light-palette')
    }
  }, [isDark, useAmoled, effectiveDarkWhenColored, effectiveLightPalette])

  const paletteToken = useAmoled
    ? amoledDarkToken
    : isDark
      ? darkPaletteTokens[effectiveDarkWhenColored]
      : lightPaletteTokens[effectiveLightPalette]
  const onPrimary = onColor(paletteToken.colorPrimary ?? '#1677ff')

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'",
          ...paletteToken,
        },
        components: {
          Button: { primaryColor: onPrimary },
          Checkbox: { colorWhite: onPrimary },
        },
      }}
    >
      <AppContent themeChoice={themeChoice} setThemeChoice={setThemeChoice} />
    </ConfigProvider>
  )
}

export default App
