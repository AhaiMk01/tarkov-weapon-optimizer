import { useState, useEffect } from 'react'
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
  const [slidersMode, setSlidersMode] = useState(() => localStorage.getItem('weightUiSliders') === 'true')
  useEffect(() => { localStorage.setItem('weightUiSliders', String(slidersMode)) }, [slidersMode])

  // Each slider moves independently — no forced sum=100.
  // The ternary plot normalizes automatically.
  // The solver's lpBuilder applies tiebreaker weights for any zero values.
  const handleErgoChange = (value: number) => {
    onWeightChange(value, recoilWeight, priceWeight)
  }
  const handleRecoilChange = (value: number) => {
    onWeightChange(ergoWeight, value, priceWeight)
  }
  const handlePriceChange = (value: number) => {
    onWeightChange(ergoWeight, recoilWeight, value)
  }

  // Display normalized percentages for the labels
  const total = ergoWeight + recoilWeight + priceWeight
  const pctErgo = total > 0 ? Math.round(ergoWeight / total * 100) : 33
  const pctRecoil = total > 0 ? Math.round(recoilWeight / total * 100) : 34
  const pctPrice = total > 0 ? 100 - pctErgo - pctRecoil : 33

  return (
    <Collapse size="small" defaultActiveKey={['weight']} items={[
      {
        key: 'weight',
        label: <span style={{ userSelect: 'none' }}>{t('optimize.header')}</span>,
        children: (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space size="small" wrap>
              <Button size="small" onClick={() => onWeightChange(0, 100, 0)}>{t('optimize.preset_recoil')}</Button>
              <Button size="small" onClick={() => onWeightChange(100, 0, 0)}>{t('optimize.preset_ergo')}</Button>
              <Button size="small" onClick={() => onWeightChange(33, 34, 33)}>{t('optimize.preset_balanced')}</Button>
              <Button size="small" onClick={() => onWeightChange(0, 0, 100)}>{t('optimize.preset_price')}</Button>
              <Button size="small" onClick={() => onWeightChange(50, 50, 0)}>{t('optimize.preset_performance')}</Button>
              <Button size="small" onClick={() => onWeightChange(20, 70, 10)}>{t('optimize.preset_recoil_focus')}</Button>
              <Button size="small" onClick={() => onWeightChange(70, 20, 10)}>{t('optimize.preset_ergo_focus')}</Button>
            </Space>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>{t('optimize.weight_ui_label')}</Text>
              <Switch
                checked={slidersMode}
                onChange={setSlidersMode}
                checkedChildren={t('optimize.weight_ui_sliders')}
                unCheckedChildren={t('optimize.weight_ui_triangle')}
              />
            </div>
            {!slidersMode && (
              <TernaryPlot ergoWeight={ergoWeight} recoilWeight={recoilWeight} priceWeight={priceWeight} onChange={onWeightChange} />
            )}
            {slidersMode && (
              <>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>{t('sidebar.ergonomics')}: {ergoWeight} ({pctErgo}%)</Text>
                  <Slider value={ergoWeight} onChange={handleErgoChange} min={0} max={100} />
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>{t('optimize.preset_recoil')}: {recoilWeight} ({pctRecoil}%)</Text>
                  <Slider value={recoilWeight} onChange={handleRecoilChange} min={0} max={100} />
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>{t('sidebar.price')}: {priceWeight} ({pctPrice}%)</Text>
                  <Slider value={priceWeight} onChange={handlePriceChange} min={0} max={100} />
                </div>
              </>
            )}
            <Divider style={{ margin: '8px 0' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text>{t('constraints.budget_limit')}</Text>
              <Switch checked={useBudget} onChange={onUseBudgetChange} />
            </div>
            {useBudget && (
              <InputNumber style={{ width: '100%' }} value={maxPrice} onChange={(v) => onMaxPriceChange(v || 0)} min={10000} max={1000000} step={10000} addonBefore="₽" />
            )}
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>{t('constraints.min_ergo')}: {minErgo}</Text>
              <Slider value={minErgo} onChange={onMinErgoChange} max={100} />
            </div>
          </Space>
        ),
      },
    ]} />
  )
}
