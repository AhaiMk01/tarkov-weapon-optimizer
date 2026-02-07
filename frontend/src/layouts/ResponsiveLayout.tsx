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
    <div style={{
      display: 'grid',
      gridTemplateColumns: isDesktop ? '360px minmax(0, 1fr)' : 'minmax(0, 1fr)',
      gap: 16,
    }}>
      <div style={{ minWidth: 0 }}>{left}</div>
      <div style={{ minWidth: 0 }}>{right}</div>
    </div>
  )
}
