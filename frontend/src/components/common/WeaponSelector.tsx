import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, Select, Space, Row, Col, Tag, Typography, theme } from 'antd'
import { MinusOutlined, PlusOutlined } from '@ant-design/icons'
import type { Gun } from '../../api/client'

const { useToken } = theme

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
  /** Explore: pick 1..n weapons in this same card. Optimize leaves this off. */
  multiple?: boolean
  selectedGunIds?: string[]
  onGunIdsChange?: (ids: string[]) => void
  maxCount?: number
  hint?: string
}

export function WeaponSelector({
  guns,
  selectedGunId,
  onGunChange,
  selectedCategory,
  onCategoryChange,
  selectedCaliber,
  onCaliberChange,
  categories,
  calibers,
  filteredGuns,
  multiple = false,
  selectedGunIds,
  onGunIdsChange,
  maxCount,
  hint,
}: WeaponSelectorProps) {
  const { t } = useTranslation()
  const { token } = useToken()
  const [searchValue, setSearchValue] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const selectedIds = multiple
    ? (selectedGunIds ?? [])
    : (selectedGunId ? [selectedGunId] : [])
  const atLimit = maxCount != null && selectedIds.length >= maxCount

  const addId = (id: string) => {
    if (!id || selectedIds.includes(id)) return
    if (maxCount != null && selectedIds.length >= maxCount) return
    onGunIdsChange?.([...selectedIds, id])
    setSearchValue('')
  }

  const removeId = (id: string) => {
    onGunIdsChange?.(selectedIds.filter(wid => wid !== id))
    setSearchValue('')
  }

  return (
    <Card title={<span style={{ userSelect: 'none' }}>{t('sidebar.select_weapon')}</span>} size="small">
      <Space direction="vertical" style={{ width: '100%' }}>
        <Row gutter={8}>
          <Col span={12}>
            <Select
              style={{ width: '100%' }}
              value={selectedCategory === 'All' ? undefined : selectedCategory}
              onChange={(v) => onCategoryChange(v || 'All')}
              placeholder={t('ui.weapon_category')}
              allowClear
              options={categories.filter(c => c !== 'All').map(c => ({ value: c, label: c }))}
            />
          </Col>
          <Col span={12}>
            <Select
              style={{ width: '100%' }}
              value={selectedCaliber === 'All' ? undefined : selectedCaliber}
              onChange={(v) => onCaliberChange(v || 'All')}
              placeholder={t('ui.caliber_type')}
              allowClear
              options={calibers.filter(c => c !== 'All').map(c => ({ value: c, label: c }))}
            />
          </Col>
        </Row>
        {multiple ? (
          <>
            <Select
              showSearch
              style={{ width: '100%' }}
              placeholder={t('explore.compare_placeholder', { max: maxCount ?? selectedIds.length })}
              value={null}
              searchValue={searchValue}
              onSearch={setSearchValue}
              onDropdownVisibleChange={setDropdownOpen}
              onSelect={(id) => { if (id) addId(id) }}
              onKeyDown={(e) => { if (e.key === ' ' && dropdownOpen) setSearchValue(prev => prev + ' ') }}
              filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
              options={filteredGuns.map(g => ({ value: g.id, label: g.name }))}
              optionRender={(option) => {
                const gun = filteredGuns.find(g => g.id === option.value)
                const id = option.value as string
                const added = selectedIds.includes(id)
                return (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Space>
                      {gun?.image && <img src={gun.image} alt="" style={{ width: 48, height: 32, objectFit: 'contain' }} />}
                      <span>{option.label}</span>
                    </Space>
                    <Space size={4}>
                      {!added && !atLimit && (
                        <Button
                          size="small"
                          type="text"
                          icon={<PlusOutlined />}
                          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                          onClick={(e) => { e.stopPropagation(); addId(id) }}
                          style={{ color: token.colorSuccess }}
                        />
                      )}
                      {added && (
                        <Button
                          size="small"
                          type="text"
                          icon={<MinusOutlined />}
                          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                          onClick={(e) => { e.stopPropagation(); removeId(id) }}
                          style={{ color: token.colorError }}
                        />
                      )}
                    </Space>
                  </div>
                )
              }}
            />
            <Space wrap>
              {selectedIds.map(id => {
                const gun = guns.find(g => g.id === id)
                return (
                  <Tag key={id} color="success" closable onClose={() => removeId(id)}>
                    + {gun?.name || id}
                  </Tag>
                )
              })}
            </Space>
            {hint && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {hint}
              </Typography.Text>
            )}
          </>
        ) : (
          <Select
            showSearch
            style={{ width: '100%' }}
            value={selectedGunId}
            searchValue={searchValue}
            onSearch={setSearchValue}
            onDropdownVisibleChange={setDropdownOpen}
            onChange={(v) => { onGunChange(v); setSearchValue('') }}
            onKeyDown={(e) => { if (e.key === ' ' && dropdownOpen) setSearchValue(prev => prev + ' ') }}
            labelRender={(item) => (
              dropdownOpen && searchValue
                ? <span style={{ visibility: 'hidden' }}>{item.label}</span>
                : <span>{item.label}</span>
            )}
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
        )}
      </Space>
    </Card>
  )
}
