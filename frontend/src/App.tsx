import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfigProvider, Layout, Select, Segmented, Spin, message, App as AntApp, Tabs, theme, Typography, Tag, Space, Grid, Dropdown, Button } from 'antd'
import { ThunderboltOutlined, BarChartOutlined, ToolOutlined, SunOutlined, MoonOutlined, SyncOutlined, MenuOutlined } from '@ant-design/icons'
import { getInfo, optimize, explore, getWeaponMods, getGunsmithTasks } from './api/client'
import type { Gun, OptimizeResponse, ModInfo, ExplorePoint, GunsmithTask, GameMode } from './api/client'
import { ResponsiveLayout } from './layouts/ResponsiveLayout'
import { OptimizePanel } from './components/optimize/OptimizePanel'
import { OptimizeResult } from './components/optimize/OptimizeResult'
import { ExplorePanel } from './components/explore/ExplorePanel'
import { ExploreResult } from './components/explore/ExploreResult'
import { GunsmithPanel } from './components/gunsmith/GunsmithPanel'
import { GunsmithResult } from './components/gunsmith/GunsmithResult'

const { Header, Content } = Layout
const { Text } = Typography
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

type ThemeMode = 'light' | 'dark' | 'auto'

function AppContent({ themeMode, setThemeMode }: { themeMode: ThemeMode; setThemeMode: (mode: ThemeMode) => void }) {
  const { t, i18n } = useTranslation()
  const { token } = useToken()
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  const [messageApi, contextHolder] = message.useMessage()
  const [gameMode, setGameMode] = useState<GameMode>(() => (localStorage.getItem('gameMode') as GameMode) || 'regular')
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
  const [includedModIds, setIncludedModIds] = useState<string[]>([])
  const [excludedModIds, setExcludedModIds] = useState<string[]>([])
  const [modSearch, setModSearch] = useState('')
  const [includedCategories, setIncludedCategories] = useState<string[]>([])
  const [excludedCategories, setExcludedCategories] = useState<string[]>([])
  const [categorySearch, setCategorySearch] = useState('')
  const [playerLevel, setPlayerLevel] = useState(60)
  const [fleaAvailable, setFleaAvailable] = useState(true)
  const [traderLevels, setTraderLevels] = useState({ prapor: 4, skier: 4, peacekeeper: 4, mechanic: 4, jaeger: 4 })
  const [activeTab, setActiveTab] = useState<string>('optimize')
  const [compactMode, setCompactMode] = useState<boolean>(() => localStorage.getItem('compactMode') === 'true')
  const [exploring, setExploring] = useState(false)
  const [exploreResult, setExploreResult] = useState<ExplorePoint[]>([])
  const [exploreTradeoff, setExploreTradeoff] = useState<'price' | 'recoil' | 'ergo'>('price')
  const [resultTradeoff, setResultTradeoff] = useState<'price' | 'recoil' | 'ergo'>('price')
  const [gunsmithTasks, setGunsmithTasks] = useState<GunsmithTask[]>([])
  const [selectedTaskName, setSelectedTaskName] = useState<string>('')
  const [gunsmithResult, setGunsmithResult] = useState<OptimizeResponse | null>(null)
  const [optimizingGunsmith, setOptimizingGunsmith] = useState(false)

  useEffect(() => { localStorage.setItem('gameMode', gameMode) }, [gameMode])
  useEffect(() => { localStorage.setItem('compactMode', String(compactMode)) }, [compactMode])
  useEffect(() => { localStorage.setItem('themeMode', themeMode) }, [themeMode])
  useEffect(() => {
    document.title = t('app.title', 'Tarkov Weapon Optimizer')
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
      .catch(err => { console.error('Failed to fetch data', err); setLoading(false) })
  }, [gameMode, i18n.language])

  useEffect(() => {
    if (selectedGunId) {
      setLoadingMods(true)
      getWeaponMods(selectedGunId, gameMode, i18n.language || 'en')
        .then(data => {
          setAvailableMods(data.mods)
          setIncludedModIds([])
          setExcludedModIds([])
          setIncludedCategories([])
          setExcludedCategories([])
          setLoadingMods(false)
        })
        .catch(err => { console.error('Failed to fetch mods', err); setLoadingMods(false) })
    }
  }, [selectedGunId, gameMode, i18n.language])

  const categories = useMemo(() => {
    const filtered = selectedCaliber === 'All' ? guns : guns.filter(g => g.caliber === selectedCaliber)
    return ['All', ...new Set(filtered.map(g => g.category))].sort()
  }, [guns, selectedCaliber])
  const calibers = useMemo(() => {
    const filtered = selectedCategory === 'All' ? guns : guns.filter(g => g.category === selectedCategory)
    return ['All', ...new Set(filtered.map(g => g.caliber))].sort()
  }, [guns, selectedCategory])
  const modCategories = useMemo(() => [...new Set(availableMods.map(m => m.category).filter(Boolean))].sort(), [availableMods])
  const filteredGuns = useMemo(() => guns.filter(gun => (selectedCategory === 'All' || gun.category === selectedCategory) && (selectedCaliber === 'All' || gun.caliber === selectedCaliber)), [guns, selectedCategory, selectedCaliber])
  const selectedGun = guns.find(g => g.id === selectedGunId)
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
        include_items: includedModIds.length > 0 ? includedModIds : undefined,
        exclude_items: excludedModIds.length > 0 ? excludedModIds : undefined,
        include_categories: includedCategories.length > 0 ? includedCategories.map(c => [c]) : undefined,
        exclude_categories: excludedCategories.length > 0 ? excludedCategories : undefined,
        trader_levels: traderLevels,
        player_level: playerLevel,
        flea_available: fleaAvailable,
      }, gameMode, i18n.language || 'en')
      setResult(res)
      messageApi.success(t('toast.optimize_success', 'Optimization complete'))
    } catch (err) {
      console.error('Optimization failed', err)
      messageApi.error(t('toast.optimize_failed', 'Optimization failed'))
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
      messageApi.success(t('toast.explore_success', 'Exploration complete'))
    } catch (err) {
      console.error('Exploration failed', err)
      messageApi.error(t('toast.explore_failed', 'Exploration failed'))
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
      }, gameMode, i18n.language || 'en')
      setGunsmithResult(res)
      messageApi.success(t('toast.gunsmith_success', 'Gunsmith optimization complete'))
    } catch (err) {
      console.error('Gunsmith optimization failed', err)
      messageApi.error(t('toast.gunsmith_failed', 'Gunsmith optimization failed'))
    } finally {
      setOptimizingGunsmith(false)
    }
  }

  const copyToClipboard = (content: string) => {
    const successMsg = t('toast.copied', 'Copied')
    const failMsg = t('toast.copy_failed', 'Copy failed')
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
      `${selectedGun?.name} - ${t('ui.build_manifest', 'Build Manifest')}`,
      '',
      `${t('sidebar.ergonomics', 'Ergo')}: ${result.final_stats.ergonomics.toFixed(1)} | ${t('ui.vert_recoil', 'V.Recoil')}: ${result.final_stats.recoil_vertical.toFixed(0)} | ${t('ui.horiz_recoil', 'H.Recoil')}: ${result.final_stats.recoil_horizontal.toFixed(0)} | ${t('ui.weight_label', 'Weight')}: ${result.final_stats.total_weight.toFixed(2)}kg | ${t('ui.total_cost', 'Total')}: ~ ₽${result.final_stats.total_price.toLocaleString()}`,
      '',
      `${t('ui.table_items', 'Items')}:`,
      ...result.selected_items.map(i => i.name)
    ]
    copyToClipboard(lines.join('\n'))
  }

  const copyGunsmithBuild = () => {
    if (!gunsmithResult || !gunsmithResult.final_stats || !selectedTask) return
    const lines = [
      `${selectedTask.task_name} - ${selectedTask.weapon_name}`,
      '',
      `${t('sidebar.ergonomics', 'Ergo')}: ${gunsmithResult.final_stats.ergonomics.toFixed(1)} | ${t('ui.vert_recoil', 'V.Recoil')}: ${gunsmithResult.final_stats.recoil_vertical.toFixed(0)} | ${t('ui.horiz_recoil', 'H.Recoil')}: ${gunsmithResult.final_stats.recoil_horizontal.toFixed(0)} | ${t('ui.weight_label', 'Weight')}: ${gunsmithResult.final_stats.total_weight.toFixed(2)}kg | ${t('ui.total_cost', 'Total')}: ~ ₽${gunsmithResult.final_stats.total_price.toLocaleString()}`,
      '',
      `${t('ui.table_items', 'Items')}:`,
      ...gunsmithResult.selected_items.map(i => i.name)
    ]
    copyToClipboard(lines.join('\n'))
  }

  const handleGunChange = (id: string) => {
    setSelectedGunId(id)
    setResult(null)
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 16, background: token.colorBgContainer }}>
        <Spin size="large" />
        <Text type="secondary">{t('ui.initializing', '正在初始化...')}</Text>
      </div>
    )
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
    modCategories,
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
    playerLevel,
    onPlayerLevelChange: setPlayerLevel,
    traderLevels,
    onTraderLevelsChange: setTraderLevels,
  }

  const tabItems = [
    {
      key: 'optimize',
      label: <span style={{ userSelect: 'none' }}><ThunderboltOutlined /> {t('tabs.optimize', '改枪优化')}</span>,
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
            />
          }
          right={
            <OptimizeResult
              result={result}
              compactMode={compactMode}
              onCompactModeChange={setCompactMode}
              optimizing={optimizing}
              onOptimize={handleOptimize}
              onCopy={copyBuild}
              disabled={!selectedGunId}
            />
          }
        />
      ),
    },
    {
      key: 'explore',
      label: <span style={{ userSelect: 'none' }}><BarChartOutlined /> {t('tabs.explore', '探索分析')}</span>,
      children: (
        <ResponsiveLayout
          left={
            <ExplorePanel
              {...commonPanelProps}
              exploreTradeoff={exploreTradeoff}
              onExploreTradeoffChange={setExploreTradeoff}
            />
          }
          right={
            <ExploreResult
              exploreResult={exploreResult}
              resultTradeoff={resultTradeoff}
              exploring={exploring}
              onExplore={handleExplore}
              disabled={!selectedGunId}
            />
          }
        />
      ),
    },
    {
      key: 'gunsmith',
      label: <span style={{ userSelect: 'none' }}><ToolOutlined /> {t('tabs.gunsmith', '枪匠')}</span>,
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
              playerLevel={playerLevel}
              onPlayerLevelChange={setPlayerLevel}
              traderLevels={traderLevels}
              onTraderLevelsChange={setTraderLevels}
            />
          }
          right={
            <GunsmithResult
              result={gunsmithResult}
              compactMode={compactMode}
              onCompactModeChange={setCompactMode}
              optimizing={optimizingGunsmith}
              onOptimize={handleGunsmithOptimize}
              onCopy={copyGunsmithBuild}
              disabled={!selectedTask}
            />
          }
        />
      ),
    },
  ]

  return (
    <AntApp>
      {contextHolder}
      <Layout style={{ height: '100vh', overflow: 'hidden' }}>
        <Header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', padding: '12px 24px', height: 'auto', lineHeight: 'normal', background: token.colorBgContainer, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }} onClick={() => window.location.reload()}>
            <img src="/favicon.svg" alt="logo" style={{ width: 24, height: 24, display: 'block', pointerEvents: 'none' }} draggable={false} />
            <span style={{ fontSize: 18, fontWeight: 600, lineHeight: 1 }}>{t('app.title', '塔科夫改枪优化器')}</span>
            <Tag color="orange" style={{ margin: 0 }}>v2</Tag>
          </div>
          <div style={{ flex: '1 1 auto', display: 'flex', justifyContent: 'flex-end' }}>
            {isMobile ? (
              <Dropdown
                trigger={['click']}
                dropdownRender={() => (
                  <div style={{ padding: 12, background: token.colorBgElevated, borderRadius: 8, boxShadow: token.boxShadowSecondary, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <Segmented block value={gameMode} onChange={(v) => setGameMode(v as GameMode)} options={[{ label: t('ui.pvp', 'PvP'), value: 'regular' }, { label: t('ui.pve', 'PvE'), value: 'pve' }]} />
                    <Segmented block value={themeMode} onChange={(v) => setThemeMode(v as ThemeMode)} options={[{ label: <SunOutlined />, value: 'light' }, { label: <MoonOutlined />, value: 'dark' }, { label: <SyncOutlined />, value: 'auto' }]} />
                    <Select style={{ width: '100%' }} value={languages.find(l => i18n.language?.startsWith(l.code))?.code || 'en'} onChange={(v) => i18n.changeLanguage(v)} options={languages.map(l => ({ value: l.code, label: `${l.flag} ${l.name}` }))} />
                  </div>
                )}
              >
                <Button icon={<MenuOutlined />} />
              </Dropdown>
            ) : (
              <Space wrap style={{ justifyContent: 'flex-end' }}>
                <Segmented value={gameMode} onChange={(v) => setGameMode(v as GameMode)} options={[{ label: t('ui.pvp', 'PvP'), value: 'regular' }, { label: t('ui.pve', 'PvE'), value: 'pve' }]} />
                <Segmented value={themeMode} onChange={(v) => setThemeMode(v as ThemeMode)} options={[{ label: <SunOutlined />, value: 'light' }, { label: <MoonOutlined />, value: 'dark' }, { label: <SyncOutlined />, value: 'auto' }]} />
                <Select style={{ width: 140 }} value={languages.find(l => i18n.language?.startsWith(l.code))?.code || 'en'} onChange={(v) => i18n.changeLanguage(v)} options={languages.map(l => ({ value: l.code, label: `${l.flag} ${l.name}` }))} />
              </Space>
            )}
          </div>
        </Header>
        <Content className="main-content" style={{ padding: 16, overflow: 'auto', background: token.colorBgLayout }}>
          <Tabs
            items={tabItems}
            activeKey={activeTab}
            onChange={setActiveTab}
            tabBarStyle={{ margin: '0 0 16px 0', padding: '0 8px', background: token.colorBgContainer, borderRadius: 8 }}
          />
        </Content>
      </Layout>
    </AntApp>
  )
}

function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => (localStorage.getItem('themeMode') as ThemeMode) || 'auto')
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [])
  const isDark = themeMode === 'dark' || (themeMode === 'auto' && systemDark)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
  }, [isDark])
  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'",
        },
      }}
    >
      <AppContent themeMode={themeMode} setThemeMode={setThemeMode} />
    </ConfigProvider>
  )
}

export default App
