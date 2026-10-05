import { useCallback, useRef, useState } from 'react'

/**
 * One cancellable request at a time (ADR 0013 section 4D, Phase 2.8). `begin()` aborts whatever was running and hands out a fresh
 * `AbortController`; its signal goes to the request (`RequestOptions.signal`), which soft-cancels it: the worker returns the retained state with
 * `Cancelled by user`, and only escalates to a hard termination (a `CancellationError` with the last snapshot) when it does not answer.
 *
 * `cancel()` is the Cancel button; `cancelling` is true from the click until the request settles, so the button can show it was heard.
 * `end(controller)` clears the slot, but only when that controller is still the current one (a newer request owns the slot otherwise).
 */
export function useRequestController() {
  const current = useRef<AbortController | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const begin = useCallback((): AbortController => {
    current.current?.abort()
    const controller = new AbortController()
    current.current = controller
    setCancelling(false)
    return controller
  }, [])

  const cancel = useCallback((): void => {
    const controller = current.current
    if (controller === null || controller.signal.aborted) return
    controller.abort()
    setCancelling(true)
  }, [])

  const end = useCallback((controller: AbortController): void => {
    if (current.current !== controller) return
    current.current = null
    setCancelling(false)
  }, [])

  return { begin, cancel, end, cancelling }
}
