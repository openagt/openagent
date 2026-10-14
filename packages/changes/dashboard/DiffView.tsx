import { ChevronsUpDown } from 'lucide-react'
import { cn } from '@openagt/dashboard/module'
import type { FileDiff } from '../src/diff.js'
import { MAX_PREVIEW_LINES } from '../src/confined.js'

// A file's diff as Claude Code on the web draws it: each line with its number, added lines green,
// removed lines red, and the unchanged lines git left out between two changes as one row that says
// how many there are. A click on that row, or on "Show more lines" under the last change, asks for
// the whole file (`onWhole`), unless the file is longer than a diff may be: the whole of it would
// then be cut before the change.
//
// Deliberately plain: no syntax highlighting, no editing. The dashboard is not an editor (the risk
// raised on #475) — this is here to answer "what did the session do", nothing more.

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

const TONE = { add: 'bg-success/10 text-success', del: 'bg-danger/10 text-danger', same: 'text-foreground' } as const
const SIGN = { add: '+', del: '−', same: ' ' } as const

function More({ children, onClick }: { children: string; onClick: (() => void) | undefined }) {
  return (
    <button type="button" disabled={!onClick} onClick={onClick} className="flex w-full items-center gap-1.5 bg-muted/50 px-2 py-0.5 text-start text-[11px] text-muted-foreground enabled:hover:text-foreground">
      <ChevronsUpDown aria-hidden className="size-3" />
      {children}
    </button>
  )
}

export function DiffView({ diff, wrap, whole, onWhole, className }: { diff: FileDiff; wrap: boolean; whole: boolean; onWhole?: () => void; className?: string }) {
  if (diff.binary) return <p className="p-2 text-xs text-muted-foreground">Binary file, nothing to show.</p>
  const { rows, shown } = read(diff.patch)
  if (rows.length === 0) return <p className="p-2 text-xs text-muted-foreground">Empty file.</p>
  const ask = diff.lines !== undefined && diff.lines > MAX_PREVIEW_LINES ? undefined : onWhole
  const width = `${String(rows.reduce((most, row) => (row.kind === 'gap' ? most : Math.max(most, row.number)), 0)).length + 1}ch`
  // Lines are left under the last change while the file has more than the diff shows.
  const more = !whole && diff.lines !== undefined && shown < diff.lines
  return (
    <div className={cn('overflow-x-auto font-mono text-[11px] leading-[1.45]', className)}>
      {rows.map((row, i) =>
        row.kind === 'gap' ? (
          <More key={i} onClick={ask}>{`${row.hidden} unmodified ${row.hidden === 1 ? 'line' : 'lines'}`}</More>
        ) : (
          <div key={i} className={cn('flex', TONE[row.kind])}>
            <span className="shrink-0 select-none pr-2 pl-2 text-right tabular-nums opacity-60" style={{ width: `calc(${width} + 1rem)` }}>
              {row.number}
            </span>
            <span className="w-3 shrink-0 select-none opacity-70">{SIGN[row.kind]}</span>
            <span className={cn('min-w-0 pr-2', wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre')}>{row.text || ' '}</span>
          </div>
        ),
      )}
      {more && ask && <More onClick={ask}>Show more lines</More>}
      {diff.truncated && <p className="px-2 py-1 text-[10px] italic text-muted-foreground">Cut here. The rest is in the worktree.</p>}
    </div>
  )
}
