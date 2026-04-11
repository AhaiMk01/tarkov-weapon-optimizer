import { useTranslation } from 'react-i18next'
import { Collapse, Checkbox, Slider, Segmented, Space, Divider, Typography } from 'antd'
import type { TraderLevels } from '../../solver/types'

const { Text } = Typography

interface LevelConfigProps {
  fleaAvailable: boolean
  onFleaChange: (v: boolean) => void
  barterAvailable: boolean
  onBarterChange: (v: boolean) => void
  barterExcludeDogtags: boolean
  onBarterExcludeDogsChange: (v: boolean) => void
  playerLevel: number
  onPlayerLevelChange: (v: number) => void
  traderLevels: TraderLevels
  onTraderLevelsChange: (v: TraderLevels) => void
}

export function LevelConfig({
  fleaAvailable,
  onFleaChange,
  barterAvailable,
  onBarterChange,
  barterExcludeDogtags,
  onBarterExcludeDogsChange,
  playerLevel,
  onPlayerLevelChange,
  traderLevels,
  onTraderLevelsChange,
}: LevelConfigProps) {
  const { t } = useTranslation()
  return (
    <Collapse size="small" items={[
      {
        key: 'market',
        label: <span style={{ userSelect: 'none' }}>{t('sidebar.player_trader_access')}</span>,
        children: (
          <Space direction="vertical" style={{ width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>{t('sidebar.flea_market_access')}</Text>
              <Segmented size="small" value={fleaAvailable ? 'on' : 'off'} onChange={v => onFleaChange(v === 'on')} options={[{ label: t('ui.on'), value: 'on' }, { label: t('ui.off'), value: 'off' }]} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>{t('sidebar.barter_available')}</Text>
              <Segmented size="small" value={barterAvailable ? 'on' : 'off'} onChange={v => onBarterChange(v === 'on')} options={[{ label: t('ui.on'), value: 'on' }, { label: t('ui.off'), value: 'off' }]} />
            </div>
            {barterAvailable && (
              <Checkbox checked={barterExcludeDogtags} onChange={(e) => onBarterExcludeDogsChange(e.target.checked)}>
                <Text type="secondary" style={{ fontSize: 12 }}>{t('sidebar.barter_exclude_dogtags')}</Text>
              </Checkbox>
            )}
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>{t('sidebar.player_level')}: {playerLevel}</Text>
              <Slider value={playerLevel} onChange={onPlayerLevelChange} min={1} max={79} />
            </div>
            <Divider style={{ margin: '8px 0' }} />
            {(Object.keys(traderLevels) as Array<keyof TraderLevels>).map(trader => (
              <div key={trader} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Text type="secondary" style={{ fontSize: 12, minWidth: 70 }}>{t(`trader.${trader}`)}</Text>
                <Segmented size="small" value={traderLevels[trader]} onChange={(v) => onTraderLevelsChange({ ...traderLevels, [trader]: v as number })} options={[{ label: t('ui.ll_level', { level: 1 }), value: 1 }, { label: t('ui.ll_level', { level: 2 }), value: 2 }, { label: t('ui.ll_level', { level: 3 }), value: 3 }, { label: t('ui.ll_level', { level: 4 }), value: 4 }]} />
              </div>
            ))}
          </Space>
        ),
      },
    ]} />
  )
}
