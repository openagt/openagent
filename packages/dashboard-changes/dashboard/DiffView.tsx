import { ChevronsUpDown } from 'lucide-react'
import { Pieces, cn, useHighlighted } from '@openagt/dashboard/module'
import type { FileDiff } from '../src/diff.js'
import { MAX_PREVIEW_LINES } from '../src/confined.js'

// A file's diff as Claude Code on the web draws it: each line with its number, added lines green,
// removed lines red, and the unchanged lines git left out between two changes as one row that says
// how many there are. A click on that row, or on "Show more lines" under the last change, asks for
// the whole file (`onWhole`), unless the file is longer than a diff may be: the whole of it would
// then be cut before the change.
//
// Each line's text is coloured by the file's language, as an editor colours it. No editing: the
// dashboard is not an editor (the risk raised on #475).

type Row = { kind: 'add' | 'del' | 'same'; text: string; number: number } | { kind: 'gap'; hidden: number }

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** The rows of a unified patch: its lines with their numbers (the new file's, the old one's for a removed line), and the gaps between its hunks. */
export function rowsOf(patch: string): Row[] {
  return read(patch).rows
}

/** The rows, and the last line of the new file they show. */
function read(patch: string): { rows: Row[]; shown: number } {
  const rows: Row[] = []
  // A new file's patch is its lines, all added, with no hunk header.
  let inHunk = !/^@@ /m.test(patch)
  let oldLine = 1
  let newLine = 1
  let shown = 0
  // An empty new file has no line at all, not one blank one.
  for (const line of patch === '' ? [] : patch.split('\n')) {
    const hunk = HUNK.exec(line)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      const hidden = newLine - 1 - shown
      if (hidden > 0) rows.push({ kind: 'gap', hidden })
      inHunk = true
      continue
    }
    if (!inHunk || line.startsWith('\\')) continue
    if (line.startsWith('+')) {
      rows.push({ kind: 'add', text: line.slice(1), number: newLine })
      shown = newLine++
    } else if (line.startsWith('-')) {
      rows.push({ kind: 'del', text: line.slice(1), number: oldLine++ })
    } else {
      rows.push({ kind: 'same', text: line.slice(1), number: newLine })
      oldLine++
      shown = newLine++
    }
  }
  return { rows, shown }
}

// A changed line is lit, with a bar of its colour at its start, its number and sign in that colour
// and its text as any other line's.
const TONE = { add: 'border-success bg-success/10', del: 'border-danger bg-danger/10', same: 'border-transparent' } as const
const MARK = { add: 'text-success', del: 'text-danger', same: 'text-muted-foreground' } as const
const SIGN = { add: '+', del: '−', same: ' ' } as const

function More({ children, onClick }: { children: string; onClick: (() => void) | undefined }) {
  return (
    <button type="button" disabled={!onClick} onClick={onClick} className="flex w-full items-center gap-1.5 bg-muted/50 py-0.5 pr-2 pl-[11px] text-start text-xs text-muted-foreground enabled:hover:text-foreground">
      <ChevronsUpDown aria-hidden className="size-3" />
      {children}
    </button>
  )
}

export function DiffView({ diff, wrap, whole, onWhole, className }: { diff: FileDiff; wrap: boolean; whole: boolean; onWhole?: () => void; className?: string }) {
  const { rows, shown } = read(diff.binary ? '' : diff.patch)
  // The lines coloured as one text, the removed ones among the rest: a grammar reads a line by the ones above it.
  const lines = rows.flatMap(row => (row.kind === 'gap' ? [] : [row.text]))
  const colored = useHighlighted(lines.join('\n'), diff.path)
  // Each row's line among them; a gap is none.
  let at = -1
  const lineOf = rows.map(row => (row.kind === 'gap' ? -1 : ++at))
  if (diff.binary) return <p className="p-2 text-xs text-muted-foreground">Binary file, nothing to show.</p>
  if (rows.length === 0) return <p className="p-2 text-xs text-muted-foreground">{diff.status === 'untracked' || diff.status === 'added' ? 'Empty file.' : 'No line changed.'}</p>
  const ask = diff.lines !== undefined && diff.lines > MAX_PREVIEW_LINES ? undefined : onWhole
  const width = `${String(rows.reduce((most, row) => (row.kind === 'gap' ? most : Math.max(most, row.number)), 0)).length + 1}ch`
  // Lines are left under the last change while the file has more than the diff shows.
  const more = !whole && diff.lines !== undefined && shown < diff.lines
  return (
    <div className={cn('overflow-x-auto font-mono text-xs leading-[17px] text-foreground', className)}>
      {rows.map((row, i) =>
        row.kind === 'gap' ? (
          <More key={i} onClick={ask}>{`${row.hidden} unmodified ${row.hidden === 1 ? 'line' : 'lines'}`}</More>
        ) : (
          <div key={i} className={cn('flex border-l-[3px]', TONE[row.kind])}>
            <span className={cn('shrink-0 select-none pr-2 pl-2 text-right tabular-nums', MARK[row.kind])} style={{ width: `calc(${width} + 1rem)` }}>
              {row.number}
            </span>
            <span className={cn('w-3 shrink-0 select-none', MARK[row.kind])}>{SIGN[row.kind]}</span>
            <span className={cn('min-w-0 pr-2', wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre')}>{colored?.[lineOf[i]!] ? <Pieces pieces={colored[lineOf[i]!]!} /> : row.text || ' '}</span>
          </div>
        ),
      )}
      {more && ask && <More onClick={ask}>Show more lines</More>}
      {diff.truncated && <p className="px-2 py-1 text-[10px] italic text-muted-foreground">Cut here. The rest is in the worktree.</p>}
    </div>
  )
}
