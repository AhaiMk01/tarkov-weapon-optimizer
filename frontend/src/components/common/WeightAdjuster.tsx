import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Collapse, Button, Slider, InputNumber, Space, Typography, Segmented } from 'antd'
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
    moaMarks[sliderMin] = { label: sliderMin.toFixed(2), style: { fontSize: 12 } }
    if (moaRange.base > sliderMin && moaRange.base < sliderMax) {
      moaMarks[moaRange.base] = { label: moaRange.base.toFixed(2), style: { fontSize: 12, color: '#faad14' } }
    }
    moaMarks[sliderMax] = { label: sliderMax.toFixed(2), style: { fontSize: 12 } }
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
                <Segmented
                  size="small"
                  value={slidersMode ? 'sliders' : 'triangle'}
                  onChange={v => setSlidersMode(v === 'sliders')}
                  options={[
                    { label: t('optimize.weight_ui_sliders'), value: 'sliders' },
                    { label: t('optimize.weight_ui_triangle'), value: 'triangle' }
                  ]}
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={toggleRowStyle}>
                  <Text type="secondary" style={labelStyle}>{t('constraints.budget_limit')}</Text>
                  <Segmented size="small" value={useBudget ? 'on' : 'off'} onChange={(v) => onUseBudgetChange(v === 'on')} options={[{ label: t('ui.on'), value: 'on' }, { label: t('ui.off'), value: 'off' }]} />
                </div>
                {useBudget && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Slider style={{ flex: 1, margin: '0 8px' }} value={maxPrice} onChange={onMaxPriceChange} min={10000} max={1000000} step={10000} tooltip={{ formatter: v => `₽${v}` }} />
                    <InputNumber size="small" style={{ width: 90 }} value={maxPrice} onChange={(v) => onMaxPriceChange(v || 10000)} min={10000} step={10000} prefix="₽" />
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={toggleRowStyle}>
                  <Text type="secondary" style={labelStyle}>{t('constraints.min_ergo')}</Text>
                  <Segmented size="small" value={minErgo > 0 ? 'on' : 'off'} onChange={(v) => onMinErgoChange(v === 'on' ? 40 : 0)} options={[{ label: t('ui.on'), value: 'on' }, { label: t('ui.off'), value: 'off' }]} />
                </div>
                {minErgo > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Slider style={{ flex: 1, margin: '0 8px' }} value={minErgo} onChange={onMinErgoChange} min={1} max={100} />
                    <InputNumber size="small" style={{ width: 60 }} min={1} max={100} value={minErgo} onChange={(v) => onMinErgoChange(v || 1)} />
                  </div>
                )}
              </div>
              {availableMagCapacities.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={toggleRowStyle}>
                    <Text type="secondary" style={labelStyle}>{t('constraints.min_mag_capacity')}</Text>
                    <Segmented size="small" value={minMagCapacity > 0 ? 'on' : 'off'} onChange={(v) => {
                      const checked = v === 'on'
                      const initial = checked ? availableMagCapacities[0] : 0
                      onMinMagCapacityChange(initial)
                      onUseMinMagChange(checked)
                    }} options={[{ label: t('ui.on'), value: 'on' }, { label: t('ui.off'), value: 'off' }]} />
                  </div>
                  {minMagCapacity > 0 && (
                    availableMagCapacities.length > 1 ? (
                      <Slider
                        style={{ margin: '4px 8px 24px 8px' }}
                        value={minMagCapacity}
                        onChange={(v) => { onMinMagCapacityChange(v); onUseMinMagChange(true); }}
                        min={availableMagCapacities[0]}
                        max={availableMagCapacities[availableMagCapacities.length - 1]}
                        marks={Object.fromEntries(availableMagCapacities.map(c => [c, { label: `${c}`, style: { fontSize: 12 } }] as const))}
                        step={null}
                      />
                    ) : (
                      <div style={{ margin: '0 8px' }}>
                        <Typography.Text type="secondary" style={labelStyle}>
                          {availableMagCapacities[0]}
                        </Typography.Text>
                      </div>
                    )
                  )}
                </div>
              )}
              {moaRange.base > 0 && sliderMin !== sliderMax && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={toggleRowStyle}>
                    <Text type="secondary" style={labelStyle}>{t('constraints.max_moa')}</Text>
                    <Segmented size="small" value={useMOA ? 'on' : 'off'} onChange={(v) => {
                       const checked = v === 'on'
                       onUseMOAChange(checked)
                       if (checked && maxMOA === 0) onMaxMOAChange(moaRange.base)
                    }} options={[{ label: t('ui.on'), value: 'on' }, { label: t('ui.off'), value: 'off' }]} />
                  </div>
                  {useMOA && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <Slider
                        style={{ flex: 1, margin: '4px 8px 24px 8px' }}
                        value={maxMOA}
                        onChange={onMaxMOAChange}
                        min={sliderMin}
                        max={sliderMax}
                        step={0.01}
                        marks={moaMarks}
                      />
                      <InputNumber size="small" style={{ width: 70 }} min={sliderMin} max={sliderMax} step={0.01} value={maxMOA} onChange={(v) => onMaxMOAChange(v || sliderMin)} />
                    </div>
                  )}
                </div>
              )}
            </Space>
          ),
        },
      ]} />
    </>
  )
}
