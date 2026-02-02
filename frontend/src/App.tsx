import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfigProvider, Layout, Button, Select, Slider, InputNumber, Switch, Card, Statistic, Table, Tag, Space, Spin, Alert, Typography, Segmented, Input, Collapse, Divider, Row, Col, message, App as AntApp, Tabs, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { AimOutlined, ThunderboltOutlined, BarChartOutlined, ToolOutlined, SettingOutlined, UserOutlined, SearchOutlined, PlusOutlined, MinusOutlined, CopyOutlined, CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined, SyncOutlined, SunOutlined, MoonOutlined } from '@ant-design/icons'
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from 'recharts'
import { getInfo, optimize, explore, getWeaponMods, getGunsmithTasks } from './api/client'
import type { Gun, OptimizeResponse, ModInfo, ExplorePoint, GunsmithTask, GameMode } from './api/client'
import { TernaryPlot } from './components/TernaryPlot'
import { ItemRow } from './components/ItemRow'

const { Header, Content, Sider } = Layout
const { Text, Title } = Typography
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

  const categories = useMemo(() => ['All', ...new Set(guns.map(g => g.category))].sort(), [guns])
  const calibers = useMemo(() => ['All', ...new Set(guns.map(g => g.caliber))].sort(), [guns])
  const modCategories = useMemo(() => [...new Set(availableMods.map(m => m.category).filter(Boolean))].sort(), [availableMods])
  const searchedCategories = useMemo(() => {
    const lower = categorySearch.toLowerCase()
    return modCategories.filter(c => c.toLowerCase().includes(lower) && !includedCategories.includes(c) && !excludedCategories.includes(c))
  }, [modCategories, categorySearch, includedCategories, excludedCategories])
  const filteredGuns = useMemo(() => guns.filter(gun => (selectedCategory === 'All' || gun.category === selectedCategory) && (selectedCaliber === 'All' || gun.caliber === selectedCaliber)), [guns, selectedCategory, selectedCaliber])
  const searchedMods = useMemo(() => {
    if (!modSearch) return []
    const lower = modSearch.toLowerCase()
    return availableMods.filter(m => m.name.toLowerCase().includes(lower) && !includedModIds.includes(m.id) && !excludedModIds.includes(m.id)).slice(0, 10)
  }, [availableMods, modSearch, includedModIds, excludedModIds])
  const selectedGun = guns.find(g => g.id === selectedGunId)
  const selectedTask = gunsmithTasks.find(t => t.task_name === selectedTaskName)

  useEffect(() => {
    if (filteredGuns.length > 0 && !filteredGuns.find(g => g.id === selectedGunId)) {
      setSelectedGunId(filteredGuns[0].id)
    }
  }, [filteredGuns, selectedGunId])

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
      messageApi.success('优化完成')
    } catch (err) {
      console.error('Optimization failed', err)
      messageApi.error('优化失败')
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
      messageApi.success('探索完成')
    } catch (err) {
      console.error('Exploration failed', err)
      messageApi.error('探索失败')
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
      messageApi.success('枪匠任务优化完成')
    } catch (err) {
      console.error('Gunsmith optimization failed', err)
      messageApi.error('枪匠任务优化失败')
    } finally {
      setOptimizingGunsmith(false)
    }
  }

  const copyBuild = () => {
    if (!result || !result.final_stats) return
    const lines = [
      `${selectedGun?.name} 优化构建`,
      '',
      `人机: ${result.final_stats.ergonomics.toFixed(1)} | 垂直后坐: ${result.final_stats.recoil_vertical.toFixed(0)} | 水平后坐: ${result.final_stats.recoil_horizontal.toFixed(0)} | 重量: ${result.final_stats.total_weight.toFixed(2)}kg | 总价: ~ ₽${result.final_stats.total_price.toLocaleString()}`,
      '',
      '配件列表:',
      ...result.selected_items.map(i => i.name)
    ]
    const content = lines.join('\n')
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(content).then(() => messageApi.success('已复制')).catch(() => fallbackCopy(content))
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
        messageApi.success('已复制')
      } catch {
        messageApi.error('复制失败')
      }
      document.body.removeChild(textArea)
    }
  }

  const applyPreset = (ergo: number, recoil: number, price: number) => {
    setErgoWeight(ergo)
    setRecoilWeight(recoil)
    setPriceWeight(price)
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 16, background: token.colorBgContainer }}>
        <Spin size="large" />
        <Text type="secondary">{t('ui.initializing', '正在初始化...')}</Text>
      </div>
    )
  }

  const siderContent = (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflow: 'auto' }}>
      <Card title={<span style={{ userSelect: 'none' }}><AimOutlined /> {t('sidebar.select_weapon', '选择武器')}</span>} size="small">
        <Space direction="vertical" style={{ width: '100%' }}>
          <Row gutter={8}>
            <Col span={12}>
              <Select size="small" style={{ width: '100%' }} value={selectedCategory} onChange={setSelectedCategory} options={categories.map(c => ({ value: c, label: c }))} placeholder="类型" />
            </Col>
            <Col span={12}>
              <Select size="small" style={{ width: '100%' }} value={selectedCaliber} onChange={setSelectedCaliber} options={calibers.map(c => ({ value: c, label: c }))} placeholder="口径" />
            </Col>
          </Row>
          <Select
            showSearch
            style={{ width: '100%' }}
            value={selectedGunId}
            onChange={(v) => { setSelectedGunId(v); setResult(null) }}
            filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
            options={filteredGuns.map(g => ({ value: g.id, label: g.name }))}
            optionRender={(option) => {
              const gun = filteredGuns.find(g => g.id === option.value)
              return (
                <Space>
                  {gun?.image && <img src={gun.image} alt="" style={{ width: 48, height: 32, objectFit: 'contain' }} />}
                  <span>{option.label}</span>
                </Space>
              )
            }}
          />
        </Space>
      </Card>
      <Card title={<span style={{ userSelect: 'none' }}><SettingOutlined /> {t('optimize.header', '构建优先级')}</span>} size="small">
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space>
            <Button size="small" onClick={() => applyPreset(0, 100, 0)}>{t('optimize.preset_recoil', '后坐')}</Button>
            <Button size="small" onClick={() => applyPreset(100, 0, 0)}>{t('optimize.preset_ergo', '人机')}</Button>
            <Button size="small" onClick={() => applyPreset(33, 34, 33)}>{t('optimize.preset_balanced', '平衡')}</Button>
          </Space>
          <TernaryPlot ergoWeight={ergoWeight} recoilWeight={recoilWeight} priceWeight={priceWeight} onChange={(e, r, p) => { setErgoWeight(e); setRecoilWeight(r); setPriceWeight(p) }} />
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>{t('sidebar.ergonomics', '人机')}: {ergoWeight}%</Text>
            <Slider value={ergoWeight} onChange={setErgoWeight} />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>{t('optimize.preset_recoil', '后坐')}: {recoilWeight}%</Text>
            <Slider value={recoilWeight} onChange={setRecoilWeight} />
          </div>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>{t('sidebar.price', '价格')}: {priceWeight}%</Text>
            <Slider value={priceWeight} onChange={setPriceWeight} />
          </div>
          <Divider style={{ margin: '8px 0' }} />
          <Space>
            <Switch checked={useBudget} onChange={setUseBudget} size="small" />
            <Text>{t('constraints.budget_limit', '预算限制')}</Text>
          </Space>
          {useBudget && (
            <InputNumber style={{ width: '100%' }} value={maxPrice} onChange={(v) => setMaxPrice(v || 0)} min={10000} max={1000000} step={10000} addonBefore="₽" />
          )}
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>{t('constraints.min_ergo', '最低人机')}: {minErgo}</Text>
            <Slider value={minErgo} onChange={setMinErgo} max={100} />
          </div>
        </Space>
      </Card>
      <Collapse size="small" items={[
        {
          key: 'mods',
          label: <><PlusOutlined /> {t('sidebar.include_exclude', '包含/排除配件')}</>,
          children: (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Input size="small" placeholder={t('sidebar.require_categories', '搜索类别...')} prefix={<SearchOutlined />} value={categorySearch} onChange={e => setCategorySearch(e.target.value)} />
              {searchedCategories.length > 0 && categorySearch && searchedCategories.slice(0, 5).map(cat => (
                <Space key={cat} style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 12 }}>{cat}</Text>
                  <Space>
                    <Button size="small" type="text" icon={<PlusOutlined />} onClick={() => { setIncludedCategories([...includedCategories, cat]); setCategorySearch('') }} style={{ color: token.colorSuccess }} />
                    <Button size="small" type="text" icon={<MinusOutlined />} onClick={() => { setExcludedCategories([...excludedCategories, cat]); setCategorySearch('') }} style={{ color: token.colorError }} />
                  </Space>
                </Space>
              ))}
              <Space wrap>
                {includedCategories.map(cat => <Tag key={cat} color="success" closable onClose={() => setIncludedCategories(includedCategories.filter(c => c !== cat))}>{cat}</Tag>)}
                {excludedCategories.map(cat => <Tag key={cat} color="error" closable onClose={() => setExcludedCategories(excludedCategories.filter(c => c !== cat))}>{cat}</Tag>)}
              </Space>
              <Divider style={{ margin: '8px 0' }} />
              <Input size="small" placeholder={t('sidebar.require_items', '搜索配件...')} prefix={<SearchOutlined />} value={modSearch} onChange={e => setModSearch(e.target.value)} suffix={loadingMods && <SyncOutlined spin />} />
              {searchedMods.map(m => (
                <Space key={m.id} style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Space>
                    {m.icon && <img src={m.icon} alt="" style={{ width: 24, height: 24, objectFit: 'contain' }} />}
                    <Text style={{ fontSize: 12 }}>{m.name}</Text>
                  </Space>
                  <Space>
                    <Button size="small" type="text" icon={<PlusOutlined />} onClick={() => { setIncludedModIds([...includedModIds, m.id]); setModSearch('') }} style={{ color: token.colorSuccess }} />
                    <Button size="small" type="text" icon={<MinusOutlined />} onClick={() => { setExcludedModIds([...excludedModIds, m.id]); setModSearch('') }} style={{ color: token.colorError }} />
                  </Space>
                </Space>
              ))}
              <Space wrap>
                {includedModIds.map(id => <Tag key={id} color="success" closable onClose={() => setIncludedModIds(includedModIds.filter(i => i !== id))}>{availableMods.find(m => m.id === id)?.name}</Tag>)}
                {excludedModIds.map(id => <Tag key={id} color="error" closable onClose={() => setExcludedModIds(excludedModIds.filter(i => i !== id))}>{availableMods.find(m => m.id === id)?.name}</Tag>)}
              </Space>
            </Space>
          ),
        },
        {
          key: 'market',
          label: <><UserOutlined /> {t('sidebar.player_trader_access', '市场访问')}</>,
          children: (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Space><Switch checked={fleaAvailable} onChange={setFleaAvailable} size="small" /><Text>{t('sidebar.flea_market_access', '跳蚤市场')}</Text></Space>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>{t('sidebar.player_level', '玩家等级')}: {playerLevel}</Text>
                <Slider value={playerLevel} onChange={setPlayerLevel} min={1} max={79} />
              </div>
              <Divider style={{ margin: '8px 0' }} />
              {(Object.keys(traderLevels) as Array<keyof typeof traderLevels>).map(trader => (
                <div key={trader}>
                  <Text type="secondary" style={{ fontSize: 12, textTransform: 'capitalize' }}>{trader}: LL{traderLevels[trader]}</Text>
                  <Slider value={traderLevels[trader]} onChange={(v) => setTraderLevels(prev => ({ ...prev, [trader]: v }))} min={1} max={4} />
                </div>
              ))}
            </Space>
          ),
        },
      ]} />
    </div>
  )

  const tabItems = [
    {
      key: 'optimize',
      label: <><ThunderboltOutlined /> {t('tabs.optimize', '优化')}</>,
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {result ? (
            <>
              <Alert
                type={result.status === 'optimal' ? 'success' : result.status === 'infeasible' ? 'error' : 'warning'}
                message={<><Text strong>{t('results.optimization_status', '优化状态')}: {result.status}</Text>{result.solve_time_ms && <Tag color="blue" style={{ marginLeft: 8 }}>{result.solve_time_ms.toFixed(0)} ms</Tag>}{result.reason && <Text type="secondary" style={{ marginLeft: 8 }}>{result.reason}</Text>}</>}
                icon={result.status === 'optimal' ? <CheckCircleOutlined /> : result.status === 'infeasible' ? <CloseCircleOutlined /> : <ExclamationCircleOutlined />}
                showIcon
                action={<Space><Button size="small" icon={<CopyOutlined />} onClick={copyBuild}>复制</Button><Button size="small" type="primary" icon={<ThunderboltOutlined />} loading={optimizing} onClick={handleOptimize}>重新优化</Button></Space>}
              />
              {result.status !== 'infeasible' && result.final_stats && (
                <>
                  <Row gutter={16}>
                    <Col span={4}><Card size="small"><Statistic title={t('sidebar.ergonomics', '人机')} value={Math.min(100, Math.max(0, result.final_stats.ergonomics)).toFixed(1)} /></Card></Col>
                    <Col span={4}><Card size="small"><Statistic title={t('ui.vert_recoil', '垂直后坐')} value={result.final_stats.recoil_vertical.toFixed(0)} /></Card></Col>
                    <Col span={4}><Card size="small"><Statistic title={t('ui.horiz_recoil', '水平后坐')} value={result.final_stats.recoil_horizontal.toFixed(0)} /></Card></Col>
                    <Col span={4}><Card size="small"><Statistic title={t('ui.weight_label', '重量')} value={result.final_stats.total_weight.toFixed(2)} suffix="kg" /></Card></Col>
                    <Col span={8}><Card size="small"><Statistic title={t('ui.total_cost', '总价')} value={result.final_stats.total_price.toLocaleString()} prefix="₽" valueStyle={{ color: token.colorWarning }} /></Card></Col>
                  </Row>
                  {result.selected_preset && (
                    <Card size="small">
                      <Space>
                        {result.selected_preset.icon && <img src={result.selected_preset.icon} alt="" style={{ width: 80, height: 48, objectFit: 'contain' }} />}
                        <div>
                          <Text type="secondary">{t('ui.base_preset_used', '使用预设')}</Text>
                          <Title level={5} style={{ margin: 0 }}>{result.selected_preset.name}</Title>
                          <Tag color="gold">₽{result.selected_preset.price.toLocaleString()}</Tag>
                          {result.selected_preset.source && <Tag>{result.selected_preset.source}</Tag>}
                        </div>
                      </Space>
                    </Card>
                  )}
                  <Card title={<Space style={{ userSelect: 'none' }}><SettingOutlined />{t('ui.build_manifest', '构建清单')}<Switch checked={compactMode} onChange={setCompactMode} checkedChildren="紧凑" unCheckedChildren="详细" /></Space>} size="small">
                    {result.selected_preset ? (
                      <>
                        <Collapse
                          size="small"
                          defaultActiveKey={result.selected_items.filter(i => !result.selected_preset!.items.includes(i.id)).length > 0 ? ['new'] : []}
                          items={[
                            {
                              key: 'new',
                              label: <Space style={{ userSelect: 'none' }}><Text type="warning">{t('ui.new_changed_parts', '新增/更换配件')}</Text><Tag color="orange">{result.selected_items.filter(i => !result.selected_preset!.items.includes(i.id)).length}</Tag></Space>,
                              children: result.selected_items.filter(i => !result.selected_preset!.items.includes(i.id)).length > 0
                                ? result.selected_items.filter(i => !result.selected_preset!.items.includes(i.id)).map(item => <ItemRow key={item.id} item={item} compactMode={compactMode} />)
                                : <Text type="secondary" style={{ padding: '8px 24px', display: 'block' }}>无</Text>,
                            },
                            {
                              key: 'retained',
                              label: <Space style={{ userSelect: 'none' }}><Text type="secondary">{t('ui.retained_from_preset_short', '预设保留配件')}</Text><Tag color="blue">{result.selected_items.filter(i => result.selected_preset!.items.includes(i.id)).length}</Tag></Space>,
                              children: result.selected_items.filter(i => result.selected_preset!.items.includes(i.id)).length > 0
                                ? result.selected_items.filter(i => result.selected_preset!.items.includes(i.id)).map(item => <ItemRow key={item.id} item={item} hidePrice compactMode={compactMode} />)
                                : <Text type="secondary" style={{ padding: '8px 24px', display: 'block' }}>无</Text>,
                            },
                          ]}
                        />
                      </>
                    ) : (
                      result.selected_items.map(item => <ItemRow key={item.id} item={item} compactMode={compactMode} />)
                    )}
                  </Card>
                </>
              )}
            </>
          ) : (
            <Card style={{ textAlign: 'center', padding: 48 }}>
              <ThunderboltOutlined style={{ fontSize: 64, color: token.colorTextQuaternary, marginBottom: 24 }} />
              <Title level={4}>{t('optimize.ready_title', '准备优化')}</Title>
              <Text type="secondary">{t('optimize.ready_description', '选择武器并调整优先级，生成数学最优构建')}</Text>
              <div style={{ marginTop: 24 }}>
                <Button type="primary" size="large" icon={<ThunderboltOutlined />} loading={optimizing} onClick={handleOptimize} disabled={!selectedGunId}>{t('optimize.generate_btn', '生成最优构建')}</Button>
              </div>
            </Card>
          )}
        </div>
      ),
    },
    {
      key: 'explore',
      label: <><BarChartOutlined /> {t('tabs.explore', '探索')}</>,
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card size="small">
            <Space>
              <Select style={{ width: 240 }} value={exploreTradeoff} onChange={setExploreTradeoff} options={[
                { value: 'price', label: t('ui.tradeoff_ergo_vs_recoil', '人机 vs 后坐 (忽略价格)') },
                { value: 'recoil', label: t('ui.tradeoff_ergo_vs_price', '人机 vs 价格 (忽略后坐)') },
                { value: 'ergo', label: t('ui.tradeoff_recoil_vs_price', '后坐 vs 价格 (忽略人机)') },
              ]} />
              <Button type="primary" icon={<BarChartOutlined />} loading={exploring} onClick={handleExplore} disabled={!selectedGunId}>{t('ui.run_analysis', '运行分析')}</Button>
            </Space>
          </Card>
          {exploreResult.length > 0 ? (
            <>
              <Card size="small">
                <div style={{ height: 400 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 20, right: 20, bottom: 40, left: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" dataKey={resultTradeoff === 'recoil' ? 'ergo' : resultTradeoff === 'ergo' ? 'recoil_v' : 'ergo'} name={resultTradeoff === 'recoil' ? t('ui.chart_ergonomics', '人机') : resultTradeoff === 'ergo' ? t('ui.chart_recoil_v', '后坐V') : t('ui.chart_ergonomics', '人机')} domain={['dataMin', 'dataMax']} />
                      <YAxis type="number" dataKey={resultTradeoff === 'price' ? 'recoil_v' : 'price'} name={resultTradeoff === 'price' ? t('ui.chart_recoil_v', '后坐V') : t('ui.chart_price', '价格')} domain={['dataMin', 'dataMax']} />
                      <ZAxis type="number" dataKey="recoil_pct" />
                      <Tooltip content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload
                          return (
                            <Card size="small">
                              <Space direction="vertical">
                                <Text>人机: <Text strong style={{ color: token.colorPrimary }}>{data.ergo.toFixed(1)}</Text></Text>
                                <Text>后坐V: <Text strong style={{ color: token.colorSuccess }}>{data.recoil_v.toFixed(0)}</Text></Text>
                                <Text>价格: <Text strong style={{ color: token.colorWarning }}>₽{data.price.toLocaleString()}</Text></Text>
                              </Space>
                            </Card>
                          )
                        }
                        return null
                      }} />
                      <Scatter name="构建" data={exploreResult} fill={token.colorWarning} line />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Table size="small" dataSource={exploreResult.map((pt, i) => ({ ...pt, key: i }))} pagination={false} columns={[
                { title: t('sidebar.ergonomics', '人机'), dataIndex: 'ergo', render: (v: number) => <Text style={{ color: token.colorPrimary }}>{v.toFixed(1)}</Text> },
                { title: t('sidebar.recoil_v', '后坐V'), dataIndex: 'recoil_v', render: (v: number) => <Text style={{ color: token.colorSuccess }}>{v.toFixed(0)}</Text> },
                { title: t('sidebar.recoil_h', '后坐H'), dataIndex: 'recoil_h', render: (v: number) => <Text>{v.toFixed(0)}</Text> },
                { title: t('sidebar.price', '价格'), dataIndex: 'price', render: (v: number) => <Text style={{ color: token.colorWarning }}>₽{v.toLocaleString()}</Text> },
                { title: t('ui.table_items', '配件'), dataIndex: 'selected_items', render: (items: unknown[]) => `${items.length} 个` },
              ]} />
            </>
          ) : (
            <Card style={{ textAlign: 'center', padding: 48 }}>
              <BarChartOutlined style={{ fontSize: 64, color: token.colorTextQuaternary, marginBottom: 24 }} />
              <Title level={4}>{t('explore.ready_title', '准备探索')}</Title>
              <Text type="secondary">{t('explore.ready_description', '选择武器和权衡策略，可视化帕累托前沿')}</Text>
            </Card>
          )}
        </div>
      ),
    },
    {
      key: 'gunsmith',
      label: <><ToolOutlined /> {t('tabs.gunsmith', '枪匠')}</>,
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card size="small">
            <Space>
              <Select showSearch style={{ width: 400 }} value={selectedTaskName} onChange={setSelectedTaskName} filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())} options={gunsmithTasks.map(t => ({ value: t.task_name, label: `${t.task_name} - ${t.weapon_name}` }))} />
              <Button type="primary" icon={<ToolOutlined />} loading={optimizingGunsmith} onClick={handleGunsmithOptimize} disabled={!selectedTask}>{t('gunsmith.optimize_btn', '优化枪匠任务')}</Button>
            </Space>
          </Card>
          {selectedTask && (
            <Card size="small" title={<span style={{ userSelect: 'none' }}>{selectedTask.task_name}</span>}>
              <Row gutter={16}>
                <Col span={8}>
                  {selectedTask.weapon_image && <img src={selectedTask.weapon_image} alt="" style={{ width: '100%', maxHeight: 120, objectFit: 'contain' }} />}
                  <Title level={5}>{selectedTask.weapon_name}</Title>
                </Col>
                <Col span={16}>
                  <Space direction="vertical">
                    <Text strong>{t('gunsmith.constraints', '约束条件')}:</Text>
                    <Space wrap>
                      {selectedTask.constraints.min_ergonomics && <Tag color="blue">人机 ≥ {selectedTask.constraints.min_ergonomics}</Tag>}
                      {selectedTask.constraints.max_recoil_sum && <Tag color="green">后坐和 ≤ {selectedTask.constraints.max_recoil_sum}</Tag>}
                      {selectedTask.constraints.min_mag_capacity && <Tag color="purple">弹匣 ≥ {selectedTask.constraints.min_mag_capacity}</Tag>}
                      {selectedTask.constraints.min_sighting_range && <Tag color="cyan">瞄准距离 ≥ {selectedTask.constraints.min_sighting_range}</Tag>}
                      {selectedTask.constraints.max_weight && <Tag color="orange">重量 ≤ {selectedTask.constraints.max_weight}kg</Tag>}
                    </Space>
                    {selectedTask.required_item_names.length > 0 && (
                      <>
                        <Text strong>{t('gunsmith.required_items', '必需配件')}:</Text>
                        <Space wrap>{selectedTask.required_item_names.map((name, i) => <Tag key={i}>{name}</Tag>)}</Space>
                      </>
                    )}
                    {selectedTask.required_category_names.length > 0 && (
                      <>
                        <Text strong>{t('gunsmith.required_categories', '必需类别')}:</Text>
                        <Space wrap>{selectedTask.required_category_names.map((group, i) => <Tag key={i}>{group.join(' / ')}</Tag>)}</Space>
                      </>
                    )}
                  </Space>
                </Col>
              </Row>
            </Card>
          )}
          {gunsmithResult && (
            <>
              <Alert type={gunsmithResult.status === 'optimal' ? 'success' : gunsmithResult.status === 'infeasible' ? 'error' : 'warning'} message={`${t('results.optimization_status', '优化状态')}: ${gunsmithResult.status}`} showIcon />
              {gunsmithResult.status !== 'infeasible' && gunsmithResult.final_stats && (
                <>
                  <Row gutter={16}>
                    <Col span={6}><Card size="small"><Statistic title={t('sidebar.ergonomics', '人机')} value={gunsmithResult.final_stats.ergonomics.toFixed(1)} /></Card></Col>
                    <Col span={6}><Card size="small"><Statistic title={t('ui.vert_recoil', '垂直后坐')} value={gunsmithResult.final_stats.recoil_vertical.toFixed(0)} /></Card></Col>
                    <Col span={6}><Card size="small"><Statistic title={t('ui.weight_label', '重量')} value={gunsmithResult.final_stats.total_weight.toFixed(2)} suffix="kg" /></Card></Col>
                    <Col span={6}><Card size="small"><Statistic title={t('ui.total_cost', '总价')} value={gunsmithResult.final_stats.total_price.toLocaleString()} prefix="₽" /></Card></Col>
                  </Row>
                  <Card title={<span style={{ userSelect: 'none' }}>{t('ui.build_manifest', '构建清单')}</span>} size="small">
                    {gunsmithResult.selected_items.map(item => <ItemRow key={item.id} item={item} compactMode={compactMode} />)}
                  </Card>
                </>
              )}
            </>
          )}
        </div>
      ),
    },
  ]

  return (
    <AntApp>
      {contextHolder}
      <Layout style={{ height: '100vh' }}>
        <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', background: token.colorBgContainer, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }} onClick={() => window.location.reload()}>
            <img src="/favicon.svg" alt="logo" style={{ width: 24, height: 24, display: 'block', pointerEvents: 'none' }} draggable={false} />
            <span style={{ fontSize: 18, fontWeight: 600, lineHeight: 1 }}>{t('app.title', '塔科夫改枪优化器')}</span>
            <Tag color="orange" style={{ margin: 0 }}>v2</Tag>
          </div>
          <Space>
            <Segmented value={gameMode} onChange={(v) => setGameMode(v as GameMode)} options={[{ label: t('ui.pvp', 'PvP'), value: 'regular' }, { label: t('ui.pve', 'PvE'), value: 'pve' }]} />
            <Segmented value={themeMode} onChange={(v) => setThemeMode(v as ThemeMode)} options={[{ label: <SunOutlined />, value: 'light' }, { label: <MoonOutlined />, value: 'dark' }, { label: 'Auto', value: 'auto' }]} />
            <Select style={{ width: 140 }} value={languages.find(l => i18n.language?.startsWith(l.code))?.code || 'en'} onChange={(v) => i18n.changeLanguage(v)} options={languages.map(l => ({ value: l.code, label: `${l.flag} ${l.name}` }))} />
          </Space>
        </Header>
        <Layout>
          <Sider width={360} style={{ overflow: 'auto', background: token.colorBgContainer, borderRight: `1px solid ${token.colorBorderSecondary}` }}>{siderContent}</Sider>
          <Content style={{ padding: 24, overflow: 'auto', background: token.colorBgLayout }}>
            <Tabs items={tabItems} activeKey={activeTab} onChange={setActiveTab} />
          </Content>
        </Layout>
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
  return (
    <ConfigProvider
      locale={zhCN}
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
