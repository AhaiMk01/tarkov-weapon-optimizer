import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { GlobalToken } from 'antd'

/**
 * Presentation shared by the weapon and mod galleries.
 *
 * Both solve the same problem: a few hundred items people recognise by silhouette
 * rather than by name. One copy of the proximity effect matters because it is the
 * fiddly part -- cached rects, one rAF, reduced-motion and touch opt-outs.
 */

/** antd tokens are hex; fall back to the raw string for anything else. */
export function rgba(color: string, alpha: number): string {
  const hex = color.trim()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex)
  const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  let r: number, g: number, b: number
  if (short) {
    r = parseInt(short[1] + short[1], 16)
    g = parseInt(short[2] + short[2], 16)
    b = parseInt(short[3] + short[3], 16)
  } else if (full) {
    r = parseInt(full[1], 16)
    g = parseInt(full[2], 16)
    b = parseInt(full[3], 16)
  } else {
    return color
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function isDarkColor(color: string): boolean {
  const rgb = rgba(color, 1)
  const m = /rgba?\((\d+), (\d+), (\d+)/.exec(rgb)
  if (!m) return false
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128
}

/** Theme-derived custom properties consumed by WeaponGallery.css. */
export function galleryVars(token: GlobalToken): CSSProperties {
  const dark = isDarkColor(token.colorBgBase)
  return {
    '--wg-accent': token.colorPrimary,
    '--wg-accent-ring': rgba(token.colorPrimary, 0.75),
    '--wg-on-accent': token.colorWhite,
    '--wg-danger': token.colorError,
    '--wg-danger-bg': token.colorErrorBg,
    '--wg-card-bg': dark ? token.colorBgContainer : token.colorBgLayout,
    '--wg-border': token.colorBorderSecondary,
    '--wg-name': token.colorText,
    '--wg-muted': token.colorTextTertiary,
    '--wg-selected-bg': token.colorPrimaryBg,
    '--wg-scroll-bg': token.colorBgElevated,
    '--wg-card-shadow': dark
      ? '0 6px 12px -2px rgba(0, 0, 0, 0.7)'
      : '0 4px 10px -3px rgba(0, 0, 0, 0.18)',
    '--wg-card-wash': dark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
    '--wg-light-strong': dark ? 'rgba(255, 248, 224, 0.05)' : 'rgba(255, 255, 255, 0.6)',
    '--wg-light-weak': dark ? 'rgba(255, 248, 224, 0.016)' : 'rgba(255, 255, 255, 0.2)',
    '--wg-contact-shadow': dark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.22)',
    '--wg-shimmer-a': token.colorFillSecondary,
    '--wg-shimmer-b': token.colorFillTertiary,
  } as CSSProperties
}

/**
 * Cursor-tracked spotlight + 3D tilt, driven from one rAF-throttled listener on
 * the scroll container. Rects are cached because reading them per card per frame
 * is what makes this kind of effect drop frames on a 200-card grid; they are
 * invalidated on scroll and on any change to the rendered list.
 *
 * Takes the scroll node itself rather than a ref: antd mounts the modal's portal
 * content in a later render than the one that flips `open`, so an effect keyed on
 * a ref object binds to a null root once and never re-runs. A callback ref stored
 * in state re-renders when the node actually appears.
 */
export function useCardProximityEffect(root: HTMLDivElement | null, deps: unknown[]) {
  const cardsRef = useRef<{ card: HTMLElement; rect: DOMRect | null; lit: boolean }[]>([])
  const rafHandle = useRef<number | null>(null)
  const measureHandle = useRef<number | null>(null)
  const tiltedRef = useRef<HTMLElement | null>(null)

  const measure = useCallback(() => {
    for (const entry of cardsRef.current) entry.rect = entry.card.getBoundingClientRect()
  }, [])

  useLayoutEffect(() => {
    if (!root) return
    const cards = Array.from(root.querySelectorAll<HTMLElement>('.wg-card'))
    cardsRef.current = cards.map(card => ({ card, rect: null, lit: false }))
    measure()

    // Gates the loading shimmer to cards near the viewport, matching what the
    // lazy <img> is actually doing.
    const io = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          entry.target.classList.toggle('wg-in-view', entry.isIntersecting)
        }
      },
      { root, rootMargin: '200px' },
    )
    for (const card of cards) io.observe(card)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, measure, ...deps])

  useEffect(() => {
    if (!root) return
    if (window.matchMedia('(hover: none)').matches) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const MAX_TILT = 7
    const PERSPECTIVE = 1000
    const IMG_SHIFT = 6
    const SHADOW_SHIFT = 11
    const RANGE = 240

    const springBack = (card: HTMLElement) => {
      card.style.transition = 'border-color 0.15s ease, transform 0.6s ease-out'
      card.style.removeProperty('transform')
      const onDone = (e: TransitionEvent) => {
        if (e.propertyName !== 'transform') return
        card.removeEventListener('transitionend', onDone)
        card.style.removeProperty('transition')
      }
      card.addEventListener('transitionend', onDone)
      const settle = (el: HTMLElement | null, dur: string) => {
        if (!el) return
        el.style.transition = `opacity 0.3s ease, transform ${dur} ease-out`
        el.style.removeProperty('transform')
        el.addEventListener('transitionend', () => el.style.removeProperty('transition'), { once: true })
      }
      settle(card.querySelector('img'), '0.6s')
      settle(card.querySelector('.wg-card-shadow'), '0.5s')
    }

    const onMove = (e: MouseEvent) => {
      if (rafHandle.current != null) return
      rafHandle.current = requestAnimationFrame(() => {
        rafHandle.current = null
        for (const entry of cardsRef.current) {
          const { card, rect } = entry
          if (!rect) continue
          const near =
            e.clientX > rect.left - RANGE &&
            e.clientX < rect.right + RANGE &&
            e.clientY > rect.top - RANGE &&
            e.clientY < rect.bottom + RANGE
          if (near) {
            card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`)
            card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`)
            entry.lit = true
          } else if (entry.lit) {
            card.style.removeProperty('--mouse-x')
            card.style.removeProperty('--mouse-y')
            entry.lit = false
          }
        }

        const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('.wg-card') ?? null
        if (tiltedRef.current && tiltedRef.current !== target) {
          springBack(tiltedRef.current)
          tiltedRef.current = null
        }
        if (!target) return

        target.style.removeProperty('transition')
        const r = target.getBoundingClientRect()
        const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2)
        const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2)
        target.style.transform =
          `perspective(${PERSPECTIVE}px) rotateX(${(-dy * MAX_TILT).toFixed(2)}deg) ` +
          `rotateY(${(dx * MAX_TILT).toFixed(2)}deg) translateY(-2px)`

        // Gun and its contact shadow counter-drift at different rates, so the
        // card reads as layered depth rather than a flat image being rotated.
        const img = target.querySelector<HTMLElement>('img')
        if (img) {
          img.style.transition = 'filter 0.25s'
          img.style.transform = `translate3d(${(-dx * IMG_SHIFT).toFixed(2)}px, ${(-dy * IMG_SHIFT).toFixed(2)}px, 0)`
        }
        const shadow = target.querySelector<HTMLElement>('.wg-card-shadow')
        if (shadow) {
          shadow.style.transition = 'opacity 0.25s'
          shadow.style.transform = `translate3d(${(-dx * SHADOW_SHIFT).toFixed(2)}px, ${(-dy * SHADOW_SHIFT).toFixed(2)}px, 0)`
        }
        tiltedRef.current = target
      })
    }

    const onLeave = () => {
      if (tiltedRef.current) {
        springBack(tiltedRef.current)
        tiltedRef.current = null
      }
      for (const entry of cardsRef.current) {
        if (!entry.lit) continue
        entry.card.style.removeProperty('--mouse-x')
        entry.card.style.removeProperty('--mouse-y')
        entry.lit = false
      }
    }

    root.addEventListener('mousemove', onMove)
    root.addEventListener('mouseleave', onLeave)
    // Scroll fires many times a frame and each measure reads every card's rect;
    // on the mod gallery that is a thousand forced layouts per event.
    const scheduleMeasure = () => {
      if (measureHandle.current != null) return
      measureHandle.current = requestAnimationFrame(() => {
        measureHandle.current = null
        measure()
      })
    }

    root.addEventListener('scroll', scheduleMeasure, { passive: true })
    window.addEventListener('resize', scheduleMeasure)
    return () => {
      root.removeEventListener('mousemove', onMove)
      root.removeEventListener('mouseleave', onLeave)
      root.removeEventListener('scroll', scheduleMeasure)
      window.removeEventListener('resize', scheduleMeasure)
      if (measureHandle.current != null) {
        cancelAnimationFrame(measureHandle.current)
        measureHandle.current = null
      }
      // A frame scheduled just before the gallery closed would otherwise run and
      // write styles into nodes that are already detached.
      if (rafHandle.current != null) {
        cancelAnimationFrame(rafHandle.current)
        rafHandle.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, measure, ...deps])
}

/**
 * Weapons are picked or not; mods are required, banned, or neither. One card
 * covers both -- weapons simply never pass 'off'.
 */
export type CardState = 'none' | 'on' | 'off'
