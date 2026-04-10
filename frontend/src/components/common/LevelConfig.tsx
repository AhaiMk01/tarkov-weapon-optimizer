import { useTranslation } from 'react-i18next'
import { Collapse, Switch, Slider, Segmented, Space, Divider, Typography } from 'antd'
import type { TraderLevels } from '../../solver/types'

const { Text } = Typography

interface LevelConfigProps {
  fleaAvailable: boolean
  onFleaChange: (v: boolean) => void
  barterAvailable: boolean
  onBarterChange: (v: boolean) => void
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
              <Text>{t('sidebar.flea_market_access')}</Text>
              <Switch checked={fleaAvailable} onChange={onFleaChange} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text>{t('sidebar.barter_available')}</Text>
              <Switch checked={barterAvailable} onChange={onBarterChange} />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>{t('sidebar.player_level')}: {playerLevel}</Text>
              <Slider value={playerLevel} onChange={onPlayerLevelChange} min={1} max={79} />
            </div>
            <Divider style={{ margin: '8px 0' }} />
            {(Object.keys(traderLevels) as Array<keyof TraderLevels>).map(trader => (
              <div key={trader} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Text type="secondary" style={{ fontSize: 12, textTransform: 'capitalize', minWidth: 70 }}>{trader}</Text>
                <Segmented size="small" value={traderLevels[trader]} onChange={(v) => onTraderLevelsChange({ ...traderLevels, [trader]: v as number })} options={[{ label: 'LL 1', value: 1 }, { label: 'LL 2', value: 2 }, { label: 'LL 3', value: 3 }, { label: 'LL 4', value: 4 }]} />
              </div>
            ))}
          </Space>
        ),
      },
    ]} />
  )
}
