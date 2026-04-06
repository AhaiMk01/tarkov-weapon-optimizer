import { useTranslation } from 'react-i18next'
import { Card, Select, Space, Tag, Typography, message } from 'antd'
import { LevelConfig } from '../common/LevelConfig'
import type { GunsmithTask } from '../../api/client'
import type { TraderLevels } from '../../solver/types'

const { Text, Title } = Typography

interface GunsmithPanelProps {
  gunsmithTasks: GunsmithTask[]
  selectedTaskName: string
  onTaskNameChange: (v: string) => void
  selectedTask: GunsmithTask | undefined
  fleaAvailable: boolean
  onFleaChange: (v: boolean) => void
  playerLevel: number
  onPlayerLevelChange: (v: number) => void
  traderLevels: TraderLevels
  onTraderLevelsChange: (v: TraderLevels) => void
}

export function GunsmithPanel(props: GunsmithPanelProps) {
  const { t } = useTranslation()
  const [messageApi, contextHolder] = message.useMessage()
  const copyText = (text: string) => {
    const successMsg = t('toast.copied')
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {contextHolder}
      <Card size="small" title={<span style={{ userSelect: 'none' }}>{t('gunsmith.select_task')}</span>}>
        <Select showSearch style={{ width: '100%' }} value={props.selectedTaskName} onChange={props.onTaskNameChange} filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())} options={props.gunsmithTasks.map(t => ({ value: t.task_name, label: `${t.task_name} - ${t.weapon_name}` }))} />
      </Card>
      {props.selectedTask && (
        <Card size="small" title={<span style={{ userSelect: 'none' }}>{props.selectedTask.task_name}</span>}>
          <Space direction="vertical" style={{ width: '100%' }}>
            {props.selectedTask.weapon_image && (
              <img src={props.selectedTask.weapon_image} alt="" style={{ width: '100%', maxHeight: 120, objectFit: 'contain' }} />
            )}
            <Title level={5} style={{ margin: 0, textAlign: 'center', cursor: 'pointer' }} onClick={() => copyText(props.selectedTask!.weapon_name)}>{props.selectedTask.weapon_name}</Title>
            <div>
              <Text strong>{t('gunsmith.constraints')}</Text>
              <div style={{ marginTop: 8 }}>
                <Space wrap>
                  {props.selectedTask.constraints.min_ergonomics && <Tag color="blue">{t('constraints.min_ergo_tag')} {props.selectedTask.constraints.min_ergonomics}</Tag>}
                  {props.selectedTask.constraints.max_recoil_sum && <Tag color="green">{t('constraints.max_recoil_sum_tag')} {props.selectedTask.constraints.max_recoil_sum}</Tag>}
                  {props.selectedTask.constraints.min_mag_capacity && <Tag color="purple">{t('constraints.min_mag_capacity_tag')} {props.selectedTask.constraints.min_mag_capacity}</Tag>}
                  {props.selectedTask.constraints.min_sighting_range && <Tag color="cyan">{t('constraints.min_sighting_range_tag')} {props.selectedTask.constraints.min_sighting_range}</Tag>}
                  {props.selectedTask.constraints.max_weight && <Tag color="orange">{t('constraints.max_weight_tag')} {props.selectedTask.constraints.max_weight}kg</Tag>}
                </Space>
              </div>
            </div>
            {props.selectedTask.required_item_names.length > 0 && (
              <div>
                <Text strong>{t('gunsmith.required_items')}</Text>
                <div style={{ marginTop: 8 }}>
                  <Space wrap>{props.selectedTask.required_item_names.map((name, i) => <Tag key={i}>{name}</Tag>)}</Space>
                </div>
              </div>
            )}
            {(props.selectedTask.implicit_required_item_names?.length ?? 0) > 0 && (
              <div>
                <Text strong>{t('gunsmith.implicit_required_items')}</Text>
                <div style={{ marginTop: 8 }}>
                  <Space wrap>{(props.selectedTask.implicit_required_item_names ?? []).map((name, i) => <Tag key={i} color="default">{name}</Tag>)}</Space>
                </div>
              </div>
            )}
            {props.selectedTask.required_category_names.length > 0 && (
              <div>
                <Text strong>{t('gunsmith.required_categories')}</Text>
                <div style={{ marginTop: 8 }}>
                  <Space wrap>{props.selectedTask.required_category_names.map((group, i) => <Tag key={i}>{group.join(' / ')}</Tag>)}</Space>
                </div>
              </div>
            )}
          </Space>
        </Card>
      )}
      <LevelConfig
        fleaAvailable={props.fleaAvailable}
        onFleaChange={props.onFleaChange}
        playerLevel={props.playerLevel}
        onPlayerLevelChange={props.onPlayerLevelChange}
        traderLevels={props.traderLevels}
        onTraderLevelsChange={props.onTraderLevelsChange}
      />
    </div>
  )
}
