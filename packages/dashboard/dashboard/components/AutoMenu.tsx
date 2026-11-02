import { Check, ChevronDown } from 'lucide-react'
import { PUBLISH_LABELS, type PublishPick } from '../../src/client.js'
import { cn } from '../lib/utils.js'
import { rowButtonClass } from './ui/row-item.js'
import { OptionLabel } from './ui/option-label.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
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

// The launcher's "Auto" menu, under the box: how far the agent publishes its work when it
// finishes and, where a level opens a pull request and more than one branch can take it, which
// branch it goes into. The trigger reads the picks themselves ("Auto: Open PR → login-page"), so
// what a Start will do is on screen with the menu shut.
export function AutoMenu({
  publish,
  picks,
  onPublish,
  target,
  busy,
}: {
  /** The publish pick in force. */
  publish: PublishPick
  /** The publish picks the project is offered. */
  picks: readonly PublishPick[]
  onPublish: (pick: PublishPick) => void
  /** Absent where the pull request goes into the default branch with no say. */
  target?: PrTarget | undefined
  busy: boolean
}) {
  // Only the levels that open a pull request have one to name.
  const opensRequest = publish === 'pr' || publish === 'merge'
  const into = opensRequest ? target : undefined
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              type="button"
              disabled={busy}
              aria-label="Auto"
              // A branch's name can run long: of a set width at most, as the branch button is, phone too.
              className={cn(rowButtonClass, 'max-w-[20rem]!')}
            />
          }
        >
          <span className="truncate">{`Auto: ${PUBLISH_LABELS[publish]}${into ? ` → ${into.into}` : ''}`}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{`What the agent does by itself when it finishes.${into ? ` The pull request goes into ${into.into}.` : ''}`}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent className="min-w-[19rem] max-w-[22rem]">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">When the agent finishes</DropdownMenuLabel>
          {picks.map(pick => (
            // aria-current: the check mark is only drawn, so a screen reader is told the pick too.
            <DropdownMenuItem key={pick} className="items-start" aria-current={pick === publish} onClick={() => onPublish(pick)}>
              <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', pick === publish ? 'opacity-100' : 'opacity-0')} aria-hidden />
              <OptionLabel label={PUBLISH_LABELS[pick]} description={PUBLISH_DESCRIPTIONS[pick]} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {into?.picks && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal">The pull request goes into</DropdownMenuLabel>
              {into.picks.map(branch => (
                <DropdownMenuItem key={branch} aria-current={branch === into.into} onClick={() => into.onPick?.(branch)}>
                  <Check className={cn('h-3.5 w-3.5 shrink-0', branch === into.into ? 'opacity-100' : 'opacity-0')} aria-hidden />
                  <span className="truncate">{branch}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
