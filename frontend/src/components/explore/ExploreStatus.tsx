import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Space, Table, Tag, Tooltip, Typography } from 'antd'
import { BarChartOutlined, CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined, InfoCircleOutlined, LoadingOutlined } from '@ant-design/icons'
import type { ExploreResponse } from '../../api/client'
import { CancelButton, QualifierTags, ReasonText } from '../common/ResultStatus'
import { TONE_TAG_COLOR, reasonViewOf } from '../common/resultView'
import type { Tone } from '../common/resultView'
import { CURVE_TONE, authorityCounts, coverageOf, curveMeaningKey, curveStatusKey, runQualifiers, settledResponseOf, summarizeRuns } from './exploreView'
import type { CurveStatus, ExploreWeaponRun, UnresolvedTarget } from './exploreView'

const { Text } = Typography

const TONE_ICON: Record<Tone, ReactNode> = {
  success: <CheckCircleOutlined />,
  info: <InfoCircleOutlined />,
  warning: <ExclamationCircleOutlined />,
  error: <CloseCircleOutlined />,
}

/** The coverage status of one weapon's sweep, with what it means: discrete schedule coverage, never continuous Pareto optimality. */
export function CurveTag({ status }: { status: CurveStatus }) {
  const { t } = useTranslation()
  return (
    <Tooltip title={t(curveMeaningKey(status))}>
      <Tag color={TONE_TAG_COLOR[CURVE_TONE[status]]} style={{ margin: 0 }}>{t(curveStatusKey(status))}</Tag>
    </Tooltip>
  )
}

/** The counts of witnessed (V), certified-empty (I), unresolved (U) and failed (E) targets of a response, as one line. */
export function CoverageCounts({ response }: { response: Pick<ExploreResponse, 'step_outcomes' | 'sweep_schedule'> }) {
  const { t } = useTranslation()
  const { counts, total } = coverageOf(response)
  return <Text type="secondary">{t('explore.coverage_counts', { v: counts.V, i: counts.I, u: counts.U, e: counts.E, total })}</Text>
}

/**
 * Per-target coverage of one sweep: the counts, and every unresolved or failed target with its reason. A reason of the closed set is localized;
 * the diagnostic of a failed (E) step is shown as it came, in a neutral style.
 */
