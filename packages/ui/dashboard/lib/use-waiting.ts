import { createContext, useContext } from 'react'
import type { Waiting } from '../../src/index.js'
import type { ReadState } from './use-async.js'

// What waits on the person, read once by the shell for every part that shows it: the sidebar's
// "Waiting on you", the launcher's, the tab's title, the notifications, and a module's card of it
// (`ui-card-waiting`'s Human Queue). A part reads the shell's read here, never one of its own.

/** What waits on the person, as the shell read it: the picked project's items only when one is picked, newest first, and what is known of them. */
export interface WaitingRead {
  items: readonly Waiting[]
  /** Until they are read, by this visit or an earlier one, a part says no count; while they are only an earlier visit's, it is faded. */
  state: ReadState
}

export const WaitingContext = createContext<WaitingRead>({ items: [], state: 'unknown' })

/** What waits on the person, for a part that shows it. */
export function useWaiting(): WaitingRead {
  return useContext(WaitingContext)
}
