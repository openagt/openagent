import type { ReactNode } from 'react'

/**
 * A part with nothing in it, said where its first row would stand: one plain paragraph on the column's
 * left edge in the muted body size, what is missing (`title`, a sentence) and then what fills it
 * (`children`, a second sentence in the same paragraph), with the press that fills it under them.
 * The caller draws no card around it: an empty part is the page's own words, not a box.
 */
export function Empty({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">
        {title}
        {children !== undefined && <> {children}</>}
      </p>
      {action !== undefined && <div className="mt-3 flex">{action}</div>}
    </div>
  )
}
