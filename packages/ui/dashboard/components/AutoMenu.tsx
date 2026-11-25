import { Check, GitMerge } from 'lucide-react'
import type { UiProject } from '@openagt/hooks/ui'
import type { PublishPick } from '../../src/client.js'
import { pickIn } from '../../src/client.js'
import { useMountedModules } from '../lib/use-modules.js'
import { onIn } from './Places.js'
import { SetupLine } from './SessionSetup.js'
import { OptionLabel } from './ui/option-label.js'
import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from './ui/dropdown-menu.js'

/** A level of the menu: its pick, and what the menu says of it. */
export interface AutoLevel {
  id: PublishPick
  label: string
  description?: string | undefined
}

/** The menu's first line, the shell's own: no level, so nothing is added to the message. */
const OFF: AutoLevel = { id: 'nothing', label: 'Off', description: 'Adds nothing to your message. The agent decides, and usually commits.' }

/**
 * The levels the menu offers in the project `projectId` (`project`, as a place is given it; none
 * for a session with no project, or one not read yet), in order: Off, then each module's
 * (`composer.auto`) where it says it is offered. A session with no project is offered every level:
 * it publishes its copies of repos, wherever each is.
 */
export function useAutoLevels(projectId: string, project: UiProject | undefined): AutoLevel[] {
  const options = useMountedModules().options['composer.auto']
  const modules = options.filter(option => onIn(option, projectId) && (option.offered?.(project) ?? true)).map((option): AutoLevel => ({ id: option.id as PublishPick, label: option.label, description: option.description }))
  return [OFF, ...modules]
}

/** The pick in force among `levels`: the one saved, else Commit, else the furthest offered short of the saved one. */
export function autoPickIn(saved: PublishPick | undefined, levels: readonly AutoLevel[]): PublishPick {
  return pickIn(saved, levels.map(level => level.id))
}

/** The level in the words the gear's menu and its hover say: "Off" alone would not say what is off. */
export function autoSaid(publish: PublishPick, levels: readonly AutoLevel[]): string {
  return publish === 'nothing' ? 'Auto off' : (levels.find(level => level.id === publish)?.label ?? publish)
}

// The "When it finishes" line of the gear's menu, set apart under the session's own lines: how far
// the agent publishes its work when it finishes (the Auto level). The line reads the pick itself,
// as the gear's hover does with the menu shut.
// One level holds for all the session works in (his pick, over a level per repo): with copies of
// repos, a small line under it says what the level is for (`covers`).
export function AutoMenu({
  publish,
  levels,
  onPublish,
  covers,
}: {
  /** The publish pick in force. */
  publish: PublishPick
  /** The levels the project is offered ({@link useAutoLevels}). */
  levels: readonly AutoLevel[]
  onPublish: (pick: PublishPick) => void
  /** What the level is for, when the session has copies of repos: said under the line. */
  covers?: string | undefined
}) {
  return (
    <>
      <DropdownMenuSeparator />
      <SetupLine icon={<GitMerge aria-hidden />} label="When it finishes" value={<span className="truncate">{autoSaid(publish, levels)}</span>} className="min-w-[19rem] max-w-[22rem]">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">When the agent finishes</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={publish} onValueChange={(pick: PublishPick) => onPublish(pick)}>
            {levels.map(level => (
              <DropdownMenuRadioItem key={level.id} value={level.id} className="items-start">
                <OptionLabel label={level.label} {...(level.description !== undefined ? { description: level.description } : {})} />
                {level.id === publish && <Check className="ml-auto mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </SetupLine>
      {covers !== undefined && <p className="px-2 pb-1 pl-8 text-xs text-muted-foreground">{covers}</p>}
    </>
  )
}

/** What a level is for in a session with copies of repos: its project and them, or them alone. Nothing to say with no copy. */
export function autoCovers(project: string | null | undefined, copies: number): string | undefined {
  if (copies === 0) return undefined
  return project ? `For ${project} and each copied repo it changed` : 'For each copied repo it changed'
}
