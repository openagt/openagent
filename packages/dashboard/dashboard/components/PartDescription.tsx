import type { ReactNode } from 'react'

/** What an Overview part is, in a sentence: shown while the page is arranged, where a person picks parts; elsewhere its heading says it, and a screen reader alone hears the sentence. */
export function PartDescription({ children }: { children: ReactNode }) {
  // The room is the wrapper's to drop, so the sentence keeps its own margins when shown.
  return (
    <div data-part-description className="sr-only">
      <p className="-mt-1 mb-3 text-xs text-muted-foreground">{children}</p>
    </div>
  )
}
