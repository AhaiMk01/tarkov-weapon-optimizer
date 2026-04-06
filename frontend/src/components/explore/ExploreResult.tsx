import { useTranslation } from 'react-i18next'
import { Alert, Button, Card, Table, Tag, Typography, theme } from 'antd'
import { BarChartOutlined, CheckCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from 'recharts'
import { EmptyState } from '../common/EmptyState'
import type { ExplorePoint, SolverPrecisionMode } from '../../api/client'

const { Text } = Typography
const { useToken } = theme

interface ExploreResultProps {
  exploreResult: ExplorePoint[]
  solveTime?: number
  explorePrecision?: { request?: SolverPrecisionMode; resolved?: 'fast' | 'precise' }
  resultTradeoff: 'price' | 'recoil' | 'ergo'
  exploring: boolean
  onExplore: () => void
  disabled: boolean
}

function precisionResolvedLabel(t: (k: string, opts?: Record<string, string>) => string, mode: 'fast' | 'precise'): string {
  return mode === 'precise' ? t('sidebar.precise') : t('sidebar.fast')
}

export function ExploreResult({ exploreResult, solveTime, explorePrecision, resultTradeoff, exploring, onExplore, disabled }: ExploreResultProps) {
  const { t } = useTranslation()
  const { token } = useToken()
  if (exploreResult.length === 0) {
    return (
      <EmptyState
        icon={<BarChartOutlined />}
        description={t('explore.ready_description')}
        buttonText={t('ui.run_analysis')}
        buttonIcon={<BarChartOutlined />}
        loading={exploring}
        disabled={disabled}
        onAction={onExplore}
      />
    )
  }
  const allOptimal = exploreResult.every(p => p.status === 'optimal')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Alert
        type={allOptimal ? 'success' : 'warning'}
        message={
          <>
            <Text>{t('results.optimization_status')}: {allOptimal ? t('results.status_optimal') : t('results.status_feasible')}</Text>
            {solveTime != null && <Tag color="blue" style={{ marginLeft: 8 }}>{solveTime.toFixed(0)} ms</Tag>}
            {explorePrecision?.request === 'auto' && explorePrecision.resolved && (
              <Tag color="processing" style={{ marginLeft: 8 }} title={t('sidebar.solver_precision_tooltip')}>
                {t('results.precision_auto_ran', {
                  mode: precisionResolvedLabel(t, explorePrecision.resolved),
                })}
              </Tag>
            )}
          </>
        }
        icon={allOptimal ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
        showIcon
        action={<Button type="primary" icon={<BarChartOutlined />} loading={exploring} onClick={onExplore}>{t('ui.run_analysis')}</Button>}
      />
      <Card size="small">
        <div style={{ height: 400 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 20, right: 20, bottom: 40, left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" dataKey={resultTradeoff === 'recoil' ? 'ergo' : resultTradeoff === 'ergo' ? 'recoil_v' : 'ergo'} name={resultTradeoff === 'recoil' ? t('ui.chart_ergonomics') : resultTradeoff === 'ergo' ? t('ui.chart_recoil_v') : t('ui.chart_ergonomics')} domain={['dataMin', 'dataMax']} />
              <YAxis type="number" dataKey={resultTradeoff === 'price' ? 'recoil_v' : 'price'} name={resultTradeoff === 'price' ? t('ui.chart_recoil_v') : t('ui.chart_price')} domain={['dataMin', 'dataMax']} />
              <ZAxis type="number" dataKey="recoil_pct" />
              <Tooltip content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload
                  return (
                    <Card size="small">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <Text>{t('ui.chart_ergonomics')}: <Text strong style={{ color: token.colorPrimary }}>{data.ergo.toFixed(1)}</Text></Text>
                        <Text>{t('ui.chart_recoil_v')}: <Text strong style={{ color: token.colorSuccess }}>{data.recoil_v.toFixed(1)}</Text></Text>
                        <Text>{t('ui.chart_price')}: <Text strong style={{ color: token.colorWarning }}>₽{data.price.toLocaleString()}</Text></Text>
                      </div>
                    </Card>
                  )
                }
                return null
              }} />
              <Scatter name={t('ui.builds')} data={exploreResult} fill={token.colorWarning} line />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Table size="small" dataSource={exploreResult.map((pt, i) => ({ ...pt, key: i }))} pagination={false} columns={[
        { title: t('sidebar.ergonomics'), dataIndex: 'ergo', render: (v: number) => <Text style={{ color: token.colorPrimary }}>{v.toFixed(1)}</Text> },
        { title: t('sidebar.recoil_v'), dataIndex: 'recoil_v', render: (v: number) => <Text style={{ color: token.colorSuccess }}>{v.toFixed(1)}</Text> },
        { title: t('sidebar.recoil_h'), dataIndex: 'recoil_h', render: (v: number) => <Text>{v.toFixed(1)}</Text> },
        { title: t('sidebar.price'), dataIndex: 'price', render: (v: number) => <Text style={{ color: token.colorWarning }}>₽{v.toLocaleString()}</Text> },
        { title: t('ui.table_items'), dataIndex: 'selected_items', render: (items: unknown[]) => t('ui.item_count', { count: items.length }) },
      ]} />
    </div>
  )
}
