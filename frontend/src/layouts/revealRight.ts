/** Scroll the result into view only on the rising edge of the trigger, and only when the panes are stacked. */
export function shouldRevealRight(previous: boolean | undefined, next: boolean, stacked: boolean): boolean {
  return stacked && previous === false && next
}
