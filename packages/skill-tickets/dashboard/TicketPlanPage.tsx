import { Button, Markdown, Tooltip, TooltipTrigger, TooltipContent, usePolled, useModuleHost, type ModuleAgent } from '@openagt/dashboard/module'
import { planAgentFor, planPath, readShown } from '../src/module.js'
import { TicketPageShell, TicketPageNote } from './TicketPageShell.js'
import { useBackToList } from './lib/back-to-list.js'

/** The page's read: the plan's text (none when the ticket has no plan, or no ticket), or why the command failed. */
type Read = { plan: string | null; agent: ModuleAgent | undefined } | { error: string }

// One ticket's plan: its `<stem>.plan.md` rendered as markdown, the destination of the tickets
// list's plan-column link. The plan comes with the ticket from `tickets show <file> --local`, and
// the agent that wrote it from the dashboard's runs — the plan file carries no marker, so the run
// whose ask named this plan is the author. `slug` is the ticket's filename, the same the list row
// and the URL carry, so the plan is addressed by the ticket it belongs to.
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
      return { plan: shown.shown?.plan ?? null, agent: planAgentFor(agents, slug) }
    },
    null,
    10_000,
    [projectId, slug],
  )

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
          {read.agent && <PlanAgentRow agent={read.agent} onOpen={() => host.openAgent(projectId, read.agent!.id)} />}
          <Markdown text={read.plan} />
        </>
      )}
    </TicketPageShell>
  )
}

/**
 * Who wrote the plan and the way back to them. A finished agent is resumed — same session, same
 * branch, same conversation — so the plan can be discussed with the agent that has it in context;
 * one still running is simply opened.
 */
function PlanAgentRow({ agent, onOpen }: { agent: ModuleAgent; onOpen: () => void }) {
  const running = agent.status === 'running'
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
      <span>{running ? 'An agent is writing this plan right now.' : 'Written by an agent whose session can be picked up where it left off.'}</span>
      <Tooltip>
        <TooltipTrigger render={<Button variant="outline" size="sm" className="h-7 shrink-0 text-xs" onClick={onOpen} />}>
          {running ? 'Open agent' : 'Resume agent'}
        </TooltipTrigger>
        <TooltipContent className="max-w-72">
          {running
            ? 'Opens the session writing this plan, so you can watch it or step in.'
            : 'Opens the session of the agent that wrote this plan. Anything you send there continues that same conversation — the plan, the ticket and the reasoning behind it are already in its context.'}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
