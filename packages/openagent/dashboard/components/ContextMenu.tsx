import type { ProjectSummary } from '../../src/index.js'
import { Layers } from 'lucide-react'
import { rowButtonClass } from './ui/row-item.js'
import { ContextFiles } from './ContextFiles.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from './ui/dropdown-menu.js'

// The agent Context picker (#439/#314) as a dropdown on the launcher's "In play" row. It was an
// inline disclosure that pushed the whole form down when opened; a dropdown keeps it folded away
// until asked for. Ticking other repos narrows the agent's focus (it can still reach every repo);
// the Files list shows what a `#` mention or the file tree added, each removable.
export function ContextMenu({
  otherProjects,
  context,
  contextFiles,
  summary,
  busy,
  onToggle,
}: {
  /** The registered repos other than the current one — the focus targets (#665). */
  otherProjects: ProjectSummary[]
  /** The agent Context set (repo paths + file paths), for the checked state. */
  context: Set<string>
  /** The individual files in the Context, added via `#` or the tree. */
  contextFiles: string[]
  /** "2 projects · 1 file", or empty when nothing is picked. */
  summary: string
  busy: boolean
  /** Toggle a repo or drop a file from the Context. */
  onToggle: (path: string) => void
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              type="button"
              disabled={busy}
              className={rowButtonClass}
            />
          }
        >
          <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Context{summary && <span className="text-primary"> · {summary}</span>}
        </TooltipTrigger>
        <TooltipContent>Narrow the run to specific repos and files</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-[18rem] max-w-[24rem]">
        <DropdownMenuGroup>
          <Tooltip>
            <TooltipTrigger render={<DropdownMenuLabel />}>Projects</TooltipTrigger>
            <TooltipContent className="max-w-[22rem]">
              The agent can still reach every repo; ticking some just narrows its focus.
            </TooltipContent>
          </Tooltip>
          {otherProjects.length > 0 ? (
            otherProjects.map(p => (
              <Tooltip key={p.id}>
                <TooltipTrigger
                  render={
                    <DropdownMenuCheckboxItem
                      checked={context.has(p.path)}
                      onCheckedChange={() => onToggle(p.path)}
                      disabled={busy}
                    />
                  }
                >
                  <span className="truncate">{p.name}</span>
                </TooltipTrigger>
                <TooltipContent>{p.path}</TooltipContent>
              </Tooltip>
            ))
          ) : (
            <p className="px-2 py-1 text-xs text-muted-foreground/60">No other repos to add.</p>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Files</DropdownMenuLabel>
          {contextFiles.length > 0 ? (
            <div className="px-2 py-1">
              <ContextFiles files={contextFiles} onRemove={onToggle} busy={busy} />
            </div>
          ) : (
            <p className="px-2 py-1 text-xs text-muted-foreground/60">None yet — add with # or the Files pane.</p>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
