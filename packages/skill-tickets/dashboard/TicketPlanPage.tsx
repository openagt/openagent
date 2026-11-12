import { Badge, Markdown, useAction, usePolled, useModuleHost } from '@openagt/dashboard/module'
import { heldBack, planBody, planPath, readShown, type TicketDetail } from '../src/module.js'
import { TicketPageShell, TicketPageNote } from './TicketPageShell.js'
import { TicketStartActions } from './TicketStartActions.js'
import { TicketSessions, sessionsOf, type TicketSession } from './TicketSessions.js'
import { useBackToList } from './lib/back-to-list.js'

/** The page's read: the plan's text (none when the ticket has no plan, or no ticket), its ticket, the sessions behind them, or why the command failed. */
type Read = { plan: string | null; ticket: TicketDetail | undefined; sessions: TicketSession[] } | { error: string }

// One ticket's plan, the destination of the plan column's link: the ticket's title as the page's
// heading with the plan's facts under it, the sessions that wrote and worked it, the next step, and
// the plan itself set as a document. The plan comes with the ticket from `tickets show <file>
// --local`; `slug` is the ticket's filename, the same the list row and the URL carry, so the plan is
// addressed by the ticket it belongs to.
export function TicketPlanPage({
  projectId,
  slug,
}: {
  projectId: string
  /** The ticket's filename inside `tickets/`, same as `WorkspaceTicket.file`. */
  slug: string
}) {
  const host = useModuleHost()
  const path = planPath(slug)
  const onBack = useBackToList(host, [slug, 'plan'])
  const { value: read, loaded } = usePolled<Read | null>(
    async () => {
      const [shown, agents] = await Promise.all([host.runCommand(projectId, ['show', slug, '--local']).then(readShown), host.agents(projectId).catch(() => [])])
      if ('error' in shown) return shown
      const ticket = shown.shown?.ticket
      return { plan: shown.shown?.plan ?? null, ticket, sessions: ticket ? sessionsOf(agents, ticket) : [] }
    },
    null,
    10_000,
    [projectId, slug],
  )
  const { busy, error, run } = useAction()
  const ticket = read && 'plan' in read ? read.ticket : undefined
  // The work starts from where its plan is read, as from the ticket's row: not on a ticket in review
  // or waiting, which no agent is handed, nor on one an agent holds.
  const startable = ticket !== undefined && !heldBack(ticket) && !ticket.locked

  return (
    <TicketPageShell onBack={onBack} path={path}>
      {!loaded ? (
        <TicketPageNote>Loading…</TicketPageNote>
      ) : read && 'error' in read ? (
        <TicketPageNote>
          <span role="alert">Could not read the plan: {read.error}</span>
        </TicketPageNote>
      ) : !read || read.plan === null ? (
        // No `.plan.md` beside the ticket — never written, or removed since the list read.
        <TicketPageNote>This ticket has no plan yet.</TicketPageNote>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Plan</p>
              {ticket && (
                <button type="button" className="text-left text-lg font-semibold hover:underline" onClick={() => host.openPage('tickets', [ticket.file], projectId)}>
                  {ticket.title}
                </button>
              )}
            </div>
            {startable && (
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <TicketStartActions
                  projectId={projectId}
                  ticket={{ ...ticket, planned: true }}
                  busy={busy}
                  onStart={(prompt, failure) => void run(() => host.startRun(projectId, prompt), failure)}
                  onConfigure={prompt => host.configureRun(projectId, prompt)}
                />
              </div>
            )}
          </div>
          {ticket && <PlanFacts ticket={ticket} />}
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
          {read.sessions.length > 0 && (
            <div className="mt-4">
              <TicketSessions sessions={read.sessions} onOpen={agentId => host.openAgent(projectId, agentId)} />
            </div>
          )}
          <div className="mt-6 border-t border-border pt-6">
            <Markdown text={planBody(read.plan)} page />
          </div>
        </>
      )}
    </TicketPageShell>
  )
}

/** What the plan says of the work, and where the ticket stands: under the title, as the ticket's page sets its facts. */
function PlanFacts({ ticket }: { ticket: TicketDetail }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
      {ticket.effort !== undefined && <Badge className="border-border px-1.5 text-[10px] text-muted-foreground">Effort {ticket.effort}/10</Badge>}
      {ticket.uncertainty !== undefined && <Badge className="border-border px-1.5 text-[10px] text-muted-foreground">Uncertainty {ticket.uncertainty}/10</Badge>}
      {ticket.outdated && <Badge className="border-warning/40 px-1.5 text-[10px] text-warning">Outdated: the ticket changed since</Badge>}
      {ticket.pr && (
        <a href={ticket.pr.url} target="_blank" rel="noreferrer" className="text-info hover:underline">
          In review · {ticket.pr.label}
        </a>
      )}
      {ticket.waiting && <span className="text-warning">Waiting · {ticket.waiting}</span>}
    </div>
  )
}
