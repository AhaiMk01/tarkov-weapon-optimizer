import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Collapse, Space, Tag, Tooltip, Typography } from 'antd'
import {
  CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined, InfoCircleOutlined, StopOutlined, WarningOutlined,
} from '@ant-design/icons'
import type { OptimizeResponse } from '../../api/client'
import { authorityOf, qualifierKey, resultViewOf, TONE_TAG_COLOR } from './resultView'
import type { AuthorityInput, BoundsView, MetaView, Qualifier, ReasonView, ResultView, Tone } from './resultView'
import type { Failure } from './failureView'

const { Text } = Typography

const TONE_ICON: Record<Tone, ReactNode> = {
  success: <CheckCircleOutlined />,
  info: <InfoCircleOutlined />,
  warning: <ExclamationCircleOutlined />,
  error: <CloseCircleOutlined />,
}

/** Antd tone to the alert icon: a normal result always gets the check, a cancel the stop sign, anything else the icon of its tone. */
const iconOf = (view: Pick<ResultView, 'headline' | 'cancelled' | 'tone'>): ReactNode =>
  view.cancelled ? <StopOutlined /> : view.headline.kind === 'badge' ? <CheckCircleOutlined /> : TONE_ICON[view.tone]

// ---------------------------------------------------------------------------------------------
// Details on demand
// ---------------------------------------------------------------------------------------------

/** One flag kept for the session (the Details panels stay open once the player opened one). Storage can be blocked: the flag then just does not persist. */
const readFlag = (key: string): boolean => {
  try { return window.sessionStorage.getItem(key) === '1' } catch { return false }
}
const writeFlag = (key: string, value: boolean): void => {
  try { window.sessionStorage.setItem(key, value ? '1' : '0') } catch { /* storage unavailable: not remembered */ }
}

export const DETAILS_STORAGE_KEY = 'tarkovOptimizer.detailsOpen'

/**
 * The collapsed "Details" section under a result: everything the plain default view leaves out (proof wording, model notes, bounds, reasons).
 * Closed by default, and remembered for the session once opened.
 */
