import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Card, Collapse, Drawer, Grid, Space, Table, Tag, Typography, theme } from 'antd'
import { BarChartOutlined, CheckCircleOutlined, ExclamationCircleOutlined, ExportOutlined, SettingOutlined, StopOutlined } from '@ant-design/icons'
import { compressToEncodedURIComponent } from 'lz-string'
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from 'recharts'
import { EmptyState } from '../common/EmptyState'
import { BuildManifest } from '../common/BuildManifest'
import type { ExplorePoint, OptimizeResponse, SolverPrecisionMode } from '../../api/client'
import { paletteColorAt, seriesPalette } from './palette'

const { Text } = Typography
const { useToken } = theme

export interface ExploreProgress {
  current: number
  total: number
  name: string
}

interface ExploreResultProps {
  exploreResult: ExplorePoint[]
  solveTime?: number
  explorePrecision?: { request?: SolverPrecisionMode; resolved?: 'fast' | 'precise' }
  resultTradeoff: 'price' | 'recoil' | 'ergo'
  exploring: boolean
  exploreProgress?: ExploreProgress | null
  onExplore: () => void
  /** Stops an in-flight run; partial results stay on screen. */
  onCancelExplore?: () => void
  disabled: boolean
  weaponId?: string
  /** Weapon ids requested for the current/last Explore run (denominator for n/m status). */
  runWeaponIds?: string[]
}

function precisionResolvedLabel(t: (k: string, opts?: Record<string, string>) => string, mode: 'fast' | 'precise'): string {
  return mode === 'precise' ? t('sidebar.precise') : t('sidebar.fast')
}

const EFTFORGE_URL = 'https://www.eftforge.com'

/**
 * An Explore point already carries the whole build -- BuildManifest only reads
 * slot_pairs, selected_preset and selected_items -- so the detail view is a
 * re-render of data we already hold, not another solve.
 */
function pointAsBuild(point: ExplorePoint): OptimizeResponse {
  return {
    status: point.status,
    selected_items: point.selected_items,
    selected_preset: point.selected_preset,
    slot_pairs: point.slot_pairs,
    objective_value: 0,
    // final_stats is deliberately omitted: an ExplorePoint carries no weight or
    // MOA, and filling them with zeros would report every Explore build as 0 kg
    // at 0 MOA the moment BuildManifest starts showing those fields.
  }
}

function xKeyOf(tradeoff: 'price' | 'recoil' | 'ergo'): 'ergo' | 'recoil_v' {
  return tradeoff === 'ergo' ? 'recoil_v' : 'ergo'
}

