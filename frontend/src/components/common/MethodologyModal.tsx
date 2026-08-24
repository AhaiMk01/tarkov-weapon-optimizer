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

          <Card size="small" style={cardStyle} title={<Text strong>{t('methodology.evo_ergo_title')}</Text>}>
            <Paragraph>{t('methodology.evo_ergo_desc_1')}</Paragraph>
            <MathBlock math="W_{\text{threshold}}(E) = 0.0007556 \cdot E^2 + 0.02736 \cdot E + 2.9159\text{ kg}" />
            <Paragraph>{t('methodology.evo_ergo_desc_2')}</Paragraph>
            <MathBlock math="\text{EED} = -15 \cdot \left(W_{\text{actual}} - W_{\text{threshold}}(E)\right)" />
            <ul style={{ paddingLeft: 20, marginBottom: 8 }}>
              <li>
                <Text type="success" strong>{t('methodology.eed_positive')}</Text>
              </li>
              <li>
                <Text type="danger" strong>{t('methodology.eed_negative')}</Text>
              </li>
            </ul>
            <Paragraph style={{ marginBottom: 0 }}>
              <Text strong>{t('methodology.evo_ergo_score_label')}</Text>
              <MathBlock math="\text{EvoErgo} = \min(100, \text{Ergo}) - 15 \cdot W_{\text{kg}}" />
            </Paragraph>
          </Card>

          <Card size="small" style={cardStyle} title={<Text strong>{t('methodology.equip_penalty_title')}</Text>}>
            <Paragraph>{t('methodology.equip_penalty_desc_1')}</Paragraph>
            <MathBlock math="E_{\text{eff}} = \text{Ergo}_{\text{raw}} \cdot (1 + b) \quad (b \in [-0.40, 0])" />
            <Paragraph style={{ marginBottom: 0 }}>{t('methodology.equip_penalty_desc_2')}</Paragraph>
          </Card>

          <Card size="small" style={cardStyle} title={<Text strong>{t('methodology.moa_title')}</Text>}>
            <Paragraph>{t('methodology.moa_desc')}</Paragraph>
            <MathBlock math="\text{MOA} = \text{effectiveBaseCOI} \cdot \left(1 - \frac{\sum \text{accuracy\_mod}}{100}\right) \cdot 34.3" />
            <Paragraph style={{ marginBottom: 0 }}>{t('methodology.moa_barrel_note')}</Paragraph>
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

          <Card size="small" style={cardStyle} title={<Text strong>{t('methodology.overswing_cuts_title')}</Text>}>
            <Paragraph>{t('methodology.overswing_cuts_desc')}</Paragraph>
          </Card>

          <Card size="small" style={cardStyle} title={<Text strong>{t('methodology.precision_title')}</Text>}>
            <Paragraph>{t('methodology.precision_intro')}</Paragraph>
            <ul style={{ paddingLeft: 20, marginBottom: 0 }}>
              <li>{t('methodology.precision_fast')}</li>
              <li>{t('methodology.precision_precise')}</li>
              <li>{t('methodology.precision_auto')}</li>
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
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Card size="small" style={cardStyle}>
              <Text strong style={{ color: token.colorPrimary }}>{t('methodology.glossary_eed_title')}</Text>
              <Paragraph style={{ marginTop: 4, marginBottom: 0 }}>{t('methodology.glossary_eed_desc')}</Paragraph>
            </Card>

            <Card size="small" style={cardStyle}>
              <Text strong style={{ color: token.colorPrimary }}>{t('methodology.glossary_evo_title')}</Text>
              <Paragraph style={{ marginTop: 4, marginBottom: 0 }}>{t('methodology.glossary_evo_desc')}</Paragraph>
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
