import type { CustomPreset } from '../../src/index.js'
import type { ProjectLauncher } from '../rpc/projects.js'
import { Plus, X } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { buttonVariants } from './ui/button.js'
import { OptionLabel } from './ui/option-label.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from './ui/dropdown-menu.js'

/** One of the project's commands, as `onCommands` reads it off the project's skills. */
export type CommandEntry = ProjectLauncher['commands'][number]

// The visible face of what a project can be asked to do (#948, #1774): its commands, and the
// prompts a person saved. Loading used to live only behind typing `/` in the editor, which gave
// a first-time user no sign that any exist. This button is the one surface that loads, saves,
// and deletes; the `/` menu stays as the fast path for those who know it.
/** One saved (user or project) prompt row: click loads it, the X deletes it. */
function SavedPresetRow({
  preset,
  busy,
  onLoad,
  onDelete,
}: {
  preset: CustomPreset
  busy: boolean
  onLoad: (text: string, label: string) => void
  onDelete: (id: string) => void
}) {
  return (
    <DropdownMenuItem disabled={busy} onClick={() => onLoad(preset.prompt, preset.label)} className="items-center gap-2">
      <span className="flex-1 truncate">{preset.label}</span>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              disabled={busy}
              onClick={e => {
                // Delete, not load — keep the row's own click out of it.
                e.stopPropagation()
                onDelete(preset.id)
              }}
              aria-label={`Delete saved prompt ${preset.label}`}
              className="rounded p-0.5 text-[var(--color-muted-foreground)] hover:text-danger"
            />
          }
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </TooltipTrigger>
        <TooltipContent>Delete &quot;{preset.label}&quot;</TooltipContent>
      </Tooltip>
    </DropdownMenuItem>
  )
}

export function CommandsMenu({
  commands,
  customPresets,
  projectPresets,
  busy,
  onLoad,
  onNew,
  onDelete,
  onDeleteProject,
}: {
  commands: CommandEntry[]
  customPresets: CustomPreset[]
  /** The open project's shared saved prompts, committed in its `.openagent/` (#1025). */
  projectPresets: CustomPreset[]
  busy: boolean
  /** Load a text into the editor: a command as `/<name> `, a saved prompt verbatim. */
  onLoad: (text: string, label: string) => void
  /** Open the create panel; absent where no panel renders. */
  onNew?: (() => void) | undefined
  /** Delete one of the user's saved prompts by id. */
  onDelete: (id: string) => void
  /** Delete a shared project saved prompt by id. */
  onDeleteProject: (id: string) => void
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
              className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'h-8 w-8')}
            />
          }
        >
          <Plus className="h-4 w-4" aria-hidden />
        </TooltipTrigger>
        <TooltipContent>Run a command or load a saved prompt. In the box: / commands · @ projects · # files</TooltipContent>
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
        {customPresets.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Your saved prompts</DropdownMenuLabel>
            {customPresets.map(p => (
              <SavedPresetRow key={p.id} preset={p} busy={busy} onLoad={onLoad} onDelete={onDelete} />
            ))}
          </DropdownMenuGroup>
        )}
        {projectPresets.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Project saved prompts</DropdownMenuLabel>
            {projectPresets.map(p => (
              <SavedPresetRow key={p.id} preset={p} busy={busy} onLoad={onLoad} onDelete={onDeleteProject} />
            ))}
          </DropdownMenuGroup>
        )}
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
