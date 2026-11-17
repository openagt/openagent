import { Fragment } from 'react'

// A name cut in its middle where its line is too narrow, so its ending stays: "applyp…msg.sample",
// "From branch agent-2…-37-943Z". A file's ending says what it is; a branch's is what tells two apart.
// A path gives up its folders before its name: two files of one folder never read alike.

/** How many of a text's last characters always show. */
const ENDING = 10

/** `text` on one line, its start cut short to fit and its last characters whole; said whole to a screen reader. */
export function MiddleCut({ text }: { text: string }) {
  if (text.length <= ENDING + 2) return <span className="min-w-0 truncate">{text}</span>
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="flex min-w-0 overflow-hidden">
        <span className="min-w-0 truncate">{text.slice(0, -ENDING)}</span>
        <span className="shrink-0 whitespace-pre">{text.slice(-ENDING)}</span>
      </span>
    </>
  )
}

/**
 * `path` on one line, in a row that lays its parts side by side: its folders cut short first, muted,
 * then its name in its middle. The folders take the whole shortage: a share of a pixel taken from
 * the name would already put an ellipsis into it.
 */
export function PathCut({ path }: { path: string }) {
  const name = path.lastIndexOf('/') + 1
  return (
    <>
      {name > 0 && <span className="min-w-0 shrink-[1000000] truncate text-muted-foreground">{path.slice(0, name)}</span>}
      <MiddleCut text={path.slice(name)} />
    </>
  )
}

/**
 * `path` whole, on as many lines as it needs: broken after a slash, and inside a folder's name only where
 * one is longer than the line. For a repository's place in a picker, where every part of it tells two
 * repos apart.
 */
export function PathWhole({ path }: { path: string }) {
  return (
    <span className="min-w-0 [overflow-wrap:anywhere]">
      {path.split(/(?<=\/)/).map((part, at) => (
        <Fragment key={at}>
          {at > 0 && <wbr />}
          {part}
        </Fragment>
      ))}
    </span>
  )
}
