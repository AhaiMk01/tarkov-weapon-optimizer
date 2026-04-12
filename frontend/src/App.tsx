import { useState, useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfigProvider, Layout, Select, Segmented, Spin, message, App as AntApp, theme, Typography, Tag, Space, Grid, Dropdown, Button, Tooltip } from 'antd'
import { ThunderboltOutlined, BarChartOutlined, ToolOutlined, MoonOutlined, MenuOutlined, BlockOutlined, GithubOutlined, CloudOutlined, HistoryOutlined } from '@ant-design/icons'
import { getInfo, optimize, explore, getWeaponMods, getGunsmithTasks } from './api/client'
import type { Gun, OptimizeResponse, ModInfo, ModCategoryOption, ExplorePoint, GunsmithTask, GameMode, SolverPrecisionMode } from './api/client'
import { ResponsiveLayout } from './layouts/ResponsiveLayout'
import { ChangelogModal } from './components/common/ChangelogModal'
import { OptimizePanel } from './components/optimize/OptimizePanel'
import { OptimizeResult } from './components/optimize/OptimizeResult'
import { ExplorePanel } from './components/explore/ExplorePanel'
import { ExploreResult } from './components/explore/ExploreResult'
import { GunsmithPanel } from './components/gunsmith/GunsmithPanel'
import { GunsmithResult } from './components/gunsmith/GunsmithResult'
import { amoledDarkToken } from './theme/amoledDark'
import { darkPaletteTokens, type DarkPaletteId } from './theme/darkPalettes'
import { lightPaletteTokens, type LightPaletteId } from './theme/lightPalettes'
import { includeCategoryInModFilter } from './solver/modCategoryFilter'
import { DEFAULT_TRADER_LEVELS, type TraderLevels } from './solver/types'

const { Header, Content, Footer } = Layout
const { Text, Link } = Typography

/** Author GitHub profile (footer link). */
const GITHUB_PROFILE_URL = 'https://github.com/AhaiMk01'
/** Game item / mod API and site credit. */
const TARKOV_DEV_URL = 'https://tarkov.dev'
const { useToken } = theme

const languages = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'it', name: 'Italiano', flag: '🇮🇹' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'pl', name: 'Polski', flag: '🇵🇱' },
  { code: 'pt', name: 'Português', flag: '🇧🇷' },
  { code: 'tr', name: 'Türkçe', flag: '🇹🇷' },
  { code: 'cs', name: 'Čeština', flag: '🇨🇿' },
  { code: 'hu', name: 'Magyar', flag: '🇭🇺' },
  { code: 'ro', name: 'Română', flag: '🇷🇴' },
  { code: 'sk', name: 'Slovenčina', flag: '🇸🇰' },
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

