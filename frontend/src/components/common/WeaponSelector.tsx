import { useTranslation } from 'react-i18next'
import { Card, Select, Space, Row, Col } from 'antd'
import type { Gun } from '../../api/client'

interface WeaponSelectorProps {
  guns: Gun[]
  selectedGunId: string
  onGunChange: (id: string) => void
  selectedCategory: string
  onCategoryChange: (category: string) => void
  selectedCaliber: string
  onCaliberChange: (caliber: string) => void
  categories: string[]
  calibers: string[]
  filteredGuns: Gun[]
}

export function WeaponSelector({
  selectedGunId,
  onGunChange,
  selectedCategory,
  onCategoryChange,
  selectedCaliber,
  onCaliberChange,
  categories,
  calibers,
  filteredGuns,
}: WeaponSelectorProps) {
  const { t } = useTranslation()
  return (
    <Card title={<span style={{ userSelect: 'none' }}>{t('sidebar.select_weapon', '武器选择')}</span>} size="small">
      <Space direction="vertical" style={{ width: '100%' }}>
        <Row gutter={8}>
          <Col span={12}>
            <Select
              style={{ width: '100%' }}
              value={selectedCategory === 'All' ? undefined : selectedCategory}
              onChange={(v) => onCategoryChange(v || 'All')}
              placeholder={t('ui.weapon_category', '武器类别')}
              allowClear
              options={categories.filter(c => c !== 'All').map(c => ({ value: c, label: c }))}
            />
          </Col>
          <Col span={12}>
            <Select
              style={{ width: '100%' }}
              value={selectedCaliber === 'All' ? undefined : selectedCaliber}
              onChange={(v) => onCaliberChange(v || 'All')}
              placeholder={t('ui.caliber_type', '子弹口径')}
              allowClear
              options={calibers.filter(c => c !== 'All').map(c => ({ value: c, label: c }))}
            />
          </Col>
        </Row>
        <Select
          showSearch
          style={{ width: '100%' }}
          value={selectedGunId}
          onChange={onGunChange}
          filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
          options={filteredGuns.map(g => ({ value: g.id, label: g.name }))}
          optionRender={(option) => {
            const gun = filteredGuns.find(g => g.id === option.value)
            return (
              <Space>
                {gun?.image && <img src={gun.image} alt="" style={{ width: 48, height: 32, objectFit: 'contain' }} />}
                <span>{option.label}</span>
              </Space>
            )
          }}
        />
      </Space>
    </Card>
  )
}
