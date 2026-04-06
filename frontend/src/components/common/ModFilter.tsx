import { useTranslation } from 'react-i18next'
import { Collapse, Select, Space, Tag, Button, Divider, theme, Typography } from 'antd'
import { PlusOutlined, MinusOutlined } from '@ant-design/icons'
import type { ModInfo, ModCategoryOption } from '../../api/client'

const { useToken } = theme
const { Text } = Typography

const hintStyle = { fontSize: 12, lineHeight: 1.45, display: 'block' as const }

interface ModFilterProps {
  availableMods: ModInfo[]
  loadingMods: boolean
  modCategoryOptions: ModCategoryOption[]
  includedCategories: string[]
  excludedCategories: string[]
  onIncludedCategoriesChange: (v: string[]) => void
  onExcludedCategoriesChange: (v: string[]) => void
  includedModIds: string[]
  excludedModIds: string[]
  onIncludedModIdsChange: (v: string[]) => void
  onExcludedModIdsChange: (v: string[]) => void
  categorySearch: string
  onCategorySearchChange: (v: string) => void
  modSearch: string
  onModSearchChange: (v: string) => void
}

export function ModFilter({
  availableMods,
  loadingMods,
  modCategoryOptions,
  includedCategories,
  excludedCategories,
  onIncludedCategoriesChange,
  onExcludedCategoriesChange,
  includedModIds,
  excludedModIds,
  onIncludedModIdsChange,
  onExcludedModIdsChange,
  categorySearch,
  onCategorySearchChange,
  modSearch,
  onModSearchChange,
}: ModFilterProps) {
  const { t } = useTranslation()
  const { token } = useToken()
  const eligibleCategories = modCategoryOptions.filter(
    o => !includedCategories.includes(o.id) && !excludedCategories.includes(o.id),
  )
  const q = categorySearch.trim().toLowerCase()
  const searchedCategories = q
    ? eligibleCategories.filter(o => o.name.toLowerCase().includes(q))
    : eligibleCategories
  const searchedMods = modSearch ? availableMods.filter(m => m.name.toLowerCase().includes(modSearch.toLowerCase()) && !includedModIds.includes(m.id) && !excludedModIds.includes(m.id)).slice(0, 10) : []
  return (
    <Collapse size="small" items={[
      {
        key: 'mods',
        label: <span style={{ userSelect: 'none' }}>{t('sidebar.include_exclude')}</span>,
        children: (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Text type="secondary" style={hintStyle}>
              {t('sidebar.mod_filter_categories_hint')}
            </Text>
            <Select
              showSearch
              virtual
              style={{ width: '100%' }}
              placeholder={t('sidebar.require_categories')}
              value={null}
              searchValue={categorySearch}
              onSearch={onCategorySearchChange}
              onSelect={(v) => { if (v) { onIncludedCategoriesChange([...includedCategories, v]); onCategorySearchChange('') } }}
              filterOption={false}
              notFoundContent={null}
              listHeight={320}
              options={searchedCategories.map(o => ({ value: o.id, label: o.name }))}
              optionRender={(option) => (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{option.label}</span>
                  <Space size={4}>
                    <Button size="small" type="text" icon={<PlusOutlined />} onClick={(e) => { e.stopPropagation(); onIncludedCategoriesChange([...includedCategories, option.value as string]); onCategorySearchChange('') }} style={{ color: token.colorSuccess }} />
                    <Button size="small" type="text" icon={<MinusOutlined />} onClick={(e) => { e.stopPropagation(); onExcludedCategoriesChange([...excludedCategories, option.value as string]); onCategorySearchChange('') }} style={{ color: token.colorError }} />
                  </Space>
                </div>
              )}
            />
            <Space wrap>
              {includedCategories.map(catId => (
                <Tag key={catId} color="success" closable onClose={() => onIncludedCategoriesChange(includedCategories.filter(c => c !== catId))}>
                  {modCategoryOptions.find(o => o.id === catId)?.name ?? catId}
                </Tag>
              ))}
              {excludedCategories.map(catId => (
                <Tag key={catId} color="error" closable onClose={() => onExcludedCategoriesChange(excludedCategories.filter(c => c !== catId))}>
                  {modCategoryOptions.find(o => o.id === catId)?.name ?? catId}
                </Tag>
              ))}
            </Space>
            <Divider style={{ margin: '8px 0' }} />
            <Text type="secondary" style={hintStyle}>
              {t('sidebar.mod_filter_mods_hint')}
            </Text>
            <Select
              showSearch
              style={{ width: '100%' }}
              placeholder={t('sidebar.require_items')}
              value={null}
              searchValue={modSearch}
              onSearch={onModSearchChange}
              onSelect={(v) => { if (v) { onIncludedModIdsChange([...includedModIds, v]); onModSearchChange('') } }}
              filterOption={false}
              notFoundContent={null}
              loading={loadingMods}
              options={searchedMods.map(m => ({ value: m.id, label: m.name, icon: m.icon }))}
              optionRender={(option) => {
                const mod = searchedMods.find(m => m.id === option.value)
                return (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Space>
                      {mod?.icon && <img src={mod.icon} alt="" style={{ width: 24, height: 24, objectFit: 'contain' }} />}
                      <span>{option.label}</span>
                    </Space>
                    <Space size={4}>
                      <Button size="small" type="text" icon={<PlusOutlined />} onClick={(e) => { e.stopPropagation(); onIncludedModIdsChange([...includedModIds, option.value as string]); onModSearchChange('') }} style={{ color: token.colorSuccess }} />
                      <Button size="small" type="text" icon={<MinusOutlined />} onClick={(e) => { e.stopPropagation(); onExcludedModIdsChange([...excludedModIds, option.value as string]); onModSearchChange('') }} style={{ color: token.colorError }} />
                    </Space>
                  </div>
                )
              }}
            />
            <Space wrap>
              {includedModIds.map(id => <Tag key={id} color="success" closable onClose={() => onIncludedModIdsChange(includedModIds.filter(i => i !== id))}>{availableMods.find(m => m.id === id)?.name}</Tag>)}
              {excludedModIds.map(id => <Tag key={id} color="error" closable onClose={() => onExcludedModIdsChange(excludedModIds.filter(i => i !== id))}>{availableMods.find(m => m.id === id)?.name}</Tag>)}
            </Space>
          </Space>
        ),
      },
    ]} />
  )
}
