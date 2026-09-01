import { hcl, rgb } from 'd3-color'

/**
 * Categorical colours for Explore's per-weapon series.
 *
 * The colour for a series depends only on its index, never on how many series
 * there are. That matters because Explore has no weapon cap any more: adding a
 * 16th weapon must not repaint the other fifteen, which is what an "N evenly
 * spaced hues" scheme does every time the count changes.
 *
 * Indices 0-5 keep the curated theme colours so the common small comparison looks
 * exactly as before. Past that, each colour is chosen by farthest-point selection
 * over a hue x lightness grid, maximising its perceptual distance to every colour
 * already in use -- the curated ones included.
 *
 * Spacing hues alone is not sufficient: at ~20 series the wheel is subdivided
 * finely enough that two entries can sit on neighbouring hues and also draw the
 * same lightness, which reads as one colour. Scoring in Lab handles hue and
 * lightness together.
 *
 * Generated in CIE HCL rather than HSL: HSL lightness is not perceptual, so a
 * yellow and a blue at the same "L" differ wildly in apparent brightness and the
 * chart reads as if some series are emphasised.
 */

export interface PaletteTokens {
  colorWarning: string
  colorInfo: string
  colorSuccess: string
  colorError: string
}

/** Chroma that stays inside sRGB across the whole hue circle at these lightnesses;
 *  higher values clip, and clipped colours collapse toward each other. */
const GENERATED_CHROMA = 42

function curatedColors(token: PaletteTokens): string[] {
  return [
    token.colorWarning,
    token.colorInfo,
    token.colorSuccess,
    token.colorError,
    '#a855f7',
    '#06b6d4',
  ]
}

/** Candidate grid. Lightness range stays clear of the axis/background extremes so
 *  every entry remains legible as a 6px dot on the chart. */
const CANDIDATE_LIGHTNESS = [78, 70, 62, 54, 46]
const CANDIDATE_HUE_STEP = 5

interface Lab {
  l: number
  a: number
  b: number
}

function toLab(color: string): Lab | null {
  const c = hcl(color)
  if (Number.isNaN(c.h) || Number.isNaN(c.l)) return null
  const rad = (c.h * Math.PI) / 180
  return { l: c.l, a: c.c * Math.cos(rad), b: c.c * Math.sin(rad) }
}

function deltaE(x: Lab, y: Lab): number {
  const dl = x.l - y.l
  const da = x.a - y.a
  const db = x.b - y.b
  return Math.sqrt(dl * dl + da * da + db * db)
}

/** d3 clamps out-of-gamut conversions on format, and clamped colours collapse
 *  toward each other -- so reject them rather than emit near-duplicates. */
function inGamut(h: number, c: number, l: number): boolean {
  const { r, g, b } = rgb(hcl(h, c, l))
  return [r, g, b].every(v => v >= 0 && v <= 255)
}

/**
 * Colours are built as a prefix: entry `n` only depends on entries before it, so
 * `seriesColorAt(token, n)` is the same value no matter how many series exist.
 */
function buildPalette(token: PaletteTokens, count: number): string[] {
  const curated = curatedColors(token)
  const out = curated.slice(0, Math.min(count, curated.length))
  if (count <= curated.length) return out

  const used = curated.map(toLab).filter((c): c is Lab => c != null)

  while (out.length < count) {
    let best: { color: string; lab: Lab; score: number } | null = null
    for (let hue = 0; hue < 360; hue += CANDIDATE_HUE_STEP) {
      for (const lightness of CANDIDATE_LIGHTNESS) {
        if (!inGamut(hue, GENERATED_CHROMA, lightness)) continue
        const color = hcl(hue, GENERATED_CHROMA, lightness)
        const lab = toLab(color.formatHex())
        if (!lab) continue
        let score = Infinity
        for (const u of used) score = Math.min(score, deltaE(lab, u))
        // strict > keeps the first candidate on ties, so the order is deterministic
        if (best == null || score > best.score) best = { color: color.formatHex(), lab, score }
      }
    }
    if (best == null) break
    used.push(best.lab)
    out.push(best.color)
  }
  return out
}

export function seriesPalette(token: PaletteTokens, count: number): string[] {
  return buildPalette(token, count)
}
