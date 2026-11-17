import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Collapse, Select, Space, Tag, Button, Divider, Tooltip, theme, Typography } from 'antd'
import { PlusOutlined, MinusOutlined, AppstoreOutlined, CloseOutlined } from '@ant-design/icons'
import type { ModInfo, ModCompatibility, ModCategoryOption } from '../../api/client'
import { ModGallery } from './ModGallery'
import { computeBlockedModIds } from './modBlocking'
import { ResetButton } from './ResetButton'

const { useToken } = theme
const { Text } = Typography

const hintStyle = { fontSize: 12, lineHeight: 1.45, display: 'block' as const }

interface ModFilterProps {
  availableMods: ModInfo[]
  modCompat?: ModCompatibility
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
  /** Move one part in/out of required / banned, keeping the two lists disjoint.
   *  Owned by App so the build manifest's lock/ban buttons follow the same rule. */
  onToggleModInclude: (id: string) => void
  onToggleModExclude: (id: string) => void
  categorySearch: string
  onCategorySearchChange: (v: string) => void
  modSearch: string
  onModSearchChange: (v: string) => void
}

/**
 * A chosen category or part. The label is a button that flips it between
 * required and banned; the close icon is a button too, because antd's own is a
 * bare span that keyboard users cannot reach. `canToggle` is false for a banned
 * part that can no longer be required.
 */