export function CoverageDetails({ response, fallbackReason }: { response: ExploreResponse; fallbackReason?: string }) {
  const { t } = useTranslation()
  const coverage = coverageOf(response, fallbackReason)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <CoverageCounts response={response} />
      <Text type="secondary" style={{ fontSize: 12 }}>{t(curveMeaningKey(response.curve_status))}</Text>
      {coverage.unresolved.length === 0 ? (
        <Text type="secondary">{t('explore.coverage_all_resolved')}</Text>
      ) : (
        <Table<UnresolvedTarget>
          size="small"
          pagination={false}
          rowKey="targetIndex"
          dataSource={coverage.unresolved}
          columns={[
            { title: t('explore.target'), dataIndex: 'targetIndex', width: 70, render: (i: number) => i + 1 },
            { title: t('explore.target_value'), dataIndex: 'targetValue', width: 110, render: (v: number | null) => (v === null ? '—' : Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—') },
            {
              title: t('explore.target_outcome'),
              dataIndex: 'outcome',
              width: 120,
              render: (o: 'U' | 'E') => <Tag color={o === 'E' ? 'error' : 'warning'} style={{ margin: 0 }}>{o === 'E' ? t('explore.outcome_failed') : t('explore.outcome_unresolved')}</Tag>,
            },
            {
              title: t('explore.target_reason'),
              dataIndex: 'reason',
              render: (_: unknown, row: UnresolvedTarget) => (row.reason === null ? <Text type="secondary">{t('explore.reason_not_launched')}</Text> : <ReasonText reason={row.reason} />),
            },
          ]}
        />
      )}
    </div>
  )
}

interface ExploreStatusAlertProps {
  runs: readonly ExploreWeaponRun[]
  /** Weapons requested for the run (the denominator of the weapon counts). */
  runTotal: number
  solveTimeMs?: number
  exploring: boolean
  onExplore: () => void
  onCancel?: () => void
  cancelling?: boolean
  actionLabel: string
}

/**
 * The status of the sweep(s): live progress while running, then per sweep the coverage status (complete / partial / infeasible / invalid) with its
 * meaning, the per-target counts, the authority of the points and the model caveats. A cancelled or failed run says so and keeps the points it has.
 */
export function ExploreStatusAlert({ runs, runTotal, solveTimeMs, exploring, onExplore, onCancel, cancelling = false, actionLabel }: ExploreStatusAlertProps) {
  const { t } = useTranslation()
  const summary = summarizeRuns(runs, runTotal)
  const single = runTotal <= 1
  const first = runs[0]
  const qualifiers = runQualifiers(runs)
  const points = runs.flatMap(r => r.response?.points ?? [])
  const counts = authorityCounts(points)

  let headline: string
  let tone: Tone = summary.tone
  if (summary.running > 0) {
    const live = runs.find(r => r.phase === 'running')
    headline = live?.scheduled !== undefined && live.launched !== undefined
      ? t('explore.running_progress', { launched: live.launched, scheduled: live.scheduled })
      : t('explore.running')
    tone = 'info'
  } else if (single && first !== undefined) {
    if (first.phase === 'failed' && first.response === null) headline = t('explore.failed')
    else if (first.phase === 'cancelled') headline = t('explore.cancelled_kept', { count: first.response?.points.length ?? 0 })
    else headline = first.response === null ? t('explore.failed') : t(curveStatusKey(first.response.curve_status))
  } else {
    headline = t('explore.compare_status_v2', { complete: summary.byCurve.complete, total: runTotal })
  }
  const reason = single && first?.response?.reason !== undefined ? reasonViewOf(first.response.reason) : null
  const failures = runs.filter(r => r.error !== undefined)

  return (
    <Alert
      type={tone}
      showIcon
      icon={summary.running > 0 ? <LoadingOutlined /> : TONE_ICON[tone]}
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, width: '100%' }}>
          <Space size={8} wrap>
            <Button type="primary" icon={<BarChartOutlined />} loading={exploring} onClick={onExplore}>{actionLabel}</Button>
            {exploring && onCancel && <CancelButton onCancel={onCancel} cancelling={cancelling} />}
          </Space>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <Text strong>{headline}</Text>
            {single && first?.response && summary.running === 0 && <CurveTag status={first.response.curve_status} />}
            <QualifierTags qualifiers={qualifiers} />
            {solveTimeMs != null && <Tag color="blue" style={{ margin: 0 }}>{solveTimeMs.toFixed(0)} ms</Tag>}
            {single && first?.response?.precision_request === 'auto' && first.response.precision_resolved && (
              <Tag color="processing" style={{ margin: 0 }} title={t('sidebar.solver_precision_tooltip')}>
                {t('results.precision_auto_ran', { mode: first.response.precision_resolved === 'precise' ? t('sidebar.precise') : t('sidebar.fast') })}
              </Tag>
            )}
          </div>
        </div>
      }
      description={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {single && first?.response && summary.running === 0 && <Text type="secondary">{t(curveMeaningKey(first.response.curve_status))}</Text>}
          {single && first !== undefined && settledResponseOf(first) !== null && <CoverageCounts response={settledResponseOf(first) as ExploreResponse} />}
          {!single && (
            <Text type="secondary">
              {t('explore.compare_breakdown', {
                partial: summary.byCurve.partial, infeasible: summary.byCurve.infeasible, invalid: summary.byCurve.invalid,
                failed: summary.failed, cancelled: summary.cancelled,
              })}
            </Text>
          )}
          {points.length > 0 && (
            <Text type="secondary">
              {t('explore.points_authority', { proved: counts.certified_optimal, approximate: counts.approximate_optimal, feasible: counts.feasible })}
            </Text>
          )}
          <ReasonText reason={reason} />
          {failures.map(r => (
            <Text key={r.weaponId} type="secondary">{single ? r.error : `${r.weaponName}: ${r.error}`}</Text>
          ))}
        </div>
      }
    />
  )
}
