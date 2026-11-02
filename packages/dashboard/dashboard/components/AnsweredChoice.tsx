import { useState } from 'react'
import type { ChoiceRequest } from '../../src/index.js'
import { pickedIds } from '../../src/client.js'
import { cn } from '../lib/utils.js'

// An answered gate, collapsed to one line (#1455 bonus 2 / item 6): what was decided stays
// visible and expandable instead of vanishing under the cursor, but takes no more of the page
// than a row. Used by the transcript's resolved `choice` rows.
export function AnsweredChoice({
  choice,
  pick,
}: {
  choice: ChoiceRequest
  /** What was picked: an option id, or the selected subset of ids for a multi select. */
  pick: string | readonly string[]
}) {
  const [expanded, setExpanded] = useState(false)
  const picked = new Set(pickedIds(pick))
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="flex w-full items-baseline gap-2 px-4 py-2 text-left text-xs text-muted-foreground hover:bg-accent/40"
        aria-expanded={expanded}
      >
        <span className="shrink-0 text-success">✓</span>
        <span className="truncate font-medium text-foreground">{choice.title}</span>
        <span className="ml-auto shrink-0">{expanded ? 'Collapse' : 'Expand'}</span>
      </button>
      {expanded && (
        <div className="border-t border-border p-4">
          <ul className="space-y-1 text-sm">
            {choice.options.map(o => (
              <li key={o.id} className={cn('flex items-baseline gap-2', picked.has(o.id) ? '' : 'text-muted-foreground')}>
                <span className={cn('w-4 shrink-0', picked.has(o.id) ? 'text-success' : '')}>{picked.has(o.id) ? '✓' : ''}</span>
                <span>{o.label}</span>
              </li>
            ))}
            {picked.size === 0 && <li className="text-muted-foreground">Accepted none</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
