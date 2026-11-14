import { Skeleton } from './ui/skeleton.js'

/** The room of an answer that is one sentence ("Nothing queued."), while it is read: a `Slot`'s shape for a part whose emptiest answer is that sentence, so its answer moves nothing under it by more than it outgrows the sentence. */
export function SentenceShape() {
  return (
    <div className="flex h-5 items-center">
      <Skeleton className="h-4 w-48 max-w-full" />
    </div>
  )
}
