import { useTranslation } from 'react-i18next'
import { Alert, Card, Tag, Space, Button, Typography, message, Grid } from 'antd'
import { ThunderboltOutlined, CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import { EmptyState } from '../common/EmptyState'
import { StatsCards } from '../common/StatsCards'
import { BuildManifest } from '../common/BuildManifest'
import type { OptimizeResponse } from '../../api/client'

const { Text, Title } = Typography

interface OptimizeResultProps {
  result: OptimizeResponse | null
  compactMode: boolean
  onCompactModeChange: (v: boolean) => void
  optimizing: boolean
  onOptimize: () => void
  onCopy: () => void
  disabled: boolean
}

export function OptimizeResult({ result, compactMode, onCompactModeChange, optimizing, onOptimize, onCopy, disabled }: OptimizeResultProps) {
  const { t } = useTranslation()
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  const [messageApi, contextHolder] = message.useMessage()
  const copyText = (text: string) => {
    const successMsg = t('toast.copied', '已复制')
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => messageApi.success(successMsg))
    } else {
      const textArea = document.createElement('textarea')
      textArea.value = text
      textArea.style.position = 'fixed'
      textArea.style.left = '-9999px'
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      messageApi.success(successMsg)
    }
  }
  if (!result) {
    return (
      <EmptyState
        icon={<ThunderboltOutlined />}
        description={t('optimize.ready_description', '选择武器并调整优先级，生成数学最优构建')}
        buttonText={t('optimize.generate_btn', '开始优化')}
        buttonIcon={<ThunderboltOutlined />}
        loading={optimizing}
        disabled={disabled}
        onAction={onOptimize}
      />
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Alert
        type={result.status === 'optimal' ? 'success' : result.status === 'infeasible' ? 'error' : 'warning'}
        message={<><Text>{t('results.optimization_status', '优化状态')}: {t(`results.status_${result.status}`, result.status)}</Text>{result.solve_time_ms && <Tag color="blue" style={{ marginLeft: 8 }}>{result.solve_time_ms.toFixed(0)} ms</Tag>}{result.reason && <Text type="secondary" style={{ marginLeft: 8 }}>{result.reason}</Text>}</>}
        icon={result.status === 'optimal' ? <CheckCircleOutlined /> : result.status === 'infeasible' ? <CloseCircleOutlined /> : <ExclamationCircleOutlined />}
        showIcon
        action={<Button type="primary" icon={<ThunderboltOutlined />} loading={optimizing} onClick={onOptimize}>{t('ui.reoptimize_btn', '重新优化')}</Button>}
      />
      {result.status !== 'infeasible' && result.final_stats && (
        <>
          <StatsCards
            ergonomics={result.final_stats.ergonomics}
            recoilVertical={result.final_stats.recoil_vertical}
            recoilHorizontal={result.final_stats.recoil_horizontal}
            weight={result.final_stats.total_weight}
            price={result.final_stats.total_price}
          />
          {result.selected_preset && (
            <Card size="small">
              {contextHolder}
              {isMobile ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {result.selected_preset.icon && <img src={result.selected_preset.icon} alt="" style={{ width: '100%', maxHeight: 120, objectFit: 'contain' }} />}
                  <div>
                    <Space size={4} wrap>
                      <Text type="secondary">{t('ui.base_preset_used', '使用预设')}</Text>
                      <Tag color="gold" style={{ margin: 0 }}>₽{result.selected_preset.price.toLocaleString()}</Tag>
                      {result.selected_preset.source && <Tag style={{ margin: 0 }}>{result.selected_preset.source}</Tag>}
                    </Space>
                    <Title level={5} style={{ margin: 0, cursor: 'pointer' }} onClick={() => copyText(result.selected_preset!.name)}>{result.selected_preset.name}</Title>
                  </div>
                </div>
              ) : (
                <Space>
                  {result.selected_preset.icon && <img src={result.selected_preset.icon} alt="" style={{ height: 48, objectFit: 'contain' }} />}
                  <div>
                    <Space size={4}>
                      <Text type="secondary">{t('ui.base_preset_used', '使用预设')}</Text>
                      <Tag color="gold" style={{ margin: 0 }}>₽{result.selected_preset.price.toLocaleString()}</Tag>
                      {result.selected_preset.source && <Tag style={{ margin: 0 }}>{result.selected_preset.source}</Tag>}
                    </Space>
                    <Title level={5} style={{ margin: 0, cursor: 'pointer' }} onClick={() => copyText(result.selected_preset!.name)}>{result.selected_preset.name}</Title>
                  </div>
                </Space>
              )}
            </Card>
          )}
          <BuildManifest result={result} compactMode={compactMode} onCompactModeChange={onCompactModeChange} onCopy={onCopy} />
        </>
      )}
    </div>
  )
}
