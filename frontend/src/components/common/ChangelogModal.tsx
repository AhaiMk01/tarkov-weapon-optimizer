import { useEffect, useState } from 'react'
import { Modal, Spin, theme } from 'antd'
import { useTranslation } from 'react-i18next'
import { marked } from 'marked'

const { useToken } = theme

interface ChangelogModalProps {
  open: boolean
  onClose: () => void
}

export function ChangelogModal({ open, onClose }: ChangelogModalProps) {
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(false)
  const { token } = useToken()

  useEffect(() => {
    if (open && !html) {
      setLoading(true)
      fetch(`${import.meta.env.BASE_URL}CHANGELOG.md`)
        .then(r => r.text())
        .then(text => {
          // Skip the "# Changelog" title and description line
          const body = text.replace(/^#\s+Changelog\s*\n+.*?\n/, '')
          setHtml(marked.parse(body, { async: false }) as string)
        })
        .finally(() => setLoading(false))
    }
  }, [open, html])

  const { t } = useTranslation()
  return (
    <Modal
      title={t('ui.changelog_title')}
      open={open}
      onCancel={onClose}
      footer={null}
      width={600}
      styles={{ body: { maxHeight: '60vh', overflowY: 'auto' } }}
    >
      {loading ? <Spin /> : (
        <div
          className="changelog-content"
          dangerouslySetInnerHTML={{ __html: html }}
          style={{
            color: token.colorText,
            fontSize: 14,
            lineHeight: 1.7,
          }}
        />
      )}
    </Modal>
  )
}
