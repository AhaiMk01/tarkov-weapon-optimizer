import type { ReactNode } from 'react'
import { Card, Button, theme } from 'antd'

const { useToken } = theme

interface EmptyStateProps {
  icon: ReactNode
  title?: string
  description?: string
  buttonText: string
  buttonIcon: ReactNode
  loading: boolean
  disabled: boolean
  onAction: () => void
}

export function EmptyState({ icon, title, description, buttonText, buttonIcon, loading, disabled, onAction }: EmptyStateProps) {
  const { token } = useToken()
  return (
    <Card style={{ width: '100%' }}>
      <div style={{ textAlign: 'center', padding: '48px 24px' }}>
        <div style={{ fontSize: 64, color: token.colorTextQuaternary, marginBottom: 24 }}>{icon}</div>
        {title && <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>{title}</div>}
        {description && <div style={{ color: token.colorTextSecondary, marginBottom: 24 }}>{description}</div>}
        <Button type="primary" size="large" icon={buttonIcon} loading={loading} disabled={disabled} onClick={onAction}>{buttonText}</Button>
      </div>
    </Card>
  )
}
