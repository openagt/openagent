import { ClipboardPlus, Play } from 'lucide-react'
import { LinkActions, StartAgentButton } from '@openagt/dashboard/module'
import { planLink, planTicketPrompt, ticketLink, workOnTicketPrompt } from '../src/module.js'

/**
 * A ticket's next step, now or later, wherever the ticket is shown: with no plan yet, its plan is
 * written now or queued; with one, the work is started now or queued. "Now" starts an agent, and
 * its chevron opens the launcher with the same ask; "later" hands the same ask to the installed
 * modules' link actions — "Add to queue" when the project has a queue package — and shows nothing
 * without one. The caller leaves it out for a ticket no agent is handed: in review, waiting, claimed.
 */
export function TicketStartActions({
  projectId,
  ticket,
  busy,
  onStart,
  onConfigure,
  size = 'sm',
}: {
  projectId: string
  ticket: { file: string; title: string; planned?: boolean | undefined; priority?: string | undefined }
  /** A start is in flight on this surface. */
  busy: boolean
  /** Start an agent with the ask; `failure` is what to say when it cannot start. */
  onStart: (prompt: string, failure: string) => void
  /** The launcher, prefilled with the ask. */
  onConfigure: (prompt: string) => void
  /** `xs` on the list's dense rows. */
  size?: 'xs' | 'sm' | undefined
}) {
  const icon = size === 'xs' ? 'h-3 w-3' : 'h-3.5 w-3.5'
  const step = ticket.planned
    ? {
        prompt: workOnTicketPrompt(ticket.file),
        now: 'Start work',
        later: 'Queue work',
        icon: <Play className={icon} aria-hidden />,
        tooltip: 'Starts an agent working on this ticket, from its plan',
        laterTooltip: 'Adds the ticket to the queue: an agent works on it when the queue reaches it',
        menu: `Other ways to work on ${ticket.title}`,
        configure: "Opens the launcher with this ticket's prompt, so you can set the model and where it runs.",
        failure: 'The work agent could not be started.',
        link: ticketLink(ticket),
      }
    : {
        prompt: planTicketPrompt(ticket.file),
        now: 'Plan now',
        later: 'Queue plan',
        icon: <ClipboardPlus className={icon} aria-hidden />,
        tooltip: "Starts an agent writing this ticket's plan",
        laterTooltip: "Adds the ticket's plan to the queue: an agent writes it when the queue reaches it",
        menu: `Other ways to plan ${ticket.title}`,
        configure: 'Opens the launcher with the plan prompt, so you can set the model and where it runs.',
        failure: 'The planning agent could not be started.',
        link: planLink(ticket),
      }
  return (
    <>
      <StartAgentButton
        size={size}
        icon={step.icon}
        label={step.now}
        menuAriaLabel={step.menu}
        tooltip={step.tooltip}
        busy={busy}
        prompt={step.prompt}
        configureDescription={step.configure}
        onStart={() => onStart(step.prompt, step.failure)}
        onConfigure={() => onConfigure(step.prompt)}
      />
      <LinkActions
        projects={[projectId]}
        targets={[{ projectId, links: [step.link] }]}
        // A plan queued, then written, arms the work's button: a new ask.
        resetKey={`${ticket.file}\n${step.prompt}`}
        label={() => step.later}
        tooltip={step.laterTooltip}
        size={size}
        disabled={busy}
      />
    </>
  )
}
