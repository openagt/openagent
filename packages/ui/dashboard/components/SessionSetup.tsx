import { createContext, useContext, type ReactNode, type RefObject } from 'react'
import { ChevronDown, Settings } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { ComposerControls, useControlsSaid, type ControlBox } from './Places.js'
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
 * one menu, "This session". First the modules' lines, then the caller's: the git host account and,
 * set apart, what the agent does when it finishes; each says its value and opens its list. The menu
 * stands above the box on its left edge, and covers none of it: what is typed stays in view.
 */
export function SessionSetupMenu({ setup, box, busy, controls }: { setup: SessionSetup; /** The message box, which the menu stands above. */ box: RefObject<HTMLElement | null>; busy: boolean; /** The box the modules' lines are drawn for (`composer.control` at `setup`), before the caller's. */ controls?: ControlBox | undefined }) {
  // The modules' lines stay mounted with the menu shut, saying what they pick for the gear's hover.
  const { said, onSaid } = useControlsSaid(`${controls?.in}:${controls?.projectId}:${controls?.agentId}`)
  const lines = Object.values(said)
  const tip = [...lines.map(line => line.words), setup.said].filter(Boolean).join(' · ')
  const warn = setup.warn || lines.some(line => line.warn)
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger render={<DropdownMenuTrigger type="button" disabled={busy} aria-label="Session setup" className={cn(rowButtonClass, 'shrink-0', warn && 'text-warning')} />}>
          <Settings className="size-4 shrink-0" aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{tip}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="start" anchor={box} keepMounted={controls !== undefined} className="w-[21rem] max-w-[calc(100vw-2rem)]">
        {/* A hover inside the menu stands by its own line, not past the box as the row's do. */}
        <TooltipsPastBox value={null}>
          <DropdownMenuGroup>
            <DropdownMenuLabel className="font-normal">This session</DropdownMenuLabel>
            {controls && <ComposerControls at="setup" box={controls} onSaid={onSaid} />}
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

/** The lines are drawn as rows of a form, not as a menu's: a profile's editor (his pick A, 2026-11-26). */
const AsRows = createContext(false)

/**
 * The lines of the gear's menu as the rows of a form (a profile's editor, his pick A of three,
 * 2026-11-26): each what it sets at the left and its pick at the right, which opens the line's own
 * list as a menu of its own; on a phone the pick stands under its name. The same lines, so a
 * module that draws its pick as a line has its row here without a word of its own.
 */
export function SetupRows({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <AsRows.Provider value={true}>
      <div className={cn('rounded-lg border border-border', className)}>{children}</div>
    </AsRows.Provider>
  )
}

/** Whether the lines are drawn as a form's rows ({@link SetupRows}). */
export function useSetupRows(): boolean {
  return useContext(AsRows)
}

/** A form's row of {@link SetupRows}: its icon and what it sets at the left, `children` at the right; on a phone, under it. */
export function SetupRow({ icon, label, children }: { icon?: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-t border-hairline px-3 py-2 first:border-t-0 max-md:flex-col max-md:items-start max-md:gap-1.5 max-md:py-3">
      <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
        {icon && <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-4">{icon}</span>}
        {label}
      </span>
      <span className="flex min-w-0 max-w-full shrink-0 items-center">{children}</span>
    </div>
  )
}

/** A row's pick that opens its list: its value and a chevron, as a select. A module's own pick in a row ({@link SetupRow}) takes it too. */
export const PICK_CLASS = 'focus-ring flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm transition-colors hover:bg-accent data-[popup-open]:bg-accent disabled:opacity-50 max-md:h-11'

/**
 * A line of the gear's menu that opens its list beside it: `children`, a menu's items. The list
 * stands from the line's foot up, as the menu does from the box: it covers none of the box either.
 * Among {@link SetupRows}, a form's row whose pick opens the same list.
 */
export function SetupLine({ icon, label, value, className, disabled, children }: { icon: ReactNode; label: string; value: ReactNode; /** The list's own width. */ className?: string; /** Off while its list is not read yet. */ disabled?: boolean; children: ReactNode }) {
  if (useContext(AsRows))
    return (
      <SetupRow icon={icon} label={label}>
        <DropdownMenu>
          <DropdownMenuTrigger type="button" disabled={disabled} aria-label={label} className={PICK_CLASS}>
            <span className="flex min-w-0 items-center gap-1.5 truncate">{value}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={className}>
            {children}
          </DropdownMenuContent>
        </DropdownMenu>
      </SetupRow>
    )
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
  if (useContext(AsRows))
    return (
      <SetupRow icon={icon} label={label}>
        <button type="button" onClick={onClick} className={cn(PICK_CLASS, 'text-warning')}>
          {value}
        </button>
      </SetupRow>
    )
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
  if (useContext(AsRows))
    return (
      <SetupRow icon={icon} label={label}>
        <span title={tip} className="truncate text-sm text-muted-foreground">
          {value}
        </span>
      </SetupRow>
    )
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
