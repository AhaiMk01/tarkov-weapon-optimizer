import { useTranslation } from 'react-i18next'
import { Card, Space, Segmented, Button, Typography, Grid } from 'antd'
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
  lockedIds?: string[]
  excludedIds?: string[]
  onToggleLock?: (id: string) => void
  onToggleExclude?: (id: string) => void
}

const itemGridStyle = (wide: boolean): React.CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: wide ? '1fr 1fr' : '1fr',
  gap: 8,
})

export function BuildManifest({ result, compactMode, onCompactModeChange, onCopy, weaponId, lockedIds, excludedIds, onToggleLock, onToggleExclude }: BuildManifestProps) {
  const { t } = useTranslation()
  const screens = Grid.useBreakpoint()
  const useTwoCol = !!screens.md
  const gridStyle = itemGridStyle(useTwoCol)

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
    return (
      <Card title={titleContent} size="small">
        <div style={gridStyle}>
          {newItems.map(item => <ItemRow key={item.id} item={item} compactMode={compactMode} lockedIds={lockedIds} excludedIds={excludedIds} onToggleLock={onToggleLock} onToggleExclude={onToggleExclude} />)}
        </div>
        {newItems.length === 0 && <Text type="secondary" style={{ padding: '8px 24px', display: 'block' }}>{t('ui.none')}</Text>}
      </Card>
    )
  }
  return (
    <Card title={titleContent} size="small">
      <div style={gridStyle}>{result.selected_items.map(item => <ItemRow key={item.id} item={item} compactMode={compactMode} lockedIds={lockedIds} excludedIds={excludedIds} onToggleLock={onToggleLock} onToggleExclude={onToggleExclude} />)}</div>
    </Card>
  )
}
