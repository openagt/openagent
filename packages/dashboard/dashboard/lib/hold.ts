import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

// A list that holds still while a person is in it: rows start, end and change their part on their
// own schedule, and a list that moves under the pointer puts another row, and its press, under the
// hand. So while the pointer is over the list, or the keyboard's focus is shown in it, the list draws
// what it drew when the hold began; what arrived since applies once both have left. A row that only
// kept the focus of a click (not `:focus-visible`) does not hold the list, or one click would freeze
// it until the next click elsewhere.

/**
 * `value` as it was drawn when the person came into `ref`'s element, for as long as they are in it;
 * `value` itself once they have left. What `value` holds is the caller's: give it what must not move
 * (members, order, a fold), and draw what may change in place (a row's mark, name and time) from the
 * newest data.
 */
export function useHold<Value>(ref: RefObject<HTMLElement | null>, value: Value): Value {
  const [held, setHeld] = useState<{ value: Value } | undefined>(undefined)
  // What is drawn now: the hold takes this when it begins.
  const drawn = useRef(value)
  useLayoutEffect(() => {
    if (held === undefined) drawn.current = value
  })
  useEffect(() => {
    const element = ref.current
    if (!element) return
    let pointer = false
    let keyboard = false
    const update = () => setHeld(was => (pointer || keyboard ? (was ?? { value: drawn.current }) : undefined))
    const enter = () => {
      pointer = true
      update()
    }
    const leave = () => {
      pointer = false
      update()
    }
    const focusIn = (event: FocusEvent) => {
      keyboard = event.target instanceof Element && event.target.matches(':focus-visible')
      update()
    }
    const focusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return
      keyboard = false
      update()
    }
    element.addEventListener('pointerenter', enter)
    element.addEventListener('pointerleave', leave)
    element.addEventListener('focusin', focusIn)
    element.addEventListener('focusout', focusOut)
    return () => {
      element.removeEventListener('pointerenter', enter)
      element.removeEventListener('pointerleave', leave)
      element.removeEventListener('focusin', focusIn)
      element.removeEventListener('focusout', focusOut)
    }
  }, [ref])
  return held === undefined ? value : held.value
}
