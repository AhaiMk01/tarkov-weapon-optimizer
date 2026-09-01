declare const __APP_VERSION__: string;

import { useState, useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfigProvider, Layout, Select, Segmented, Spin, message, App as AntApp, theme, Typography, Tag, Space, Grid, Dropdown, Button, Tooltip } from 'antd'
import { ThunderboltOutlined, BarChartOutlined, ToolOutlined, MoonOutlined, MenuOutlined, BlockOutlined, GithubOutlined, CloudOutlined, HistoryOutlined, ReloadOutlined, BulbOutlined } from '@ant-design/icons'
import { getInfo, optimize, explore, getWeaponMods, getGunsmithTasks, computeMOAFloor, clearDataCache } from './api/client'
import type { Gun, OptimizeResponse, ModInfo, ModCategoryOption, ExplorePoint, GunsmithTask, GameMode, SolverPrecisionMode } from './api/client'
import { ResponsiveLayout } from './layouts/ResponsiveLayout'
import { ChangelogModal } from './components/common/ChangelogModal'
import { MethodologyModal } from './components/common/MethodologyModal'
import { OptimizePanel } from './components/optimize/OptimizePanel'
import { OptimizeResult } from './components/optimize/OptimizeResult'
import { ExplorePanel } from './components/explore/ExplorePanel'
import { ExploreResult } from './components/explore/ExploreResult'
import { GunsmithPanel } from './components/gunsmith/GunsmithPanel'
import { GunsmithResult } from './components/gunsmith/GunsmithResult'
import 'flag-icons/css/flag-icons.min.css'
import { amoledDarkToken } from './theme/amoledDark'
import { darkPaletteTokens, type DarkPaletteId } from './theme/darkPalettes'
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

