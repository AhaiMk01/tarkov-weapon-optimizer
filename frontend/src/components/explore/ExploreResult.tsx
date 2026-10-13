import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, Collapse, Drawer, Grid, Table, Tag, Typography, theme } from 'antd'
import { BarChartOutlined, CheckCircleOutlined, SettingOutlined } from '@ant-design/icons'
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from 'recharts'
import { EmptyState } from '../common/EmptyState'
import { BuildManifest } from '../common/BuildManifest'
import { UsingPresetCard } from '../common/UsingPresetCard'
import { partitionManifest, presetUsage } from '../common/manifest'
import { EftforgeButton } from '../common/EftforgeButton'
import { ApproximateTag, AuthorityTag, CancelButton, DetailsPanel, QualifierTags, ReasonText } from '../common/ResultStatus'
import { qualifiersOf, reasonViewOf } from '../common/resultView'
import type { ExplorePoint, ExploreResponse, OptimizeResponse } from '../../api/client'
import { paletteColorAt, seriesPalette } from './palette'
import { CoverageDetails, ExploreStatusAlert } from './ExploreStatus'
import { cancelReasonOf, pointsOfRuns, runLineOf, settledResponseOf } from './exploreView'
import type { ExploreWeaponRun } from './exploreView'

const { Text } = Typography
const { useToken } = theme

interface ExploreResultProps {
  /** One sweep per requested weapon, in order: the final response, or the live/retained snapshot of a run that is running or did not finish. */
  runs: ExploreWeaponRun[]
  resultTradeoff: 'price' | 'recoil' | 'ergo'
  exploring: boolean
  onExplore: () => void
  /** Stops an in-flight run; the points found so far stay on screen. */
  onCancelExplore?: () => void
  cancellingExplore?: boolean
  disabled: boolean
  weaponId?: string
  /** Weapon ids requested for the current/last Explore run (denominator for n/m status). */
  runWeaponIds?: string[]
}

/**
 * An Explore point already carries the whole build -- BuildManifest only reads
 * slot_pairs, selected_preset and selected_items -- so the detail view is a
 * re-render of data we already hold, not another solve.
 */
function pointAsBuild(point: ExplorePoint): OptimizeResponse {
  return {
    status: point.status,
    precision_request: point.precision_request,
    precision_resolved: point.precision_resolved,
    model_qualification: point.model_qualification,
    moa_qualification: point.moa_qualification,
    physical_certificate: point.physical_certificate,
    selected_items: point.selected_items,
    selected_item_ids: point.selected_item_ids,
    selected_preset: point.selected_preset,
    slot_pairs: point.slot_pairs,
    objective_value: point.objective_value,
    optimization: point.optimization,
    solve_time_ms: point.solve_time_ms,
    ...(point.reason === undefined ? {} : { reason: point.reason }),
    // final_stats is deliberately omitted: an ExplorePoint carries no weight or
    // MOA, and filling them with zeros would report every Explore build as 0 kg
    // at 0 MOA the moment BuildManifest starts showing those fields.
  }
}

function xKeyOf(tradeoff: 'price' | 'recoil' | 'ergo'): 'ergo' | 'recoil_v' {
  return tradeoff === 'ergo' ? 'recoil_v' : 'ergo'
}

/**
 * Two points are the same point when their weapon and plotted coordinates agree. A live sweep republishes every point as a fresh object with each
 * snapshot, so a pinned point is followed by this identity rather than by object identity.
 */
const samePoint = (a: ExplorePoint, b: ExplorePoint): boolean =>
  a.weapon_id === b.weapon_id && a.ergo === b.ergo && a.recoil_v === b.recoil_v && a.recoil_h === b.recoil_h && a.price === b.price

