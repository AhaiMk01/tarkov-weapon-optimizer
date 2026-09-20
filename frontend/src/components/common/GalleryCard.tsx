import { memo, useState } from 'react'
import { CheckOutlined, CloseOutlined, MinusOutlined } from '@ant-design/icons'
import type { CardState } from './galleryEffects'
import './WeaponGallery.css'

/**
 * Own component so the entrance animation runs once per mount.
 * Keeping `wg-card-entering` in the parent's className string meant that any
 * change to the selected state rewrote the attribute and restarted the
 * animation, so picking a card (or selecting a whole group) made it blink out
 * and fade back in. Holding it as state, cleared on animationend, is immune to
 * that: the class only comes back on a real remount.
 *
 * Memoised, and every prop is a primitive or a callback shared by the whole
 * grid (`onPick(itemId)` rather than a per-card closure). The mod gallery holds
 * a thousand of these; without that, one toggle re-renders all of them.
 */
export const GalleryCard = memo(function GalleryCard({
  itemId,
  name,
  image,
  meta,
  index,
  state,
  blocked,
  title,
  showBadge,
  onPick,
  onAction,
  actionLabel,
}: {
  itemId: string
  name: string
  image?: string
  meta: string
  index: number
  state: CardState
  blocked?: boolean
  /** Native tooltip; the mod gallery uses it to say why a card is blocked. */
  title?: string
  showBadge: boolean
  /** Omit to make the card inert (a blocked mod). */
  onPick?: (id: string) => void
  /** Adds the top-left corner toggle; the mod gallery bans parts with it. */
  onAction?: (id: string) => void
  actionLabel?: string
}) {
  const [entering, setEntering] = useState(true)
  const stateClass = state === 'on' ? ' wg-selected' : state === 'off' ? ' wg-excluded' : ''
  return (
    <div
      className={`wg-card${entering ? ' wg-card-entering' : ''}${stateClass}`}
      style={{
        animationDelay: entering ? `${Math.min(index, 24) * 22}ms` : undefined,
        opacity: blocked ? 0.45 : undefined,
        cursor: blocked ? 'not-allowed' : undefined,
      }}
      role="button"
      tabIndex={0}
      title={title}
      aria-pressed={showBadge ? state === 'on' : undefined}
      aria-disabled={blocked || undefined}
      aria-label={name}
      onClick={() => onPick?.(itemId)}
      onKeyDown={e => {
        // Keys pressed on the corner toggle bubble up here; without this guard
        // Enter on "ban" was swallowed and required the part instead.
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPick?.(itemId)
        }
      }}
      onAnimationEnd={() => setEntering(false)}
    >
      <div className="wg-card-shadow" aria-hidden="true" />
      {image ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          onLoad={e => e.currentTarget.classList.add('wg-loaded')}
          onError={e => e.currentTarget.classList.add('wg-loaded')}
        />
      ) : (
        <div className="wg-card-img-slot" aria-hidden="true" />
      )}
      <div className="wg-name">{name}</div>
      <div className="wg-meta">{meta}</div>
      <div className="wg-card-light" aria-hidden="true" />
      <div className="wg-card-corners" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      {onAction && (
        // A plain button, not antd's: one Button + Tooltip per card is two
        // thousand component instances for what is a 22px glyph.
        <button
          type="button"
          className="wg-card-action"
          title={actionLabel}
          aria-label={actionLabel ? `${name} — ${actionLabel}` : name}
          aria-pressed={state === 'off'}
          onClick={e => {
            // the card itself toggles "required"
            e.stopPropagation()
            onAction(itemId)
          }}
        >
          <MinusOutlined />
        </button>
      )}
      {showBadge && state !== 'none' && (
        <span className={`wg-check${state === 'off' ? ' wg-check-danger' : ''}`}>
          {state === 'off' ? <CloseOutlined /> : <CheckOutlined />}
        </span>
      )}
    </div>
  )
})
