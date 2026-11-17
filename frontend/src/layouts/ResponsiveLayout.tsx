import { useEffect, useRef, type ReactNode } from 'react'
import { Grid } from 'antd'
import { shouldRevealRight } from './revealRight'

interface ResponsiveLayoutProps {
  left: ReactNode
  right: ReactNode
  /** When this turns true while the panes are stacked, the right pane scrolls into view. */
  revealRight?: boolean
}

export function ResponsiveLayout({ left, right, revealRight = false }: ResponsiveLayoutProps) {
  const screens = Grid.useBreakpoint()
  const isDesktop = screens.lg
  const rightRef = useRef<HTMLDivElement>(null)
  const previous = useRef<boolean | undefined>(undefined)
  useEffect(() => {
    if (shouldRevealRight(previous.current, revealRight, !isDesktop)) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      rightRef.current?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
    }
    previous.current = revealRight
  }, [revealRight, isDesktop])
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isDesktop ? '360px minmax(0, 1fr)' : 'minmax(0, 1fr)',
      gap: 16,
      height: isDesktop ? '100%' : 'auto',
      flex: isDesktop ? 1 : 'none',
      minHeight: 0,
      overflowY: isDesktop ? 'hidden' : 'visible'
    }}>
      <div style={{ minWidth: 0, height: isDesktop ? '100%' : 'auto', overflowY: isDesktop ? 'auto' : 'visible', paddingRight: isDesktop ? 6 : 0, paddingBottom: 12 }}>
        {left}
      </div>
      <div ref={rightRef} style={{ minWidth: 0, height: isDesktop ? '100%' : 'auto', overflowY: isDesktop ? 'auto' : 'visible', paddingRight: isDesktop ? 6 : 0, paddingBottom: 12, scrollMarginTop: 8 }}>
        {right}
      </div>
    </div>
  )
}
