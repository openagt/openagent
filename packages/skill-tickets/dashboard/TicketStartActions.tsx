import { ClipboardList, ClipboardPlus, Play } from 'lucide-react'
import { Button, StartAgentButton } from '@openagt/dashboard/module'
import { planTicketPrompt, workOnTicketPrompt } from '../src/module.js'

/**
 * A ticket page's starts, in words: the list row's start and plan columns, where the ticket or its
 * plan is being read. The plan one writes the plan, or opens it once it is written; the plan's own
 * page leaves it out. Each start's chevron opens the launcher with the same ask, as on the row.
 */
export function TicketStartActions({
  file,
  title,
  planned,
  busy,
  onStart,
  onConfigure,
  onOpenPlan,
}: {
  file: string
  title: string
  planned?: boolean | undefined
  /** A start is in flight on this page. */
  busy: boolean
  /** Start an agent with one of the asks; `failure` is what to say when it cannot start. */
  onStart: (prompt: string, failure: string) => void
  /** The launcher, prefilled with that button's ask. */
  onConfigure: (prompt: string) => void
  /** Open the ticket's plan. Without it, no plan action shows. */
  onOpenPlan?: (() => void) | undefined
}) {
  const work = workOnTicketPrompt(file)
  const plan = planTicketPrompt(file)
  return (
    <>
      {onOpenPlan &&
        (planned ? (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onOpenPlan}>
            <ClipboardList className="h-3.5 w-3.5" aria-hidden /> View plan
          </Button>
        ) : (
          <StartAgentButton
            size="sm"
            icon={<ClipboardPlus className="h-3.5 w-3.5" aria-hidden />}
            label="Write a plan"
            menuAriaLabel={`Other ways to plan ${title}`}
            tooltip="Starts an agent to write this ticket's plan"
            busy={busy}
            prompt={plan}
            configureDescription="Opens the launcher with the plan prompt, so you can set the model and where it runs."
            onStart={() => onStart(plan, 'The planning agent could not be started.')}
            onConfigure={() => onConfigure(plan)}
          />
        ))}
      <StartAgentButton
        size="sm"
        icon={<Play className="h-3.5 w-3.5" aria-hidden />}
        label="Start work"
        menuAriaLabel={`Other ways to work on ${title}`}
        tooltip="Starts an agent working on this ticket"
        busy={busy}
        prompt={work}
        configureDescription="Opens the launcher with this ticket's prompt, so you can set the model and where it runs."
        onStart={() => onStart(work, 'The work agent could not be started.')}
        onConfigure={() => onConfigure(work)}
      />
    </>
  )
}
