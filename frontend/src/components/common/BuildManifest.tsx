import { useTranslation } from 'react-i18next'
import { Table, Card, Space, Segmented, Button, Typography, Tag, Tooltip } from 'antd'
import { CopyOutlined, ExportOutlined, LockOutlined, UnlockOutlined, StopOutlined } from '@ant-design/icons'
import { compressToEncodedURIComponent } from 'lz-string'
import { ItemRow, ItemTooltip, TraderIcon, priceCell } from '../ItemRow'
import type { OptimizeResponse, ItemDetail } from '../../api/client'
import { useMemo } from 'react'

const { Text } = Typography

const EFTFORGE_URL = 'https://www.eftforge.com'

interface BuildManifestProps {
  result: OptimizeResponse
  viewMode: 'detailed' | 'compact' | 'table'
  onViewModeChange: (v: 'detailed' | 'compact' | 'table') => void
  onCopy?: () => void
  weaponId?: string
  lockedIds?: string[]
  excludedIds?: string[]
  onToggleLock?: (id: string) => void
  onToggleExclude?: (id: string) => void
}

const itemGridStyle = (viewMode: 'detailed' | 'compact' | 'table'): React.CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fit, minmax(max(${viewMode === 'compact' ? 'calc(33.33% - 8px)' : 'calc(50% - 4px)'}, min(100%, ${viewMode === 'compact' ? 480 : 640}px)), 1fr))`,
  gap: 8,
})

export function BuildManifest({ result, viewMode, onViewModeChange, onCopy, weaponId, lockedIds, excludedIds, onToggleLock, onToggleExclude }: BuildManifestProps) {
  const { t } = useTranslation()
  const gridStyle = useMemo(() => itemGridStyle(viewMode), [viewMode])

  const handleOpenInEFTForge = () => {
    if (!weaponId || !result.slot_pairs?.length) return
    const payload = { v: 1, g: weaponId, p: result.slot_pairs }
    const code = compressToEncodedURIComponent(JSON.stringify(payload))
    window.open(`${EFTFORGE_URL}?build=${code}`, '_blank')
  }

  const columns = useMemo(() => [
    {
      title: t('ui.table_item'),
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: ItemDetail) => (
        <Space size={8}>
          <div style={{ display: 'flex', gap: 4 }}>
            <Button
              size="small"
              type="text"
              icon={lockedIds?.includes(record.id) ? <LockOutlined style={{ color: '#1890ff' }} /> : <UnlockOutlined style={{ opacity: 0.3 }} />}
              onClick={() => onToggleLock?.(record.id)}
              title={t('ui.lock_tooltip')}
            />
            <Button
              size="small"
              type="text"
              danger={excludedIds?.includes(record.id)}
              icon={<StopOutlined style={excludedIds?.includes(record.id) ? undefined : { opacity: 0.3 }} />}
              onClick={() => onToggleExclude?.(record.id)}
              title={t('ui.exclude_tooltip')}
            />
          </div>
          <ItemTooltip item={record}>
             <Text strong style={{ fontSize: 13, cursor: 'pointer' }}>{text}</Text>
          </ItemTooltip>
        </Space>
      )
    },
    {
      title: t('ui.table_category'),
      dataIndex: 'category',
      key: 'category',
      render: (cat: string) => <Text type="secondary" style={{ fontSize: 12 }}>{cat?.split(/->|>|\//).pop()?.trim()}</Text>
    },
    {
      title: t('sidebar.ergonomics'),
      dataIndex: 'ergonomics',
      key: 'ergonomics',
      width: 100,
      align: 'right' as const,
      render: (val: number) => val !== 0 ? <Tag color={val > 0 ? 'blue' : 'red'} style={{ margin: 0 }}>{val > 0 ? '+' : ''}{val}</Tag> : null
    },
    {
      title: t('ui.vert_recoil'),
      dataIndex: 'recoil_modifier',
      key: 'recoil',
      width: 100,
      align: 'right' as const,
      render: (val: number) => val !== 0 ? <Tag color={val < 0 ? 'green' : 'red'} style={{ margin: 0 }}>{(val * 100).toFixed(1)}%</Tag> : null
    },
    {
      title: t('ui.table_trader'),
      dataIndex: 'source',
      key: 'trader',
      width: 120,
      render: (source: string, record: ItemDetail) => <TraderIcon source={source} unknownLabel="..." compact size={24} barterRequirements={record.barter_requirements} />
    },
    {
      title: t('ui.total_cost'),
      key: 'price',
      width: 140,
      align: 'right' as const,
      render: (_: any, record: ItemDetail) => <Tag color="gold" style={{ margin: 0, fontWeight: 600 }}>{priceCell(record)}</Tag>
    },
    {
      title: t('ui.weight_label'),
      dataIndex: 'weight',
      key: 'weight',
      width: 100,
      align: 'right' as const,
      render: (val: number) => val ? <Tag color="cyan" style={{ margin: 0 }}>{val.toFixed(2)}kg</Tag> : null
    }
  ], [t, lockedIds, excludedIds, onToggleLock, onToggleExclude])

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
          value={viewMode}
          onChange={(v) => onViewModeChange(v as any)}
          options={[
            { label: t('ui.detailed'), value: 'detailed' },
            { label: t('ui.compact'), value: 'compact' },
            { label: t('ui.table_view'), value: 'table' },
          ]}
        />
      </Space>
    </div>
  )
  const renderContent = (items: ItemDetail[]) => {
    if (viewMode === 'table') {
      return (
        <Table
          dataSource={items}
          columns={columns}
          rowKey="id"
          pagination={false}
          size="small"
          scroll={{ x: 'max-content' }}
        />
      )
    }
    return (
      <div style={gridStyle}>
        {items.map(item => (
          <ItemRow
            key={item.id}
            item={item}
            compactMode={viewMode === 'compact'}
            lockedIds={lockedIds}
            excludedIds={excludedIds}
            onToggleLock={onToggleLock}
            onToggleExclude={onToggleExclude}
          />
        ))}
      </div>
    )
  }

  const itemsToRender = result.selected_preset
    ? result.selected_items.filter(i => !result.selected_preset!.items.includes(i.id))
    : result.selected_items

  return (
    <Card title={titleContent} size="small" styles={{ body: { padding: viewMode === 'table' ? 0 : undefined } }}>
      <div>
        {renderContent(itemsToRender)}
        {itemsToRender.length === 0 && <Text type="secondary" style={{ padding: '16px 24px', display: 'block' }}>{t('ui.none')}</Text>}
      </div>
    </Card>
  )
}
