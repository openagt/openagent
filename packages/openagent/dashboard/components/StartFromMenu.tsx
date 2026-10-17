import { Check, ChevronDown, GitBranch } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { rowButtonClass } from './ui/row-item.js'
import { OptionLabel } from './ui/option-label.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem } from './ui/dropdown-menu.js'

/** Where the agent's own branch starts: the project's main branch, or the branch the project's folder is on. */
export type StartFrom = 'main' | 'local'

/** What the button reads for a pick: the branch's name, the local one marked as such. */
export function startFromLabel(pick: StartFrom, main: string, local: string): string {
  return pick === 'local' ? `${local} (local)` : main
}

// The launcher's "start from" pick, in the row under the box: the branch the agent starts from,
// in words, and a menu to pick between the two. The button reads the pick itself, so where a Start
// begins is on screen with the menu shut. The local branch is listed even when it has the main
// branch's name: local `main` may hold commits that are not pushed.
export function StartFromMenu({ main, local, pick, onPick, busy }: { main: string; local: string; pick: StartFrom; onPick: (pick: StartFrom) => void; busy: boolean }) {
  const label = startFromLabel(pick, main, local)
  const options: { pick: StartFrom; label: string; description: string }[] = [
    { pick: 'main', label: main, description: "The project's main branch, fetched fresh." },
    { pick: 'local', label: `My local branch ${local}`, description: 'Your branch as committed on this machine; uncommitted edits are not carried. If the agent publishes, your commits that are not pushed go up with its branch.' },
  ]
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              type="button"
              disabled={busy}
              aria-label="The agent starts from"
              className={rowButtonClass}
            />
          }
        >
          <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{`The agent starts from ${label}`}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-[19rem] max-w-[22rem]">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">The agent starts from</DropdownMenuLabel>
          {options.map(option => (
            // aria-current: the check mark is only drawn, so a screen reader is told the pick too.
            <DropdownMenuItem key={option.pick} className="items-start" aria-current={option.pick === pick} onClick={() => onPick(option.pick)}>
              <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', option.pick === pick ? 'opacity-100' : 'opacity-0')} aria-hidden />
              <OptionLabel label={option.label} description={option.description} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
