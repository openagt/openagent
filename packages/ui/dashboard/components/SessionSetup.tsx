import type { ReactNode, RefObject } from 'react'
import { Settings } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { rowButtonClass } from './ui/row-item.js'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipsPastBox } from './ui/tooltip.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from './ui/dropdown-menu.js'

/** What the gear holds, as a box's caller hands it. */
export interface SessionSetup {
  /** Its lines: a {@link SetupLine} or a {@link SetupSaid} each. */
  lines: ReactNode
  /** What the lines say with the menu shut, for the gear's hover: the row under the box no longer says them. */
  said: string
  /** One of its lines needs a press before a run can do its work: the gear is in the warning's colour. */
  warn?: boolean | undefined
}

/**
 * The gear under the message box, first in its row (DECISIONS.md, his pick): the session's setup in
 * one menu, "This session". A line each for the profile, the skills, the git host account and, set
 * apart, what the agent does when it finishes; each says its value and opens its list. The menu
 * stands above the box on its left edge, and covers none of it: what is typed stays in view.
 */
export function SessionSetupMenu({ setup, box, busy }: { setup: SessionSetup; /** The message box, which the menu stands above. */ box: RefObject<HTMLElement | null>; busy: boolean }) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger render={<DropdownMenuTrigger type="button" disabled={busy} aria-label="Session setup" className={cn(rowButtonClass, 'shrink-0', setup.warn && 'text-warning')} />}>
          <Settings className="size-4 shrink-0" aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{setup.said}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="start" anchor={box} className="w-[21rem] max-w-[calc(100vw-2rem)]">
        {/* A hover inside the menu stands by its own line, not past the box as the row's do. */}
        <TooltipsPastBox value={null}>
          <DropdownMenuGroup>
            <DropdownMenuLabel className="font-normal">This session</DropdownMenuLabel>
            {setup.lines}
          </DropdownMenuGroup>
        </TooltipsPastBox>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A line's two ends: what it sets, then its value at the right, quieter. A long value is the one cut short. */
function LineWords({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-4">{icon}</span>
      <span className="shrink-0">
        {label}
        <span className="sr-only">: </span>
      </span>
      <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5 text-muted-foreground">{value}</span>
    </>
  )
}

/**
 * A line of the gear's menu that opens its list beside it: `children`, a menu's items. The list
 * stands from the line's foot up, as the menu does from the box: it covers none of the box either.
 */
export function SetupLine({ icon, label, value, className, disabled, children }: { icon: ReactNode; label: string; value: ReactNode; /** The list's own width. */ className?: string; /** Off while its list is not read yet. */ disabled?: boolean; children: ReactNode }) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled} className="[&>svg:last-child]:ml-0">
        <LineWords icon={icon} label={label} value={value} />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent align="end" className={className}>{children}</DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/** A line of the gear's menu that is one press, with no list: what is missing, which the press adds, in the warning's colour. */
export function SetupPress({ icon, label, value, onClick }: { icon: ReactNode; label: string; value: ReactNode; onClick: () => void }) {
  return (
    <DropdownMenuItem onClick={onClick}>
      <LineWords icon={icon} label={label} value={<span className="truncate text-warning">{value}</span>} />
    </DropdownMenuItem>
  )
}

/**
 * A line a session keeps from its start, said and not offered: no list opens from it, and its
 * hover or the keyboard's stop on it says why it stays.
 */
export function SetupSaid({ icon, label, value, tip }: { icon: ReactNode; label: string; value: ReactNode; tip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<DropdownMenuItem closeOnClick={false} aria-disabled className="cursor-default" />}>
        <LineWords icon={icon} label={label} value={value} />
        <span className="sr-only">{`. ${tip}`}</span>
      </TooltipTrigger>
      <TooltipContent side="right">{tip}</TooltipContent>
    </Tooltip>
  )
}
