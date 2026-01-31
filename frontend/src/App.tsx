import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { getInfo, optimize, explore, getWeaponMods, getGunsmithTasks } from './api/client'
import type { Gun, OptimizeResponse, ModInfo, ExplorePoint, GunsmithTask, GameMode } from './api/client'
import { Loader2, Crosshair, Target, Settings2, ShoppingCart, TrendingUp, ShieldAlert, Zap, Weight, Anchor, Filter, User, Grip, Plus, Minus, Search, Download, FileText, BarChart2, Wrench, CheckCircle, AlertTriangle, ChevronDown, Sun, Moon, Monitor, Globe } from 'lucide-react'
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from 'recharts'
import clsx from 'clsx'

type Theme = 'dark' | 'light' | 'system'

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

function App() {
  const { t, i18n } = useTranslation()

  // --- Theme ---
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme')
    return (saved as Theme) || 'system'
  })

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement

    const applyTheme = (isDark: boolean) => {
      if (isDark) {
        root.classList.add('dark')
      } else {
        root.classList.remove('dark')
      }
    }

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      applyTheme(mediaQuery.matches)

      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches)
      mediaQuery.addEventListener('change', handler)
      return () => mediaQuery.removeEventListener('change', handler)
    } else {
      applyTheme(theme === 'dark')
    }
  }, [theme])

  // Persist theme
  useEffect(() => {
    localStorage.setItem('theme', theme)
  }, [theme])

  // --- Game Mode ---
  const [gameMode, setGameMode] = useState<GameMode>('regular')

  const [guns, setGuns] = useState<Gun[]>([])
  const [selectedGunId, setSelectedGunId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [optimizing, setOptimizing] = useState(false)
  const [result, setResult] = useState<OptimizeResponse | null>(null)
  
  // --- Available Mods for Current Weapon ---
  const [availableMods, setAvailableMods] = useState<ModInfo[]>([])
  const [loadingMods, setLoadingMods] = useState(false)

  // --- Filters ---
  const [selectedCategory, setSelectedCategory] = useState<string>('All')
  const [selectedCaliber, setSelectedCaliber] = useState<string>('All')

  // --- Optimization Weights ---
  const [ergoWeight, setErgoWeight] = useState(33)
  const [recoilWeight, setRecoilWeight] = useState(34)
  const [priceWeight, setPriceWeight] = useState(33)

  // --- Constraints ---
  const [useBudget, setUseBudget] = useState(false)
  const [maxPrice, setMaxPrice] = useState(200000)
  const [minErgo, setMinErgo] = useState(0)

  // --- Included/Excluded Mods ---
  const [includedModIds, setIncludedModIds] = useState<string[]>([])
  const [excludedModIds, setExcludedModIds] = useState<string[]>([])
  const [modSearch, setModSearch] = useState('')

  // --- Included/Excluded Categories ---
  const [includedCategories, setIncludedCategories] = useState<string[]>([])
  const [excludedCategories, setExcludedCategories] = useState<string[]>([])
  const [categorySearch, setCategorySearch] = useState('')

  // --- Market Settings ---
  const [playerLevel, setPlayerLevel] = useState(60)
  const [fleaAvailable, setFleaAvailable] = useState(true)
  const [traderLevels, setTraderLevels] = useState({
    prapor: 4,
    skier: 4,
    peacekeeper: 4,
    mechanic: 4,
    jaeger: 4,
  })

  // --- Weapon Dropdown ---
  const [weaponDropdownOpen, setWeaponDropdownOpen] = useState(false)
  const [weaponSearch, setWeaponSearch] = useState('')
  const weaponDropdownRef = useRef<HTMLDivElement>(null)
  const weaponButtonRef = useRef<HTMLButtonElement>(null)
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 })

  // --- Language Dropdown ---
  const [langDropdownOpen, setLangDropdownOpen] = useState(false)
  const langDropdownRef = useRef<HTMLDivElement>(null)

  // --- Exploration Mode ---
  const [activeTab, setActiveTab] = useState<'optimize' | 'explore' | 'gunsmith'>('optimize')
  const [exploring, setExploring] = useState(false)
  const [exploreResult, setExploreResult] = useState<ExplorePoint[]>([])
  const [exploreTradeoff, setExploreTradeoff] = useState<'price' | 'recoil' | 'ergo'>('price')
  const [resultTradeoff, setResultTradeoff] = useState<'price' | 'recoil' | 'ergo'>('price')

  // --- Gunsmith Mode ---
  const [gunsmithTasks, setGunsmithTasks] = useState<GunsmithTask[]>([])
  const [selectedTaskName, setSelectedTaskName] = useState<string>('')
  const [gunsmithResult, setGunsmithResult] = useState<OptimizeResponse | null>(null)
  const [optimizingGunsmith, setOptimizingGunsmith] = useState(false)

  // Load data when game mode or language changes
  useEffect(() => {
    setLoading(true)
    setResult(null)
    setGunsmithResult(null)
    const lang = i18n.language || 'en'
    Promise.all([
      getInfo(gameMode, lang),
      getGunsmithTasks(gameMode, lang)
    ]).then(([infoData, tasksData]) => {
      setGuns(infoData.guns)
      if (infoData.guns.length > 0) {
        setSelectedGunId(infoData.guns[0].id)
      }
      setGunsmithTasks(tasksData.tasks)
      if (tasksData.tasks.length > 0) {
        setSelectedTaskName(tasksData.tasks[0].task_name)
      }
      setLoading(false)
    }).catch(err => {
      console.error("Failed to fetch data", err)
      setLoading(false)
    })
  }, [gameMode, i18n.language])

  // Fetch mods when weapon selection, game mode, or language changes
  useEffect(() => {
    if (selectedGunId) {
      setLoadingMods(true)
      getWeaponMods(selectedGunId, gameMode, i18n.language || 'en').then(data => {
        setAvailableMods(data.mods)
        setIncludedModIds([])
        setExcludedModIds([])
        setIncludedCategories([])
        setExcludedCategories([])
        setLoadingMods(false)
      }).catch(err => {
        console.error("Failed to fetch mods", err)
        setLoadingMods(false)
      })
    }
  }, [selectedGunId, gameMode, i18n.language])

  // Derived state for filters
  const categories = useMemo(() => ['All', ...new Set(guns.map(g => g.category))].sort(), [guns])
  const calibers = useMemo(() => ['All', ...new Set(guns.map(g => g.caliber))].sort(), [guns])

  // Mod Categories
  const modCategories = useMemo(() => {
    return [...new Set(availableMods.map(m => m.category).filter(Boolean))].sort()
  }, [availableMods])

  const searchedCategories = useMemo(() => {
    const lower = categorySearch.toLowerCase()
    return modCategories.filter(c => 
      c.toLowerCase().includes(lower) && 
      !includedCategories.includes(c) && 
      !excludedCategories.includes(c)
    )
  }, [modCategories, categorySearch, includedCategories, excludedCategories])

  const filteredGuns = useMemo(() => {
    return guns.filter(gun => {
      const catMatch = selectedCategory === 'All' || gun.category === selectedCategory
      const calMatch = selectedCaliber === 'All' || gun.caliber === selectedCaliber
      return catMatch && calMatch
    })
  }, [guns, selectedCategory, selectedCaliber])

  // Filtered mods for the search UI
  const searchedMods = useMemo(() => {
    if (!modSearch) return []
    const lower = modSearch.toLowerCase()
    return availableMods.filter(m => 
      m.name.toLowerCase().includes(lower) && 
      !includedModIds.includes(m.id) && 
      !excludedModIds.includes(m.id)
    ).slice(0, 10)
  }, [availableMods, modSearch, includedModIds, excludedModIds])

  // Reset selection if current gun is filtered out
  useEffect(() => {
    if (filteredGuns.length > 0) {
      if (!filteredGuns.find(g => g.id === selectedGunId)) {
        setSelectedGunId(filteredGuns[0].id)
      }
    }
  }, [filteredGuns, selectedGunId])

  // Close weapon dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (weaponDropdownRef.current && !weaponDropdownRef.current.contains(e.target as Node)) {
        setWeaponDropdownOpen(false)
      }
      if (langDropdownRef.current && !langDropdownRef.current.contains(e.target as Node)) {
        setLangDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Filter weapons for dropdown search
  const dropdownGuns = useMemo(() => {
    if (!weaponSearch) return filteredGuns
    const lower = weaponSearch.toLowerCase()
    return filteredGuns.filter(g => g.name.toLowerCase().includes(lower))
  }, [filteredGuns, weaponSearch])

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
        include_items: includedModIds.length > 0 ? includedModIds : undefined,
        exclude_items: excludedModIds.length > 0 ? excludedModIds : undefined,
        include_categories: includedCategories.length > 0 ? includedCategories.map(c => [c]) : undefined,
        exclude_categories: excludedCategories.length > 0 ? excludedCategories : undefined,
        trader_levels: traderLevels,
        player_level: playerLevel,
        flea_available: fleaAvailable,
      }, gameMode, i18n.language || 'en')
      setResult(res)
    } catch (err) {
      console.error("Optimization failed", err)
      alert("Optimization failed. Check console for details.")
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
        max_price: useBudget ? maxPrice : undefined,
        min_ergonomics: minErgo > 0 ? minErgo : undefined,
        include_items: includedModIds.length > 0 ? includedModIds : undefined,
        exclude_items: excludedModIds.length > 0 ? excludedModIds : undefined,
        include_categories: includedCategories.length > 0 ? includedCategories.map(c => [c]) : undefined,
        exclude_categories: excludedCategories.length > 0 ? excludedCategories : undefined,
        trader_levels: traderLevels,
        player_level: playerLevel,
        flea_available: fleaAvailable,
      }, gameMode, i18n.language || 'en')
      setExploreResult(res.points)
      setResultTradeoff(exploreTradeoff)
    } catch (err) {
      console.error("Exploration failed", err)
      alert("Exploration failed. Check console for details.")
    } finally {
      setExploring(false)
    }
  }

  const selectedTask = gunsmithTasks.find(t => t.task_name === selectedTaskName)

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
      }, gameMode, i18n.language || 'en')
      setGunsmithResult(res)
    } catch (err) {
      console.error("Gunsmith optimization failed", err)
      alert("Gunsmith optimization failed. Check console for details.")
    } finally {
      setOptimizingGunsmith(false)
    }
  }

  const exportBuild = (type: 'json' | 'md') => {
    if (!result) return
    const content = type === 'json' 
      ? JSON.stringify(result, null, 2)
      : `# ${selectedGun?.name} Optimized Build\n\n` + 
        `## Stats\n- Ergo: ${result.final_stats?.ergonomics.toFixed(1)}\n- Recoil: ${result.final_stats?.recoil_vertical.toFixed(0)}\n- Price: ₽${result.final_stats?.total_price.toLocaleString()}\n\n` + 
        `## Parts\n` + result.selected_items.map(i => `- ${i.name} (₽${i.price.toLocaleString()})`).join('\n')
    
    const blob = new Blob([content], { type: type === 'json' ? 'application/json' : 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `build_${selectedGun?.name.replace(/\s+/g, '_')}.${type}`
    a.click()
  }

  const applyPreset = (ergo: number, recoil: number, price: number) => {
    setErgoWeight(ergo)
    setRecoilWeight(recoil)
    setPriceWeight(price)
  }

  const selectedGun = guns.find(g => g.id === selectedGunId)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-zinc-100 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400">
        <Loader2 className="animate-spin h-8 w-8 text-orange-500" />
        <span className="ml-3 font-medium tracking-wide">{t('ui.initializing', 'INITIALIZING ARMORY...')}</span>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 font-sans selection:bg-orange-500/30 transition-colors duration-200">
      <header className="border-b border-zinc-300 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="w-full px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-orange-500/10 p-2 rounded-lg border border-orange-500/20">
              <Crosshair className="text-orange-500 h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">
                {t('app.title', 'Tarkov Optimizer')} <span className="text-orange-500 text-xs align-top">v2</span>
              </h1>
              <p className="text-xs text-zinc-500 font-mono hidden sm:block">{t('app.subtitle', 'TACTICAL WEAPONRY CONFIGURATOR')}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* Game Mode Toggle */}
            <div className="flex items-center gap-1 p-1 bg-zinc-200 dark:bg-zinc-800 rounded-lg border border-zinc-300 dark:border-zinc-700">
              <button
                onClick={() => setGameMode('regular')}
                className={clsx(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                  gameMode === 'regular'
                    ? "bg-orange-500 text-white shadow-sm"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                )}
              >
                PvP
              </button>
              <button
                onClick={() => setGameMode('pve')}
                className={clsx(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                  gameMode === 'pve'
                    ? "bg-green-500 text-white shadow-sm"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                )}
              >
                PvE
              </button>
            </div>
            {/* Theme Toggle */}
            <div className="flex items-center gap-1 p-1 bg-zinc-200 dark:bg-zinc-800 rounded-lg border border-zinc-300 dark:border-zinc-700">
              <button
                onClick={() => setTheme('light')}
                className={clsx(
                  "p-1.5 rounded-md transition-all",
                  theme === 'light'
                    ? "bg-yellow-500 text-white shadow-sm"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                )}
                title="Light mode"
              >
                <Sun className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setTheme('dark')}
                className={clsx(
                  "p-1.5 rounded-md transition-all",
                  theme === 'dark'
                    ? "bg-indigo-500 text-white shadow-sm"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                )}
                title="Dark mode"
              >
                <Moon className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setTheme('system')}
                className={clsx(
                  "p-1.5 rounded-md transition-all",
                  theme === 'system'
                    ? "bg-zinc-600 text-white shadow-sm"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                )}
                title="System preference"
              >
                <Monitor className="h-3.5 w-3.5" />
              </button>
            </div>
            {/* Language Selector */}
            <div className="relative" ref={langDropdownRef}>
              <button
                onClick={() => setLangDropdownOpen(!langDropdownOpen)}
                className="flex items-center gap-1.5 px-2 py-1.5 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded-lg border border-zinc-300 dark:border-zinc-700 transition-colors"
              >
                <Globe className="h-3.5 w-3.5 text-zinc-600 dark:text-zinc-400" />
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  {languages.find(l => l.code === i18n.language)?.flag || '🌐'} {i18n.language?.toUpperCase() || 'EN'}
                </span>
                <ChevronDown className={clsx("h-3 w-3 text-zinc-500 transition-transform", langDropdownOpen && "rotate-180")} />
              </button>
              {langDropdownOpen && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg shadow-xl overflow-hidden z-50 max-h-80 overflow-y-auto">
                  {languages.map(lang => (
                    <button
                      key={lang.code}
                      onClick={() => {
                        i18n.changeLanguage(lang.code)
                        setLangDropdownOpen(false)
                      }}
                      className={clsx(
                        "w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors",
                        i18n.language === lang.code
                          ? "bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-400"
                          : "hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                      )}
                    >
                      <span>{lang.flag}</span>
                      <span className="flex-1 text-left">{lang.name}</span>
                      {i18n.language === lang.code && <CheckCircle className="h-3.5 w-3.5" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="text-xs font-mono text-zinc-500 flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse"></div>
              {t('status.system_online', 'SYSTEM ONLINE')}
            </div>
          </div>
        </div>
      </header>

      <main className="w-full p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Sidebar: Controls */}
        <div className="lg:col-span-4 xl:col-span-3 min-[1800px]:col-span-2 space-y-6">
          
          {/* Weapon Selection Card */}
          <section className="bg-white dark:bg-zinc-900/40 border border-zinc-300 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 flex items-center gap-2">
              <Target className="h-4 w-4 text-orange-500" />
              <h2 className="font-semibold text-zinc-800 dark:text-zinc-100 text-sm tracking-wide uppercase">{t('sidebar.select_weapon', 'Weapon Platform')}</h2>
            </div>
            
            <div className="p-5 space-y-4">
              {/* Filters */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-zinc-500 font-medium flex items-center gap-1">
                    <Filter className="h-3 w-3" /> {t('sidebar.filter_gun_type', 'Category')}
                  </label>
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="w-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-md p-2 text-xs text-zinc-900 dark:text-white outline-none focus:border-zinc-400 dark:focus:border-zinc-500"
                  >
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-zinc-500 font-medium flex items-center gap-1">
                    <Filter className="h-3 w-3" /> {t('sidebar.filter_caliber', 'Caliber')}
                  </label>
                  <select
                    value={selectedCaliber}
                    onChange={(e) => setSelectedCaliber(e.target.value)}
                    className="w-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-md p-2 text-xs text-zinc-900 dark:text-white outline-none focus:border-zinc-400 dark:focus:border-zinc-500"
                  >
                    {calibers.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              {/* Custom Weapon Dropdown with Images */}
              <div ref={weaponDropdownRef}>
                {/* Selected Weapon Button */}
                <button
                  ref={weaponButtonRef}
                  onClick={() => {
                    if (!weaponDropdownOpen && weaponButtonRef.current) {
                      const rect = weaponButtonRef.current.getBoundingClientRect()
                      setDropdownPosition({
                        top: rect.bottom + 4,
                        left: rect.left,
                        width: rect.width
                      })
                    }
                    setWeaponDropdownOpen(!weaponDropdownOpen)
                  }}
                  className="w-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-750 border border-zinc-300 dark:border-zinc-700 rounded-lg p-2 text-left outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/50 transition-all cursor-pointer"
                >
                  {selectedGun ? (
                    <div className="flex items-center gap-3">
                      <div className="h-14 w-28 bg-zinc-200 dark:bg-zinc-900 rounded flex items-center justify-center overflow-hidden flex-shrink-0 p-1">
                        {selectedGun.image ? (
                          <img src={selectedGun.image} alt={selectedGun.name} className="max-w-full max-h-full object-contain" />
                        ) : (
                          <Crosshair className="text-zinc-400 dark:text-zinc-700 h-6 w-6" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-zinc-900 dark:text-white text-sm truncate">{selectedGun.name}</div>
                        <div className="text-[10px] text-zinc-500 font-mono">{selectedGun.category} • {selectedGun.caliber}</div>
                      </div>
                      <ChevronDown className={clsx("h-4 w-4 text-zinc-500 transition-transform", weaponDropdownOpen && "rotate-180")} />
                    </div>
                  ) : (
                    <div className="flex items-center justify-between py-2">
                      <span className="text-zinc-500 text-sm">{t('ui.select_weapon', 'Select a weapon...')}</span>
                      <ChevronDown className="h-4 w-4 text-zinc-500" />
                    </div>
                  )}
                </button>

                {/* Dropdown Menu - Fixed Position */}
                {weaponDropdownOpen && (
                  <div
                    className="fixed z-[100] bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg shadow-2xl overflow-hidden"
                    style={{
                      top: dropdownPosition.top,
                      left: dropdownPosition.left,
                      width: Math.max(dropdownPosition.width, 400),
                    }}
                  >
                    {/* Search Input */}
                    <div className="p-2 border-b border-zinc-200 dark:border-zinc-800">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2 h-4 w-4 text-zinc-500" />
                        <input
                          type="text"
                          placeholder="Search weapons..."
                          value={weaponSearch}
                          onChange={(e) => setWeaponSearch(e.target.value)}
                          className="w-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-md py-1.5 pl-8 pr-3 text-sm text-zinc-900 dark:text-white outline-none focus:border-zinc-400 dark:focus:border-zinc-500"
                          autoFocus
                        />
                      </div>
                    </div>

                    {/* Options List */}
                    <div className="max-h-[400px] overflow-y-auto">
                      {dropdownGuns.length === 0 ? (
                        <div className="p-4 text-center text-zinc-500 text-sm">{t('ui.no_weapons_found', 'No weapons found')}</div>
                      ) : (
                        dropdownGuns.map(gun => (
                          <button
                            key={gun.id}
                            onClick={() => {
                              setSelectedGunId(gun.id)
                              setResult(null)
                              setWeaponDropdownOpen(false)
                              setWeaponSearch('')
                            }}
                            className={clsx(
                              "w-full flex items-center gap-4 p-3 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-left",
                              gun.id === selectedGunId && "bg-zinc-100 dark:bg-zinc-800/50"
                            )}
                          >
                            <div className="h-12 w-24 bg-zinc-200 dark:bg-zinc-800 rounded flex items-center justify-center overflow-hidden flex-shrink-0 p-1">
                              {gun.image ? (
                                <img src={gun.image} alt={gun.name} className="max-w-full max-h-full object-contain" />
                              ) : (
                                <Crosshair className="text-zinc-400 dark:text-zinc-700 h-5 w-5" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-zinc-900 dark:text-white truncate">{gun.name}</div>
                              <div className="text-[10px] text-zinc-500 font-mono">{gun.category} • {gun.caliber}</div>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Configuration Card */}
          <section className="bg-white dark:bg-zinc-900/40 border border-zinc-300 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
             <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 flex items-center gap-2">
              <Grip className="h-4 w-4 text-blue-500" />
              <h2 className="font-semibold text-zinc-800 dark:text-zinc-100 text-sm tracking-wide uppercase">{t('optimize.header', 'Build Priorities')}</h2>
            </div>
            
            <div className="p-5 space-y-6">
              
              {/* Presets */}
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => applyPreset(0, 100, 0)} className="bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-[10px] font-medium py-2 rounded border border-zinc-300 dark:border-zinc-700 text-zinc-800 dark:text-zinc-300 uppercase tracking-tighter transition-colors">{t('optimize.preset_recoil', 'Recoil')}</button>
                <button onClick={() => applyPreset(100, 0, 0)} className="bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-[10px] font-medium py-2 rounded border border-zinc-300 dark:border-zinc-700 text-zinc-800 dark:text-zinc-300 uppercase tracking-tighter transition-colors">{t('optimize.preset_ergo', 'Ergo')}</button>
                <button onClick={() => applyPreset(33, 34, 33)} className="bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-[10px] font-medium py-2 rounded border border-zinc-300 dark:border-zinc-700 text-zinc-800 dark:text-zinc-300 uppercase tracking-tighter transition-colors">{t('optimize.preset_balanced', 'Balanced')}</button>
              </div>

              {/* Weights */}
              <div className="space-y-4">
                <WeightSlider label={t('sidebar.ergonomics', 'Ergonomics')} value={ergoWeight} setValue={setErgoWeight} color="accent-blue-500" />
                <WeightSlider label={t('optimize.preset_recoil', 'Recoil')} value={recoilWeight} setValue={setRecoilWeight} color="accent-green-500" />
                <WeightSlider label={t('sidebar.price', 'Price')} value={priceWeight} setValue={setPriceWeight} color="accent-yellow-500" />
              </div>

              <div className="h-px bg-zinc-800/50"></div>

              {/* Constraints */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                   <label className="text-sm text-zinc-700 dark:text-zinc-300 flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={useBudget}
                      onChange={(e) => setUseBudget(e.target.checked)}
                      className="rounded border-zinc-400 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-orange-500 focus:ring-0 focus:ring-offset-0 w-4 h-4 accent-orange-500"
                    />
                    {t('constraints.budget_limit', 'Budget Limit')}
                  </label>
                  {useBudget && (
                     <div className="text-xs font-mono text-yellow-500">
                       ₽{maxPrice.toLocaleString()}
                     </div>
                  )}
                </div>

                {useBudget && (
                  <input
                    type="range" min="10000" max="1000000" step="5000"
                    value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))}
                    className="w-full h-1.5 bg-zinc-300 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-yellow-500"
                  />
                )}

                <WeightSlider label={t('constraints.min_ergo', 'Min Ergo')} value={minErgo} setValue={setMinErgo} color="accent-zinc-500" />
              </div>
            </div>
          </section>

          {/* Advanced Mod Constraints */}
          <section className="bg-white dark:bg-zinc-900/40 border border-zinc-300 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 flex items-center gap-2">
              <Plus className="h-4 w-4 text-green-500" />
              <h2 className="font-semibold text-zinc-800 dark:text-zinc-100 text-sm tracking-wide uppercase">{t('sidebar.include_exclude', 'Include/Exclude Mods')}</h2>
            </div>
            <div className="p-5 space-y-4">
              
              {/* Category Search */}
              <div className="space-y-3 pb-4 border-b border-zinc-200 dark:border-zinc-700">
                <div className="relative">
                  <Filter className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                  <input
                    type="text" placeholder={t('sidebar.require_categories', 'Search categories...')} value={categorySearch} onChange={(e) => setCategorySearch(e.target.value)}
                    className="w-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg py-2 pl-10 pr-4 text-sm text-zinc-900 dark:text-white outline-none focus:border-zinc-400 dark:focus:border-zinc-500"
                  />
                </div>

                {searchedCategories.length > 0 && categorySearch && (
                  <div className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg overflow-hidden divide-y divide-zinc-200 dark:divide-zinc-700 max-h-40 overflow-y-auto">
                    {searchedCategories.map(cat => (
                      <div key={cat} className="p-2 flex items-center justify-between group hover:bg-zinc-200 dark:hover:bg-zinc-700">
                        <span className="text-xs text-zinc-700 dark:text-zinc-300 truncate">{cat}</span>
                        <div className="flex gap-1">
                          <button onClick={() => { setIncludedCategories([...includedCategories, cat]); setCategorySearch('') }} className="p-1 hover:bg-green-500/20 text-green-500 rounded"><Plus className="h-3 w-3" /></button>
                          <button onClick={() => { setExcludedCategories([...excludedCategories, cat]); setCategorySearch('') }} className="p-1 hover:bg-red-500/20 text-red-500 rounded"><Minus className="h-3 w-3" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Category Selection Summary */}
                <div className="space-y-2">
                  {includedCategories.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {includedCategories.map(cat => (
                        <div key={cat} className="bg-green-100 dark:bg-green-500/10 border border-green-300 dark:border-green-500/20 px-2 py-1 rounded flex items-center gap-1">
                          <span className="text-[10px] text-green-800 dark:text-green-400 truncate max-w-[80px]">{cat}</span>
                          <button onClick={() => setIncludedCategories(includedCategories.filter(c => c !== cat))} className="text-green-600 dark:text-green-600 hover:text-green-800 dark:hover:text-green-400"><Minus className="h-2 w-2" /></button>
                        </div>
                      ))}
                    </div>
                  )}
                  {excludedCategories.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {excludedCategories.map(cat => (
                        <div key={cat} className="bg-red-100 dark:bg-red-500/10 border border-red-300 dark:border-red-500/20 px-2 py-1 rounded flex items-center gap-1">
                          <span className="text-[10px] text-red-800 dark:text-red-400 truncate max-w-[80px]">{cat}</span>
                          <button onClick={() => setExcludedCategories(excludedCategories.filter(c => c !== cat))} className="text-red-600 dark:text-red-600 hover:text-red-800 dark:hover:text-red-400"><Minus className="h-2 w-2" /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                <input
                  type="text" placeholder={t('sidebar.require_items', 'Search compatible parts...')} value={modSearch} onChange={(e) => setModSearch(e.target.value)}
                  className="w-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg py-2 pl-10 pr-4 text-sm text-zinc-900 dark:text-white outline-none focus:border-zinc-400 dark:focus:border-zinc-500"
                />
                {loadingMods && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-zinc-600" />}
              </div>

              {searchedMods.length > 0 && (
                <div className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg overflow-hidden divide-y divide-zinc-200 dark:divide-zinc-700">
                  {searchedMods.map(m => (
                    <div key={m.id} className="p-2 flex items-center justify-between group">
                      <div className="flex items-center gap-2 truncate">
                        {m.icon && <img src={m.icon} className="h-6 w-6 object-contain" alt="" />}
                        <span className="text-xs text-zinc-700 dark:text-zinc-300 truncate">{m.name}</span>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => { setIncludedModIds([...includedModIds, m.id]); setModSearch('') }} className="p-1 hover:bg-green-500/20 text-green-500 rounded"><Plus className="h-3 w-3" /></button>
                        <button onClick={() => { setExcludedModIds([...excludedModIds, m.id]); setModSearch('') }} className="p-1 hover:bg-red-500/20 text-red-500 rounded"><Minus className="h-3 w-3" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Selection Summary */}
              <div className="space-y-3">
                {includedModIds.length > 0 && (
                  <div className="space-y-1">
                    <label className="text-[10px] text-green-600 dark:text-green-500 font-bold uppercase">{t('sidebar.require_items', 'Required Parts')}</label>
                    <div className="flex flex-wrap gap-1">
                      {includedModIds.map(id => (
                        <div key={id} className="bg-green-100 dark:bg-green-500/10 border border-green-300 dark:border-green-500/20 px-2 py-1 rounded flex items-center gap-1">
                          <span className="text-[10px] text-green-800 dark:text-green-400 truncate max-w-[80px]">{availableMods.find(m => m.id === id)?.name}</span>
                          <button onClick={() => setIncludedModIds(includedModIds.filter(i => i !== id))} className="text-green-600 dark:text-green-600 hover:text-green-800 dark:hover:text-green-400"><Minus className="h-2 w-2" /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {excludedModIds.length > 0 && (
                  <div className="space-y-1">
                    <label className="text-[10px] text-red-600 dark:text-red-500 font-bold uppercase">{t('sidebar.ban_items', 'Banned Parts')}</label>
                    <div className="flex flex-wrap gap-1">
                      {excludedModIds.map(id => (
                        <div key={id} className="bg-red-100 dark:bg-red-500/10 border border-red-300 dark:border-red-500/20 px-2 py-1 rounded flex items-center gap-1">
                          <span className="text-[10px] text-red-800 dark:text-red-400 truncate max-w-[80px]">{availableMods.find(m => m.id === id)?.name}</span>
                          <button onClick={() => setExcludedModIds(excludedModIds.filter(i => i !== id))} className="text-red-600 dark:text-red-600 hover:text-red-800 dark:hover:text-red-400"><Minus className="h-2 w-2" /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Market & Traders Card */}
          <section className="bg-white dark:bg-zinc-900/40 border border-zinc-300 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 flex items-center gap-2">
              <User className="h-4 w-4 text-purple-500" />
              <h2 className="font-semibold text-zinc-800 dark:text-zinc-100 text-sm tracking-wide uppercase">{t('sidebar.player_trader_access', 'Market Access')}</h2>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-sm text-zinc-700 dark:text-zinc-300">{t('sidebar.flea_market_access', 'Flea Market')}</label>
                <input
                  type="checkbox" checked={fleaAvailable} onChange={(e) => setFleaAvailable(e.target.checked)}
                  className="rounded border-zinc-400 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-orange-500 w-4 h-4 accent-orange-500"
                />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">{t('sidebar.player_level', 'Player Level')}</span>
                  <span className="text-zinc-800 dark:text-zinc-200 font-mono">{playerLevel}</span>
                </div>
                <input type="range" min="1" max="79" value={playerLevel} onChange={(e) => setPlayerLevel(Number(e.target.value))} className="w-full h-1.5 bg-zinc-300 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-500" />
              </div>

              <div className="h-px bg-zinc-200 dark:bg-zinc-800/50 my-2"></div>

              <div className="grid grid-cols-2 gap-4">
                {(Object.keys(traderLevels) as Array<keyof typeof traderLevels>).map(trader => (
                  <div key={trader} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-500 capitalize">{trader}</span>
                      <span className="text-zinc-600 dark:text-zinc-500 font-mono">LL{traderLevels[trader]}</span>
                    </div>
                    <input
                      type="range" min="1" max="4" step="1"
                      value={traderLevels[trader]}
                      onChange={(e) => setTraderLevels(prev => ({ ...prev, [trader]: Number(e.target.value) }))}
                      className="w-full h-1.5 bg-zinc-300 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>

          <footer className="px-2 py-4 text-[10px] text-zinc-500 font-mono space-y-1">
            <p>{t('ui.footer_data')} <a href="https://tarkov.dev" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:underline text-xs">tarkov.dev</a></p>
            <p>{t('ui.footer_copyright')} | <a href="https://github.com/AhaiMk01" target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-zinc-300 hover:underline">GitHub</a></p>
          </footer>

        </div>

        {/* Right Content: Results */}
        <div className="lg:col-span-8 xl:col-span-9 min-[1800px]:col-span-10 flex flex-col gap-6">
          
          {/* Mode Tabs & Action */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 p-1 bg-zinc-200 dark:bg-zinc-900/50 rounded-lg border border-zinc-300 dark:border-zinc-800 w-fit">
              <button
                onClick={() => setActiveTab('optimize')}
                className={clsx(
                  "px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                  activeTab === 'optimize'
                    ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm"
                    : "text-zinc-600 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300"
                )}
              >
                <Zap className="h-4 w-4" /> {t('tabs.optimize', 'Optimize')}
              </button>
              <button
                onClick={() => setActiveTab('explore')}
                className={clsx(
                  "px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                  activeTab === 'explore'
                    ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm"
                    : "text-zinc-600 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300"
                )}
              >
                <BarChart2 className="h-4 w-4" /> {t('tabs.explore', 'Explore')}
              </button>
              <button
                onClick={() => setActiveTab('gunsmith')}
                className={clsx(
                  "px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                  activeTab === 'gunsmith'
                    ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm"
                    : "text-zinc-600 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300"
                )}
              >
                <Wrench className="h-4 w-4" /> {t('tabs.gunsmith', 'Gunsmith')}
              </button>
            </div>

            {activeTab === 'optimize' && result && (
              <button
                onClick={handleOptimize}
                disabled={optimizing || !selectedGunId || filteredGuns.length === 0}
                className={clsx(
                  "px-6 py-2 rounded-lg font-bold text-xs tracking-wide transition-all shadow-lg flex items-center justify-center gap-2",
                  optimizing || !selectedGunId
                    ? "bg-zinc-300 dark:bg-zinc-800 text-zinc-500 cursor-not-allowed"
                    : "bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-400 text-white shadow-orange-900/20 active:scale-[0.98]"
                )}
              >
                {optimizing ? <Loader2 className="animate-spin h-3 w-3" /> : <Zap className="h-3 w-3 fill-current" />}
                {optimizing ? t('status.optimizing', 'RE-CALCULATING...') : t('optimize.optimize_btn', 'RE-ASSEMBLE BUILD')}
              </button>
            )}
          </div>

          {activeTab === 'optimize' ? (
            result ? (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              
              {/* Status Banner */}
              <div className={clsx(
                "p-4 rounded-xl border flex items-center justify-between",
                result.status === 'optimal' 
                  ? "bg-green-500/10 border-green-500/20 text-green-400" 
                  : result.status === 'infeasible'
                  ? "bg-red-500/10 border-red-500/20 text-red-400"
                  : "bg-yellow-500/10 border-yellow-500/20 text-yellow-400"
              )}>
                <div className="flex items-center gap-3">
                  {result.status === 'infeasible' ? <ShieldAlert className="h-5 w-5" /> : <Target className="h-5 w-5" />}
                  <div>
                    <h3 className="font-bold text-sm uppercase tracking-wide">{t('results.optimization_status', 'Optimization Status')}: {result.status}</h3>
                    {result.reason && <p className="text-xs opacity-80 mt-1">{result.reason}</p>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs opacity-70 uppercase tracking-wider">{t('ui.objective_score', 'Objective Score')}</div>
                  <div className="font-mono font-bold text-lg">{result.objective_value.toFixed(0)}</div>
                </div>
              </div>

              {result.status !== 'infeasible' && result.final_stats && (
                <>
                  {/* Detailed Stats Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                     {/* Ergonomics */}
                     <div className="bg-white dark:bg-zinc-900/50 border border-zinc-300 dark:border-zinc-800 p-4 rounded-xl">
                        <div className="flex items-center gap-2 mb-2 text-zinc-500 dark:text-zinc-400">
                          <Settings2 className="h-4 w-4" />
                          <span className="text-xs uppercase font-bold tracking-wider">{t('sidebar.ergonomics', 'Ergonomics')}</span>
                        </div>
                        <div className="text-2xl font-mono text-zinc-900 dark:text-white">
                          {Math.min(100, Math.max(0, result.final_stats.ergonomics)).toFixed(1)}
                        </div>
                     </div>

                     {/* Vertical Recoil */}
                     <div className="bg-white dark:bg-zinc-900/50 border border-zinc-300 dark:border-zinc-800 p-4 rounded-xl">
                        <div className="flex items-center gap-2 mb-2 text-green-600 dark:text-green-500/80">
                          <Anchor className="h-4 w-4" />
                          <span className="text-xs uppercase font-bold tracking-wider">{t('ui.vert_recoil', 'Vert. Recoil')}</span>
                        </div>
                        <div className="text-2xl font-mono text-zinc-900 dark:text-white">
                          {result.final_stats.recoil_vertical.toFixed(0)}
                        </div>
                     </div>

                     {/* Horizontal Recoil */}
                     <div className="bg-white dark:bg-zinc-900/50 border border-zinc-300 dark:border-zinc-800 p-4 rounded-xl">
                        <div className="flex items-center gap-2 mb-2 text-zinc-500 dark:text-zinc-400">
                          <Anchor className="h-4 w-4 rotate-90" />
                          <span className="text-xs uppercase font-bold tracking-wider">{t('ui.horiz_recoil', 'Horiz. Recoil')}</span>
                        </div>
                        <div className="text-2xl font-mono text-zinc-900 dark:text-white">
                          {result.final_stats.recoil_horizontal.toFixed(0)}
                        </div>
                     </div>

                     {/* Cost */}
                     <div className="bg-white dark:bg-zinc-900/50 border border-zinc-300 dark:border-zinc-800 p-4 rounded-xl">
                        <div className="flex items-center gap-2 mb-2 text-yellow-600 dark:text-yellow-500/80">
                          <DollarSignIcon className="h-4 w-4" />
                          <span className="text-xs uppercase font-bold tracking-wider">{t('ui.total_cost', 'Total Cost')}</span>
                        </div>
                        <div className="text-2xl font-mono text-zinc-900 dark:text-white">
                          ₽{result.final_stats.total_price.toLocaleString()}
                        </div>
                     </div>
                  </div>

                  <div className="flex gap-4">
                     <div className="bg-zinc-100 dark:bg-zinc-900/30 border border-zinc-300 dark:border-zinc-800/50 p-2 px-4 rounded-lg flex items-center gap-2 text-zinc-500 text-xs font-mono">
                        <Weight className="h-3 w-3" />
                        {t('ui.weight_kg', 'Weight: {{value}} kg', { value: result.final_stats.total_weight.toFixed(2) })}
                     </div>
                  </div>

                  {/* Preset Info (if used) */}
                  {result.selected_preset && (
                    <div className="bg-blue-50 dark:bg-blue-500/5 border border-blue-200 dark:border-blue-500/10 p-4 rounded-xl">
                      <div className="flex items-center gap-4">
                        {/* Preset Image */}
                        <div className="h-20 w-40 bg-zinc-200 dark:bg-zinc-800 rounded-lg flex items-center justify-center overflow-hidden border border-zinc-300 dark:border-zinc-700/50 flex-shrink-0 p-2">
                          {result.selected_preset.icon ? (
                            <img src={result.selected_preset.icon} alt={result.selected_preset.name} className="max-w-full max-h-full object-contain" />
                          ) : (
                            <ShoppingCart className="h-8 w-8 text-zinc-400" />
                          )}
                        </div>
                        {/* Preset Info */}
                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider">{t('ui.base_preset_used', 'Base Preset Used')}</h4>
                          <p className="text-base text-zinc-900 dark:text-white font-medium mt-1 truncate">{result.selected_preset.name}</p>
                          <p className="text-xs text-zinc-500 mt-1">{t('ui.preset_more_optimal', 'Starting from this preset was more optimal than building from scratch.')}</p>
                        </div>
                        {/* Preset Source & Price */}
                        <div className="text-right flex-shrink-0">
                          {result.selected_preset.source && (
                            <div className="mb-2">
                              <span className="px-2 py-1 rounded bg-zinc-200 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700/50 text-xs text-zinc-700 dark:text-zinc-300">
                                {result.selected_preset.source}
                              </span>
                            </div>
                          )}
                          <div className="text-xl font-mono text-yellow-600 dark:text-yellow-500 font-bold">
                            ₽{result.selected_preset.price.toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Parts List */}
                  <div className="bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 rounded-xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/80">
                      <h3 className="font-semibold text-zinc-800 dark:text-zinc-100 flex items-center gap-2">
                        <Settings2 className="h-4 w-4 text-orange-500" />
                        {t('ui.build_manifest', 'Build Manifest')}
                      </h3>
                      <div className="flex items-center gap-4">
                        <button onClick={() => exportBuild('md')} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors">
                          <FileText className="h-3 w-3" /> {t('ui.export_md', 'EXPORT MD')}
                        </button>
                        <button onClick={() => exportBuild('json')} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors">
                          <Download className="h-3 w-3" /> {t('ui.export_json', 'EXPORT JSON')}
                        </button>
                      </div>
                    </div>

                    {/* Table Header */}
                    <div className="grid grid-cols-[80px_1fr_120px_150px_100px] gap-4 px-6 py-2 bg-zinc-100 dark:bg-zinc-950/30 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800/50 hidden md:grid">
                      <div>{t('ui.table_image', 'Image')}</div>
                      <div>{t('table.name', 'Name')}</div>
                      <div>{t('ui.table_stats', 'Stats')}</div>
                      <div>{t('ui.table_source', 'Source')}</div>
                      <div className="text-right">{t('ui.table_price', 'Price')}</div>
                    </div>

                    {result.selected_preset ? (
                        <>
                           <div className="px-6 py-2 bg-zinc-100 dark:bg-zinc-950/50 text-[10px] font-bold text-orange-600 dark:text-orange-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800/50">
                              {t('ui.new_changed_parts', 'New / Changed Parts')}
                           </div>
                           <div className="divide-y divide-zinc-200 dark:divide-zinc-800/50">
                              {result.selected_items.filter(i => !result.selected_preset!.items.includes(i.id)).map(item => (
                                 <ItemRow key={item.id} item={item} />
                              ))}
                           </div>

                           <div className="px-6 py-2 bg-zinc-100 dark:bg-zinc-950/50 text-[10px] font-bold text-blue-600 dark:text-blue-500 uppercase tracking-wider border-b border-zinc-800/50 border-t border-zinc-200 dark:border-zinc-800/50">
                              {t('ui.retained_from_preset', 'Retained from Preset: {{name}}', { name: result.selected_preset.name })}
                           </div>
                           <div className="divide-y divide-zinc-200 dark:divide-zinc-800/50">
                              {result.selected_items.filter(i => result.selected_preset!.items.includes(i.id)).map(item => (
                                 <ItemRow key={item.id} item={item} hidePrice />
                              ))}
                           </div>
                        </>
                    ) : (
                        <div className="divide-y divide-zinc-200 dark:divide-zinc-800/50">
                           {result.selected_items.map(item => <ItemRow key={item.id} item={item} />)}
                        </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex-1 min-h-[400px] flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-zinc-300 dark:border-zinc-800 rounded-xl bg-zinc-50 dark:bg-zinc-900/20">
              <div className="h-20 w-20 bg-zinc-200 dark:bg-zinc-900 rounded-full flex items-center justify-center mb-6 border border-zinc-300 dark:border-zinc-800 shadow-xl">
                 <TrendingUp className="h-10 w-10 text-zinc-400" />
              </div>
              <h3 className="text-xl font-bold text-zinc-700 dark:text-zinc-300 mb-2">{t('optimize.ready_title', 'Ready to Optimize')}</h3>
              <p className="text-zinc-500 max-w-md mb-8">
                {t('optimize.ready_description', 'Select a weapon platform and adjust your priorities to generate the mathematically perfect build for your budget.')}
              </p>
              <button
                onClick={handleOptimize}
                disabled={optimizing || !selectedGunId || filteredGuns.length === 0}
                className={clsx(
                  "px-8 py-4 rounded-xl font-bold text-lg tracking-wide transition-all shadow-xl flex items-center justify-center gap-3",
                  optimizing || !selectedGunId
                    ? "bg-zinc-300 dark:bg-zinc-800 text-zinc-500 cursor-not-allowed"
                    : "bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-400 text-white shadow-orange-900/40 hover:scale-[1.02] active:scale-[0.98]"
                )}
              >
                {optimizing ? <Loader2 className="animate-spin h-6 w-6" /> : <Zap className="h-6 w-6 fill-current text-orange-200" />}
                {optimizing ? t('status.optimizing', 'CALCULATING...') : t('optimize.generate_btn', 'GENERATE OPTIMAL BUILD')}
              </button>
            </div>
          )
        ) : activeTab === 'explore' ? (
           <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-white dark:bg-zinc-900/40 border border-zinc-300 dark:border-zinc-800 rounded-xl p-6">
              <div className="flex items-center justify-between mb-6">
                 <div>
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white">{t('ui.pareto_exploration', 'Pareto Frontier Exploration')}</h2>
                    <p className="text-xs text-zinc-500">{t('ui.analyze_tradeoffs', 'Analyze trade-offs between key stats.')}</p>
                 </div>
                 <div className="flex items-center gap-2">
                    <select
                      value={exploreTradeoff}
                      onChange={(e) => setExploreTradeoff(e.target.value as any)}
                      className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-md p-2 text-xs text-zinc-900 dark:text-white outline-none focus:border-zinc-400 dark:focus:border-zinc-500"
                    >
                       <option value="price">{t('ui.tradeoff_ergo_vs_recoil', 'Ergo vs Recoil (Ignore Price)')}</option>
                       <option value="recoil">{t('ui.tradeoff_ergo_vs_price', 'Ergo vs Price (Ignore Recoil)')}</option>
                       <option value="ergo">{t('ui.tradeoff_recoil_vs_price', 'Recoil vs Price (Ignore Ergo)')}</option>
                    </select>
                    <button
                      onClick={handleExplore}
                      disabled={exploring || !selectedGunId}
                      className={clsx(
                        "px-4 py-2 rounded-md text-xs font-bold flex items-center gap-2 transition-all",
                        exploring || !selectedGunId
                           ? "bg-zinc-300 dark:bg-zinc-800 text-zinc-500 cursor-not-allowed"
                           : "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20"
                      )}
                    >
                      {exploring ? <Loader2 className="animate-spin h-3 w-3" /> : <BarChart2 className="h-3 w-3" />}
                      RUN ANALYSIS
                    </button>
                 </div>
              </div>

              {exploreResult.length > 0 ? (
                 <div className="space-y-6">
                    <div className="flex-1 w-full bg-zinc-100 dark:bg-zinc-900/50 rounded-lg p-4 border border-zinc-300 dark:border-zinc-800">
                       <ResponsiveContainer width="100%" height="100%">
                          <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                             <CartesianGrid strokeDasharray="3 3" stroke={document.documentElement.classList.contains('dark') ? '#333' : '#e4e4e7'} />
                             <XAxis
                               type="number"
                               dataKey={resultTradeoff === 'recoil' ? 'ergo' : resultTradeoff === 'ergo' ? 'recoil_v' : 'ergo'}
                               name={resultTradeoff === 'recoil' ? t('ui.chart_ergonomics', 'Ergonomics') : resultTradeoff === 'ergo' ? t('ui.chart_recoil_v', 'Recoil V') : t('ui.chart_ergonomics', 'Ergonomics')}
                               stroke={document.documentElement.classList.contains('dark') ? '#666' : '#71717a'}
                               domain={['dataMin', 'dataMax']}
                               tick={{fill: document.documentElement.classList.contains('dark') ? '#888' : '#71717a', fontSize: 10}}
                               label={{ value: resultTradeoff === 'recoil' ? t('ui.chart_ergonomics', 'Ergonomics') : resultTradeoff === 'ergo' ? t('ui.chart_vertical_recoil', 'Vertical Recoil') : t('ui.chart_ergonomics', 'Ergonomics'), position: 'bottom', fill: document.documentElement.classList.contains('dark') ? '#888' : '#71717a', fontSize: 12, offset: 0 }}
                             />
                             <YAxis
                               type="number"
                               dataKey={resultTradeoff === 'price' ? 'recoil_v' : 'price'}
                               name={resultTradeoff === 'price' ? t('ui.chart_recoil_v', 'Recoil V') : t('ui.chart_price', 'Price')}
                               stroke={document.documentElement.classList.contains('dark') ? '#666' : '#71717a'}
                               domain={['dataMin', 'dataMax']}
                               tick={{fill: document.documentElement.classList.contains('dark') ? '#888' : '#71717a', fontSize: 10}}
                               label={{ value: resultTradeoff === 'price' ? t('ui.chart_vertical_recoil', 'Vertical Recoil') : t('ui.chart_price_roubles', 'Price (₽)'), angle: -90, position: 'insideLeft', fill: document.documentElement.classList.contains('dark') ? '#888' : '#71717a', fontSize: 12 }}
                             />
                             <ZAxis type="number" dataKey="recoil_pct" name={t('ui.chart_recoil_pct', 'Recoil %')} />
                             <Tooltip
                               cursor={{ strokeDasharray: '3 3' }}
                               content={({ active, payload }) => {
                                 if (active && payload && payload.length) {
                                   const data = payload[0].payload;
                                   return (
                                     <div className="bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 p-3 rounded shadow-xl text-xs z-50">
                                       <div className="font-bold mb-2 text-zinc-900 dark:text-white border-b border-zinc-200 dark:border-zinc-800 pb-1">{t('ui.build_stats', 'Build Stats')}</div>
                                       <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                          <div className="text-zinc-500">{t('ui.stat_ergo', 'Ergo:')}</div>
                                          <div className="text-right text-blue-500 dark:text-blue-400 font-mono">{data.ergo.toFixed(1)}</div>

                                          <div className="text-zinc-500">{t('ui.stat_recoil_v', 'Recoil V:')}</div>
                                          <div className="text-right text-green-500 dark:text-green-400 font-mono">{data.recoil_v.toFixed(0)}</div>

                                          <div className="text-zinc-500">{t('ui.stat_recoil_h', 'Recoil H:')}</div>
                                          <div className="text-right text-zinc-600 dark:text-zinc-300 font-mono">{data.recoil_h.toFixed(0)}</div>

                                          <div className="text-zinc-500">{t('ui.stat_price', 'Price:')}</div>
                                          <div className="text-right text-yellow-600 dark:text-yellow-500 font-mono">₽{data.price.toLocaleString()}</div>
                                       </div>
                                     </div>
                                   );
                                 }
                                 return null;
                               }}
                             />
                             <Scatter name="Builds" data={exploreResult} fill="#f97316" line shape="circle" />
                          </ScatterChart>
                       </ResponsiveContainer>
                    </div>

                    <div className="overflow-x-auto border border-zinc-300 dark:border-zinc-800 rounded-lg">
                       <table className="w-full text-xs text-left">
                          <thead className="bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 font-medium uppercase border-b border-zinc-300 dark:border-zinc-800">
                             <tr>
                                <th className="px-4 py-3">{t('sidebar.ergonomics', 'Ergo')}</th>
                                <th className="px-4 py-3">{t('sidebar.recoil_v', 'Recoil V')}</th>
                                <th className="px-4 py-3">{t('sidebar.recoil_h', 'Recoil H')}</th>
                                <th className="px-4 py-3">{t('sidebar.price', 'Price')}</th>
                                <th className="px-4 py-3 text-right">{t('ui.table_items', 'Items')}</th>
                             </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800/50">
                             {exploreResult.map((pt, i) => (
                                <tr key={i} className="hover:bg-zinc-100 dark:hover:bg-zinc-800/30">
                                   <td className="px-4 py-2 font-mono text-blue-600 dark:text-blue-400">{pt.ergo.toFixed(1)}</td>
                                   <td className="px-4 py-2 font-mono text-green-600 dark:text-green-400">{pt.recoil_v.toFixed(0)}</td>
                                   <td className="px-4 py-2 font-mono text-zinc-600 dark:text-zinc-400">{pt.recoil_h.toFixed(0)}</td>
                                   <td className="px-4 py-2 font-mono text-yellow-600 dark:text-yellow-500">₽{pt.price.toLocaleString()}</td>
                                   <td className="px-4 py-2 text-right text-zinc-500">{pt.selected_items.length} mods</td>
                                </tr>
                             ))}
                          </tbody>
                       </table>
                    </div>
                 </div>
              ) : (
                 <div className="h-[400px] flex flex-col items-center justify-center text-zinc-500 border-2 border-dashed border-zinc-300 dark:border-zinc-800 rounded-lg bg-zinc-50 dark:bg-zinc-900/10">
                    <BarChart2 className="h-12 w-12 mb-4 opacity-20" />
                    <p>{t('ui.explore_prompt', 'Select a tradeoff strategy and run analysis to visualize the Pareto frontier.')}</p>
                 </div>
              )}
            </div>
           </div>
        ) : activeTab === 'gunsmith' ? (
           /* ==================== GUNSMITH TAB ==================== */
           <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="bg-white dark:bg-zinc-900/40 border border-zinc-300 dark:border-zinc-800 rounded-xl overflow-hidden">
                 <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-amber-500" />
                    <h2 className="font-semibold text-zinc-800 dark:text-zinc-100 text-sm tracking-wide uppercase">{t('gunsmith.header', 'Gunsmith Tasks')}</h2>
                 </div>

                 <div className="p-5 space-y-6">
                    {/* Task Selector */}
                    <div className="space-y-2">
                       <label className="text-xs text-zinc-500 font-medium">{t('gunsmith.select_task', 'Select Task')}</label>
                       <select
                          value={selectedTaskName}
                          onChange={(e) => {
                             setSelectedTaskName(e.target.value)
                             setGunsmithResult(null)
                          }}
                          className="w-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg p-3 text-sm text-zinc-900 dark:text-white outline-none focus:border-amber-500"
                       >
                          {gunsmithTasks.map(task => (
                             <option key={task.task_name} value={task.task_name}>{task.task_name}</option>
                          ))}
                       </select>
                    </div>

                    {/* Task Details */}
                    {selectedTask && (
                       <div className="space-y-4">
                          {/* Weapon Info */}
                          <div className="flex items-center gap-4 bg-zinc-100 dark:bg-zinc-950/50 p-4 rounded-lg border border-zinc-300 dark:border-zinc-800/50">
                             <div className="h-16 w-24 bg-zinc-200 dark:bg-zinc-800 rounded flex items-center justify-center overflow-hidden flex-shrink-0">
                                {selectedTask.weapon_image ? (
                                   <img src={selectedTask.weapon_image} alt={selectedTask.weapon_name} className="w-full h-full object-contain" />
                                ) : (
                                   <Crosshair className="text-zinc-400 dark:text-zinc-700 h-8 w-8" />
                                )}
                             </div>
                             <div>
                                <div className="font-medium text-zinc-900 dark:text-white text-lg">{selectedTask.weapon_name}</div>
                                <div className="text-xs text-zinc-500 font-mono">{selectedTask.task_name}</div>
                             </div>
                          </div>

                          {/* Requirements Grid */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                             {/* Constraints */}
                             <div className="bg-zinc-100 dark:bg-zinc-950/30 border border-zinc-300 dark:border-zinc-800/50 rounded-lg p-4">
                                <h4 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                   <Target className="h-3 w-3" /> {t('gunsmith.task_requirements', 'Constraints')}
                                </h4>
                                <div className="space-y-2 text-sm">
                                   {selectedTask.constraints.min_ergonomics !== undefined && selectedTask.constraints.min_ergonomics !== null && (
                                      <div className="flex justify-between">
                                         <span className="text-zinc-500">{t('ui.min_ergo_label', 'Min Ergonomics')}</span>
                                         <span className="text-blue-600 dark:text-blue-400 font-mono">{selectedTask.constraints.min_ergonomics}</span>
                                      </div>
                                   )}
                                   {selectedTask.constraints.max_recoil_sum !== undefined && selectedTask.constraints.max_recoil_sum !== null && (
                                      <div className="flex justify-between">
                                         <span className="text-zinc-500">{t('ui.max_recoil_sum_label', 'Max Recoil Sum')}</span>
                                         <span className="text-green-600 dark:text-green-400 font-mono">{selectedTask.constraints.max_recoil_sum}</span>
                                      </div>
                                   )}
                                   {selectedTask.constraints.min_mag_capacity !== undefined && selectedTask.constraints.min_mag_capacity !== null && (
                                      <div className="flex justify-between">
                                         <span className="text-zinc-500">{t('ui.min_mag_label', 'Min Mag Capacity')}</span>
                                         <span className="text-purple-600 dark:text-purple-400 font-mono">{selectedTask.constraints.min_mag_capacity}</span>
                                      </div>
                                   )}
                                   {selectedTask.constraints.min_sighting_range !== undefined && selectedTask.constraints.min_sighting_range !== null && (
                                      <div className="flex justify-between">
                                         <span className="text-zinc-500">{t('ui.min_sight_label', 'Min Sighting Range')}</span>
                                         <span className="text-cyan-600 dark:text-cyan-400 font-mono">{selectedTask.constraints.min_sighting_range}m</span>
                                      </div>
                                   )}
                                   {selectedTask.constraints.max_weight !== undefined && selectedTask.constraints.max_weight !== null && (
                                      <div className="flex justify-between">
                                         <span className="text-zinc-500">{t('ui.max_weight_label', 'Max Weight')}</span>
                                         <span className="text-orange-600 dark:text-orange-400 font-mono">{selectedTask.constraints.max_weight}kg</span>
                                      </div>
                                   )}
                                </div>
                             </div>

                             {/* Required Items */}
                             <div className="bg-zinc-100 dark:bg-zinc-950/30 border border-zinc-300 dark:border-zinc-800/50 rounded-lg p-4">
                                <h4 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                   <CheckCircle className="h-3 w-3" /> {t('gunsmith.required_items', 'Required Items')}
                                </h4>
                                {selectedTask.required_item_names.length > 0 ? (
                                   <ul className="space-y-1 text-sm">
                                      {selectedTask.required_item_names.map((name, i) => (
                                         <li key={i} className="text-green-600 dark:text-green-400 flex items-center gap-2">
                                            <Plus className="h-3 w-3" />
                                            <span className="truncate">{name}</span>
                                         </li>
                                      ))}
                                   </ul>
                                ) : (
                                   <p className="text-zinc-500 text-sm">{t('ui.no_items_required', 'No specific items required')}</p>
                                )}
                                {selectedTask.required_category_names.length > 0 && (
                                   <div className="mt-3 pt-3 border-t border-zinc-300 dark:border-zinc-800">
                                      <p className="text-xs text-zinc-500 mb-2">{t('ui.required_categories', 'Required Categories (one from each group):')}</p>
                                      {selectedTask.required_category_names.map((group, i) => (
                                         <div key={i} className="text-xs text-amber-600 dark:text-amber-400">
                                            {group.join(' OR ')}
                                         </div>
                                      ))}
                                   </div>
                                )}
                             </div>
                          </div>

                          {/* Optimize Button */}
                          <button
                             onClick={handleGunsmithOptimize}
                             disabled={optimizingGunsmith}
                             className={clsx(
                                "w-full px-6 py-4 rounded-xl font-bold text-sm tracking-wide transition-all shadow-lg flex items-center justify-center gap-3",
                                optimizingGunsmith
                                   ? "bg-zinc-300 dark:bg-zinc-800 text-zinc-500 cursor-not-allowed"
                                   : "bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white shadow-amber-900/20 active:scale-[0.98]"
                             )}
                          >
                             {optimizingGunsmith ? <Loader2 className="animate-spin h-5 w-5" /> : <Wrench className="h-5 w-5" />}
                             {optimizingGunsmith ? t('status.optimizing', 'SOLVING...') : t('gunsmith.optimize_btn', 'SOLVE GUNSMITH TASK')}
                          </button>
                       </div>
                    )}
                 </div>
              </div>

              {/* Gunsmith Results */}
              {gunsmithResult && (
                 <div className="space-y-6">
                    {/* Status Banner */}
                    <div className={clsx(
                       "p-4 rounded-xl border flex items-center justify-between",
                       gunsmithResult.status === 'optimal'
                          ? "bg-green-100 dark:bg-green-500/10 border-green-300 dark:border-green-500/20 text-green-700 dark:text-green-400"
                          : gunsmithResult.status === 'infeasible'
                          ? "bg-red-100 dark:bg-red-500/10 border-red-300 dark:border-red-500/20 text-red-700 dark:text-red-400"
                          : "bg-yellow-100 dark:bg-yellow-500/10 border-yellow-300 dark:border-yellow-500/20 text-yellow-700 dark:text-yellow-400"
                    )}>
                       <div className="flex items-center gap-3">
                          {gunsmithResult.status === 'infeasible' ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle className="h-5 w-5" />}
                          <div>
                             <h3 className="font-bold text-sm uppercase tracking-wide">
                                {gunsmithResult.status === 'optimal' ? t('ui.solution_found', 'Solution Found!') : gunsmithResult.status === 'infeasible' ? t('ui.no_solution', 'No Solution') : gunsmithResult.status}
                             </h3>
                             {gunsmithResult.reason && <p className="text-xs opacity-80 mt-1">{gunsmithResult.reason}</p>}
                          </div>
                       </div>
                    </div>

                    {gunsmithResult.status !== 'infeasible' && gunsmithResult.final_stats && (
                       <>
                          {/* Stats Grid */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                             <div className="bg-white dark:bg-zinc-900/50 border border-zinc-300 dark:border-zinc-800 p-4 rounded-xl">
                                <div className="flex items-center gap-2 mb-2 text-zinc-500 dark:text-zinc-400">
                                   <Settings2 className="h-4 w-4" />
                                   <span className="text-xs uppercase font-bold tracking-wider">{t('sidebar.ergonomics', 'Ergonomics')}</span>
                                </div>
                                <div className="text-2xl font-mono text-zinc-900 dark:text-white">
                                   {Math.min(100, Math.max(0, gunsmithResult.final_stats.ergonomics)).toFixed(1)}
                                </div>
                             </div>
                             <div className="bg-white dark:bg-zinc-900/50 border border-zinc-300 dark:border-zinc-800 p-4 rounded-xl">
                                <div className="flex items-center gap-2 mb-2 text-green-600 dark:text-green-500/80">
                                   <Anchor className="h-4 w-4" />
                                   <span className="text-xs uppercase font-bold tracking-wider">{t('ui.recoil_sum', 'Recoil Sum')}</span>
                                </div>
                                <div className="text-2xl font-mono text-zinc-900 dark:text-white">
                                   {(gunsmithResult.final_stats.recoil_vertical + gunsmithResult.final_stats.recoil_horizontal).toFixed(0)}
                                </div>
                             </div>
                             <div className="bg-white dark:bg-zinc-900/50 border border-zinc-300 dark:border-zinc-800 p-4 rounded-xl">
                                <div className="flex items-center gap-2 mb-2 text-zinc-500 dark:text-zinc-400">
                                   <Weight className="h-4 w-4" />
                                   <span className="text-xs uppercase font-bold tracking-wider">{t('ui.weight_label', 'Weight')}</span>
                                </div>
                                <div className="text-2xl font-mono text-zinc-900 dark:text-white">
                                   {gunsmithResult.final_stats.total_weight.toFixed(2)}kg
                                </div>
                             </div>
                             <div className="bg-white dark:bg-zinc-900/50 border border-zinc-300 dark:border-zinc-800 p-4 rounded-xl">
                                <div className="flex items-center gap-2 mb-2 text-yellow-600 dark:text-yellow-500/80">
                                   <DollarSignIcon className="h-4 w-4" />
                                   <span className="text-xs uppercase font-bold tracking-wider">{t('ui.total_cost', 'Total Cost')}</span>
                                </div>
                                <div className="text-2xl font-mono text-zinc-900 dark:text-white">
                                   ₽{gunsmithResult.final_stats.total_price.toLocaleString()}
                                </div>
                             </div>
                          </div>

                          {/* Parts List */}
                          <div className="bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 rounded-xl overflow-hidden">
                             <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/80">
                                <h3 className="font-semibold text-zinc-800 dark:text-zinc-100 flex items-center gap-2">
                                   <Wrench className="h-4 w-4 text-amber-500" />
                                   {t('ui.build_for_task', 'Build for {{task}}', { task: selectedTask?.task_name })}
                                </h3>
                             </div>
                             <div className="divide-y divide-zinc-200 dark:divide-zinc-800/50">
                                {gunsmithResult.selected_items.map(item => <ItemRow key={item.id} item={item} />)}
                             </div>
                          </div>
                       </>
                    )}
                 </div>
              )}
           </div>
        ) : null}
        </div>

      </main>
    </div>
  )
}

function WeightSlider({ label, value, setValue, color }: { label: string, value: number, setValue: (v: number) => void, color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]">
        <span className="text-zinc-500 font-bold uppercase tracking-tighter">{label}</span>
        <span className="text-zinc-600 dark:text-zinc-300 font-mono">{value}%</span>
      </div>
      <input type="range" min="0" max="100" value={value} onChange={(e) => setValue(Number(e.target.value))} className={clsx("w-full h-1 bg-zinc-300 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer", color)} />
    </div>
  )
}

function DollarSignIcon({ className }: { className?: string }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width="24" height="24" viewBox="0 0 24 24" 
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" 
      className={className}
    >
      <line x1="12" x2="12" y1="2" y2="22"/>
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  )
}

function ItemRow({ item, hidePrice = false }: { item: any, hidePrice?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-1 md:grid-cols-[80px_1fr_120px_150px_100px] gap-4 px-6 py-4 items-center hover:bg-zinc-100 dark:hover:bg-zinc-800/30 transition-colors group">
       {/* Icon */}
       <div className="h-16 w-16 bg-zinc-200 dark:bg-zinc-800 rounded-lg flex items-center justify-center overflow-hidden border border-zinc-300 dark:border-zinc-700/50 p-1 flex-shrink-0">
         {item.icon ? <img src={item.icon} alt={item.name} className="w-full h-full object-contain" /> : <Settings2 className="h-8 w-8 text-zinc-400" />}
       </div>

       {/* Name */}
       <div className="min-w-0">
         <div className="text-sm font-medium text-zinc-900 dark:text-zinc-200 truncate">{item.name}</div>
         <div className="text-[10px] text-zinc-500 font-mono mt-1 opacity-0 group-hover:opacity-100 transition-opacity">{t('ui.id_label', 'ID:')} {item.id}</div>
       </div>

       {/* Stats */}
       <div className="flex flex-row md:flex-col gap-2 md:gap-1 text-xs">
          {item.ergonomics !== 0 && (
              <span className={item.ergonomics > 0 ? "text-blue-600 dark:text-blue-400" : "text-red-600 dark:text-red-400"}>
                  {t('ui.stat_ergo', 'Ergo:')} {item.ergonomics > 0 ? "+" : ""}{item.ergonomics}
              </span>
          )}
          {item.recoil_modifier !== 0 && (
              <span className={item.recoil_modifier < 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                  {t('ui.stat_recoil', 'Recoil:')} {item.recoil_modifier > 0 ? "+" : ""}{(item.recoil_modifier * 100).toFixed(1)}%
              </span>
          )}
          {item.ergonomics === 0 && item.recoil_modifier === 0 && <span className="text-zinc-500">-</span>}
       </div>

       {/* Source */}
       <div className="text-sm text-zinc-600 dark:text-zinc-400 flex items-center gap-2">
          {hidePrice ? (
            <span className="text-zinc-500 text-xs italic">{t('ui.included_in_preset', 'Included in preset')}</span>
          ) : (
            <span className="px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700/50 text-xs">
              {item.source === 'not_available' ? t('results.not_available_short', 'Not Available') : (item.source || t('ui.unknown', 'Unknown'))}
            </span>
          )}
       </div>

       {/* Price */}
       <div className="text-left md:text-right font-mono text-zinc-800 dark:text-zinc-300 text-sm">
          {hidePrice ? <span className="text-zinc-400">—</span> : `₽${item.price.toLocaleString()}`}
       </div>
    </div>
  )
}

export default App
