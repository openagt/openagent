import { RefreshCw } from 'lucide-react'
import { StartAgentButton } from '@openagt/dashboard/module'
import { UPDATE_TICKETS_PROMPT } from '../src/module.js'

/**
 * "Update tickets", as one button both of the panel's surfaces render: its header and its
 * empty state. The label, the prompt behind it (`UPDATE_TICKETS_PROMPT`, the project's
 * `update-tickets` command) and what the tooltip promises are written once, so one label means
 * one instruction wherever it is pressed.
 */
export function UpdateTicketsButton({
  busy,
  starting,
  onStart,
  onConfigure,
  lastImportedAt,
}: {
  busy: boolean
  /** This update is the start in flight: the button spins, not the one beside it that started something else. */
  starting: boolean
  onStart: () => void
  /** Open the launcher with this prompt instead of spending a session on it. */
  onConfigure: () => void
  /** When tickets last came across, so the tooltip can promise the incremental update (#1265). */
  lastImportedAt?: string | undefined
}) {
  return (
    // A secondary press beside the list's primary: the start button's ghost pair on the secondary's soft fill.
    <StartAgentButton
      variant="ghost"
      size="default"
      className="bg-accent hover:bg-foreground/10 active:bg-foreground/15"
      icon={<RefreshCw className="size-4" aria-hidden />}
      label="Update tickets"
      menuAriaLabel="Other ways to update the tickets"
      tooltip={
        lastImportedAt
          ? 'Bring tickets/ up to date with the issues and comments changed since the last import.'
          : 'Bring tickets/ up to date with the issue tracker. With no import on record, everything open comes across.'
      }
      busy={busy}
      starting={starting}
      onStart={onStart}
      onConfigure={onConfigure}
      prompt={UPDATE_TICKETS_PROMPT}
      configureDescription="Opens the launcher with the update prompt, so you can set the model and where it runs."
    />
  )
}
