import { Check, GitMerge } from 'lucide-react'
import { PUBLISH_LABELS, type PublishPick } from '../../src/client.js'
import { SetupLine } from './SessionSetup.js'
import { OptionLabel } from './ui/option-label.js'
import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from './ui/dropdown-menu.js'

const PUBLISH_DESCRIPTIONS: Readonly<Record<PublishPick, string>> = {
  nothing: 'Adds nothing to your message. The agent decides, and usually commits.',
  commit: 'It commits its work on its branch.',
  branch: 'It commits and pushes its branch.',
  pr: 'It commits, pushes its branch and opens a pull request.',
  merge: 'It commits, pushes its branch and opens a pull request set to merge once its checks pass.',
}

/** Where a pull request goes: the branch now, and, on the launcher, the branches to pick from. */
export interface PrTarget {
  into: string
  picks?: readonly string[]
  onPick?: (branch: string) => void
}

/** The level in the words the gear's menu and its hover say: "Off" alone would not say what is off. */
export function autoSaid(publish: PublishPick, target?: PrTarget | undefined): string {
  const into = publish === 'pr' || publish === 'merge' ? target : undefined
  return `${publish === 'nothing' ? 'Auto off' : PUBLISH_LABELS[publish]}${into ? ` → ${into.into}` : ''}`
}

// The "When it finishes" line of the gear's menu, set apart under the session's own lines: how far
// the agent publishes its work when it finishes (the Auto level) and, where a level opens a pull
// request and more than one branch can take it, which branch it goes into. The line reads the
// picks themselves ("Open PR → login-page"), as the gear's hover does with the menu shut.
// One level holds for all the session works in (his pick, over a level per repo): with copies of
// repos, a small line under it says what the level is for (`covers`).
export function AutoMenu({
  publish,
  picks,
  onPublish,
  target,
  covers,
}: {
  /** The publish pick in force. */
  publish: PublishPick
  /** The publish picks the project is offered. */
  picks: readonly PublishPick[]
  onPublish: (pick: PublishPick) => void
  /** Absent where the pull request goes into the default branch with no say. */
  target?: PrTarget | undefined
  /** What the level is for, when the session has copies of repos: said under the line. */
  covers?: string | undefined
}) {
  // Only the levels that open a pull request have one to name.
  const opensRequest = publish === 'pr' || publish === 'merge'
  const into = opensRequest ? target : undefined
  return (
    <>
      <DropdownMenuSeparator />
      <SetupLine icon={<GitMerge aria-hidden />} label="When it finishes" value={<span className="truncate">{autoSaid(publish, target)}</span>} className="min-w-[19rem] max-w-[22rem]">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">When the agent finishes</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={publish} onValueChange={(pick: PublishPick) => onPublish(pick)}>
            {picks.map(pick => (
              <DropdownMenuRadioItem key={pick} value={pick} className="items-start">
                <OptionLabel label={PUBLISH_LABELS[pick]} description={PUBLISH_DESCRIPTIONS[pick]} />
                {pick === publish && <Check className="ml-auto mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {into?.picks && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal">The pull request goes into</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={into.into} onValueChange={(branch: string) => into.onPick?.(branch)}>
                {into.picks.map(branch => (
                  <DropdownMenuRadioItem key={branch} value={branch}>
                    <span className="flex-1 truncate">{branch}</span>
                    {branch === into.into && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </>
        )}
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
