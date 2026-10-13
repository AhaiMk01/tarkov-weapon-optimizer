import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Space, Table, Tag, Tooltip, Typography } from 'antd'
import { BarChartOutlined, CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined, InfoCircleOutlined, LoadingOutlined } from '@ant-design/icons'
import type { ExploreResponse } from '../../api/client'
import { CancelButton, DetailsPanel, MetaText, OneCopyTag, QualifierTags, ReasonText } from '../common/ResultStatus'
import { TONE_TAG_COLOR, reasonViewOf } from '../common/resultView'
import type { Tone } from '../common/resultView'
import { CURVE_TONE, authorityCounts, cancelReasonOf, coverageOf, curveMeaningKey, curveStatusKey, exploreLineOf, exploreMetaOf, runQualifiers, runSingleCopy, settledResponseOf, summarizeRuns } from './exploreView'
import type { CurveStatus, ExploreWeaponRun, UnresolvedTarget } from './exploreView'

const { Text } = Typography

const TONE_ICON: Record<Tone, ReactNode> = {
  success: <CheckCircleOutlined />,
  info: <InfoCircleOutlined />,
  warning: <ExclamationCircleOutlined />,
  error: <CloseCircleOutlined />,
}

/** The coverage status of one weapon's sweep, with what it means: discrete schedule coverage, never continuous Pareto optimality. (Details only.) */
export function CurveTag({ status }: { status: CurveStatus }) {
  const { t } = useTranslation()
  return (
    <Tooltip title={t(curveMeaningKey(status))}>
      <Tag color={TONE_TAG_COLOR[CURVE_TONE[status]]} style={{ margin: 0 }}>{t(curveStatusKey(status))}</Tag>
    </Tooltip>
  )
}

/** The counts of witnessed (V), certified-empty (I), unresolved (U) and failed (E) targets of a response, as one line. (Details only.) */
export function CoverageCounts({ response }: { response: Pick<ExploreResponse, 'step_outcomes' | 'sweep_schedule'> }) {
  const { t } = useTranslation()
  const { counts, total } = coverageOf(response)
  return <Text type="secondary">{t('explore.coverage_counts', { v: counts.V, i: counts.I, u: counts.U, e: counts.E, total })}</Text>
}

/**
 * Per-target coverage of one sweep: its coverage status, the counts, and every unresolved or failed target with its reason. A reason of the closed
 * set is localized; the diagnostic of a failed (E) step is shown as it came, in a neutral style. (Details only.)
 */
export function CoverageDetails({ response, fallbackReason }: { response: ExploreResponse; fallbackReason?: string }) {
  const { t } = useTranslation()
  const coverage = coverageOf(response, fallbackReason)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Space size={8} wrap>
        <CurveTag status={response.curve_status} />
        <CoverageCounts response={response} />
      </Space>
      <Text type="secondary" style={{ fontSize: 12 }}>{t(curveMeaningKey(response.curve_status))}</Text>
      {/* Nothing to list when every target is resolved: the curve status sentence above already says so (a sweep still running has its own status). */}
      {coverage.unresolved.length === 0 ? null : (
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

/** Everything the plain default line of the sweep(s) leaves out: coverage status, counts and table, authority counts, model notes, reasons, error text. */
function ExploreDetails({ runs, runTotal }: { runs: readonly ExploreWeaponRun[]; runTotal: number }) {
  const { t } = useTranslation()
  const summary = summarizeRuns(runs, runTotal)
  const single = runTotal <= 1
  const first = runs[0]
  const settled = single && first !== undefined ? settledResponseOf(first) : null
  const points = runs.flatMap(r => r.response?.points ?? [])
  const counts = authorityCounts(points)
  const reason = single && first?.response?.reason !== undefined ? reasonViewOf(first.response.reason) : null
  const failures = runs.filter(r => r.error !== undefined)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {settled !== null && first !== undefined && <CoverageDetails response={settled} fallbackReason={cancelReasonOf(first)} />}
      {!single && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Text type="secondary">{t('explore.compare_status_v2', { complete: summary.byCurve.complete, total: runTotal })}</Text>
          <Text type="secondary">
            {t('explore.compare_breakdown', {
              partial: summary.byCurve.partial, infeasible: summary.byCurve.infeasible, invalid: summary.byCurve.invalid,
              failed: summary.failed, cancelled: summary.cancelled,
            })}
          </Text>
        </div>
      )}
      <Space size={8} wrap>
        <QualifierTags qualifiers={runQualifiers(runs)} />
        {runSingleCopy(runs) && <OneCopyTag />}
      </Space>
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
 * The status of the sweep(s), plain by default: the chart and its points are the result, and this banner says ONE plain line only when the sweep is
 * not complete (running "Computing... n of m", partial, no builds, cancelled, failed), with the time and mode as quiet text. The coverage status,
 * counts and table, the authority of the points and the model notes are in the collapsed Details.
 */
export function ExploreStatusAlert({ runs, runTotal, solveTimeMs, exploring, onExplore, onCancel, cancelling = false, actionLabel }: ExploreStatusAlertProps) {
  const { t } = useTranslation()
  const line = exploreLineOf(runs, runTotal)
  const running = runs.some(r => r.phase === 'running')
  // No line means every sweep is complete.
  const tone: Tone = line?.tone ?? 'success'

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Alert
        type={tone}
        showIcon
        icon={running ? <LoadingOutlined /> : TONE_ICON[tone]}
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, width: '100%' }}>
            <Space size={8} wrap>
              <Button type="primary" icon={<BarChartOutlined />} loading={exploring} onClick={onExplore}>{actionLabel}</Button>
              {exploring && onCancel && <CancelButton onCancel={onCancel} cancelling={cancelling} />}
            </Space>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              {line !== null && <Text>{t(line.key, line.params)}</Text>}
              <MetaText meta={exploreMetaOf(runs, solveTimeMs)} />
            </div>
          </div>
        }
      />
      <DetailsPanel>
        <ExploreDetails runs={runs} runTotal={runTotal} />
      </DetailsPanel>
    </div>
  )
}
