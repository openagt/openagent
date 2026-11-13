import { Check } from 'lucide-react'
import { PUBLISH_LABELS, type PublishPick } from '../../src/client.js'
import { cn } from '../lib/utils.js'
import { rowButtonClass, RowChevron } from './ui/row-item.js'
import { OptionLabel } from './ui/option-label.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
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
              // A branch's name can run long: of a set width at most, as the branch button is, phone too.
              className={cn(rowButtonClass, 'max-w-[20rem]!')}
            />
          }
        >
          <span className="truncate">{`Auto: ${PUBLISH_LABELS[publish]}${into ? ` → ${into.into}` : ''}`}</span>
          <RowChevron />
        </TooltipTrigger>
        <TooltipContent>{`What the agent does by itself when it finishes.${into ? ` The pull request goes into ${into.into}.` : ''}`}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent className="min-w-[19rem] max-w-[22rem]">
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
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
