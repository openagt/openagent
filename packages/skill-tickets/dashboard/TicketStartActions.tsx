import { useEffect, useState } from 'react'
import { Check, ClipboardPlus, Play } from 'lucide-react'
import { StartAgentButton, useLinkActions, type StartMenuItem } from '@openagt/dashboard/module'
import { planLink, planTicketPrompt, ticketLink, workOnTicketPrompt } from '../src/module.js'

/**
 * A ticket's next step, now or later, wherever the ticket is shown: with no plan yet, its plan is
 * written now or queued; with one, the work is started now or queued. "Now" starts an agent;
 * "later" hands the same ask to the installed modules' link actions — "Add to queue" when the
 * project has a queue package — and offers nothing without one. One button, the step now, the rest
 * in its menu, so a ticket's actions never crowd it; shorter words on the list's dense rows
 * (`compact`). The caller leaves it out for a ticket no agent is handed: in review, waiting, claimed.
 */
export function TicketStartActions({
  projectId,
  ticket,
  busy,
  starting = null,
  onStart,
  onConfigure,
  compact = false,
}: {
  projectId: string
  ticket: { file: string; title: string; planned?: boolean | undefined; priority?: string | undefined }
  /** A start is in flight on this surface. */
  busy: boolean
  /** The prompt whose start is in flight, if any: only that ask's button spins. */
  starting?: string | null | undefined
  /** Start an agent with the ask; `failure` is what to say when it cannot start. */
  onStart: (prompt: string, failure: string) => void
  /** The launcher, prefilled with the ask. */
  onConfigure: (prompt: string) => void
  /** The list's rows: a smaller button, shorter words. */
  compact?: boolean | undefined
}) {
  const step = ticket.planned
    ? {
        prompt: workOnTicketPrompt(ticket.file),
        now: compact ? 'Start' : 'Start work',
        later: 'Queue work',
        Icon: Play,
        tooltip: 'Starts an agent working on this ticket, from its plan',
        laterSays: 'An agent works on it when the queue reaches it.',
        menu: `Other ways to work on ${ticket.title}`,
        configure: "Opens the launcher with this ticket's prompt, so you can set the model and where it runs.",
        failure: 'The work agent could not be started.',
        link: ticketLink(ticket),
      }
    : {
        prompt: planTicketPrompt(ticket.file),
        now: compact ? 'Plan' : 'Plan now',
        later: 'Queue plan',
        Icon: ClipboardPlus,
        tooltip: "Starts an agent writing this ticket's plan",
        laterSays: 'An agent writes the plan when the queue reaches it.',
        menu: `Other ways to plan ${ticket.title}`,
        configure: 'Opens the launcher with the plan prompt, so you can set the model and where it runs.',
        failure: 'The planning agent could not be started.',
        link: planLink(ticket),
      }
  const targets = [{ projectId, links: [step.link] }]
  const { actions, run } = useLinkActions([projectId], targets)
  // What the menu's queue item did, until the ask changes (a plan queued, then written, is a new ask).
  const [queued, setQueued] = useState<'running' | 'done' | { error: string } | null>(null)
  useEffect(() => setQueued(null), [step.prompt])
  const queue = async (key: string) => {
    setQueued('running')
    const result = await run(key, targets)
    setQueued(result.ok ? 'done' : { error: result.error })
  }
  // Queued here, or read as queued already (an entry on the queue for this ask).
  const isQueued = queued === 'done' || actions.some(action => action.done)
  const moreItems: StartMenuItem[] = actions.map(action => ({
    label: queued === 'done' || action.done ? (action.doneLabel ?? action.label) : step.later,
    description: step.laterSays,
    disabled: queued === 'running' || queued === 'done' || action.done,
    onSelect: () => void queue(action.key),
  }))
  const size = compact ? 'sm' : 'default'
  return (
    <>
      {isQueued && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Check className="size-3.5" aria-hidden /> Queued
        </span>
      )}
      {queued !== null && typeof queued === 'object' && (
        <span role="alert" title={queued.error} className="text-xs text-danger">
          {compact ? 'Not queued' : `Not queued: ${queued.error}`}
        </span>
      )}
      {/* The page's one primary press; on a list's row, a ghost press among many rows. */}
      <StartAgentButton
        variant={compact ? 'ghost' : 'default'}
        size={size}
        icon={<step.Icon className="size-4" aria-hidden />}
        label={step.now}
        menuAriaLabel={step.menu}
        tooltip={step.tooltip}
        busy={busy}
        starting={starting === step.prompt}
        prompt={step.prompt}
        configureDescription={step.configure}
        onStart={() => onStart(step.prompt, step.failure)}
        onConfigure={() => onConfigure(step.prompt)}
        moreItems={moreItems}
      />
    </>
  )
}
