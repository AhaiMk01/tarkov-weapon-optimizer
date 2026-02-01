import { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

interface TernaryPlotProps {
  ergoWeight: number;
  recoilWeight: number;
  priceWeight: number;
  onChange: (ergo: number, recoil: number, price: number) => void;
}

export function TernaryPlot({ ergoWeight, recoilWeight, priceWeight, onChange }: TernaryPlotProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredPoint, setHoveredPoint] = useState<{ ergo: number; recoil: number; price: number } | null>(null);

  // Triangle dimensions
  const size = 300;
  const padding = 70;
  const sideLength = size - padding * 2;
  const height = sideLength * (Math.sqrt(3) / 2);
  const verticalOffset = (sideLength - height) / 2;

  // Corner positions (equilateral triangle)
  // Top: Ergo, Bottom-Left: Price, Bottom-Right: Recoil
  const topX = size / 2;
  const topY = padding + verticalOffset;
  const leftX = padding;
  const leftY = topY + height;
  const rightX = size - padding;
  const rightY = topY + height;

  // Convert barycentric coordinates (ergo, recoil, price) to SVG coordinates
  const toSVG = useCallback((ergo: number, recoil: number, price: number) => {
    const total = ergo + recoil + price;
    const e = ergo / total;
    const r = recoil / total;
    const p = price / total;

    const x = e * topX + r * rightX + p * leftX;
    const y = e * topY + r * rightY + p * leftY;
    return { x, y };
  }, []);

  // Convert SVG coordinates to barycentric coordinates
  const toBarycentric = useCallback((x: number, y: number) => {
    // Vectors from Left corner relative to Top and Right
    // Left is origin for this calculation (p=1 at 0,0 relative)
    const x1 = topX - leftX;
    const y1 = topY - leftY;
    const x2 = rightX - leftX;
    const y2 = rightY - leftY;
    
    // Target point vector from Left
    const xp = x - leftX;
    const yp = y - leftY;

    // Determinant (Cross product of the two basis vectors)
    const det = x1 * y2 - x2 * y1;

    // Solve using Cramer's rule
    const e = (xp * y2 - yp * x2) / det;
    const r = (x1 * yp - y1 * xp) / det;
    const p = 1 - e - r;

    return { e: Math.max(0, Math.min(1, e)), r: Math.max(0, Math.min(1, r)), p: Math.max(0, Math.min(1, p)) };
  }, [topX, topY, leftX, leftY, rightX, rightY]);

  // Handle click on the triangle
  const handleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const scaleX = size / rect.width;
    const scaleY = size / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const { e: ergo, r: recoil, p: price } = toBarycentric(x, y);

    // Convert to 0-100 scale
    const total = ergo + recoil + price;
    const ergoNorm = Math.round((ergo / total) * 100);
    const recoilNorm = Math.round((recoil / total) * 100);
    const finalPrice = 100 - ergoNorm - recoilNorm;

    // Ensure all values are valid
    const finalErgo = Math.max(1, Math.min(98, ergoNorm));
    const finalRecoil = Math.max(1, Math.min(98, recoilNorm));

    onChange(finalErgo, finalRecoil, finalPrice);
  }, [onChange, toBarycentric]);

  // Handle mouse move for hover preview
  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const scaleX = size / rect.width;
    const scaleY = size / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const { e: ergo, r: recoil, p: price } = toBarycentric(x, y);

    // Check if point is inside triangle
    if (ergo >= 0 && recoil >= 0 && price >= 0) {
      const total = ergo + recoil + price;
      const ergoNorm = Math.round((ergo / total) * 100);
      const recoilNorm = Math.round((recoil / total) * 100);
      const priceNorm = 100 - ergoNorm - recoilNorm;
      setHoveredPoint({ ergo: ergoNorm, recoil: recoilNorm, price: priceNorm });
    } else {
      setHoveredPoint(null);
    }
  }, [toBarycentric]);

  // Grid lines for the ternary plot
  const gridLines = [];
  for (let i = 1; i < 10; i++) {
    const t = i / 10;
    // Lines parallel to each side
    // Top side (parallel to bottom)
    const topStart = toSVG(1 - t, t, 0);
    const topEnd = toSVG(1 - t, 0, t);
    gridLines.push(<line key={`top-${i}`} x1={topStart.x} y1={topStart.y} x2={topEnd.x} y2={topEnd.y} stroke="currentColor" strokeOpacity={0.15} strokeWidth={0.5} />);

    // Bottom side (parallel to top)
    const bottomStart = toSVG(t, 0, 1 - t);
    const bottomEnd = toSVG(0, t, 1 - t);
    gridLines.push(<line key={`bottom-${i}`} x1={bottomStart.x} y1={bottomStart.y} x2={bottomEnd.x} y2={bottomEnd.y} stroke="currentColor" strokeOpacity={0.15} strokeWidth={0.5} />);

    // Left side (parallel to right)
    const leftStart = toSVG(t, 1 - t, 0);
    const leftEnd = toSVG(0, 1 - t, t);
    gridLines.push(<line key={`left-${i}`} x1={leftStart.x} y1={leftStart.y} x2={leftEnd.x} y2={leftEnd.y} stroke="currentColor" strokeOpacity={0.15} strokeWidth={0.5} />);
  }

  // Active point (hover or current)
  const displayPoint = hoveredPoint || { ergo: ergoWeight, recoil: recoilWeight, price: priceWeight };
  const displaySVG = toSVG(displayPoint.ergo, displayPoint.recoil, displayPoint.price);

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${size} ${size}`}
        className="w-full h-auto cursor-crosshair select-none"
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredPoint(null)}
      >
        {/* Background triangle */}
        <polygon
          points={`${topX},${topY} ${rightX},${rightY} ${leftX},${leftY}`}
          className="fill-zinc-100 dark:fill-zinc-800 stroke-zinc-300 dark:stroke-zinc-700"
          strokeWidth={1.5}
        />

        {/* Grid lines */}
        <g className="text-zinc-500">
          {gridLines}
        </g>

        {/* Corner labels */}
        <g className="text-xs font-semibold select-none">
          {/* Top (Ergo) */}
          <text x={topX} y={topY - 8} textAnchor="middle" className="fill-blue-500">
            {t('sidebar.ergonomics', 'Ergo')}
          </text>
          <text x={topX} y={topY + 14} textAnchor="middle" className="fill-blue-500 text-[10px] opacity-70">
            {displayPoint.ergo}%
          </text>

          {/* Bottom-Right (Recoil) */}
          <text x={rightX + 15} y={rightY + 4} className="fill-green-500">
            {t('optimize.preset_recoil', 'Recoil')}
          </text>
          <text x={rightX + 15} y={rightY + 18} className="fill-green-500 text-[10px] opacity-70">
            {displayPoint.recoil}%
          </text>

          {/* Bottom-Left (Price) */}
          <text x={leftX - 15} y={leftY + 4} textAnchor="end" className="fill-yellow-500">
            {t('sidebar.price', 'Price')}
          </text>
          <text x={leftX - 15} y={leftY + 18} textAnchor="end" className="fill-yellow-500 text-[10px] opacity-70">
            {displayPoint.price}%
          </text>
        </g>

        {/* Current point indicator */}
        <circle
          cx={displaySVG.x}
          cy={displaySVG.y}
          r={6}
          className="fill-orange-500 stroke-white dark:stroke-zinc-900 stroke-2"
        />
      </svg>

      {/* Hint text */}
      <p className="text-[10px] text-zinc-500 text-center mt-2">
        {t('optimize.triangle_hint', 'Click on the triangle to adjust weights')}
      </p>
    </div>
  );
}
