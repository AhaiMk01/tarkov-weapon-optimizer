import type { ComponentProps, CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { theme } from 'antd'

type CopyNameProps = Omit<ComponentProps<'button'>, 'onClick' | 'children' | 'type'> & {
  name: string
  copy: (text: string) => void
}

/**
 * A name that copies itself when activated. A native button, so Enter and Space
 * work; it is reset to look like the surrounding text. Spreads the rest onto the
 * button so a wrapping Tooltip can attach its ref and handlers.
 */
export function CopyName({ name, copy, style, className, ...rest }: CopyNameProps) {
  const { t } = useTranslation()
  const { token } = theme.useToken()
  return (
    <button
      {...rest}
      type="button"
      className={className ? `copy-name ${className}` : 'copy-name'}
      aria-label={t('ui.copy_name', { name })}
      onClick={() => copy(name)}
      style={{
        '--copy-name-ring': token.colorPrimary,
        margin: 0,
        padding: 0,
        border: 0,
        background: 'none',
        font: 'inherit',
        color: 'inherit',
        textAlign: 'inherit',
        cursor: 'pointer',
        fontWeight: token.fontWeightStrong,
        ...style,
      } as CSSProperties}
    >
      {name}
    </button>
  )
}
