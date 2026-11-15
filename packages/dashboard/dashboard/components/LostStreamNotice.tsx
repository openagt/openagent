import { TriangleAlert } from 'lucide-react'

// The live channel's health (#948), said under an agent's top bar: while the stream is down the
// feed is behind reality, and saying so beats letting "the agent went quiet" and "the connection
// died" look identical.
export function LostStreamNotice() {
  return (
    <div role="status" className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
      <TriangleAlert className="size-3.5 shrink-0 text-warning" aria-hidden />
      Live stream lost — reconnecting. The session keeps running; this view may be behind.
    </div>
  )
}
