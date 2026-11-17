import { useState, useRef, useCallback, useId } from 'react'
import { theme } from 'antd'
import { useTranslation } from 'react-i18next'
import { stepWeights, TERNARY_KEYS, type TernaryKey } from './ternaryKeys'

const { useToken } = theme

interface TernaryPlotProps {
  ergoWeight: number
  recoilWeight: number
  priceWeight: number
  onChange: (ergo: number, recoil: number, price: number) => void
}

const width = 300
const paddingX = 50
const paddingTop = 38
const paddingBottom = 25
const sideLength = width - paddingX * 2
const triangleHeight = sideLength * (Math.sqrt(3) / 2)
const height = paddingTop + triangleHeight + paddingBottom
const topX = width / 2
const topY = paddingTop
const leftX = paddingX
const leftY = paddingTop + triangleHeight
const rightX = width - paddingX
const rightY = paddingTop + triangleHeight

export function TernaryPlot({ ergoWeight, recoilWeight, priceWeight, onChange }: TernaryPlotProps) {
  const { t } = useTranslation()
  const { token } = useToken()
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState(false)
  const toSVG = useCallback((ergo: number, recoil: number, price: number) => {
    const total = ergo + recoil + price
    const e = ergo / total
    const r = recoil / total
    const p = price / total
    const x = e * topX + r * rightX + p * leftX
    const y = e * topY + r * rightY + p * leftY
    return { x, y }
  }, [])
  const toBarycentric = useCallback((x: number, y: number) => {
    const x1 = topX - leftX
    const y1 = topY - leftY
    const x2 = rightX - leftX
    const y2 = rightY - leftY
    const xp = x - leftX
    const yp = y - leftY
    const det = x1 * y2 - x2 * y1
    const e = (xp * y2 - yp * x2) / det
    const r = (x1 * yp - y1 * xp) / det
    const p = 1 - e - r
    return { e: Math.max(0, Math.min(1, e)), r: Math.max(0, Math.min(1, r)), p: Math.max(0, Math.min(1, p)) }
  }, [])
  const svgCoords = useCallback((ev: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    const scaleX = width / rect.width
    const scaleY = height / rect.height
    const x = (ev.clientX - rect.left) * scaleX
    const y = (ev.clientY - rect.top) * scaleY
    return { x, y }
  }, [])
  const applyPoint = useCallback((ev: React.PointerEvent<SVGSVGElement>) => {
    const coords = svgCoords(ev)
    if (!coords) return
    const { e: ergo, r: recoil, p: price } = toBarycentric(coords.x, coords.y)
    const total = ergo + recoil + price
    const ergoNorm = Math.round((ergo / total) * 100)
    const recoilNorm = Math.round((recoil / total) * 100)
    const priceNorm = 100 - ergoNorm - recoilNorm
    onChange(ergoNorm, recoilNorm, priceNorm)
  }, [onChange, toBarycentric, svgCoords])
  const handlePointerDown = useCallback((ev: React.PointerEvent<SVGSVGElement>) => {
    ev.preventDefault()
    ev.currentTarget.setPointerCapture(ev.pointerId)
    setDragging(true)
    applyPoint(ev)
  }, [applyPoint])
  const handlePointerMove = useCallback((ev: React.PointerEvent<SVGSVGElement>) => {
    if (ev.currentTarget.hasPointerCapture(ev.pointerId)) applyPoint(ev)
  }, [applyPoint])
  const gridLines = []
  for (let i = 1; i < 10; i++) {
    const t = i / 10
    const topStart = toSVG(1 - t, t, 0)
    const topEnd = toSVG(1 - t, 0, t)
    gridLines.push(<line key={`top-${i}`} x1={topStart.x} y1={topStart.y} x2={topEnd.x} y2={topEnd.y} stroke={token.colorBorderSecondary} strokeWidth={0.5} />)
    const bottomStart = toSVG(t, 0, 1 - t)
    const bottomEnd = toSVG(0, t, 1 - t)
    gridLines.push(<line key={`bottom-${i}`} x1={bottomStart.x} y1={bottomStart.y} x2={bottomEnd.x} y2={bottomEnd.y} stroke={token.colorBorderSecondary} strokeWidth={0.5} />)
    const leftStart = toSVG(t, 1 - t, 0)
    const leftEnd = toSVG(0, 1 - t, t)
    gridLines.push(<line key={`left-${i}`} x1={leftStart.x} y1={leftStart.y} x2={leftEnd.x} y2={leftEnd.y} stroke={token.colorBorderSecondary} strokeWidth={0.5} />)
  }
  const displaySVG = toSVG(ergoWeight, recoilWeight, priceWeight)
  const total = ergoWeight + recoilWeight + priceWeight
  const pctErgo = total > 0 ? Math.round(ergoWeight / total * 100) : 33
  const pctRecoil = total > 0 ? Math.round(recoilWeight / total * 100) : 34
  const pctPrice = total > 0 ? 100 - pctErgo - pctRecoil : 33
  const summary = `${t('sidebar.ergonomics')} ${pctErgo}%, ${t('item.recoil')} ${pctRecoil}%, ${t('sidebar.price')} ${pctPrice}%`
  const hintId = useId()
  const handleKeyDown = (ev: React.KeyboardEvent<SVGSVGElement>) => {
    if (ev.ctrlKey || ev.altKey || ev.metaKey || !TERNARY_KEYS.includes(ev.key)) return
    ev.preventDefault()
    const from = { ergo: pctErgo, recoil: pctRecoil, price: pctPrice }
    const to = stepWeights(from, ev.key as TernaryKey, ev.shiftKey)
    if (to.ergo !== from.ergo || to.recoil !== from.recoil || to.price !== from.price) onChange(to.ergo, to.recoil, to.price)
  }
  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        className="ternary-plot"
        role="group"
        tabIndex={0}
        aria-label={summary}
        aria-describedby={hintId}
        onKeyDown={handleKeyDown}
        viewBox={`0 0 ${width} ${height}`}
        style={{ '--ternary-ring': token.colorPrimary, width: '100%', height: 'auto', cursor: dragging ? 'grabbing' : 'crosshair', userSelect: 'none', touchAction: 'none' } as React.CSSProperties}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => setDragging(false)}
        onLostPointerCapture={() => setDragging(false)}
      >
        <polygon
          points={`${topX},${topY} ${rightX},${rightY} ${leftX},${leftY}`}
          fill={token.colorBgContainer}
          stroke={token.colorBorder}
          strokeWidth={1.5}
        />
        <g>{gridLines}</g>
        <g style={{ fontSize: 12, fontWeight: 600 }}>
          <text x={topX} y={topY - 22} textAnchor="middle" fill={token.colorPrimary} style={{ fontSize: 11, opacity: 0.85 }}>
            {pctErgo}%
          </text>
          <text x={topX} y={topY - 6} textAnchor="middle" fill={token.colorPrimary}>
            {t('sidebar.ergonomics')}
          </text>
          <text x={rightX + 15} y={rightY + 4} fill={token.colorSuccess}>
            {t('item.recoil')}
          </text>
          <text x={rightX + 15} y={rightY + 18} fill={token.colorSuccess} style={{ fontSize: 10, opacity: 0.7 }}>
            {pctRecoil}%
          </text>
          <text x={leftX - 15} y={leftY + 4} textAnchor="end" fill={token.colorWarning}>
            {t('sidebar.price')}
          </text>
          <text x={leftX - 15} y={leftY + 18} textAnchor="end" fill={token.colorWarning} style={{ fontSize: 10, opacity: 0.7 }}>
            {pctPrice}%
          </text>
        </g>
        <circle cx={displaySVG.x} cy={displaySVG.y} r={6} fill={token.colorWarning} stroke={token.colorBgContainer} strokeWidth={2} style={{ pointerEvents: 'none' }} />
      </svg>
      <span id={hintId} className="visually-hidden">{t('ui.ternary_hint')}</span>
      <span className="visually-hidden" aria-live="polite">{summary}</span>
    </div>
  )
}
