import { FileText } from 'lucide-react'
import type { ChangedFile } from '../lib/turn-changes.js'

// The lines a change added and removed, as "+11 −0": added in green, removed in red.
export function LinesChanged({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="shrink-0 tabular-nums">
      <span className="text-success">+{added}</span> <span className="text-danger">−{removed}</span>
    </span>
  )
}

// The lines a change added and removed as Claude Code on the web marks them beside a file it
// names in a line: one small pill, the added half green and the removed half red.
export function LinesPill({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="flex h-4 shrink-0 overflow-hidden rounded text-[10px] font-medium tabular-nums">
      <span className="bg-success/20 px-1 text-success" aria-hidden>
        +{added}
      </span>
      <span className="bg-danger/20 px-1 text-danger" aria-hidden>
        −{removed}
      </span>
      <span className="sr-only">
        {added} added, {removed} removed
      </span>
    </span>
  )
}

// The files a turn's edits changed, at the end of the turn, as Claude Code on the web lists them:
// one card with a row for each file, its name and the lines added and removed, the row lit under
// the pointer. A click shows the file's change (`onOpen`); with nothing to open it in, the rows are
// no buttons.
export function ChangedFiles({ files, onOpen }: { files: readonly ChangedFile[]; onOpen?: ((path: string) => void) | undefined }) {
  return (
    <ul aria-label="Files changed" className="flex min-w-0 flex-1 flex-col rounded-[10px] p-1 font-sans ring-1 ring-border">
      {files.map(file => {
        const row = (
          <>
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-left text-[13px] text-foreground" title={file.path}>
              {file.name}
            </span>
            <span className="text-xs">
              <LinesChanged added={file.added} removed={file.removed} />
            </span>
          </>
        )
        const look = 'flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2'
        return (
          <li key={file.path} className="min-w-0">
            {onOpen ? (
              <button type="button" onClick={() => onOpen(file.path)} aria-label={`Show the change to ${file.name}`} className={`${look} hover:bg-foreground/5`}>
                {row}
              </button>
            ) : (
              <div className={look}>{row}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
