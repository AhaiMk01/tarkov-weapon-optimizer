import { useTranslation } from 'react-i18next'
import { Card, Collapse, Tag, Space, Segmented, Button, Typography } from 'antd'
import { CopyOutlined } from '@ant-design/icons'
import { ItemRow } from '../ItemRow'
import type { OptimizeResponse } from '../../api/client'

const { Text } = Typography

interface BuildManifestProps {
  result: OptimizeResponse
  compactMode: boolean
  onCompactModeChange: (v: boolean) => void
  onCopy?: () => void
}

export function BuildManifest({ result, compactMode, onCompactModeChange, onCopy }: BuildManifestProps) {
  const { t } = useTranslation()
  const maxHeight = 300
  const titleContent = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
      <span style={{ userSelect: 'none' }}>{t('ui.build_manifest', '构建清单')}</span>
      <Space>
        {onCopy && <Button size="small" icon={<CopyOutlined />} onClick={onCopy}>{t('ui.copy_btn', '复制')}</Button>}
        <Segmented
          size="small"
          value={compactMode ? 'compact' : 'detailed'}
          onChange={(v) => onCompactModeChange(v === 'compact')}
          options={[
            { label: t('ui.detailed', '详细'), value: 'detailed' },
            { label: t('ui.compact', '紧凑'), value: 'compact' },
          ]}
        />
      </Space>
    </div>
  )
  if (result.selected_preset) {
    const newItems = result.selected_items.filter(i => !result.selected_preset!.items.includes(i.id))
    const retainedItems = result.selected_items.filter(i => result.selected_preset!.items.includes(i.id))
    return (
      <Card title={titleContent} size="small">
        <Collapse
          size="small"
          defaultActiveKey={newItems.length > 0 ? ['new'] : []}
          items={[
            {
              key: 'new',
              label: (
                <Space style={{ userSelect: 'none' }}>
                  <Text type="warning">{t('ui.new_changed_parts', '新增/更换配件')}</Text>
                  <Tag color="orange">{newItems.length}</Tag>
                </Space>
              ),
              children: (
                <div style={{ maxHeight, overflowY: 'auto', overflowX: 'auto' }}>
                  {newItems.length > 0
                    ? newItems.map(item => <ItemRow key={item.id} item={item} compactMode={compactMode} />)
                    : <Text type="secondary" style={{ padding: '8px 24px', display: 'block' }}>{t('ui.none', 'None')}</Text>}
                </div>
              ),
            },
            {
              key: 'retained',
              label: (
                <Space style={{ userSelect: 'none' }}>
                  <Text type="secondary">{t('ui.retained_from_preset_short', '预设保留配件')}</Text>
                  <Tag color="blue">{retainedItems.length}</Tag>
                </Space>
              ),
              children: (
                <div style={{ maxHeight, overflowY: 'auto', overflowX: 'auto' }}>
                  {retainedItems.length > 0
                    ? retainedItems.map(item => <ItemRow key={item.id} item={item} hidePrice compactMode={compactMode} />)
                    : <Text type="secondary" style={{ padding: '8px 24px', display: 'block' }}>{t('ui.none', 'None')}</Text>}
                </div>
              ),
            },
          ]}
        />
      </Card>
    )
  }
  return (
    <Card title={titleContent} size="small">
      <div style={{ maxHeight: maxHeight * 2, overflowY: 'auto', overflowX: 'auto' }}>
        {result.selected_items.map(item => <ItemRow key={item.id} item={item} compactMode={compactMode} />)}
      </div>
    </Card>
  )
}