function ToggleTag({ banned, label, name, canToggle, onToggle, onClose }: {
  banned: boolean
  label: string | undefined
  name: string
  canToggle: boolean
  onToggle: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const tip = t(banned ? 'ui.tag_tip_to_require' : 'ui.tag_tip_to_ban')
  return (
    <Tag
      color={banned ? 'error' : 'success'}
      closable
      closeIcon={
        <button
          type="button"
          aria-label={t('ui.remove_tag', { name })}
          style={{ padding: 0, border: 0, background: 'none', font: 'inherit', lineHeight: 'inherit' }}
        >
          <CloseOutlined />
        </button>
      }
      onClose={onClose}
    >
      {canToggle ? (
        <Tooltip title={tip} trigger={['hover', 'focus']}>
          <button
            type="button"
            aria-label={`${name}: ${tip}`}
            onClick={onToggle}
            style={{ padding: 0, border: 0, background: 'none', font: 'inherit', color: 'inherit', cursor: 'pointer' }}
          >
            {label}
          </button>
        </Tooltip>
      ) : label}
    </Tag>
  )
}

export function ModFilter({
  availableMods,
  modCompat,
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
  onToggleModInclude,
  onToggleModExclude,
  categorySearch,
  onCategorySearchChange,
  modSearch,
  onModSearchChange,
}: ModFilterProps) {
  const { t } = useTranslation()
  const { token } = useToken()
  const [galleryOpen, setGalleryOpen] = useState(false)

  // One blocked set for both ways of requiring a part, so the dropdown cannot
  // add something the gallery has greyed out.
  const blockedIds = useMemo(
    () => computeBlockedModIds(modCompat, includedModIds, availableMods),
    [modCompat, includedModIds, availableMods],
  )

  const searchedMods = modSearch ? availableMods.filter(m => m.name.toLowerCase().includes(modSearch.toLowerCase()) && !includedModIds.includes(m.id) && !excludedModIds.includes(m.id)).slice(0, 10) : []

  return (
    <>
    <Collapse size="small" items={[
      {
        key: 'mods',
        label: <span style={{ userSelect: 'none' }}>{t('sidebar.include_exclude')}</span>,
        extra: <ResetButton onReset={() => { onIncludedCategoriesChange([]); onExcludedCategoriesChange([]); onIncludedModIdsChange([]); onExcludedModIdsChange([]); onCategorySearchChange(''); onModSearchChange('') }} />,
        children: (
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Text type="secondary" style={hintStyle}>
              {t('sidebar.mod_filter_categories_hint')}
            </Text>
            <Select
              showSearch
              style={{ width: '100%' }}
              aria-label={t('sidebar.require_categories')}
              placeholder={t('sidebar.require_categories')}
              allowClear
              value={null}
              searchValue={categorySearch}
              onSearch={onCategorySearchChange}
              onSelect={(id) => {
                if (!id) return
                if (!includedCategories.includes(id) && !excludedCategories.includes(id)) {
                  onIncludedCategoriesChange([...includedCategories, id])
                }
                onCategorySearchChange('')
              }}
              options={modCategoryOptions.map(o => ({
                value: o.id,
                label: (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{o.name}</span>
                    <Space size={4}>
                      {!includedCategories.includes(o.id) && !excludedCategories.includes(o.id) && (
                        <>
                          <Button size="small" type="text" icon={<PlusOutlined />} aria-label={`${t('ui.lock_action_tooltip_add')}: ${o.name}`} onClick={(e) => { e.stopPropagation(); onIncludedCategoriesChange([...includedCategories, o.id]); onCategorySearchChange('') }} style={{ color: token.colorSuccess }} />
                          <Button size="small" type="text" icon={<MinusOutlined />} aria-label={`${t('ui.ban_action_tooltip_add')}: ${o.name}`} onClick={(e) => { e.stopPropagation(); onExcludedCategoriesChange([...excludedCategories, o.id]); onCategorySearchChange('') }} style={{ color: token.colorError }} />
                        </>
                      )}
                    </Space>
                  </div>
                ),
                name: o.name,
              }))}
              filterOption={(input, option) => (option?.name as string ?? '').toLowerCase().includes(input.toLowerCase())}
            />
            <Space wrap>
              {includedCategories.map(catId => {
                const name = modCategoryOptions.find(o => o.id === catId)?.name || catId
                return (
                  <ToggleTag
                    key={catId}
                    banned={false}
                    label={`+ ${name}`}
                    name={name}
                    canToggle
                    onToggle={() => { onIncludedCategoriesChange(includedCategories.filter(c => c !== catId)); onExcludedCategoriesChange([...excludedCategories, catId]) }}
                    onClose={() => onIncludedCategoriesChange(includedCategories.filter(c => c !== catId))}
                  />
                )
              })}
              {excludedCategories.map(catId => {
                const name = modCategoryOptions.find(o => o.id === catId)?.name || catId
                return (
                  <ToggleTag
                    key={catId}
                    banned
                    label={`- ${name}`}
                    name={name}
                    canToggle
                    onToggle={() => { onExcludedCategoriesChange(excludedCategories.filter(c => c !== catId)); onIncludedCategoriesChange([...includedCategories, catId]) }}
                    onClose={() => onExcludedCategoriesChange(excludedCategories.filter(c => c !== catId))}
                  />
                )
              })}
            </Space>
            <Divider style={{ margin: '8px 0' }} />
            <Text type="secondary" style={hintStyle}>
              {t('sidebar.mod_filter_mods_hint')}
            </Text>
            <Button
              block
              icon={<AppstoreOutlined />}
              onClick={() => setGalleryOpen(true)}
              disabled={availableMods.length === 0}
              loading={loadingMods}
            >
              {t('gallery.browse_mods')}
            </Button>
            <Select
              showSearch
              style={{ width: '100%' }}
              aria-label={t('sidebar.require_items')}
              placeholder={t('sidebar.require_items')}
              value={null}
              searchValue={modSearch}
              onSearch={onModSearchChange}
              onSelect={(v) => { if (v) { onIncludedModIdsChange([...includedModIds, v]); onModSearchChange('') } }}
              filterOption={false}
              notFoundContent={null}
              loading={loadingMods}
              options={searchedMods.map(m => ({ value: m.id, label: m.name, icon: m.icon, disabled: blockedIds.has(m.id) }))}
              optionRender={(option) => {
                const mod = searchedMods.find(m => m.id === option.value)
                const blocked = blockedIds.has(option.value as string)
                return (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} title={blocked ? t('gallery.mod_blocked') : undefined}>
                    <Space>
                      {mod?.icon && <img src={mod.icon} alt="" style={{ width: 24, height: 24, objectFit: 'contain' }} />}
                      <span>{option.label}</span>
                    </Space>
                    <Space size={4}>
                      {/* Blocked parts can still be banned, just not required. */}
                      {!blocked && <Button size="small" type="text" icon={<PlusOutlined />} aria-label={`${t('ui.lock_action_tooltip_add')}: ${mod?.name ?? ''}`} onClick={(e) => { e.stopPropagation(); onIncludedModIdsChange([...includedModIds, option.value as string]); onModSearchChange('') }} style={{ color: token.colorSuccess }} />}
                      <Button size="small" type="text" icon={<MinusOutlined />} aria-label={`${t('ui.ban_action_tooltip_add')}: ${mod?.name ?? ''}`} onClick={(e) => { e.stopPropagation(); onExcludedModIdsChange([...excludedModIds, option.value as string]); onModSearchChange('') }} style={{ color: token.colorError }} />
                    </Space>
                  </div>
                )
              }}
            />
            <Space wrap>
              {includedModIds.map(id => {
                const modName = availableMods.find(m => m.id === id)?.name
                return <ToggleTag key={id} banned={false} label={modName} name={modName ?? id} canToggle onToggle={() => onToggleModExclude(id)} onClose={() => onIncludedModIdsChange(includedModIds.filter(i => i !== id))} />
              })}
              {excludedModIds.map(id => {
                const modName = availableMods.find(m => m.id === id)?.name
                return <ToggleTag key={id} banned label={modName} name={modName ?? id} canToggle={!blockedIds.has(id)} onToggle={() => onToggleModInclude(id)} onClose={() => onExcludedModIdsChange(excludedModIds.filter(i => i !== id))} />
              })}
            </Space>
          </Space>
        ),
      },
    ]} />
    <ModGallery
      open={galleryOpen}
      onClose={() => setGalleryOpen(false)}
      mods={availableMods}
      blockedIds={blockedIds}
      loading={loadingMods}
      includedIds={includedModIds}
      excludedIds={excludedModIds}
      onToggleInclude={onToggleModInclude}
      onToggleExclude={onToggleModExclude}
      onClearAll={() => { onIncludedModIdsChange([]); onExcludedModIdsChange([]) }}
    />
    </>
  )
}
