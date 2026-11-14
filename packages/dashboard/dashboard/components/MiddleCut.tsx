// A name cut in its middle where its line is too narrow, so its ending stays: "applyp…msg.sample",
// "From branch agent-2…-37-943Z". A file's ending says what it is; a branch's is what tells two apart.

/** How many of a text's last characters always show. */
const ENDING = 10

/** `text` on one line, its start cut short to fit and its last characters whole; said whole to a screen reader. */
export function MiddleCut({ text }: { text: string }) {
  if (text.length <= ENDING + 2) return <span className="min-w-0 truncate">{text}</span>
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="flex min-w-0">
        <span className="min-w-0 truncate">{text.slice(0, -ENDING)}</span>
        <span className="shrink-0 whitespace-pre">{text.slice(-ENDING)}</span>
      </span>
    </>
  )
}
