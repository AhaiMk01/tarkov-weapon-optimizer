import type { ReactNode } from 'react'
import { Grid } from 'antd'

interface ResponsiveLayoutProps {
  left: ReactNode
  right: ReactNode
}

export function ResponsiveLayout({ left, right }: ResponsiveLayoutProps) {
  const screens = Grid.useBreakpoint()
  const isDesktop = screens.lg
  return (
    <div className={!isDesktop ? "custom-scrollbar" : ""} style={{
      display: 'grid',
      gridTemplateColumns: isDesktop ? '360px minmax(0, 1fr)' : 'minmax(0, 1fr)',
      gap: 16,
      height: isDesktop ? '100%' : 'auto',
      flex: isDesktop ? 1 : 'none',
      minHeight: 0,
      overflowY: isDesktop ? 'hidden' : 'visible'
    }}>
      <div className={isDesktop ? "custom-scrollbar" : ""} style={{ minWidth: 0, height: isDesktop ? '100%' : 'auto', overflowY: isDesktop ? 'auto' : 'visible', paddingRight: isDesktop ? 6 : 0, paddingBottom: 12 }}>
        {left}
      </div>
      <div className={isDesktop ? "custom-scrollbar" : ""} style={{ minWidth: 0, height: isDesktop ? '100%' : 'auto', overflowY: isDesktop ? 'auto' : 'visible', paddingRight: isDesktop ? 6 : 0, paddingBottom: 12 }}>
        {right}
      </div>
    </div>
  )
}
