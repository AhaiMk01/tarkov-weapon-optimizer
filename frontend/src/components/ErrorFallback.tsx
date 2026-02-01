import type { FallbackProps } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'

export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const { t } = useTranslation()
  const errorMessage = error instanceof Error ? error.message : String(error)
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full bg-zinc-900 border border-zinc-700 rounded-xl p-6 text-center">
        <h1 className="text-xl font-bold text-red-500 mb-4">{t('error.application_error', 'Application Error')}</h1>
        <p className="text-zinc-400 mb-4">{t('error.something_went_wrong', 'Something went wrong. Please try refreshing the page.')}</p>
        <pre className="text-xs bg-zinc-950 p-3 rounded overflow-x-auto text-red-400 mb-4">
          {errorMessage}
        </pre>
        <button
          onClick={() => {
            resetErrorBoundary()
            window.location.reload()
          }}
          className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
        >
          {t('error.refresh_page', 'Refresh Page')}
        </button>
      </div>
    </div>
  )
}
