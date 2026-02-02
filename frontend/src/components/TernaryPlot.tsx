import { useState, useRef, useCallback } from 'react'
import { theme } from 'antd'
import { useTranslation } from 'react-i18next'

const { useToken } = theme

interface TernaryPlotProps {
  ergoWeight: number
  recoilWeight: number
  priceWeight: number
  onChange: (ergo: number, recoil: number, price: number) => void
}

const size = 300
const padding = 70
const sideLength = size - padding * 2
const height = sideLength * (Math.sqrt(3) / 2)
const verticalOffset = (sideLength - height) / 2
const topX = size / 2
const topY = padding + verticalOffset
const leftX = padding
const leftY = topY + height
const rightX = size - padding
const rightY = topY + height

export function TernaryPlot({ ergoWeight, recoilWeight, priceWeight, onChange }: TernaryPlotProps) {
  const { t } = useTranslation()
  const { token } = useToken()
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoveredPoint, setHoveredPoint] = useState<{ ergo: number; recoil: number; price: number } | null>(null)
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
  const handleClick = useCallback((ev: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const scaleX = size / rect.width
    const scaleY = size / rect.height
    const x = (ev.clientX - rect.left) * scaleX
    const y = (ev.clientY - rect.top) * scaleY
    const { e: ergo, r: recoil, p: price } = toBarycentric(x, y)
    const total = ergo + recoil + price
    const ergoNorm = Math.round((ergo / total) * 100)
    const recoilNorm = Math.round((recoil / total) * 100)
    const finalPrice = 100 - ergoNorm - recoilNorm
    const finalErgo = Math.max(1, Math.min(98, ergoNorm))
    const finalRecoil = Math.max(1, Math.min(98, recoilNorm))
    onChange(finalErgo, finalRecoil, finalPrice)
  }, [onChange, toBarycentric])
  const handleMouseMove = useCallback((ev: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const scaleX = size / rect.width
    const scaleY = size / rect.height
    const x = (ev.clientX - rect.left) * scaleX
    const y = (ev.clientY - rect.top) * scaleY
    const { e: ergo, r: recoil, p: price } = toBarycentric(x, y)
    if (ergo >= 0 && recoil >= 0 && price >= 0) {
      const total = ergo + recoil + price
      const ergoNorm = Math.round((ergo / total) * 100)
      const recoilNorm = Math.round((recoil / total) * 100)
      const priceNorm = 100 - ergoNorm - recoilNorm
      setHoveredPoint({ ergo: ergoNorm, recoil: recoilNorm, price: priceNorm })
    } else {
      setHoveredPoint(null)
    }
  }, [toBarycentric])
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
  const displayPoint = hoveredPoint || { ergo: ergoWeight, recoil: recoilWeight, price: priceWeight }
  const displaySVG = toSVG(displayPoint.ergo, displayPoint.recoil, displayPoint.price)
  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${size} ${size}`}
        style={{ width: '100%', height: 'auto', cursor: 'crosshair', userSelect: 'none' }}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredPoint(null)}
      >
        <polygon
          points={`${topX},${topY} ${rightX},${rightY} ${leftX},${leftY}`}
          fill={token.colorBgContainer}
          stroke={token.colorBorder}
          strokeWidth={1.5}
        />
        <g>{gridLines}</g>
        <g style={{ fontSize: 12, fontWeight: 600 }}>
          <text x={topX} y={topY - 8} textAnchor="middle" fill={token.colorPrimary}>
            {t('sidebar.ergonomics', '人机')}
          </text>
          <text x={topX} y={topY + 14} textAnchor="middle" fill={token.colorPrimary} style={{ fontSize: 10, opacity: 0.7 }}>
            {displayPoint.ergo}%
          </text>
          <text x={rightX + 15} y={rightY + 4} fill={token.colorSuccess}>
            {t('optimize.preset_recoil', '后坐')}
          </text>
          <text x={rightX + 15} y={rightY + 18} fill={token.colorSuccess} style={{ fontSize: 10, opacity: 0.7 }}>
            {displayPoint.recoil}%
          </text>
          <text x={leftX - 15} y={leftY + 4} textAnchor="end" fill={token.colorWarning}>
            {t('sidebar.price', '价格')}
          </text>
          <text x={leftX - 15} y={leftY + 18} textAnchor="end" fill={token.colorWarning} style={{ fontSize: 10, opacity: 0.7 }}>
            {displayPoint.price}%
          </text>
        </g>
        <circle cx={displaySVG.x} cy={displaySVG.y} r={6} fill={token.colorWarning} stroke={token.colorBgContainer} strokeWidth={2} />
      </svg>
    </div>
  )
}
