import { useContext } from 'react'
import { Layers } from 'lucide-react'
import { ContextFiles } from './ContextFiles.js'
import { BoxOfRow, rowButtonClass } from './ui/row-item.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './ui/dropdown-menu.js'

/**
 * The Context of a project's message box, under the box after the gear: the files a `#` mention or
 * the file tree added, which ride the prompt as one `Context:` line at its end. The button counts
 * them, and its menu lists them to be removed, or says how to add one. Above the box on its left
 * edge, as the gear's menu. The same in the launcher and in a session, for its next message.
 */
export function ContextMenu({ files, busy, onRemove }: { files: readonly string[]; busy: boolean; onRemove: (path: string) => void }) {
  const box = useContext(BoxOfRow)
  const count = files.length > 0 ? `${files.length} file${files.length === 1 ? '' : 's'}` : ''
  return (
    <DropdownMenu>
      <DropdownMenuTrigger type="button" disabled={busy} aria-label={count ? `Context: ${count}` : 'Context'} className={rowButtonClass}>
        <Layers className="size-4 shrink-0" aria-hidden />
        <span className="truncate">
          Context{count && <span className="text-primary"> · {count}</span>}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" {...(box ? { anchor: box, side: 'top' as const } : {})} className="w-[24rem] max-w-[var(--available-width)]">
        <p className="px-2 pt-2 pb-1 text-xs font-semibold text-muted-foreground">Files</p>
        {files.length > 0 ? (
          <div className="px-2 py-1">
            <ContextFiles files={[...files]} onRemove={onRemove} busy={busy} />
          </div>
        ) : (
          <p className="px-2 py-1 text-xs text-muted-foreground">None yet — add with # or the Files pane.</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