export function ExploreResult({
  exploreResult,
  solveTime,
  explorePrecision,
  resultTradeoff,
  exploring,
  exploreProgress,
  onExplore,
  onCancelExplore,
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


  const runTotal = Math.max(runWeaponIds?.length ?? 0, series.length)
  const returned = series.length
  const comparing = runTotal > 1
  const allOptimal = exploreResult.length > 0 && exploreResult.every(p => p.status === 'optimal')
  const [detailPoint, setDetailPoint] = useState<ExplorePoint | null>(null)
  /** Point pinned by clicking it in the plot, with the click position so the
   *  panel can sit next to it. Coordinates are relative to the plot wrapper. */
  const [pinned, setPinned] = useState<{ point: ExplorePoint; x: number; y: number } | null>(null)
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
  const [chartHeight, setChartHeight] = useState(400)
  const [tableScrollY, setTableScrollY] = useState(320)

  useLayoutEffect(() => {
    const root = rootEl
    if (!root || !isDesktop) {
      setChartHeight(400)
      setTableScrollY(320)
      return
    }
    const GAPS = 32 // two 16px flex gaps
    const CARD_CHROME = 26 // Card body padding around the plot
    const CHART_FLOOR = 220
    const LIST_CHROME = 116 // collapse header + table head + padding + borders
    const measure = () => {
      const budget =
        root.clientHeight - (alertRef.current?.offsetHeight ?? 0) - GAPS - CARD_CHROME
      const available = budget - (listRef.current?.offsetHeight ?? 0)
      setChartHeight(Math.max(CHART_FLOOR, Math.round(available)))
      // Derived from the same budget rather than from the list's own height, so
      // the two measurements cannot feed each other into a resize loop.
      setTableScrollY(Math.round(Math.min(320, Math.max(160, budget - CHART_FLOOR - LIST_CHROME))))
    }
    measure()
    // Observing the list covers expand/collapse without depending on listOpen.
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    if (alertRef.current) ro.observe(alertRef.current)
    if (listRef.current) ro.observe(listRef.current)
    return () => ro.disconnect()
  }, [rootEl, isDesktop])
  // The panel is positioned from the pixel coordinates of the click. Resizing the
  // plot -- which the collapse toggle does, 525px <-> 220px -- rescales the axes
  // and moves every dot, so those coordinates no longer point at anything. Drop
  // the pin rather than leave it hovering over empty space.
  useEffect(() => {
    setPinned(null)
  }, [chartHeight])
  // Streaming setExploreResult([...allPoints]) keeps the same point objects, so a
  // pin must survive identity changes of the array. Drop it only when the run is
  // cleared or the pinned point is no longer in the frontier.
  useEffect(() => {
    if (exploreResult.length === 0) {
      setPinned(null)
      return
    }
    setPinned(prev => {
      if (!prev) return prev
      return exploreResult.includes(prev.point) ? prev : null
    })
  }, [exploreResult])
  const [manifestView, setManifestView] = useState<'detailed' | 'compact' | 'table'>('detailed')

  /** One row per weapon instead of one per frontier point: 16 weapons produced
   *  120 paginated rows, most of which just restate the chart's axes. */
  const weaponRows = useMemo(() => series.map(s => ({
    key: s.id,
    id: s.id,
    name: s.name,
    color: s.color,
    points: s.data,
    bestErgo: s.data.length ? Math.max(...s.data.map(p => p.ergo)) : 0,
    lowestRecoil: s.data.length ? Math.min(...s.data.map(p => p.recoil_v)) : 0,
    cheapest: s.data.length ? Math.min(...s.data.map(p => p.price)) : 0,
  })), [series])
  const actionLabel = exploring && exploreProgress && exploreProgress.total > 1
    ? t('explore.comparing', {
        name: exploreProgress.name,
        current: exploreProgress.current,
        total: exploreProgress.total,
      })
    : t('ui.run_analysis')

  const handleOpenInEFTForge = (point: ExplorePoint) => {
    const forgeWeaponId = point.weapon_id || weaponId
    if (!forgeWeaponId || !point.slot_pairs?.length) return
    const payload = { v: 1, g: forgeWeaponId, p: point.slot_pairs }
    const code = compressToEncodedURIComponent(JSON.stringify(payload))
    window.open(`${EFTFORGE_URL}?build=${code}`, '_blank')
  }

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
      render: (_: unknown, record: ExplorePoint) =>
        (record.weapon_id || weaponId) && record.slot_pairs?.length ? (
          <Button size="small" icon={<ExportOutlined />} onClick={() => handleOpenInEFTForge(record)}>
            EFTForge
          </Button>
        ) : null,
    },
  // handleOpenInEFTForge is stable for a given weaponId; it only reads props
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, token, weaponId])

  if (exploreResult.length === 0) {
    return (
      <EmptyState
        icon={<BarChartOutlined />}
        description={t('explore.ready_description')}
        buttonText={actionLabel}
        buttonIcon={<BarChartOutlined />}
        loading={exploring}
        disabled={disabled}
        onAction={onExplore}
        extra={exploring && onCancelExplore ? (
          <Button danger size="large" icon={<StopOutlined />} onClick={onCancelExplore}>
            {t('explore.cancel_run')}
          </Button>
        ) : undefined}
      />
    )
  }

  const statusComplete = returned === runTotal && allOptimal
  const statusText = comparing
    ? `${t('explore.compare_status', { returned, total: runTotal })} · ${allOptimal ? t('results.status_optimal') : t('results.status_feasible')}`
    : `${t('results.optimization_status')}: ${allOptimal ? t('results.status_optimal') : t('results.status_feasible')}`

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
      <div ref={alertRef} style={{ flex: '0 0 auto' }}>
      <Alert
        type={statusComplete ? 'success' : 'warning'}
        message={
          <>
            <Text>{statusText}</Text>
            {solveTime != null && <Tag color="blue" style={{ marginLeft: 8 }}>{solveTime.toFixed(0)} ms</Tag>}
            {!comparing && explorePrecision?.request === 'auto' && explorePrecision.resolved && (
              <Tag color="processing" style={{ marginLeft: 8 }} title={t('sidebar.solver_precision_tooltip')}>
                {t('results.precision_auto_ran', {
                  mode: precisionResolvedLabel(t, explorePrecision.resolved),
                })}
              </Tag>
            )}
          </>
        }
        icon={statusComplete ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
        showIcon
        action={
          <Space>
            <Button type="primary" icon={<BarChartOutlined />} loading={exploring} onClick={onExplore}>
              {actionLabel}
            </Button>
            {exploring && onCancelExplore && (
              // The primary button is loading-locked while a run is in flight, so
              // without this there is no way to stop a long multi-weapon sweep.
              <Button danger icon={<StopOutlined />} onClick={onCancelExplore}>
                {t('explore.cancel_run')}
              </Button>
            )}
          </Space>
        }
      />
      </div>
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
                if (pinned) return null
                if (active && payload && payload.length) {
                  const data = payload[0].payload as ExplorePoint
                  return (
                    <Card size="small">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {comparing && data.weapon_name && <Text strong>{data.weapon_name}</Text>}
                        <Text>{t('ui.chart_ergonomics')}: <Text strong style={{ color: token.colorPrimary }}>{data.ergo.toFixed(1)}</Text></Text>
                        <Text>{t('ui.chart_recoil_v')}: <Text strong style={{ color: token.colorSuccess }}>{data.recoil_v.toFixed(1)}</Text></Text>
                        <Text>{t('ui.chart_price')}: <Text strong style={{ color: token.colorWarning }}>₽{data.price.toLocaleString()}</Text></Text>
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
                  style={{ cursor: 'pointer' }}
                  onClick={(_data: unknown, _index: number, event: React.MouseEvent) => {
                    const box = plotRef.current?.getBoundingClientRect()
                    const point = (_data as { payload?: ExplorePoint })?.payload
                    if (!box || !point) return
                    event.stopPropagation()
                    setPinned({ point, x: event.clientX - box.left, y: event.clientY - box.top })
                  }}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>

          {pinned && (() => {
            const W = 300
            const box = plotRef.current?.getBoundingClientRect()
            const maxH = Math.min(280, Math.max(150, (box?.height ?? chartHeight) - 24))
            // Flip to the other side of the cursor near an edge so the panel is
            // never clipped by the plot bounds.
            const flipX = box ? pinned.x + W + 20 > box.width : false
            const left = flipX ? Math.max(8, pinned.x - W - 12) : pinned.x + 12
            const top = Math.min(Math.max(8, pinned.y - 12), Math.max(8, (box?.height ?? chartHeight) - maxH - 8))
            const p = pinned.point
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
                        key={item.id}
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
      {(() => {
        const table = comparing ? (
          <Table
            size="small"
            dataSource={weaponRows}
            pagination={false}
            scroll={weaponRows.length > 8 ? { y: tableScrollY } : undefined}
            expandable={{
              expandedRowRender: row => (
                <Table
                  size="small"
                  dataSource={row.points.map((pt, i) => ({ ...pt, key: `${row.id}-${i}` }))}
                  pagination={false}
                  columns={pointColumns}
                />
              ),
              rowExpandable: row => row.points.length > 0,
            }}
            columns={[
              {
                title: t('explore.weapon'),
                dataIndex: 'name',
                render: (name: string, row: (typeof weaponRows)[number]) => (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 8, background: row.color, flexShrink: 0 }} />
                    {name}
                  </span>
                ),
              },
              {
                title: t('explore.frontier_points'),
                dataIndex: 'points',
                render: (points: ExplorePoint[]) => <Text type="secondary">{points.length}</Text>,
              },
              {
                title: t('explore.best_ergo'),
                dataIndex: 'bestErgo',
                sorter: (a: (typeof weaponRows)[number], b: (typeof weaponRows)[number]) => a.bestErgo - b.bestErgo,
                render: (v: number) => <Text style={{ color: token.colorPrimary }}>{v.toFixed(1)}</Text>,
              },
              {
                title: t('explore.lowest_recoil'),
                dataIndex: 'lowestRecoil',
                sorter: (a: (typeof weaponRows)[number], b: (typeof weaponRows)[number]) => a.lowestRecoil - b.lowestRecoil,
                render: (v: number) => <Text style={{ color: token.colorSuccess }}>{v.toFixed(1)}</Text>,
              },
              {
                title: t('explore.cheapest'),
                dataIndex: 'cheapest',
                sorter: (a: (typeof weaponRows)[number], b: (typeof weaponRows)[number]) => a.cheapest - b.cheapest,
                render: (v: number) => <Text style={{ color: token.colorWarning }}>₽{v.toLocaleString()}</Text>,
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
        width="min(760px, 96vw)"
        title={detailPoint ? (detailPoint.weapon_name ?? t('explore.build_detail')) : ''}
      >
        {detailPoint && (
          <BuildManifest
            result={pointAsBuild(detailPoint)}
            viewMode={manifestView}
            onViewModeChange={setManifestView}
            weaponId={detailPoint.weapon_id || weaponId}
          />
        )}
      </Drawer>
    </div>
  )
}