export function ExploreResult({
  runs,
  resultTradeoff,
  exploring,
  onExplore,
  onCancelExplore,
  cancellingExplore,
  disabled,
  weaponId,
  runWeaponIds,
}: ExploreResultProps) {
  const { t } = useTranslation()
  const { token } = useToken()
  const xKey = xKeyOf(resultTradeoff)
  const yKey = resultTradeoff === 'price' ? 'recoil_v' : 'price'
  const xLabel = resultTradeoff === 'ergo' ? t('ui.chart_recoil_v') : t('ui.chart_ergonomics')
  const yLabel = resultTradeoff === 'price' ? t('ui.chart_recoil_v') : t('ui.chart_price')

  const exploreResult = useMemo(() => pointsOfRuns(runs), [runs])
  const solveTime = useMemo(() => runs.reduce((sum, r) => sum + (r.response?.total_solve_time_ms ?? 0), 0), [runs])

  /** Series count drives the palette. Kept separate from `series` so appending a
   *  weapon's points mid-run does not regenerate every colour: the palette build
   *  is ~30ms at 171 weapons and the run appends once per weapon. */
  const paletteSize = useMemo(() => {
    const ids = new Set<string>()
    for (const point of exploreResult) ids.add(point.weapon_id || weaponId || 'default')
    return Math.max(ids.size, runWeaponIds?.length ?? 0, 1)
  }, [exploreResult, weaponId, runWeaponIds])
  const palette = useMemo(() => seriesPalette(token, paletteSize), [token, paletteSize])

  const series = useMemo(() => {
    const grouped = new Map<string, ExplorePoint[]>()
    for (const point of exploreResult) {
      const id = point.weapon_id || weaponId || 'default'
      const list = grouped.get(id)
      if (list) list.push(point)
      else grouped.set(id, [point])
    }
    const entries = [...grouped.entries()]
    return entries.map(([id, points], index) => {
      const runIndex = runWeaponIds?.indexOf(id) ?? -1
      const colorIndex = runIndex >= 0 ? runIndex : index
      return {
        id,
        name: points[0]?.weapon_name || id,
        color: paletteColorAt(palette, colorIndex),
        data: [...points].sort((a, b) => a[xKey] - b[xKey]),
      }
    })
  }, [exploreResult, weaponId, palette, xKey, runWeaponIds])


  const runTotal = Math.max(runWeaponIds?.length ?? 0, runs.length)
  const comparing = runTotal > 1
  const [detailPoint, setDetailPoint] = useState<ExplorePoint | null>(null)
  /** Point pinned by clicking it in the plot, with the click position so the
   *  panel can sit next to it, and the size of the plot at that moment (so render
   *  never has to read the DOM). Coordinates are relative to the plot wrapper. */
  const [pinned, setPinned] = useState<{ point: ExplorePoint; x: number; y: number; w: number; h: number } | null>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  // Collapsed by default: in that state the panel header renders the weapon
  // swatches, which is exactly what the chart legend used to be -- so the
  // default view is chart + legend, and the numbers are one click away.
  const [listOpen, setListOpen] = useState(false)

  /**
   * The plot takes whatever height the panel has left after the status alert and
   * the results list. Measured rather than flex-grown: recharts' ResponsiveContainer
   * measures its own parent, so as a flex item with no definite height it settles
   * to a collapsed size instead of filling the space.
   */
  // Callback ref, not useRef: this component early-returns an EmptyState before a
  // result exists, so a plain ref is still null when the effect first runs and
  // nothing would re-trigger it once the real tree mounts.
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null)
  const alertRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const screens = Grid.useBreakpoint()
  const isDesktop = !!screens.lg
  const [measured, setMeasured] = useState({ chart: 400, table: 320 })
  // Below the desktop breakpoint (or before the panel exists) the plot has its fixed size; the measurement only applies on desktop.
  const chartHeight = rootEl && isDesktop ? measured.chart : 400
  const tableScrollY = rootEl && isDesktop ? measured.table : 320

  useLayoutEffect(() => {
    const root = rootEl
    if (!root || !isDesktop) return
    const GAPS = 32 // two 16px flex gaps
    const CARD_CHROME = 26 // Card body padding around the plot
    const CHART_FLOOR = 220
    const LIST_CHROME = 116 // collapse header + table head + padding + borders
    const measure = () => {
      const budget =
        root.clientHeight - (alertRef.current?.offsetHeight ?? 0) - GAPS - CARD_CHROME
      const available = budget - (listRef.current?.offsetHeight ?? 0)
      // The table height is derived from the same budget rather than from the list's own height, so
      // the two measurements cannot feed each other into a resize loop.
      setMeasured({
        chart: Math.max(CHART_FLOOR, Math.round(available)),
        table: Math.round(Math.min(320, Math.max(160, budget - CHART_FLOOR - LIST_CHROME))),
      })
    }
    measure()
    // Observing the list covers expand/collapse without depending on listOpen.
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    if (alertRef.current) ro.observe(alertRef.current)
    if (listRef.current) ro.observe(listRef.current)
    return () => ro.disconnect()
  }, [rootEl, isDesktop])
  // The pin panel is positioned from the pixel coordinates of the click. Resizing the plot -- which the
  // collapse toggle does, 525px <-> 220px -- rescales the axes and moves every dot, so those coordinates no
  // longer point at anything: a pin recorded at another plot height is not shown. A live sweep republishes
  // the points as fresh objects with every snapshot, so the pin follows its point by weapon and
  // coordinates, and is not shown once that point is no longer in the frontier.
  const activePin = useMemo(() => {
    if (pinned === null || pinned.h !== chartHeight) return null
    const match = exploreResult.find(p => samePoint(p, pinned.point))
    return match === undefined ? null : { ...pinned, point: match }
  }, [pinned, chartHeight, exploreResult])
  const [manifestView, setManifestView] = useState<'detailed' | 'compact' | 'table'>('detailed')

  /** One row per weapon instead of one per frontier point: 16 weapons produced
   *  120 paginated rows, most of which just restate the chart's axes. A weapon
   *  whose sweep produced no point still has its row: its coverage status is the
   *  answer. */
  const weaponRows = useMemo(() => runs.map((run, index) => {
    const points = exploreResult.filter(p => p.weapon_id === run.weaponId)
    const colorIndex = runWeaponIds?.indexOf(run.weaponId) ?? -1
    return {
      key: run.weaponId,
      id: run.weaponId,
      name: run.weaponName,
      color: paletteColorAt(palette, colorIndex >= 0 ? colorIndex : index),
      run,
      points,
      bestErgo: points.length ? Math.max(...points.map(p => p.ergo)) : null,
      lowestRecoil: points.length ? Math.min(...points.map(p => p.recoil_v)) : null,
      cheapest: points.length ? Math.min(...points.map(p => p.price)) : null,
    }
  }), [runs, exploreResult, palette, runWeaponIds])
  const liveRun = runs.find(r => r.phase === 'running')
  const actionLabel = exploring && comparing
    ? t('explore.comparing', {
        name: liveRun?.weaponName ?? runs[runs.length - 1]?.weaponName ?? '',
        current: runs.length,
        total: runTotal,
      })
    : t('ui.run_analysis')

  /** Shared by the per-weapon expansion and the single-weapon table. The old
   *  "N attachments" count column is now the View build action -- the build was
   *  the one thing the table held and never showed. */
  const pointColumns = useMemo(() => [
    {
      title: t('sidebar.ergonomics'),
      dataIndex: 'ergo',
      render: (v: number) => <Text style={{ color: token.colorPrimary }}>{v.toFixed(1)}</Text>,
    },
    {
      title: t('sidebar.recoil_v'),
      dataIndex: 'recoil_v',
      render: (v: number) => <Text style={{ color: token.colorSuccess }}>{v.toFixed(1)}</Text>,
    },
    {
      title: t('sidebar.recoil_h'),
      dataIndex: 'recoil_h',
      render: (v: number) => <Text>{v.toFixed(1)}</Text>,
    },
    {
      title: t('sidebar.price'),
      dataIndex: 'price',
      render: (v: number) => <Text style={{ color: token.colorWarning }}>₽{v.toLocaleString()}</Text>,
    },
    {
      // Quiet by default: a small "Approximate" tag only for a build that is not a proved optimum; the full wording is in the build's own Details.
      title: '',
      dataIndex: 'physical_certificate',
      render: (_: unknown, record: ExplorePoint) => <ApproximateTag result={record} />,
    },
    {
      title: '',
      dataIndex: 'selected_items',
      render: (_: unknown, record: ExplorePoint) => (
        <Button size="small" type="link" onClick={() => setDetailPoint(record)}>
          {t('explore.view_build', { count: record.selected_items.length })}
        </Button>
      ),
    },
    {
      title: '',
      dataIndex: 'slot_pairs',
      render: (_: unknown, record: ExplorePoint) => (
        <EftforgeButton weaponId={record.weapon_id || weaponId} placements={record.slot_pairs} />
      ),
    },
  ], [t, token, weaponId])

  if (runs.length === 0 || runs.every(r => r.response === null && r.error === undefined)) {
    return (
      <EmptyState
        icon={<BarChartOutlined />}
        description={t('explore.ready_description')}
        buttonText={actionLabel}
        buttonIcon={<BarChartOutlined />}
        loading={exploring}
        disabled={disabled}
        onAction={onExplore}
        extra={exploring && onCancelExplore ? <CancelButton size="large" onCancel={onCancelExplore} cancelling={cancellingExplore} /> : undefined}
      />
    )
  }

  const detailBuild = detailPoint ? pointAsBuild(detailPoint) : null

  return (
    // Fills the right panel exactly: the alert and the list keep their natural
    // height, the chart absorbs whatever is left, so the panel never scrolls.
    <div
      ref={setRootEl}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        height: isDesktop ? '100%' : 'auto',
        minHeight: 0,
      }}
    >
      <div ref={alertRef} style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <ExploreStatusAlert
          runs={runs}
          runTotal={runTotal}
          solveTimeMs={solveTime > 0 ? solveTime : undefined}
          exploring={exploring}
          onExplore={onExplore}
          onCancel={onCancelExplore}
          cancelling={cancellingExplore}
          actionLabel={actionLabel}
        />
      </div>
      {exploreResult.length > 0 && (
      <Card size="small" style={{ flex: '0 0 auto' }}>
        <div
          ref={plotRef}
          style={{ height: chartHeight, position: 'relative' }}
          onClick={() => {
            // A target-identity check never fires here: ResponsiveContainer covers
            // this wrapper completely, so clicks land on its svg, never on the div.
            // Both cases that must survive a background click -- the dot and the
            // panel itself -- stop propagation, so anything reaching this handler
            // is genuinely a click on empty plot.
            setPinned(null)
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: comparing ? 12 : 20, right: 20, bottom: 40, left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" dataKey={xKey} name={xLabel} domain={['auto', 'auto']} label={{ value: xLabel, position: 'bottom', offset: 20 }} />
              <YAxis type="number" dataKey={yKey} name={yLabel} domain={['auto', 'auto']} label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: -20 }} />
              {!comparing && <ZAxis type="number" dataKey="recoil_pct" />}
              <Tooltip content={({ active, payload }) => {
                if (activePin) return null
                if (active && payload && payload.length) {
                  const data = payload[0].payload as ExplorePoint
                  return (
                    <Card size="small">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {comparing && data.weapon_name && <Text strong>{data.weapon_name}</Text>}
                        <Text>{t('ui.chart_ergonomics')}: <Text strong style={{ color: token.colorPrimary }}>{data.ergo.toFixed(1)}</Text></Text>
                        <Text>{t('ui.chart_recoil_v')}: <Text strong style={{ color: token.colorSuccess }}>{data.recoil_v.toFixed(1)}</Text></Text>
                        <Text>{t('ui.chart_price')}: <Text strong style={{ color: token.colorWarning }}>₽{data.price.toLocaleString()}</Text></Text>
                        <ApproximateTag result={data} />
                      </div>
                    </Card>
                  )
                }
                return null
              }} />
              {series.map(s => (
                <Scatter
                  key={s.id}
                  name={s.name}
                  data={s.data}
                  fill={s.color}
                  line
                  isAnimationActive={!exploring}
                  style={{ cursor: 'pointer' }}
                  onClick={(_data: unknown, _index: number, event: React.MouseEvent) => {
                    const box = plotRef.current?.getBoundingClientRect()
                    const point = (_data as { payload?: ExplorePoint })?.payload
                    if (!box || !point) return
                    event.stopPropagation()
                    setPinned({ point, x: event.clientX - box.left, y: event.clientY - box.top, w: box.width, h: box.height })
                  }}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>

          {activePin && (() => {
            const W = 300
            const maxH = Math.min(280, Math.max(150, activePin.h - 24))
            // Flip to the other side of the cursor near an edge so the panel is
            // never clipped by the plot bounds.
            const flipX = activePin.x + W + 20 > activePin.w
            const left = flipX ? Math.max(8, activePin.x - W - 12) : activePin.x + 12
            const top = Math.min(Math.max(8, activePin.y - 12), Math.max(8, activePin.h - maxH - 8))
            const p = activePin.point
            return (
              <div
                onClick={e => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  left,
                  top,
                  width: W,
                  maxHeight: maxH,
                  display: 'flex',
                  flexDirection: 'column',
                  zIndex: 10,
                  background: token.colorBgElevated,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: token.borderRadius,
                  boxShadow: token.boxShadowSecondary,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 8px 4px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>
                      {p.weapon_name ?? t('explore.build_detail')}
                    </div>
                    <div style={{ fontSize: 11, marginTop: 2 }}>
                      <Text style={{ color: token.colorPrimary }}>{p.ergo.toFixed(1)}</Text>
                      {' / '}
                      <Text style={{ color: token.colorSuccess }}>{p.recoil_v.toFixed(1)}</Text>
                      {' / '}
                      <Text style={{ color: token.colorWarning }}>₽{p.price.toLocaleString()}</Text>
                    </div>
                    <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <ApproximateTag result={p} style={{ fontSize: 11 }} />
                    </div>
                  </div>
                  <Button size="small" type="text" onClick={() => setPinned(null)}>
                    ✕
                  </Button>
                </div>

                <div style={{ overflowY: 'auto', padding: '0 8px', flex: '1 1 auto', minHeight: 0 }}>
                  {p.selected_items.length === 0 ? (
                    <Text type="secondary" style={{ fontSize: 12 }}>{t('ui.none')}</Text>
                  ) : (
                    p.selected_items.map(item => (
                      <div
                        key={item.instanceId}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 8,
                          fontSize: 11,
                          padding: '2px 0',
                        }}
                      >
                        <span
                          style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}
                          title={item.name}
                        >
                          <span
                            style={{
                              width: 22,
                              height: 22,
                              flexShrink: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              overflow: 'hidden',
                              background: token.colorFillQuaternary,
                              borderRadius: 4,
                            }}
                          >
                            {item.icon ? (
                              <img
                                src={item.icon}
                                alt=""
                                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                              />
                            ) : (
                              <SettingOutlined style={{ fontSize: 11, color: token.colorTextQuaternary }} />
                            )}
                          </span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.name}
                          </span>
                        </span>
                        <Text type="secondary" style={{ flexShrink: 0, fontSize: 11 }}>
                          ₽{item.price.toLocaleString()}
                        </Text>
                      </div>
                    ))
                  )}
                </div>

                <div style={{ padding: 8 }}>
                  <Button size="small" block onClick={() => setDetailPoint(p)}>
                    {t('explore.view_build', { count: p.selected_items.length })}
                  </Button>
                </div>
              </div>
            )
          })()}
        </div>
      </Card>
      )}
      {(() => {
        type WeaponRow = (typeof weaponRows)[number]
        const table = comparing ? (
          <Table
            size="small"
            dataSource={weaponRows}
            pagination={false}
            scroll={weaponRows.length > 8 ? { y: tableScrollY } : undefined}
            expandable={{
              expandedRowRender: row => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {settledResponseOf(row.run) !== null && <CoverageDetails response={settledResponseOf(row.run) as ExploreResponse} fallbackReason={cancelReasonOf(row.run)} />}
                  {row.run.error !== undefined && <Text type="secondary">{row.run.error}</Text>}
                  {row.points.length > 0 && (
                    <Table
                      size="small"
                      dataSource={row.points.map((pt, i) => ({ ...pt, key: `${row.id}-${i}` }))}
                      pagination={false}
                      columns={pointColumns}
                    />
                  )}
                </div>
              ),
              rowExpandable: row => row.run.response !== null || row.run.error !== undefined,
            }}
            columns={[
              {
                title: t('explore.weapon'),
                dataIndex: 'name',
                render: (name: string, row: WeaponRow) => (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 8, background: row.color, flexShrink: 0 }} />
                    {name}
                  </span>
                ),
              },
              {
                // The plain status of the weapon's sweep: a check when it is complete, else the same one-line message the banner uses.
                title: t('explore.status'),
                dataIndex: 'run',
                render: (run: ExploreWeaponRun) => {
                  const line = runLineOf(run)
                  if (line === null) return <CheckCircleOutlined style={{ color: token.colorSuccess }} />
                  if (run.phase === 'running') return <Tag color="processing" style={{ margin: 0 }}>{t(line.key, line.params)}</Tag>
                  return <Text type="secondary">{t(line.key, line.params)}</Text>
                },
              },
              {
                title: t('explore.frontier_points'),
                dataIndex: 'points',
                render: (points: ExplorePoint[]) => <Text type="secondary">{points.length}</Text>,
              },
              {
                title: t('explore.best_ergo'),
                dataIndex: 'bestErgo',
                sorter: (a: WeaponRow, b: WeaponRow) => (a.bestErgo ?? -Infinity) - (b.bestErgo ?? -Infinity),
                render: (v: number | null) => (v === null ? <Text type="secondary">—</Text> : <Text style={{ color: token.colorPrimary }}>{v.toFixed(1)}</Text>),
              },
              {
                title: t('explore.lowest_recoil'),
                dataIndex: 'lowestRecoil',
                sorter: (a: WeaponRow, b: WeaponRow) => (a.lowestRecoil ?? Infinity) - (b.lowestRecoil ?? Infinity),
                render: (v: number | null) => (v === null ? <Text type="secondary">—</Text> : <Text style={{ color: token.colorSuccess }}>{v.toFixed(1)}</Text>),
              },
              {
                title: t('explore.cheapest'),
                dataIndex: 'cheapest',
                sorter: (a: WeaponRow, b: WeaponRow) => (a.cheapest ?? Infinity) - (b.cheapest ?? Infinity),
                render: (v: number | null) => (v === null ? <Text type="secondary">—</Text> : <Text style={{ color: token.colorWarning }}>₽{v.toLocaleString()}</Text>),
              },
            ]}
          />
        ) : (
          <Table
            size="small"
            dataSource={exploreResult.map((pt, i) => ({ ...pt, key: `${pt.weapon_id || weaponId || 'w'}-${i}` }))}
            pagination={exploreResult.length > 20 ? { pageSize: 15, showSizeChanger: false } : false}
            columns={pointColumns}
          />
        )

        // Collapsed, the header doubles as the chart legend; expanded, the table's
        // own first column already carries the swatches, so it becomes a plain title.
        const header = !listOpen && comparing ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center' }}>
            {weaponRows.map(row => (
              <span
                key={row.id}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
              >
                <span
                  style={{ width: 8, height: 8, borderRadius: 8, background: row.color, flexShrink: 0 }}
                />
                {row.name}
              </span>
            ))}
          </div>
        ) : (
          <span>
            {t('explore.results_list')}{' '}
            <Text type="secondary">
              {comparing ? weaponRows.length : exploreResult.length}
            </Text>
          </span>
        )

        return (
          <div ref={listRef} style={{ flex: '0 0 auto' }}>
          <Collapse
            activeKey={listOpen ? ['list'] : []}
            onChange={keys => setListOpen(keys.length > 0)}
            items={[{ key: 'list', label: header, children: table }]}
          />
          </div>
        )
      })()}

      <Drawer
        open={detailPoint != null}
        onClose={() => setDetailPoint(null)}
        size="min(760px, 96vw)"
        title={detailPoint ? (detailPoint.weapon_name ?? t('explore.build_detail')) : ''}
      >
        {detailPoint && detailBuild && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <ApproximateTag result={detailPoint} />
              <DetailsPanel>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <AuthorityTag result={detailPoint} />
                  <QualifierTags qualifiers={qualifiersOf(detailPoint)} />
                  <ReasonText reason={reasonViewOf(detailPoint.reason)} />
                </div>
              </DetailsPanel>
            </div>
            {detailPoint.selected_preset && (
              <UsingPresetCard
                preset={detailPoint.selected_preset}
                retainedItems={partitionManifest(detailBuild).preset}
                usage={presetUsage(detailBuild)}
                compactMode={manifestView === 'compact' || manifestView === 'table'}
                viewMode={manifestView}
              />
            )}
            <BuildManifest
              result={detailBuild}
              viewMode={manifestView}
              onViewModeChange={setManifestView}
              weaponId={detailPoint.weapon_id || weaponId}
            />
          </div>
        )}
      </Drawer>
    </div>
  )
}
