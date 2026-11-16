import type { ReactNode } from 'react'

/** What an Overview part is, in a sentence, for a screen reader alone: its heading says it to the eye, also while the page is arranged, which moves nothing. */
export function PartDescription({ children }: { children: ReactNode }) {
  return <p className="sr-only">{children}</p>
}
