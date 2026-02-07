import { useTranslation } from 'react-i18next'
import { Collapse, Button, Slider, InputNumber, Switch, Space, Divider, Typography } from 'antd'
import { TernaryPlot } from '../TernaryPlot'

const { Text } = Typography

interface WeightAdjusterProps {
  ergoWeight: number
  recoilWeight: number
  priceWeight: number
  onWeightChange: (ergo: number, recoil: number, price: number) => void
  useBudget: boolean
  onUseBudgetChange: (v: boolean) => void
  maxPrice: number
  onMaxPriceChange: (v: number) => void
  minErgo: number
  onMinErgoChange: (v: number) => void
}

export function WeightAdjuster({
  ergoWeight,
  recoilWeight,
  priceWeight,
  onWeightChange,
  useBudget,
  onUseBudgetChange,
  maxPrice,
  onMaxPriceChange,
  minErgo,
  onMinErgoChange,
}: WeightAdjusterProps) {
  const { t } = useTranslation()
  const handleErgoChange = (value: number) => {
    const remaining = 100 - value
    const ratio = recoilWeight + priceWeight > 0 ? recoilWeight / (recoilWeight + priceWeight) : 0.5
    const newRecoil = Math.round(remaining * ratio)
    const newPrice = remaining - newRecoil
    onWeightChange(value, newRecoil, newPrice)
  }
  const handleRecoilChange = (value: number) => {
    const remaining = 100 - value
    const ratio = ergoWeight + priceWeight > 0 ? ergoWeight / (ergoWeight + priceWeight) : 0.5
    const newErgo = Math.round(remaining * ratio)
    const newPrice = remaining - newErgo
    onWeightChange(newErgo, value, newPrice)
  }
  const handlePriceChange = (value: number) => {
    const remaining = 100 - value
    const ratio = ergoWeight + recoilWeight > 0 ? ergoWeight / (ergoWeight + recoilWeight) : 0.5
    const newErgo = Math.round(remaining * ratio)
    const newRecoil = remaining - newErgo
    onWeightChange(newErgo, newRecoil, value)
  }
  return (
    <Collapse size="small" defaultActiveKey={['weight']} items={[
      {
        key: 'weight',
        label: <span style={{ userSelect: 'none' }}>{t('optimize.header', '权重调整')}</span>,
        children: (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space>
              <Button size="small" onClick={() => onWeightChange(0, 100, 0)}>{t('optimize.preset_recoil', '后坐')}</Button>
              <Button size="small" onClick={() => onWeightChange(100, 0, 0)}>{t('optimize.preset_ergo', '人机')}</Button>
              <Button size="small" onClick={() => onWeightChange(33, 34, 33)}>{t('optimize.preset_balanced', '平衡')}</Button>
            </Space>
            <TernaryPlot ergoWeight={ergoWeight} recoilWeight={recoilWeight} priceWeight={priceWeight} onChange={onWeightChange} />
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>{t('sidebar.ergonomics', '人机')}: {ergoWeight}%</Text>
              <Slider value={ergoWeight} onChange={handleErgoChange} min={0} max={100} />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>{t('optimize.preset_recoil', '后坐')}: {recoilWeight}%</Text>
              <Slider value={recoilWeight} onChange={handleRecoilChange} min={0} max={100} />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>{t('sidebar.price', '价格')}: {priceWeight}%</Text>
              <Slider value={priceWeight} onChange={handlePriceChange} min={0} max={100} />
            </div>
            <Divider style={{ margin: '8px 0' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text>{t('constraints.budget_limit', '预算限制')}</Text>
              <Switch checked={useBudget} onChange={onUseBudgetChange} />
            </div>
            {useBudget && (
              <InputNumber style={{ width: '100%' }} value={maxPrice} onChange={(v) => onMaxPriceChange(v || 0)} min={10000} max={1000000} step={10000} addonBefore="₽" />
            )}
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>{t('constraints.min_ergo', '最低人机')}: {minErgo}</Text>
              <Slider value={minErgo} onChange={onMinErgoChange} max={100} />
            </div>
          </Space>
        ),
      },
    ]} />
  )
}