const languages = [
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

/** PvP = `regular`, PvE = `pve` (matches API / Tarkov.dev). */
const GAME_MODE_STORAGE_KEY = 'mode'
const GAME_MODE_LEGACY_KEY = 'gameMode'

const TRADER_LEVEL_KEYS: (keyof TraderLevels)[] = ['prapor', 'skier', 'peacekeeper', 'mechanic', 'jaeger', 'ref']

function readStoredGameMode(): GameMode {
  const fromMode = localStorage.getItem(GAME_MODE_STORAGE_KEY)
  const fromLegacy = localStorage.getItem(GAME_MODE_LEGACY_KEY)
  const raw = fromMode ?? fromLegacy
  const result: GameMode = raw === 'pve' ? 'pve' : 'regular'
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
  const [optimizing, setOptimizing] = useState(false)
  const [result, setResult] = useState<OptimizeResponse | null>(null)
  const [availableMods, setAvailableMods] = useState<ModInfo[]>([])
  const [loadingMods, setLoadingMods] = useState(false)
  const [ergoWeight, setErgoWeight] = useState(33)
  const [recoilWeight, setRecoilWeight] = useState(34)
  const [priceWeight, setPriceWeight] = useState(33)
  const [useEvoErgo, setUseEvoErgo] = useState<boolean>(() => localStorage.getItem('useEvoErgo') === 'true')
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
  const [exactMOAFloor, setExactMOAFloor] = useState<number | null>(null)
  const [computingMOAFloor, setComputingMOAFloor] = useState(false)
  const moaFloorRequestSeq = useRef(0)
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
  const [solverPrecision, setSolverPrecision] = useState<SolverPrecisionMode>(() => {
    const s = localStorage.getItem('solverPrecision')
    if (s === 'fast' || s === 'precise' || s === 'auto') return s
    return 'auto'
  })
  const [traderLevels, setTraderLevels] = useState(initialLevelConfig.traderLevels)
  const [activeTab, setActiveTab] = useState<string>('optimize')
  const [viewMode, setViewMode] = useState<'detailed' | 'compact' | 'table'>(() => {
    const s = localStorage.getItem('viewMode')
    if (s === 'detailed' || s === 'compact' || s === 'table') return s
    // Migration from old compactMode
    if (localStorage.getItem('compactMode') === 'true') return 'compact'
    return 'detailed'
  })
  const [exploring, setExploring] = useState(false)
  const [exploreResult, setExploreResult] = useState<ExplorePoint[]>([])
  const [explorePrecisionMeta, setExplorePrecisionMeta] = useState<{
    request?: SolverPrecisionMode
    resolved?: 'fast' | 'precise'
  }>({})
  const [exploreSolveTime, setExploreSolveTime] = useState<number | undefined>(undefined)
  const [exploreTradeoff, setExploreTradeoff] = useState<'price' | 'recoil' | 'ergo'>('price')
  const [exploreWeaponIds, setExploreWeaponIds] = useState<string[]>([])
  const [exploreRunIds, setExploreRunIds] = useState<string[]>([])
  const [exploreAvailableMods, setExploreAvailableMods] = useState<ModInfo[]>([])
  const [loadingExploreMods, setLoadingExploreMods] = useState(false)
  const exploreModsRequestSeq = useRef(0)
  const exploreRunSeq = useRef(0)
  const [exploreProgress, setExploreProgress] = useState<{ current: number; total: number; name: string } | null>(null)
  const [useExploreBudget, setUseExploreBudget] = useState(false)
  const [exploreBudgetValue, setExploreBudgetValue] = useState<number>(0)
  const [resultTradeoff, setResultTradeoff] = useState<'price' | 'recoil' | 'ergo'>('price')
  const [gunsmithTasks, setGunsmithTasks] = useState<GunsmithTask[]>([])
  const [selectedTaskName, setSelectedTaskName] = useState<string>('')
  const [gunsmithResult, setGunsmithResult] = useState<OptimizeResponse | null>(null)
  const [optimizingGunsmith, setOptimizingGunsmith] = useState(false)
  const modsRequestSeq = useRef(0)
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [methodologyOpen, setMethodologyOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const messageApiRef = useRef(messageApi)
  messageApiRef.current = messageApi

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
  useEffect(() => { localStorage.setItem('useExactMOAFloor', String(useExactMOAFloor)) }, [useExactMOAFloor])
  useEffect(() => { localStorage.setItem('useEvoErgo', String(useEvoErgo)) }, [useEvoErgo])
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
    setResult(null)
    setGunsmithResult(null)
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

  useEffect(() => {
    setExactMOAFloor(null)
    if (!selectedGunId || !useExactMOAFloor) return
    const seq = ++moaFloorRequestSeq.current
    setComputingMOAFloor(true)
    computeMOAFloor(selectedGunId, gameMode, i18n.language || 'en')
      .then(({ floor }) => {
        if (seq !== moaFloorRequestSeq.current) return
        setExactMOAFloor(floor > 0 ? floor : null)
        setComputingMOAFloor(false)
      })
      .catch(err => {
        console.error('Failed to compute MOA floor', err)
        if (seq !== moaFloorRequestSeq.current) return
        setComputingMOAFloor(false)
      })
  }, [selectedGunId, gameMode, i18n.language, useExactMOAFloor])

  useEffect(() => {
    if (!selectedGunId) return
    const seq = ++modsRequestSeq.current
    setLoadingMods(true)
    getWeaponMods(selectedGunId, gameMode, i18n.language || 'en')
      .then(data => {
        if (seq !== modsRequestSeq.current) return
        setAvailableMods(data.mods)
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
    // If we've computed the exact achievable floor via solver, use it — it respects slot-graph
    // reachability, conflicts, and barrel-specific mod compatibility. Otherwise fall back to the
    // theoretical per-category sum (an upper bound on improvements that may be unreachable).
    const approxMin = Math.max(0, effMin * (1 - bestMod / 100))
    const sliderMin = exactMOAFloor != null ? exactMOAFloor : approxMin
    // Round min UP and max UP so the displayed range always contains feasible solves.
    // Rounding min DOWN (e.g. 0.4836 → 0.48) would make the slider's leftmost position infeasible
    // because the true floor is 0.4836. Ceiling preserves feasibility at the cost of +0.005 MOA.
    return {
      base: Math.round(effBase * 100) / 100,
      min: Math.ceil(sliderMin * 100) / 100,
      max: Math.ceil(effMax * (1 - worstMod / 100) * 100) / 100,
    }
  }, [selectedGun, availableMods, exactMOAFloor])
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

  const handleOptimize = async () => {
    if (!selectedGunId) return
    setOptimizing(true)
    try {
      const res = await optimize({
        weapon_id: selectedGunId,
        ergo_weight: ergoWeight,
        recoil_weight: recoilWeight,
        price_weight: priceWeight,
        use_evo_ergo: useEvoErgo || undefined,
        use_tchebycheff: useTchebycheff || undefined,
        max_price: useBudget ? maxPrice : undefined,
        min_ergonomics: minErgo > 0 ? minErgo : undefined,
        min_mag_capacity: useMinMag ? minMagCapacity : undefined,
        max_moa: useMOA ? maxMOA : undefined,
        prevent_overswing: preventOverswing || undefined,
        equip_ergo_modifier: preventOverswing ? equipErgoPenalty / 100 : undefined,
        include_items: includedModIds.length > 0 ? includedModIds : undefined,
        exclude_items: excludedModIds.length > 0 ? excludedModIds : undefined,
        include_categories: includedCategories.length > 0 ? includedCategories.map(c => [c]) : undefined,
        exclude_categories: excludedCategories.length > 0 ? excludedCategories : undefined,
        trader_levels: traderLevels,
        player_level: playerLevel,
        flea_available: fleaAvailable,
        barter_available: barterAvailable,
        barter_exclude_dogtags: barterExcludeDogtags,
        precise_mode: solverPrecision,
      }, gameMode, i18n.language || 'en')
      setResult(res)
      if (res.status === 'optimal') {
        messageApi.success(t('toast.optimize_success'))
      } else if (res.status === 'infeasible') {
        const base = t('toast.optimize_infeasible')
        messageApi.error(res.reason ? `${base} (${res.reason})` : base)
      } else {
        messageApi.warning(t('toast.optimize_non_optimal', { status: res.status }))
      }
    } catch (err) {
      console.error('Optimization failed', err)
      messageApi.error(t('toast.optimize_failed'))
    } finally {
      setOptimizing(false)
    }
  }

  const clearOptimizeGunExtras = () => {
    setResult(null)
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

  /**
   * Cancels an in-flight Explore run. Bumping the sequence makes the loop bail at
   * its next checkpoint; the run's own `finally` is guarded on the same id and so
   * will not fire, which is why the flags are cleared here.
   *
   * The solve already dispatched to the worker still finishes -- there is no abort
   * channel into HiGHS -- so cancellation takes effect after the current weapon,
   * not instantly. Points already collected stay on screen.
   */
  const handleExploreCancel = () => {
    if (!exploring) return
    exploreRunSeq.current += 1
    setExploring(false)
    setExploreProgress(null)
  }

  const handleExplore = async () => {
    const weaponIds = [...new Set(exploreWeaponIds)]
    if (weaponIds.length === 0) return
    const runId = ++exploreRunSeq.current
    const gunName = (id: string) => guns.find(g => g.id === id)?.name ?? id
    const shared = {
      ignore: exploreTradeoff,
      steps: 10,
      use_evo_ergo: useEvoErgo || undefined,
      max_price: (useBudget ? maxPrice : undefined) ?? (useExploreBudget && exploreTradeoff === 'price' && exploreBudgetValue > 0 ? exploreBudgetValue : undefined),
      min_ergonomics: (minErgo > 0 ? minErgo : undefined) ?? (useExploreBudget && exploreTradeoff === 'ergo' && exploreBudgetValue > 0 ? exploreBudgetValue : undefined),
      max_recoil_v: useExploreBudget && exploreTradeoff === 'recoil' && exploreBudgetValue > 0 ? exploreBudgetValue : undefined,
      min_mag_capacity: useMinMag ? minMagCapacity : undefined,
      max_moa: useMOA ? maxMOA : undefined,
      prevent_overswing: preventOverswing || undefined,
      equip_ergo_modifier: preventOverswing ? equipErgoPenalty / 100 : undefined,
      trader_levels: traderLevels,
      player_level: playerLevel,
      flea_available: fleaAvailable,
      barter_available: barterAvailable,
      barter_exclude_dogtags: barterExcludeDogtags,
      precise_mode: solverPrecision,
      include_items: includedModIds.length > 0 ? includedModIds : undefined,
      exclude_items: excludedModIds.length > 0 ? excludedModIds : undefined,
      include_categories: includedCategories.length > 0 ? includedCategories.map(c => [c]) : undefined,
      exclude_categories: excludedCategories.length > 0 ? excludedCategories : undefined,
    } as const

    setExploring(true)
    setExploreRunIds(weaponIds)
    setExploreResult([])
    setExploreSolveTime(undefined)
    setResultTradeoff(exploreTradeoff)
    setExploreProgress({ current: 1, total: weaponIds.length, name: gunName(weaponIds[0]) })

    const allPoints: ExplorePoint[] = []
    let totalTime = 0
    let errorCount = 0
    const infeasibleIds: string[] = []
    let lastPrecision: { request?: SolverPrecisionMode; resolved?: 'fast' | 'precise' } = {}

    try {
      for (let i = 0; i < weaponIds.length; i++) {
        if (runId !== exploreRunSeq.current) return
        const id = weaponIds[i]
        setExploreProgress({ current: i + 1, total: weaponIds.length, name: gunName(id) })
        try {
          const res = await explore({
            ...shared,
            weapon_id: id,
          }, gameMode, i18n.language || 'en')
          if (runId !== exploreRunSeq.current) return
          if (res.points.length === 0) {
            infeasibleIds.push(id)
          } else {
            allPoints.push(...res.points.map(p => ({
              ...p,
              weapon_id: id,
              weapon_name: gunName(id),
            })))
          }
          totalTime += res.total_solve_time_ms ?? 0
          lastPrecision = {
            request: res.precision_request,
            resolved: res.precision_resolved,
          }
          setExploreResult([...allPoints])
          setExploreSolveTime(totalTime)
          setExplorePrecisionMeta(lastPrecision)
        } catch (err) {
          errorCount += 1
          console.error(`Exploration failed for ${id}`, err)
        }
      }

      if (runId !== exploreRunSeq.current) return
      if (errorCount > 0 && allPoints.length > 0) {
        messageApi.warning(t('toast.explore_compare_partial', { failed: errorCount, total: weaponIds.length }))
      } else if (allPoints.length > 0) {
        messageApi.success(t('toast.explore_success'))
      } else if (errorCount === weaponIds.length) {
        messageApi.error(t('toast.explore_failed'))
      } else if (infeasibleIds.length > 0) {
        messageApi.warning(t('toast.explore_infeasible', { names: infeasibleIds.map(gunName).join(', ') }))
      } else {
        messageApi.warning(t('toast.explore_empty'))
      }
    } catch (err) {
      if (runId !== exploreRunSeq.current) return
      console.error('Exploration failed', err)
      messageApi.error(t('toast.explore_failed'))
    } finally {
      if (runId === exploreRunSeq.current) {
        setExploring(false)
        setExploreProgress(null)
      }
    }
  }

  const handleGunsmithOptimize = async () => {
    if (!selectedTask) return
    setOptimizingGunsmith(true)
    try {
      const res = await optimize({
        weapon_id: selectedTask.weapon_id,
        ergo_weight: 1.0,
        recoil_weight: 1.0,
        price_weight: 0.5,
        min_ergonomics: selectedTask.constraints.min_ergonomics,
        max_recoil_sum: selectedTask.constraints.max_recoil_sum,
        min_mag_capacity: selectedTask.constraints.min_mag_capacity,
        min_sighting_range: selectedTask.constraints.min_sighting_range,
        max_weight: selectedTask.constraints.max_weight,
        include_items: selectedTask.required_item_ids.length > 0 ? selectedTask.required_item_ids : undefined,
        include_categories: selectedTask.required_category_group_ids.length > 0 ? selectedTask.required_category_group_ids : undefined,
        trader_levels: traderLevels,
        player_level: playerLevel,
        flea_available: fleaAvailable,
        barter_available: barterAvailable,
        barter_exclude_dogtags: barterExcludeDogtags,
        precise_mode: true,
      }, gameMode, i18n.language || 'en')
      setGunsmithResult(res)
      if (res.status === 'optimal') {
        messageApi.success(t('toast.gunsmith_success'))
      } else if (res.status === 'infeasible') {
        const base = t('toast.gunsmith_infeasible')
        messageApi.error(res.reason ? `${base} (${res.reason})` : base)
      } else {
        messageApi.warning(t('toast.optimize_non_optimal', { status: res.status }))
      }
    } catch (err) {
      console.error('Gunsmith optimization failed', err)
      messageApi.error(t('toast.gunsmith_failed'))
    } finally {
      setOptimizingGunsmith(false)
    }
  }

  const toggleLock = (id: string) => {
    setIncludedModIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  const toggleExclude = (id: string) => {
    setExcludedModIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

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

  const copyBuild = () => {
    if (!result || !result.final_stats) return
    const lines = [
      `${selectedGun?.name} - ${t('ui.build_manifest')}`,
      '',
      `${t('sidebar.ergonomics')}: ${result.final_stats.ergonomics.toFixed(1)} | ${t('ui.vert_recoil')}: ${result.final_stats.recoil_vertical.toFixed(1)} | ${t('ui.horiz_recoil')}: ${result.final_stats.recoil_horizontal.toFixed(1)} | ${t('ui.weight_label')}: ${result.final_stats.total_weight.toFixed(2)}kg | ${t('ui.total_cost')}: ~ ₽${result.final_stats.total_price.toLocaleString()}`,
      '',
      `${t('ui.table_items')}:`,
      ...result.selected_items.map(i => i.name)
    ]
    copyToClipboard(lines.join('\n'))
  }

  const copyGunsmithBuild = () => {
    if (!gunsmithResult || !gunsmithResult.final_stats || !selectedTask) return
    const lines = [
      `${selectedTask.task_name} - ${selectedTask.weapon_name}`,
      '',
      `${t('sidebar.ergonomics')}: ${gunsmithResult.final_stats.ergonomics.toFixed(1)} | ${t('ui.vert_recoil')}: ${gunsmithResult.final_stats.recoil_vertical.toFixed(1)} | ${t('ui.horiz_recoil')}: ${gunsmithResult.final_stats.recoil_horizontal.toFixed(1)} | ${t('ui.weight_label')}: ${gunsmithResult.final_stats.total_weight.toFixed(2)}kg | ${t('ui.total_cost')}: ~ ₽${gunsmithResult.final_stats.total_price.toLocaleString()}`,
      '',
      `${t('ui.table_items')}:`,
      ...gunsmithResult.selected_items.map(i => i.name)
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
              useEvoErgo={useEvoErgo}
              onUseEvoErgoChange={setUseEvoErgo}
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
              maxMOA={maxMOA}
              onMaxMOAChange={setMaxMOA}
              preventOverswing={preventOverswing}
              onPreventOverswingChange={setPreventOverswing}
              equipErgoPenalty={equipErgoPenalty}
              onEquipErgoPenaltyChange={setEquipErgoPenalty}
              moaRange={moaRange}
              useExactMOAFloor={useExactMOAFloor}
              onUseExactMOAFloorChange={setUseExactMOAFloor}
              computingMOAFloor={computingMOAFloor}
            />
          }
          right={
            <OptimizeResult
              result={result}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              optimizing={optimizing}
              onOptimize={handleOptimize}
              onCopy={copyBuild}
              disabled={!selectedGunId}
              weaponId={selectedGunId}
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
              loadingMods={exploreComparing ? loadingExploreMods : loadingMods}
              modCategoryOptions={exploreModCategoryOptions}
              selectedGunIds={exploreWeaponIds}
              onGunIdsChange={handleExploreWeaponIdsChange}
              exploreTradeoff={exploreTradeoff}
              onExploreTradeoffChange={setExploreTradeoff}
              useExploreBudget={useExploreBudget}
              onUseExploreBudgetChange={setUseExploreBudget}
              exploreBudgetValue={exploreBudgetValue}
              onExploreBudgetValueChange={setExploreBudgetValue}
            />
          }
          right={
            <ExploreResult
              exploreResult={exploreResult}
              solveTime={exploreSolveTime}
              explorePrecision={explorePrecisionMeta}
              resultTradeoff={resultTradeoff}
              exploring={exploring}
              exploreProgress={exploreProgress}
              onExplore={handleExplore}
              onCancelExplore={handleExploreCancel}
              disabled={exploreWeaponIds.length === 0}
              weaponId={exploreWeaponIds[0]}
              runWeaponIds={exploreRunIds}
            />
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
              result={gunsmithResult}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              optimizing={optimizingGunsmith}
              onOptimize={handleGunsmithOptimize}
              onCopy={copyGunsmithBuild}
              disabled={!selectedTask}
              weaponId={selectedTask?.weapon_id}
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 16, background: token.colorBgContainer }}>
          <Spin size="large" />
          <Text type="secondary">{t('ui.initializing')}</Text>
        </div>
      ) : (
      <Layout style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <Header style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 24px', height: 'auto', lineHeight: 'normal', background: token.colorBgContainer, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }} onClick={() => window.location.reload()}>
              <img src={import.meta.env.BASE_URL + 'favicon.svg'} alt="logo" style={{ width: 24, height: 24, display: 'block', pointerEvents: 'none' }} draggable={false} />
              <span style={{ fontSize: 18, fontWeight: 600, lineHeight: 1 }}>{t('app.title')}</span>
              <Tag color="orange" style={{ margin: 0 }}>v{__APP_VERSION__}</Tag>
            </div>
            {!isMobile && (
              <span className="app-main-mode-nav" data-active-mode={activeTab} style={{ ...mainModeNavWrapStyle, display: 'inline-flex' }}>
                <ConfigProvider theme={{ token: { colorPrimary: mainModeAccent.primary } }}>
                  <Segmented value={activeTab} onChange={setActiveTab} options={mainModeNavOptions} />
                </ConfigProvider>
              </span>
            )}
            <div style={{ marginLeft: 'auto', flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
            {isMobile ? (
              <Dropdown
                trigger={['click']}
                dropdownRender={() => (
                  <div style={{ padding: 12, background: token.colorBgElevated, borderRadius: 8, boxShadow: token.boxShadowSecondary, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <Button block icon={<ReloadOutlined spin={refreshing} />} onClick={handleForceRefresh} loading={refreshing}>{t('ui.refresh_data')}</Button>
                    <Segmented block value={gameMode} onChange={(v) => setGameMode(v as GameMode)} options={[{ label: t('ui.pvp'), value: 'regular' }, { label: t('ui.pve'), value: 'pve' }]} />
                    <Tooltip title={t('sidebar.solver_precision_tooltip')}>
                      <Segmented
                        block
                        size="small"
                        value={solverPrecision}
                        onChange={(v) => setSolverPrecision(v as SolverPrecisionMode)}
                        options={[
                          { label: t('sidebar.auto'), value: 'auto' },
                          { label: t('sidebar.fast'), value: 'fast' },
                          { label: t('sidebar.precise'), value: 'precise' },
                        ]}
                      />
                    </Tooltip>
                    <Select
                      style={{ width: '100%' }}
                      popupMatchSelectWidth={false}
                      value={themeChoice}
                      onChange={(v) => setThemeChoice(v as ThemeChoice)}
                      options={themeSelectOptions}
                    />
                    <Select style={{ width: '100%' }} value={languages.find(l => i18n.language?.startsWith(l.code))?.code || 'en'} onChange={(v) => i18n.changeLanguage(v)} options={languages.map(l => ({ value: l.code, label: <span><span className={`fi fi-${l.country}`} style={{ marginRight: 6 }} />{l.name}</span> }))} />
                  </div>
                )}
              >
                <Button icon={<MenuOutlined />} />
              </Dropdown>
            ) : (
              <Space wrap style={{ justifyContent: 'flex-end' }}>
                <Tooltip title={t('ui.refresh_data_tooltip')}>
                  <Button icon={<ReloadOutlined spin={refreshing} />} onClick={handleForceRefresh} loading={refreshing} aria-label={t('ui.refresh_data')} />
                </Tooltip>
                <Segmented value={gameMode} onChange={(v) => setGameMode(v as GameMode)} options={[{ label: t('ui.pvp'), value: 'regular' }, { label: t('ui.pve'), value: 'pve' }]} />
                <Tooltip title={t('sidebar.solver_precision_tooltip')}>
                  <span style={{ display: 'inline-flex', verticalAlign: 'middle' }}>
                    <Segmented
                      value={solverPrecision}
                      onChange={(v) => setSolverPrecision(v as SolverPrecisionMode)}
                      options={[
                        { label: t('sidebar.auto'), value: 'auto' },
                        { label: t('sidebar.fast'), value: 'fast' },
                        { label: t('sidebar.precise'), value: 'precise' },
                      ]}
                    />
                  </span>
                </Tooltip>
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
                        icon: <span className={`fi fi-${l.country}`} />,
                        label: l.name,
                      })),
                      onClick: ({ key }) => i18n.changeLanguage(key),
                    }}
                  >
                    <Button icon={<span className={`fi fi-${activeLanguage.country}`} />} aria-label={activeLanguage.name} />
                  </Dropdown>
                </Tooltip>
              </Space>
            )}
            </div>
          </div>
          {isMobile && (
            <span className="app-main-mode-nav" data-active-mode={activeTab} style={{ ...mainModeNavWrapStyle, display: 'block', width: '100%', boxSizing: 'border-box' }}>
              <ConfigProvider theme={{ token: { colorPrimary: mainModeAccent.primary } }}>
                <Segmented block size="small" style={{ width: '100%' }} value={activeTab} onChange={setActiveTab} options={mainModeNavOptions} />
              </ConfigProvider>
            </span>
          )}
        </Header>
        <Content
          className="main-content"
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
            <Link style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => setMethodologyOpen(true)}>
              <BulbOutlined aria-hidden />
              {t('ui.methodology_title')}
            </Link>
            <span style={{ opacity: 0.3 }}>•</span>
            <Link style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => setChangelogOpen(true)}>
              <HistoryOutlined aria-hidden />
              {t('ui.changelog_title')}
            </Link>
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
        <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
        <MethodologyModal open={methodologyOpen} onClose={() => setMethodologyOpen(false)} />
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

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'",
          ...(useAmoled
            ? amoledDarkToken
            : isDark
              ? darkPaletteTokens[effectiveDarkWhenColored]
              : lightPaletteTokens[effectiveLightPalette]),
        },
      }}
    >
      <AppContent themeChoice={themeChoice} setThemeChoice={setThemeChoice} />
    </ConfigProvider>
  )
}

export default App
