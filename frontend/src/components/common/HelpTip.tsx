import { useTranslation } from 'react-i18next'
import { Tooltip, theme } from 'antd'
import { InfoCircleOutlined, QuestionCircleOutlined } from '@ant-design/icons'

/**
 * Help icon that keyboard and screen-reader users can reach. Its click and key
 * events stop here so it is safe inside a Collapse header, like ResetButton.
 */
export function HelpTip({
  title,
  icon = 'question',
  tone = 'secondary',
  size = 12,
}: {
  title: React.ReactNode
  icon?: 'question' | 'info'
  tone?: 'secondary' | 'tertiary'
  size?: number
}) {
  const { t } = useTranslation()
  const { token } = theme.useToken()
  const Icon = icon === 'info' ? InfoCircleOutlined : QuestionCircleOutlined
  return (
    <Tooltip title={title} trigger={['hover', 'focus']}>
      <button
        type="button"
        aria-label={t('ui.help')}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
        style={{
          display: 'inline-flex',
          verticalAlign: '-0.125em',
          margin: 0,
          padding: 0,
          border: 0,
          background: 'none',
          font: 'inherit',
          lineHeight: 1,
          cursor: 'help',
          color: tone === 'tertiary' ? token.colorTextTertiary : token.colorTextSecondary,
          fontSize: size,
        }}
      >
        <Icon />
      </button>
    </Tooltip>
  )
}
