export interface Weights {
  ergo: number
  recoil: number
  price: number
}

export type TernaryKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'

export const TERNARY_KEYS: readonly string[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']

/** Splits `amount` between two pools as evenly as possible without taking more than a pool holds. The odd point comes from `oddFirst` when it is the larger pool, else from the other. */
function splitEvenly(amount: number, a: number, b: number, oddFirst: boolean): [number, number] {
  let ta = Math.floor(amount / 2)
  let tb = ta
  if (amount % 2 === 1) {
    if (oddFirst) ta++
    else tb++
  }
  if (ta > a) { tb += ta - a; ta = a }
  if (tb > b) { ta += tb - b; tb = b }
  return [ta, tb]
}

/**
 * One keyboard step on the weight triangle. Up and Down move weight to or from
 * the top vertex (ergonomics), Right and Left between the bottom-left vertex
 * (price) and the bottom-right one (recoil). Integers in, integers out, the
 * total is unchanged, and a step that cannot move returns the input unchanged.
 * An odd point is taken from the larger of the two pools, or given to the
 * smaller, ties going to recoil.
 */
export function stepWeights(w: Weights, key: TernaryKey, shift: boolean): Weights {
  const step = shift ? 5 : 1
  switch (key) {
    case 'ArrowUp': {
      const amount = Math.min(step, w.recoil + w.price)
      const [fromRecoil, fromPrice] = splitEvenly(amount, w.recoil, w.price, w.recoil >= w.price)
      return { ergo: w.ergo + amount, recoil: w.recoil - fromRecoil, price: w.price - fromPrice }
    }
    case 'ArrowDown': {
      const amount = Math.min(step, w.ergo)
      const [toRecoil, toPrice] = splitEvenly(amount, Infinity, Infinity, w.recoil <= w.price)
      return { ergo: w.ergo - amount, recoil: w.recoil + toRecoil, price: w.price + toPrice }
    }
    case 'ArrowRight': {
      const amount = Math.min(step, w.price)
      return { ...w, recoil: w.recoil + amount, price: w.price - amount }
    }
    case 'ArrowLeft': {
      const amount = Math.min(step, w.recoil)
      return { ...w, recoil: w.recoil - amount, price: w.price + amount }
    }
  }
}
