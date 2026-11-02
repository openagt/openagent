import type { ReactNode } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { stashPendingDraft } from '../lib/draft-handoff.js'
import { cn } from '../lib/utils.js'
import { Button, buttonVariants } from './ui/button.js'
import { OptionLabel } from './ui/option-label.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './ui/dropdown-menu.js'

// Every button in the dashboard that starts an agent (#1507): the click itself, and beside it the
// chevron that opens the launcher with the same prompt instead of spending an agent on it.
//
// A start button spends a session on settings that are nowhere near it — which CLI, which model,
// where it runs — because those live in the launcher and the Global options. The only way to
// change them used to be to leave the page, edit the preferences, come back, and hope the button
// still meant the same thing. "Configure first, then run" is that trip collapsed into the button
// itself: the same prompt, handed to the launcher, where all three controls are and where the
// prompt can be edited before it is sent.
//
// It shipped on the Routine work card first and is the shape every start wears now, so a start is
// the same two-part offer wherever it is met — press to run it as configured, or open the chevron
// to set it up first. One component rather than the pattern copied per surface: the wording,
// the keyboard reachability and the "starts nothing, so it stays live" rule are the same promise
// on all of them, and a copy is what lets one of them quietly stop keeping it.
//
// A split button, not a control revealed on hover: what a hover reveals is reachable by neither
// keyboard nor touch, and the row the pointer is on is not always the row that is meant.

export function StartAgentButton({
  icon,
  label,
  busyLabel = 'Starting…',
  ariaLabel,
  menuAriaLabel,
  tooltip,
  tooltipClassName,
  prompt,
  configureDescription,
  onStart,
  onConfigure,
  busy = false,
  starting = false,
  disabled = false,
  variant = 'outline',
  size = 'xs',
  className,
}: {
  /** The primary half's icon; swapped for a spinner while this button's own start is in flight. */
  icon: ReactNode
  /** The primary half's text. Omitted on the dense rows, which are icon-only — pass `ariaLabel` there. */
  label?: string | undefined
  /** What the primary half reads while this button's own start is in flight. */
  busyLabel?: string | undefined
  /** The primary half's accessible name. Required where there is no `label` to serve as one. */
  ariaLabel?: string | undefined
  /** The chevron's accessible name — it has no text of its own, and "menu" would not say whose. */
  menuAriaLabel: string
  /** What the primary half promises on hover: what it does, and what it is about to spend. */
  tooltip: ReactNode
  tooltipClassName?: string | undefined
  /**
   * The prompt "Configure first, then run" hands the launcher. For a click that starts several
   * agents, the one the launcher can actually send — `configureDescription` then says so.
   */
  prompt: string
  /** The menu entry's second line: what this particular launcher trip is for. */
  configureDescription: string
  onStart: () => void
  /**
   * Open the launcher the prompt was stashed for — the project's own, since a draft is only
   * rehydrated by the launcher of the project the reader lands on.
   */
  onConfigure: () => void
  /** A start is in flight somewhere on this surface: the primary half is out until it settles. */
  busy?: boolean | undefined
  /** *This* button's start is the one in flight, so only it reads as busy. */
  starting?: boolean | undefined
  /** There is nothing to act on at all (no project picked): both halves are out. */
  disabled?: boolean | undefined
  variant?: 'default' | 'outline' | 'ghost' | undefined
  size?: 'xs' | 'sm' | 'icon-sm' | undefined
  /** Styling the two halves share, so the pair reads as one control rather than two buttons. */
  className?: string | undefined
}) {
  /**
   * The carry is the draft stash a hot ticket already uses (#1066/#1139) rather than a second
   * mechanism: the launcher takes it once as it mounts, so nothing re-seeds on a reload. Owned
   * here rather than by each caller, because a caller that navigates without stashing lands the
   * reader on an empty composer — which is the dead end this button exists to close.
   */
  const configure = () => {
    stashPendingDraft(prompt)
    onConfigure()
  }

  return (
    <div className="inline-flex shrink-0 items-center">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant={variant}
              size={size}
              disabled={disabled || busy}
              onClick={onStart}
              {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
              className={cn('rounded-r-none', variant === 'outline' && 'border-r-0', className)}
            />
          }
        >
          {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : icon}
          {label !== undefined && (starting ? busyLabel : label)}
        </TooltipTrigger>
        <TooltipContent {...(tooltipClassName ? { className: tooltipClassName } : {})}>{tooltip}</TooltipContent>
      </Tooltip>
      {/* Never gated on `busy`, only on `disabled`: this starts nothing, and being unable to go
          and look at the settings because a start is in flight would be the opposite of the point. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          type="button"
          disabled={disabled}
          aria-label={menuAriaLabel}
          className={cn(
            buttonVariants({ variant, size }),
            'w-auto rounded-l-none px-1.5',
            // What separates the two halves. An outline button's own left border already does it
            // (its sibling drops its right one); a filled button has no border to borrow, so it
            // gets a hairline in its own foreground. A ghost pair needs none — there is nothing
            // drawn between them until one is hovered, and a rule would only clutter a dense row.
            variant === 'default' && 'border-l border-[var(--color-primary-foreground)]/25',
            className,
          )}
        >
          <ChevronDown className="h-3 w-3" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-[20rem]">
          <DropdownMenuItem onClick={configure} className="items-start">
            <OptionLabel label="Configure first, then run" description={configureDescription} />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
