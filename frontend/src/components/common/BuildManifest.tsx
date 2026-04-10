import { useTranslation } from 'react-i18next'
import { Card, Collapse, Tag, Space, Segmented, Button, Typography, Grid } from 'antd'
import { CopyOutlined, ExportOutlined } from '@ant-design/icons'
import { compressToEncodedURIComponent } from 'lz-string'
import { ItemRow } from '../ItemRow'
import type { OptimizeResponse } from '../../api/client'

const { Text } = Typography

const EFTFORGE_URL = 'https://www.eftforge.com'

interface BuildManifestProps {
  result: OptimizeResponse
  compactMode: boolean
  onCompactModeChange: (v: boolean) => void
  onCopy?: () => void
  weaponId?: string
}

const itemGridStyle = (wide: boolean): React.CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: wide ? '1fr 1fr' : '1fr',
})

export function BuildManifest({ result, compactMode, onCompactModeChange, onCopy, weaponId }: BuildManifestProps) {
  const { t } = useTranslation()
  const screens = Grid.useBreakpoint()
  const useTwoCol = compactMode && !!screens.lg

  const handleOpenInEFTForge = () => {
    if (!weaponId || !result.slot_pairs?.length) return
    const payload = { v: 1, g: weaponId, p: result.slot_pairs }
    const code = compressToEncodedURIComponent(JSON.stringify(payload))
    window.open(`${EFTFORGE_URL}?build=${code}`, '_blank')
  }

  const titleContent = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
      <span style={{ userSelect: 'none' }}>{t('ui.build_manifest')}</span>
      <Space>
        {weaponId && result.slot_pairs && result.slot_pairs.length > 0 && (
          <Button size="small" icon={<ExportOutlined />} onClick={handleOpenInEFTForge}>EFTForge</Button>
        )}
        {onCopy && <Button size="small" icon={<CopyOutlined />} onClick={onCopy}>{t('ui.copy_btn')}</Button>}
        <Segmented
          size="small"
          value={compactMode ? 'compact' : 'detailed'}
          onChange={(v) => onCompactModeChange(v === 'compact')}
          options={[
            { label: t('ui.detailed'), value: 'detailed' },
            { label: t('ui.compact'), value: 'compact' },
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
                  <Text type="warning">{t('ui.new_changed_parts')}</Text>
                  <Tag color="orange">{newItems.length}</Tag>
                </Space>
              ),
              children: newItems.length > 0
                ? <div style={itemGridStyle(useTwoCol)}>{newItems.map(item => <ItemRow key={item.id} item={item} compactMode={compactMode} />)}</div>
                : <Text type="secondary" style={{ padding: '8px 24px', display: 'block' }}>{t('ui.none')}</Text>,
            },
            {
              key: 'retained',
              label: (
                <Space style={{ userSelect: 'none' }}>
                  <Text type="secondary">{t('ui.retained_from_preset_short')}</Text>
                  <Tag color="blue">{retainedItems.length}</Tag>
                </Space>
              ),
              children: retainedItems.length > 0
                ? <div style={itemGridStyle(useTwoCol)}>{retainedItems.map(item => <ItemRow key={item.id} item={item} hidePrice compactMode={compactMode} />)}</div>
                : <Text type="secondary" style={{ padding: '8px 24px', display: 'block' }}>{t('ui.none')}</Text>,
            },
          ]}
        />
      </Card>
    )
  }
  return (
    <Card title={titleContent} size="small">
      <div style={itemGridStyle(useTwoCol)}>{result.selected_items.map(item => <ItemRow key={item.id} item={item} compactMode={compactMode} />)}</div>
    </Card>
  )
}
