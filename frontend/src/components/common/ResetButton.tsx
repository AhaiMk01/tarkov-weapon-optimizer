import { useTranslation } from 'react-i18next'
import { Button, Tooltip } from 'antd'
import { UndoOutlined } from '@ant-design/icons'

/** Reset control for a Collapse header; its click and key events must not toggle the panel. */
export function ResetButton({ onReset, disabled }: { onReset: () => void; disabled?: boolean }) {
  const { t } = useTranslation()
  return (
    <Tooltip title={t('ui.reset')}>
      <Button
        type="text"
        size="small"
        icon={<UndoOutlined />}
        aria-label={t('ui.reset')}
        disabled={disabled}
        onClick={e => { e.stopPropagation(); onReset() }}
        onKeyDown={e => e.stopPropagation()}
      />
    </Tooltip>
  )
}
