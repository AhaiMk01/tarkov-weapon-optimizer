import { useTranslation } from 'react-i18next'
import { Collapse, Switch, Slider, Segmented, Space, Divider, Typography } from 'antd'

const { Text } = Typography

interface TraderLevels {
  prapor: number
  skier: number
  peacekeeper: number
  mechanic: number
  jaeger: number
}

interface LevelConfigProps {
  fleaAvailable: boolean
  onFleaChange: (v: boolean) => void
  playerLevel: number
  onPlayerLevelChange: (v: number) => void
  traderLevels: TraderLevels
  onTraderLevelsChange: (v: TraderLevels) => void
}

export function LevelConfig({
  fleaAvailable,
  onFleaChange,
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
        label: <span style={{ userSelect: 'none' }}>{t('sidebar.player_trader_access', '等级配置')}</span>,
        children: (
          <Space direction="vertical" style={{ width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text>{t('sidebar.flea_market_access', '跳蚤市场')}</Text>
              <Switch checked={fleaAvailable} onChange={onFleaChange} />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>{t('sidebar.player_level', '玩家等级')}: {playerLevel}</Text>
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
