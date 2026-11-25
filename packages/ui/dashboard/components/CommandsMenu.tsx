import type { UiCommand } from '../module/index.js'
import type { OfferedPrompt } from '../lib/use-prompts.js'
import { Plus, X } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { IN_BOX } from '../lib/in-box.js'
import { buttonVariants } from './ui/button.js'
import { OptionLabel } from './ui/option-label.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import { pressed } from '../lib/shortcut.js'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from './ui/dropdown-menu.js'

/** One of the commands the modules offer the box (`composer.commands`). */
export type CommandEntry = UiCommand

// The visible face of what a project can be asked to do (#948, #1774): its commands, and the
// prompts a person saved, which the modules at `composer.prompts` offer (#2394). Loading used to
// live only behind typing `/` in the editor, which gave a first-time user no sign that any exist.
// This button is the one surface that loads, saves, and deletes; the `/` menu stays as the fast
// path for those who know it.
/** One saved prompt's row: click loads it, the X or the Delete key deletes it. */
function SavedPromptRow({
  prompt,
  busy,
  onLoad,
  onDelete,
}: {
  prompt: OfferedPrompt
  busy: boolean
  onLoad: (text: string, label: string) => void
  onDelete: (prompt: OfferedPrompt) => void
}) {
  return (
    <DropdownMenuItem
      disabled={busy}
      onClick={() => onLoad(prompt.text, prompt.label)}
      onKeyDown={e => {
        if (!pressed(e, 'deletePrompt')) return
        e.preventDefault()
        onDelete(prompt)
      }}
      aria-keyshortcuts="Delete"
      className="items-center gap-2"
    >
      <span className="flex-1 truncate">{prompt.label}</span>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              disabled={busy}
              onClick={e => {
                // Delete, not load — keep the row's own click out of it.
                e.stopPropagation()
                onDelete(prompt)
              }}
              aria-label={`Delete saved prompt ${prompt.label}`}
              className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-danger"
            />
          }
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </TooltipTrigger>
        <TooltipContent>Delete &quot;{prompt.label}&quot;</TooltipContent>
      </Tooltip>
    </DropdownMenuItem>
  )
}

/** The prompts in groups, by whose they are, in the order the first of each comes. */
function grouped(prompts: readonly OfferedPrompt[]): [string, OfferedPrompt[]][] {
  const groups = new Map<string, OfferedPrompt[]>()
  for (const prompt of prompts) groups.set(prompt.group, [...(groups.get(prompt.group) ?? []), prompt])
  return [...groups]
}

export function CommandsMenu({
  commands,
  prompts,
  busy,
  onLoad,
  onNew,
  onDelete,
}: {
  commands: CommandEntry[]
  /** The saved prompts the box offers: each group of them is a part of the menu. */
  prompts: readonly OfferedPrompt[]
  busy: boolean
  /** Load a text into the editor: a command as `/<name> `, a saved prompt verbatim. */
  onLoad: (text: string, label: string) => void
  /** Open the panel that saves what the box holds; absent where none is there. */
  onNew?: (() => void) | undefined
  /** Delete a saved prompt. */
  onDelete: (prompt: OfferedPrompt) => void
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              type="button"
              disabled={busy}
              aria-label="Commands"
              // Square, 5 in from the box's edges, its corner following the box's: its + stands where the rows' icons do.
              className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), IN_BOX, 'text-muted-foreground data-[popup-open]:bg-accent')}
            />
          }
        >
          <Plus className="h-4 w-4" aria-hidden />
        </TooltipTrigger>
        {/* Beside the box, not over the pickers above it. */}
        <TooltipContent side="left" className="max-w-[15rem]">{'Run a command or load a saved prompt. In the box: /\u00a0commands · @\u00a0projects · #\u00a0files'}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-[16rem] max-w-[20rem]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Commands</DropdownMenuLabel>
          {commands.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">This project has no commands.</div>}
          {commands.map(c => {
            // A skill written into the folder and not yet on the branch agents start from: an agent started now does not have its command.
            const itemProps = {
              disabled: busy || c.waiting !== undefined,
              onClick: () => onLoad(`/${c.name} `, `/${c.name}`),
              className: 'items-start',
            }
            const label = <OptionLabel label={`/${c.name}`} {...(c.waiting !== undefined ? { description: `waiting to reach ${c.waiting}` } : {})} />
            if (!c.description)
              return (
                <DropdownMenuItem key={c.name} {...itemProps}>
                  {label}
                </DropdownMenuItem>
              )
            return (
              <Tooltip key={c.name}>
                <TooltipTrigger render={<DropdownMenuItem {...itemProps} />}>{label}</TooltipTrigger>
                <TooltipContent className="max-w-[22rem]">{c.description}</TooltipContent>
              </Tooltip>
            )
          })}
        </DropdownMenuGroup>
        {grouped(prompts).map(([group, saved]) => (
          <DropdownMenuGroup key={group}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{group}</DropdownMenuLabel>
            {saved.map(prompt => (
              <SavedPromptRow key={`${prompt.package} ${prompt.id}`} prompt={prompt} busy={busy} onLoad={onLoad} onDelete={onDelete} />
            ))}
          </DropdownMenuGroup>
        ))}
        {onNew && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={busy} onClick={onNew}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Save prompt…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
