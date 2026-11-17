type Rgba = readonly [number, number, number, number]

function parse(color: string): Rgba {
  const c = color.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c)?.[1]
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((h) => h + h).join('') : hex
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)).concat(1) as unknown as Rgba
  }
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(c)
  if (!m) throw new Error(`Unsupported colour: ${color}`)
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])]
}

function luminance([r, g, b]: Rgba): number {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}

/** WCAG 2.x contrast ratio; a translucent foreground is composited over the background first. */
export function contrastRatio(foreground: string, background: string): number {
  const bg = parse(background)
  const fg = parse(foreground)
  const a = fg[3]
  const flat: Rgba = [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1) as unknown as Rgba
  const [hi, lo] = [luminance(flat), luminance(bg)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Black or white, whichever reads better on `background`. */
export function onColor(background: string): '#000000' | '#ffffff' {
  return contrastRatio('#ffffff', background) >= contrastRatio('#000000', background) ? '#ffffff' : '#000000'
}
