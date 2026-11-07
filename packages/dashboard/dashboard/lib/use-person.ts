import { useEffect } from 'react'
import { onPerson, type Person } from '../rpc/person.js'
import { usePolled } from './use-async.js'

// The person at this dashboard, read by the foot of the sidebar and by Settings › Profile: one
// press in Settings changes what both show, at once, and a change another computer of theirs made
// comes in with the next read.

/** Read again this often: their name may come from another computer, through their folder. */
const EVERY_MS = 60_000

const changed = new Set<() => void>()

/** Tell every reader of the person to read them again: Settings saved a change. */
export function personChanged(): void {
  for (const reload of changed) reload()
}

export function usePerson(): { person: Person | null; reload: () => Promise<void> } {
  // Kept for the page's life: on a phone the sidebar is drawn anew at each opening, and shows them at once.
  const { value: person, reload } = usePolled<Person | null>(() => onPerson().catch(() => null), null, EVERY_MS, [], { remember: 'person' })
  useEffect(() => {
    const again = (): void => void reload()
    changed.add(again)
    return () => void changed.delete(again)
  }, [reload])
  return { person, reload }
}
