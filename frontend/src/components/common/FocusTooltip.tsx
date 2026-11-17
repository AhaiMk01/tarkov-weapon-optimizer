import { useEffect, useState } from 'react'
import { Tooltip } from 'antd'
import type { TooltipProps } from 'antd'

/**
 * A tooltip that also opens on keyboard focus. antd has no Escape handling, so a
 * focus-opened tooltip would cover nearby controls until focus leaves. Escape
 * closes it here, and stops there so it does not also close a surrounding modal.
 */
export function FocusTooltip(props: TooltipProps) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open])
  return <Tooltip trigger={['hover', 'focus']} {...props} open={open && !!props.title} onOpenChange={setOpen} />
}
