import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Card, Table, Tag, Typography, theme } from 'antd'
import { BarChartOutlined, CheckCircleOutlined, ExclamationCircleOutlined, ExportOutlined } from '@ant-design/icons'
import { compressToEncodedURIComponent } from 'lz-string'
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis, Legend } from 'recharts'
import { EmptyState } from '../common/EmptyState'
import type { ExplorePoint, SolverPrecisionMode } from '../../api/client'

const { Text } = Typography
const { useToken } = theme

export interface ExploreProgress {
  current: number
  total: number
  name: string
}

interface ExploreResultProps {
  exploreResult: ExplorePoint[]
  solveTime?: number
  explorePrecision?: { request?: SolverPrecisionMode; resolved?: 'fast' | 'precise' }
  resultTradeoff: 'price' | 'recoil' | 'ergo'
  exploring: boolean
  exploreProgress?: ExploreProgress | null
  onExplore: () => void
  disabled: boolean
  weaponId?: string
  /** Weapon ids requested for the current/last Explore run (denominator for n/m status). */
  runWeaponIds?: string[]
}

function precisionResolvedLabel(t: (k: string, opts?: Record<string, string>) => string, mode: 'fast' | 'precise'): string {
  return mode === 'precise' ? t('sidebar.precise') : t('sidebar.fast')
}

const EFTFORGE_URL = 'https://www.eftforge.com'

function seriesColors(token: { colorWarning: string; colorInfo: string; colorSuccess: string; colorError: string }): string[] {
  return [token.colorWarning, token.colorInfo, token.colorSuccess, token.colorError, '#a855f7', '#06b6d4']
}

function xKeyOf(tradeoff: 'price' | 'recoil' | 'ergo'): 'ergo' | 'recoil_v' {
  return tradeoff === 'ergo' ? 'recoil_v' : 'ergo'
}

