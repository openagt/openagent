import { useLayoutEffect, useState, type RefObject } from 'react'

/** Whether `text` is cut where `ref` draws it, on its one line or at its last, read again as its box changes its size. */
export function useCut(ref: RefObject<HTMLElement | null>, text: string): boolean {
  const [cut, setCut] = useState(false)
  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    const read = () => setCut(box.scrollWidth > box.clientWidth || box.scrollHeight > box.clientHeight)
    read()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(box)
    return () => observer.disconnect()
  }, [ref, text])
  return cut
}
