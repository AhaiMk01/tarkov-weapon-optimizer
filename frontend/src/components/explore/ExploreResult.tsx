import { useTranslation } from 'react-i18next'
import { Alert, Button, Card, Table, Tag, Typography, theme } from 'antd'
import { BarChartOutlined, CheckCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from 'recharts'
import { EmptyState } from '../common/EmptyState'
import type { ExplorePoint } from '../../api/client'

const { Text } = Typography
const { useToken } = theme

interface ExploreResultProps {
  exploreResult: ExplorePoint[]
  solveTime?: number
  resultTradeoff: 'price' | 'recoil' | 'ergo'
  exploring: boolean
  onExplore: () => void
  disabled: boolean
}

export function ExploreResult({ exploreResult, solveTime, resultTradeoff, exploring, onExplore, disabled }: ExploreResultProps) {
  const { t } = useTranslation()
  const { token } = useToken()
  if (exploreResult.length === 0) {
    return (
      <EmptyState
        icon={<BarChartOutlined />}
        description={t('explore.ready_description', '选择武器和分析策略，探索帕累托前沿')}
        buttonText={t('ui.run_analysis', '开始分析')}
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
        message={<><Text>{t('results.optimization_status', '优化状态')}: {allOptimal ? t('results.status_optimal', '最优解') : t('results.status_feasible', '可行解')}</Text>{solveTime != null && <Tag color="blue" style={{ marginLeft: 8 }}>{solveTime.toFixed(0)} ms</Tag>}</>}
        icon={allOptimal ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
        showIcon
        action={<Button type="primary" icon={<BarChartOutlined />} loading={exploring} onClick={onExplore}>{t('ui.run_analysis', '开始分析')}</Button>}
      />
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
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <Text>{t('ui.chart_ergonomics', '人机')}: <Text strong style={{ color: token.colorPrimary }}>{data.ergo.toFixed(1)}</Text></Text>
                        <Text>{t('ui.chart_recoil_v', '后坐V')}: <Text strong style={{ color: token.colorSuccess }}>{data.recoil_v.toFixed(0)}</Text></Text>
                        <Text>{t('ui.chart_price', '价格')}: <Text strong style={{ color: token.colorWarning }}>₽{data.price.toLocaleString()}</Text></Text>
                      </div>
                    </Card>
                  )
                }
                return null
              }} />
              <Scatter name={t('ui.builds', '构建')} data={exploreResult} fill={token.colorWarning} line />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Table size="small" dataSource={exploreResult.map((pt, i) => ({ ...pt, key: i }))} pagination={false} columns={[
        { title: t('sidebar.ergonomics', '人机'), dataIndex: 'ergo', render: (v: number) => <Text style={{ color: token.colorPrimary }}>{v.toFixed(1)}</Text> },
        { title: t('sidebar.recoil_v', '后坐V'), dataIndex: 'recoil_v', render: (v: number) => <Text style={{ color: token.colorSuccess }}>{v.toFixed(0)}</Text> },
        { title: t('sidebar.recoil_h', '后坐H'), dataIndex: 'recoil_h', render: (v: number) => <Text>{v.toFixed(0)}</Text> },
        { title: t('sidebar.price', '价格'), dataIndex: 'price', render: (v: number) => <Text style={{ color: token.colorWarning }}>₽{v.toLocaleString()}</Text> },
        { title: t('ui.table_items', '配件'), dataIndex: 'selected_items', render: (items: unknown[]) => t('ui.item_count', '{{count}} 个', { count: items.length }) },
      ]} />
    </div>
  )
}
