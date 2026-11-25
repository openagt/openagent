import { RefreshCw } from 'lucide-react'
import { StartAgentButton } from '@openagt/ui/module'
import { UPDATE_TICKETS_PROMPT } from '../src/module.js'

/**
 * "Update tickets", as one button the tickets panel renders in its header and in its empty state;
 * the onboarding card's "Populate the tickets" starts the same prompt (`../src/attention.ts`). The
 * label, the prompt behind it, and what the tooltip promises were written out per surface, which is
 * the same drift the shared prompt exists to prevent: one wording change and the other surfaces
 * would still say the old thing.
 */
export function UpdateTicketsButton({
  busy,
  onStart,
  onConfigure,
  lastImportedAt,
  disabled,
  variant,
  size = 'default',
  className,
}: {
  busy: boolean
  onStart: () => void
  /** Open the launcher with this prompt instead of spending a session on it. */
  onConfigure: () => void
  /** When tickets last came across, so the tooltip can promise the incremental update (#1265). */
  lastImportedAt?: string | undefined
  disabled?: boolean | undefined
  variant?: 'default' | 'secondary' | 'outline' | undefined
  size?: 'sm' | 'default' | undefined
  className?: string | undefined
}) {
  return (
    <StartAgentButton
      {...(variant ? { variant } : {})}
      size={size}
      {...(disabled !== undefined ? { disabled } : {})}
      {...(className ? { className } : {})}
      icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
      label="Update tickets"
      menuAriaLabel="Other ways to update the tickets"
      tooltip={
        lastImportedAt
          ? 'Bring tickets/ up to date with the issues and comments changed since the last import.'
          : 'Bring tickets/ up to date with the issue tracker. With no import on record, everything open comes across.'
      }
      busy={busy}
      starting={busy}
      onStart={onStart}
      onConfigure={onConfigure}
      prompt={UPDATE_TICKETS_PROMPT}
      configureDescription="Opens the launcher with the update prompt, so you can set the model and where it runs."
    />
  )
}
