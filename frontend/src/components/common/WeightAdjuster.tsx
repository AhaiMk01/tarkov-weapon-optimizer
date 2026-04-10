import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Collapse, Button, Slider, InputNumber, Switch, Space, Typography } from 'antd'
import { TernaryPlot } from '../TernaryPlot'

const { Text } = Typography

const labelStyle = { fontSize: 12 } as const
const toggleRowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } as const

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
  useMinMag: boolean
  onUseMinMagChange: (v: boolean) => void
  minMagCapacity: number
  onMinMagCapacityChange: (v: number) => void
  availableMagCapacities: number[]
  useMOA: boolean
  onUseMOAChange: (v: boolean) => void
  maxMOA: number
  onMaxMOAChange: (v: number) => void
  moaRange: { base: number; min: number; max: number }
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
  onUseMinMagChange,
  minMagCapacity,
  onMinMagCapacityChange,
  availableMagCapacities,
  useMOA,
  onUseMOAChange,
  maxMOA,
  onMaxMOAChange,
  moaRange,
}: WeightAdjusterProps) {
  const { t } = useTranslation()
  const [slidersMode, setSlidersMode] = useState(() => localStorage.getItem('weightUiSliders') === 'true')
  useEffect(() => { localStorage.setItem('weightUiSliders', String(slidersMode)) }, [slidersMode])

  const handleErgoChange = (value: number) => onWeightChange(value, recoilWeight, priceWeight)
  const handleRecoilChange = (value: number) => onWeightChange(ergoWeight, value, priceWeight)
  const handlePriceChange = (value: number) => onWeightChange(ergoWeight, recoilWeight, value)

  const total = ergoWeight + recoilWeight + priceWeight
  const pctErgo = total > 0 ? Math.round(ergoWeight / total * 100) : 33
  const pctRecoil = total > 0 ? Math.round(recoilWeight / total * 100) : 34
  const pctPrice = total > 0 ? 100 - pctErgo - pctRecoil : 33

  // MOA slider range
  const sliderMin = Math.floor(moaRange.min * 100) / 100
  const sliderMax = Math.ceil(moaRange.max * 100) / 100
  const moaMarks: Record<number, { label: string; style?: React.CSSProperties } | string> = {}
  if (moaRange.base > 0) {
    moaMarks[sliderMin] = { label: sliderMin === moaRange.base ? `Base ${moaRange.base.toFixed(2)}` : `Best ${sliderMin.toFixed(2)}`, style: { fontSize: 10 } }
    if (moaRange.base > sliderMin && moaRange.base < sliderMax) {
      moaMarks[moaRange.base] = { label: `Base ${moaRange.base.toFixed(2)}`, style: { fontSize: 10, color: '#faad14' } }
    }
    moaMarks[sliderMax] = { label: `Worst ${sliderMax.toFixed(2)}`, style: { fontSize: 10 } }
  }

  return (
    <>
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
                <Text type="secondary" style={labelStyle}>{t('optimize.weight_ui_label')}</Text>
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
                    <Text type="secondary" style={labelStyle}>{t('sidebar.ergonomics')}: {ergoWeight} ({pctErgo}%)</Text>
                    <Slider value={ergoWeight} onChange={handleErgoChange} min={0} max={100} />
                  </div>
                  <div>
                    <Text type="secondary" style={labelStyle}>{t('optimize.preset_recoil')}: {recoilWeight} ({pctRecoil}%)</Text>
                    <Slider value={recoilWeight} onChange={handleRecoilChange} min={0} max={100} />
                  </div>
                  <div>
                    <Text type="secondary" style={labelStyle}>{t('sidebar.price')}: {priceWeight} ({pctPrice}%)</Text>
                    <Slider value={priceWeight} onChange={handlePriceChange} min={0} max={100} />
                  </div>
                </>
              )}
            </Space>
          ),
        },
      ]} />
      <Collapse size="small" defaultActiveKey={['constraints']} items={[
        {
          key: 'constraints',
          label: <span style={{ userSelect: 'none' }}>{t('constraints.header')}</span>,
          children: (
            <Space direction="vertical" style={{ width: '100%' }}>
              <div style={toggleRowStyle}>
                <Text type="secondary" style={labelStyle}>{t('constraints.budget_limit')}</Text>
                <Switch size="small" checked={useBudget} onChange={onUseBudgetChange} />
              </div>
              {useBudget && (
                <InputNumber size="small" style={{ width: '100%' }} value={maxPrice} onChange={(v) => onMaxPriceChange(v || 0)} min={10000} max={1000000} step={10000} addonBefore="₽" />
              )}
              <div>
                <Text type="secondary" style={labelStyle}>{t('constraints.min_ergo')}: {minErgo > 0 ? minErgo : t('constraints.off')}</Text>
                <Slider value={minErgo} onChange={onMinErgoChange} max={100} />
              </div>
              {availableMagCapacities.length > 0 && (
                <div>
                  <Text type="secondary" style={labelStyle}>{t('constraints.min_mag_capacity')}: {minMagCapacity === 0 ? t('constraints.off') : minMagCapacity}</Text>
                  <Slider
                    value={minMagCapacity}
                    onChange={(v) => { onMinMagCapacityChange(v); onUseMinMagChange(v > 0); }}
                    min={0}
                    max={availableMagCapacities[availableMagCapacities.length - 1]}
                    marks={Object.fromEntries([[0, t('constraints.off')], ...availableMagCapacities.map(c => [c, `${c}`] as const)])}
                    step={null}
                  />
                </div>
              )}
              {moaRange.base > 0 && sliderMin !== sliderMax && (
                <>
                  <div style={toggleRowStyle}>
                    <Text type="secondary" style={labelStyle}>{t('constraints.max_moa')}</Text>
                    <Switch size="small" checked={useMOA} onChange={onUseMOAChange} />
                  </div>
                  {useMOA && (
                    <div>
                      <Text type="secondary" style={labelStyle}>Limit: {maxMOA.toFixed(2)} MOA</Text>
                      <Slider
                        value={maxMOA}
                        onChange={onMaxMOAChange}
                        min={sliderMin}
                        max={sliderMax}
                        step={0.01}
                        marks={moaMarks}
                      />
                    </div>
                  )}
                </>
              )}
            </Space>
          ),
        },
      ]} />
    </>
  )
}
