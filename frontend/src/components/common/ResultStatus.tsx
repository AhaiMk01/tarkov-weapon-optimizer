import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Space, Tag, Tooltip, Typography } from 'antd'
import {
  CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined, InfoCircleOutlined, StopOutlined, WarningOutlined,
} from '@ant-design/icons'
import type { OptimizeResponse } from '../../api/client'
import { authorityOf, qualifierKey, resultViewOf, TONE_TAG_COLOR } from './resultView'
import type { AuthorityInput, BoundsView, Qualifier, ReasonView, Tone } from './resultView'
import type { Failure } from './failureView'

const { Text } = Typography

const TONE_ICON: Record<Tone, ReactNode> = {
  success: <CheckCircleOutlined />,
  info: <InfoCircleOutlined />,
  warning: <ExclamationCircleOutlined />,
  error: <CloseCircleOutlined />,
}

/** One localized line for a reason: the public reasons by their own key, anything else exactly as it came, in a neutral style. */
export function ReasonText({ reason }: { reason: ReasonView | null }) {
  const { t } = useTranslation()
  if (reason === null) return null
  if (reason.key === null) return <Text type="secondary" style={{ margin: 0 }}>{reason.text}</Text>
  return (
    <Text type="secondary" style={{ margin: 0 }} title={reason.text}>
      {t(reason.key)}
      {reason.adviceKey !== null && <> {t(reason.adviceKey)}</>}
    </Text>
  )
}

/** The proof bounds of a result; an unknown bound reads "unknown", never a number. Nothing at all when no bound is known. */
export function BoundsLine({ bounds }: { bounds: BoundsView }) {
  const { t } = useTranslation()
  if (!bounds.anyKnown) return null
  const unknown = t('results.bound_unknown')
  return (
    <Text type="secondary">
      {t('results.optimization_bounds', {
        lower: bounds.lower ?? unknown,
        upper: bounds.upper ?? unknown,
        gap: bounds.gap ?? unknown,
        tolerance: bounds.tolerance ?? unknown,
      })}
    </Text>
  )
}

/** The model caveats of a result: the Fast count model, the provisional MOA model. */
export function QualifierTags({ qualifiers, style }: { qualifiers: readonly Qualifier[]; style?: CSSProperties }) {
  const { t } = useTranslation()
  return (
    <>
      {qualifiers.map(q => (
        <Tooltip key={q} title={t(`${qualifierKey(q)}_tooltip`)}>
          <Tag color="orange" icon={<WarningOutlined />} style={{ margin: 0, ...style }}>{t(qualifierKey(q))}</Tag>
        </Tooltip>
      ))}
    </>
  )
}

/** A compact authority chip for a build in a list (an Explore point, a step row). */
export function AuthorityTag({ result, style }: { result: AuthorityInput; style?: CSSProperties }) {
  const { t } = useTranslation()
  const authority = authorityOf(result)
  return (
    <Tooltip title={t(`${authority.titleKey}_detail`)}>
      <Tag color={TONE_TAG_COLOR[authority.tone]} style={{ margin: 0, ...style }}>{t(`${authority.titleKey}_short`)}</Tag>
    </Tooltip>
  )
}

/** The Cancel button of a running request: it asks the worker to stop and says it was heard until the request settles. */
export function CancelButton({ onCancel, cancelling = false, size }: { onCancel: () => void; cancelling?: boolean; size?: 'small' | 'middle' | 'large' }) {
  const { t } = useTranslation()
  return (
    <Button danger size={size} icon={<StopOutlined />} disabled={cancelling} onClick={onCancel}>
      {cancelling ? t('ui.cancelling') : t('ui.cancel_btn')}
    </Button>
  )
}

interface ResultStatusAlertProps {
  result: OptimizeResponse
  running: boolean
  onRun: () => void
  /** Present while a request can be cancelled; shown instead of the run button's spinner. */
  onCancel?: () => void
  cancelling?: boolean
  runIcon: ReactNode
  /** Label of the run button. */
  runLabel: string
}

/**
 * The status of one Optimize or Gunsmith result: the authority headline (proved, approximate, feasible, incomplete, infeasible, error), the model
 * caveats, the factual reason with its advice, the proof bounds and the cancel affordance. A cancel is informational, not an error.
 */
export function ResultStatusAlert({ result, running, onRun, onCancel, cancelling = false, runIcon, runLabel }: ResultStatusAlertProps) {
  const { t } = useTranslation()
  const view = resultViewOf(result)
  const { authority } = view
  return (
    <Alert
      type={view.tone}
      showIcon
      icon={view.cancelled ? <StopOutlined /> : TONE_ICON[view.tone]}
      style={{ alignItems: 'center' }}
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, width: '100%' }}>
          <Space size={8} wrap>
            <Button type="primary" icon={runIcon} loading={running} onClick={onRun}>{runLabel}</Button>
            {running && onCancel && <CancelButton onCancel={onCancel} cancelling={cancelling} />}
          </Space>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            {/* A cancel is said in addition to what the result is: a retained build keeps its own authority (feasible, never "proved"). */}
            {view.cancelled && <Tag color="processing" icon={<StopOutlined />} style={{ margin: 0 }}>{t('results.cancelled')}</Tag>}
            <Text strong>{t(authority.titleKey)}</Text>
            <QualifierTags qualifiers={authority.qualifiers} />
            {Number.isFinite(result.solve_time_ms) && result.solve_time_ms > 0 && <Tag color="blue" style={{ margin: 0 }}>{result.solve_time_ms.toFixed(0)} ms</Tag>}
            {result.precision_request === 'auto' && result.precision_resolved && (
              <Tag color="processing" style={{ margin: 0 }} title={t('sidebar.solver_precision_tooltip')}>
                {t('results.precision_auto_ran', { mode: result.precision_resolved === 'precise' ? t('sidebar.precise') : t('sidebar.fast') })}
              </Tag>
            )}
          </div>
        </div>
      }
      description={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Text type="secondary">{t(`${authority.titleKey}_detail`)}</Text>
          <ReasonText reason={view.reason} />
          <BoundsLine bounds={view.bounds} />
        </div>
      }
    />
  )
}

/** A rejected request that is not a plain cancel: a native solver failure (with what the search had established) or an unexpected error. */
export function FailureAlert({ failure }: { failure: Failure }) {
  const { t } = useTranslation()
  if (failure.kind === 'cancelled') return <Alert type="info" showIcon icon={<StopOutlined />} title={t('results.cancelled')} />
  if (failure.kind === 'unknown') {
    return <Alert type="error" showIcon title={t('failure.unexpected')} description={<Text type="secondary">{failure.message}</Text>} />
  }
  const { completion, bounds } = failure
  return (
    <Alert
      type="error"
      showIcon
      title={t('failure.solver_error')}
      description={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Text type="secondary">{failure.message}</Text>
          {failure.corrupted && <Text type="secondary">{t('failure.engine_reset')}</Text>}
          {completion !== null && (
            <Text type="secondary">
              {completion.witness ? t('failure.retained_build_yes', { nodes: completion.nodes }) : t('failure.retained_build_no', { nodes: completion.nodes })}
            </Text>
          )}
          {bounds !== null && <BoundsLine bounds={bounds} />}
        </div>
      }
    />
  )
}
