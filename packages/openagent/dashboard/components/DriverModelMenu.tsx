import type { ReactNode } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@openagt/skill-ui/module'
import { NO_MODEL_PINNED } from '../lib/agent-settings.js'
import { effortLabel } from '../lib/effort.js'
import { rowButtonClass } from './ui/row-item.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from './ui/dropdown-menu.js'

// The agent's driver + model as one tree (#650/#656/#658): the top level is the coding drivers, and
// each driver's submenu holds only its own models. Picking a model sets both the driver and the
// model together, so an incompatible pair (e.g. Codex + a Claude model) can't be chosen. Under
// them, how hard the model may think: the levels are the model's own, so a model that offers none
// has no such part. Each driver's part also holds its accounts on the computer the run goes to,
// under its models, and its row says the one its runs take first: who runs it is picked where what
// runs is. The trigger says all three as Claude Code's does: the driver's logo, the
// model, and the level in a quieter tone ("Opus 5.5 High"); the agent's default level says nothing.

export interface ModelOption {
  value: string
  label: string
}

export interface DriverOption {
  value: string
  label: string
  /** The driver's logo, shown on the trigger and beside its name (#656). */
  icon?: ReactNode
  /** The models this driver offers. Every entry is a real model id — none of them means "unset". */
  models: ModelOption[]
  /** Why {@link models} is empty, said in its place: the agent is still being asked, or could not say. */
  modelsNote?: string
  /** The account its runs take first on the computer the run goes to, said on its row: a name and how full it is (" · 16%"). */
  account?: { name: string; percent: string } | undefined
  /** Its accounts, under its models in its part: which one is first, and adding one. */
  accounts?: ReactNode
}

function driverOf(drivers: DriverOption[], value: string): DriverOption | undefined {
  return drivers.find(a => a.value === value) ?? drivers[0]
}

/**
 * The label for the current model: its name in the driver's own list, the id itself for a model
 * the list does not hold (the run is still given it, so the trigger says what is sent), or
 * `undefined` when nothing is pinned.
 *
 * Deliberately *not* falling back to the first model (#1143). The list used to open with a
 * "Default" entry storing an empty value, and the fallback made that entry's label the answer to
 * "which model is this". Dropping the entry without dropping the fallback would be worse than
 * either: the trigger would name a model the agent does not actually pass.
 */
function modelLabel(driver: DriverOption | undefined, model: string): string | undefined {
  if (!model) return undefined
  return driver?.models.find(m => m.value === model)?.label ?? model
}

/** How hard the model may think: the levels it offers, the one in force, and the pick. */
export interface EffortChoice {
  /** The levels the picked model offers, in the agent's own order. Empty: the menu has no effort part. */
  levels: readonly string[]
  /** The level in force, or `undefined` for the agent's own default. */
  level?: string | undefined
  /** Told the new level, or `undefined` when the pick is cleared back to the agent's default. */
  onChange: (level: string | undefined) => void
}

export function DriverModelMenu({
  drivers,
  driver,
  model,
  onChange,
  effort,
  busy,
}: {
  drivers: DriverOption[]
  driver: string
  model: string
  /** Set the driver and model together (a model is always picked within its driver). */
  onChange: (driver: string, model: string) => void
  effort?: EffortChoice | undefined
  busy: boolean
}) {
  const current = driverOf(drivers, driver)
  const currentModelLabel = modelLabel(current, model)
  // Spelled out rather than left to the rendered text (#1143): with no model pinned the trigger is
  // a logo and a chevron, which names nothing at all to a screen reader. It used to read as the
  // model label by accident, and that label was "Default".
  const levels = effort?.levels ?? []
  // A level the model does not offer is still what a run would be given, so it is said rather than
  // silently read as the default.
  const level = effort?.level !== undefined ? effortLabel(effort.level) : undefined
  const said = `Driver: ${current?.label ?? ''} · Model: ${currentModelLabel ?? NO_MODEL_PINNED}${levels.length > 0 ? ` · Effort: ${level ?? 'the agent’s default'}` : ''}`
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              type="button"
              disabled={busy}
              aria-label={said}
              className={cn(rowButtonClass, 'text-foreground')}
            />
          }
        >
          {current?.icon ? (
            <span className="flex h-3.5 w-3.5 items-center justify-center [&>svg]:size-3.5">{current.icon}</span>
          ) : (
            current?.label
          )}
          {currentModelLabel}
          {level && <span className="text-muted-foreground">{level}</span>}
          <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
        </TooltipTrigger>
        <TooltipContent>{said}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        {drivers.map(a => (
          <DropdownMenuSub key={a.value}>
            <DropdownMenuSubTrigger>
              <Check className={cn('h-3.5 w-3.5 shrink-0', a.value === driver ? 'opacity-100' : 'opacity-0')} />
              {a.icon && <span className="flex h-4 w-4 items-center justify-center">{a.icon}</span>}
              <span className="flex-1">{a.label}</span>
              {/* A long name gives way, never how full the account is. */}
              {a.account && (
                <span className="flex max-w-36 min-w-0 text-muted-foreground">
                  <span className="truncate">{a.account.name}</span>
                  <span className="shrink-0 whitespace-pre">{a.account.percent}</span>
                </span>
              )}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[15rem]">
              {a.models.length === 0 && a.modelsNote && <DropdownMenuItem disabled>{a.modelsNote}</DropdownMenuItem>}
              {a.models.map(m => (
                <DropdownMenuItem key={m.value} onClick={() => onChange(a.value, m.value)}>
                  <Check
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      a.value === driver && m.value === model ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  {m.label}
                </DropdownMenuItem>
              ))}
              {a.accounts}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
        {levels.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Effort</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => effort!.onChange(undefined)}>
                <Check className={cn('h-3.5 w-3.5 shrink-0', effort?.level === undefined ? 'opacity-100' : 'opacity-0')} />
                The agent’s default
              </DropdownMenuItem>
              {levels.map(one => (
                <DropdownMenuItem key={one} onClick={() => effort!.onChange(one)}>
                  <Check className={cn('h-3.5 w-3.5 shrink-0', effort?.level === one ? 'opacity-100' : 'opacity-0')} />
                  {effortLabel(one)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
