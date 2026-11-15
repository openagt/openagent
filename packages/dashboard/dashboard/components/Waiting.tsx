import type { ReactNode } from 'react'
import { Slot } from './ui/slot.js'

/** A read with no answer yet. */
const UNKNOWN = { value: null, state: 'unknown' } as const

/**
 * A part that only waits, as a {@link Slot} waits: `shape` holds the room, unseen for the first
 * 200ms. For a part that is told a read is out and draws the answer itself once it comes.
 */
export function Waiting({ shape, className }: { shape: ReactNode; className?: string }) {
  return (
    <Slot of={UNKNOWN} shape={shape} className={className}>
      {() => null}
    </Slot>
  )
}