export function ExploreResult({
  exploreResult,
  solveTime,
  explorePrecision,
  resultTradeoff,
  exploring,
  exploreProgress,
  onExplore,
  disabled,
  weaponId,
  runWeaponIds,
}: ExploreResultProps) {
  const { t } = useTranslation()
  const { token } = useToken()
  const colors = seriesColors(token)
  const xKey = xKeyOf(resultTradeoff)
  const yKey = resultTradeoff === 'price' ? 'recoil_v' : 'price'
  const xLabel = resultTradeoff === 'ergo' ? t('ui.chart_recoil_v') : t('ui.chart_ergonomics')
  const yLabel = resultTradeoff === 'price' ? t('ui.chart_recoil_v') : t('ui.chart_price')

  const series = useMemo(() => {
    const grouped = new Map<string, ExplorePoint[]>()
    for (const point of exploreResult) {
      const id = point.weapon_id || weaponId || 'default'
      const list = grouped.get(id)
      if (list) list.push(point)
      else grouped.set(id, [point])
    }
    return [...grouped.entries()].map(([id, points], index) => ({
      id,
      name: points[0]?.weapon_name || id,
      color: colors[index % colors.length],
      data: [...points].sort((a, b) => a[xKey] - b[xKey]),
    }))
  }, [exploreResult, weaponId, colors, xKey])

  const runTotal = Math.max(runWeaponIds?.length ?? 0, series.length)
  const returned = series.length
  const comparing = runTotal > 1
  const allOptimal = exploreResult.length > 0 && exploreResult.every(p => p.status === 'optimal')
  const colorByWeapon = useMemo(() => new Map(series.map(s => [s.id, s.color])), [series])
  const actionLabel = exploring && exploreProgress && exploreProgress.total > 1
    ? t('explore.comparing', {
        name: exploreProgress.name,
        current: exploreProgress.current,
        total: exploreProgress.total,
      })
    : t('ui.run_analysis')

  const handleOpenInEFTForge = (point: ExplorePoint) => {
    const forgeWeaponId = point.weapon_id || weaponId
    if (!forgeWeaponId || !point.slot_pairs?.length) return
    const payload = { v: 1, g: forgeWeaponId, p: point.slot_pairs }
    const code = compressToEncodedURIComponent(JSON.stringify(payload))
    window.open(`${EFTFORGE_URL}?build=${code}`, '_blank')
  }

  if (exploreResult.length === 0) {
    return (
      <EmptyState
        icon={<BarChartOutlined />}
        description={t('explore.ready_description')}
        buttonText={actionLabel}
        buttonIcon={<BarChartOutlined />}
        loading={exploring}
        disabled={disabled}
        onAction={onExplore}
      />
    )
  }

  const statusComplete = returned === runTotal && allOptimal
  const statusText = comparing
    ? `${t('explore.compare_status', { returned, total: runTotal })} · ${allOptimal ? t('results.status_optimal') : t('results.status_feasible')}`
    : `${t('results.optimization_status')}: ${allOptimal ? t('results.status_optimal') : t('results.status_feasible')}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Alert
        type={statusComplete ? 'success' : 'warning'}
        message={
          <>
            <Text>{statusText}</Text>
            {solveTime != null && <Tag color="blue" style={{ marginLeft: 8 }}>{solveTime.toFixed(0)} ms</Tag>}
            {!comparing && explorePrecision?.request === 'auto' && explorePrecision.resolved && (
              <Tag color="processing" style={{ marginLeft: 8 }} title={t('sidebar.solver_precision_tooltip')}>
                {t('results.precision_auto_ran', {
                  mode: precisionResolvedLabel(t, explorePrecision.resolved),
                })}
              </Tag>
            )}
          </>
        }
        icon={statusComplete ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
        showIcon
        action={<Button type="primary" icon={<BarChartOutlined />} loading={exploring} onClick={onExplore}>{actionLabel}</Button>}
      />
      <Card size="small">
        <div style={{ height: 400 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: comparing ? 12 : 20, right: 20, bottom: 40, left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" dataKey={xKey} name={xLabel} domain={['auto', 'auto']} label={{ value: xLabel, position: 'bottom', offset: 20 }} />
              <YAxis type="number" dataKey={yKey} name={yLabel} domain={['auto', 'auto']} label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: -20 }} />
              {!comparing && <ZAxis type="number" dataKey="recoil_pct" />}
              <Tooltip content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload as ExplorePoint
                  return (
                    <Card size="small">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {comparing && data.weapon_name && <Text strong>{data.weapon_name}</Text>}
                        <Text>{t('ui.chart_ergonomics')}: <Text strong style={{ color: token.colorPrimary }}>{data.ergo.toFixed(1)}</Text></Text>
                        <Text>{t('ui.chart_recoil_v')}: <Text strong style={{ color: token.colorSuccess }}>{data.recoil_v.toFixed(1)}</Text></Text>
                        <Text>{t('ui.chart_price')}: <Text strong style={{ color: token.colorWarning }}>₽{data.price.toLocaleString()}</Text></Text>
                      </div>
                    </Card>
                  )
                }
                return null
              }} />
              {comparing && <Legend wrapperStyle={{ color: token.colorText }} />}
              {series.map(s => (
                <Scatter key={s.id} name={s.name} data={s.data} fill={s.color} line />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Table
        size="small"
        dataSource={exploreResult.map((pt, i) => ({ ...pt, key: `${pt.weapon_id || weaponId || 'w'}-${i}` }))}
        pagination={exploreResult.length > 20 ? { pageSize: 15, showSizeChanger: false } : false}
        columns={[
          ...(comparing ? [{
            title: t('explore.weapon'),
            dataIndex: 'weapon_name',
            filters: series.map(s => ({ text: s.name, value: s.id })),
            onFilter: (value: unknown, record: ExplorePoint) => (record.weapon_id || weaponId) === value,
            render: (name: string | undefined, record: ExplorePoint) => {
              const id = record.weapon_id || weaponId || ''
              const color = colorByWeapon.get(id)
              return (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {color && <span style={{ width: 8, height: 8, borderRadius: 8, background: color, flexShrink: 0 }} />}
                  {name || id}
                </span>
              )
            },
          }] : []),
          { title: t('sidebar.ergonomics'), dataIndex: 'ergo', render: (v: number) => <Text style={{ color: token.colorPrimary }}>{v.toFixed(1)}</Text> },
          { title: t('sidebar.recoil_v'), dataIndex: 'recoil_v', render: (v: number) => <Text style={{ color: token.colorSuccess }}>{v.toFixed(1)}</Text> },
          { title: t('sidebar.recoil_h'), dataIndex: 'recoil_h', render: (v: number) => <Text>{v.toFixed(1)}</Text> },
          { title: t('sidebar.price'), dataIndex: 'price', render: (v: number) => <Text style={{ color: token.colorWarning }}>₽{v.toLocaleString()}</Text> },
          { title: t('ui.table_items'), dataIndex: 'selected_items', render: (items: unknown[]) => t('ui.item_count', { count: items.length }) },
          { title: '', dataIndex: 'slot_pairs', render: (_: unknown, record: ExplorePoint) => (record.weapon_id || weaponId) && record.slot_pairs?.length ? <Button size="small" icon={<ExportOutlined />} onClick={() => handleOpenInEFTForge(record)}>EFTForge</Button> : null },
        ]}
      />
    </div>
  )
}