export function DetailsPanel({ children, storageKey = DETAILS_STORAGE_KEY }: { children: ReactNode; storageKey?: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(() => readFlag(storageKey))
  return (
    <Collapse
      ghost
      size="small"
      activeKey={open ? ['details'] : []}
      onChange={keys => {
        const next = (Array.isArray(keys) ? keys : [keys]).length > 0
        setOpen(next)
        writeFlag(storageKey, next)
      }}
      items={[{
        key: 'details',
        label: <Text type="secondary" style={{ fontSize: 12, userSelect: 'none' }}>{t('results.details')}</Text>,
        children,
      }]}
    />
  )
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

/** The model caveats of a result: the Fast count model, the provisional MOA model. (Details only.) */
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

/** The full authority chip of a build (Details only): proved, approximate, feasible, ... with what it means in the tooltip. */
export function AuthorityTag({ result, style }: { result: AuthorityInput; style?: CSSProperties }) {
  const { t } = useTranslation()
  const authority = authorityOf(result)
  return (
    <Tooltip title={t(`${authority.titleKey}_detail`)}>
      <Tag color={TONE_TAG_COLOR[authority.tone]} style={{ margin: 0, ...style }}>{t(`${authority.titleKey}_short`)}</Tag>
    </Tooltip>
  )
}

/**
 * The only mark a build in a list carries by default: a quiet "Approximate" tag, and only when the build is not a proved optimum. A proved build
 * carries nothing; the full authority and model wording is in the build's own Details.
 */
export function ApproximateTag({ result, style }: { result: AuthorityInput; style?: CSSProperties }) {
  const { t } = useTranslation()
  const authority = authorityOf(result)
  if (authority.level === 'certified_optimal') return null
  return (
    <Tooltip title={t(`${authority.titleKey}_detail`)}>
      <Tag style={{ margin: 0, ...style }}>{t('results.authority_approximate_optimal_short')}</Tag>
    </Tooltip>
  )
}

/** The quiet facts of a request: "367 ms · Fast", or "367 ms · Auto → Fast". */
export function MetaText({ meta }: { meta: MetaView }) {
  const { t } = useTranslation()
  const parts: string[] = []
  if (meta.ms !== null) parts.push(`${meta.ms} ms`)
  if (meta.mode !== null) {
    const mode = meta.mode === 'precise' ? t('sidebar.precise') : t('sidebar.fast')
    parts.push(meta.request === 'auto' ? t('results.precision_auto_ran', { mode }) : mode)
  }
  if (parts.length === 0) return null
  return (
    <Text type="secondary" style={{ fontSize: 12 }} title={meta.request === 'auto' ? t('sidebar.solver_precision_tooltip') : undefined}>
      {parts.join(' · ')}
    </Text>
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

/** Everything the plain default view leaves out about one result: the authority wording, the model notes, the reason with its advice, the bounds. */
export function ResultDetails({ view }: { view: ResultView }) {
  const { t } = useTranslation()
  const { authority } = view
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Space size={8} wrap>
        <Text strong>{t(authority.titleKey)}</Text>
        <QualifierTags qualifiers={authority.qualifiers} />
      </Space>
      <Text type="secondary">{t(`${authority.titleKey}_detail`)}</Text>
      <ReasonText reason={view.reason} />
      <BoundsLine bounds={view.bounds} />
    </div>
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
 * The status of one Optimize or Gunsmith result, plain by default: a small "Best build" (proved optimum) or "Build found" for a normal result,
 * ONE plain sentence when something is off (the run button then reads "Retry" where retrying can help), the time and mode as quiet text. Everything
 * else (authority wording, model notes, reason, bounds) is in the collapsed Details. A cancel is informational, not an error.
 */
export function ResultStatusAlert({ result, running, onRun, onCancel, cancelling = false, runIcon, runLabel }: ResultStatusAlertProps) {
  const { t } = useTranslation()
  const view = resultViewOf(result)
  const { headline } = view
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Alert
        type={view.tone}
        showIcon
        icon={iconOf(view)}
        style={{ alignItems: 'center' }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, width: '100%' }}>
            <Space size={8} wrap>
              <Button type="primary" icon={runIcon} loading={running} onClick={onRun}>{headline.retry ? t('error.retry') : runLabel}</Button>
              {running && onCancel && <CancelButton onCancel={onCancel} cancelling={cancelling} />}
            </Space>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <Text strong={headline.kind === 'badge'}>{t(headline.key)}</Text>
              <MetaText meta={view.meta} />
            </div>
          </div>
        }
      />
      <DetailsPanel>
        <ResultDetails view={view} />
      </DetailsPanel>
    </div>
  )
}

/**
 * A rejected request that is not a plain cancel: a native solver failure or an unexpected error. By default one plain sentence; the error text, the
 * engine reset notice and what the search had established before it failed are in the collapsed Details.
 */
export function FailureAlert({ failure }: { failure: Failure }) {
  const { t } = useTranslation()
  if (failure.kind === 'cancelled') return <Alert type="info" showIcon icon={<StopOutlined />} title={t('notice.cancelled_none')} />
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Alert type="error" showIcon title={t('notice.error')} />
      <DetailsPanel>
        {failure.kind === 'unknown' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Text strong>{t('failure.unexpected')}</Text>
            <Text type="secondary">{failure.message}</Text>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Text strong>{t('failure.solver_error')}</Text>
            <Text type="secondary">{failure.message}</Text>
            {failure.corrupted && <Text type="secondary">{t('failure.engine_reset')}</Text>}
            {failure.completion !== null && (
              <Text type="secondary">
                {failure.completion.witness
                  ? t('failure.retained_build_yes', { nodes: failure.completion.nodes })
                  : t('failure.retained_build_no', { nodes: failure.completion.nodes })}
              </Text>
            )}
            {failure.bounds !== null && <BoundsLine bounds={failure.bounds} />}
          </div>
        )}
      </DetailsPanel>
    </div>
  )
}
