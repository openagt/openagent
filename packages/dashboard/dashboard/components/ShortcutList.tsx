import { useId } from 'react'
import { SHORTCUTS, SHORTCUT_PLACES, shortcutKeys, type ShortcutId } from '../lib/shortcut.js'

/** Settings' entry of the shortcuts, which `?` opens. */
export const SHORTCUTS_ENTRY = 'shortcuts'

/** Keys as a keyboard's caps: the shortcut list's and the jump's hint alike. */
export function KeyCaps({ keys }: { keys: string[] }) {
  return (
    <kbd className="flex shrink-0 items-center gap-1">
      {keys.map(key => (
        <kbd key={key} className="flex h-5 min-w-5 items-center justify-center rounded-sm border border-border px-1 font-sans text-xs text-muted-foreground">
          {key}
        </kbd>
      ))}
    </kbd>
  )
}

/** Every shortcut of the dashboard, grouped by where it works, from the table the handlers read. */
export function ShortcutList() {
  const ids = Object.keys(SHORTCUTS) as ShortcutId[]
  return (
    <div className="space-y-6">
      {SHORTCUT_PLACES.map(place => (
        <Place key={place} place={place} ids={ids.filter(id => SHORTCUTS[id].where === place)} />
      ))}
    </div>
  )
}

/** A place's shortcuts: its name 8 over its rows, which stand on the content's edge, one line each, 44 high, with no rule between them. */
function Place({ place, ids }: { place: string; ids: ShortcutId[] }) {
  const heading = useId()
  return (
    <section aria-labelledby={heading}>
      <h3 id={heading} className="mb-2 text-sm font-semibold">
        {place}
      </h3>
      <ul>
        {ids.map(id => (
          <li key={id} className="flex min-h-11 items-center justify-between gap-4">
            <span className="text-sm">{SHORTCUTS[id].does}</span>
            <KeyCaps keys={shortcutKeys(id)} />
          </li>
        ))}
      </ul>
    </section>
  )
}
