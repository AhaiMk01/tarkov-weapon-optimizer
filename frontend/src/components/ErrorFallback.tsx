import { useTranslation } from 'react-i18next'
import { Button, Result } from 'antd'
import type { FallbackProps } from 'react-error-boundary'

export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const { t } = useTranslation()
  const errorMessage = error instanceof Error ? error.message : String(error)
  return (
    <Result
      status="error"
      title={t('error.title', '发生错误')}
      subTitle={errorMessage}
      extra={<Button type="primary" onClick={resetErrorBoundary}>{t('error.retry', '重试')}</Button>}
    />
  )
}
