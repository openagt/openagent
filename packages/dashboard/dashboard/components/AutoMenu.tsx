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
} from './ui/dropdown-menu.js'

const PUBLISH_DESCRIPTIONS: Readonly<Record<PublishPick, string>> = {
  nothing: 'Adds nothing to your message. The agent decides, and usually commits.',
  commit: 'It commits its work on its branch.',
  branch: 'It commits and pushes its branch.',
  pr: 'It commits, pushes its branch and opens a pull request.',
  merge: 'It commits, pushes its branch and opens a pull request set to merge once its checks pass.',
}

// The launcher's "Auto" menu, under the box: how far the agent publishes its work when it
// finishes. The trigger reads the pick itself ("Auto: Open PR"), so what a Start will do is on
// screen with the menu shut.
export function AutoMenu({
  publish,
  picks,
  onPublish,
  busy,
}: {
  /** The publish pick in force. */
  publish: PublishPick
  /** The publish picks the project is offered. */
  picks: readonly PublishPick[]
  onPublish: (pick: PublishPick) => void
  busy: boolean
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              type="button"
              disabled={busy}
              aria-label="Auto"
              className={rowButtonClass}
            />
          }
        >
          <span className="truncate">{`Auto: ${PUBLISH_LABELS[publish]}`}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        </TooltipTrigger>
        <TooltipContent>What the agent does by itself when it finishes.</TooltipContent>
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
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
