import { useMemo } from 'react'
import { Modal, Tabs, Typography, Card, theme, Space, Alert } from 'antd'
import { useTranslation } from 'react-i18next'
import {
  ThunderboltOutlined,
  AimOutlined,
  CompassOutlined,
  ShoppingOutlined,
  BulbOutlined,
} from '@ant-design/icons'
import katex from 'katex'
import 'katex/dist/katex.min.css'

const { Paragraph, Text } = Typography
const { useToken } = theme

function MathBlock({ math, display = true }: { math: string; display?: boolean }) {
  const { token } = useToken()
  const html = useMemo(() => {
    try {
      return katex.renderToString(math, { displayMode: display, throwOnError: false })
    } catch {
      return math
    }
  }, [math, display])

  return (
    <div
      style={{
        background: token.colorFillAlter,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusSM,
        padding: display ? '10px 16px' : '2px 6px',
        margin: display ? '10px 0' : '0 4px',
        overflowX: 'auto',
        textAlign: display ? 'center' : 'left',
        color: token.colorText,
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

interface MethodologyModalProps {
  open: boolean
  onClose: () => void
}

export function MethodologyModal({ open, onClose }: MethodologyModalProps) {
  const { t } = useTranslation()
  const { token } = useToken()

  const cardStyle = {
    background: token.colorBgContainer,
    borderColor: token.colorBorderSecondary,
    marginBottom: 16,
    borderRadius: token.borderRadiusLG,
  }

  const items = [
    {
      key: 'mechanics',
      label: (
        <span>
          <AimOutlined /> {t('methodology.tab_mechanics')}
        </span>
      ),
      children: (
        <div style={{ padding: '8px 4px' }}>
          <Card size="small" style={cardStyle} title={<Text strong>{t('methodology.ergo_title')}</Text>}>
            <Paragraph>{t('methodology.ergo_desc')}</Paragraph>
          </Card>

          <Card size="small" style={cardStyle} title={<Text strong>{t('methodology.true_ergo_title')}</Text>}>
            <Paragraph>{t('methodology.true_ergo_desc_1')}</Paragraph>
            <MathBlock math="W(1-E/100) > 3 \quad \Longleftrightarrow \quad \text{Overswing}" />
            <Paragraph>{t('methodology.true_ergo_desc_2')}</Paragraph>
            <MathBlock math="\text{TED} = E - \max(0, 100 - 300/W), \quad W > 0" />
            <ul style={{ paddingLeft: 20, marginBottom: 8 }}>
              <li>
                <Text type="success" strong>{t('methodology.ted_positive')}</Text>
              </li>
              <li>
                <Text type="danger" strong>{t('methodology.ted_negative')}</Text>
              </li>
            </ul>
            <Paragraph style={{ marginBottom: 0 }}>
              <Text strong>{t('methodology.true_ergo_light_label')}</Text>
              <MathBlock math="W \leq 3\text{ kg} \quad \Longrightarrow \quad \text{TED} = E" />
            </Paragraph>
          </Card>

          <Card size="small" style={cardStyle} title={<Text strong>{t('methodology.equip_penalty_title')}</Text>}>
            <Paragraph>{t('methodology.equip_penalty_desc_1')}</Paragraph>
            <MathBlock math="E = \operatorname{clamp}\left(\operatorname{clamp}(\text{Ergo}_{\text{raw}},0,100)(1+b),0,100\right)" />
            <Paragraph style={{ marginBottom: 0 }}>{t('methodology.equip_penalty_desc_2')}</Paragraph>
          </Card>

          <Card size="small" style={cardStyle} title={<Text strong>{t('methodology.moa_title')}</Text>}>
            <Paragraph>{t('methodology.moa_desc')}</Paragraph>
            <MathBlock math="\text{MOA} = \text{effectiveBaseCOI} \cdot \left(1 - \frac{\sum \text{accuracy\_mod}}{100}\right) \cdot \frac{100}{2.9089}" />
            <Paragraph style={{ marginBottom: 0 }}>{t('methodology.moa_barrel_note')}</Paragraph>
          </Card>

          <Card size="small" style={cardStyle} title={<Text strong>{t('methodology.moa_provisional_title')}</Text>}>
            <Paragraph style={{ marginBottom: 0 }}>{t('methodology.moa_provisional_desc')}</Paragraph>
          </Card>

          <Card size="small" style={cardStyle} title={<Text strong>{t('methodology.moa_floor_title')}</Text>}>
            <Paragraph style={{ marginBottom: 0 }}>{t('methodology.moa_floor_desc')}</Paragraph>
          </Card>
        </div>
      ),
    },
    {
      key: 'algorithms',
      label: (
        <span>
          <ThunderboltOutlined /> {t('methodology.tab_algorithms')}
        </span>
      ),
      children: (
        <div style={{ padding: '8px 4px' }}>
          <Card size="small" style={cardStyle} title={<Text strong>{t('methodology.mip_title')}</Text>}>
            <Paragraph>{t('methodology.mip_desc')}</Paragraph>
          </Card>

          <Card size="small" style={cardStyle} title={<Text strong>{t('methodology.sweet_spot_title')}</Text>}>
            <Alert
              type="info"
              showIcon
              message={t('methodology.sweet_spot_alert_title')}
              description={t('methodology.sweet_spot_alert_desc')}
              style={{ marginBottom: 12 }}
            />
            <Paragraph>{t('methodology.sweet_spot_how')}</Paragraph>
            <MathBlock math="\min \; \max \left( \lambda_E g_E, \; \lambda_R g_R, \; \lambda_P g_P \right) + \rho \sum_{i \in \{E,R,P\}} \lambda_i g_i" />
            <Paragraph style={{ marginBottom: 0 }}>{t('methodology.sweet_spot_contour')}</Paragraph>
          </Card>

          <Card size="small" style={cardStyle} title={<Text strong>{t('methodology.explore_title')}</Text>}>
            <Paragraph>{t('methodology.explore_desc')}</Paragraph>
          </Card>

          <Card size="small" style={cardStyle} title={<Text strong>{t('methodology.nonlinear_bounds_title')}</Text>}>
            <Paragraph>{t('methodology.nonlinear_bounds_desc')}</Paragraph>
          </Card>

          <Card size="small" style={cardStyle} title={<Text strong>{t('methodology.precision_title')}</Text>}>
            <Paragraph>{t('methodology.precision_intro')}</Paragraph>
            <ul style={{ paddingLeft: 20, marginBottom: 0 }}>
              <li>{t('methodology.precision_fast')}</li>
              <li>{t('methodology.precision_precise')}</li>
              <li>{t('methodology.precision_auto')}</li>
            </ul>
          </Card>

          <Card size="small" style={cardStyle} title={<Text strong>{t('methodology.status_title')}</Text>}>
            <Paragraph>{t('methodology.status_intro')}</Paragraph>
            <ul style={{ paddingLeft: 20, marginBottom: 0 }}>
              <li>{t('methodology.status_certified')}</li>
              <li>{t('methodology.status_approximate')}</li>
              <li>{t('methodology.status_feasible')}</li>
              <li>{t('methodology.status_incomplete')}</li>
            </ul>
          </Card>
        </div>
      ),
    },
    {
      key: 'economy',
      label: (
        <span>
          <ShoppingOutlined /> {t('methodology.tab_data')}
        </span>
      ),
      children: (
        <div style={{ padding: '8px 4px' }}>
          <Card size="small" style={cardStyle} title={<Text strong>{t('methodology.data_source_title')}</Text>}>
            <Paragraph>{t('methodology.data_source_desc')}</Paragraph>
            <ul style={{ paddingLeft: 20, marginBottom: 8 }}>
              <li>
                <Text strong>{t('methodology.flea_label')}</Text> {t('methodology.flea_desc')}
              </li>
              <li>
                <Text strong>{t('methodology.trader_label')}</Text> {t('methodology.trader_desc')}
              </li>
              <li>
                <Text strong>{t('methodology.barter_label')}</Text> {t('methodology.barter_desc')}
              </li>
            </ul>
          </Card>

          <Card size="small" style={cardStyle} title={<Text strong>{t('methodology.presets_title')}</Text>}>
            <Paragraph>{t('methodology.presets_desc')}</Paragraph>
          </Card>

          <Card size="small" style={cardStyle} title={<Text strong>{t('methodology.cache_title')}</Text>}>
            <Paragraph>{t('methodology.cache_desc')}</Paragraph>
          </Card>
        </div>
      ),
    },
    {
      key: 'glossary',
      label: (
        <span>
          <CompassOutlined /> {t('methodology.tab_glossary')}
        </span>
      ),
      children: (
        <div style={{ padding: '8px 4px' }}>
          <Space orientation="vertical" style={{ width: '100%' }} size="middle">
            <Card size="small" style={cardStyle}>
              <Text strong style={{ color: token.colorPrimary }}>{t('methodology.glossary_ted_title')}</Text>
              <Paragraph style={{ marginTop: 4, marginBottom: 0 }}>{t('methodology.glossary_ted_desc')}</Paragraph>
            </Card>


            <Card size="small" style={cardStyle}>
              <Text strong style={{ color: token.colorPrimary }}>{t('methodology.glossary_moa_title')}</Text>
              <Paragraph style={{ marginTop: 4, marginBottom: 0 }}>{t('methodology.glossary_moa_desc')}</Paragraph>
            </Card>

            <Card size="small" style={cardStyle}>
              <Text strong style={{ color: token.colorPrimary }}>{t('methodology.glossary_tch_title')}</Text>
              <Paragraph style={{ marginTop: 4, marginBottom: 0 }}>{t('methodology.glossary_tch_desc')}</Paragraph>
            </Card>

            <Card size="small" style={cardStyle}>
              <Text strong style={{ color: token.colorPrimary }}>{t('methodology.glossary_forge_title')}</Text>
              <Paragraph style={{ marginTop: 4, marginBottom: 0 }}>{t('methodology.glossary_forge_desc')}</Paragraph>
            </Card>

            <Card size="small" style={cardStyle}>
              <Text strong style={{ color: token.colorPrimary }}>{t('methodology.glossary_precision_title')}</Text>
              <Paragraph style={{ marginTop: 4, marginBottom: 0 }}>{t('methodology.glossary_precision_desc')}</Paragraph>
            </Card>

            <Card size="small" style={cardStyle}>
              <Text strong style={{ color: token.colorPrimary }}>{t('methodology.glossary_status_title')}</Text>
              <Paragraph style={{ marginTop: 4, marginBottom: 0 }}>{t('methodology.glossary_status_desc')}</Paragraph>
            </Card>
          </Space>
        </div>
      ),
    },
  ]

  return (
    <Modal
      title={
        <Space size={8}>
          <BulbOutlined style={{ color: token.colorPrimary }} />
          <span>{t('methodology.title')}</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(94vw, 1080px)"
      styles={{ body: { maxHeight: '76vh', overflowY: 'auto', padding: '16px 24px' } }}
    >
      <Tabs defaultActiveKey="mechanics" items={items} />
    </Modal>
  )
}
