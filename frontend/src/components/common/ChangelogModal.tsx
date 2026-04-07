import { useEffect, useState } from 'react'
import { Modal, Typography, Spin } from 'antd'

const { Title, Text } = Typography

interface Section {
  title: string
  items: { category: string; entries: string[] }[]
}

function parseChangelog(raw: string): Section[] {
  const lines = raw.split('\n')
  const sections: Section[] = []
  let current: Section | null = null
  let currentCategory: Section['items'][0] | null = null

  for (const line of lines) {
    if (line.startsWith('## ')) {
      current = { title: line.replace('## ', ''), items: [] }
      sections.push(current)
      currentCategory = null
    } else if (line.startsWith('### ') && current) {
      currentCategory = { category: line.replace('### ', ''), entries: [] }
      current.items.push(currentCategory)
    } else if (line.startsWith('- ') && currentCategory) {
      currentCategory.entries.push(line.replace('- ', ''))
    }
  }
  return sections
}

interface ChangelogModalProps {
  open: boolean
  onClose: () => void
}

export function ChangelogModal({ open, onClose }: ChangelogModalProps) {
  const [sections, setSections] = useState<Section[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open && sections.length === 0) {
      setLoading(true)
      fetch(`${import.meta.env.BASE_URL}CHANGELOG.md`)
        .then(r => r.text())
        .then(text => setSections(parseChangelog(text)))
        .finally(() => setLoading(false))
    }
  }, [open, sections.length])

  return (
    <Modal
      title="Changelog"
      open={open}
      onCancel={onClose}
      footer={null}
      width={600}
      styles={{ body: { maxHeight: '60vh', overflowY: 'auto' } }}
    >
      {loading ? <Spin /> : sections.map((section, i) => (
        <div key={i} style={{ marginBottom: 16 }}>
          <Title level={5} style={{ marginBottom: 8 }}>{section.title}</Title>
          {section.items.map((cat, j) => (
            <div key={j} style={{ marginBottom: 8 }}>
              <Text strong>{cat.category}</Text>
              <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
                {cat.entries.map((entry, k) => (
                  <li key={k}><Text>{entry}</Text></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </Modal>
  )
}