const TRADER_LEVEL_KEYS: (keyof TraderLevels)[] = ['prapor', 'skier', 'peacekeeper', 'mechanic', 'jaeger']

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
        if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 4) {
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
  const [selectedCategory, setSelectedCategory] = useState<string>('All')
  const [selectedCaliber, setSelectedCaliber] = useState<string>('All')
  const [ergoWeight, setErgoWeight] = useState(33)
  const [recoilWeight, setRecoilWeight] = useState(34)
  const [priceWeight, setPriceWeight] = useState(33)
  const [useBudget, setUseBudget] = useState(false)
  const [maxPrice, setMaxPrice] = useState(200000)
  const [minErgo, setMinErgo] = useState(0)
  const [useMinMag, setUseMinMag] = useState(false)
  const [minMagCapacity, setMinMagCapacity] = useState(0)
  const [useMOA, setUseMOA] = useState(false)
  const [maxMOA, setMaxMOA] = useState(0)
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
  const [useExploreBudget, setUseExploreBudget] = useState(false)
  const [exploreBudgetValue, setExploreBudgetValue] = useState<number>(0)
  const [resultTradeoff, setResultTradeoff] = useState<'price' | 'recoil' | 'ergo'>('price')
  const [gunsmithTasks, setGunsmithTasks] = useState<GunsmithTask[]>([])
  const [selectedTaskName, setSelectedTaskName] = useState<string>('')
  const [gunsmithResult, setGunsmithResult] = useState<OptimizeResponse | null>(null)
  const [optimizingGunsmith, setOptimizingGunsmith] = useState(false)
  const modsRequestSeq = useRef(0)
  const [changelogOpen, setChangelogOpen] = useState(false)
  const messageApiRef = useRef(messageApi)
  messageApiRef.current = messageApi

  useEffect(() => {
    localStorage.setItem(GAME_MODE_STORAGE_KEY, gameMode)
    localStorage.removeItem(GAME_MODE_LEGACY_KEY)
  }, [gameMode])
  useEffect(() => { localStorage.setItem('viewMode', viewMode) }, [viewMode])
  useEffect(() => { localStorage.setItem('solverPrecision', solverPrecision) }, [solverPrecision])
  useEffect(() => {
    localStorage.setItem(
      LEVEL_CONFIG_STORAGE_KEY,
      JSON.stringify({ playerLevel, fleaAvailable, barterAvailable, barterExcludeDogtags, traderLevels }),
    )
  }, [playerLevel, fleaAvailable, barterAvailable, barterExcludeDogtags, traderLevels])
  const themeSelectOptions = useMemo(
    () => [
      // Light themes disabled — item images lack transparent backgrounds
      // { value: 'light_primer' as const, label: <Space size={6}><SunOutlined />{t('ui.theme_light_primer')}</Space> },
      // { value: 'light_paper' as const, label: <Space size={6}><ReadOutlined />{t('ui.theme_light_paper')}</Space> },
      // { value: 'light_latte' as const, label: <Space size={6}><CoffeeOutlined />{t('ui.theme_light_latte')}</Space> },
      { value: 'dark_onedark' as const, label: <Space size={6}><MoonOutlined />{t('ui.theme_dark_onedark')}</Space> },
      { value: 'dark_github' as const, label: <Space size={6}><GithubOutlined />{t('ui.theme_dark_github')}</Space> },
      { value: 'dark_tokyo' as const, label: <Space size={6}><CloudOutlined />{t('ui.theme_dark_tokyo')}</Space> },
      { value: 'amoled' as const, label: <Space size={6}><BlockOutlined />{t('ui.theme_amoled')}</Space> },
      // { value: 'auto' as const, label: <Space size={6}><SyncOutlined />{t('ui.theme_auto')}</Space> },
    ],
    [t],
  )
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
        if (infoData.guns.length > 0) setSelectedGunId(infoData.guns[0].id)
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
    if (!selectedGunId) return
    const seq = ++modsRequestSeq.current
    setLoadingMods(true)
    getWeaponMods(selectedGunId, gameMode, i18n.language || 'en')
      .then(data => {
        if (seq !== modsRequestSeq.current) return
        setAvailableMods(data.mods)
        setIncludedModIds([])
        setExcludedModIds([])
        setIncludedCategories([])
        setExcludedCategories([])
        setLoadingMods(false)
      })
      .catch(err => {
        console.error('Failed to fetch mods', err)
        if (seq !== modsRequestSeq.current) return
        setLoadingMods(false)
      })
  }, [selectedGunId, gameMode, i18n.language])

  const categories = useMemo(() => {
    const filtered = selectedCaliber === 'All' ? guns : guns.filter(g => g.caliber === selectedCaliber)
    return ['All', ...new Set(filtered.map(g => g.category))].sort()
  }, [guns, selectedCaliber])
  const calibers = useMemo(() => {
    const filtered = selectedCategory === 'All' ? guns : guns.filter(g => g.category === selectedCategory)
    return ['All', ...new Set(filtered.map(g => g.caliber))].sort()
  }, [guns, selectedCategory])
  const modCategoryOptions = useMemo((): ModCategoryOption[] => {
    const usedIds = new Set(availableMods.map(m => m.category_id).filter(Boolean))
    const byId = new Map<string, { name: string; normalized: string; childIds: string[] }>()
    for (const m of availableMods) {
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
  }, [availableMods])
  const availableMagCapacities = useMemo(() => {
    const caps = availableMods.filter(m => m.capacity && m.capacity > 0).map(m => m.capacity!)
    return [...new Set(caps)].sort((a, b) => a - b)
  }, [availableMods])
  const selectedGun = guns.find(g => g.id === selectedGunId)
  const moaRange = useMemo(() => {
    const baseMOA = selectedGun?.base_moa ?? 0
    if (baseMOA <= 0) return { base: 0, min: 0, max: 0 }
    // Group by category, take best/worst single mod per category (one per slot)
    // Positive acc mod = better accuracy (lower MOA), negative = worse (higher MOA)
    // finalMOA = baseMOA * (1 - totalAccMod / 100)
    // Best (lowest) MOA: use max positive mod per category
    // Worst (highest) MOA: use min negative mod per category
    const bestByCategory: Record<string, number> = {}
    const worstByCategory: Record<string, number> = {}
    for (const m of availableMods) {
      const acc = m.accuracy_modifier ?? 0
      if (acc === 0) continue
      const cat = m.category_id || 'unknown'
      if (acc > 0) bestByCategory[cat] = Math.max(bestByCategory[cat] ?? 0, acc)
      if (acc < 0) worstByCategory[cat] = Math.min(worstByCategory[cat] ?? 0, acc)
    }
    const bestMod = Object.values(bestByCategory).reduce((s, v) => s + v, 0)
    const worstMod = Object.values(worstByCategory).reduce((s, v) => s + v, 0)
    return {
      base: Math.round(baseMOA * 100) / 100,
      min: Math.round(Math.max(0, baseMOA * (1 - bestMod / 100)) * 100) / 100,
      max: Math.round(baseMOA * (1 - worstMod / 100) * 100) / 100,
    }
  }, [selectedGun, availableMods])
  const filteredGuns = useMemo(() => guns.filter(gun => (selectedCategory === 'All' || gun.category === selectedCategory) && (selectedCaliber === 'All' || gun.caliber === selectedCaliber)), [guns, selectedCategory, selectedCaliber])
  const selectedTask = gunsmithTasks.find(t => t.task_name === selectedTaskName)

  useEffect(() => {
    if (filteredGuns.length > 0 && !filteredGuns.find(g => g.id === selectedGunId)) {
      setSelectedGunId(filteredGuns[0].id)
    }
  }, [filteredGuns, selectedGunId])
  useEffect(() => {
    if (selectedCategory !== 'All' && !categories.includes(selectedCategory)) {
      setSelectedCategory('All')
    }
  }, [categories, selectedCategory])
  useEffect(() => {
    if (selectedCaliber !== 'All' && !calibers.includes(selectedCaliber)) {
      setSelectedCaliber('All')
    }
  }, [calibers, selectedCaliber])

  const handleOptimize = async () => {
    if (!selectedGunId) return
    setOptimizing(true)
    try {
      const res = await optimize({
        weapon_id: selectedGunId,
        ergo_weight: ergoWeight,
        recoil_weight: recoilWeight,
        price_weight: priceWeight,
        max_price: useBudget ? maxPrice : undefined,
        min_ergonomics: minErgo > 0 ? minErgo : undefined,
        min_mag_capacity: useMinMag ? minMagCapacity : undefined,
        max_moa: useMOA ? maxMOA : undefined,
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

  const handleExplore = async () => {
    if (!selectedGunId) return
    setExploring(true)
    try {
      const res = await explore({
        weapon_id: selectedGunId,
        ignore: exploreTradeoff,
        steps: 10,
        max_price: (useBudget ? maxPrice : undefined) ?? (useExploreBudget && exploreTradeoff === 'price' && exploreBudgetValue > 0 ? exploreBudgetValue : undefined),
        min_ergonomics: (minErgo > 0 ? minErgo : undefined) ?? (useExploreBudget && exploreTradeoff === 'ergo' && exploreBudgetValue > 0 ? exploreBudgetValue : undefined),
        max_recoil_v: useExploreBudget && exploreTradeoff === 'recoil' && exploreBudgetValue > 0 ? exploreBudgetValue : undefined,
        min_mag_capacity: useMinMag ? minMagCapacity : undefined,
        max_moa: useMOA ? maxMOA : undefined,
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
      setExploreResult(res.points)
      setExploreSolveTime(res.total_solve_time_ms)
      setExplorePrecisionMeta({
        request: res.precision_request,
        resolved: res.precision_resolved,
      })
      setResultTradeoff(exploreTradeoff)
      if (res.points.length > 0) {
        messageApi.success(t('toast.explore_success'))
      } else {
        messageApi.warning(t('toast.explore_empty'))
      }
    } catch (err) {
      console.error('Exploration failed', err)
      messageApi.error(t('toast.explore_failed'))
    } finally {
      setExploring(false)
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
    setResult(null)
    setMinMagCapacity(0)
    setUseMOA(false)
    setMaxMOA(0)
    setUseMinMag(false)
  }

  const commonPanelProps = {
    guns,
    selectedGunId,
    onGunChange: handleGunChange,
    selectedCategory,
    onCategoryChange: setSelectedCategory,
    selectedCaliber,
    onCaliberChange: setSelectedCaliber,
    categories,
    calibers,
    filteredGuns,
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
              moaRange={moaRange}

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
              onExplore={handleExplore}
              disabled={!selectedGunId}
              weaponId={selectedGunId ?? undefined}
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
              <Tag color="orange" style={{ margin: 0 }}>v2.4.1</Tag>
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
                    <Select style={{ width: '100%' }} value={languages.find(l => i18n.language?.startsWith(l.code))?.code || 'en'} onChange={(v) => i18n.changeLanguage(v)} options={languages.map(l => ({ value: l.code, label: `${l.flag} ${l.name}` }))} />
                  </div>
                )}
              >
                <Button icon={<MenuOutlined />} />
              </Dropdown>
            ) : (
              <Space wrap style={{ justifyContent: 'flex-end' }}>
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
                <Select
                  style={{ minWidth: 268 }}
                  popupMatchSelectWidth={false}
                  value={themeChoice}
                  onChange={(v) => setThemeChoice(v as ThemeChoice)}
                  options={themeSelectOptions}
                />
                <Select style={{ width: 140 }} value={languages.find(l => i18n.language?.startsWith(l.code))?.code || 'en'} onChange={(v) => i18n.changeLanguage(v)} options={languages.map(l => ({ value: l.code, label: `${l.flag} ${l.name}` }))} />
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
            <Link style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => setChangelogOpen(true)}>
              <HistoryOutlined aria-hidden />
              Changelog
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
