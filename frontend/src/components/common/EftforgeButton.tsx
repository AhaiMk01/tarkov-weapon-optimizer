import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Tooltip } from 'antd'
import { ExportOutlined } from '@ant-design/icons'
import type { Placement } from '../../api/client'
import { eftforgeRefusalKey, eftforgeUrl, projectToEftforgeV1 } from './eftforgeExport'

interface EftforgeButtonProps {
  weaponId: string | undefined
  /** The internal manifest of the build (`slot_pairs`). It is never sent as it is: it goes through the checked EFTForge v1 projection. */
  placements: readonly Placement[] | undefined
  size?: 'small' | 'middle'
}

/**
 * Opens a build in EFTForge through the checked v1 projection (`eftforgeExport.ts`). A build whose placements the format cannot represent
 * unambiguously (a slot or a template used more than once, a detached placement) gets a DISABLED button with the localized reason; the in-app
 * manifest, copy and shopping list are unaffected. Nothing is rendered for a build with no placements.
 */
export function EftforgeButton({ weaponId, placements, size = 'small' }: EftforgeButtonProps) {
  const { t } = useTranslation()
  const projection = useMemo(() => projectToEftforgeV1(weaponId, placements), [weaponId, placements])
  if (!weaponId || !placements || placements.length === 0) return null
  if (projection.ok) {
    return (
      <Button size={size} icon={<ExportOutlined />} onClick={() => window.open(eftforgeUrl(projection.payload), '_blank', 'noopener')}>
        EFTForge
      </Button>
    )
  }
  return (
    <Tooltip
      title={
        <div>
          <div>{t(eftforgeRefusalKey(projection.refusal))}</div>
          <div style={{ marginTop: 4, opacity: 0.85 }}>{t('export.eftforge_unaffected')}</div>
        </div>
      }
    >
      {/* A disabled button swallows hover, so the tooltip sits on a wrapper. */}
      <span style={{ display: 'inline-block', cursor: 'not-allowed' }}>
        <Button size={size} icon={<ExportOutlined />} disabled style={{ pointerEvents: 'none' }}>
          EFTForge
        </Button>
      </span>
    </Tooltip>
  )
}
